@echo off
REM Open Send — set up Acrylic DNS Proxy to serve open-send.btec on the LAN.
REM Run as administrator (auto-requests elevation). Requires Acrylic installed:
REM   https://mayakron.altervista.org  (Acrylic DNS Proxy, Setup for Windows)
REM What this does:
REM   1. Stops Technitium DNS Server if running (frees port 53)
REM   2. Binds Acrylic to all interfaces + allows your LAN subnet
REM   3. Adds "LAN-IP open-send.btec www.open-send.btec" to AcrylicHosts.txt
REM   4. Opens UDP+TCP 53 in the firewall + restarts Acrylic + tests it
setlocal EnableDelayedExpansion

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting administrator rights...
  powershell -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)

set ACRYLIC=
if exist "%ProgramFiles%\Acrylic DNS Proxy\AcrylicConfiguration.ini" set ACRYLIC=%ProgramFiles%\Acrylic DNS Proxy
if exist "%ProgramFiles(x86)%\Acrylic DNS Proxy\AcrylicConfiguration.ini" set ACRYLIC=%ProgramFiles(x86)%\Acrylic DNS Proxy
if "!ACRYLIC!"=="" (
  echo [ERROR] Acrylic DNS Proxy not found.
  echo Install it first: https://mayakron.altervista.org  -^> Acrylic DNS Proxy -^> Setup for Windows
  pause
  exit /b 1
)
echo [1/6] Acrylic found: !ACRYLIC!

REM Detect LAN IPv4, skipping VirtualBox
set LANIP=
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
  set ip=%%a
  set ip=!ip: =!
  echo !ip! | findstr /b "192.168.56." >nul
  if errorlevel 1 set LANIP=!ip!
)
if "!LANIP!"=="" (
  echo [ERROR] Could not detect LAN IP.
  pause
  exit /b 1
)
for /f "tokens=1-4 delims=." %%a in ("!LANIP!") do set SUBNET=%%a.%%b.%%c.0/24
echo [2/6] LAN IP: !LANIP!  Subnet: !SUBNET!

REM Free port 53 (Technitium owns it if installed)
echo [3/6] Stopping Technitium DNS Server if present (frees port 53)...
sc stop "Technitium DNS Server" >nul 2>&1
sc config "Technitium DNS Server" start= demand >nul 2>&1
sc stop "DnsService" >nul 2>&1

REM Backup + patch config + hosts via helper script (tested logic)
echo [4/6] Configuring Acrylic (bind all interfaces + allow LAN)...
copy /y "!ACRYLIC!\AcrylicConfiguration.ini" "!ACRYLIC!\AcrylicConfiguration.ini.bak" >nul
copy /y "!ACRYLIC!\AcrylicHosts.txt" "!ACRYLIC!\AcrylicHosts.txt.bak" >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0acrylic-configure.ps1" -Ini "!ACRYLIC!\AcrylicConfiguration.ini" -Subnet "!SUBNET!" -HostsFile "!ACRYLIC!\AcrylicHosts.txt" -LanIp "!LANIP!"
echo [5/6] Config + hosts updated (backups saved as *.bak).

REM Firewall + restart service + test
netsh advfirewall firewall delete rule name="Acrylic DNS (UDP 53)" >nul 2>&1
netsh advfirewall firewall delete rule name="Acrylic DNS (TCP 53)" >nul 2>&1
netsh advfirewall firewall add rule name="Acrylic DNS (UDP 53)" dir=in action=allow protocol=UDP localport=53 profile=any >nul
netsh advfirewall firewall add rule name="Acrylic DNS (TCP 53)" dir=in action=allow protocol=TCP localport=53 profile=any >nul
echo [6/6] Restarting AcrylicDNSProxySvc...
net stop AcrylicDNSProxySvc >nul 2>&1
net start AcrylicDNSProxySvc >nul 2>&1
timeout /t 2 /nobreak >nul
echo.
echo Test: nslookup open-send.btec 127.0.0.1
nslookup open-send.btec 127.0.0.1
echo.
echo Done. Phones/PCs must use !LANIP! as their DNS (router DHCP once, or manual).
echo Then open from any device: http://open-send.btec
echo (Backups saved as *.bak next to the originals.)
pause
