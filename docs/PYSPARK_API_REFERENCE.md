# PySpark API Reference

This document describes the Spark APIs used in the project, where each one
runs, and what the pipeline proves with them. The implementation is
`services/ingestion-us/app/spark/section_analysis.py`; the main pipeline calls
it as the final stage, so the same code runs in the CLI, the API subprocess and
the dashboard.

## Install and session setup

```powershell
services\ingestion-us\venv\Scripts\python.exe -m pip install pyspark==4.2.0
java -version
```

The project builds one session per job in `app/spark/session.py`:

```python
spark = (
    SparkSession.builder
    .appName("anomaly-engine-sec-rdd")
    .master(os.getenv("SPARK_MASTER", "local[1]"))
    .config("spark.driver.memory", os.getenv("SPARK_DRIVER_MEMORY", "512m"))
    .getOrCreate()
)
```

`master` and heap size come from the environment. `local[1]` / `512m` is the
default because the development laptop has limited free commit memory; a
machine or container with headroom can run `SPARK_MASTER=local[4]` with
`SPARK_DRIVER_MEMORY=1g`. The code is identical either way.

## The question the final stage answers

The stage classifies SEC sections by length and counts them per ticker:

| Vital-signs example | This project | Meaning |
| --- | --- | --- |
| `ward` | `ticker` | group key |
| `spo2 < 92` | `tokens < 500` | alert threshold |
| `vitals.csv` | `section_stats.csv` | input file |
| "low SpO2 readings per ward" | "low-detail sections per ticker" | result |

`section_stats.csv` is written from the section-statistics RDD, so the input is
produced by the pipeline rather than checked in by hand.

## RDD path

```python
sc = spark.sparkContext
lines = sc.textFile("section_stats.csv", minPartitions=8)
header = lines.first()                       # action: first partition only
lines.cache()
lines.count()                                # materialise the cache

rows = lines.filter(lambda line: line != header)
sections = rows.map(lambda line: line.split(",")).map(
    lambda p: (p[0], p[1], int(p[2]))        # ticker, section type, tokens
)
low_detail = sections.filter(lambda r: r[2] < 500)
low_detail_count = low_detail.count()        # action

by_ticker = low_detail.map(lambda r: (r[0], 1)).reduceByKey(lambda a, b: a + b)
rdd_by_ticker = sorted(by_ticker.collect())  # action
sample = sections.take(3)                    # action
lineage = by_ticker.toDebugString().decode("utf-8")
```

| API | Role |
| --- | --- |
| `textFile(..., minPartitions=8)` | read the CSV as lines across 8 partitions |
| `first()` | read the header without scanning the file |
| `cache()` + `count()` | materialise the lines once for reuse |
| `filter` / `map` | drop the header, parse `line.split(",")` |
| `reduceByKey` | shuffle and sum `(ticker, 1)` pairs |
| `count` / `collect` / `take` | actions that trigger the jobs |
| `toDebugString()` | expose the RDD lineage |

## DataFrame path

The stage uses the same fluent style as the reference exercise:

```python
section_df = spark.read.csv(                             # lazy: no data read yet
    "section_stats.csv", header=True, schema=SECTION_SCHEMA
)
print(section_df.rdd.getNumPartitions())                 # no job runs

low = (
    section_df.filter(F.col("tokens") < 500)             # transformation
    .groupBy("ticker")                                   # transformation (wide)
    .agg(F.count("*").alias("low_detail_sections"))      # transformation
    .orderBy(F.desc("low_detail_sections"))              # transformation
)
low.explain(True)   # four plans, query still lazy
low.show()          # the action: the job runs now
```

| API | Role |
| --- | --- |
| `read.csv(header=True, schema=...)` | typed read with an explicit `StructType` |
| `printSchema` / `count` / `columns` | inspect the DataFrame |
| `describe(...).show()` | numeric summary of `tokens` / `sentences` |
| `select` | narrow to ticker, section type, tokens, entropy |
| `withColumnRenamed` | `tokens` -> `token_count` |
| `withColumn(when/otherwise)` | `detail_level = detailed / brief` |
| `dropDuplicates` / `dropna` / `fillna` | clean before aggregation |
| `cache()` + `count()` | materialise the cached sections |
| `rdd.getNumPartitions()` | input partitioning |
| `repartition(4, "ticker")` | partitioned by the group key |
| `filter` / `groupBy` / `agg` / `orderBy` | per-ticker low-detail counts |
| `explain(True)` | parsed, analyzed, optimized and physical plans |
| `show()` | the action |
| `createOrReplaceTempView` + `spark.sql` | the same query in SQL |
| `select(...).rdd.map(...).toDF(...)` | DataFrame -> RDD -> DataFrame round trip |

## Run it

Full pipeline from `services/ingestion-us` (no ticker filter; it always
processes the whole raw snapshot):

```powershell
$env:ANOMALY_DATA_DIR = "D:\Anomaly Engine\data"
$env:SPARK_LOCAL_DIR  = "D:\Anomaly Engine\.spark-tmp"
$env:SPARK_MASTER     = "local[1]"
.\venv\Scripts\python.exe -u -m app.spark.runner
```

Only this stage, reusing the latest run:

```powershell
cd services\ingestion-us
.\venv\Scripts\python.exe -u -m app.spark.section_analysis
```

Through the API:

```powershell
$body = @{ tickers = $null; wait = $true } | ConvertTo-Json
Invoke-RestMethod -Method Post `
  -Uri http://localhost:8000/api/v1/pipeline/run `
  -Body $body -ContentType 'application/json'
```

## Evidence produced

A run writes:

- `data/curated/latest/section_stats.csv` — the shared CSV input.
- `data/curated/latest/section_analysis.json` — RDD result, DataFrame result,
  partition counts, lineage, SQL rows, and `match`.
- `data/curated/latest/run_summary.json` — stage 12 lists its operations and
  `input_rows` / `output_rows`.

Observed output from run `20261102T012655Z`:

| Check | RDD path | DataFrame path |
| --- | --- | --- |
| Input rows | 101 section rows | 101 section rows |
| Partitions | 8 (`textFile(..., minPartitions=8)`) | 1 input, 4 after `repartition(4, "ticker")` |
| Low-detail sections (`tokens < 500`) | 69 | 69 |
| Per ticker | `AAPL 18`, `AMZN 11`, `GOOGL 3`, `MSFT 24`, `NVDA 13` | same |
| Agreement | `match: true` | `match: true` |

The SQL result reports MSFT with 25 sections at 240.08 average tokens, AAPL with
31 at 961.13, NVDA with 20 at 1553.4, AMZN with 19 at 1591.37 and GOOGL with 6 at
2124.5. The DataFrame -> RDD -> DataFrame round trip returns all 101 rows.

The Spark ETL page at `http://localhost:3000/pipeline` renders stage 12 from
`run_summary.json`, including the operation badges and the parity result.
