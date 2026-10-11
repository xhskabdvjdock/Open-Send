@echo off
REM ============================================================
REM  Open Send - public access for one session (foreground)
REM  Requires: Open Send already running (start-lan.bat) and
REM  cloudflared installed. No account needed (Quick Tunnel).
REM  Closing this window stops PUBLIC access only - the local
REM  server and LAN keep running untouched.
REM ============================================================
setlocal EnableDelayedExpansion
title Open Send - public tunnel (this window)

set PORT=80
if not "%~1"=="" set PORT=%~1

echo Checking local Open Send on http://127.0.0.1:!PORT! ...
powershell -NoProfile -Command "try { if ((Invoke-WebRequest -UseBasicParsing http://127.0.0.1:%PORT%/api/health -TimeoutSec 8).StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Open Send is not answering on port !PORT!.
  echo Start it first with start-lan.bat, then run this again.
  echo (For port 3000: start-public.bat 3000^)
  pause
  exit /b 1
)
where cloudflared >nul 2>&1
if errorlevel 1 (
  echo [ERROR] cloudflared not found. Run scripts\cloudflare-setup.bat first.
  pause
  exit /b 1
)
echo.
echo Local server OK. Starting Quick Tunnel - copy the https URL below
echo and test login, chat, upload and download from outside the school.
echo Close THIS window to take public access offline again.
echo.
cloudflared tunnel --url http://127.0.0.1:!PORT!
