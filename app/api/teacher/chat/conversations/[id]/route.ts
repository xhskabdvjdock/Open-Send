import { json, err } from '@/lib/api';
import { requireTeacher } from '@/lib/teacherGuard';
import { getSettings } from '@/lib/settings';
import { isParticipant, hideConversation } from '@/lib/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Delete-for-me (teacher side): hides from my list only; the student's
// history is untouched, and a new message from them unhides it again.
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  const s = getSettings();
  if (!s.chatEnabled || !s.chatTeacherChat) return err('Chat is disabled.', 403);
  if (!(await isParticipant(params.id, g.teacher.id))) return err('Conversation not found.', 404);
  await hideConversation(params.id, g.teacher.id);
  return json({ ok: true, deleted: true });
}
