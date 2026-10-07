import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { json, err } from '@/lib/api';
import { isParticipant, markConversationRead, unreadTotalFor, chatAccess, unhideConversation } from '@/lib/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Opening a conversation marks its messages read (drives unread counts).
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  if (!chatAccess().anyStudent) return err('Chat is disabled.', 403);
  if (!(await isParticipant(params.id, sess.user.id))) return err('Conversation not found.', 404);
  await unhideConversation(params.id, sess.user.id);
  await markConversationRead(params.id, sess.user.id);
  return json({ ok: true, unreadTotal: await unreadTotalFor(sess.user.id) });
}
