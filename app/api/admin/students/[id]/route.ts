import { dbReady } from '@/lib/db';
import { json, err, clientIp } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/server-utils';
import { sanitizeDisplayName } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  let body: { displayName?: string; classId?: string | null; enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const db = await dbReady();
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(params.id) as unknown as { id: string; username: string } | undefined;
  if (!user) return err('Student not found.', 404);

  const updates: string[] = [];
  const vals: (string | number | null)[] = [];
  if (body.displayName !== undefined) {
    const dn = sanitizeDisplayName(body.displayName);
    if (dn.length < 2) return err('Display name too short.', 400);
    updates.push('displayName = ?');
    vals.push(dn);
  }
  if (body.classId !== undefined) {
    if (body.classId) {
      const cls = db.prepare('SELECT id FROM classes WHERE id = ?').get(body.classId) as unknown as { id: string } | undefined;
      if (!cls) return err('Class not found.', 400);
      updates.push('classId = ?');
      vals.push(body.classId);
    } else {
      updates.push('classId = NULL');
    }
  }
  if (body.enabled !== undefined) {
    updates.push('enabled = ?');
    vals.push(body.enabled ? 1 : 0);
  }
  if (updates.length === 0) return err('Nothing to update.', 400);
  vals.push(params.id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
  audit('Admin Updated Student', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `username=${user.username} fields=${updates.join(',')}`, ip: clientIp(req) });
  return json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const db = await dbReady();
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(params.id) as unknown as { username: string } | undefined;
  if (!user) return err('Student not found.', 404);
  // Delete physical files of their transfers first
  const { deleteTransferFiles } = await import('@/lib/transfers');
  const transfers = db.prepare('SELECT id FROM transfers WHERE senderId = ? OR recipientId = ?').all(params.id, params.id) as unknown as { id: string }[];
  for (const t of transfers) deleteTransferFiles(t.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(params.id);
  audit('Admin Deleted Student', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `username=${user.username}`, ip: clientIp(req) });
  return json({ ok: true });
}
