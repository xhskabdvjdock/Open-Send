import fs from 'node:fs';
import path from 'node:path';
import { getStudentFromToken, getTeacherFromToken, STUDENT_COOKIE, TEACHER_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { dbReady, type LibraryBookRow } from '@/lib/db';
import { err } from '@/lib/api';
import { getSettings } from '@/lib/settings';
import { storageSubdir, isSafeInternalId } from '@/lib/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  const encoded = encodeURIComponent(filename).replace(/'/g, '%27');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const cookieHeader = req.headers.get('cookie');
  const student = await getStudentFromToken(getCookieFromHeader(cookieHeader, STUDENT_COOKIE));
  const teacher = student ? null : await getTeacherFromToken(getCookieFromHeader(cookieHeader, TEACHER_COOKIE));
  if (!student && !teacher) return err('Unauthorized', 401);
  const s = getSettings();
  if (!s.libraryEnabled) return err('The library is currently disabled.', 403);
  const db = await dbReady();
  const b = db.prepare('SELECT * FROM library_books WHERE id = ? AND enabled = 1').get(params.id) as unknown as LibraryBookRow | undefined;
  if (!b || !b.storedFile || !isSafeInternalId(b.storedFile)) return err('Book not found.', 404);
  if (student) {
    if (!student.user.classId) return err('Book not found.', 404);
    if (b.scope !== 'all') {
      const link = db.prepare('SELECT 1 AS ok FROM library_book_classes WHERE bookId = ? AND classId = ?').get(b.id, student.user.classId) as unknown as { ok: number } | undefined;
      if (!link) return err('Book not found.', 404);
    }
  }
  const disk = path.join(storageSubdir('library'), b.storedFile);
  let size = 0;
  try {
    size = fs.statSync(disk).size;
  } catch {
    return err('File not found on server.', 404);
  }
  try {
    db.prepare('UPDATE library_books SET downloadCount = downloadCount + 1 WHERE id = ?').run(b.id);
  } catch {}
  const inline = (b.mime || '').toLowerCase() === 'application/pdf';
  const stream = fs.createReadStream(disk);
  return new Response(stream as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': b.mime || 'application/octet-stream',
      'Content-Length': String(size),
      'Content-Disposition': inline ? 'inline' : contentDisposition(b.originalName || b.title),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
