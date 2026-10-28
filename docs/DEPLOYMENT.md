# Deployment Runbook (Vercel + Railway)

Target shape:

```
Vercel  ──►  Next.js dashboard (services/frontend)
                    │  NEXT_PUBLIC_API_URL
                    ▼
Railway ──►  api-gateway (:8000)  ──►  ingestion-us / PySpark (:8001)
                    │                        │
                    └── curated JSON         └── Spark RDD job (subprocess)
                        fallback
```

The demo does **not** require Supabase. The gateway reads bundled
`data/curated/latest/*.json` when the database is absent or unreachable.

## 1. Push the repository

```bash
git add .
git commit -m "feat: spark rdd pipeline + midterm demo"
git push origin main
```

`data/raw/filings` (1.6 MB) and `data/curated/latest` (2.5 MB) are committed on
purpose so a fresh deploy has something real to show. Runtime scratch
directories (`.spark-tmp`, `.cache`, `.data`, `logs`) are ignored.

## 2. Railway — ingestion-us (Spark)

Create a service from the repo:

| Setting | Value |
| --- | --- |
| Root Directory | repository root (`/`) |
| Config file path | `railway.ingestion.json` |
| Dockerfile | `infra/railway/ingestion-us.Dockerfile` |
| Healthcheck | `/health` |
| Memory | **≥ 1 GB** (2 GB recommended) |

Environment:

```dotenv
ANOMALY_DATA_DIR=/app/data
SPARK_MASTER=local[1]
SPARK_PARALLELISM=1
SPARK_DRIVER_MEMORY=512m
SPARK_LOCAL_DIR=/tmp/spark
PYTHONUNBUFFERED=1
```

The image already includes Java 17, PySpark 4.2.0, spaCy and the SEC snapshot.

Optional: attach a Railway volume at `/app/data` if you want Spark output to
survive redeploys. Without a volume, each deploy starts from the committed
curated snapshot and new runs write inside the container.

Verify:

```bash
curl https://<ingestion-us-domain>/health
curl -X POST https://<ingestion-us-domain>/spark/run \
  -H 'content-type: application/json' -d '{"wait": true}'
```

> Spark startup is CPU/JVM bound. A one-replica, 1 GB service is enough for the
> five-filing demo; it is not sized for concurrent jobs.

## 3. Railway — api-gateway

Create a second service from the same repo:

| Setting | Value |
| --- | --- |
| Root Directory | repository root (`/`) |
| Config file path | `railway.json` |
| Dockerfile | `infra/railway/api-gateway.Dockerfile` |
| Healthcheck | `/health` |
| Memory | 512 MB is enough |

Environment:

```dotenv
ANOMALY_DATA_DIR=/app/data
INGESTION_US_URL=http://<ingestion-us-private-host>:8001
CORS_ORIGINS=https://<your-app>.vercel.app
# Optional — leave blank for the artifact-only demo:
SUPABASE_URL=
SUPABASE_KEY=
SUPABASE_SERVICE_KEY=
```

If the private hostname is not enabled, use the public ingestion-us URL.

Verify:

```bash
curl https://<gateway-domain>/health
curl https://<gateway-domain>/api/v1/companies
curl https://<gateway-domain>/api/v1/market/AAPL/quote
```

`data_source` should read `local-artifacts`.

## 4. Vercel — frontend

1. Import the repo at <https://vercel.com/new>.
2. **Root Directory:** `services/frontend`.
3. Framework preset: Next.js.
4. Environment variable (Production + Preview):

```dotenv
NEXT_PUBLIC_API_URL=https://<gateway-domain>/api/v1
```

`src/lib/config.ts` also accepts an origin without `/api/v1`, so both
`https://api.example.com` and `https://api.example.com/api/v1` work.

No Supabase/Redis/Finnhub variables are needed for the mid-term demo.

## 5. Local production-shaped check

```powershell
docker compose build
docker compose up api-gateway ingestion-us
```

Compose mounts `./data` into both containers (`ANOMALY_DATA_DIR=/app/data`), so
a Spark run in the ingestion container is immediately visible to the gateway.

## 6. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `502` on `/pipeline/run` | Spark job exceeded memory | raise Railway memory, keep `SPARK_MASTER=local[1]` |
| `/health` dependencies false | private URLs wrong / service asleep | start both services, check `INGESTION_US_URL` |
| Companies list empty | no curated artifacts in image | ensure `data/curated/latest` committed before deploy |
| CORS error in browser | Vercel domain missing | add it to `CORS_ORIGINS` |
| Quote 404 | `prices.json` missing | run `scripts/fetch_prices.py` and redeploy gateway |
| `Python worker failed to connect back` | commit/memory exhaustion | reduce `SPARK_DRIVER_MEMORY`, free RAM, keep one partition |

## 7. Why artifacts instead of a database

The Supabase project used during development (`vbcziwvuscxwnpkkjfbr`) no longer
resolves, so the demo must not depend on it. The Spark job writes JSON/Parquet
to disk; the gateway reads it through `LocalStore` with mtime-based caching.
Adding Supabase later only means setting the three environment variables — the
same client already prefers it and falls back on failure.
