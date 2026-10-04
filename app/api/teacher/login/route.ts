import { dbReady } from '@/lib/db';
import { verifyPassword } from '@/lib/crypto';
import { createTeacherSession, teacherCookieHeader } from '@/lib/auth';
import { json, err, clientIp, userAgent } from '@/lib/api';
import { audit } from '@/lib/server-utils';
import { rateLimit, loginKey } from '@/lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const ip = clientIp(req);
  const ua = userAgent(req);
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const username = (body.username || '').trim();
  const password = body.password || '';
  if (!username || !password) return err('Username and password are required.', 400);

  const rl = rateLimit(loginKey(ip, 'teacher:' + username), 10, 5 * 60 * 1000);
  if (!rl.ok) {
    audit('Failed Teacher Login', { actorType: 'teacher', actorName: username, details: 'rate-limited', ip });
    return err('Too many attempts. Please try again later.', 429);
  }

  const db = await dbReady();
  const teacher = db.prepare('SELECT * FROM teachers WHERE usernameLower = ?').get(username.toLowerCase()) as unknown as {
    id: string; username: string; displayName: string; passwordHash: string; enabled: number;
  } | undefined;
  if (!teacher) {
    audit('Failed Teacher Login', { actorType: 'teacher', actorName: username, details: 'unknown teacher', ip });
    return err('Invalid username or password.', 401);
  }
  if (teacher.enabled !== 1) {
    audit('Failed Teacher Login', { actorType: 'teacher', actorId: teacher.id, actorName: teacher.username, details: 'disabled account', ip });
    return err('This account is disabled. Please contact the administrator.', 403);
  }
  const ok = await verifyPassword(password, teacher.passwordHash);
  if (!ok) {
    audit('Failed Teacher Login', { actorType: 'teacher', actorId: teacher.id, actorName: teacher.username, details: 'wrong password', ip });
    return err('Invalid username or password.', 401);
  }
  db.prepare('UPDATE teachers SET lastLoginAt = ? WHERE id = ?').run(new Date().toISOString(), teacher.id);
  audit('Teacher Login', { actorType: 'teacher', actorId: teacher.id, actorName: teacher.username, ip });
  const token = await createTeacherSession(teacher.id, ip, ua);
  const classIds = (db.prepare('SELECT classId FROM teacher_classes WHERE teacherId = ?').all(teacher.id) as unknown as { classId: string }[]).map((r) => r.classId);
  const res = json({ ok: true, teacher: { id: teacher.id, username: teacher.username, displayName: teacher.displayName, classIds } });
  res.headers.set('Set-Cookie', teacherCookieHeader(token));
  return res;
}
