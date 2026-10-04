import { destroySessionByToken, TEACHER_COOKIE, getCookieFromHeader, clearTeacherCookieHeader } from '@/lib/auth';
import { json } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const token = getCookieFromHeader(req.headers.get('cookie'), TEACHER_COOKIE);
  if (token) await destroySessionByToken(token);
  const res = json({ ok: true });
  res.headers.set('Set-Cookie', clearTeacherCookieHeader());
  return res;
}
