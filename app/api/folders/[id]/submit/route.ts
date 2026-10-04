import fs from 'node:fs';
import path from 'node:path';
import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { dbReady } from '@/lib/db';
import { newId, nowISO } from '@/lib/crypto';
import { getSettings } from '@/lib/settings';
import { json, err, clientIp } from '@/lib/api';
import { audit, notify } from '@/lib/server-utils';
import { sanitizeOriginalName, extOf, parseCsvList } from '@/lib/validation';
import { storageSubdir } from '@/lib/paths';
import { getSubmissionFolder, isFolderOpenForSubmit, isLateNow, notifyTeacher } from '@/lib/folders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIME_FALLBACK = 'application/octet-stream';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  const settings = getSettings();
  if (settings.maintenanceMode) return err('Open Send is temporarily unavailable.', 503);

  const folder = getSubmissionFolder(params.id);
  if (!folder) return err('Folder not found.', 404);
  if (folder.status === 'archived') return err('Folder not found.', 404);
  // Must belong to allowed class
  if (!sess.user.classId || !folder.classIds.includes(sess.user.classId)) {
    audit('Unauthorized Folder Access', { actorType: 'student', actorId: sess.user.id, actorName: sess.user.username, details: `folder=${params.id}`, ip: clientIp(req) });
    return err('You are not authorized.', 403);
  }
  const open = isFolderOpenForSubmit(folder as never);
  if (!open.ok) return err(open.reason, 403);
  const late = isLateNow(folder.deadline);
  if (late && folder.allowLate !== 1) return err('Submission closed. The deadline has passed.', 403);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return err('Invalid upload.', 400);
  }
  const message = String(form.get('message') || '').slice(0, 1000);
  if (folder.requireMessage === 1 && !message.trim()) return err('A message is required for this folder.', 400);
  const files = form.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length === 0) return err('At least one file is required.', 400);
  if (files.length > folder.maxFiles) return err(`Maximum ${folder.maxFiles} files per submission.`, 400);

  const maxBytes = folder.maxFileSizeMB * 1024 * 1024;
  const maxTotal = folder.maxTotalSizeMB * 1024 * 1024;
  const allowedExts = parseCsvList(folder.allowedExtensions);
  const blockedExts = parseCsvList(settings.blockedExtensions);

  const prepared: { safeName: string; buf: Buffer; mime: string }[] = [];
  let total = 0;
  for (const f of files) {
    const safeName = sanitizeOriginalName((f as File).name || 'file');
    const ext = extOf(safeName);
    const size = (f as File).size;
    if (!size || size <= 0) return err(`File "${safeName}" is empty.`, 400);
    if (size > maxBytes) return err(`File "${safeName}" exceeds the ${folder.maxFileSizeMB} MB limit.`, 413);
    if (blockedExts.includes(ext)) return err(`File type ".${ext}" is blocked by the administrator.`, 400);
    if (allowedExts.length > 0 && !allowedExts.includes(ext)) return err(`File type ".${ext || '?'}" is not allowed for this folder.`, 400);
    total += size;
    if (total > maxTotal) return err(`Total submission size exceeds ${folder.maxTotalSizeMB} MB.`, 413);
    const buf = Buffer.from(await (f as File).arrayBuffer());
    if (buf.length === 0) return err(`File "${safeName}" could not be read.`, 400);
    prepared.push({ safeName, buf, mime: (f as File).type || MIME_FALLBACK });
  }

  const db = await dbReady();
  // Multiple-submission rules
  const existing = db.prepare("SELECT * FROM submissions WHERE folderId = ? AND studentId = ? AND status = 'current' ORDER BY submissionNumber DESC").all(params.id, sess.user.id) as unknown as { id: string; submissionNumber: number }[];
  if (existing.length > 0 && folder.allowMultiple !== 1 && folder.allowReplace !== 1) {
    return err('You have already submitted to this folder.', 403);
  }

  const now = nowISO();
  const nextNumber = ((db.prepare('SELECT COALESCE(MAX(submissionNumber),0) AS m FROM submissions WHERE folderId = ? AND studentId = ?').get(params.id, sess.user.id) as unknown as { m: number }).m || 0) + 1;
  const isLate = late ? 1 : 0;
  const submissionId = newId();
  const written: string[] = [];
  try {
    fs.mkdirSync(storageSubdir('submissions'), { recursive: true });
    db.prepare(
      "INSERT INTO submissions(id, folderId, studentId, teacherId, classId, submissionNumber, message, status, isLate, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, 'current', ?, ?, ?)"
    ).run(submissionId, params.id, sess.user.id, folder.teacherId, sess.user.classId, nextNumber, message, isLate, now, now);
    const insFile = db.prepare('INSERT INTO submission_files(id, submissionId, storedFile, originalName, mime, size, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const p of prepared) {
      const storedFile = newId();
      const dest = path.join(storageSubdir('submissions'), storedFile);
      fs.writeFileSync(dest, p.buf);
      written.push(dest);
      insFile.run(newId(), submissionId, storedFile, p.safeName, p.mime.slice(0, 120), p.buf.length, now);
    }
    // If replacement (not multiple): mark older current submissions as replaced
    if (folder.allowMultiple !== 1 && existing.length > 0) {
      const upd = db.prepare("UPDATE submissions SET status = 'replaced', updatedAt = ? WHERE id = ?");
      for (const e of existing) upd.run(now, e.id);
    }
  } catch {
    for (const w of written) {
      try { fs.unlinkSync(w); } catch {}
    }
    try { db.prepare('DELETE FROM submissions WHERE id = ?').run(submissionId); } catch {}
    return err('Upload failed. Please try again.', 500);
  }

  notify(sess.user.id, 'submission', 'Submission uploaded successfully.', `${folder.name} — ${prepared.length} file(s)`, null);
  notifyTeacher(folder.teacherId, `New submission: ${folder.name}`, `${sess.user.displayName} submitted ${prepared.length} file(s) (${Math.round(total / 1024)} KB)`, params.id, submissionId);
  audit('Submission Uploaded', {
    actorType: 'student', actorId: sess.user.id, actorName: sess.user.username,
    details: `folder=${params.id} submission=${submissionId} files=${prepared.length} bytes=${total} late=${isLate}`, ip: clientIp(req),
  });
  return json({ ok: true, submissionId, submissionNumber: nextNumber, fileCount: prepared.length, totalBytes: total, isLate: !!isLate }, 201);
}

