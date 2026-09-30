import fs from 'node:fs';
import path from 'node:path';
import { dbReady, type TransferFileRow } from '@/lib/db';
import { json, err, clientIp } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/server-utils';
import { storageSubdir } from '@/lib/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Delete a single file's metadata + bytes (privacy-respecting: metadata only by default in UI).
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const db = await dbReady();
  const f = db.prepare('SELECT * FROM transfer_files WHERE id = ?').get(params.id) as unknown as TransferFileRow | undefined;
  if (!f) return err('File not found.', 404);
  for (const k of ['pending', 'accepted', 'completed', 'rejected'] as const) {
    try {
      const p = path.join(storageSubdir(k), f.storedFile);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {}
  }
  db.prepare('DELETE FROM transfer_files WHERE id = ?').run(params.id);
  audit('Admin Deleted File', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `file=${f.originalName} transfer=${f.transferId}`, ip: clientIp(req) });
  return json({ ok: true });
}
