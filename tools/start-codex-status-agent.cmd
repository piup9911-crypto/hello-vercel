@echo off
cd /d "%~dp0"
node "%~dp0codex-status-agent.cjs"
exit /b %errorlevel%
