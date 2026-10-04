import { dbReady } from '@/lib/db';
import { json } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 60).toLowerCase();
  const teacherId = (url.searchParams.get('teacherId') || '').trim();
  const status = (url.searchParams.get('status') || '').trim();
  const db = await dbReady();
  const where: string[] = [];
  const vals: (string | number)[] = [];
  if (q) {
    where.push("(lower(f.name) LIKE ? ESCAPE '\\' OR lower(t.displayName) LIKE ? ESCAPE '\\')");
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    vals.push(like, like);
  }
  if (teacherId) {
    where.push('f.teacherId = ?');
    vals.push(teacherId);
  }
  if (status && ['active', 'closed', 'archived'].includes(status)) {
    where.push('f.status = ?');
    vals.push(status);
  }
  const folders = db.prepare(
    `SELECT f.*, t.displayName AS teacherName, t.username AS teacherUsername,
      (SELECT COUNT(*) FROM submissions s WHERE s.folderId = f.id AND s.status = 'current') AS submissionCount,
      (SELECT COUNT(DISTINCT s.studentId) FROM submissions s WHERE s.folderId = f.id AND s.status = 'current') AS studentCount,
      (SELECT COALESCE(SUM(sf.size),0) FROM submission_files sf JOIN submissions s ON s.id = sf.submissionId WHERE s.folderId = f.id) AS totalBytes
     FROM submission_folders f JOIN teachers t ON t.id = f.teacherId
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY f.createdAt DESC LIMIT 500`
  ).all(...vals) as unknown as Record<string, unknown>[];
  for (const f of folders) {
    try {
      (f as Record<string, unknown>).classes = db.prepare(
        'SELECT c.id, c.name FROM folder_classes fc JOIN classes c ON c.id = fc.classId WHERE fc.folderId = ?'
      ).all((f as { id: string }).id);
    } catch {
      (f as Record<string, unknown>).classes = [];
    }
  }
  return json({ folders });
}
