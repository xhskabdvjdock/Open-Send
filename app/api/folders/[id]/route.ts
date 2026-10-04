import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { dbReady } from '@/lib/db';
import { json, err } from '@/lib/api';
import { getSubmissionFolder, folderEffectiveStatus, isFolderOpenForSubmit } from '@/lib/folders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Student: folder detail (only if in allowed class)
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  const f = getSubmissionFolder(params.id);
  if (!f) return err('Folder not found.', 404);
  const db = await dbReady();
  const teacher = db.prepare('SELECT enabled FROM teachers WHERE id = ?').get(f.teacherId) as unknown as { enabled: number } | undefined;
  if (!teacher || teacher.enabled !== 1) return err('Folder not found.', 404);
  if (!sess.user.classId || !f.classIds.includes(sess.user.classId)) return err('You are not authorized.', 403);
  if (f.status === 'archived') return err('Folder not found.', 404);
  const classes = db.prepare('SELECT c.id, c.name FROM folder_classes fc JOIN classes c ON c.id = fc.classId WHERE fc.folderId = ?').all(params.id);
  const mySubs = db.prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM submission_files sf WHERE sf.submissionId = s.id) AS fileCount,
      (SELECT COALESCE(SUM(sf.size),0) FROM submission_files sf WHERE sf.submissionId = s.id) AS totalBytes
     FROM submissions s WHERE s.folderId = ? AND s.studentId = ? ORDER BY s.submissionNumber ASC`
  ).all(params.id, sess.user.id);
  const open = isFolderOpenForSubmit(f as never);
  return json({
    folder: { ...f, classes, effectiveStatus: folderEffectiveStatus(f as never), canSubmit: open.ok, closedReason: open.ok ? null : open.reason },
    mySubmissions: mySubs,
  });
}
