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
echo Open Send is starting for the local network...
echo Students open: http://YOUR-SERVER-IP:3000
echo Admin (hidden): http://YOUR-SERVER-IP:3000/webadmin
echo.
call npm run start
