// Server-side chat helpers: suspension, membership, conversations, presence,
// moderation application. All identity comes from the session — never from the
// client. Teachers have no access here at all (students + admin only).

import { dbReady, type Db, type ChatSuspensionRow } from './db';
import { newId, nowISO } from './crypto';
import { getSettings } from './settings';
import { audit } from './server-utils';
import { findBannedHits, choosePenaltyHit, suspensionRemainingMs, type ChatBannedRule } from './chatModeration';

export const CHAT_ONLINE_AFTER_MS = 90_000;
export const CHAT_MAX_SUSPENSION_MINUTES = 43200; // 30 days

/** Feature gates: master switch + independent student/teacher subdivisions. */
export function chatAccess(): { anyStudent: boolean; teacher: boolean; student: boolean } {
  const s = getSettings();
  const anyStudent = s.chatEnabled && (s.chatStudentChat || s.chatTeacherChat);
  return { anyStudent, teacher: s.chatEnabled && s.chatTeacherChat, student: s.chatEnabled && s.chatStudentChat };
}

export async function conversationKind(conversationId: string): Promise<string | null> {
  const db = await dbReady();
  const r = db.prepare('SELECT kind FROM conversations WHERE id = ?').get(conversationId) as unknown as { kind: string } | undefined;
  return r ? r.kind : null;
}

export interface SuspensionStatus {
  suspended: boolean;
  endsAt: string;
  remainingMs: number;
  reason: string;
}

/** Expire stale suspensions lazily; return the active one if any. */
export async function getActiveSuspension(userId: string): Promise<ChatSuspensionRow | null> {
  const db = await dbReady();
  const now = nowISO();
  try {
    db.prepare('UPDATE chat_suspensions SET active = 0 WHERE userId = ? AND active = 1 AND endsAt <= ?').run(userId, now);
  } catch {}
  const row = db.prepare(
    'SELECT * FROM chat_suspensions WHERE userId = ? AND active = 1 AND endsAt > ? ORDER BY endsAt DESC LIMIT 1'
  ).get(userId, now) as unknown as ChatSuspensionRow | undefined;
  return row ?? null;
}

export function suspensionStatus(row: ChatSuspensionRow | null): SuspensionStatus | null {
  if (!row) return null;
  const remainingMs = suspensionRemainingMs(row.endsAt);
  if (remainingMs <= 0) return null;
  return { suspended: true, endsAt: row.endsAt, remainingMs, reason: row.reason || 'banned-word' };
}

export async function isParticipant(conversationId: string, userId: string): Promise<boolean> {
  const db = await dbReady();
  const r = db.prepare('SELECT 1 AS ok FROM conversation_participants WHERE conversationId = ? AND userId = ?').get(conversationId, userId) as unknown as { ok: number } | undefined;
  return !!r;
}

export async function conversationUserIds(conversationId: string): Promise<string[]> {
  const db = await dbReady();
  const rows = db.prepare('SELECT userId FROM conversation_participants WHERE conversationId = ?').all(conversationId) as unknown as { userId: string }[];
  return rows.map((r) => r.userId);
}

/** Order-independent direct conversation lookup (exactly these 2 members). */
export async function findDirectConversation(a: string, b: string): Promise<string | null> {
  const db = await dbReady();
  const rows = db.prepare(
    `SELECT cp.conversationId AS id FROM conversation_participants cp
     JOIN conversations c ON c.id = cp.conversationId AND c.kind = 'direct'
     WHERE cp.userId IN (?, ?)
     GROUP BY cp.conversationId HAVING COUNT(*) = 2
     AND SUM(CASE WHEN cp.userId NOT IN (?, ?) THEN 1 ELSE 0 END) = 0
     LIMIT 1`
  ).all(a, b, a, b) as unknown as { id: string }[];
  // The HAVING above is redundant for 2-member groups but keeps the intent explicit;
  // verify exact membership (exactly 2 participants, both ours).
  for (const r of rows) {
    const users = await conversationUserIds(r.id);
    if (users.length === 2 && users.includes(a) && users.includes(b)) return r.id;
  }
  return null;
}

