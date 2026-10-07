// Open Send — startup network check (lightweight, never blocks startup).
// Run before the web server: `node scripts/network-check.mjs`.
//   1. Verifies the expected fixed IP exists on this machine (warns, never changes it).
//   2. Verifies btec-send.local resolves to that IP (warns, server keeps working via IP).
//   3. Detects Windows Private/Public network profile (warns on Public).
//   4. Prints the startup banner with Local / Network / mDNS addresses.
//
// Always exits 0 so `npm run start` keeps working even when the LAN is misconfigured.
// Configuration (see lib/network.ts, .env.example):
//   OPEN_SEND_HOST / OPENSEND_HOST_IP, OPEN_SEND_HOSTNAME / OPENSEND_HOSTNAME, PORT

import os from 'node:os';
import './load-env.mjs';
import dns from 'node:dns';
import { execSync } from 'node:child_process';

const EXPECTED_IP = (process.env.OPEN_SEND_HOST || process.env.OPENSEND_HOST_IP || '192.168.1.118').trim() || '192.168.1.118';
const HOSTNAME = (process.env.OPEN_SEND_HOSTNAME || process.env.OPENSEND_HOSTNAME || 'btec-send.local').trim().toLowerCase() || 'btec-send.local';
// PORT env wins; `--port=XXXX` CLI arg overrides (used by start:3000).
let PORT = Number(process.env.PORT || 80);
for (const a of process.argv.slice(2)) {
  const m = /^--port=(\d+)$/.exec(a);
  if (m) PORT = Number(m[1]);
}
const port = Number.isFinite(PORT) && PORT > 0 ? PORT : 80;

function lanIps() {
  const out = [];
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      if (!list) continue;
      for (const n of list) {
        if (n && n.family === 'IPv4' && !n.internal) out.push(n.address);
      }
    }
  } catch {}
  return out;
}

function fmtUrl(host) {
  if (port === 80) return `http://${host}`;
  return `http://${host}:${port}`;
}

function lookupHostname(name, timeoutMs = 2500) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; resolve({ ok: false, error: 'timeout' }); }
    }, timeoutMs);
    try {
      dns.lookup(name, { family: 4 }, (err, address) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (err) resolve({ ok: false, error: err.code || err.message });
        else resolve({ ok: true, address });
      });
    } catch (e) {
      if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, error: String((e && e.message) || e) }); }
    }
  });
}

function windowsProfile() {
  if (process.platform !== 'win32') return null;
  try {
    const out = execSync(
      'powershell -NoProfile -Command "Get-NetConnectionProfile | Select-Object -ExpandProperty NetworkCategory"',
      { timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }
    ).toString();
    const cats = out.split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean);
    if (cats.length === 0) return null;
    return cats;
  } catch {
    return null;
  }
}

async function main() {
  const ips = lanIps();
  const hasExpected = ips.includes(EXPECTED_IP);
  // The mDNS advertiser (scripts/mdns.mjs) starts in the background of the same
  // window, so the first lookup can race it — retry a few times before warning.
  let host = await lookupHostname(HOSTNAME);
  for (let i = 0; i < 2 && !host.ok; i++) {
    await new Promise((r) => setTimeout(r, 1200));
    host = await lookupHostname(HOSTNAME);
  }
  const hostOk = host.ok && host.address === EXPECTED_IP;
  // Also accept resolution to the currently-advertised LAN IP (DHCP case).
  const hostOkAny = host.ok && (host.address === EXPECTED_IP || ips.includes(host.address));

  const localUrl = port === 80 ? `http://localhost` : `http://localhost:${port}`;
  const networkUrl = fmtUrl(EXPECTED_IP);
  const mdnsUrl = fmtUrl(HOSTNAME);

  console.log('');
  console.log('+------------------------------------------+');
  console.log('|               Open Send                |');
  console.log('+------------------------------------------+');
  console.log('');
  console.log('Server:');
  console.log('  Running (listening on 0.0.0.0, LAN + local)');
  console.log('');
  console.log('Local:');
  console.log(`  ${localUrl}`);
  console.log('');
  console.log('Network:');
  console.log(`  ${networkUrl}`);
  console.log('');

  if (!hasExpected) {
    console.log('Open Send Network Warning');
    console.log('');
    console.log('Expected server IP:');
    console.log(EXPECTED_IP);
    console.log('');
    console.log('Current network configuration does not contain this IP.');
    console.log('');
    console.log(`${HOSTNAME} may not work correctly.`);
    console.log('');
    console.log('Please verify the network adapter configuration.');
    console.log(`Detected IPv4: ${ips.join(', ') || '(none)'}`);
    console.log('');
    console.log('The server keeps running — other devices can use the detected IP above');
    console.log('via the Admin > System panel until the address is fixed.');
    console.log('');
  }

  if (hostOk) {
    console.log('mDNS:');
    console.log(`  [OK] ${HOSTNAME}`);
    console.log('');
    console.log('Network Access:');
    console.log('  [Ready] Students open: ' + mdnsUrl);
  } else if (hostOkAny && host.ok) {
    console.log('mDNS:');
    console.log(`  [OK] ${HOSTNAME} -> ${host.address} (expected ${EXPECTED_IP})`);
    console.log('');
    console.log('Network Access:');
    console.log('  [Ready] Students open: ' + mdnsUrl);
    if (!hasExpected) {
      console.log('  Note: fixed IP not assigned — hostname points at the current DHCP address.');
    }
  } else {
    console.log('[!] mDNS unavailable');
    console.log('');
    if (host.ok) {
      console.log(`  ${HOSTNAME} resolved to ${host.address}, expected ${EXPECTED_IP}.`);
    } else {
      console.log(`  ${HOSTNAME} could not be resolved (${host.error || 'unknown error'}).`);
      console.log('');
      console.log('  Open Send is still running on:');
      console.log(`  ${networkUrl}`);
    }
    console.log('');
    console.log('Troubleshooting:');
    console.log('  Check Bonjour/mDNS and Windows Firewall.');
    console.log('  1) Run scripts\\setup-btec-lan.bat as Administrator (opens firewall + checks IP).');
    console.log('  2) Allow UDP 5353 (mDNS) once:');
    console.log('     New-NetFirewallRule -DisplayName "mDNS (UDP 5353)" -Direction Inbound -Protocol UDP -LocalPort 5353 -Action Allow -Profile Private');
    console.log('  3) Older Android (<12) cannot resolve .local — those devices use the IP URL.');
  }

  // Private / Public profile warning (Windows only, never changes the profile).
  try {
    const cats = windowsProfile();
    if (cats && cats.some((c) => /public/i.test(c))) {
      console.log('');
      console.log('Open Send Network');
      console.log('');
      console.log('Your current Windows network profile is Public.');
      console.log('');
      console.log('Open Send is designed for trusted local networks.');
      console.log('');
      console.log('Please verify the network before allowing other devices to connect.');
    }
  } catch {}

  console.log('');
}

main().then(() => process.exit(0)).catch(() => process.exit(0));
