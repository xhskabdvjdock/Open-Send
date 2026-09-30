// Open Send — mDNS responder (zero-config local name, no DNS server needed).
// Started automatically by start-lan.bat / start-lan.sh alongside the web server.
// Advertises http://opensend.local (and http://open-send.local) on the LAN.
// iPhones resolve .local natively; Android 12+ and Windows resolve it too.
// Override the advertised IP with: OPENSEND_HOST_IP=192.168.1.50

import os from 'node:os';
import createMdns from 'multicast-dns';

const NAMES = ['opensend.local', 'open-send.local'];

function detectLanIp() {
  if (process.env.OPENSEND_HOST_IP) return process.env.OPENSEND_HOST_IP;
  const nets = os.networkInterfaces();
  const skip = /(loopback|teredo|virtualbox|vmware|vethernet|hamachi|tailscale|zerotier|bluetooth|isatap)/i;
  const candidates = [];
  for (const [name, list] of Object.entries(nets)) {
    if (!list || skip.test(name)) continue;
    for (const n of list) {
      if (n.family === 'IPv4' && !n.internal) candidates.push(n.address);
    }
  }
  // Prefer common LAN ranges, first one wins.
  const preferred = candidates.find((ip) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip));
  return preferred || candidates[0] || '127.0.0.1';
}

const IP = detectLanIp();
console.log(`[mDNS] Advertising ${NAMES.join(' , ')} -> ${IP}`);

const mdns = createMdns({
  multicast: true,
  interface: IP !== '127.0.0.1' ? IP : undefined,
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
