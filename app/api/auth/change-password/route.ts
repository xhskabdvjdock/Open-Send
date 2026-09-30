import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { dbReady } from '@/lib/db';
import { verifyPassword, hashPassword, nowISO } from '@/lib/crypto';
import { validatePassword } from '@/lib/validation';
import { json, err, clientIp } from '@/lib/api';
import { audit } from '@/lib/server-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const cur = body.currentPassword || '';
  const next = body.newPassword || '';
  const v = validatePassword(next, 6);
  if (v) return err(v, 400);

  const db = await dbReady();
  const row = db.prepare('SELECT passwordHash FROM users WHERE id = ?').get(sess.user.id) as unknown as { passwordHash: string };
  const ok = await verifyPassword(cur, row.passwordHash);
  if (!ok) return err('Current password is incorrect.', 401);

  const hashed = await hashPassword(next);
  db.prepare('UPDATE users SET passwordHash = ? WHERE id = ?').run(hashed, sess.user.id);
  audit('Password Changed', { actorType: 'student', actorId: sess.user.id, actorName: sess.user.username, ip: clientIp(req) });
  return json({ ok: true });
}
