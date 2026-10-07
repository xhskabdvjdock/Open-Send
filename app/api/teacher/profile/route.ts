import { dbReady } from '@/lib/db';
import { json, err, clientIp } from '@/lib/api';
import { requireTeacher } from '@/lib/teacherGuard';
import { audit } from '@/lib/server-utils';
import { getSettings } from '@/lib/settings';
import { sanitizeDisplayName, validateUsername } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  let body: { displayName?: string; username?: string };
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const settings = getSettings();
  const db = await dbReady();
  if (body.displayName === undefined && body.username === undefined) {
    return err('Display name is required (min 2 characters).', 400);
  }
  const oldUsername = g.teacher.username;
  let usernameChangedTo: string | null = null;
  if (body.displayName !== undefined) {
    const name = sanitizeDisplayName(body.displayName || '');
    if (!name || name.length < 2) return err('Display name is required (min 2 characters).', 400);
    db.prepare('UPDATE teachers SET displayName = ? WHERE id = ?').run(name, g.teacher.id);
  }
  if (body.username !== undefined) {
    if (!settings.allowUsernameChange) return err('Changing username is disabled by the administrator.', 403);
    const raw = String(body.username).trim();
    if (raw !== g.teacher.username) {
      const vErr = validateUsername(raw);
      if (vErr) return err(vErr, 400);
      const taken = db.prepare('SELECT id FROM teachers WHERE usernameLower = ? AND id != ?').get(raw.toLowerCase(), g.teacher.id) as unknown as { id: string } | undefined;
      if (taken) return err('Username is already taken.', 409);
      db.prepare('UPDATE teachers SET username = ?, usernameLower = ? WHERE id = ?').run(raw, raw.toLowerCase(), g.teacher.id);
      usernameChangedTo = raw;
    }
  }
  audit('Teacher Updated Profile', { actorType: 'teacher', actorId: g.teacher.id, actorName: usernameChangedTo || oldUsername, details: usernameChangedTo ? `username: ${oldUsername} -> ${usernameChangedTo}` : '', ip: clientIp(req) });
  return json({ ok: true, username: usernameChangedTo || oldUsername });
}
