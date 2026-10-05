import fs from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { dbReady } from '@/lib/db';
import { newId, nowISO } from '@/lib/crypto';
import { getSettings } from '@/lib/settings';
import { json, err, clientIp } from '@/lib/api';
import { audit, notify } from '@/lib/server-utils';
import { canSendTo, computeExpiryIso } from '@/lib/transfers';
import { sanitizeOriginalName, extOf, parseCsvList } from '@/lib/validation';
import { storageSubdir } from '@/lib/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIME_FALLBACK = 'application/octet-stream';

export async function POST(req: Request) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);

  const settings = getSettings();
  if (settings.maintenanceMode) return err('Open Send is temporarily unavailable.', 503);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return err('Invalid upload.', 400);
  }

  const recipientId = String(form.get('recipientId') || '').trim();
  const message = String(form.get('message') || '').slice(0, 500);
  const files = form.getAll('files').filter((f): f is File => f instanceof File);

  if (!recipientId) return err('Recipient is required.', 400);
  if (recipientId === sess.user.id) return err('You cannot send files to yourself.', 400);
  if (files.length === 0) return err('At least one file is required.', 400);
  if (files.length > settings.maxFilesPerTransfer) {
    return err(`Maximum ${settings.maxFilesPerTransfer} files per transfer.`, 400);
  }

  const db = await dbReady();
  const recipient = db.prepare(
    'SELECT u.*, c.name AS className FROM users u LEFT JOIN classes c ON c.id = u.classId WHERE u.id = ?'
  ).get(recipientId) as unknown as {
    id: string; username: string; displayName: string; classId: string | null; enabled: number;
  } | undefined;
  if (!recipient || recipient.enabled !== 1) return err('Recipient not found.', 404);

  const allowed = canSendTo(sess.user.classId, recipient.classId);
  if (!allowed.ok) return err(allowed.reason || 'Sending is not allowed.', 403);

  const maxBytes = settings.maxFileSizeMB * 1024 * 1024;
  const allowedExts = parseCsvList(settings.allowedExtensions);
  const blockedExts = parseCsvList(settings.blockedExtensions);

  // Gross-size guard BEFORE buffering: reject absurd bodies without loading
  // gigabytes into memory first (per-file checks below stay authoritative).
  const contentLength = Number(req.headers.get('content-length') || 0);
  const grossCap = settings.maxFilesPerTransfer * maxBytes + 32 * 1024 * 1024;
  if (Number.isFinite(contentLength) && contentLength > 0 && contentLength > grossCap) {
    return err(`Upload exceeds the total size limit.`, 413);
  }

  // Validate metadata of all files first (no bytes buffered yet).
  const prepared: { file: File; safeName: string; ext: string; size: number; mime: string }[] = [];
  let total = 0;
  for (const f of files) {
    const safeName = sanitizeOriginalName((f as File).name || 'file');
    const ext = extOf(safeName);
    const size = (f as File).size;
    if (!size || size <= 0) return err(`File "${safeName}" is empty.`, 400);
    if (size > maxBytes) return err(`File "${safeName}" exceeds the ${settings.maxFileSizeMB} MB limit.`, 413);
    if (blockedExts.includes(ext)) return err(`File type ".${ext}" is blocked by the administrator.`, 400);
    if (allowedExts.length > 0 && !allowedExts.includes(ext)) {
      return err(`File type ".${ext || '?'}" is not allowed.`, 400);
    }
    total += size;
    prepared.push({ file: f as File, safeName, ext, size, mime: (f as File).type || MIME_FALLBACK });
  }

  // Persist: transfer row + files on disk (pending bucket) atomically-ish.
  const transferId = newId();
  const now = nowISO();
  const expiresAt = computeExpiryIso();
  const written: string[] = [];
  try {
    fs.mkdirSync(storageSubdir('pending'), { recursive: true });
    db.prepare(
      'INSERT INTO transfers(id, senderId, recipientId, message, status, expiresAt, downloadCount, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)'
    ).run(transferId, sess.user.id, recipientId, message, 'PENDING', expiresAt, now, now);

    const insFile = db.prepare(
      'INSERT INTO transfer_files(id, transferId, storedFile, originalName, mime, size, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    // Stream through files ONE AT A TIME (read → write → release) so peak
    // memory is one file, not the whole batch — and use async writes so a big
    // file never blocks the event loop for other students.
    for (const p of prepared) {
      const buf = Buffer.from(await p.file.arrayBuffer());
      if (buf.length === 0) {
        throw new Error(`unreadable:${p.safeName}`);
      }
      const storedFile = newId();
      const dest = path.join(storageSubdir('pending'), storedFile);
      await writeFile(dest, buf);
      written.push(dest);
      insFile.run(newId(), transferId, storedFile, p.safeName, p.mime.slice(0, 120), buf.length, now);
    }
  } catch (e) {
    for (const w of written) {
      try { fs.unlinkSync(w); } catch {}
    }
    try { db.prepare('DELETE FROM transfers WHERE id = ?').run(transferId); } catch {}
    const msg = e instanceof Error ? e.message : '';
    if (msg.startsWith('unreadable:')) return err(`File "${msg.slice(11)}" could not be read.`, 400);
    return err('Upload failed. Please try again.', 500);
  }

  notify(recipientId, 'incoming', `You received ${prepared.length} file${prepared.length > 1 ? 's' : ''} from ${sess.user.displayName}.`, message, transferId);
  audit('File Uploaded', {
    actorType: 'student', actorId: sess.user.id, actorName: sess.user.username,
    details: `to=${recipient.username} files=${prepared.length} bytes=${total} transfer=${transferId}`, ip: clientIp(req),
  });

  return json({ ok: true, transferId, fileCount: prepared.length, totalBytes: total, expiresAt }, 201);
}
