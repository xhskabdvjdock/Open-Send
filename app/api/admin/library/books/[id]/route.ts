import fs from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dbReady } from '@/lib/db';
import { json, err, clientIp } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { getSettings } from '@/lib/settings';
import { nowISO } from '@/lib/crypto';
import { audit } from '@/lib/server-utils';
import { sanitizeOriginalName, extOf, parseCsvList } from '@/lib/validation';
import { storageSubdir } from '@/lib/paths';
import { newId } from '@/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIME_FALLBACK = 'application/octet-stream';
const LIBRARY_EXTS = new Set(['pdf', 'epub', 'doc', 'docx', 'ppt', 'pptx', 'txt']);

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const settings = getSettings();
  const db = await dbReady();
  const cur = db.prepare('SELECT * FROM library_books WHERE id = ?').get(params.id) as unknown as {
    id: string; title: string; storedFile: string;
  } | undefined;
  if (!cur) return err('Book not found.', 404);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return err('Invalid upload.', 400);
  }
  const updates: string[] = [];
  const vals: (string | number)[] = [];
  const prev: string[] = [];
  const get = (k: string): string | null => {
    const v = form.get(k);
    return typeof v === 'string' ? v : null;
  };
  const title = get('title');
  if (title !== null) {
    const t = title.trim().slice(0, 120);
    if (t.length < 2) return err('Title is required (min 2 characters).', 400);
    updates.push('title = ?');
    vals.push(t);
    prev.push(`title: ${cur.title} -> ${t}`);
  }
  for (const k of ['author', 'subject', 'description'] as const) {
    const v = get(k);
    if (v !== null) {
      updates.push(`${k} = ?`);
      vals.push(v.trim().slice(0, k === 'description' ? 2000 : k === 'subject' ? 80 : 120));
    }
  }
  const scope = get('scope');
  if (scope !== null) {
    const sc = scope === 'classes' ? 'classes' : 'all';
    updates.push('scope = ?');
    vals.push(sc);
    if (sc === 'all') {
      db.prepare('DELETE FROM library_book_classes WHERE bookId = ?').run(params.id);
    } else {
      const classIds = form.getAll('classIds').map(String).filter(Boolean);
      for (const cid of classIds) {
        const c = db.prepare('SELECT id FROM classes WHERE id = ?').get(cid) as unknown as { id: string } | undefined;
        if (!c) return err('Invalid class.', 400);
      }
      db.prepare('DELETE FROM library_book_classes WHERE bookId = ?').run(params.id);
      const ins = db.prepare('INSERT OR IGNORE INTO library_book_classes(bookId, classId) VALUES (?, ?)');
      for (const cid of classIds) ins.run(params.id, cid);
    }
  }
  const enabled = get('enabled');
  if (enabled !== null) {
    updates.push('enabled = ?');
    vals.push(enabled === 'true' || enabled === '1' ? 1 : 0);
  }
  const f = form.get('file');
  const file = f instanceof File && f.size > 0 ? f : null;
  if (file) {
    const safeName = sanitizeOriginalName(file.name || 'book');
    const ext = extOf(safeName);
    const maxBytes = settings.maxLibraryFileMB * 1024 * 1024;
    if (file.size > maxBytes) return err(`File "${safeName}" exceeds the ${settings.maxLibraryFileMB} MB limit.`, 413);
    if (!LIBRARY_EXTS.has(ext)) return err(`File type ".${ext || '?'}" is not allowed for library books.`, 400);
    const blockedExts = parseCsvList(settings.blockedExtensions);
    if (blockedExts.includes(ext)) return err(`File type ".${ext}" is blocked by the administrator.`, 400);
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length === 0) return err('The file is empty.', 400);
    const storedFile = newId();
    try {
      fs.mkdirSync(storageSubdir('library'), { recursive: true });
      await writeFile(path.join(storageSubdir('library'), storedFile), buf);
    } catch {
      return err('Upload failed. Please try again.', 500);
    }
    updates.push('originalName = ?', 'storedFile = ?', 'mime = ?', 'size = ?');
    vals.push(safeName, storedFile, (file.type || MIME_FALLBACK).slice(0, 120), buf.length);
    prev.push('file replaced');
    try {
      if (cur.storedFile) fs.unlinkSync(path.join(storageSubdir('library'), cur.storedFile));
    } catch {}
  }
  if (updates.length === 0) return err('Nothing to update.', 400);
  updates.push('updatedAt = ?');
  vals.push(nowISO());
  db.prepare(`UPDATE library_books SET ${updates.join(', ')} WHERE id = ?`).run(...vals, params.id);
  audit('Admin Edited Library Book', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: prev.join(' | ').slice(0, 500), ip: clientIp(req) });
  return json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const db = await dbReady();
  const cur = db.prepare('SELECT * FROM library_books WHERE id = ?').get(params.id) as unknown as { id: string; title: string; storedFile: string } | undefined;
  if (!cur) return err('Book not found.', 404);
  db.prepare('DELETE FROM library_books WHERE id = ?').run(params.id);
  if (cur.storedFile) {
    try {
      const p = path.join(storageSubdir('library'), cur.storedFile);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {}
  }
  audit('Admin Deleted Library Book', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `book=${cur.title}`, ip: clientIp(req) });
  return json({ ok: true });
}
