@echo off
cd /d %~dp0
if not exist node_modules call npm install
if not exist .env copy .env.example .env >nul
start "MultiProfileManager" /min cmd /c "npm start > data\logs\server.log 2>&1"
timeout /t 3 >nul
start http://127.0.0.1:4000