// Student deletes own submission (only if folder allows)
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  const url = new URL(req.url);
  const submissionId = (url.searchParams.get('submissionId') || '').trim();
  if (!submissionId) return err('Submission is required.', 400);
  const db = await dbReady();
  const s = db.prepare('SELECT * FROM submissions WHERE id = ?').get(submissionId) as unknown as {
    id: string; folderId: string; studentId: string; status: string;
  } | undefined;
  if (!s || s.folderId !== params.id) return err('Submission not found.', 404);
  if (s.studentId !== sess.user.id) return err('You are not authorized.', 403);
  const folder = getSubmissionFolder(params.id);
  if (!folder) return err('Folder not found.', 404);
  if (folder.allowDeleteOwn !== 1) return err('Deleting your submission is not allowed for this folder.', 403);
  // Delete files from disk
  try {
    const files = db.prepare('SELECT storedFile FROM submission_files WHERE submissionId = ?').all(submissionId) as unknown as { storedFile: string }[];
    for (const fl of files) {
      try {
        const p = path.join(storageSubdir('submissions'), fl.storedFile);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {}
    }
  } catch {}
  db.prepare('DELETE FROM submissions WHERE id = ?').run(submissionId);
  audit('Submission Deleted By Student', { actorType: 'student', actorId: sess.user.id, actorName: sess.user.username, details: `submission=${submissionId}`, ip: clientIp(req) });
  return json({ ok: true });
}
