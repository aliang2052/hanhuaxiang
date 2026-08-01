@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js。请安装 Node.js 18 或更高版本。
  pause
  exit /b 1
)
if "%PORT%"=="" set PORT=4173
node tools\preflight.js --port=%PORT%
if errorlevel 1 (
  pause
  exit /b 1
)
node server.js --port=%PORT%
if errorlevel 1 pause
