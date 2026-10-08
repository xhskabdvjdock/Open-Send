import fs from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dbReady } from '@/lib/db';
import { json, err, clientIp } from '@/lib/api';
import { requireTeacher } from '@/lib/teacherGuard';
import { getSettings } from '@/lib/settings';
import { getSubmissionFolder, teacherOwnsFolder } from '@/lib/folders';
import { newId, nowISO } from '@/lib/crypto';
import { audit } from '@/lib/server-utils';
import { sanitizeOriginalName, extOf, parseCsvList } from '@/lib/validation';
import { storageSubdir } from '@/lib/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIME_FALLBACK = 'application/octet-stream';
const MAX_ATTACHMENTS = 10;

// Teacher attaches reference materials to their folder (students download them).
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  if (!teacherOwnsFolder(g.teacher.id, params.id)) return err('Folder not found.', 404);
  const folder = getSubmissionFolder(params.id);
  if (!folder) return err('Folder not found.', 404);
  const settings = getSettings();
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return err('Invalid upload.', 400);
  }
  const files = form.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length === 0) return err('At least one file is required.', 400);
  const db = await dbReady();
  const existing = (db.prepare('SELECT COUNT(*) AS c FROM folder_attachments WHERE folderId = ?').get(params.id) as unknown as { c: number }).c;
  if (existing + files.length > MAX_ATTACHMENTS) return err(`Maximum ${MAX_ATTACHMENTS} files per folder.`, 400);
  const maxBytes = folder.maxFileSizeMB * 1024 * 1024;
  const allowedExts = parseCsvList(folder.allowedExtensions);
  const blockedExts = parseCsvList(settings.blockedExtensions);
  const metas: { file: File; safeName: string; mime: string }[] = [];
  for (const f of files) {
    const safeName = sanitizeOriginalName(f.name || 'file');
    const ext = extOf(safeName);
    if (!f.size || f.size <= 0) return err(`File "${safeName}" is empty.`, 400);
    if (f.size > maxBytes) return err(`File "${safeName}" exceeds the ${folder.maxFileSizeMB} MB limit.`, 413);
    if (blockedExts.includes(ext)) return err(`File type ".${ext}" is blocked by the administrator.`, 400);
    if (allowedExts.length > 0 && !allowedExts.includes(ext)) {
      return err(`File type ".${ext || '?'}" is not allowed for this folder.`, 400);
    }
    metas.push({ file: f, safeName, mime: (f.type || MIME_FALLBACK).slice(0, 120) });
  }
  const now = nowISO();
  const created: { id: string; originalName: string; mime: string; size: number }[] = [];
  const written: string[] = [];
  try {
    fs.mkdirSync(storageSubdir('folders'), { recursive: true });
    const ins = db.prepare('INSERT INTO folder_attachments(id, folderId, storedFile, originalName, mime, size, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const m of metas) {
      const buf = Buffer.from(await m.file.arrayBuffer());
      if (buf.length === 0) throw new Error(`unreadable:${m.safeName}`);
      const storedFile = newId();
      const dest = path.join(storageSubdir('folders'), storedFile);
      await writeFile(dest, buf);
      written.push(dest);
      const fid = newId();
      ins.run(fid, params.id, storedFile, m.safeName, m.mime, buf.length, now);
      created.push({ id: fid, originalName: m.safeName, mime: m.mime, size: buf.length });
    }
  } catch (e) {
    for (const w of written) {
      try {
        fs.unlinkSync(w);
      } catch {}
    }
    const msg = e instanceof Error ? e.message : '';
    if (msg.startsWith('unreadable:')) return err(`File "${msg.slice(11)}" could not be read.`, 400);
    return err('Upload failed. Please try again.', 500);
  }
  audit('Teacher Attached Folder Files', { actorType: 'teacher', actorId: g.teacher.id, actorName: g.teacher.username, details: `folder=${params.id} files=${created.length}`, ip: clientIp(req) });
  return json({ ok: true, files: created }, 201);
}
