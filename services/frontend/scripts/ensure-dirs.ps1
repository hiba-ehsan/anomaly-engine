$base = "D:\Anomaly Engine\services\frontend\src"
$dirs = @(
  "components\cards",
  "components\stats",
  "lib",
  "app\companies\[ticker]\filings\[id]",
  "app\companies\[ticker]\filings",
  "app\anomalies\[id]"
)
foreach ($d in $dirs) {
  $p = Join-Path $base $d
  if (-not (Test-Path $p)) {
    New-Item -ItemType Directory -Path $p -Force | Out-Null
    Write-Output "  created $d"
  } else {
    Write-Output "  exists  $d"
  }
}
