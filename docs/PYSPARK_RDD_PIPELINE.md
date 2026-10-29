# PySpark RDD Pipeline

The mid-term requirement is **real Apache Spark RDD usage** in the Python
ingestion path. This document describes what actually runs, how to demo it, and
how the output reaches the Next.js dashboard.

## Where it lives

| File | Purpose |
| --- | --- |
| `services/ingestion-us/app/spark/session.py` | Low-memory `SparkSession` factory (Java/winutils setup) |
| `services/ingestion-us/app/spark/pipeline.py` | All RDD stages + artifact writers + benchmark |
| `services/ingestion-us/app/spark/runner.py` | CLI entry point used by the API subprocess |
| `services/ingestion-us/app/main.py` | `POST /spark/run`, `/spark/status/{id}`, `/spark/latest`, `/spark/raw` |
| `services/api-gateway/app/main.py` | `POST /api/v1/pipeline/run` proxy + local fallback |
| `services/frontend/src/app/pipeline/page.tsx` | "Spark ETL" dashboard |
| `scripts/fetch_sec_filings.py` | Downloads the raw SEC snapshot into `data/raw/filings` |

The API runs Spark as a **subprocess** (`python -m app.spark.runner`). When the
job exits, the JVM, Py4J and Python workers are fully released, so the FastAPI
process stays small (measured: ~50 MB idle after lazy-loading spaCy).

## Input

Five real SEC filings are committed for a reproducible demo:

| Ticker | Form | Filed |
| --- | --- | --- |
| AAPL | 10-K | 2025-10-31 |
| AAPL | 10-K | 2024-11-01 |
| AAPL | 10-Q | 2026-07-31 |
| MSFT | 10-K | 2026-07-29 |
| MSFT | 10-Q | 2026-04-29 |

Refresh them with:

```powershell
python scripts/fetch_sec_filings.py
```

## Stages and RDD operations

Each stage is timed and recorded in `run_summary.json` (`stages[]`), which the
dashboard renders. Measured on the committed snapshot:

| # | Stage | RDD operations | In → Out |
| --- | --- | --- | --- |
| 1 | Load + normalise | `parallelize`, `map`, `filter`, `cache` | 5 → 5 |
| 2 | Section extraction | `flatMap`, `filter` | 5 → 51 |
| 3 | Sentence tokenisation | `mapPartitions`, `filter`, `count` | 51 → 2,252 |
| 4 | Global term frequency | `flatMap`, `map`, `filter`, `reduceByKey`, `takeOrdered` | 2,252 → top 50 |
| 5 | Token document frequency | `combineByKey`, `count` | 2,252 → 3,060 |
| 6 | Section statistics | `map`, `reduceByKey`, `aggregateByKey`, `mapValues`, `join`, `collect` | 2,252 → 50 |
| 7 | Temporal shift | `groupByKey`, `map`, `sortBy`, `flatMap`, `filter` | 51 → 20 |
| 8 | Cross-section divergence | `groupByKey`, `flatMap`, `filter` | 51 → 20 |
| 9 | Anomaly signals | `union`, `map`, `filter`, `takeOrdered` | → 30 |
| 10 | Chunk generation | `mapPartitions`, `collect`, `createDataFrame`, `write.parquet` | 51 → 1,159 |
| 11 | RDD vs DataFrame benchmark | `flatMap`, `map`, `reduceByKey`, `count`, `read.parquet`, `groupBy` | 1,159 → 2,751 terms |
| 12 | Teacher-style API checks | `textFile`, `first`, `filter`, `map`, `reduceByKey`, `count`, `collect`, `take`, `toDebugString`, `read.csv`, `groupBy`, `agg`, `orderBy`, `explain`, `show`, `sql`, `toDF` | 50 -> 37 low-detail sections |

Also used: a **broadcast** stopword set, **accumulators** for malformed
records, and the classroom `textFile` / `first` / `take` / `toDebugString`
sequence in stage 12. `mapPartitions` is used where per-partition setup matters
(sentence splitting, chunk packing) rather than a per-row `map`.

### Why each API appears

- `parallelize` — turn the local raw-filing list into the initial RDD.
- `map` / `filter` — normalise records, drop malformed filings.
- `flatMap` — one filing becomes many sections/sentences/terms.
- `mapPartitions` — amortise splitting and chunking setup per partition.
- `reduceByKey` — global term counts; `takeOrdered` gets top terms without a
  full sort.
- `combineByKey` — document frequency with per-partition combiners.
- `aggregateByKey` + `join` — per-section token/entropy statistics joined to
  section metadata.
- `groupByKey` — chronological grouping for temporal and cross-section
  comparisons (small, controlled cardinality).
- `sortBy` — order a company's filings by date before diffing.
- `union` — merge temporal and cross-section signals.
- `count` / `collect` — actions that force execution.
- `cache` — the normalised filing RDD is reused by several stages.

