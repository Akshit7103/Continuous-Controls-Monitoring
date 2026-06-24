@echo off
title AIM Dashboard v2
echo ============================================
echo   AIM Dashboard v2 - Analytics in Motion
echo ============================================
echo.

cd /d "%~dp0"

echo Starting AIM Dashboard on http://localhost:8001
echo Press Ctrl+C to stop.
echo.

python main.py
pause
