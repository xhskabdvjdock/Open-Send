import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { dbReady } from '@/lib/db';
import { json, err } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  const url = new URL(req.url);
  const folderId = (url.searchParams.get('folderId') || '').trim();
  const db = await dbReady();
  let sql = `SELECT s.*, f.name AS folderName, f.deadline AS folderDeadline, t.displayName AS teacherName,
    (SELECT COUNT(*) FROM submission_files sf WHERE sf.submissionId = s.id) AS fileCount,
    (SELECT COALESCE(SUM(sf.size),0) FROM submission_files sf WHERE sf.submissionId = s.id) AS totalBytes
    FROM submissions s JOIN submission_folders f ON f.id = s.folderId JOIN teachers t ON t.id = s.teacherId
    WHERE s.studentId = ?`;
  const vals: (string | number)[] = [sess.user.id];
  if (folderId) {
    sql += ' AND s.folderId = ?';
    vals.push(folderId);
  }
  sql += ' ORDER BY s.createdAt DESC LIMIT 200';
  const rows = db.prepare(sql).all(...vals);
  return json({ submissions: rows });
}
