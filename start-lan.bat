@echo off
REM Open Send — start for LAN access (binds 0.0.0.0:3000)
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
if not exist .next (
  echo Building...
  call npm run build
)
echo.
echo Open Send is starting for the local network (port 80, no :port needed)...
echo Students open: http://YOUR-SERVER-IP
echo Or by local name (no setup needed): http://opensend.local
echo Admin (hidden): http://YOUR-SERVER-IP/webadmin
echo.
echo If port 80 is busy, run: npm run start:3000
echo.
REM Zero-config local DNS: advertise http://opensend.local on the LAN (mDNS).
REM Runs in the background of this window; closes with it. Needs UDP 5353
REM allowed once: New-NetFirewallRule -DisplayName "mDNS (UDP 5353)" -Direction Inbound -Protocol UDP -LocalPort 5353 -Action Allow -Profile Private
start /b node scripts\mdns.mjs
call npm run start
