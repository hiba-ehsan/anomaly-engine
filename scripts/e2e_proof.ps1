# E2E proof chaser — M(27017) -> E(Express :8081) -> R(Next :3000) -> gateway :8000
$ErrorActionPreference = "Continue"

"== 0. 27017 final truth =="
$c = Get-NetTCPConnection -LocalPort 27017 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $c) {
  "  DOWN"
  "== tail mongod.log (last 30) =="
  Get-Content "C:\Program Files\MongoDB\Server\8.3\log\mongod.log" -Tail 30 -ErrorAction SilentlyContinue
  exit 1
}
"  UP pid=$($c.OwningProcess)"

"== 1. idempotent re-seed (proves raw_filings rows are REAL AAPL, Mongo-born) =="
& "C:\Python314\python.exe" "D:\Anomaly Engine\scripts\seed_mongodb.py" 2>&1 | ForEach-Object { "  $_" }

"== 2. relaunch Express (detached, WMI, CurrentDirectory=service dir) =="
$api = "D:\Anomaly Engine\services\mongo-api"
$launch = Join-Path $api "launch.cmd"
Set-Content -LiteralPath $launch -Value "@echo off`ncd /d `"%~dp0`"`nset ENV_FILE=D:\Anomaly Engine\.env`ncall npm run start" -Encoding Ascii
$p = @{
  CommandLine      = "cmd.exe /c `"$launch`""
  CurrentDirectory = $api
}
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments $p
"  WMI rc=$($r.ReturnValue) pid=$($r.ProcessId)"

"== 3. poll express :8081 =="
$up = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep 3
  try {
    $h = Invoke-WebRequest -Uri "http://127.0.0.1:8081/health" -UseBasicParsing -TimeoutSec 6 -ErrorAction Stop
    "  UP poll=$i : $($h.Content)"
    $up = $true
    break
  } catch {}
}
if (-not $up) { "  express never came up"; exit 1 }

"== 4. THE M->E->R PROOF (Mongo -> Express -> JSON) =="
foreach ($u in @(
  "http://127.0.0.1:8081/api/v1/raw/stats",
  "http://127.0.0.1:8081/api/v1/raw/filings?ticker=AAPL&limit=20"
)) {
  try {
    $r2 = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 20 -ErrorAction Stop
    $j = $r2.Content | ConvertFrom-Json
    "  OK $u"
    if ($u -match "stats") {
      "     $($j | ConvertTo-Json -Compress -Depth 5)"
    } else {
      "     total=$($j.total)"
      $j.filings | ForEach-Object {
        "       [$($_.accession)] $($_.document) $($_.filing_date) $([math]::Round($_.size_bytes/1MB,2))MB status=$($_.status)"
      }
    }
  } catch {
    "  FAIL $u : $($_.Exception.Message.Split("`n")[0])"
  }
}

"== 5. gateway :8000 still authoritative for anomalies (the 'other half') =="
try {
  $g = Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/v1/anomalies?ticker=AAPL&limit=20" -UseBasicParsing -TimeoutSec 25 -ErrorAction Stop
  $gj = $g.Content | ConvertFrom-Json
  "  gateway anomalies total=$($gj.total)"
  $gj.anomalies | ForEach-Object { "     [$($_.anomaly_type)] sev=$($_.severity) score=$([math]::Round($_.score,3))" }
} catch { "  gateway FAIL : $($_.Exception.Message.Split("`n")[0])" }
