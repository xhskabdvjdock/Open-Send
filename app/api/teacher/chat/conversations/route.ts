import { dbReady } from '@/lib/db';
import { json, err } from '@/lib/api';
import { requireTeacher } from '@/lib/teacherGuard';
import { getSettings } from '@/lib/settings';
import { rateLimit } from '@/lib/rateLimit';
import {
  touchPresence, presenceOf, resolveOtherParticipant,
  findTeacherConversation, createTeacherConversation, isStudentChattingAllowedForTeacher,
  chatBlockBetween, unhideConversation,
} from '@/lib/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function teacherChatOn(): boolean {
  const s = getSettings();
  return s.chatEnabled && s.chatTeacherChat;
}

export async function GET(req: Request) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  if (!teacherChatOn()) return err('Chat is disabled.', 403);
  const me = g.teacher.id;
  const s = getSettings();
  const db = await dbReady();
  await touchPresence(db, me);
  const parts = db.prepare(
    `SELECT cp.conversationId AS id, cp.lastReadAt AS lastReadAt, c.updatedAt AS updatedAt
     FROM conversation_participants cp JOIN conversations c ON c.id = cp.conversationId
     WHERE cp.userId = ? AND c.kind = 'teacher' AND (cp.hiddenAt = '' OR c.updatedAt > cp.hiddenAt) ORDER BY c.updatedAt DESC LIMIT 100`
  ).all(me) as unknown as { id: string; lastReadAt: string; updatedAt: string }[];
  const items: Record<string, unknown>[] = [];
  for (const p of parts) {
    const other = await resolveOtherParticipant(p.id, me);
    const last = db.prepare(
      `SELECT id, content, createdAt, senderId, kind, attachmentName FROM chat_messages
       WHERE conversationId = ? AND moderationStatus = 'VISIBLE' AND deletedAt IS NULL
       ORDER BY createdAt DESC, rowid DESC LIMIT 1`
    ).get(p.id) as unknown as { id: string; content: string; createdAt: string; senderId: string; kind: string; attachmentName: string } | undefined;
    const unread = (db.prepare(
      `SELECT COUNT(*) AS c FROM chat_messages
       WHERE conversationId = ? AND senderId != ? AND moderationStatus = 'VISIBLE' AND deletedAt IS NULL AND createdAt > ?`
    ).get(p.id, me, p.lastReadAt || '') as unknown as { c: number }).c || 0;
    let online = false;
    let lastSeenAt: string | null = null;
    if (other) {
      const pr = db.prepare('SELECT lastSeenAt FROM chat_presence WHERE userId = ?').get(other.id) as unknown as { lastSeenAt: string } | undefined;
      const pres = presenceOf(pr?.lastSeenAt || null);
      online = s.chatShowOnline ? pres.online : false;
      lastSeenAt = s.chatShowLastSeen ? pres.lastSeenAt : null;
    }
    items.push({
      id: p.id,
      updatedAt: p.updatedAt,
      other,
      lastMessage: last
        ? { content: (last.content || (last.kind === 'attachment' ? last.attachmentName : '') || '').slice(0, 120), createdAt: last.createdAt, mine: last.senderId === me }
        : null,
      unread,
      online,
      lastSeenAt,
    });
  }
  return json({ conversations: items });
}

export async function POST(req: Request) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  if (!teacherChatOn()) return err('Chat is disabled.', 403);
  const rl = rateLimit(`chat-create:${g.teacher.id}`, 20, 3600_000);
  if (!rl.ok) return err('Too many attempts. Please try again later.', 429);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const targetId = String(body.userId || '').trim();
  if (!targetId) return err('Student is required.', 400);
  if (targetId === g.teacher.id) return err('You cannot chat with yourself.', 400);
  const scope = await isStudentChattingAllowedForTeacher(g.teacher.id, targetId);
  if (!scope.ok) return err(scope.reason || 'You are not authorized to chat with this student.', 403);
  const preT = await chatBlockBetween(g.teacher.id, targetId);
  if (preT.blocked) return json({ error: 'CHAT_BLOCKED', blockedByMe: preT.blockedByMe }, 403);
  const db = await dbReady();
  const existing = await findTeacherConversation(targetId, g.teacher.id);
  await touchPresence(db, g.teacher.id);
  if (existing) {
    await unhideConversation(existing, g.teacher.id);
    return json({ conversationId: existing, created: false });
  }
  const id = await createTeacherConversation(targetId, g.teacher.id);
  return json({ conversationId: id, created: true }, 201);
}
