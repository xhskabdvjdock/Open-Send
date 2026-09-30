import { json } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { getLanUrls } from '@/lib/network';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  // Detect the real port from the incoming request (works for :80 and :3000).
  const urlPort = Number(new URL(req.url).port);
  const port = Number.isFinite(urlPort) && urlPort > 0 ? urlPort : Number(process.env.PORT || 80);
  const urls = getLanUrls(port);
  return json({
    port,
    localUrl: urls.local,
    lanUrls: urls.lan,
    primaryUrl: urls.lan[0] || urls.local,
    status: 'Running',
  });
}
