import { getAdminFromToken, ADMIN_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { err } from '@/lib/api';
import type { AdminRow } from '@/lib/db';

export async function requireAdmin(req: Request): Promise<{ admin: AdminRow } | { errorResponse: Response }> {
  const token = getCookieFromHeader(req.headers.get('cookie'), ADMIN_COOKIE);
  const admin = await getAdminFromToken(token);
  if (!admin) return { errorResponse: err('Unauthorized: admin authentication required.', 401) };
  return { admin };
}
