@echo off
REM ============================================================
REM  Open Send - Cloudflare Tunnel as a Windows Service
REM  - Starts automatically with Windows, restarts on failure
REM  - Open Send itself is untouched: stopping the tunnel only
REM    takes public access offline; LAN keeps working.
REM  - Run as Administrator (auto-requests elevation).
REM  - The tunnel token is asked interactively and is NEVER
REM    written to disk or git by this script.
REM ============================================================
setlocal EnableDelayedExpansion

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting administrator rights (needed to manage Windows services^)...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)

title Open Send - Tunnel Windows Service
where cloudflared >nul 2>&1
if errorlevel 1 (
  echo [ERROR] cloudflared not found. Run scripts\cloudflare-setup.bat first.
  pause
  exit /b 1
)

echo ================================================
echo  Cloudflare Tunnel - Windows Service
echo  [1] Install + start service
echo  [2] Service status
echo  [3] Stop service
echo  [4] Remove service (rollback to local-only^)
echo ================================================
echo.
set CHOICE=
set /p CHOICE="Choice [1-4]: "

if "!CHOICE!"=="1" goto :install
if "!CHOICE!"=="2" goto :status
if "!CHOICE!"=="3" goto :stop
if "!CHOICE!"=="4" goto :remove
echo Unknown choice.
pause
exit /b 1

:install
echo.
echo Two ways to run the service (token is typed, never stored^):
echo   [T] Tunnel TOKEN (from Zero Trust dashboard - easiest, no files needed^)
echo   [C] Config FILE (already created by cloudflare-setup.bat^)
echo.
set MODE=
set /p MODE="Mode [T/C]: "
if /i "!MODE!"=="T" goto :install_token
if /i "!MODE!"=="C" goto :install_config
echo Unknown choice.
pause
exit /b 1

:install_token
echo.
echo Paste the tunnel TOKEN now (input stays in this window only^).
echo Get it from: Cloudflare dashboard - Zero Trust - Networks - Tunnels -
echo select tunnel - Install and run a connector - copy the token string.
echo.
set "TOKEN="
set /p "TOKEN=Token: "
if "!TOKEN!"=="" (
  echo [ERROR] Empty token. Aborting - nothing was installed.
  pause
  exit /b 1
)
echo Installing service...
call cloudflared service install !TOKEN!
set "TOKEN="
if errorlevel 1 (
  echo [ERROR] Service install failed. See messages above.
  pause
  exit /b 1
)
goto :recovery

:install_config
set CFGF=%USERPROFILE%\.cloudflared\config-opensend.yml
set /p CFGF="Config file path [!CFGF!]: "
if not exist "!CFGF!" (
  echo [ERROR] Config file not found: !CFGF!
  echo Create it with scripts\cloudflare-setup.bat first.
  pause
  exit /b 1
)
echo Installing service with: !CFGF!
echo Syncing config + credentials for the SYSTEM account service path...
if not exist "C:\Windows\System32\config\systemprofile\.cloudflared" mkdir "C:\Windows\System32\config\systemprofile\.cloudflared" >nul 2>&1
copy /y "!CFGF!" "C:\Windows\System32\config\systemprofile\.cloudflared\config.yml" >nul 2>&1
for %%F in ("!CFGF!") do set CFGD=%%~dpF
copy /y "!CFGD!*.json" "C:\Windows\System32\config\systemprofile\.cloudflared\" >nul 2>&1
copy /y "!CFGF!" "%USERPROFILE%\.cloudflared\config.yml" >nul 2>&1
echo Removing any previous Cloudflared service entry...
sc stop Cloudflared >nul 2>&1
call cloudflared service uninstall >nul 2>&1
sc delete Cloudflared >nul 2>&1
timeout /t 3 /nobreak >nul
echo Creating service with explicit tunnel command...
set CFEXE=C:\Program Files (x86)\cloudflared\cloudflared.exe
for /f "delims=" %%E in ('where cloudflared 2^>nul') do set CFEXE=%%E
echo Using: !CFEXE!
sc create Cloudflared binPath= "\"!CFEXE!\" tunnel --config \"C:\Windows\System32\config\systemprofile\.cloudflared\config.yml\" run" DisplayName= "Cloudflared - Open Send Tunnel" start= auto obj= LocalSystem >nul 2>&1
sc query Cloudflared >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Service install failed and service not found. See messages above.
  pause
  exit /b 1
)
echo Service entry present - configuring startup and starting...
goto :recovery

:recovery
echo Setting restart-on-failure (first: 1 min, then: 5 min^)...
sc failure Cloudflared reset= 86400 actions= restart/60000/restart/300000 >nul
sc config Cloudflared start= auto >nul
sc stop Cloudflared >nul 2>&1
timeout /t 4 /nobreak >nul
sc start Cloudflared >nul 2>&1
timeout /t 8 /nobreak >nul
sc query Cloudflared | findstr /i STATE
echo.
echo Done. The tunnel starts with Windows from now on.
echo Test your public URL from outside the school network.
pause
exit /b 0

:status
sc query Cloudflared
tasklist | findstr /i cloudflared
pause
exit /b 0

:stop
net stop Cloudflared
echo Tunnel stopped. LAN access is unaffected. Start again any time.
pause
exit /b 0

:remove
echo This removes ONLY the Cloudflare Tunnel service.
echo Open Send, its data and LAN access are untouched.
net stop Cloudflared >nul 2>&1
sc delete Cloudflared
echo Removed. You are back to local-only Open Send.
pause
exit /b 0
