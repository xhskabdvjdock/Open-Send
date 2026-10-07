import fs from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { dbReady, type ChatMessageRow } from '@/lib/db';
import { json, err } from '@/lib/api';
import { getSettings } from '@/lib/settings';
import { rateLimit } from '@/lib/rateLimit';
import { newId, nowISO } from '@/lib/crypto';
import { sanitizeOriginalName, extOf, parseCsvList } from '@/lib/validation';
import { storageSubdir } from '@/lib/paths';
import {
  isParticipant, conversationUserIds, getActiveSuspension, suspensionStatus,
  applyChatModeration, serializeChatMessage, touchPresence, markConversationRead,
  chatAccess, conversationKind, chatBlockBetween, conversationOtherId,
} from '@/lib/chat';
import { sanitizeChatContent } from '@/lib/chatModeration';
import { chatPush } from '@/lib/chatBus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIME_FALLBACK = 'application/octet-stream';
const MAX_FILES_PER_MESSAGE = 5;

// One request may carry up to 5 files; each becomes its own message row
// (caption on the first) so rendering, deletion and idempotency stay uniform.
// Legacy single-file shape ({file, clientId}) is still accepted.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  const settings = getSettings();
  if (!chatAccess().anyStudent) return err('Chat is disabled.', 403);
  if (!settings.chatAttachments) return err('Attachments are disabled.', 403);
  if (!(await isParticipant(params.id, sess.user.id))) return err('Conversation not found.', 404);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return err('Invalid upload.', 400);
  }
  let files = form.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    const single = form.get('file');
    if (single instanceof File) files = [single];
  }
  if (files.length === 0) return err('At least one file is required.', 400);
  if (files.length > MAX_FILES_PER_MESSAGE) return err('Maximum 5 files per message.', 400);
  const rawIds = form.getAll('clientId').map((v) => String(v).slice(0, 64));
  while (rawIds.length < files.length) rawIds.push('');
  const rawCaption = typeof form.get('message') === 'string' ? (form.get('message') as string) : '';

  const db = await dbReady();
  const otherId = await conversationOtherId(params.id, sess.user.id);
  if (otherId) {
    const bl = await chatBlockBetween(sess.user.id, otherId);
    if (bl.blocked) return json({ error: 'CHAT_BLOCKED', blockedByMe: bl.blockedByMe }, 403);
  }
  const acc = chatAccess();
  const kindNow = await conversationKind(params.id);
  if (!((kindNow === 'teacher' && acc.teacher) || (kindNow !== 'teacher' && acc.student))) {
    return err('Chat is disabled.', 403);
  }
  const susp = suspensionStatus(await getActiveSuspension(sess.user.id));
  if (susp) {
    return json({ error: 'CHAT_SUSPENDED', until: susp.endsAt, remainingMs: susp.remainingMs, reason: susp.reason }, 403);
  }

  const rl = rateLimit(`chat:${sess.user.id}`, settings.chatRateMax, settings.chatRateWindowMinutes * 60_000);
  if (!rl.ok) return err('Too many attempts. Please try again later.', 429);

  // Metadata validation for ALL files first (no bytes buffered yet).
  const maxBytes = settings.chatMaxAttachmentMB * 1024 * 1024;
  const allowedExts = parseCsvList(settings.allowedExtensions);
  const blockedExts = parseCsvList(settings.blockedExtensions);
  const metas: { file: File; safeName: string; ext: string; size: number; mime: string }[] = [];
  for (const file of files) {
    const safeName = sanitizeOriginalName(file.name || 'file');
    const ext = extOf(safeName);
    const size = file.size;
    if (!size || size <= 0) return err('The file is empty.', 400);
    if (size > maxBytes) return err(`File "${safeName}" exceeds the ${settings.chatMaxAttachmentMB} MB limit.`, 413);
    if (blockedExts.includes(ext)) return err(`File type ".${ext}" is blocked by the administrator.`, 400);
    if (allowedExts.length > 0 && !allowedExts.includes(ext)) {
      return err(`File type ".${ext || '?'}" is not allowed for this chat.`, 400);
    }
    metas.push({ file, safeName, ext, size, mime: (file.type || MIME_FALLBACK).slice(0, 120) });
  }

  const caption = sanitizeChatContent(rawCaption, settings.chatMaxLength);
  if (caption) {
    const mod = await applyChatModeration(sess.user.id, params.id, caption);
    if (mod.blocked) {
      chatPush([sess.user.id], 'suspended', { until: mod.endsAt, remainingMs: null, reason: 'banned-word', minutes: mod.minutes });
      return json(
        { error: 'CHAT_MESSAGE_BLOCKED', suspension: { until: mod.endsAt, reason: 'banned-word', minutes: mod.minutes } },
        403
      );
    }
  }

  // Write one message per file (idempotent per clientId), all-or-nothing.
  const now = nowISO();
  const written: string[] = [];
  const inserted: string[] = [];
  const out: Record<string, unknown>[] = [];
  let allDeduped = metas.length > 0;
  try {
    fs.mkdirSync(storageSubdir('chat'), { recursive: true });
    const insFile = db.prepare(
      "INSERT INTO chat_messages(id, conversationId, senderId, kind, content, attachmentFile, attachmentName, attachmentMime, attachmentSize, moderationStatus, clientId, createdAt, updatedAt) VALUES (?, ?, ?, 'attachment', ?, ?, ?, ?, ?, 'VISIBLE', ?, ?, ?)"
    );
    for (let i = 0; i < metas.length; i++) {
      const meta = metas[i];
      const cid = rawIds[i] || '';
      if (cid) {
        const dup = db.prepare(
          "SELECT * FROM chat_messages WHERE clientId = ? AND senderId = ? AND conversationId = ? AND moderationStatus = 'VISIBLE'"
        ).get(cid, sess.user.id, params.id) as unknown as ChatMessageRow | undefined;
        if (dup) {
          out.push({ ...serializeChatMessage(dup, sess.user.id), deduped: true });
          continue;
        }
      }
      allDeduped = false;
      const buf = Buffer.from(await meta.file.arrayBuffer());
      if (buf.length === 0) throw new Error(`unreadable:${meta.safeName}`);
      const storedFile = newId();
      const dest = path.join(storageSubdir('chat'), storedFile);
      await writeFile(dest, buf);
      written.push(dest);
      const msgId = newId();
      insFile.run(msgId, params.id, sess.user.id, i === 0 ? caption : '', storedFile, meta.safeName, meta.mime, buf.length, cid, now, now);
      inserted.push(msgId);
      const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(msgId) as unknown as ChatMessageRow;
      out.push(serializeChatMessage(row, sess.user.id));
    }
    db.prepare('UPDATE conversations SET updatedAt = ? WHERE id = ?').run(now, params.id);
  } catch (e) {
    for (const w of written) {
      try {
        await unlink(w);
      } catch {}
    }
    for (const mid of inserted) {
      try {
        db.prepare('DELETE FROM chat_messages WHERE id = ?').run(mid);
      } catch {}
    }
    const msg = e instanceof Error ? e.message : '';
    if (msg.startsWith('unreadable:')) return err(`File "${msg.slice(11)}" could not be read.`, 400);
    return err('Upload failed. Please try again.', 500);
  }
    await markConversationRead(params.id, sess.user.id);  await touchPresence(db, sess.user.id);
  const users = await conversationUserIds(params.id);
  for (const m of out) {
    if ((m as Record<string, unknown>).deduped) continue;
    chatPush(users, 'message', { conversationId: params.id, message: m });
  }
  // {message} kept for older clients; {messages} is the full result.
  return json({ message: out[0] || null, messages: out, deduped: allDeduped }, allDeduped ? 200 : 201);
}
