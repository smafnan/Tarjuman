@echo off
rem Starts Tarjuman on Windows: double-click this file.
rem The first start installs and builds everything, which takes a few minutes.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download it from https://nodejs.org ^(version 22.13 or newer^),
  echo install it, and double-click this file again.
  goto :failed
)

if not exist "node_modules" (
  echo Installing Tarjuman. This happens only once...
  call npm install
  if errorlevel 1 goto :failed
)

if not exist "dist\web\index.html" (
  echo Building Tarjuman. This happens only once...
  call npm run build
  if errorlevel 1 goto :failed
)

call npm start -- --open
if errorlevel 1 goto :failed
exit /b 0

:failed
echo.
echo Tarjuman did not start. Read the messages above for the reason.
pause
exit /b 1
