import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { dbReady } from '@/lib/db';
import { json, err } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Student views own submission + its files + history in that folder
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  const db = await dbReady();
  const s = db.prepare(
    `SELECT s.*, f.name AS folderName, f.description AS folderDescription, f.deadline AS folderDeadline, t.displayName AS teacherName
     FROM submissions s JOIN submission_folders f ON f.id = s.folderId JOIN teachers t ON t.id = s.teacherId
     WHERE s.id = ?`
  ).get(params.id) as unknown as Record<string, unknown> | undefined;
  if (!s) return err('Submission not found.', 404);
  if (String(s.studentId) !== sess.user.id) return err('You are not authorized.', 403);
  const files = db.prepare('SELECT id, originalName, mime, size, createdAt FROM submission_files WHERE submissionId = ? ORDER BY createdAt').all(params.id);
  const history = db.prepare(
    `SELECT s.id, s.submissionNumber, s.status, s.isLate, s.createdAt, s.message,
      (SELECT COUNT(*) FROM submission_files sf WHERE sf.submissionId = s.id) AS fileCount
     FROM submissions s WHERE s.folderId = ? AND s.studentId = ? ORDER BY s.submissionNumber ASC`
  ).all(String(s.folderId), sess.user.id);
  return json({ submission: s, files, history });
}