export async function createDirectConversation(a: string, b: string): Promise<string> {
  const db = await dbReady();
  const id = newId();
  const now = nowISO();
  db.prepare("INSERT INTO conversations(id, kind, createdAt, updatedAt) VALUES (?, 'direct', ?, ?)").run(id, now, now);
  const ins = db.prepare('INSERT INTO conversation_participants(conversationId, userId, lastReadAt, joinedAt) VALUES (?, ?, ?, ?)');
  ins.run(id, a, now, now);
  ins.run(id, b, '', now);
  return id;
}

export interface ChatOther {
  id: string;
  username: string;
  displayName: string;
  className: string | null;
  isTeacher: boolean;
  hasAvatar: boolean;
}

/** The other side of a 1-1 conversation: a student or (for kind='teacher') a teacher. */
export async function resolveOtherParticipant(conversationId: string, meId: string): Promise<ChatOther | null> {
  const db = await dbReady();
  const other = db.prepare('SELECT userId FROM conversation_participants WHERE conversationId = ? AND userId != ? LIMIT 1').get(conversationId, meId) as unknown as { userId: string } | undefined;
  if (!other) return null;
  const u = db.prepare(
    `SELECT u.id, u.username, u.displayName, c.name AS className,
     CASE WHEN COALESCE(u.avatarFile, '') = '' THEN 0 ELSE 1 END AS hasAvatar
     FROM users u LEFT JOIN classes c ON c.id = u.classId WHERE u.id = ?`
  ).get(other.userId) as unknown as { id: string; username: string; displayName: string; className: string | null; hasAvatar: number } | undefined;
  if (u) return { ...u, hasAvatar: !!u.hasAvatar, isTeacher: false };
  const t = db.prepare(
    `SELECT id, username, displayName,
     CASE WHEN COALESCE(avatarFile, '') = '' THEN 0 ELSE 1 END AS hasAvatar FROM teachers WHERE id = ?`
  ).get(other.userId) as unknown as { id: string; username: string; displayName: string; hasAvatar: number } | undefined;
  if (t) return { ...t, className: null, hasAvatar: !!t.hasAvatar, isTeacher: true };
  return null;
}

/** Teacher side of a student-teacher conversation (kind='teacher', exactly this pair). */
export async function findTeacherConversation(studentId: string, teacherId: string): Promise<string | null> {
  const db = await dbReady();
  const rows = db.prepare(
    `SELECT cp.conversationId AS id FROM conversation_participants cp
     JOIN conversations c ON c.id = cp.conversationId AND c.kind = 'teacher'
     WHERE cp.userId IN (?, ?)
     GROUP BY cp.conversationId HAVING COUNT(*) = 2 LIMIT 1`
  ).all(studentId, teacherId) as unknown as { id: string }[];
  for (const r of rows) {
    const users = await conversationUserIds(r.id);
    if (users.length === 2 && users.includes(studentId) && users.includes(teacherId)) return r.id;
  }
  return null;
}

export async function createTeacherConversation(studentId: string, teacherId: string): Promise<string> {
  const db = await dbReady();
  const id = newId();
  const now = nowISO();
  db.prepare("INSERT INTO conversations(id, kind, createdAt, updatedAt) VALUES (?, 'teacher', ?, ?)").run(id, now, now);
  const ins = db.prepare('INSERT INTO conversation_participants(conversationId, userId, lastReadAt, joinedAt) VALUES (?, ?, ?, ?)');
  ins.run(id, studentId, '', now);
  ins.run(id, teacherId, '', now);
  return id;
}

function teacherRow(db: Db, teacherId: string): { id: string; enabled: number } | undefined {
  return db.prepare('SELECT id, enabled FROM teachers WHERE id = ?').get(teacherId) as unknown as { id: string; enabled: number } | undefined;
}

/**
 * May this student chat with this teacher? Teacher must be enabled and
 * assigned to the student's class (class-scoped school policy).
 */
export async function isTeacherChattingAllowed(studentId: string, teacherId: string): Promise<{ ok: boolean; reason?: string }> {
  const db = await dbReady();
  const t = teacherRow(db, teacherId);
  if (!t || t.enabled !== 1) return { ok: false, reason: 'Teacher not found.' };
  const s = db.prepare('SELECT classId FROM users WHERE id = ? AND enabled = 1').get(studentId) as unknown as { classId: string | null } | undefined;
  if (!s || !s.classId) return { ok: false, reason: 'You are not authorized to chat with this teacher.' };
  const link = db.prepare('SELECT 1 AS ok FROM teacher_classes WHERE teacherId = ? AND classId = ?').get(teacherId, s.classId) as unknown as { ok: number } | undefined;
  if (!link) return { ok: false, reason: 'You are not authorized to chat with this teacher.' };
  return { ok: true };
}

