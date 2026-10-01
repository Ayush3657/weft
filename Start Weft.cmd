@echo off
rem Starts Weft on this computer. Keep the window open while you use Weft (and while Claude uses it); close it to stop Weft.
title Weft
cd /d "%~dp0"

netstat -ano | findstr /r /c:":8787 .*LISTENING" >nul
if not errorlevel 1 (
  echo Weft is already running. Opening it...
  start "" http://localhost:5173
  timeout /t 3 >nul
  exit /b 0
)

if not exist node_modules (
  echo First run: installing what Weft needs. This takes a minute or two...
  call npm install || goto failed
)

echo Starting Weft. Keep this window open while you use it; close it to stop Weft.
start "" /b cmd /c "timeout /t 10 >/dev/null && start http://localhost:5173"
call npm run dev

:failed
echo.
echo Weft stopped. Any error is shown above.
pause
