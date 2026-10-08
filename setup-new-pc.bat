@echo off
REM ============================================================
REM  Open Send - portable setup from USB (Windows 10 / 11)
REM  Copy THIS file to a flash drive. On any PC, double-click it:
REM    1. installs Node.js 22+ and Git if missing (via winget)
REM    2. clones (or updates) Open Send from GitHub onto the PC
REM    3. installs dependencies and builds the project
REM    4. optionally runs the LAN setup + starts the server
REM  Nothing is installed onto the flash drive itself.
REM ============================================================
chcp 65001 >nul
setlocal EnableDelayedExpansion
title Open Send - تجهيز من الفلاشة

echo ================================================
echo  Open Send - تجهيز نسخة جديدة من GitHub
echo ================================================
echo.

set REPO=https://github.com/xhskabdvjdock/Open-Send.git
set BRANCH=main

REM ---------- 1. Target folder on THIS PC ----------
set TARGET=%~1
if "!TARGET!"=="" set TARGET=%USERPROFILE%\Open-Send
echo [1/6] Folder on this PC: !TARGET!
if not exist "!TARGET!" (
  mkdir "!TARGET!" 2>nul
  if errorlevel 1 (
    echo [ERROR] Could not create "!TARGET!"
    echo Choose another folder and run: setup-new-pc.bat "D:\Your\Folder"
    pause
    exit /b 1
  )
)

REM ---------- 2. Node.js 22+ ----------
echo.
echo [2/6] Checking Node.js ...
where node >nul 2>&1
if errorlevel 1 call :install_node
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install it from https://nodejs.org (LTS 22 or newer^),
  echo then close this window and run this file again.
  pause
  exit /b 1
)
for /f "tokens=1 delims=v." %%v in ('node --version 2^>^&1') do set NODEMAJOR=%%v
if !NODEMAJOR! LSS 22 (
  echo [ERROR] Node.js !NODEMAJOR! is too old. Install LTS 22+ from https://nodejs.org
  pause
  exit /b 1
)
for /f "tokens=* delims=" %%v in ('node --version 2^>^&1') do echo Node.js %%v - OK

REM ---------- 3. Git ----------
echo.
echo [3/6] Checking Git ...
where git >nul 2>&1
if errorlevel 1 call :install_git
where git >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Git not found. Install it from https://git-scm.com/downloads/win,
  echo then close this window and run this file again.
  pause
  exit /b 1
)
for /f "tokens=3" %%v in ('git --version 2^>^&1') do echo Git %%v - OK

REM ---------- 4. Clone or update ----------
echo.
echo [4/6] Getting the project from GitHub ...
if exist "!TARGET!\.git" (
  echo Updating existing copy...
  git -C "!TARGET!" pull --ff-only
  if errorlevel 1 (
    echo [ERROR] Could not update (local changes?^). Delete "!TARGET!" for a fresh copy,
    echo or fix the git state manually, then run again.
    pause
    exit /b 1
  )
) else (
  dir /b /a "!TARGET!" | findstr . >nul
  if not errorlevel 1 (
    echo [ERROR] "!TARGET!" is not empty and is not an Open Send copy.
    echo Empty it or run: setup-new-pc.bat "D:\Your\Empty\Folder"
    pause
    exit /b 1
  )
  echo Cloning (first time, needs internet once^)...
  git clone -b !BRANCH! "!REPO!" "!TARGET!"
  if errorlevel 1 (
    echo [ERROR] Clone failed. Check internet and try again.
    pause
    exit /b 1
  )
)

REM ---------- 5. Dependencies ----------
echo.
echo [5/6] Installing dependencies (first time takes a few minutes)...
cd /d "!TARGET!"
call npm ci
if errorlevel 1 (
  echo npm ci failed, trying npm install instead...
  call npm install
  if errorlevel 1 (
    echo [ERROR] Dependency install failed.
    pause
    exit /b 1
  )
)

REM ---------- 6. Build ----------
echo.
echo [6/6] Building (one time)...
call npm run build
if errorlevel 1 (
  echo [ERROR] Build failed. Check the messages above.
  pause
  exit /b 1
)

echo.
echo ================================================
echo  Done. Open Send is ready in: !TARGET!
echo ================================================
echo.
set ASK=Y
set /p ASK="Run the one-time network setup now? (needs Administrator) [Y/n]: "
if /i "!ASK!"=="" set ASK=Y
if /i "!ASK!"=="Y" (
  echo Starting network setup...
  call "!TARGET!\scripts\setup-btec-lan.bat"
)
echo.
set GO=Y
set /p GO="Start the Open Send server now? [Y/n]: "
if /i "!GO!"=="" set GO=Y
if /i "!GO!"=="Y" (
  echo Starting server in a new window...
  start "Open Send Server" /d "!TARGET!" start-lan.bat
  echo.
  echo Students open: http://btec-send.local  (fallback: server IP shown in that window^)
)
echo.
echo To start later, double-click start-lan.bat inside: !TARGET!
pause
exit /b 0

REM ================= helpers =================
:install_node
echo Node.js missing - trying automatic install via winget...
where winget >nul 2>&1
if errorlevel 1 (
  echo [ERROR] winget not found. Install Node.js manually: https://nodejs.org
  exit /b 1
)
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
call :refresh_path
exit /b 0

:install_git
echo Git missing - trying automatic install via winget...
where winget >nul 2>&1
if errorlevel 1 (
  echo [ERROR] winget not found. Install Git manually: https://git-scm.com/downloads/win
  exit /b 1
)
winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements
call :refresh_path
exit /b 0

:refresh_path
for /f "delims=" %%p in ('powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"') do set "PATH=%%p"
exit /b 0
