@echo off
echo Starting Offline Music Audio & Download Backend (Port 3000)...
cd /d "%~dp0"
start "Offline Music Server" cmd /c "node server.js"
echo Starting Expo Metro App...
npx expo start --clear
pause
