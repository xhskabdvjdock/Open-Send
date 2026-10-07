import dns from 'node:dns/promises';
import { execSync } from 'node:child_process';
import { json } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import {
  getLanUrls,
  getAllLocalIpv4,
  getExpectedServerIp,
  getLocalHostname,
  getHostnameUrl,
  getExpectedIpUrl,
} from '@/lib/network';
import { getSettings } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function resolveHostname(name: string): Promise<{ ok: boolean; address?: string }> {
  try {
    const r = await dns.lookup(name, { family: 4 });
    return { ok: true, address: (r as unknown as { address: string }).address };
  } catch {
    return { ok: false };
  }
}

/** Best-effort firewall check (Windows only). Never throws, never requires admin to read. */
function firewallStatus(port: number): { app: string; mdns: string } {
  if (process.platform !== 'win32') return { app: 'Unknown', mdns: 'Unknown' };
  let app = 'Unknown';
  let mdns = 'Unknown';
  try {
    const out = execSync('netsh advfirewall firewall show rule name="Open Send Server"', {
      timeout: 6000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
    app = /LocalPort\s*:\s*.*\b\d+\b/i.test(out) || /Open Send Server/i.test(out) ? 'Configured' : 'Missing';
    if (/No rules match/i.test(out)) app = 'Missing';
  } catch {
    app = 'Unknown';
  }
  try {
    const out = execSync('netsh advfirewall firewall show rule name="mDNS (UDP 5353)"', {
      timeout: 6000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
    mdns = /mDNS/i.test(out) && !/No rules match/i.test(out) ? 'Configured' : 'Missing';
  } catch {
    mdns = 'Unknown';
  }
  void port;
  return { app, mdns };
}

export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  // Detect the real port from the incoming request (works for :80 and :3000).
  const urlPort = Number(new URL(req.url).port);
  const port = Number.isFinite(urlPort) && urlPort > 0 ? urlPort : Number(process.env.PORT || 80);
  const urls = getLanUrls(port);
  const expectedIp = getExpectedServerIp();
  const hostname = getLocalHostname();
  const detectedIps = getAllLocalIpv4();
  const hasExpectedIp = detectedIps.includes(expectedIp);
  const resolved = await resolveHostname(hostname);
  const mdnsOk = !!resolved.ok && (!!resolved.address && (resolved.address === expectedIp || detectedIps.includes(resolved.address)));
  const fw = firewallStatus(port);
  const chatSettings = getSettings();

  // Keep legacy fields (localUrl/lanUrls/primaryUrl) so old clients keep working.
  return json({
    port,
    localUrl: urls.local,
    lanUrls: urls.lan,
    primaryUrl: urls.lan[0] || urls.local,
    status: 'Running',
    // New centralized LAN identity:
    expectedIp,
    hostname,
    hostnameUrl: getHostnameUrl(port),
    ipUrl: getExpectedIpUrl(port),
    detectedIps,
    hasExpectedIp,
    mdns: mdnsOk ? 'Active' : 'Unavailable',
    mdnsResolvedIp: resolved.address || null,
    firewall: fw,
    server: 'Running',
    chat: {
      enabled: chatSettings.chatEnabled && chatSettings.chatStudentChat,
      transport: 'SSE',
      stream: '/api/chat/stream',
    },
    warning: hasExpectedIp
      ? null
      : `Expected server IP ${expectedIp} not found on this machine. ${hostname} may not work correctly.`,
  });
}
