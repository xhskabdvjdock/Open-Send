import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { dbReady } from '@/lib/db';
import { json, err } from '@/lib/api';
import { getSettings } from '@/lib/settings';
import { rateLimit } from '@/lib/rateLimit';
import { canSendTo } from '@/lib/transfers';
import {
  findDirectConversation, createDirectConversation, touchPresence, presenceOf,
  findTeacherConversation, createTeacherConversation, isTeacherChattingAllowed, resolveOtherParticipant,
  chatAccess, chatBlockBetween, unhideConversation,
} from '@/lib/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function sessionOf(req: Request) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  return getStudentFromToken(token);
}

function chatOpen(): { ok: boolean; status?: number; message?: string } {
  const acc = chatAccess();
  if (!acc.anyStudent) return { ok: false, status: 403, message: 'Chat is disabled.' };
  return { ok: true };
}

export async function GET(req: Request) {
  const sess = await sessionOf(req);
  if (!sess) return err('Unauthorized', 401);
  const gate = chatOpen();
  if (!gate.ok) return err(gate.message || 'Chat is disabled.', gate.status || 403);
  const s = getSettings();
  const db = await dbReady();
  await touchPresence(db, sess.user.id);
  const parts = db.prepare(
    `SELECT cp.conversationId AS id, cp.lastReadAt AS lastReadAt, c.updatedAt AS updatedAt
     FROM conversation_participants cp JOIN conversations c ON c.id = cp.conversationId
     WHERE cp.userId = ? AND (cp.hiddenAt = '' OR c.updatedAt > cp.hiddenAt) ORDER BY c.updatedAt DESC LIMIT 100`
  ).all(sess.user.id) as unknown as { id: string; lastReadAt: string; updatedAt: string }[];
  const items: Record<string, unknown>[] = [];
  for (const p of parts) {
    const other = await resolveOtherParticipant(p.id, sess.user.id);
    const last = db.prepare(
      `SELECT id, content, createdAt, senderId, kind, attachmentName FROM chat_messages
       WHERE conversationId = ? AND moderationStatus = 'VISIBLE' AND deletedAt IS NULL
       ORDER BY createdAt DESC, rowid DESC LIMIT 1`
    ).get(p.id) as unknown as { id: string; content: string; createdAt: string; senderId: string; kind: string; attachmentName: string } | undefined;
    const unread = (db.prepare(
      `SELECT COUNT(*) AS c FROM chat_messages
       WHERE conversationId = ? AND senderId != ? AND moderationStatus = 'VISIBLE' AND deletedAt IS NULL AND createdAt > ?`
    ).get(p.id, sess.user.id, p.lastReadAt || '') as unknown as { c: number }).c || 0;
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
      lastMessage: last ? { content: (last.content || (last.kind === 'attachment' ? last.attachmentName : '') || '').slice(0, 120), createdAt: last.createdAt, mine: last.senderId === sess.user.id } : null,
      unread,
      online,
      lastSeenAt,
    });
  }
  return json({ conversations: items });
}

export async function POST(req: Request) {
  const sess = await sessionOf(req);
  if (!sess) return err('Unauthorized', 401);
  // No blanket gate here: teacher targets have their own switch below, so
  // student-to-teacher keeps working even when student-to-student is off.
  const rl = rateLimit(`chat-create:${sess.user.id}`, 20, 3600_000);
  if (!rl.ok) return err('Too many attempts. Please try again later.', 429);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const targetId = String(body.userId || '').trim();
  if (!targetId) return err('Student is required.', 400);
  if (targetId === sess.user.id) return err('You cannot chat with yourself.', 400);
  const db = await dbReady();
  const settings = getSettings();
  // Teacher target? Separate switch (works even when student-to-student is off).
  const teacherRow = db.prepare('SELECT id, enabled FROM teachers WHERE id = ?').get(targetId) as unknown as { id: string; enabled: number } | undefined;
  if (teacherRow) {
    if (!settings.chatEnabled || !settings.chatTeacherChat) return err('Chat is disabled.', 403);
    const scope = await isTeacherChattingAllowed(sess.user.id, targetId);
    if (!scope.ok) return err(scope.reason || 'You are not authorized to chat with this teacher.', 403);
    const preT = await chatBlockBetween(sess.user.id, targetId);
    if (preT.blocked) return json({ error: 'CHAT_BLOCKED', blockedByMe: preT.blockedByMe }, 403);
    const existingT = await findTeacherConversation(sess.user.id, targetId);
    await touchPresence(db, sess.user.id);
    if (existingT) {
      await unhideConversation(existingT, sess.user.id);
      return json({ conversationId: existingT, created: false });
    }
    const tid = await createTeacherConversation(sess.user.id, targetId);
    return json({ conversationId: tid, created: true }, 201);
  }
  if (!settings.chatEnabled || !settings.chatStudentChat) return err('Chat is disabled.', 403);
  const target = db.prepare('SELECT id, username, displayName, classId, enabled FROM users WHERE id = ?').get(targetId) as unknown as {
    id: string; username: string; displayName: string; classId: string | null; enabled: number;
  } | undefined;
  if (!target || target.enabled !== 1) return err('Student not found.', 404);
  const scope = canSendTo(sess.user.classId, target.classId);
  if (!scope.ok) return err(scope.reason || 'You cannot chat with this student.', 403);
  const preS = await chatBlockBetween(sess.user.id, targetId);
  if (preS.blocked) return json({ error: 'CHAT_BLOCKED', blockedByMe: preS.blockedByMe }, 403);
  const existing = await findDirectConversation(sess.user.id, targetId);
  await touchPresence(db, sess.user.id);
  if (existing) {
    await unhideConversation(existing, sess.user.id);
    return json({ conversationId: existing, created: false });
  }
  const id = await createDirectConversation(sess.user.id, targetId);
  return json({ conversationId: id, created: true }, 201);
}
