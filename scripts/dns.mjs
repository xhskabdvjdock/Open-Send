// Open Send — built-in lightweight DNS server (zero-install Technitium alternative).
// Started automatically by start-lan.bat / start-lan.sh alongside the web server.
// - Answers A queries for open-send.btec / www.open-send.btec with the LAN IP.
// - Forwards EVERYTHING else to upstream DNS (8.8.8.8, 1.1.1.1) so internet keeps working.
// Clients must point to this PC as their DNS (router DHCP once, or per-device manual DNS).
// Needs UDP+TCP 53 allowed once:
//   New-NetFirewallRule -DisplayName "DNS (UDP 53)" -Direction Inbound -Protocol UDP -LocalPort 53 -Action Allow -Profile Private
//   New-NetFirewallRule -DisplayName "DNS (TCP 53)" -Direction Inbound -Protocol TCP -LocalPort 53 -Action Allow -Profile Private

import dgram from 'node:dgram';
import net from 'node:net';
import os from 'node:os';

const PORT = 53;
const TTL = 300;
const UPSTREAMS = ['8.8.8.8', '1.1.1.1'];
const TIMEOUT_MS = 3000;

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
  return (
    candidates.find((ip) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) ||
    candidates[0] ||
    '127.0.0.1'
  );
}

const LAN_IP = detectLanIp();
const LOCAL_NAMES = new Set(['open-send.btec', 'www.open-send.btec']);

// ---- minimal DNS packet helpers (no dependencies) ----
function parseQuestion(buf) {
  let off = 12;
  const parts = [];
  while (off < buf.length) {
    const len = buf[off];
    if (len === 0) { off += 1; break; }
    if ((len & 0xc0) === 0xc0) return null; // compressed — invalid in queries
    if (off + 1 + len > buf.length) return null;
    parts.push(buf.subarray(off + 1, off + 1 + len).toString('utf8'));
    off += 1 + len;
  }
  if (off + 4 > buf.length) return null;
  return { name: parts.join('.').toLowerCase(), qtype: buf.readUInt16BE(off), qEnd: off + 4 };
}

function buildAResponse(query, qEnd, ip) {
  const qSec = query.subarray(12, qEnd);
  const resp = Buffer.alloc(12 + qSec.length + 16);
  query.copy(resp, 0, 0, 2); // transaction ID
  resp.writeUInt16BE(0x8180, 2); // flags: standard response, no error
  resp.writeUInt16BE(1, 4); // QDCOUNT
  resp.writeUInt16BE(1, 6); // ANCOUNT
  resp.writeUInt16BE(0, 8);
  resp.writeUInt16BE(0, 10);
  qSec.copy(resp, 12);
  let o = 12 + qSec.length;
  resp.writeUInt16BE(0xc00c, o); o += 2; // pointer to QNAME
  resp.writeUInt16BE(1, o); o += 2; // TYPE A
  resp.writeUInt16BE(1, o); o += 2; // CLASS IN
  resp.writeUInt32BE(TTL, o); o += 4;
  resp.writeUInt16BE(4, o); o += 2;
  for (const [i, b] of ip.split('.').entries()) resp[o + i] = Number(b);
  return resp;
}

// ---- upstream forwarding ----
let upstreamIdx = 0;
function pickUpstream() {
  const u = UPSTREAMS[upstreamIdx % UPSTREAMS.length];
  upstreamIdx += 1;
  return u;
}

function forwardUdp(packet, onReply) {
  const upstream = pickUpstream();
  const sock = dgram.createSocket('udp4');
  let done = false;
  const timer = setTimeout(() => {
    if (!done) { done = true; try { sock.close(); } catch {} onReply(null); }
  }, TIMEOUT_MS);
  sock.on('message', (msg) => {
    if (!done) { done = true; clearTimeout(timer); try { sock.close(); } catch {} onReply(msg); }
  });
  sock.on('error', () => {
    if (!done) { done = true; clearTimeout(timer); try { sock.close(); } catch {} onReply(null); }
  });
  sock.send(packet, 53, upstream);
}

function forwardTcp(packet) {
  return new Promise((resolve) => {
    const upstream = pickUpstream();
    const sock = net.connect(53, upstream);
    let done = false;
    const finish = (data) => { if (!done) { done = true; try { sock.destroy(); } catch {} resolve(data); } };
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);
    const out = Buffer.alloc(2 + packet.length);
    out.writeUInt16BE(packet.length, 0);
    packet.copy(out, 2);
    sock.on('connect', () => sock.write(out));
    let acc = Buffer.alloc(0);
    let want = -1;
    sock.on('data', (chunk) => {
      acc = Buffer.concat([acc, chunk]);
      if (want < 0 && acc.length >= 2) want = acc.readUInt16BE(0);
      if (want >= 0 && acc.length >= 2 + want) { clearTimeout(timer); finish(acc.subarray(2, 2 + want)); }
    });
    sock.on('error', () => { clearTimeout(timer); finish(null); });
    sock.on('close', () => { clearTimeout(timer); finish(null); });
  });
}

// ---- servers ----
const udp = dgram.createSocket('udp4');
udp.on('message', (msg, rinfo) => {
  const q = parseQuestion(msg);
  if (q && q.qtype === 1 && LOCAL_NAMES.has(q.name)) {
    udp.send(buildAResponse(msg, q.qEnd, LAN_IP), rinfo.port, rinfo.address);
    console.log(`[DNS] ${q.name} -> ${LAN_IP} (${rinfo.address})`);
    return;
  }
  forwardUdp(msg, (reply) => {
    if (reply) udp.send(reply, rinfo.port, rinfo.address);
  });
});
udp.on('error', (err) => {
  console.error('[DNS] UDP error:', err.message);
  if (String(err.code) === 'EACCES' || String(err.code) === 'EADDRINUSE') {
    console.error('[DNS] Port 53 busy (another DNS server?) or blocked. Allow UDP+TCP 53 in Firewall.');
  }
});
udp.bind(PORT, '0.0.0.0', () => {
  console.log(`[DNS] UDP :${PORT} — open-send.btec -> ${LAN_IP}, rest forwarded upstream`);
});

const tcp = net.createServer((sock) => {
  let acc = Buffer.alloc(0);
  let want = -1;
  sock.on('data', async (chunk) => {
    acc = Buffer.concat([acc, chunk]);
    while (true) {
      if (want < 0 && acc.length >= 2) want = acc.readUInt16BE(0);
      if (want < 0 || acc.length < 2 + want) return;
      const packet = acc.subarray(2, 2 + want);
      acc = acc.subarray(2 + want);
      want = -1;
      const q = parseQuestion(packet);
      if (q && q.qtype === 1 && LOCAL_NAMES.has(q.name)) {
        const resp = buildAResponse(packet, q.qEnd, LAN_IP);
        const out = Buffer.alloc(2 + resp.length);
        out.writeUInt16BE(resp.length, 0);
        resp.copy(out, 2);
        sock.write(out);
        console.log(`[DNS/TCP] ${q.name} -> ${LAN_IP}`);
      } else {
        const reply = await forwardTcp(packet);
        if (reply) {
          const out = Buffer.alloc(2 + reply.length);
          out.writeUInt16BE(reply.length, 0);
          reply.copy(out, 2);
          sock.write(out);
        }
      }
    }
  });
  sock.on('error', () => {});
});
tcp.on('error', (err) => console.error('[DNS] TCP error:', err.message));
tcp.listen(PORT, '0.0.0.0', () => console.log(`[DNS] TCP :${PORT} listening`));
