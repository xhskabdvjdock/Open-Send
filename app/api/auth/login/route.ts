import { dbReady } from '@/lib/db';
import { verifyPassword } from '@/lib/crypto';
import { createStudentSession, studentCookieHeader } from '@/lib/auth';
import { json, err, clientIp, userAgent } from '@/lib/api';
import { audit } from '@/lib/server-utils';
import { rateLimit, loginKey } from '@/lib/rateLimit';
import { getSettings } from '@/lib/settings';

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

  const rl = rateLimit(loginKey(ip, username), 10, 5 * 60 * 1000);
  if (!rl.ok) {
    audit('Failed Login', { actorType: 'student', actorName: username, details: 'rate-limited', ip });
    return err('Too many attempts. Please try again later.', 429);
  }

  const db = await dbReady();
  const user = db.prepare(
    'SELECT u.*, c.name AS className FROM users u LEFT JOIN classes c ON c.id = u.classId WHERE u.usernameLower = ?'
  ).get(username.toLowerCase()) as unknown as {
    id: string; username: string; displayName: string; passwordHash: string; classId: string | null; className: string | null; enabled: number;
  } | undefined;

  if (!user) {
    audit('Failed Login', { actorType: 'student', actorName: username, details: 'unknown user', ip });
    return err('Invalid username or password.', 401);
  }
  if (user.enabled !== 1) {
    audit('Failed Login', { actorType: 'student', actorId: user.id, actorName: user.username, details: 'disabled account', ip });
    return err('This account is disabled. Please contact the administrator.', 403);
  }
  const ok = await verifyPassword(password, user.passwordHash);
  // Maintenance mode still allows login attempt but blocks app; inform here.
  if (!ok) {
    audit('Failed Login', { actorType: 'student', actorId: user.id, actorName: user.username, details: 'wrong password', ip });
    return err('Invalid username or password.', 401);
  }
  db.prepare('UPDATE users SET lastLoginAt = ? WHERE id = ?').run(new Date().toISOString(), user.id);
  audit('Login', { actorType: 'student', actorId: user.id, actorName: user.username, ip });

  const token = await createStudentSession(user.id, ip, ua);
  const settings = getSettings();
  const res = json({
    ok: true,
    user: { id: user.id, username: user.username, displayName: user.displayName, classId: user.classId, className: user.className },
    maintenanceMode: settings.maintenanceMode,
  });
  res.headers.set('Set-Cookie', studentCookieHeader(token));
  return res;
}
