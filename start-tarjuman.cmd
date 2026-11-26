@echo off
rem Starts Tarjuman on Windows: double-click this file.
rem The first start, and the first start after an update, install and build what changed,
rem which takes a few minutes.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download it from https://nodejs.org ^(version 22.13 or newer^),
  echo install it, and double-click this file again.
  goto :failed
)

rem Install and build what is missing or older than the files in this folder.
node scripts\launch.mjs
if errorlevel 1 goto :failed

call npm start -- --open
if errorlevel 1 goto :failed
exit /b 0

:failed
echo.
echo Tarjuman did not start. Read the messages above for the reason.
pause
exit /b 1
