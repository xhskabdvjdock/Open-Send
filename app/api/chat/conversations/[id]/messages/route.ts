import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { dbReady, type ChatMessageRow } from '@/lib/db';
import { json, err } from '@/lib/api';
import { getSettings } from '@/lib/settings';
import { rateLimit } from '@/lib/rateLimit';
import { newId, nowISO } from '@/lib/crypto';
import {
  isParticipant, conversationUserIds, getActiveSuspension, suspensionStatus,
  applyChatModeration, serializeChatMessage, touchPresence, markConversationRead,
  chatAccess, conversationKind, chatBlockBetween, conversationOtherId,
} from '@/lib/chat';
import { sanitizeChatContent } from '@/lib/chatModeration';
import { chatPush } from '@/lib/chatBus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_DEFAULT = 30;
const PAGE_MAX = 100;

function chatOpen(): { ok: boolean; status?: number; message?: string } {
  if (!chatAccess().anyStudent) return { ok: false, status: 403, message: 'Chat is disabled.' };
  return { ok: true };
}

/** Sending requires the subdivision matching the conversation kind. */
function canSendToKind(kind: string | null): boolean {
  const acc = chatAccess();
  if (kind === 'teacher') return acc.teacher;
  return acc.student;
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  const gate = chatOpen();
  if (!gate.ok) return err(gate.message || 'Chat is disabled.', gate.status || 403);
  if (!(await isParticipant(params.id, sess.user.id))) return err('Conversation not found.', 404);
  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(PAGE_MAX, Number(url.searchParams.get('limit') || PAGE_DEFAULT) || PAGE_DEFAULT));
  const beforeId = (url.searchParams.get('before') || '').trim();
  const db = await dbReady();
  await touchPresence(db, sess.user.id);
  let cursorClause = '';
  let cursorParams: (string | number)[] = [];
  if (beforeId) {
    const cur = db.prepare('SELECT createdAt, rowid AS rid FROM chat_messages WHERE id = ? AND conversationId = ?').get(beforeId, params.id) as unknown as { createdAt: string; rid: number } | undefined;
    if (cur) {
      cursorClause = 'AND (createdAt < ? OR (createdAt = ? AND rowid < ?))';
      cursorParams = [cur.createdAt, cur.createdAt, cur.rid];
    }
  }
  const rows = db.prepare(
    `SELECT *, rowid AS rid FROM chat_messages
     WHERE conversationId = ? AND moderationStatus = 'VISIBLE' ${cursorClause}
     ORDER BY createdAt DESC, rowid DESC LIMIT ?`
  ).all(params.id, ...cursorParams, limit) as unknown as (ChatMessageRow & { rid: number })[];
  const messages = rows.reverse().map((r) => serializeChatMessage(r, sess.user.id));
  return json({ messages, hasMore: rows.length >= limit });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  const settings = getSettings();
  if (!chatAccess().anyStudent) return err('Chat is disabled.', 403);
  if (!(await isParticipant(params.id, sess.user.id))) return err('Conversation not found.', 404);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const clientId = String(body.clientId || '').slice(0, 64);
  const rawContent = typeof body.content === 'string' ? body.content : '';

  const db = await dbReady();
  const otherId = await conversationOtherId(params.id, sess.user.id);
  if (otherId) {
    const bl = await chatBlockBetween(sess.user.id, otherId);
    if (bl.blocked) return json({ error: 'CHAT_BLOCKED', blockedByMe: bl.blockedByMe }, 403);
  }
  // Sending requires the subdivision matching this conversation's kind, so
  // student-to-teacher keeps working when student-to-student is off.
  if (!canSendToKind(await conversationKind(params.id))) return err('Chat is disabled.', 403);
  // Idempotency: retry of an already-saved message returns it (no duplicates).
  if (clientId) {
    const dup = db.prepare(
      "SELECT * FROM chat_messages WHERE clientId = ? AND senderId = ? AND conversationId = ? AND moderationStatus = 'VISIBLE'"
    ).get(clientId, sess.user.id, params.id) as unknown as ChatMessageRow | undefined;
    if (dup) return json({ message: serializeChatMessage(dup, sess.user.id), deduped: true });
  }

  // Suspension is re-checked on EVERY send (stale tabs cannot bypass it).
  const susp = suspensionStatus(await getActiveSuspension(sess.user.id));
  if (susp) {
    return json({ error: 'CHAT_SUSPENDED', until: susp.endsAt, remainingMs: susp.remainingMs, reason: susp.reason }, 403);
  }

  const rl = rateLimit(`chat:${sess.user.id}`, settings.chatRateMax, settings.chatRateWindowMinutes * 60_000);
  if (!rl.ok) return err('Too many attempts. Please try again later.', 429);

  const content = sanitizeChatContent(rawContent, settings.chatMaxLength);
  if (!content) return err('Message cannot be empty.', 400);
  if (rawContent.trim().length > settings.chatMaxLength) return err('Message is too long.', 400);

  // Moderation BEFORE save and BEFORE any broadcast.
  const mod = await applyChatModeration(sess.user.id, params.id, content);
  if (mod.blocked) {
    chatPush([sess.user.id], 'suspended', { until: mod.endsAt, remainingMs: null, reason: 'banned-word', minutes: mod.minutes });
    return json(
      { error: 'CHAT_MESSAGE_BLOCKED', suspension: { until: mod.endsAt, reason: 'banned-word', minutes: mod.minutes } },
      403
    );
  }

  const now = nowISO();
  const id = newId();
  db.prepare(
    "INSERT INTO chat_messages(id, conversationId, senderId, kind, content, moderationStatus, clientId, createdAt, updatedAt) VALUES (?, ?, ?, 'text', ?, 'VISIBLE', ?, ?, ?)"
  ).run(id, params.id, sess.user.id, content, clientId, now, now);
  db.prepare('UPDATE conversations SET updatedAt = ? WHERE id = ?').run(now, params.id);
  await markConversationRead(params.id, sess.user.id);
  await touchPresence(db, sess.user.id);
  const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id) as unknown as ChatMessageRow;
  const message = serializeChatMessage(row, sess.user.id);
  const users = await conversationUserIds(params.id);
  chatPush(users, 'message', { conversationId: params.id, message });
  return json({ message }, 201);
}
