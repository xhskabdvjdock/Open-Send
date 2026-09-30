import { getAdminFromToken, ADMIN_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { json, err } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const token = getCookieFromHeader(req.headers.get('cookie'), ADMIN_COOKIE);
  const admin = await getAdminFromToken(token);
  if (!admin) return err('Unauthorized', 401);
  return json({ admin: { id: admin.id, username: admin.username, createdAt: admin.createdAt } });
}
