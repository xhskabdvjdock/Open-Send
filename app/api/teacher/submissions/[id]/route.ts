import { dbReady } from '@/lib/db';
import { json, err } from '@/lib/api';
import { requireTeacher } from '@/lib/teacherGuard';
import { audit } from '@/lib/server-utils';
import { clientIp } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Teacher views a single submission (must own the folder)
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  const db = await dbReady();
  const s = db.prepare(
    `SELECT s.*, u.username AS studentUsername, u.displayName AS studentName, c.name AS className,
      f.name AS folderName, f.description AS folderDescription, f.deadline AS folderDeadline
     FROM submissions s JOIN users u ON u.id = s.studentId LEFT JOIN classes c ON c.id = s.classId
     JOIN submission_folders f ON f.id = s.folderId WHERE s.id = ?`
  ).get(params.id) as unknown as Record<string, unknown> | undefined;
  if (!s) return err('Submission not found.', 404);
  const owner = db.prepare('SELECT teacherId FROM submission_folders WHERE id = ?').get(String(s.folderId)) as unknown as { teacherId: string } | undefined;
  if (!owner || owner.teacherId !== g.teacher.id) return err('You are not authorized.', 403);
  const files = db.prepare('SELECT * FROM submission_files WHERE submissionId = ? ORDER BY createdAt').all(params.id);
  // History: all submissions by same student in same folder
  const history = db.prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM submission_files sf WHERE sf.submissionId = s.id) AS fileCount
     FROM submissions s WHERE s.folderId = ? AND s.studentId = ? ORDER BY s.submissionNumber ASC`
  ).all(String(s.folderId), String(s.studentId));
  audit('Teacher Viewed Submission', { actorType: 'teacher', actorId: g.teacher.id, actorName: g.teacher.username, details: `submission=${params.id}`, ip: clientIp(req) });
  return json({ submission: s, files, history });
}
