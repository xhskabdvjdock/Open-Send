import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { dbReady, type TransferRow } from '@/lib/db';
import { json, err } from '@/lib/api';
import { isTransferExpired } from '@/lib/transfers';
import { moveTransferFiles } from '@/lib/transfers';
import { nowISO } from '@/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function loadTransfer(transferId: string, userId: string) {
  const db = await dbReady();
  const t = db.prepare('SELECT * FROM transfers WHERE id = ?').get(transferId) as unknown as TransferRow | undefined;
  if (!t) return { error: 'Transfer not found.' as const };
  if (t.senderId !== userId && t.recipientId !== userId) return { error: 'Forbidden.' as const };

  // Lazy expiry: flip overdue PENDING to EXPIRED on read.
  if (t.status === 'PENDING' && isTransferExpired(t)) {
    const now = nowISO();
    db.prepare("UPDATE transfers SET status='EXPIRED', updatedAt=? WHERE id=?").run(now, t.id);
    moveTransferFiles(t.id, 'pending', 'rejected');
    t.status = 'EXPIRED';
    t.updatedAt = now;
  }

  const files = db.prepare('SELECT id, originalName, mime, size, createdAt FROM transfer_files WHERE transferId = ? ORDER BY createdAt').all(transferId);
  const sender = db.prepare('SELECT u.id, u.username, u.displayName, c.name AS className FROM users u LEFT JOIN classes c ON c.id=u.classId WHERE u.id=?').get(t.senderId);
  const recipient = db.prepare('SELECT u.id, u.username, u.displayName, c.name AS className FROM users u LEFT JOIN classes c ON c.id=u.classId WHERE u.id=?').get(t.recipientId);
  return { transfer: t, files, sender, recipient };
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  const data = await loadTransfer(params.id, sess.user.id);
  if ('error' in data) {
    const msg: string = (data as { error: string }).error;
    return err(msg, msg === 'Transfer not found.' ? 404 : 403);
  }
  const isSender = (data.transfer as TransferRow).senderId === sess.user.id;
  const isRecipient = (data.transfer as TransferRow).recipientId === sess.user.id;
  return json({ ...data, isSender, isRecipient });
}
