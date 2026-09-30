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
echo Admin (hidden): http://YOUR-SERVER-IP/webadmin
echo.
echo If port 80 is busy, run: npm run start:3000
echo.
call npm run start
