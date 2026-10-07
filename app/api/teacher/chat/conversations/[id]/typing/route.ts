import { json, err } from '@/lib/api';
import { requireTeacher } from '@/lib/teacherGuard';
import { getSettings } from '@/lib/settings';
import { isParticipant, conversationUserIds, chatBlockBetween, conversationOtherId } from '@/lib/chat';
import { chatPush } from '@/lib/chatBus';
import { rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  const s = getSettings();
  if (!s.chatEnabled || !s.chatTeacherChat) return err('Chat is disabled.', 403);
  if (!(await isParticipant(params.id, g.teacher.id))) return err('Conversation not found.', 404);
  const otherId = await conversationOtherId(params.id, g.teacher.id);
  if (otherId) {
    const bl = await chatBlockBetween(g.teacher.id, otherId);
    if (bl.blocked) return json({ error: 'CHAT_BLOCKED', blockedByMe: bl.blockedByMe }, 403);
  }
  const rl = rateLimit(`chat-typing:${g.teacher.id}`, 120, 60_000);
  if (!rl.ok) return err('Too many attempts. Please try again later.', 429);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const users = (await conversationUserIds(params.id)).filter((u) => u !== g.teacher.id);
  chatPush(users, 'typing', {
    conversationId: params.id,
    userId: g.teacher.id,
    displayName: g.teacher.displayName,
    typing: body.typing !== false,
  });
  return json({ ok: true });
}
