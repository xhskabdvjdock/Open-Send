import { dbReady } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/crypto';
import { json, err, clientIp } from '@/lib/api';
import { requireTeacher } from '@/lib/teacherGuard';
import { audit } from '@/lib/server-utils';
import { validatePassword } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const db = await dbReady();
  const row = db.prepare('SELECT * FROM teachers WHERE id = ?').get(g.teacher.id) as unknown as { passwordHash: string } | undefined;
  if (!row) return err('Not found.', 404);
  const ok = await verifyPassword(body.currentPassword || '', row.passwordHash);
  if (!ok) return err('Current password is incorrect.', 400);
  const pErr = validatePassword(body.newPassword || '', 6);
  if (pErr) return err(pErr, 400);
  db.prepare('UPDATE teachers SET passwordHash = ? WHERE id = ?').run(await hashPassword(body.newPassword!), g.teacher.id);
  audit('Teacher Changed Password', { actorType: 'teacher', actorId: g.teacher.id, actorName: g.teacher.username, ip: clientIp(req) });
  return json({ ok: true });
}