/** May this teacher chat with this student? (mirror rule for teacher-initiated chats) */
export async function isStudentChattingAllowedForTeacher(teacherId: string, studentId: string): Promise<{ ok: boolean; reason?: string }> {
  const db = await dbReady();
  const s = db.prepare('SELECT classId FROM users WHERE id = ? AND enabled = 1').get(studentId) as unknown as { classId: string | null } | undefined;
  if (!s || !s.classId) return { ok: false, reason: 'You are not authorized to chat with this student.' };
  const link = db.prepare('SELECT 1 AS ok FROM teacher_classes WHERE teacherId = ? AND classId = ?').get(teacherId, s.classId) as unknown as { ok: number } | undefined;
  if (!link) return { ok: false, reason: 'You are not authorized to chat with this student.' };
  return { ok: true };
}

/** Only the SENDER's own read marker moves (opening a convo marks it read). */
export async function markConversationRead(conversationId: string, userId: string): Promise<void> {
  const db = await dbReady();
  try {
    db.prepare('UPDATE conversation_participants SET lastReadAt = ? WHERE conversationId = ? AND userId = ?').run(nowISO(), conversationId, userId);
  } catch {}
}

/** Block state between two users (either direction blocks sending both ways). */
export async function chatBlockBetween(me: string, other: string): Promise<{ blocked: boolean; blockedByMe: boolean }> {
  const db = await dbReady();
  try {
    const mine = db.prepare('SELECT 1 AS ok FROM chat_blocks WHERE blockerId = ? AND blockedId = ?').get(me, other) as unknown as { ok: number } | undefined;
    if (mine) return { blocked: true, blockedByMe: true };
    const theirs = db.prepare('SELECT 1 AS ok FROM chat_blocks WHERE blockerId = ? AND blockedId = ?').get(other, me) as unknown as { ok: number } | undefined;
    return { blocked: !!theirs, blockedByMe: false };
  } catch {
    return { blocked: false, blockedByMe: false };
  }
}

/** The single other participant id of a 1-1 conversation (null if not exactly one). */
export async function conversationOtherId(conversationId: string, me: string): Promise<string | null> {
  const db = await dbReady();
  try {
    const rows = db.prepare('SELECT userId FROM conversation_participants WHERE conversationId = ? AND userId != ? LIMIT 2').all(conversationId, me) as unknown as { userId: string }[];
    return rows.length === 1 ? rows[0].userId : null;
  } catch {
    return null;
  }
}

/** Delete-for-me: hide from my list (a new message from the other side unhides). */
export async function hideConversation(conversationId: string, userId: string): Promise<void> {
  const db = await dbReady();
  try {
    db.prepare('UPDATE conversation_participants SET hiddenAt = ? WHERE conversationId = ? AND userId = ?').run(nowISO(), conversationId, userId);
  } catch {}
}

export async function unhideConversation(conversationId: string, userId: string): Promise<void> {
  const db = await dbReady();
  try {
    db.prepare("UPDATE conversation_participants SET hiddenAt = '' WHERE conversationId = ? AND userId = ?").run(conversationId, userId);
  } catch {}
}

/** Total unread visible messages across all my conversations. */
export async function unreadTotalFor(userId: string): Promise<number> {  const db = await dbReady();
  try {
    const r = db.prepare(
      `SELECT COUNT(*) AS c FROM chat_messages m
       JOIN conversation_participants cp ON cp.conversationId = m.conversationId AND cp.userId = ?
       WHERE m.senderId != ? AND m.moderationStatus = 'VISIBLE' AND m.deletedAt IS NULL AND m.createdAt > cp.lastReadAt`
    ).get(userId, userId) as unknown as { c: number };
    return r.c || 0;
  } catch {
    return 0;
  }
}

export async function touchPresence(db: Db, userId: string): Promise<void> {
  try {
    db.prepare('INSERT INTO chat_presence(userId, lastSeenAt) VALUES (?, ?) ON CONFLICT(userId) DO UPDATE SET lastSeenAt = excluded.lastSeenAt').run(userId, nowISO());
  } catch {}
}

