@echo off
cd /d "%~dp0"
node "%~dp0gem-status-agent.cjs"
exit /b %errorlevel%
