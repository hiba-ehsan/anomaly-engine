# Ingestion map (`services/ingestion-us`)

This service does two jobs:

1. **Download** real filings from SEC EDGAR.
2. **Run the PySpark RDD pipeline** that turns the downloaded text into the JSON
   files the dashboard reads.

It listens on **http://localhost:8001**. The API gateway (port 8000) proxies the
browser to it.

---

## Folder / file map

```
services/ingestion-us/
├── app/
│   ├── main.py                 FastAPI app: HTTP routes, background jobs,
│   │                           Spark subprocess control, warning handling.
│   ├── models.py               Pydantic request/response models
│   │                           (IngestRequest, FilingInfo, IngestStatus).
│   ├── edgar_client.py         Talks to SEC EDGAR:
│   │                           company_tickers.json (ticker → CIK),
│   │                           submissions API (list filings),
│   │                           Archives (download the filing HTML).
│   ├── xbrl_parser.py          Strips HTML and splits a filing into sections
│   │                           (item_1, item_1a, item_7, …).
│   ├── chunker.py              Cuts section text into ~140-word chunks.
│   ├── storage.py              Writes raw filings + curated artifacts locally
│   │                           and (optionally) mirrors them to Supabase.
│   │                           Supabase failures are warnings, never fatal.
│   ├── filing_manifest.py      Builds/merges `data/raw/filings/manifest.json`
│   │                           (one record per downloaded filing).
│   ├── ingest_jobs.py          Durable job records in
│   │                           `data/ingestion/jobs/<uuid>.json`; recovers
│   │                           jobs interrupted by a restart.
│   └── spark/
│       ├── session.py          SparkSession config (local demo: local[1]).
│       ├── runner.py           CLI entry point:
│       │                       `python -m app.spark.runner [--tickers ...]`
│       ├── pipeline.py         **The PySpark RDD pipeline.** Reads raw filings,
│       │                       builds RDDs/DataFrames, writes
│       │                       `data/curated/latest/*.json`.
│       └── section_analysis.py Final stage: RDD vs DataFrame parity check on
│                               section statistics.
├── tests/                      Pytest suite for EDGAR client, storage,
│                               job state, and ingestion routes.
├── scripts/                    Small helper scripts for the service.
├── requirements.txt            Python dependencies.
└── venv/                       Local virtual environment (not shipped).
```

### Where the PySpark code lives

| File | What it contains |
| --- | --- |
| `app/spark/pipeline.py` | The whole RDD pipeline: read → clean → sentences → tokens → chunks → features → change scores (anomalies) → write JSON. Start here. |
| `app/spark/session.py` | How `SparkSession` is created (`local[1]`, memory, UI port). |
| `app/spark/runner.py` | Command-line wrapper used by the HTTP service and by hand. |
| `app/spark/section_analysis.py` | Last stage: same question answered with RDD and DataFrame, results compared. |

Run it by hand (from `services/ingestion-us`):

```powershell
.\venv\Scripts\python.exe -m app.spark.runner
```

The HTTP equivalent is `POST http://localhost:8001/spark/run`.

---

## How data ingestion actually works

### 1. Download from the SEC (real data, public API)

`edgar_client.py` uses three official SEC endpoints:

| Purpose | Endpoint |
| --- | --- |
| Ticker → CIK lookup | `https://www.sec.gov/files/company_tickers.json` |
| List a company's filings | `https://data.sec.gov/submissions/CIK##########.json` |
| Download the document | `https://www.sec.gov/Archives/edgar/data/...` |

SEC asks every automated client to send a descriptive `User-Agent`; this project
uses `EDGAR_USER_AGENT` (default `AnomalyEngine/1.0`). Requests are rate-limited
and retried.

Downloaded filings are written to:

```
data/raw/filings/<TICKER>/<accession-number>.json
data/raw/filings/manifest.json
```

Each JSON file contains the filing's sections as plain text, so the Spark job
never needs the network or a database.

### 2. Build the results with PySpark

`pipeline.py` reads **every** file in `data/raw/filings/*/*.json` and:

1. Cleans and splits each filing into sections.
2. Splits sections into sentences, then tokens.
3. Builds ~140-word overlapping chunks.
4. Computes per-section and per-ticker statistics and features.
5. Compares consecutive filings and assigns a **change score** to each
   difference (these become the "change flags" in the UI).
6. Writes the results to `data/curated/latest/`:
   `companies.json`, `filings.json`, `chunks.json`, `features.json`,
   `anomalies.json`, `section_stats.json`, `run_summary.json`, and more.

The pipeline always processes the full raw snapshot, even if a request names one
ticker. That guarantees a single-company rebuild can never remove other
companies from the results.

### 3. Serve it to the browser

The API gateway reads `data/curated/latest` through `LocalStore`. Nothing in the
UI is hardcoded: if an artifact is missing, the page shows `—` rather than an
invented number.

---

## Why the demo has 5 companies, not the Fortune 500

Nothing in the code limits the project to five companies. The limit is the
**downloaded snapshot**, and it exists for three practical reasons:

1. **Runtime.** This is a single-machine Spark job (`local[1]`). Eleven filings
   take several minutes. Downloading and parsing 500 companies × multiple
   filings would take hours and a lot of disk.
2. **Demo scope.** Five large, well-known filers (AAPL, MSFT, AMZN, NVDA, GOOGL)
   give enough filings to compare year-over-year and quarter-over-quarter, which
   is what the change detection needs.
3. **SEC courtesy limits.** SEC asks clients to stay at or below ~10 requests per
   second and to identify themselves. Bulk-downloading hundreds of companies
   from one laptop is neither fast nor polite.

To grow the dataset, add tickers — no code change is needed:

```powershell
.\services\ingestion-us\venv\Scripts\python.exe scripts\fetch_sec_filings.py `
    --tickers AAPL MSFT AMZN NVDA GOOGL META TSLA --max-10k 2 --max-10q 1
```

Then press **Rebuild results** (or `POST /spark/run`).

---

## Local files vs Supabase

Both are supported, and the app tells you which one it is using.

- **Local JSON artifacts are the source of truth for this demo.** The Spark job
  writes them; the gateway reads them; they are committed with the repository,
  so the demo works with no network and no database.
- **Supabase is an optional copy.** When `SUPABASE_URL` and a key are configured,
  ingestion also mirrors companies and filings into Supabase. If a table is
  missing, a row-level-security rule rejects the write, or the network is down,
  the local save still succeeds and the job reports a **warning** instead of
  failing.
- The gateway health check reports `data_source` (`supabase` or `local`) so you
  can see which path answered.

This is why the UI can show five companies while the Supabase project may only
contain a subset: the dashboard is reading the local snapshot, which is complete.
