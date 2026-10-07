import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { json, err } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';
import { isParticipant, conversationUserIds, getActiveSuspension, suspensionStatus, chatAccess, chatBlockBetween, conversationOtherId } from '@/lib/chat';
import { chatPush } from '@/lib/chatBus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Ephemeral typing indicator relay (never stored in the DB).
// Throttled client-side (~3s); recipients auto-expire it after ~5s.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  if (!chatAccess().anyStudent) return err('Chat is disabled.', 403);
  if (!(await isParticipant(params.id, sess.user.id))) return err('Conversation not found.', 404);
  const otherId = await conversationOtherId(params.id, sess.user.id);
  if (otherId) {
    const bl = await chatBlockBetween(sess.user.id, otherId);
    if (bl.blocked) return json({ error: 'CHAT_BLOCKED', blockedByMe: bl.blockedByMe }, 403);
  }
  const susp = suspensionStatus(await getActiveSuspension(sess.user.id));
  if (susp) {
    return json({ error: 'CHAT_SUSPENDED', until: susp.endsAt, remainingMs: susp.remainingMs, reason: susp.reason }, 403);
  }
  // Lenient dedicated bucket (contentless in-memory fan-out only): frequent
  // refresh pings (~0.8s) keep the 1s recipient expiry smooth, never eating
  // the message rate limit.
  const rl = rateLimit(`chat-typing:${sess.user.id}`, 120, 60_000);
  if (!rl.ok) return err('Too many attempts. Please try again later.', 429);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const typing = body.typing !== false;
  const users = (await conversationUserIds(params.id)).filter((u) => u !== sess.user.id);
  chatPush(users, 'typing', {
    conversationId: params.id,
    userId: sess.user.id,
    displayName: sess.user.displayName,
    typing,
  });
  return json({ ok: true });
}
