param(
  [switch]$IncludeFrontend
)
$ErrorActionPreference = "Stop"
$root = "D:\Anomaly Engine"

Write-Host "== Anomaly Engine - native dev (no Docker) =="

# ---- Load root .env into environment ----
$envVars = @{}
Get-Content "$root\.env" | ForEach-Object {
  if ($_ -match "^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$" -and $_ -notmatch "^\s*#") {
    $name = $Matches[1]
    $value = $Matches[2].Trim()
    $envVars[$name] = $value
    Set-Item -Path "Env:$name" -Value $value
    Write-Host "env: $name"
  }
}

# ---- Localhost overrides for inter-service URLs ----
$override = @{
  "INGESTION_US_URL"      = "http://localhost:8001"
  "INGESTION_MARKET_URL"  = "http://localhost:8002"
  "NLP_ENGINE_URL"        = "http://localhost:8003"
  "BACKTESTER_URL"        = "http://localhost:8004"
}
foreach ($k in $override.Keys) {
  $envVars[$k] = $override[$k]
  Set-Item -Path "Env:$k" -Value $override[$k]
}

$envVars["HF_HOME"] = "$root\.cache\huggingface"
$envVars["HF_HUB_DISABLE_TELEMETRY"] = "1"
Set-Item -Path "Env:HF_HOME" -Value $envVars["HF_HOME"]
Set-Item -Path "Env:HF_HUB_DISABLE_TELEMETRY" -Value "1"

function Get-EnvBlock {
  $out = ""
  foreach ($k in $envVars.Keys) { $out += ('set "{0}={1}"' -f $k, $envVars[$k]) + "`r`n" }
  return $out
}

$services = @(
  @{ name = "ingestion-us";     port = 8001 },
  @{ name = "ingestion-market"; port = 8002 },
  @{ name = "nlp-engine";       port = 8003 },
  @{ name = "backtester";       port = 8004 },
  @{ name = "api-gateway";      port = 8000 }
)

New-Item -ItemType Directory -Force -Path "$root\logs" | Out-Null
New-Item -ItemType Directory -Force -Path "$root\scripts" | Out-Null

function Start-Detached {
  param([string]$Cmd, [string]$Cwd)
  $null = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $Cmd
    CurrentDirectory = $Cwd
  }
}

$envBlock = Get-EnvBlock

# ---- MongoDB ----
$mongoBin = "C:\Program Files\MongoDB\Server\8.3\bin"
$mongoCmd = "$root\scripts\run-mongod.cmd"
$mongoLogOut = "$root\logs\mongod-wmi.log"
$mongoLogErr = "$root\logs\mongod-wmi.err.log"
$localDbPath = "$root\.data\db"
New-Item -ItemType Directory -Force -Path $localDbPath | Out-Null
$batch = "@echo off`r`n`"$mongoBin\mongod.exe`" --dbpath `"$localDbPath`" --logpath `"$mongoLogOut`" 1> `"$mongoLogOut.stdout`" 2> `"$mongoLogErr`""
Set-Content -LiteralPath $mongoCmd -Value $batch -Encoding ASCII
Start-Detached -Cmd ('cmd.exe /c ""{0}""' -f $mongoCmd) -Cwd $mongoBin
Write-Host "started: mongod on :27017 [WMI]"
Start-Sleep -Milliseconds 400

foreach ($svc in $services) {
  $svcDir  = "$root\services\$($svc.name)"
  $venvPy  = "$svcDir\venv\Scripts\python.exe"
  $stdout  = "$root\logs\$($svc.name).log"
  $stderr  = "$root\logs\$($svc.name).err.log"
  $cmdFile = "$root\scripts\run-$($svc.name).cmd"

  $batch = "@echo off`r`n" + $envBlock + "`r`n" +
    "`"{0}`" -m uvicorn app.main:app --host 0.0.0.0 --port {1} 1> `"{2}`" 2> `"{3}`"" -f $venvPy, $svc.port, $stdout, $stderr
  Set-Content -LiteralPath $cmdFile -Value $batch -Encoding ASCII

  Start-Detached -Cmd ('cmd.exe /c ""{0}""' -f $cmdFile) -Cwd $svcDir
  Write-Host "started: $($svc.name) on :$($svc.port) [WMI]"
  Start-Sleep -Milliseconds 400
}

# ---- Express API ----
$apiDir  = "$root\services\mongo-api"
$stdout  = "$root\logs\mongo-api.log"
$stderr  = "$root\logs\mongo-api.err.log"
$cmdFile = "$root\scripts\run-mongo-api.cmd"

$batch = "@echo off`r`n" + $envBlock + "`r`n" +
  "npm run dev 1> `"{0}`" 2> `"{1}`"" -f $stdout, $stderr
Set-Content -LiteralPath $cmdFile -Value $batch -Encoding ASCII

Start-Detached -Cmd ('cmd.exe /c ""{0}""' -f $cmdFile) -Cwd $apiDir
Write-Host "started: mongo-api on :8081 [WMI]"
Start-Sleep -Milliseconds 400

if ($IncludeFrontend) {
  $feDir   = "$root\services\frontend"
  $stdout  = "$root\logs\frontend.log"
  $stderr  = "$root\logs\frontend.err.log"
  $cmdFile = "$root\scripts\run-frontend.cmd"

  $batch = "@echo off`r`n" + "set NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1`r`n" +
    "npm run dev 1> `"{0}`" 2> `"{1}`"" -f $stdout, $stderr
  Set-Content -LiteralPath $cmdFile -Value $batch -Encoding ASCII

  Start-Detached -Cmd ('cmd.exe /c ""{0}""' -f $cmdFile) -Cwd $feDir
  Write-Host "started: frontend on :3000 [WMI]"
}

Write-Host "Done. Gateway: http://localhost:8000/docs | Dashboard: http://localhost:3000"