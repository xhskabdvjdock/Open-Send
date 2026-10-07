import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { dbReady } from '@/lib/db';
import { json, err } from '@/lib/api';
import { getSettings } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Teachers this student may contact: enabled + assigned to the student's class.
// Independent switch (chatTeacherChat) — stays available even if
// student-to-student chat is off.
export async function GET(req: Request) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  const s = getSettings();
  if (!s.chatEnabled || !s.chatTeacherChat) return err('Chat is disabled.', 403);
  if (!sess.user.classId) return json({ teachers: [] });
  const db = await dbReady();
  const rows = db.prepare(
    `SELECT DISTINCT t.id, t.username, t.displayName,
     CASE WHEN COALESCE(t.avatarFile, '') = '' THEN 0 ELSE 1 END AS hasAvatar FROM teachers t
     JOIN teacher_classes tc ON tc.teacherId = t.id
     WHERE tc.classId = ? AND t.enabled = 1
     ORDER BY t.displayName COLLATE NOCASE`
  ).all(sess.user.classId) as unknown as { id: string; username: string; displayName: string; hasAvatar: number }[];
  return json({ teachers: rows });
}
