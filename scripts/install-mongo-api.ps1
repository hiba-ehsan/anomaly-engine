$ErrorActionPreference = "Stop"
$root = "D:\Anomaly Engine"
$apiDir = "$root\services\mongo-api"

Write-Host "Installing dependencies for mongo-api..."
Set-Location $apiDir

# Run npm install specifically for this workspace
npm install --no-workspaces

Write-Host "mongo-api dependencies installed."
