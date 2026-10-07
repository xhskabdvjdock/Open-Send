import { getStudentFromToken, getTeacherFromToken, STUDENT_COOKIE, TEACHER_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { dbReady, type LibraryBookRow } from '@/lib/db';
import { json, err } from '@/lib/api';
import { getSettings } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function sessionOf(req: Request) {
  const cookieHeader = req.headers.get('cookie');
  const student = await getStudentFromToken(getCookieFromHeader(cookieHeader, STUDENT_COOKIE));
  if (student) return { kind: 'student' as const, id: student.user.id, classId: student.user.classId };
  const teacher = await getTeacherFromToken(getCookieFromHeader(cookieHeader, TEACHER_COOKIE));
  if (teacher) return { kind: 'teacher' as const, id: teacher.teacher.id, classId: null as string | null };
  return null;
}

function publicBook(b: LibraryBookRow) {
  return {
    id: b.id, title: b.title, author: b.author, subject: b.subject,
    description: b.description, mime: b.mime, size: b.size,
    downloadCount: b.downloadCount, createdAt: b.createdAt,
  };
}

export async function GET(req: Request) {
  const sess = await sessionOf(req);
  if (!sess) return err('Unauthorized', 401);
  const s = getSettings();
  if (!s.libraryEnabled) return err('The library is currently disabled.', 403);
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 60).toLowerCase();
  const subject = (url.searchParams.get('subject') || '').trim().slice(0, 60);
  const db = await dbReady();
  const clauses = ['b.enabled = 1'];
  const vals: (string | number)[] = [];
  if (sess.kind === 'student') {
    // Class-scoped visibility: 'all' books plus my classes' books.
    if (!sess.classId) return json({ books: [], subjects: [] });
    clauses.push("(b.scope = 'all' OR EXISTS (SELECT 1 FROM library_book_classes lb WHERE lb.bookId = b.id AND lb.classId = ?))");
    vals.push(sess.classId);
  }
  if (q) {
    clauses.push("(lower(b.title) LIKE ? ESCAPE '\\' OR lower(b.author) LIKE ? ESCAPE '\\' OR lower(b.subject) LIKE ? ESCAPE '\\')");
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    vals.push(like, like, like);
  }
  if (subject) {
    clauses.push('b.subject = ?');
    vals.push(subject);
  }
  const books = db.prepare(
    `SELECT * FROM library_books b WHERE ${clauses.join(' AND ')} ORDER BY b.title COLLATE NOCASE LIMIT 200`
  ).all(...vals) as unknown as LibraryBookRow[];
  const subjects = db.prepare(
    'SELECT DISTINCT subject FROM library_books WHERE enabled = 1 AND subject != ? ORDER BY subject COLLATE NOCASE'
  ).all('') as unknown as { subject: string }[];
  return json({ books: books.map(publicBook), subjects: subjects.map((r) => r.subject) });
}
