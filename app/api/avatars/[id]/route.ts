import fs from 'node:fs';
import path from 'node:path';
import {
  getStudentFromToken, getTeacherFromToken, getAdminFromToken,
  STUDENT_COOKIE, TEACHER_COOKIE, ADMIN_COOKIE, getCookieFromHeader,
} from '@/lib/auth';
import { dbReady } from '@/lib/db';
import { err } from '@/lib/api';
import { storageSubdir, isSafeInternalId } from '@/lib/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SERVE_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

// Serves any student's or teacher's avatar to any LOGGED-IN user (student,
// teacher or admin). Ids are unguessable; no content browsing beyond the
// picture itself. Correct caching via ETag (no version column needed).
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const cookieHeader = req.headers.get('cookie');
  const student = await getStudentFromToken(getCookieFromHeader(cookieHeader, STUDENT_COOKIE));
  const teacher = student ? null : await getTeacherFromToken(getCookieFromHeader(cookieHeader, TEACHER_COOKIE));
  const admin = student || teacher ? null : await getAdminFromToken(getCookieFromHeader(cookieHeader, ADMIN_COOKIE));
  if (!student && !teacher && !admin) return err('Unauthorized', 401);
  const db = await dbReady();
  const u = db.prepare('SELECT avatarFile FROM users WHERE id = ?').get(params.id) as unknown as { avatarFile: string } | undefined;
  const t = u?.avatarFile
    ? null
    : (db.prepare('SELECT avatarFile FROM teachers WHERE id = ?').get(params.id) as unknown as { avatarFile: string } | undefined);
  const storedFile = u?.avatarFile || t?.avatarFile || '';
  if (!storedFile || !isSafeInternalId(storedFile)) return err('Not found.', 404);
  const disk = path.join(storageSubdir('avatars'), storedFile);
  let stat: { size: number; mtimeMs: number };
  try {
    const s = fs.statSync(disk);
    stat = { size: s.size, mtimeMs: s.mtimeMs };
  } catch {
    return err('Not found.', 404);
  }
  // Re-resolve mime defensively from the stored extension (never trust input blindly).
  const etag = `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
  if ((req.headers.get('if-none-match') || '').split(',').map((s) => s.trim()).includes(etag)) {
    return new Response(null, { status: 304 });
  }
  // Stored files are extensionless random ids; recover the real type from the
  // DB row is overkill — avatars are validated images at upload; still, sniff
  // the magic bytes to pick a safe content type instead of trusting anything.
  let mime = 'application/octet-stream';
  try {
    const fd = fs.openSync(disk, 'r');
    const head = Buffer.alloc(12);
    fs.readSync(fd, head, 0, 12, 0);
    fs.closeSync(fd);
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) mime = 'image/jpeg';
    else if (head[0] === 0x89 && head.subarray(1, 4).toString() === 'PNG') mime = 'image/png';
    else if (head.subarray(0, 6).toString() === 'GIF87a' || head.subarray(0, 6).toString() === 'GIF89a') mime = 'image/gif';
    else if (head.subarray(0, 4).toString() === 'RIFF' && head.subarray(8, 12).toString() === 'WEBP') mime = 'image/webp';
  } catch {}
  if (!SERVE_MIMES.has(mime)) return err('Not found.', 404);
  const stream = fs.createReadStream(disk);
  return new Response(stream as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(stat.size),
      ETag: etag,
      'Cache-Control': 'private, no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
