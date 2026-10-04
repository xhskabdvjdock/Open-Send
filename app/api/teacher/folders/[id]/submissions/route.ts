import { dbReady } from '@/lib/db';
import { json } from '@/lib/api';
import { requireTeacher } from '@/lib/teacherGuard';
import { teacherOwnsFolder } from '@/lib/folders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Search + filter submissions inside teacher's own folder
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  if (!teacherOwnsFolder(g.teacher.id, params.id)) return json({ error: 'Folder not found.' }, 404);
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 60).toLowerCase();
  const status = (url.searchParams.get('status') || '').trim(); // current|replaced|late|missing handled client-side for missing
  const classId = (url.searchParams.get('classId') || '').trim();
  const db = await dbReady();
  const where: string[] = ['s.folderId = ?'];
  const vals: (string | number)[] = [params.id];
  if (status === 'current' || status === 'replaced') {
    where.push('s.status = ?');
    vals.push(status);
  } else if (status === 'late') {
    where.push('s.isLate = 1');
  }
  if (classId) {
    where.push('s.classId = ?');
    vals.push(classId);
  }
  if (q) {
    where.push("(lower(u.displayName) LIKE ? ESCAPE '\\' OR u.usernameLower LIKE ? ESCAPE '\\' OR lower(s.message) LIKE ? ESCAPE '\\')");
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    vals.push(like, like, like);
  }
  let rows = db.prepare(
    `SELECT s.*, u.username AS studentUsername, u.displayName AS studentName, c.name AS className,
      (SELECT COUNT(*) FROM submission_files sf WHERE sf.submissionId = s.id) AS fileCount,
      (SELECT COALESCE(SUM(sf.size),0) FROM submission_files sf WHERE sf.submissionId = s.id) AS totalBytes,
      (SELECT sf.originalName FROM submission_files sf WHERE sf.submissionId = s.id ORDER BY sf.createdAt LIMIT 1) AS firstFileName
     FROM submissions s JOIN users u ON u.id = s.studentId LEFT JOIN classes c ON c.id = s.classId
     WHERE ${where.join(' AND ')} ORDER BY s.createdAt DESC LIMIT 500`
  ).all(...vals) as unknown as Record<string, unknown>[];
  // File-name search: if q looks like filename, also match by file originalName
  if (q && q.includes('.')) {
    try {
      const extra = db.prepare(
        `SELECT s.*, u.username AS studentUsername, u.displayName AS studentName, c.name AS className,
          (SELECT COUNT(*) FROM submission_files sf WHERE sf.submissionId = s.id) AS fileCount,
          (SELECT COALESCE(SUM(sf.size),0) FROM submission_files sf WHERE sf.submissionId = s.id) AS totalBytes
         FROM submissions s JOIN users u ON u.id = s.studentId LEFT JOIN classes c ON c.id = s.classId
         WHERE s.folderId = ? AND s.id IN (SELECT submissionId FROM submission_files WHERE lower(originalName) LIKE ? ESCAPE '\\')
         ORDER BY s.createdAt DESC LIMIT 100`
      ).all(params.id, `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) as unknown as Record<string, unknown>[];
      const seen = new Set(rows.map((r) => String(r.id)));
      for (const e of extra) {
        if (!seen.has(String(e.id))) rows.push(e);
      }
    } catch {}
  }
  return json({ submissions: rows });
}
