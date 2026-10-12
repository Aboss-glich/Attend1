@echo off
setlocal
cd /d "%~dp0"
title Attendly server
echo Starting Attendly from:
echo %CD%
echo.
if not exist "package.json" (
  echo ERROR: package.json was not found in this folder.
  pause
  exit /b 1
)
if not exist "node_modules\express" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
  )
)
echo.
echo Keep this window open while using the app.
echo Open http://localhost:3000/ after the server starts.
echo If port 3000 is busy, use the port shown below instead.
echo.
call npm start
echo.
echo The server stopped. Press any key to close this window.
pause >nul
