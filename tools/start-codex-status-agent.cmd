@echo off
cd /d "%~dp0"
node "%~dp0codex-status-agent.cjs"
echo.
echo Codex status agent exited. Press any key to close this window.
pause >nul
