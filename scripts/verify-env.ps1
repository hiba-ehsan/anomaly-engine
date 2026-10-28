$ErrorActionPreference = "Continue"

Write-Host "Verifying Anomaly Engine Environment..."
Write-Host "======================================="

$ports = @{
    "MongoDB (mongod)" = 27017
    "API Gateway" = 8000
    "Ingestion US" = 8001
    "Ingestion Market" = 8002
    "NLP Engine" = 8003
    "Backtester" = 8004
    "Express API (mongo-api)" = 8081
    "Frontend (Next.js)" = 3000
}

$allUp = $true

foreach ($svc in $ports.Keys) {
    $port = $ports[$svc]
    $conn = Test-NetConnection -ComputerName "localhost" -Port $port -WarningAction SilentlyContinue
    if ($conn.TcpTestSucceeded) {
        Write-Host "[OK] $svc is listening on port $port" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] $svc is NOT listening on port $port" -ForegroundColor Red
        $allUp = $false
    }
}

Write-Host "======================================="
if ($allUp) {
    Write-Host "All services are UP." -ForegroundColor Green
} else {
    Write-Host "Some services are DOWN. Check logs in root\logs." -ForegroundColor Yellow
}