export function presenceOf(lastSeenAt: string | null, nowMs = Date.now()): { online: boolean; lastSeenAt: string | null } {
  if (!lastSeenAt) return { online: false, lastSeenAt: null };
  const t = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(t)) return { online: false, lastSeenAt };
  return { online: nowMs - t <= CHAT_ONLINE_AFTER_MS, lastSeenAt };
}

export interface ModerationDecision {
  blocked: boolean;
  ruleId?: string;
  matchedWord?: string;
  minutes?: number;
  suspensionId?: string;
  endsAt?: string;
}

/**
 * Server moderation pipeline (§38): normalize → match enabled rules →
 * longest penalty wins. Blocked attempts persist NO visible message and NO
 * violation text (placeholder row only); a metadata-only event is logged.
 */
export async function applyChatModeration(
  userId: string,
  conversationId: string,
  content: string
): Promise<ModerationDecision> {
  const settings = getSettings();
  if (!settings.chatModeration) return { blocked: false };
  const db = await dbReady();
  const rules = db.prepare("SELECT * FROM chat_banned_words WHERE enabled = 1 ORDER BY suspensionMinutes DESC").all() as unknown as ChatBannedRule[];
  if (rules.length === 0) return { blocked: false };
  const hits = findBannedHits(content, rules);
  if (hits.length === 0) return { blocked: false };
  const best = choosePenaltyHit(hits, settings.chatDefaultSuspensionMinutes);
  if (!best) return { blocked: false };
  const minutes = Math.max(1, Math.floor(Number(best.rule.suspensionMinutes) || settings.chatDefaultSuspensionMinutes || 10));
  const now = nowISO();
  const endsAt = new Date(Date.now() + minutes * 60_000).toISOString();
  const suspensionId = newId();
  db.prepare(
    'INSERT INTO chat_suspensions(id, userId, startsAt, endsAt, reason, ruleId, active, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)'
  ).run(suspensionId, userId, now, endsAt, 'banned-word', best.rule.id, 'auto-moderation', now);
  try {
    db.prepare('UPDATE chat_banned_words SET hitCount = hitCount + 1, updatedAt = ? WHERE id = ?').run(now, best.rule.id);
  } catch {}
  // Placeholder keeps history consistent WITHOUT retaining violation text.
  const msgId = newId();
  db.prepare(
    "INSERT INTO chat_messages(id, conversationId, senderId, kind, content, moderationStatus, clientId, createdAt, updatedAt) VALUES (?, ?, ?, 'text', '', 'BLOCKED', ?, ?, ?)"
  ).run(msgId, conversationId, userId, '', now, now);
  db.prepare(
    "INSERT INTO chat_moderation_events(userId, conversationId, ruleId, matchedWord, action, suspensionId, details, createdAt) VALUES (?, ?, ?, ?, 'blocked+suspended', ?, ?, ?)"
  ).run(userId, conversationId, best.rule.id, best.matchedText.slice(0, 120), suspensionId, `${minutes}m`, now);
  try {
    audit('Chat Message Blocked', { actorType: 'student', actorId: userId, actorName: '', details: `rule=${best.rule.id} minutes=${minutes} conv=${conversationId}`, ip: '' });
  } catch {}
  return { blocked: true, ruleId: best.rule.id, matchedWord: best.matchedText, minutes, suspensionId, endsAt };
}

/** Shape served to students: tombstones for deleted, never blocked content. */
export function serializeChatMessage(
  row: { id: string; conversationId: string; senderId: string; kind: string; content: string; attachmentName: string; attachmentMime: string; attachmentSize: number; attachmentFile: string; moderationStatus: string; clientId: string; createdAt: string; updatedAt: string; deletedAt: string | null },
  me: string
): Record<string, unknown> {
  if (row.deletedAt) {
    return { id: row.id, conversationId: row.conversationId, senderId: row.senderId, mine: row.senderId === me, kind: row.kind, content: '', deleted: true, createdAt: row.createdAt };
  }
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    mine: row.senderId === me,
    kind: row.kind,
    content: row.content,
    attachment: row.kind === 'attachment' && row.attachmentFile ? { name: row.attachmentName, mime: row.attachmentMime, size: row.attachmentSize } : null,
    clientId: row.clientId || undefined,
    createdAt: row.createdAt,
  };
}
