import { json } from '@/lib/api';
import { getDb } from '@/lib/db';
import { getExpectedServerIp, getLocalHostname } from '@/lib/network';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    // Extra LAN identity fields are informational only (used by setup scripts
    // and the admin diagnostics page). No secrets are exposed here.
    return json({
      ok: true,
      status: 'Running',
      time: new Date().toISOString(),
      hostname: getLocalHostname(),
      expectedIp: getExpectedServerIp(),
    });
  } catch {
    return json({ ok: false, status: 'Error' }, 500);
  }
}
