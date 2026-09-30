import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { dbReady } from '@/lib/db';
import { json, err, clientIp } from '@/lib/api';
import { audit } from '@/lib/server-utils';
import { getSettings } from '@/lib/settings';
import { sanitizeDisplayName } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  let body: { displayName?: string; classId?: string };
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const db = await dbReady();
  const settings = getSettings();
  if (body.displayName !== undefined) {
    const dn = sanitizeDisplayName(body.displayName);
    if (dn.length < 2) return err('Display name too short.', 400);
    db.prepare('UPDATE users SET displayName = ? WHERE id = ?').run(dn, sess.user.id);
  }
  if (body.classId !== undefined) {
    if (!settings.allowClassChange) return err('Changing class is disabled by the administrator.', 403);
    const cls = db.prepare('SELECT id, enabled FROM classes WHERE id = ?').get(body.classId) as unknown as { id: string; enabled: number } | undefined;
    if (!cls || cls.enabled !== 1) return err('Invalid class.', 400);
    db.prepare('UPDATE users SET classId = ? WHERE id = ?').run(body.classId, sess.user.id);
  }
  audit('Profile Updated', { actorType: 'student', actorId: sess.user.id, actorName: sess.user.username, ip: clientIp(req) });
  return json({ ok: true });
}
