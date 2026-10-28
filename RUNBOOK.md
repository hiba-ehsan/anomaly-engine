# Anomaly Engine — Stack Start Runbook

Authoritative launch order + health checks. Run each block from an **admin** PowerShell.
Always launch detached processes via WMI (`Win32_Process.Create` with `CurrentDirectory`)
so services survive the shell that spawns them.

---

## 0. Preflight (2 min)

```powershell
# One terminal, verify nothing is half-running from a crashed shell
foreach ($p in 27017,8000,8081,3000) {
  $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
  "{0,5}  {1}" -f $p, ($(if ($c) { 'UP  PID ' + $c.OwningProcess } else { 'down' }))
}
```

All four should read `down`. If any show `UP`, they're orphans from a killed shell —
kill by PID (`Stop-Process -Id <pid> -Force`), or restart Windows to be safe.

---

## 1. MongoDB — mongod (:27017), data at `D:\Anomaly Engine\services\mongo-api\data`

```powershell
$mongod = "C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe"
# ensure data/log dirs exist FIRST (rc=9 if missing)
New-Item -ItemType Directory -Force -Path "D:\Anomaly Engine\services\mongo-api\data\db"  | Out-Null
New-Item -ItemType Directory -Force -Path "D:\Anomaly Engine\services\mongo-api\data\logs" | Out-Null

$launcher = @'
$cmd = "{0}"
$wd  = "D:\Anomaly Engine\services\mongo-api\data"
$args = "--dbpath D:\Anomaly Engine\services\mongo-api\data\db --logpath D:\Anomaly Engine\services\mongo-api\data\logs\mongod.log --port 27017 --bind_ip 127.0.0.1 --quiet"
$sig = ([System.Text.Encoding]::Unicode.GetString([System.Text.Encoding]::Unicode.GetBytes(("$cmd $args"))) )
# WMI detach — the ONLY pattern that outlives this shell
$remote = ([wmiclass]"\\.\root\cimv2:Win32_Process")
$proc = $remote.Create(("""$cmd"" $args"), $wd)
"created pid=" + $proc.ProcessId
'@
Set-Content -Path "$env:TEMP\launch_mongod.ps1" -Value $launcher -Encoding UTF8
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\launch_mongod.ps1"
```

Verify `Get-NetTCPConnection -LocalPort 27017 -State Listen` → `UP`.

---

## 2. Express API — mongo-api (:8081)

```powershell
cd "D:\Anomaly Engine\services\mongo-api"
npm install          # first time only
# start detached (same WMI pattern)
```

Verify `Invoke-WebRequest http://127.0.0.1:8081/health` → `200 OK`.

---

## 3. Gateway (:8000)

```bash
cd "D:\Anomaly Engine\services\gateway"
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
python main.py       # run in foreground for dev, or WMI-detach for prod
```

Verify `Invoke-WebRequest http://127.0.0.1:8000/api/v1/health` → `200`.

---

## 4. Frontend — Next.js (:3000)

```powershell
cd "D:\Anomaly Engine\services\frontend"
npm install
npm run build
npx next start -p 3000        # production
#  or:  npm run dev            # dev with HMR
```

Verify `Invoke-WebRequest http://127.0.0.1:3000` → `200` (Next terminal dashboard).

---

## 5. Sanity — one anomaly end-to-end

```powershell
# seed AAPL 10-Ks into Mongo (idempotent)
python "D:\Anomaly Engine\scripts\seed_mongodb.py"

# then in the browser
Start-Process "http://127.0.0.1:3000/companies/AAPL"
```
Dashboard should show AAPL, its filings from Mongo, anomaly feed, and candlestick chart.

---

## Restart / stop

```powershell
# stop all (must outlive shell)
Get-Process mongod,node,python -ErrorAction SilentlyContinue | Stop-Process -Force
# then repeat from Section 0 preflight
```

---

## Port map

| Port | Service        |
|------|----------------|
| 27017 | MongoDB        |
| 8081  | Express (mongo-api) |
| 8000  | FastAPI gateway |
| 3000  | Next.js frontend |
