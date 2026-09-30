import { dbReady } from '@/lib/db';
import { verifyPassword } from '@/lib/crypto';
import { createAdminSession, adminCookieHeader } from '@/lib/auth';
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

  const rl = rateLimit(`admin:${loginKey(ip, username)}`, 10, 5 * 60 * 1000);
  if (!rl.ok) return err('Too many attempts. Please try again later.', 429);

  const db = await dbReady();
  const admin = db.prepare('SELECT * FROM admins WHERE usernameLower = ?').get(username.toLowerCase()) as unknown as {
    id: string; username: string; passwordHash: string;
  } | undefined;
  if (!admin || !(await verifyPassword(password, admin.passwordHash))) {
    audit('Failed Admin Login', { actorType: 'admin', actorName: username, details: 'invalid credentials', ip });
    return err('Invalid admin credentials.', 401);
  }
  const token = await createAdminSession(admin.id, ip, ua);
  audit('Admin Login', { actorType: 'admin', actorId: admin.id, actorName: admin.username, ip });
  const res = json({ ok: true, admin: { id: admin.id, username: admin.username } });
  res.headers.set('Set-Cookie', adminCookieHeader(token));
  return res;
}
