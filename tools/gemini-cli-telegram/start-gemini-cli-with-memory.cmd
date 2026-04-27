@echo off
REM This launcher keeps GEMINI.md manual-only and injects independent memory
REM through an interactive bootstrap prompt instead of writing summaries into md.
set HTTP_PROXY=http://127.0.0.1:10808
set HTTPS_PROXY=http://127.0.0.1:10808
set NO_PROXY=localhost,127.0.0.1
cd /d "%~dp0"
node "%~dp0start-gemini-cli-with-memory.cjs"
pause
