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
  const q = (url.searchParams.get('q') || '').trim().slice(0, 60);
  const classId = (url.searchParams.get('classId') || '').trim();

  const db = await dbReady();
  const where: string[] = ['u.enabled = 1', 'u.id != ?'];
  const params: (string | number | null)[] = [sess.user.id];
  if (classId) {
    where.push('u.classId = ?');
    params.push(classId);
  }
  if (q) {
    where.push("(u.usernameLower LIKE ? ESCAPE '\\' OR lower(u.displayName) LIKE ? ESCAPE '\\')");
    const like = `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like);
  }
  const sql = `SELECT u.id, u.username, u.displayName, u.classId, c.name AS className
    FROM users u LEFT JOIN classes c ON c.id = u.classId
    WHERE ${where.join(' AND ')}
    ORDER BY u.displayName COLLATE NOCASE LIMIT 30`;
  const rows = db.prepare(sql).all(...params) as unknown as {
    id: string; username: string; displayName: string; classId: string | null; className: string | null;
  }[];
  return json({ students: rows });
}
