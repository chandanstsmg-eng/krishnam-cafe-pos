@echo off
rem  Annapoorna POS - double-click to start the till on this computer.
rem  Starts the server, then opens the POS in its own window with silent
rem  receipt printing (prints straight to the default printer, no dialog).
title Annapoorna POS
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed. Install the LTS version from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo   First start: installing, this takes a few minutes...
  call npm install
  if errorlevel 1 ( pause & exit /b 1 )
)

rem Open the POS window once the server answers.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command ^
  "$port = (Get-Content .env -ErrorAction SilentlyContinue | Select-String '^PORT=(\d+)').Matches.Groups[1].Value; if (-not $port) { $port = 4100 };" ^
  "for ($i=0; $i -lt 180; $i++) { try { Invoke-WebRequest -UseBasicParsing \"http://localhost:$port/api/health\" -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep 1 } };" ^
  "$dir = Join-Path $env:LOCALAPPDATA 'AnnapoornaPOS\browser';" ^
  "Start-Process msedge -ArgumentList \"--app=http://localhost:$port\",'--kiosk-printing',\"--user-data-dir=$dir\",'--start-maximized'"

call npm start
pause