## Output artifacts

Written atomically to `data/curated/latest/` (override root with
`ANOMALY_DATA_DIR`):

| File | Rows | Consumer |
| --- | --- | --- |
| `companies.json` | 2 | company list/header |
| `filings.json` | 5 | filings list + `FilingViewer` |
| `chunks.json` / `chunks.parquet` | 1,159 | evidence snippets, Parquet benchmark |
| `anomalies.json` | 30 | anomaly cards/table |
| `features.json` | 40 | temporal + cross-section feature panels |
| `top_terms.json` | 50 | term frequency panel |
| `section_stats.json` | 50 | section statistics panel |
| `section_stats.csv` | 50 | classroom `sc.textFile` / `spark.read.csv` input |
| `teacher_checks.json` | 1 | RDD/DataFrame parity, lineage, SQL result |
| `run_summary.json` | 1 | stage timeline, counts, benchmark, artifact list |

Each run is also archived as `data/curated/runs/<run_id>.json`.

`prices.json` is not produced by Spark (Spark handles filings). Fetch it with:

```powershell
python scripts/fetch_prices.py --years 3
```

The gateway falls back to committed `prices.json` for quotes and charts.

## Run it

### CLI (recommended for the demo)

```powershell
cd services/ingestion-us
$env:ANOMALY_DATA_DIR = "D:\Anomaly Engine\data"
$env:SPARK_LOCAL_DIR  = "D:\Anomaly Engine\.spark-tmp"
.\venv\Scripts\python.exe -u -m app.spark.runner --tickers AAPL MSFT
```

### Classroom-command check only

```powershell
cd services/ingestion-us
.\venv\Scripts\python.exe -u -m app.spark.teacher_demo
```

The full run also calls the same function as stage 12. See
`docs/PYSPARK_TEACHING_ALIGNMENT.md` for the line-by-line command mapping.

### Through the API

```powershell
$body = @{ tickers = $null; wait = $true } | ConvertTo-Json
Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:8000/api/v1/pipeline/run `
  -Body $body -ContentType 'application/json'
```

A full 5-filing API-triggered run took **199 s** end-to-end on the development
laptop (the JVM start dominates; the RDD work itself is seconds).

## Benchmark

The stage 11 benchmark compares two implementations over the same 1,159 chunks:

- RDD path: reuses the cached chunk RDD and runs
  `flatMap → filter → map → reduceByKey → count`.
- DataFrame path: `spark.read.parquet(...) → explode(split(lower(text))) →
  groupBy("word").count()`.

Both paths are warmed once before timing so JVM/JIT startup is excluded.
Measured: **RDD 7,009.9 ms vs DataFrame 492.4 ms (14.2×)** for the same 2,751
distinct terms. Both paths return the identical term set (`match: true`), which
is the correctness check shown on the dashboard. The DataFrame advantage is
expected: Catalyst + whole-stage codegen + Parquet columnar reads. The RDD path
is kept because the assignment requires explicit RDD transformations.

## Memory settings

`session.py` defaults are intentionally small for an 8 GB laptop:

```
SPARK_MASTER=local[1]
SPARK_DRIVER_MEMORY=512m
SPARK_PARALLELISM=1
-XX:MaxMetaspaceSize=160m -XX:ReservedCodeCacheSize=48m
-XX:TieredStopAtLevel=1 -Xss1m
spark.local.dir=<repo>/.spark-tmp
```

On Railway (≥1 GB RAM, 2 GB recommended) the same defaults work. Raise
`SPARK_DRIVER_MEMORY`/`SPARK_MASTER` only if the corpus grows.

## Windows notes

- `HADOOP_HOME` is auto-detected from `infra/hadoop` (bundled `winutils.exe`).
- Use a plain path (`D:\...\data`) with Spark. `Path.as_uri()` percent-encodes
  spaces and breaks Hadoop local reads.
- `spark.local.dir` is redirected to the repo drive because `C:` is nearly
  full on the development machine.

## Verifying the requirement

```powershell
# 1. Stage list proves RDD operations ran
python -c "import json;d=json.load(open('data/curated/latest/run_summary.json'));print(d['engine']);[print(s['name'],s['operations']) for s in d['stages']]"

# 2. Benchmark confirms both APIs agree
python -c "import json;d=json.load(open('data/curated/latest/run_summary.json'));print(d['benchmark'])"

# 3. Classroom RDD/DataFrame commands agree on the same sections
python -c "import json;d=json.load(open('data/curated/latest/teacher_checks.json'));print(d['rdd']['low_detail_sections'],d['dataframe']['low_detail_sections'],d['match']);print(d['rdd']['lineage'])"

# 4. Optional live RDD test (starts a JVM)
$env:RUN_SPARK_TESTS='1'
services\ingestion-us\venv\Scripts\python.exe -m pytest services\ingestion-us\tests\test_spark_smoke.py -q
```
