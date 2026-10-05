// Open Send — mDNS responder (zero-config local name, no DNS server needed).
// Started automatically by start-lan.bat / start-lan.sh alongside the web server.
// Primary name:  http://btec-send.local  -> 192.168.1.118 (port 80, no :port in URL)
// Legacy names kept for backward compatibility: opensend.local, open-send.local.
// iPhones resolve .local natively; Android 12+ and Windows resolve it too.
//
// Centralized configuration (see lib/network.ts, .env.example):
//   OPEN_SEND_HOST / OPENSEND_HOST_IP   expected server IPv4 (default 192.168.1.118)
//   OPEN_SEND_HOSTNAME / OPENSEND_HOSTNAME  local hostname (default btec-send.local)
//
// If the expected IP is assigned to this machine it is advertised; otherwise the
// detected LAN IP is advertised and a warning is printed (server keeps working via IP).

import os from 'node:os';
import createMdns from 'multicast-dns';

const EXPECTED_IP = (process.env.OPEN_SEND_HOST || process.env.OPENSEND_HOST_IP || '192.168.1.118').trim() || '192.168.1.118';
const PRIMARY_NAME = (process.env.OPEN_SEND_HOSTNAME || process.env.OPENSEND_HOSTNAME || 'btec-send.local').trim().toLowerCase() || 'btec-send.local';
// Primary first; legacy aliases retained so old bookmarks/QR codes keep working.
const NAMES = [PRIMARY_NAME, 'opensend.local', 'open-send.local'].filter(
  (v, i, a) => v && a.indexOf(v) === i
);

function detectLanIp() {
  const nets = os.networkInterfaces();
  const skip = /(loopback|teredo|virtualbox|vmware|vethernet|hamachi|tailscale|zerotier|bluetooth|isatap)/i;
  const candidates = [];
  for (const [name, list] of Object.entries(nets)) {
    if (!list || skip.test(name)) continue;
    for (const n of list) {
      if (n.family === 'IPv4' && !n.internal) candidates.push(n.address);
    }
  }
  // Prefer the expected fixed IP when the machine actually owns it.
  if (candidates.includes(EXPECTED_IP)) return { ip: EXPECTED_IP, expected: true, candidates };
  // Otherwise prefer common LAN ranges, first one wins.
  const preferred = candidates.find((ip) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip));
  return { ip: preferred || candidates[0] || '127.0.0.1', expected: false, candidates };
}

const { ip: IP, expected: HAS_EXPECTED, candidates } = detectLanIp();
console.log(`[mDNS] Advertising ${NAMES.join(' , ')} -> ${IP}`);
console.log(`[mDNS] Listening on all interfaces (have: ${candidates.join(', ') || '(none)'})`);
if (!HAS_EXPECTED && IP !== '127.0.0.1') {
  console.log('');
  console.log('Open Send Network Warning');
  console.log('');
  console.log('Expected server IP:');
  console.log(EXPECTED_IP);
  console.log('');
  console.log(`Advertising ${IP} instead (expected IP not found on this machine).`);
  console.log(`${PRIMARY_NAME} may not work correctly.`);
  console.log('Please verify the network adapter configuration.');
  console.log(`Detected addresses: ${candidates.join(', ') || '(none)'}`);
} else if (IP === '127.0.0.1') {
  console.log('[mDNS] WARNING: no LAN IPv4 detected — advertising loopback only.');
}

const mdns = createMdns({
  multicast: true,
  // NOTE: intentionally NOT bound to a single IP. On multi-homed Windows PCs
  // (Wi-Fi + ICS/hotspot + virtual adapters) queries can arrive on any NIC —
  // restricting membership to one address silently drops the rest.
  // The socket is shared (0.0.0.0:5353, reuseAddr) and answers still advertise IP.
  port: 5353,
  reuseAddr: true,
  ttl: 120,
});

mdns.on('query', (packet) => {
  const questions = packet.questions || [];
  const hit = questions.some(
    (qq) => qq.type === 'A' && NAMES.includes(String(qq.name || '').toLowerCase().replace(/\.$/, ''))
  );
  if (!hit) return;
  mdns.respond({
    answers: NAMES.map((name) => ({ name, type: 'A', ttl: 120, data: IP })),
  });
});

mdns.on('error', (err) => {
  console.error('[mDNS] socket error:', err.message);
  console.error('[mDNS] If EACCES/EADDRINUSE: allow UDP 5353 in Windows Firewall (Private).');
});

process.on('SIGINT', () => {
  try { mdns.destroy(); } catch {}
  process.exit(0);
});
process.on('SIGTERM', () => {
  try { mdns.destroy(); } catch {}
  process.exit(0);
});
