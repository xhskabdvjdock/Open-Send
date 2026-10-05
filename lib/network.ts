import os from 'node:os';

/**
 * Centralized local-network configuration for Open Send.
 *
 * Preferred LAN identity (override via environment, never hard-code elsewhere):
 *   OPEN_SEND_HOST      expected server IPv4 (default 192.168.1.118)
 *                       alias OPENSEND_HOST_IP is also honored (legacy, used by scripts/mdns.mjs)
 *   OPEN_SEND_HOSTNAME  local mDNS hostname (default btec-send.local)
 *                       alias OPENSEND_HOSTNAME is also honored
 *   PORT                HTTP port (default 80 in production, 3000 in dev / fallback)
 *
 * Production URL has no port suffix (port 80):  http://btec-send.local
 * Dev / fallback URL keeps the port:            http://btec-send.local:3000
 */

export const EXPECTED_SERVER_IP_DEFAULT = '192.168.1.118';
export const LOCAL_HOSTNAME_DEFAULT = 'btec-send.local';

export function getExpectedServerIp(): string {
  const v =
    process.env.OPEN_SEND_HOST ||
    process.env.OPENSEND_HOST_IP ||
    EXPECTED_SERVER_IP_DEFAULT;
  return v.trim() || EXPECTED_SERVER_IP_DEFAULT;
}

export function getLocalHostname(): string {
  const v =
    process.env.OPEN_SEND_HOSTNAME ||
    process.env.OPENSEND_HOSTNAME ||
    LOCAL_HOSTNAME_DEFAULT;
  return (v.trim() || LOCAL_HOSTNAME_DEFAULT).toLowerCase();
}

/** Port 80/443 are implicit in http(s) URLs — omit them for a clean address. */
export function formatAppUrl(host: string, port: number): string {
  const h = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  if (port === 80) return `http://${h}`;
  if (port === 443) return `https://${h}`;
  return `http://${h}:${port}`;
}

export function getHostnameUrl(port: number): string {
  return formatAppUrl(getLocalHostname(), port);
}

export function getExpectedIpUrl(port: number): string {
  return formatAppUrl(getExpectedServerIp(), port);
}

export function getAllLocalIpv4(): string[] {
  const nets = os.networkInterfaces();
  const ips: string[] = [];
  for (const list of Object.values(nets)) {
    if (!list) continue;
    for (const n of list) {
      if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
    }
  }
  return ips;
}

export function hasExpectedIp(): boolean {
  return getAllLocalIpv4().includes(getExpectedServerIp());
}

export function getLanUrls(port: number): { local: string; lan: string[] } {
  const ips = getAllLocalIpv4();
  return { local: `http://localhost:${port}`, lan: ips.map((ip) => `http://${ip}:${port}`) };
}

export function getPrimaryLanIp(): string | null {
  const { lan } = getLanUrls(3000);
  return lan[0] ?? null;
}
