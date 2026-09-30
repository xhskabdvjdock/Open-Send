import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { dbReady } from '@/lib/db';
import { json, err } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  const db = await dbReady();
  const row = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE userId = ? AND isRead = 0').get(sess.user.id) as unknown as { c: number };
  return json({ unread: row.c });
}
