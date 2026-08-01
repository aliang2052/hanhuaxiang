@echo off
cd /d %~dp0
start "Han Orchestra Server" cmd /k node server.js --port=4173
timeout /t 1 /nobreak >nul
start "" http://localhost:4173
