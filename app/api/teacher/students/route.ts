import { dbReady } from '@/lib/db';
import { json } from '@/lib/api';
import { requireTeacher } from '@/lib/teacherGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Teacher sees students in their assigned classes only. Read-only, no sensitive data.
export async function GET(req: Request) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 60);
  const classId = (url.searchParams.get('classId') || '').trim();
  const db = await dbReady();
  const assigned = g.teacher.classIds;
  if (assigned.length === 0) return json({ students: [], classes: [] });
  let allowedClasses = assigned;
  if (classId) {
    if (!assigned.includes(classId)) return json({ students: [], classes: [] });
    allowedClasses = [classId];
  }
  const where: string[] = [`u.classId IN (${allowedClasses.map(() => '?').join(',')})`, 'u.enabled = 1'];
  const params: (string | number | null)[] = [...allowedClasses];
  if (q) {
    where.push("(u.usernameLower LIKE ? ESCAPE '\\' OR lower(u.displayName) LIKE ? ESCAPE '\\')");
    const like = `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like);
  }
  const students = db.prepare(
    `SELECT u.id, u.username, u.displayName, u.classId, c.name AS className, u.createdAt,
      CASE WHEN COALESCE(u.avatarFile, '') = '' THEN 0 ELSE 1 END AS hasAvatar,
      (SELECT COUNT(*) FROM submissions s WHERE s.studentId = u.id AND s.teacherId = ?) AS submissionCount
     FROM users u LEFT JOIN classes c ON c.id = u.classId
     WHERE ${where.join(' AND ')} ORDER BY u.displayName LIMIT 500`
  ).all(g.teacher.id, ...params);
  const classes = db.prepare(`SELECT id, name FROM classes WHERE id IN (${assigned.map(() => '?').join(',')}) ORDER BY name`).all(...assigned);
  return json({ students, classes });
}
