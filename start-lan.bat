@echo off
REM Open Send - start for LAN access (binds 0.0.0.0:80, no :port in the URL)
REM Primary address: http://btec-send.local  (server IP 192.168.1.118, mDNS)
REM Fallback:        http://192.168.1.118
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
echo Students open: http://btec-send.local
echo Fallback IP : http://192.168.1.118
echo Admin (hidden): http://btec-send.local/webadmin
echo.
echo First time on this PC? Run scripts\setup-btec-lan.bat as Administrator
echo (checks 192.168.1.118, mDNS, Private profile, firewall for TCP 80).
echo.
echo If port 80 is busy, run: npm run start:3000  (then http://btec-send.local:3000)
echo.
REM Zero-config local DNS: advertise http://btec-send.local on the LAN (mDNS).
REM Runs in the background of this window; closes with it. Needs UDP 5353
REM allowed once: New-NetFirewallRule -DisplayName "mDNS (UDP 5353)" -Direction Inbound -Protocol UDP -LocalPort 5353 -Action Allow -Profile Private
start /b node scripts\mdns.mjs
REM Startup network validation (IP + hostname + banner) runs inside `npm run start`
REM (see package.json) so it is not duplicated here. Never blocks startup.
REM Built-in fallback DNS server (open-send.btec). Only starts if port 53 is free.
REM If Technitium DNS Server is installed (recommended), it owns port 53 instead -
REM use its web console http://localhost:5380 to add the open-send.btec zone.
REM Manual start when needed: node scripts\dns.mjs
call npm run start
