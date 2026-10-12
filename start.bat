@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 22.5 or newer, then run this launcher again.
  echo Download it from https://nodejs.org/
  pause
  exit /b 1
)
start "" /B powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:8080/'"
node --disable-warning=ExperimentalWarning server.js
if errorlevel 1 (
  echo.
  echo Harvest stopped with an error. See the message above.
  pause
)
endlocal
