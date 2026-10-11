import { json } from '@/lib/api';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    // Deliberately minimal: this endpoint is public (Cloudflare health checks
    // hit it from the internet), so it must not expose hostnames, LAN IPs,
    // versions, paths or any environment details. Admin diagnostics live
    // behind auth at /api/admin/network and /api/admin/system.
    return json({ ok: true, status: 'Running', time: new Date().toISOString() });
  } catch {
    return json({ ok: false, status: 'Error' }, 500);
  }
}
