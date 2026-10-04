import { dbReady } from '@/lib/db';
import { json, err, clientIp } from '@/lib/api';
import { requireTeacher } from '@/lib/teacherGuard';
import { audit } from '@/lib/server-utils';
import { sanitizeDisplayName } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  let body: { displayName?: string };
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const name = sanitizeDisplayName(body.displayName || '');
  if (!name || name.length < 2) return err('Display name is required (min 2 characters).', 400);
  const db = await dbReady();
  db.prepare('UPDATE teachers SET displayName = ? WHERE id = ?').run(name, g.teacher.id);
  audit('Teacher Updated Profile', { actorType: 'teacher', actorId: g.teacher.id, actorName: g.teacher.username, details: `name=${name}`, ip: clientIp(req) });
  return json({ ok: true, displayName: name });
}
