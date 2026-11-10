# Mid-term 45% Completion Matrix

> Historical snapshot from 2026-10-28. The current status and numbers are in
> `docs/defense.md` (run `20261102T012655Z`: 5 companies, 11 filings, 30 flags,
> 7.76x benchmark). The percentages below describe the earlier five-filing slice.

**Milestone:** working vertical slice, demonstrable end-to-end.
**Date:** 2026-10-28
**Pipeline run:** `20261029T175940Z` (CLI, 12 stages, 5 filings, `local[4]`)

## Definition used for 45%

A slice counts as complete only when it runs, not when the file exists:
raw data → PySpark RDDs → curated artifacts → FastAPI gateway → Next.js UI,
plus a repeatable test suite and deploy configuration.

## Status

| # | Area | Deliverable | Status | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Spark core | RDD pipeline with 15+ explicit transformations/actions | ✅ Done | `run_summary.json → stages` (12 stages) |
| 2 | Spark core | Broadcast stopwords + accumulators | ✅ Done | `pipeline.py` |
| 3 | Spark core | RDD vs DataFrame benchmark on same data | ✅ Done | `match: true`, 23.8× |
| 4 | Data | 5 real SEC filings (AAPL/MSFT 10-K/10-Q) | ✅ Done | `data/raw/filings` |
| 5 | Data | Section/sentence/chunk curation | ✅ Done | 51 sections, 2,252 sentences, 1,159 chunks |
| 6 | Data | Anomaly + temporal + cross-section features | ✅ Done | 30 signals, 20 + 20 features |
| 7 | Data | Parquet output | ✅ Done | `data/curated/latest/chunks.parquet` |
| 8 | Data | Daily price history for charts/quotes | ✅ Done | `prices.json` (1,502 rows) |
| 9 | API | Ingestion API runs Spark as a subprocess | ✅ Done | `/spark/run`, `/spark/status`, `/spark/latest` |
| 10 | API | Gateway pipeline proxy + artifact fallback | ✅ Done | `/api/v1/pipeline/*`, `data_source=local-artifacts` |
| 11 | API | Companies/filings/chunks/anomalies endpoints | ✅ Done | local smoke tests |
| 12 | API | Quote/prices endpoints without live market service | ✅ Done | `/market/AAPL/quote` → 347.10 |
| 13 | UI | Dashboard shell + Spark ETL page | ✅ Done | `next build` passes, 11 routes |
| 14 | UI | Live stage timeline, benchmark, artifacts | ✅ Done | `/pipeline` |
| 15 | Deploy | Vercel frontend config | ✅ Config ready | `docs/DEPLOYMENT.md` |
| 16 | Deploy | Railway gateway + Spark images (Java/PySpark) | ✅ Config ready | `infra/railway/*.Dockerfile`, `railway*.json` |
| 17 | Tests | 15 fast tests (11 ingestion + 4 gateway) | ✅ Passing | see command below |
| 18 | Tests | Opt-in live RDD smoke test | ⚠️ Environment-limited | Full CLI/API Spark run passed; smoke test is skipped by default and needs JVM memory headroom |
| 19 | Docs | RDD pipeline deep-dive | ✅ Done | `docs/PYSPARK_RDD_PIPELINE.md` |
| 20 | Docs | Deployment runbook | ✅ Done | `docs/DEPLOYMENT.md` |
| 21 | Docs | PySpark API reference (where each operation runs) | ✅ Done | `docs/PYSPARK_API_REFERENCE.md` |
| 22 | Spark core | RDD/DataFrame parity analysis as stage 12 | ✅ Done | `section_analysis.json` (`match: true`) |

## Verified commands

```powershell
# Fast tests (no JVM)
services\ingestion-us\venv\Scripts\python.exe -m pytest services\ingestion-us\tests -q
services\api-gateway\venv\Scripts\python.exe -m pytest services\api-gateway\tests -q

# Frontend production build
cd services\frontend; npm run build

# Full API-triggered Spark run
$body = @{ tickers = $null; wait = $true } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/v1/pipeline/run `
  -Body $body -ContentType 'application/json'
```

Expected test totals: `11 passed, 1 skipped` (ingestion) and `4 passed`
(gateway). The skipped test is the opt-in live Spark smoke test. The full
12-stage artifact run above is the authoritative Spark execution evidence; the
smoke test is redundant and can fail on machines with very low free commit
memory.

## Deliberately deferred (remaining 55%)

| Area | Current state | Why deferred |
| --- | --- | --- |
| Live Supabase persistence | Optional client with fallback; host does not resolve | DNS/database unavailable; artifacts cover the demo |
| FinBERT sentiment (nlp-engine) | Service scaffold + Dockerfile, not running | ~1 GB model + RAM headroom; Spark is the graded requirement |
| Backtester engine | Gateway returns a local summary | Needs price + signal alignment; quote data now exists |
| Live market service | `yfinance` fetched offline into `prices.json` | Keeps demo deterministic and network-independent |
| Mongo/Express bridge | Scaffold only | Not required for the Python/Spark vertical slice |
| Celery/Redis task queue | Scaffold only | Subprocess job runner is sufficient at this scale |
| Auth, multi-tenant, alerts | Not started | Post-mid-term scope |
| Production data refresh | Manual `fetch_sec_filings.py` | Scheduled ingest is post-mid-term scope |

## Demo script (5 minutes)

1. `Invoke-RestMethod http://127.0.0.1:8000/health` — show `ingestion-us: true`,
   `data_source: local-artifacts`, run id.
2. Open `http://localhost:3000/pipeline` — show 12 RDD stages, operation badges,
   counts, 23.8× benchmark with `match: true`.
3. Open the dashboard — AAPL/MSFT filings, anomaly cards, price chart.
4. Run `POST /api/v1/pipeline/run {"wait": true}` — show a fresh run id and new
   artifact sizes without restarting the API.
5. Show `docs/PYSPARK_RDD_PIPELINE.md` stage/API table,
   `docs/PYSPARK_API_REFERENCE.md`, and the test output.
