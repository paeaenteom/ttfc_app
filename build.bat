@echo off
title TTFC Viewer - Build

echo.
echo ========================================
echo   TTFC Viewer - Build Script
echo ========================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not installed!
    echo Download: https://nodejs.org/
    pause
    exit /b 1
)

echo [1/3] Node.js version:
node --version
echo.

echo [2/3] Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] npm install failed!
    pause
    exit /b 1
)
echo OK
echo.

echo [3/3] Building installer... (1-3 min)
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Build failed!
    pause
    exit /b 1
)

echo.
echo ========================================
echo   BUILD COMPLETE!
echo   Check dist\ folder for Setup exe
echo ========================================
echo.

explorer dist
pause
