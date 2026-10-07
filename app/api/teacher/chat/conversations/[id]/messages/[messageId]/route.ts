import { dbReady } from '@/lib/db';
import { json, err } from '@/lib/api';
import { requireTeacher } from '@/lib/teacherGuard';
import { getSettings } from '@/lib/settings';
import { isParticipant, conversationUserIds } from '@/lib/chat';
import { nowISO } from '@/lib/crypto';
import { chatPush } from '@/lib/chatBus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(req: Request, { params }: { params: { id: string; messageId: string } }) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  const s = getSettings();
  if (!s.chatEnabled || !s.chatTeacherChat) return err('Chat is disabled.', 403);
  if (!(await isParticipant(params.id, g.teacher.id))) return err('Conversation not found.', 404);
  const db = await dbReady();
  const m = db.prepare(
    "SELECT * FROM chat_messages WHERE id = ? AND conversationId = ? AND moderationStatus = 'VISIBLE' AND deletedAt IS NULL"
  ).get(params.messageId, params.id) as unknown as { id: string; senderId: string } | undefined;
  if (!m) return err('Message not found.', 404);
  if (m.senderId !== g.teacher.id) return err('You can only delete your own messages.', 403);
  db.prepare('UPDATE chat_messages SET deletedAt = ?, updatedAt = ? WHERE id = ?').run(nowISO(), nowISO(), m.id);
  const users = await conversationUserIds(params.id);
  chatPush(users, 'message-deleted', { conversationId: params.id, messageId: m.id });
  return json({ ok: true, deleted: true });
}
