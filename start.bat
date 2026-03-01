@echo off
title TTFC Viewer

echo.
echo TTFC Viewer starting...
echo.

if not exist node_modules (
    echo First run - installing dependencies...
    call npm install
    echo.
)

call npm start
