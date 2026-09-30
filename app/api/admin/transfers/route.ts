import { dbReady } from '@/lib/db';
import { json } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const url = new URL(req.url);
  const sender = (url.searchParams.get('sender') || '').trim();
  const recipient = (url.searchParams.get('recipient') || '').trim();
  const classId = (url.searchParams.get('classId') || '').trim();
  const status = (url.searchParams.get('status') || '').toUpperCase();
  const fileType = (url.searchParams.get('fileType') || '').toLowerCase();
  const date = (url.searchParams.get('date') || '').trim(); // YYYY-MM-DD

  const db = await dbReady();
  const where: string[] = [];
  const params: (string | number | null)[] = [];
  const likeEscape = (s: string) => `%${s.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  if (sender) {
    where.push("(s.usernameLower LIKE ? ESCAPE '\\' OR lower(s.displayName) LIKE ? ESCAPE '\\')");
    const like = likeEscape(sender);
    params.push(like, like);
  }
  if (recipient) {
    where.push("(r.usernameLower LIKE ? ESCAPE '\\' OR lower(r.displayName) LIKE ? ESCAPE '\\')");
    const like = likeEscape(recipient);
    params.push(like, like);
  }
  if (classId) {
    where.push('(s.classId = ? OR r.classId = ?)');
    params.push(classId, classId);
  }
  if (['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'DOWNLOADED', 'CANCELLED'].includes(status)) {
    where.push('t.status = ?');
    params.push(status);
  }
  if (date) {
    where.push('substr(t.createdAt,1,10) = ?');
    params.push(date);
  }
  if (fileType) {
    where.push("EXISTS (SELECT 1 FROM transfer_files f WHERE f.transferId = t.id AND lower(f.mime) LIKE ? ESCAPE '\\')");
    params.push(`%${fileType.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }

  const rows = db.prepare(
    `SELECT t.*, s.username AS senderUsername, s.displayName AS senderName, sc.name AS senderClass,
      r.username AS recipientUsername, r.displayName AS recipientName, rc.name AS recipientClass,
      (SELECT COUNT(*) FROM transfer_files f WHERE f.transferId = t.id) AS fileCount,
      (SELECT COALESCE(SUM(f.size),0) FROM transfer_files f WHERE f.transferId = t.id) AS totalBytes
     FROM transfers t
     LEFT JOIN users s ON s.id = t.senderId LEFT JOIN classes sc ON sc.id = s.classId
     LEFT JOIN users r ON r.id = t.recipientId LEFT JOIN classes rc ON rc.id = r.classId
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY t.createdAt DESC LIMIT 300`
  ).all(...params);
  return json({ transfers: rows });
}
