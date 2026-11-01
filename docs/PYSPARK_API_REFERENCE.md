# PySpark Teaching Alignment

This note maps the commands from the class material directly to the project.
The runnable implementation is
`services/ingestion-us/app/spark/teacher_demo.py`; the main pipeline calls the
same function as stage 12.

## Install and load

The classroom install command:

```powershell
python -m pip install pyspark
```

This project pins the version used by the demo:

```powershell
services\ingestion-us\venv\Scripts\python.exe -m pip install pyspark==4.2.0
```

Spark also needs a compatible JDK. Check it with:

```powershell
java -version
```

The classroom session pattern:

```python
from pyspark.sql import SparkSession

spark = (
    SparkSession.builder
    .appName("AnomalyEngineSEC")
    .master("local[*]")
    .getOrCreate()
)
```

The project uses the same builder pattern in
`app/spark/session.py`, with one deployment adaptation: `master` comes from
`SPARK_MASTER` and defaults to `local[1]` on this 8 GB laptop. On a lab machine
with more RAM:

```powershell
$env:SPARK_MASTER = "local[*]"
$env:SPARK_DRIVER_MEMORY = "1g"
```

The default stays small so the JVM does not exhaust Windows commit memory.

## RDD commands: class example -> project

| Class example | Project adaptation | Where |
| --- | --- | --- |
| `sc.textFile("vitals.csv", minPartitions=8)` | `sc.textFile(section_stats.csv, minPartitions=8)` | `teacher_demo.py` |
| `header = lines.first()` | same: read the CSV header | `teacher_demo.py` |
| `lines.filter(lambda line: line != header)` | same: drop the header | `teacher_demo.py` |
| `line.split(",")` | same: parse ticker, section type, tokens | `teacher_demo.py` |
| `readings.filter(lambda r: r[2] < 92)` | `sections.filter(lambda r: r[2] < 500)` | `teacher_demo.py` |
| `(ward, 1)` + `reduceByKey` | `(ticker, 1)` + `reduceByKey` | `teacher_demo.py` |
| `count()` | count of low-detail sections | `teacher_demo.py` |
| `collect()` | `(ticker, count)` pairs | `teacher_demo.py` |
| `take(3)` | first three parsed sections | `teacher_demo.py` |
| `toDebugString().decode()` | lineage stored in `teacher_checks.json` | `teacher_demo.py` |
| `getNumPartitions()` | input partition count | `teacher_demo.py` |
| `cache()` + `count()` | cache and materialise the CSV lines | `teacher_demo.py` |

The project meaning is the same question with different nouns:

| Classroom | Project |
| --- | --- |
| Ward | Ticker |
| SpO2 reading | Section token count |
| SpO2 below 92% | Section below 500 tokens ("low detail") |
| `vitals.csv` | `section_stats.csv` |
| One million readings | 50 real SEC sections |

## DataFrame commands: class example -> project

| Class example | Project adaptation | Where |
| --- | --- | --- |
| `spark.read.csv(..., header=True, schema=schema)` | same, with `SECTION_SCHEMA` | `teacher_demo.py` |
| `df.printSchema()` | same | `teacher_demo.py` |
| `df.count()`, `df.columns` | same | `teacher_demo.py` |
| `df.describe().show()` | `describe("tokens", "sentences").show()` | `teacher_demo.py` |
| `df.select(...)` | select ticker, section, tokens, entropy | `teacher_demo.py` |
| `withColumnRenamed("tokens", "token_count")` | same | `teacher_demo.py` |
| `withColumn(..., when(...).otherwise(...))` | `detail_level = detailed/brief` | `teacher_demo.py` |
| `dropDuplicates()`, `dropna()`, `fillna()` | clean the section DataFrame | `teacher_demo.py` |
| `df.cache()`, `df.count()` | materialise the cached sections | `teacher_demo.py` |
| `df.rdd.getNumPartitions()` | input partition count | `teacher_demo.py` |
| `df.repartition(4, "ticker")` | same shape as `repartition(4, "city")` | `teacher_demo.py` |
| `filter -> groupBy -> agg -> orderBy` | low-detail sections per ticker | `teacher_demo.py` |
| `explain(True)` | prints all four plans | `teacher_demo.py` |
| `show()` | prints the result | `teacher_demo.py` |
| `createOrReplaceTempView("section_stats")` | same | `teacher_demo.py` |
| `spark.sql("""SELECT ... GROUP BY ...""")` | ticker summary in SQL | `teacher_demo.py` |
| `df.select(...).rdd.map(...).toDF([...])` | DataFrame -> RDD -> DataFrame | `teacher_demo.py` |
| `.write.mode("overwrite").parquet(...)` | `chunks.parquet` | `pipeline.py` |

## Run it

Full project pipeline from `services/ingestion-us`:

```powershell
$env:ANOMALY_DATA_DIR = "D:\Anomaly Engine\data"
$env:SPARK_LOCAL_DIR  = "D:\Anomaly Engine\.spark-tmp"
.\venv\Scripts\python.exe -u -m app.spark.runner --tickers AAPL MSFT
```

Only the classroom-command check, reusing the latest run:

```powershell
cd services\ingestion-us
.\venv\Scripts\python.exe -u -m app.spark.teacher_demo
```

Through the API:

```powershell
$body = @{ tickers = $null; wait = $true } | ConvertTo-Json
Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:8000/api/v1/pipeline/run `
  -Body $body -ContentType 'application/json'
```

## Evidence produced

The full run writes:

- `data/curated/latest/section_stats.csv` — the small CSV both APIs read.
- `data/curated/latest/teacher_checks.json` — RDD result, DataFrame result,
  partition counts, lineage, SQL rows, and `match: true`.
- `data/curated/latest/run_summary.json` — stage 12 includes the operation
  badges `textFile`, `first`, `filter`, `map`, `reduceByKey`, `count`,
  `collect`, `take`, `toDebugString`, `read.csv`, `groupBy`, `agg`, `orderBy`,
  `explain`, `show`, `sql`, and `toDF`.

The Spark ETL page at `http://localhost:3000/pipeline` renders stage 12 from
`run_summary.json`, so the professor can see the taught commands in the live
dashboard rather than only in a separate notebook.

## Observed output (committed run)

From `data/curated/latest/teacher_checks.json`:

| Check | RDD path | DataFrame path |
| --- | --- | --- |
| Input rows | 50 sections | 50 sections |
| Partitions | 8 (`textFile(..., minPartitions=8)`) | 1 input, 4 after `repartition(4, "ticker")` |
| Low-detail sections (`tokens < 500`) | 37 | 37 |
| Low detail per ticker | `AAPL 18`, `MSFT 19` | `AAPL 18`, `MSFT 19` |
| Agreement | `match: true` | `match: true` |

The SQL half of the same artifact shows `MSFT` with 19 sections at 233.53
average tokens and `AAPL` with 31 sections at 961.13 average tokens, and the
DataFrame → RDD → DataFrame round trip returns all 50 rows.
