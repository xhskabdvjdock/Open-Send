import { dbReady } from '@/lib/db';
import { json, err } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const db = await dbReady();
  const s = db.prepare(
    `SELECT s.*, u.username AS studentUsername, u.displayName AS studentName, c.name AS className,
      f.name AS folderName, t.displayName AS teacherName FROM submissions s
     JOIN users u ON u.id = s.studentId LEFT JOIN classes c ON c.id = s.classId
     JOIN submission_folders f ON f.id = s.folderId JOIN teachers t ON t.id = s.teacherId WHERE s.id = ?`
  ).get(params.id) as unknown as Record<string, unknown> | undefined;
  if (!s) return err('Submission not found.', 404);
  const files = db.prepare('SELECT * FROM submission_files WHERE submissionId = ? ORDER BY createdAt').all(params.id);
  const history = db.prepare('SELECT s.*, (SELECT COUNT(*) FROM submission_files sf WHERE sf.submissionId = s.id) AS fileCount FROM submissions s WHERE s.folderId = ? AND s.studentId = ? ORDER BY s.submissionNumber ASC').all(String((s as { folderId: string }).folderId), String((s as { studentId: string }).studentId));
  return json({ submission: s, files, history });
}
