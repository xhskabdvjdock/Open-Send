import { dbReady } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/crypto';
import { json, err, clientIp } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/server-utils';
import { validatePassword } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const v = validatePassword(body.newPassword || '', 8);
  if (v) return err(v, 400);
  const db = await dbReady();
  const row = db.prepare('SELECT passwordHash FROM admins WHERE id = ?').get(g.admin.id) as unknown as { passwordHash: string };
  if (!(await verifyPassword(body.currentPassword || '', row.passwordHash))) {
    return err('Current password is incorrect.', 401);
  }
  db.prepare('UPDATE admins SET passwordHash = ? WHERE id = ?').run(await hashPassword(body.newPassword as string), g.admin.id);
  audit('Admin Changed Password', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, ip: clientIp(req) });
  return json({ ok: true });
}
