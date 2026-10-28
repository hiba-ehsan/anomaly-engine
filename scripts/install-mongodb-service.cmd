@echo off
set MONGOBIN=C:\Program Files\MongoDB\Server\8.3\bin
"%MONGOBIN%\mongod.exe" --config "%MONGOBIN%\mongod.cfg" --install --serviceName "MongoDB" --serviceDisplayName "MongoDB Server" --serviceDescription "Anomaly Engine document store (MERN-M)" > "D:\Anomaly Engine\logs\mongo-service-install.log" 2>&1
echo install_rc=%ERRORLEVEL%
sc.exe start MongoDB >> "D:\Anomaly Engine\logs\mongo-service-install.log" 2>&1
echo start_rc=%ERRORLEVEL%
