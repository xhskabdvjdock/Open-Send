# Open Send — Local Network Setup (`btec-send.local`)

Students on the same school network open:

```text
http://btec-send.local
```

No app to install, no per-device configuration. If the name does not work on a
device, use the fallback IP address:

```text
http://192.168.1.118
```

The server runs on port **80**, so there is no `:port` in the URL.
(Only if port 80 is busy do we use `:3000` — see below.)

---

## 1. Required network configuration

| Item | Value |
|---|---|
| Server IPv4 | `192.168.1.118` (fixed — set once on the server PC) |
| Hostname | `btec-send.local` (automatic via mDNS, no DNS server needed) |
| Port | `80` (production). Dev / busy-port fallback: `3000` |
| Bind | `0.0.0.0` (LAN + local — already configured in `package.json`) |
| Scope | Local network only. No port forwarding, no public DNS, no internet exposure. |

Set the fixed IP once on the **server PC**:

1. Windows Settings → Network → Wi-Fi/Ethernet → adapter properties.
2. IPv4 → Manual → IP `192.168.1.118`, subnet `255.255.255.0`, gateway = your router
   (usually `192.168.1.1`), DNS = router or `8.8.8.8`.
3. The network profile must be **Private**, not Public
   (Settings → Network → connection → Private).

The app never changes your IP automatically — if `192.168.1.118` is missing you
get a warning at startup and in Admin, and the server keeps working via whatever
IP the machine currently has.

Centralized overrides (see `lib/network.ts`, `.env.example`):

```text
OPEN_SEND_HOST=192.168.1.118        (alias OPENSEND_HOST_IP)
OPEN_SEND_HOSTNAME=btec-send.local  (alias OPENSEND_HOSTNAME)
```

---

## 2. One-time automatic setup (server PC)

On the server PC, right-click and run as Administrator:

```text
scripts\setup-btec-lan.bat
```

It performs 10 checks and fixes only what is safe:

1. Detects Windows.
2. Lists network adapters / IPv4 addresses.
3. Verifies `192.168.1.118` is assigned.
4. Warns (does not change anything) if the IP differs.
5. Checks mDNS availability (Node + `multicast-dns` + UDP 5353 rule).
6. Creates the firewall rule **`Open Send Server` (TCP inbound, port 80, Private)**.
   Admin is required here — Windows blocks inbound LAN connections by default,
   and exactly one port is opened. The firewall is never disabled.
7. Verifies the server binds `0.0.0.0` (not localhost-only).
8. Verifies the server answers locally (`/api/health`).
9. Tests that `btec-send.local` resolves.
10. Prints a final status table.

Also run once (admin PowerShell) if you skip the script:

```powershell
New-NetFirewallRule -DisplayName "Open Send Server" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "mDNS (UDP 5353)" -Direction Inbound -Protocol UDP -LocalPort 5353 -Action Allow -Profile Private
```

---

## 3. How to start Open Send

```bat
npm install
npm run build
npm run start
```

or simply:

```text
start-lan.bat
```

What happens at startup:

- `scripts/mdns.mjs` starts in the background and advertises
  `btec-send.local` → `192.168.1.118` using the existing `multicast-dns`
  dependency (real mDNS/Bonjour on UDP 5353 — not a frontend redirect).
- `scripts/network-check.mjs` validates the IP, tries to resolve the hostname,
  checks the Windows Private/Public profile, and prints a banner:

```text
Server:
  Running

Local:
  http://localhost

Network:
  http://192.168.1.118

mDNS:
  btec-send.local

Network Access:
  Ready
```

If mDNS fails you still get:

```text
Network access:
  http://192.168.1.118

Troubleshooting:
  Check Bonjour/mDNS and Windows Firewall.
```

Development mode is unchanged (`npm run dev` → `http://localhost:3000`,
also reachable via `http://btec-send.local:3000` on the LAN).

If port 80 is busy:

```bat
npm run start:3000
```

then the address becomes `http://btec-send.local:3000`
(fallback `http://192.168.1.118:3000`).

---

## 4. How students connect

On the Admin → System → Network panel you find the address, a **Copy Address**
button, and a QR code (generated locally — never sent to an external service).

Tell students:

```text
To connect another device:

1. Connect it to the same local network.
2. Open a browser.
3. Go to:

http://btec-send.local
```

- Use `http`, not `https`.
- No app install needed.
- iPhone works out of the box; Android 12+ and Windows work too.
- Android older than 12 cannot resolve `.local` names — those devices use
  `http://192.168.1.118` directly.

The login page shows a small `Open Send · Local Network · btec-send.local`
indicator so students know they are in the right place.

---

## 5. How to verify `btec-send.local`

From the server PC:

```bat
node scripts/network-check.mjs
```

### If the first page load takes a few seconds

