import { destroySessionByToken, getCookieFromHeader, ADMIN_COOKIE, clearAdminCookieHeader } from '@/lib/auth';
import { json } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const token = getCookieFromHeader(req.headers.get('cookie'), ADMIN_COOKIE);
  if (token) await destroySessionByToken(token);
  const res = json({ ok: true });
  res.headers.set('Set-Cookie', clearAdminCookieHeader());
  return res;
}
