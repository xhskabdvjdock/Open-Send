import { dbReady } from '@/lib/db';
import { json, err } from '@/lib/api';
import { requireTeacher } from '@/lib/teacherGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Limited student profile for teacher: name, username, class, submission history in teacher's folders.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  const db = await dbReady();
  const u = db.prepare('SELECT u.id, u.username, u.displayName, u.classId, c.name AS className, u.createdAt FROM users u LEFT JOIN classes c ON c.id = u.classId WHERE u.id = ?').get(params.id) as unknown as {
    id: string; username: string; displayName: string; classId: string | null; className: string | null;
  } | undefined;
  if (!u) return err('Student not found.', 404);
  if (!u.classId || !g.teacher.classIds.includes(u.classId)) return err('You are not authorized.', 403);
  const subs = db.prepare(
    `SELECT s.id, s.folderId, s.submissionNumber, s.status, s.isLate, s.createdAt, s.message, f.name AS folderName,
      (SELECT COUNT(*) FROM submission_files sf WHERE sf.submissionId = s.id) AS fileCount
     FROM submissions s JOIN submission_folders f ON f.id = s.folderId
     WHERE s.studentId = ? AND s.teacherId = ? ORDER BY s.createdAt DESC LIMIT 100`
  ).all(params.id, g.teacher.id);
  return json({ student: u, submissions: subs });
}
