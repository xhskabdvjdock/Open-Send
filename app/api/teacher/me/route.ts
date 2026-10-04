import { getTeacherFromToken, TEACHER_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { json, err } from '@/lib/api';
import { dbReady } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const token = getCookieFromHeader(req.headers.get('cookie'), TEACHER_COOKIE);
  const sess = await getTeacherFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  const db = await dbReady();
  const classes = db.prepare('SELECT c.id, c.name FROM teacher_classes tc JOIN classes c ON c.id = tc.classId WHERE tc.teacherId = ?').all(sess.teacher.id);
  const { passwordHash: _ph, ...safe } = sess.teacher as unknown as Record<string, unknown>;
  return json({ teacher: { ...safe, classes } });
}
