import { dbReady } from '@/lib/db';
import { json, err, clientIp } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/server-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  let body: { name?: string; enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const db = await dbReady();
  const cls = db.prepare('SELECT name FROM classes WHERE id = ?').get(params.id) as unknown as { name: string } | undefined;
  if (!cls) return err('Class not found.', 404);
  if (body.name !== undefined) {
    const name = body.name.trim().replace(/\s+/g, ' ').slice(0, 80);
    if (name.length < 2) return err('Class name too short.', 400);
    const dup = db.prepare('SELECT id FROM classes WHERE lower(name) = ? AND id != ?').get(name.toLowerCase(), params.id);
    if (dup) return err('Another class has this name.', 409);
    db.prepare('UPDATE classes SET name = ? WHERE id = ?').run(name, params.id);
  }
  if (body.enabled !== undefined) {
    db.prepare('UPDATE classes SET enabled = ? WHERE id = ?').run(body.enabled ? 1 : 0, params.id);
  }
  audit('Admin Updated Class', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `id=${params.id}`, ip: clientIp(req) });
  return json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const url = new URL(req.url);
  const reassignTo = (url.searchParams.get('reassignTo') || '').trim();
  const db = await dbReady();
  const cls = db.prepare('SELECT name FROM classes WHERE id = ?').get(params.id) as unknown as { name: string } | undefined;
  if (!cls) return err('Class not found.', 404);
  const count = (db.prepare('SELECT COUNT(*) AS c FROM users WHERE classId = ?').get(params.id) as unknown as { c: number }).c;
  if (count > 0 && !reassignTo) {
    return err(`This class has ${count} student(s). Provide ?reassignTo=<classId> or move students first.`, 400);
  }
  if (count > 0) {
    const target = db.prepare('SELECT id FROM classes WHERE id = ?').get(reassignTo) as unknown as { id: string } | undefined;
    if (!target || target.id === params.id) return err('Invalid reassign target.', 400);
    db.prepare('UPDATE users SET classId = ? WHERE classId = ?').run(reassignTo, params.id);
  }
  db.prepare('DELETE FROM classes WHERE id = ?').run(params.id);
  audit('Admin Deleted Class', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `name=${cls.name}`, ip: clientIp(req) });
  return json({ ok: true });
}
