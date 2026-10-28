@echo off
"C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe" --dbpath "D:\Anomaly Engine\.data\db" --logpath "D:\Anomaly Engine\logs\mongod-wmi.log" 1> "D:\Anomaly Engine\logs\mongod-wmi.log.stdout" 2> "D:\Anomaly Engine\logs\mongod-wmi.err.log"
