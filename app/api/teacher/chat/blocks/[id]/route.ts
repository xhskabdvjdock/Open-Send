import { dbReady } from '@/lib/db';
import { json, err } from '@/lib/api';
import { requireTeacher } from '@/lib/teacherGuard';
import { getSettings } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  const s = getSettings();
  if (!s.chatEnabled || !s.chatTeacherChat) return err('Chat is disabled.', 403);
  const db = await dbReady();
  db.prepare('DELETE FROM chat_blocks WHERE blockerId = ? AND blockedId = ?').run(g.teacher.id, params.id);
  return json({ ok: true });
}
