import fs from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dbReady } from '@/lib/db';
import { json, err, clientIp } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { getSettings } from '@/lib/settings';
import { newId, nowISO } from '@/lib/crypto';
import { audit } from '@/lib/server-utils';
import { sanitizeOriginalName, extOf, parseCsvList } from '@/lib/validation';
import { storageSubdir } from '@/lib/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIME_FALLBACK = 'application/octet-stream';
const LIBRARY_EXTS = new Set(['pdf', 'epub', 'doc', 'docx', 'ppt', 'pptx', 'txt']);

export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 60).toLowerCase();
  const db = await dbReady();
  const clauses: string[] = [];
  const vals: (string | number)[] = [];
  if (q) {
    clauses.push("(lower(title) LIKE ? ESCAPE '\\' OR lower(author) LIKE ? ESCAPE '\\' OR lower(subject) LIKE ? ESCAPE '\\')");
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    vals.push(like, like, like);
  }
  const books = db.prepare(
    `SELECT * FROM library_books ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''} ORDER BY title COLLATE NOCASE LIMIT 200`
  ).all(...vals) as unknown as Record<string, unknown>[];
  const links = db.prepare('SELECT lb.bookId, c.id AS classId, c.name AS className FROM library_book_classes lb JOIN classes c ON c.id = lb.classId').all() as unknown as { bookId: string; classId: string; className: string }[];
  const byBook = new Map<string, { id: string; name: string }[]>();
  for (const l of links) {
    if (!byBook.has(l.bookId)) byBook.set(l.bookId, []);
    byBook.get(l.bookId)?.push({ id: l.classId, name: l.className });
  }
  const classes = db.prepare('SELECT id, name FROM classes ORDER BY name').all();
  return json({ books: books.map((b) => ({ ...b, classes: byBook.get(String(b.id)) || [] })), classes });
}

export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const settings = getSettings();
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return err('Invalid upload.', 400);
  }
  const title = String(form.get('title') || '').trim().slice(0, 120);
  if (title.length < 2) return err('Title is required (min 2 characters).', 400);
  const author = String(form.get('author') || '').trim().slice(0, 120);
  const subject = String(form.get('subject') || '').trim().slice(0, 80);
  const description = String(form.get('description') || '').trim().slice(0, 2000);
  const scope = String(form.get('scope') || 'all') === 'classes' ? 'classes' : 'all';
  const enabled = form.get('enabled') === null ? true : String(form.get('enabled')) === 'true' || String(form.get('enabled')) === '1';
  const classIds = form.getAll('classIds').map(String).filter(Boolean);
  const f = form.get('file');
  const file = f instanceof File ? f : null;
  if (!file) return err('At least one file is required.', 400);
  const safeName = sanitizeOriginalName(file.name || 'book');
  const ext = extOf(safeName);
  const maxBytes = settings.maxLibraryFileMB * 1024 * 1024;
  if (!file.size || file.size <= 0) return err('The file is empty.', 400);
  if (file.size > maxBytes) return err(`File "${safeName}" exceeds the ${settings.maxLibraryFileMB} MB limit.`, 413);
  if (!LIBRARY_EXTS.has(ext)) return err(`File type ".${ext || '?'}" is not allowed for library books.`, 400);
  const blockedExts = parseCsvList(settings.blockedExtensions);
  if (blockedExts.includes(ext)) return err(`File type ".${ext}" is blocked by the administrator.`, 400);
  const db = await dbReady();
  if (scope === 'classes') {
    for (const cid of classIds) {
      const c = db.prepare('SELECT id FROM classes WHERE id = ?').get(cid) as unknown as { id: string } | undefined;
      if (!c) return err('Invalid class.', 400);
    }
  }
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length === 0) return err('The file is empty.', 400);
  const storedFile = newId();
  const now = nowISO();
  const id = newId();
  try {
    fs.mkdirSync(storageSubdir('library'), { recursive: true });
    await writeFile(path.join(storageSubdir('library'), storedFile), buf);
    db.prepare(
      'INSERT INTO library_books(id, title, author, subject, description, scope, originalName, storedFile, mime, size, enabled, downloadCount, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)'
    ).run(id, title, author, subject, description, scope, safeName, storedFile, (file.type || MIME_FALLBACK).slice(0, 120), buf.length, enabled ? 1 : 0, now, now);
    if (scope === 'classes') {
      const ins = db.prepare('INSERT OR IGNORE INTO library_book_classes(bookId, classId) VALUES (?, ?)');
      for (const cid of classIds) ins.run(id, cid);
    }
  } catch {
    try {
      fs.unlinkSync(path.join(storageSubdir('library'), storedFile));
    } catch {}
    return err('Upload failed. Please try again.', 500);
  }
  audit('Admin Added Library Book', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `book=${title}`, ip: clientIp(req) });
  return json({ ok: true, id }, 201);
}
