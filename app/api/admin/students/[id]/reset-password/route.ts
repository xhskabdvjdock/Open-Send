import { dbReady } from '@/lib/db';
import { hashPassword } from '@/lib/crypto';
import { json, err, clientIp } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/server-utils';
import { validatePassword } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  let body: { newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const v = validatePassword(body.newPassword || '', 6);
  if (v) return err(v, 400);
  const db = await dbReady();
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(params.id) as unknown as { username: string } | undefined;
  if (!user) return err('Student not found.', 404);
  db.prepare('UPDATE users SET passwordHash = ? WHERE id = ?').run(await hashPassword(body.newPassword as string), params.id);
  // Invalidate student sessions for safety
  try {
    db.prepare('DELETE FROM sessions WHERE userId = ?').run(params.id);
  } catch {}
  audit('Admin Reset Password', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `username=${user.username}`, ip: clientIp(req) });
  return json({ ok: true });
}
