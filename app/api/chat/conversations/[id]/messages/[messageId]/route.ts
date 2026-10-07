import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { dbReady } from '@/lib/db';
import { json, err } from '@/lib/api';
import { isParticipant, conversationUserIds, chatAccess, conversationKind } from '@/lib/chat';
import { nowISO } from '@/lib/crypto';
import { chatPush } from '@/lib/chatBus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Soft delete: only the sender's own visible message. Content stays in the DB
// for audit but is never served again (tombstone instead).
export async function DELETE(req: Request, { params }: { params: { id: string; messageId: string } }) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  if (!chatAccess().anyStudent) return err('Chat is disabled.', 403);
  if (!(await isParticipant(params.id, sess.user.id))) return err('Conversation not found.', 404);
  const acc = chatAccess();
  const kindNow = await conversationKind(params.id);
  if (!((kindNow === 'teacher' && acc.teacher) || (kindNow !== 'teacher' && acc.student))) {
    return err('Chat is disabled.', 403);
  }
  const db = await dbReady();
  const m = db.prepare(
    "SELECT * FROM chat_messages WHERE id = ? AND conversationId = ? AND moderationStatus = 'VISIBLE' AND deletedAt IS NULL"
  ).get(params.messageId, params.id) as unknown as { id: string; senderId: string } | undefined;
  if (!m) return err('Message not found.', 404);
  if (m.senderId !== sess.user.id) return err('You can only delete your own messages.', 403);
  db.prepare('UPDATE chat_messages SET deletedAt = ?, updatedAt = ? WHERE id = ?').run(nowISO(), nowISO(), m.id);
  const users = await conversationUserIds(params.id);
  chatPush(users, 'message-deleted', { conversationId: params.id, messageId: m.id });
  return json({ ok: true, deleted: true });
}
