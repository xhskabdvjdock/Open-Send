import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { dbReady, type TransferRow } from '@/lib/db';
import { json, err, clientIp } from '@/lib/api';
import { audit, notify } from '@/lib/server-utils';
import { moveTransferFiles } from '@/lib/transfers';
import { nowISO } from '@/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);

  const db = await dbReady();
  const t = db.prepare('SELECT * FROM transfers WHERE id = ?').get(params.id) as unknown as TransferRow | undefined;
  if (!t) return err('Transfer not found.', 404);
  if (t.senderId !== sess.user.id) return err('Only the sender can cancel.', 403);
  if (t.status !== 'PENDING') return err(`Transfer is already ${t.status}.`, 400);

  db.prepare("UPDATE transfers SET status='CANCELLED', updatedAt=? WHERE id=?").run(nowISO(), t.id);
  moveTransferFiles(t.id, 'pending', 'rejected');
  notify(t.recipientId, 'cancelled', `${sess.user.displayName} cancelled a file sent to you.`, '', t.id);
  audit('Transfer Cancelled', { actorType: 'student', actorId: sess.user.id, actorName: sess.user.username, details: `transfer=${t.id}`, ip: clientIp(req) });
  return json({ ok: true, status: 'CANCELLED' });
}
