@echo off
cd /d "%~dp0"
node "%~dp0gem-status-agent.cjs"
echo.
echo Gem status agent exited. Press any key to close this window.
pause >nul
