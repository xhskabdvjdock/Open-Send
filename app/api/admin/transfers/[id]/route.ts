import { dbReady, type TransferRow } from '@/lib/db';
import { json, err, clientIp } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { audit, notify } from '@/lib/server-utils';
import { moveTransferFiles, deleteTransferFiles } from '@/lib/transfers';
import { nowISO } from '@/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const db = await dbReady();
  const t = db.prepare('SELECT * FROM transfers WHERE id = ?').get(params.id) as unknown as TransferRow | undefined;
  if (!t) return err('Transfer not found.', 404);
  const files = db.prepare('SELECT id, originalName, mime, size, createdAt FROM transfer_files WHERE transferId = ?').all(params.id);
  return json({ transfer: t, files });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const action = (body.action || '').toLowerCase();
  const db = await dbReady();
  const t = db.prepare('SELECT * FROM transfers WHERE id = ?').get(params.id) as unknown as TransferRow | undefined;
  if (!t) return err('Transfer not found.', 404);
  const now = nowISO();

  if (action === 'cancel') {
    if (t.status !== 'PENDING') return err(`Cannot cancel (status: ${t.status}).`, 400);
    db.prepare("UPDATE transfers SET status='CANCELLED', updatedAt=? WHERE id=?").run(now, t.id);
    moveTransferFiles(t.id, 'pending', 'rejected');
    notify(t.senderId, 'cancelled', 'An administrator cancelled your transfer.', '', t.id);
    notify(t.recipientId, 'cancelled', 'An administrator cancelled a file sent to you.', '', t.id);
    audit('Admin Cancelled Transfer', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `transfer=${t.id}`, ip: clientIp(req) });
    return json({ ok: true, status: 'CANCELLED' });
  }
  if (action === 'expire') {
    if (t.status === 'EXPIRED') return json({ ok: true, status: 'EXPIRED' });
    db.prepare("UPDATE transfers SET status='EXPIRED', updatedAt=? WHERE id=?").run(now, t.id);
    moveTransferFiles(t.id, 'pending', 'rejected');
    moveTransferFiles(t.id, 'accepted', 'rejected');
    audit('Admin Expired Transfer', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `transfer=${t.id}`, ip: clientIp(req) });
    return json({ ok: true, status: 'EXPIRED' });
  }
  return err('Unknown action. Use cancel or expire.', 400);
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const db = await dbReady();
  const t = db.prepare('SELECT * FROM transfers WHERE id = ?').get(params.id) as unknown as TransferRow | undefined;
  if (!t) return err('Transfer not found.', 404);
  deleteTransferFiles(t.id);
  db.prepare('DELETE FROM transfers WHERE id = ?').run(t.id);
  audit('Admin Deleted Transfer', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `transfer=${t.id} status=${t.status}`, ip: clientIp(req) });
  return json({ ok: true });
}