That delay is name resolution, not the server (the server answers in
milliseconds — the homepage also fetches the minimum: one count request plus
one parallel batch, no duplicates):

- **On the server PC / Windows clients:** run `scripts\setup-btec-lan.bat` as
  admin — it adds a `192.168.1.118 btec-send.local` hosts entry (backed up
  first), so resolution becomes instant. Without it, Windows' cold `.local`
  lookup alone can cost ~3 seconds; afterwards the result is cached and loads
  are fast.
- **On phones:** no setup needed — iPhone and Android 12+ resolve `.local`
  natively and fast via mDNS.
- If `http://192.168.1.118` is equally slow, the cause is not DNS — check Wi-Fi
  signal, router load, and free RAM/disk on the server.

From any other device (same Wi-Fi, mobile data/VPN off):

- Browser: open `http://btec-send.local` (expect the login page).
- Windows: `ping btec-send.local` should reply from `192.168.1.118`.
- Admin panel: open `/webadmin/network` — every row should be ✓:

```text
Server IP   ✓ 192.168.1.118
Hostname    ✓ btec-send.local
HTTP Server ✓ Running
mDNS        ✓ Active
Firewall    ✓ Configured
Local Access✓ Working
```

The **Copy Diagnostics** button produces a password/token-free summary for
support messages.

---

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `btec-send.local` does not open | Use `http://192.168.1.118`; then check: same Wi-Fi? mobile data/VPN off? `http` not `https`? mDNS advertiser running (`start-lan.bat` starts it)? UDP 5353 allowed? |
| Startup warning: expected IP missing | Set `192.168.1.118` in Windows IPv4 properties (see §1). Server keeps working via the current IP until then. |
| Windows profile is Public | Switch to Private (Settings → Network). The app warns but never changes it for you. |
| Firewall blocks phones | Re-run `scripts\setup-btec-lan.bat` as admin; rule must be TCP 80, Private. |
| Port 80 busy | `npm run start:3000`, address becomes `http://btec-send.local:3000`. |
| Old Android (<12) | No `.local` support — use the IP or QR with the IP URL. |
| Router AP/Client isolation | Some school routers isolate clients — disable AP isolation so devices see each other. |
| Admin shows mDNS Unavailable | Fallback `http://192.168.1.118` is shown automatically; fix UDP 5353 + same subnet. |

---

## 7. What to do if the IP changes

The school router may give the server a different address via DHCP
(e.g. after a restart). You will see at startup:

```text
Open Send Network Warning

Expected server IP:
192.168.1.118

Current network configuration does not contain this IP.

btec-send.local may not work correctly.

Please verify the network adapter configuration.
```

Fix: re-assign `192.168.1.118` in Windows IPv4 settings (static IP or a DHCP
reservation in the router for this PC's MAC address), then restart the server.
Until then, Admin → System shows the currently detected IP(s) so you can share
a working address immediately.

---

## 8. Technical notes (why nothing else had to change)

- **Bind:** `package.json` already uses `-H 0.0.0.0` for `dev`/`start` — LAN
  devices can connect while `localhost` keeps working.
- **URLs:** the entire frontend uses relative paths (`/api/...`), so no
  `localhost`/`127.0.0.1` hard-coding existed to fix. `localhost` remains for
  local development only.
- **CORS/origins:** no CORS config exists (same-origin app) — `http://btec-send.local`
  works without opening anything up, and CORS was deliberately not set to `*`.
- **Real-time:** student chat streams over SSE on the same origin and port
  (`/api/chat/stream`, existing session cookie, no extra firewall ports) —
  works on the local hostname with zero extra setup. Other notifications still
  poll via relative `fetch` every 20s, which is hostname-agnostic.
- **Uploads/downloads:** multipart POST + authenticated GET through API routes —
  verified hostname-agnostic; storage layout (`storage/pending|accepted|…`) untouched.
- **Auth:** `HttpOnly` + `SameSite=Lax` cookies without a `Domain` attribute work
  on any local hostname without weakening security.
- **Security:** local-only by design — no port forwarding, firewall stays on,
  authentication unchanged, admin stays behind its own session on `/webadmin`.

---

## 9. Files involved

- `lib/network.ts` — centralized `OPEN_SEND_HOST` / `OPEN_SEND_HOSTNAME` config.
- `scripts/mdns.mjs` — advertises `btec-send.local` (+ legacy names) via `multicast-dns`.
- `scripts/network-check.mjs` — startup IP/hostname/profile validation + banner.
- `scripts/btec-lan-setup.ps1` + `scripts/setup-btec-lan.bat` — Windows setup + firewall.
- `app/api/admin/network/route.ts` — extended diagnostics API (no secrets).
- `app/webadmin/page.tsx` — Network panel (copy, QR, help, diagnostics link).
- `app/webadmin/network/page.tsx` — `/webadmin/network` diagnostics page.
- `app/login/page.tsx` — local-network indicator.
