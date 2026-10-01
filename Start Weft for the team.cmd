@echo off
rem Starts Weft for your team: anyone on this network can open it in their browser, and their
rem Claude can connect to it. Keep this window open while the team works; close it to stop Weft.
title Weft (team)
cd /d "%~dp0"

netstat -ano | findstr /r /c:":8787 .*LISTENING" >nul
if not errorlevel 1 (
  echo Weft is already running on this computer, maybe just for you.
  echo Close its window first, then start this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing what Weft needs. This takes a minute or two...
  call npm install || goto failed
)

echo Building Weft, then starting it for your team. This takes a minute.
echo If Windows asks whether Node.js may use the network, allow it on private networks.
echo The address teammates open is shown below once Weft is running ("Open to your network").
set HOST=0.0.0.0
rem Opens Weft in the browser here as soon as it answers.
start "" /b powershell -NoProfile -Command "for ($i = 0; $i -lt 300; $i++) { Start-Sleep 1; try { $null = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:8787/api/health; Start-Process http://localhost:8787; break } catch {} }"
call npm run app

:failed
echo.
echo Weft stopped. Any error is shown above.
pause
