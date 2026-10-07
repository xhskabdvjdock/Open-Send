import { dbReady, type ChatMessageRow } from '@/lib/db';
import { json, err } from '@/lib/api';
import { requireTeacher } from '@/lib/teacherGuard';
import { getSettings } from '@/lib/settings';
import { rateLimit } from '@/lib/rateLimit';
import { newId, nowISO } from '@/lib/crypto';
import {
  isParticipant, conversationUserIds, serializeChatMessage, touchPresence, markConversationRead,
  chatBlockBetween, conversationOtherId,
} from '@/lib/chat';
import { sanitizeChatContent } from '@/lib/chatModeration';
import { chatPush } from '@/lib/chatBus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_DEFAULT = 30;
const PAGE_MAX = 100;

function teacherChatOn(): boolean {
  const s = getSettings();
  return s.chatEnabled && s.chatTeacherChat;
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  if (!teacherChatOn()) return err('Chat is disabled.', 403);
  if (!(await isParticipant(params.id, g.teacher.id))) return err('Conversation not found.', 404);
  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(PAGE_MAX, Number(url.searchParams.get('limit') || PAGE_DEFAULT) || PAGE_DEFAULT));
  const beforeId = (url.searchParams.get('before') || '').trim();
  const db = await dbReady();
  await touchPresence(db, g.teacher.id);
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
  return json({ messages: rows.reverse().map((r) => serializeChatMessage(r, g.teacher.id)), hasMore: rows.length >= limit });
}

// Teachers are staff: no word-moderation and no suspensions apply to them.
// Auth, membership, validation, rate limiting and idempotency match students.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  if (!teacherChatOn()) return err('Chat is disabled.', 403);
  if (!(await isParticipant(params.id, g.teacher.id))) return err('Conversation not found.', 404);
  const settings = getSettings();
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const clientId = String(body.clientId || '').slice(0, 64);
  const rawContent = typeof body.content === 'string' ? body.content : '';
  const db = await dbReady();
  const otherId = await conversationOtherId(params.id, g.teacher.id);
  if (otherId) {
    const bl = await chatBlockBetween(g.teacher.id, otherId);
    if (bl.blocked) return json({ error: 'CHAT_BLOCKED', blockedByMe: bl.blockedByMe }, 403);
  }
  if (clientId) {
    const dup = db.prepare(
      "SELECT * FROM chat_messages WHERE clientId = ? AND senderId = ? AND conversationId = ? AND moderationStatus = 'VISIBLE'"
    ).get(clientId, g.teacher.id, params.id) as unknown as ChatMessageRow | undefined;
    if (dup) return json({ message: serializeChatMessage(dup, g.teacher.id), deduped: true });
  }
  const rl = rateLimit(`chat:${g.teacher.id}`, settings.chatRateMax, settings.chatRateWindowMinutes * 60_000);
  if (!rl.ok) return err('Too many attempts. Please try again later.', 429);
  const content = sanitizeChatContent(rawContent, settings.chatMaxLength);
  if (!content) return err('Message cannot be empty.', 400);
  if (rawContent.trim().length > settings.chatMaxLength) return err('Message is too long.', 400);
  const now = nowISO();
  const id = newId();
  db.prepare(
    "INSERT INTO chat_messages(id, conversationId, senderId, kind, content, moderationStatus, clientId, createdAt, updatedAt) VALUES (?, ?, ?, 'text', ?, 'VISIBLE', ?, ?, ?)"
  ).run(id, params.id, g.teacher.id, content, clientId, now, now);
  db.prepare('UPDATE conversations SET updatedAt = ? WHERE id = ?').run(now, params.id);
  await markConversationRead(params.id, g.teacher.id);
  await touchPresence(db, g.teacher.id);
  const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id) as unknown as ChatMessageRow;
  const message = serializeChatMessage(row, g.teacher.id);
  const users = await conversationUserIds(params.id);
  chatPush(users, 'message', { conversationId: params.id, message });
  return json({ message }, 201);
}
