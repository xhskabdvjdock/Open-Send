# Open Send — Public Access via Cloudflare Tunnel

Open Send stays a **local-first** app. This document adds an **optional**
public HTTPS gateway in front of the same local server — no VPS, no port
forwarding, no router changes, everything free.

```text
Internet
   ↓
Cloudflare (HTTPS)
   ↓
Cloudflare Tunnel (outbound from your server, no inbound ports)
   ↓
Windows Server — Open Send on http://127.0.0.1:80
   ↓ (unchanged)
School LAN — http://<local-hostname>
```

Local access keeps working with or without the tunnel, with or without
internet. Stopping the tunnel takes public access offline only.

> Status in THIS project: the app is fully prepared (same-origin code, hardened
> headers, sanitized health endpoint, admin diagnostics). Creating the actual
> tunnel (account login) is a manual step for the school admin — see Step 2.
> Until then the admin panel shows Public as **Not configured yet**.

---

## Costs (all free)

| Part | Cost |
|---|---|
| `cloudflared` connector | Free (open source) |
| Quick Tunnel (temporary `*.trycloudflare.com` URL) | Free, no account |
| Named tunnel + Cloudflare account | Free (custom domain requires a domain you already own + free Cloudflare DNS) |
| Extra ports, VPS, hosting, database, messaging | **None needed** |

Nothing in this setup is paid. If anyone asks you to pay for port forwarding
or hosting to expose Open Send, you do not need it.

---

## Step 1 — Install cloudflared (server PC)

Option A (automatic): run `scripts\cloudflare-setup.bat` — it installs via
winget if missing.

Option B (manual): https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

Verify:

```bat
cloudflared --version
```

## Step 2 — Choose: Quick Tunnel or named tunnel

### Option A — Quick Tunnel (recommended first test)

No account, no files, temporary public URL. Best to verify everything works
before any commitment:

```bat
start-public.bat
```

Requirements: Open Send already running (`start-lan.bat`). A window prints
your temporary `https://....trycloudflare.com` URL. Keep it open while public
access is needed; **Ctrl+C stops public access only** — LAN keeps running.

### Option B — Named tunnel (stable URL / own domain)

Needs a **free** Cloudflare account. The login/creation steps are yours to run
(nothing secret is typed into project scripts or stored in git):

```bat
scripts\cloudflare-setup.bat
```

Choose `N`, then follow it:

1. `cloudflared tunnel login` — opens YOUR browser; log in with your account.
2. `cloudflared tunnel create opensend` (or any name).
3. Point the hostname at the tunnel:
   `cloudflared tunnel route dns opensend YOUR_PUBLIC_HOSTNAME`,
   or add a CNAME in the Cloudflare dashboard to
   `opensend.cfargotunnel.com`.
4. The script writes a LOCAL config to
   `%USERPROFILE%\.cloudflared\config-opensend.yml` (outside git — template
   with no secrets lives at `cloudflare/tunnel.example.yml`).
5. Optional: save the URL for the admin dashboard QR by adding to `.env`
   (never committed):
   `OPEN_SEND_PUBLIC_URL=https://YOUR_PUBLIC_HOSTNAME`
   then restart Open Send once.

## Step 3 — Point the tunnel at Open Send

Ingress target (production port is 80; use 3000 only if you run `start:3000`):

```text
http://127.0.0.1:80
```

Realtime chat needs **no extra rule**: it is Server-Sent Events over the same
HTTPS connection (no separate WebSocket port, no `ws://` URLs anywhere in the
app — all requests are relative, so `wss://your-url/...` works automatically).

## Step 4 — Run the tunnel

Foreground test: `start-public.bat` (Quick Tunnel).

## Step 5 — Install as a Windows Service (permanent)

```bat
scripts\cloudflare-tunnel-service.bat   (run as Administrator)
```

