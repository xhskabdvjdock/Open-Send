import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { dbReady } from '@/lib/db';
import { json, err } from '@/lib/api';
import { runExpirySweep } from '@/lib/transfers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  runExpirySweep();

  const url = new URL(req.url);
  const type = url.searchParams.get('type') === 'sent' ? 'sent' : 'received';
  const status = (url.searchParams.get('status') || '').toUpperCase();
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100) || 100));

  const db = await dbReady();
  const where: string[] = [];
  const params: (string | number | null)[] = [];
  if (type === 'sent') {
    where.push('t.senderId = ?');
    params.push(sess.user.id);
  } else {
    where.push('t.recipientId = ?');
    params.push(sess.user.id);
  }
  if (status && ['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'DOWNLOADED', 'CANCELLED'].includes(status)) {
    where.push('t.status = ?');
    params.push(status);
  }

  const rows = db.prepare(
    `SELECT t.*,
      s.username AS senderUsername, s.displayName AS senderName, sc.name AS senderClass,
      r.username AS recipientUsername, r.displayName AS recipientName, rc.name AS recipientClass,
      (SELECT COUNT(*) FROM transfer_files f WHERE f.transferId = t.id) AS fileCount,
      (SELECT COALESCE(SUM(f.size),0) FROM transfer_files f WHERE f.transferId = t.id) AS totalBytes,
      (SELECT f.originalName FROM transfer_files f WHERE f.transferId = t.id ORDER BY f.createdAt LIMIT 1) AS firstFileName
     FROM transfers t
     LEFT JOIN users s ON s.id = t.senderId LEFT JOIN classes sc ON sc.id = s.classId
     LEFT JOIN users r ON r.id = t.recipientId LEFT JOIN classes rc ON rc.id = r.classId
     WHERE ${where.join(' AND ')}
     ORDER BY t.createdAt DESC LIMIT ?`
  ).all(...params, limit) as unknown as Record<string, unknown>[];

  return json({ transfers: rows });
}
