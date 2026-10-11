@echo off
REM ============================================================
REM  Open Send - Cloudflare Tunnel interactive setup (Windows)
REM  Prepares public HTTPS access WITHOUT router changes:
REM    A) Quick Tunnel - free temporary URL, no account needed
REM    B) Named tunnel - stable URL, needs a free Cloudflare account
REM  This script never stores tokens. Nothing is committed to git.
REM  Full guide: docs\cloudflare-tunnel.md
REM ============================================================
setlocal EnableDelayedExpansion
title Open Send - Cloudflare Tunnel setup

echo ================================================
echo  Open Send - public access via Cloudflare Tunnel
echo  Local LAN keeps working with or without this.
echo ================================================
echo.

REM ---------- 0. Open Send must be running locally ----------
echo [0/4] Checking local Open Send on http://127.0.0.1:80 ...
powershell -NoProfile -Command "try { if ((Invoke-WebRequest -UseBasicParsing http://127.0.0.1:80/api/health -TimeoutSec 8).StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Open Send is not answering on port 80.
  echo Start it first with start-lan.bat, then run this again.
  pause
  exit /b 1
)
echo Local server OK.
echo.

REM ---------- 1. cloudflared ----------
echo [1/4] Checking cloudflared ...
where cloudflared >nul 2>&1
if errorlevel 1 (
  echo cloudflared not found. Trying automatic install via winget...
  where winget >nul 2>&1
  if errorlevel 1 (
    echo [ERROR] winget not found. Install manually:
    echo https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
    pause
    exit /b 1
  )
  winget install -e --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements
  for /f "delims=" %%p in ('powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"') do set "PATH=%%p"
)
where cloudflared >nul 2>&1
if errorlevel 1 (
  echo [ERROR] cloudflared still not found. Close this window, reopen it, run again.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('cloudflared --version 2^>^&1') do echo %%v - OK
echo.

REM ---------- 2. choose mode ----------
echo [2/4] Choose tunnel mode:
echo   [Q] Quick Tunnel - free, no account, temporary public URL. Best for a first test.
echo   [N] Named tunnel - stable URL or your own domain. Needs a free Cloudflare account.
echo.
set MODE=Q
set /p MODE="Mode [Q/N] (default Q): "
if /i "!MODE!"=="" set MODE=Q

if /i "!MODE!"=="Q" goto :quick
if /i "!MODE!"=="N" goto :named
echo Unknown choice. Run again and type Q or N.
pause
exit /b 1

:quick
echo.
echo [3/4] Quick Tunnel needs no configuration and no files.
echo A window will open with your temporary https URL. Copy it and test
echo login, chat, upload and download from outside the school.
echo Keep that window open while public access is needed (Ctrl+C stops
echo the tunnel only - Open Send keeps running locally^).
echo.
pause
cloudflared tunnel --url http://127.0.0.1:80
exit /b 0

:named
echo.
echo [3/4] Named tunnel setup. You do the account steps yourself -
echo nothing secret is typed into scripts or stored in git.
echo.
echo Step A - login (opens your browser; log in with your Cloudflare account^):
pause
call cloudflared tunnel login
if errorlevel 1 (
  echo [ERROR] Login did not complete. Run again when ready.
  pause
  exit /b 1
)
echo.
set TUNNAME=opensend
set /p TUNNAME="Step B - tunnel name [opensend]: "
if "!TUNNAME!"=="" set TUNNAME=opensend
echo Creating tunnel "!TUNNAME!" ...
call cloudflared tunnel create "!TUNNAME!"
if errorlevel 1 (
  echo [ERROR] Tunnel creation failed. If it already exists, reuse it with:
  echo   cloudflared tunnel route dns "!TUNNAME!" YOUR_PUBLIC_HOSTNAME
  pause
  exit /b 1
)
echo.
echo Step C - point your public hostname at the tunnel. Either:
echo   - run: cloudflared tunnel route dns "!TUNNAME!" YOUR_PUBLIC_HOSTNAME
echo   - or add a CNAME in the Cloudflare dashboard pointing at !TUNNAME!.cfargotunnel.com
echo.
set PUBHOST=
set /p PUBHOST="Step D - type your public hostname (example: send-school.example.com): "
if "!PUBHOST!"=="" (
  echo [ERROR] A hostname is required for a named tunnel.
  pause
  exit /b 1
)
call cloudflared tunnel route dns "!TUNNAME!" "!PUBHOST!"
echo.
echo [4/4] Writing LOCAL config (outside git^) ...
set CFDIR=%USERPROFILE%\.cloudflared
if not exist "!CFDIR!" mkdir "!CFDIR!" 2>nul
set CFGF=!CFDIR!\config-opensend.yml
for /f "tokens=*" %%i in ('cloudflared tunnel info "!TUNNAME!" 2^>^&1 ^| findstr /i /c:"id"') do echo %%i
echo NOTE: open the tunnel JSON credentials path shown above and paste the
echo values below. Get the tunnel ID with: cloudflared tunnel list
echo.
set TUNID=
set /p TUNID="Tunnel ID: "
if "!TUNID!"=="" (
  echo [ERROR] Tunnel ID is required.
  pause
  exit /b 1
)
(
  echo # Generated locally by cloudflare-setup.bat - NEVER commit this file.
  echo tunnel: !TUNID!
  echo credentials-file: !CFDIR!\!TUNID!.json
  echo ingress:
  echo   - hostname: !PUBHOST!
  echo     service: http://127.0.0.1:80
  echo   - service: http_status:404
) > "!CFGF!"
echo Wrote: !CFGF!
echo.
echo Optional: record the public URL for the admin dashboard (shows QR):
echo   add to .env (never git^): OPEN_SEND_PUBLIC_URL=https://!PUBHOST!
echo   then restart Open Send once.
echo.
echo Next: install the auto-start Windows service with:
echo   scripts\cloudflare-tunnel-service.bat
pause
exit /b 0
