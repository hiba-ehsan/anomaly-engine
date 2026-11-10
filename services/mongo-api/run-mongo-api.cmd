@echo off
cd /d "%~dp0"
set "ENV_FILE=%~dp0..\..\.env"
call node index.js
