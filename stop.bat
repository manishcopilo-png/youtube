@echo off
rem Stops only the app's server (port 4000); the server closes its own browsers on exit.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "127.0.0.1:4000 .*LISTENING"') do taskkill /PID %%p /T >nul 2>&1
echo Stopped.
