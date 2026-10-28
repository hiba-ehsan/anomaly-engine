$ErrorActionPreference = "Stop"

$root = $PSScriptRoot

$services = @("api-gateway", "backtester", "ingestion-market", "ingestion-us", "nlp-engine")

foreach ($service in $services) {
    $servicePath = "$root\services\$service"
    Write-Host "Setting up $service..."
    
    $venvPath = "$servicePath\venv"
    if (Test-Path $venvPath) {
        Write-Host "Removing corrupted venv for $service..."
        Remove-Item -Path $venvPath -Recurse -Force
    }

    Write-Host "Creating fresh venv for $service..."
    py -3.11 -m venv $venvPath

    $pipPath = "$venvPath\Scripts\pip.exe"
    $reqPath = "$servicePath\requirements.txt"
    
    if (Test-Path $pipPath) {
        Write-Host "Installing dependencies for $service..."
        $env:PIP_CACHE_DIR = "D:\pip-cache"
        if ($service -eq "nlp-engine") {
            & $pipPath install --extra-index-url https://download.pytorch.org/whl/cpu -r $reqPath
        } else {
            & $pipPath install -r $reqPath
        }
    } else {
        Write-Host "ERROR: pip not found in $venvPath"
    }
}

Write-Host "Setting up frontend..."
Set-Location "$root\services\frontend"
npm install

Write-Host "Local environment setup complete!"
