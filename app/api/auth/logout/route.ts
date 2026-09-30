import { destroySessionByToken, getCookieFromHeader, STUDENT_COOKIE } from '@/lib/auth';
import { json } from '@/lib/api';
import { clearStudentCookieHeader } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  if (token) await destroySessionByToken(token);
  const res = json({ ok: true });
  res.headers.set('Set-Cookie', clearStudentCookieHeader());
  return res;
}
