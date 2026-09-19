@echo off
echo Starting WispChat services on network...
echo.
timeout /t 2

REM Get the directory where this script is located
cd /d "%~dp0"

REM Start server in new window
echo Starting server...
start "server" cmd /k "cd server && npm run dev"
timeout /t 2

REM Start client in new window
echo Starting client...
start "client" cmd /k "cd client && npm run dev"
timeout /t 2
