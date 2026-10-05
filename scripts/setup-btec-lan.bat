@echo off
REM Open Send - automatic LAN setup for btec-send.local (Windows).
REM Run this ONCE on the server PC. It self-elevates for the firewall step.
REM Non-destructive: never disables the firewall, never changes your IP,
REM only adds allow rules for the app TCP port + mDNS UDP 5353 (Private).
cd /d "%~dp0"
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting administrator rights (needed ONLY for the firewall rule)...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0btec-lan-setup.ps1"
pause
