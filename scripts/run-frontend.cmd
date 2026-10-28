@echo off
set NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
npm run dev 1> "D:\Anomaly Engine\logs\frontend.log" 2> "D:\Anomaly Engine\logs\frontend.err.log"