Menu: install (token OR config file), status, stop, remove.
The service starts with Windows and restarts on failure. Token is typed
interactively and never written to disk or git by the script.

Startup order needs no special handling: if Open Send is down, the tunnel
serves 502 and recovers alone when the server is back.

## Step 6 — Find your Public URL

- Quick Tunnel: printed in its window.
- Named: the hostname you routed in Step 2 (`https://YOUR_PUBLIC_HOSTNAME`).
- Admin view: `/webadmin/network` shows Tunnel Status / Public URL / HTTPS /
  realtime, plus a QR code once `OPEN_SEND_PUBLIC_URL` is set.

## Step 7 — Test from outside the school

With mobile data (NOT school Wi-Fi), verify in order:

1. Open the public URL → login page loads over HTTPS.
2. Student login → stays logged in across refresh + another page.
3. Send a file to another student → accept → download works.
4. Teacher login → open a folder → download a submission.
5. Chat both ways (one device inside on LAN, one outside): messages arrive
   live, no refresh.
6. Admin login → `/webadmin` works; add banned word `testword` (10 min);
   an outside student sending `hello testword` must be blocked + suspended
   with countdown, and the violation visible in admin logs.
7. Logout → session ends (protected pages redirect to login).

## Step 8 — Security checks (from outside)

- `/webadmin` without login → redirected to admin login.
- Any `/api/admin/*` without admin cookie → 401.
- `/api/health` returns only `{ok, status, time}` — no hostnames, IPs,
  versions or paths.
- Upload a blocked type / oversized file → rejected with 4xx.
- 11 wrong logins in 5 minutes → 429 cooldown (student, teacher and admin).
- Disabled accounts answer exactly like wrong passwords (no enumeration).

## Firewall & router

- **Nothing to open.** The tunnel dials OUT to Cloudflare; no inbound LAN
  port and no router port forwarding is used for public access.
- Keep the existing LAN rules only (`Open Send Server` TCP 80 + `mDNS`
  UDP 5353, Private). Never disable Windows Firewall.

## Offline behavior

- Internet down → public URL stops (expected), LAN keeps working fully.
- Tunnel process stopped → same: public offline, LAN online.
- The tunnel is never required for LAN: `start-lan.bat` does not start it
  and does not depend on it.

## Rollback to local-only (no rebuild)

1. `scripts\cloudflare-tunnel-service.bat` → Remove service (or Ctrl+C the
   Quick Tunnel window).
2. Optional: remove `OPEN_SEND_PUBLIC_URL` from `.env` and restart once
   (hides the Public block from the admin panel).
3. Done — LAN-only Open Send, zero code changes.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Quick Tunnel URL gives 502 | Open Send not running on port 80 → `start-lan.bat` first |
| Named tunnel 404 | Hostname route/DNS not done (Step 2C) or wrong local port in config |
| Login loops on public URL | Cookies blocked? Use normal (non-incognito) browser; HTTPS required (tunnel provides it) |
| Chat not live outside | Check the tunnel window for SSE/stream errors; reconnect happens automatically |
| Slow first load | Same cold-DNS note as LAN docs; subsequent loads are fast |
| Service won't start | Run service script as Administrator; verify config path + token |

## Notes & limits (honest)

- **No live tunnel exists yet** — account login must be done by the school
  admin (see Step 2). Nothing here claims otherwise.
- Admin 2FA is **not implemented** (login stays username+password with
  rate limiting + audit). Optional extra layer: Cloudflare Access in front
  of `/webadmin` (free tier available) — intentionally not wired in.
- Login rate-limit keys use the client IP as seen by the server
  (`X-Forwarded-For`, as before). A client can spoof that header on direct
  LAN access exactly as before — the tunnel does not change this posture.
- No CSP header is emitted on purpose (the app uses an inline theme script);
  no HSTS is emitted on purpose (it would force-HTTPS the LAN hostname and
  break local access — enable HSTS in the Cloudflare dashboard instead).
