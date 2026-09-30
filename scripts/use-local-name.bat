@echo off
REM Open Send — use a pretty local name on THIS PC only (e.g. http://open-send.btec).
REM Adds an entry to the Windows hosts file. Affects this PC only, NOT phones.
REM Phones keep using http://YOUR-SERVER-IP or http://opensend.local
setlocal EnableDelayedExpansion

REM --- ask for admin rights if needed ---
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting administrator rights...
  powershell -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)

set DOMAIN=open-send.btec
set LANIP=
REM Detect Wi-Fi/LAN IPv4, skipping VirtualBox and disconnected adapters
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
  set ip=%%a
  set ip=!ip: =!
  echo !ip! | findstr /b "192.168.56." >nul
  if errorlevel 1 set LANIP=!ip!
)

if "!LANIP!"=="" (
  echo Could not detect LAN IP. Edit this file and set LANIP manually.
  pause
  exit /b 1
)

set HOSTS=%SystemRoot%\System32\drivers\etc\hosts
findstr /i /c:"!DOMAIN!" "%HOSTS%" >nul
if %errorlevel%==0 (
  echo Entry already exists in hosts file.
) else (
  echo.>> "%HOSTS%"
  echo !LANIP! !DOMAIN!>> "%HOSTS%"
  echo Added: !LANIP! !DOMAIN!
)

ipconfig /flushdns >nul
echo.
echo Done. Open in this PC browser: http://!DOMAIN!
echo (Phones are NOT affected - they use the IP or opensend.local)
pause
