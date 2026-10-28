@echo off
REM Express (mongo-api / "E" in MERN) — detached launcher.
REM Invoked via WMI Win32_Process.Create with CurrentDirectory=this service dir,
REM so node/msfax actor survives the calling shell (proven pattern = other services).
cd /d "%~dp0"
set ENV_FILE=D:\Anomaly Engine\.env
call npm run start
