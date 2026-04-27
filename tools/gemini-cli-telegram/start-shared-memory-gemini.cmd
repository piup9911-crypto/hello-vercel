@echo off
set HTTP_PROXY=http://127.0.0.1:10808
set HTTPS_PROXY=http://127.0.0.1:10808
set NO_PROXY=localhost,127.0.0.1
cd /d "%~dp0"
node memory-ingest.cjs --source cli
node shared-memory-sync.cjs
if errorlevel 1 (
  echo Shared memory sync failed. Gemini will still start with the last local memory file.
)
cd /d "%USERPROFILE%\gemini-test"
gemini -m gemini-3.1-pro-preview
pause
