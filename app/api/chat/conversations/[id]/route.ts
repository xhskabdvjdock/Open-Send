import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { json, err } from '@/lib/api';
import { isParticipant, hideConversation, chatAccess } from '@/lib/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Delete-for-me: hides the conversation from MY list only. Messages stay for
// the other side; a new message from them unhides it again.
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  if (!chatAccess().anyStudent) return err('Chat is disabled.', 403);
  if (!(await isParticipant(params.id, sess.user.id))) return err('Conversation not found.', 404);
  await hideConversation(params.id, sess.user.id);
  return json({ ok: true, deleted: true });
}
