import { json } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { getLanUrls } from '@/lib/network';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const port = Number(process.env.PORT || 3000);
  const urls = getLanUrls(port);
  return json({
    port,
    localUrl: urls.local,
    lanUrls: urls.lan,
    primaryUrl: urls.lan[0] || urls.local,
    status: 'Running',
  });
}
