import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { json, err } from '@/lib/api';
import { getSettings } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  const s = getSettings();
  return json({
    user: {
      id: sess.user.id,
      username: sess.user.username,
      displayName: sess.user.displayName,
      classId: sess.user.classId,
      className: sess.user.className,
      createdAt: sess.user.createdAt,
      lastLoginAt: sess.user.lastLoginAt,
    },
    maintenanceMode: s.maintenanceMode,
    allowClassChange: s.allowClassChange,
  });
}
