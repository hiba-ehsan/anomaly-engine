# Viva Notes: PySpark, the Pipeline, and the Architecture

These are my own notes for the defense. They match the code that is in this repo
right now, and the numbers come from the last completed run
`20261102T012655Z`.

---

## 1. What the project does

It downloads real company reports (10-K and 10-Q) from the US SEC, cuts each
report into sections and sentences, and then compares the wording. Two things
get compared:

1. the same section in two different filings from the same company
   (did the risk factors change since last year?), and
2. two different sections inside the same filing
   (does the risk section talk about something different from the results
   section?).

Each comparison becomes a **change score** between 0 and 1. A high score means
the wording moved a lot. The app then shows the score, the top words that were
added or removed, and the two passages side by side.

Apache Spark does the text processing. FastAPI serves the results. Next.js
displays them.

---

## 2. Spark in plain words

Spark is a way to process a big collection of data by splitting it into
**partitions** and running the same small function on each partition in
parallel.

The pieces I actually use:

| Piece | What it means here |
| --- | --- |
| **Driver** | My Python program. It builds the plan and collects the final answers. |
| **Executor / worker** | The process that runs my function on one partition. On this laptop it is the same machine, but the code is the same as a cluster. |
| **RDD** | "Resilient Distributed Dataset": an immutable list that is split into partitions. I build one from the filings. |
| **Transformation** | A step that returns a *new* RDD (`map`, `filter`, `flatMap`, ...). Nothing runs yet. |
| **Action** | A step that asks for a real answer (`count`, `collect`, `take`, `first`, `takeOrdered`). This is what starts the job. |
| **DAG** | The graph of transformations Spark builds before running anything. |
| **Narrow transformation** | Each output partition needs only one input partition. No network movement. `map`, `filter`, `flatMap`, `mapPartitions`. |
| **Wide transformation** | Output partitions need data from many input partitions, so Spark has to **shuffle**. `reduceByKey`, `groupByKey`, `combineByKey`, `aggregateByKey`, `join`, `sortBy`. Shuffles are the expensive part. |

Two more things that are not transformations:

- **Broadcast variable** — I send the stopword list to every worker once:
  `stopwords = sc.broadcast(sorted(STOPWORDS))`, then read it as
  `stopwords.value`. Without it, the whole set would be copied with every task.
- **Accumulator** — a counter that workers can only add to:
  `token_accumulator = sc.accumulator(0)`. The driver reads the total at the end.

**Lazy evaluation** is the idea that Spark waits. Writing `rdd.map(...)` does
nothing. Only `count()` or `collect()` triggers the DAG. That is why the pipeline
records a stage time around the *action*, not around the transformation.

---

## 3. The twelve APIs, one by one

Each entry has: what it does in one sentence, an everyday analogy, and the real
line from my code.

### 3.1 `sc.parallelize`

**What:** turns a normal Python list that already exists on the driver into an
RDD with N partitions.

**Analogy:** handing out one stack of exam papers to each of N markers instead
of one person marking all of them.

```python
raw_rdd = sc.parallelize(records, max(2, min(len(records), 8)))
filings_rdd = (
    raw_rdd.map(normalise_filing)
    .filter(lambda row: row is not None)
    .persist(StorageLevel.MEMORY_AND_DISK)
)
```

Why the awkward partition count: 2 partitions minimum so there is something to
parallelise, 8 maximum because more partitions than filings is wasted overhead.

### 3.2 `map`

**What:** applies a function to every element and returns one new element per
input element. Always 1-to-1. Narrow.

**Analogy:** stamping every page with the same stamp. Same number of pages.

```python
.map(normalise_filing)                       # one filing dict -> one clean filing dict
section_vectors.map(lambda kv: ((kv[0][0], kv[0][1]), {kv[0][2]: kv[1]}))
```

### 3.3 `filter`

**What:** keeps only the elements where the function returns `True`. Narrow. It
can only make the dataset smaller, never bigger.

**Analogy:** throwing away the blank pages.

```python
.filter(lambda row: row is not None)          # drop filings that failed to parse
.filter(lambda row: len(row["text"]) > 400)  # ignore tiny sections
.filter(lambda pair: pair[0] not in stopwords.value)
```

### 3.4 `flatMap`

**What:** like `map`, but the function returns a list, and Spark flattens all
those lists into one. So it is 1-to-many (or 1-to-zero). Narrow.

**Analogy:** one envelope in, several letters out, all put into one pile.

```python
section_rdd = filings_rdd.flatMap(
    lambda row: [
        {... "section_type": section_type, "text": text}
        for section_type, text in row["sections"].items()
    ]
)
```

One filing becomes many sections. Same idea again for words:

```python
token_pairs = sentence_rdd.flatMap(
    lambda row: [(token, 1) for token in tokenize(row["text"])]
)
```

One sentence becomes many `(word, 1)` pairs.

### 3.5 `mapPartitions`

**What:** gives the function the *whole partition* as an iterator, instead of one
element at a time. Narrow. Useful when the work has a setup cost, or when I want
to build rows efficiently.

**Analogy:** one worker takes a whole tray of forms and processes the tray in one
go, rather than being called once per form.

```python
sentence_rdd = section_rdd.mapPartitions(
    lambda partition: (
        row
        for section in partition
        for row in emit_sentences(section)
    )
)
```

Also used for chunk building and for the counters:

```python
def count_tokens(partition):
    for row in partition:
        sentence_accumulator.add(1)
        token_accumulator.add(row["token_count"])
        yield row
```

Caveat I should say out loud: `mapPartitions` can return fewer elements, but it
must fit the partition in memory, which is fine here because one partition is a
handful of sections.

### 3.6 `reduceByKey`

**What:** groups values by key and merges them with a function. It **combines
locally on the map side first**, then shuffles only the partial results. That is
why it is cheaper than `groupByKey`.

**Analogy:** each marker adds up their own stack first, then the stacks are
added together at the end.

```python
token_pairs = (
    sentence_rdd
    .flatMap(lambda row: [(token, 1) for token in tokenize(row["text"])])
    .filter(lambda pair: pair[0] not in stopwords.value)
    .reduceByKey(lambda a, b: a + b)
)
total_tokens = token_pairs.values().sum()
top_term_pairs = token_pairs.takeOrdered(50, key=lambda pair: -pair[1])
```

Also used for section token totals and for `(ticker, 1)` counting in stage 12.

### 3.7 `aggregateByKey`

**What:** like `reduceByKey`, but the output type can be different from the input
type, and I supply three functions: a starting value, how to add one value into
the accumulator, and how to merge two accumulators.

**Analogy:** each marker keeps a notebook. Start with an empty notebook, add each
mark to it, then staple two notebooks together.

```python
section_top_terms = (
    section_token_counts
    .map(lambda kv: (kv[0][:2], (kv[1], kv[0][2])))
    .aggregateByKey(
        [],
        lambda acc, value: acc + [value],
        lambda left, right: left + right,
    )
    .mapValues(lambda values: sorted(values, key=lambda item: (-item[0], item[1]))[:40])
)
```

Here the key is `(filing_key, section_type)`, the accumulator is a list of
`(count, word)`, and the result keeps the 40 most frequent words for that
section. Spark creates a fresh empty list per partition, so the shared `[]` is
safe.

### 3.8 `combineByKey`

**What:** the general form of `reduceByKey`/`aggregateByKey`. I give three
explicit functions: `createCombiner` (first value for a key), `mergeValue` (next
value for the same key), `mergeCombiners` (merge two partitions).

**Analogy:** first student in a group opens a tally sheet, later students add to
it, and at the end two groups' sheets are combined.

```python
def create_doc_frequency(token):
    return 1

def merge_doc_frequency(acc, value):
    return acc + value

def combine_doc_frequencies(left, right):
    return left + right

term_document_frequency = (
    sentence_rdd
    .flatMap(lambda row: [(token, 1) for token in set(tokenize(row["text"]))])
    .combineByKey(create_doc_frequency, merge_doc_frequency, combine_doc_frequencies)
)
vocabulary_size = term_document_frequency.count()
```

`set(...)` is important: a word counts once per sentence, so document frequency
is "how many sentences use this word", not raw frequency. `vocabulary_size` was
**5,838** in the last run.

### 3.9 `groupByKey`

**What:** puts every value for a key into one list. Wide, and it moves everything
across the network without pre-combining, so it is the one to avoid at scale.

**Analogy:** putting every form with the same name into one folder, then handing
the folders out. Nothing is summarised before the move.

```python
temporal_features = (
    section_vectors
    .map(lambda kv: ((filing_meta[kv[0][0]]["ticker"], kv[0][1]),
                     (kv[0][0], filing_meta[kv[0][0]]["filing_date"], kv[1])))
    .groupByKey()
    .flatMap(lambda kv: _temporal_features(kv[0][0], kv[0][1], list(kv[1]), filing_meta))
)
```

Why it is acceptable here: the key is `(ticker, section_type)`, so there are only
about 5 tickers x a few section types. Maybe 30 groups in total. That is small
enough that `groupByKey` is simpler and the shuffle is trivial. It is also the
only way to get *all* the filings of one section into the same place so I can
sort them by date and compare consecutive years.

The same pattern is used for cross-section comparison, keyed by filing:

```python
section_vectors.map(lambda kv: (kv[0][0], (kv[0][1], kv[1])))
.groupByKey()
.flatMap(lambda kv: _cross_section_features(kv[0], list(kv[1]), filing_meta))
```

If the corpus grew to thousands of companies, I would switch the temporal step
to `aggregateByKey` with a small fixed-size structure or use `repartition` +
window functions, and say so.

### 3.10 `join`

**What:** combines two RDDs of `(key, value)` pairs where the keys match. Wide,
because both sides must be shuffled so matching keys land on the same partition.

**Analogy:** matching two lists of student IDs: the marks list and the name list.
Only matching IDs survive.

```python
section_stats = (
    section_totals.join(section_top_terms)
    .map(lambda kv: {...})
)
```

`section_totals` has `(filing, section) -> (tokens, sentences, chars)`, and
`section_top_terms` has `(filing, section) -> [top words]`. Joining them gives me
one row per section with both the size and the vocabulary. This is an inner
join, which is why the table has 101 rows instead of 102: one section had no
countable words, so it had no entry on the right side.

### 3.11 `sortBy`

**What:** sorts the whole RDD by a key. Wide, because Spark has to range-partition
the data to get a global order.

**Analogy:** putting every report into alphabetical order across all desks, not
just within one desk.

```python
section_stats = (
    section_totals.join(section_top_terms)
    .map(...)
    .sortBy(lambda row: (row["ticker"] or "", row["filing_date"] or "", row["section_type"] or ""))
    .collect()
)
```

I sort before `collect()` so the JSON file is readable and stable. I used
`takeOrdered` instead when I only need the top N, because that avoids a full
sort.

### 3.12 `union`

**What:** glues two RDDs together, keeping duplicates. It does not shuffle.

**Analogy:** stapling two piles of paper into one pile. Nothing is compared.

```python
signals_rdd = (
    temporal_features.map(_to_signal)
    .union(cross_features.map(_to_signal))
).filter(lambda row: row is not None and row["score"] >= 0.01)

top_signals = signals_rdd.takeOrdered(30, key=lambda row: -row["score"])
```

The two feature RDDs have the same shape, so `union` gives me one list of change
signals, and then I keep the 30 highest scores.

---

## 4. The twelve stages with real numbers

Run `20261102T012655Z`, 580.73 seconds total, `local[1]`, 512 MB driver.

| # | Stage | Spark calls | In | Out | Time |
| --- | --- | --- | --- | --- | --- |
| 1 | Load and normalise | `parallelize`, `map`, `filter`, `persist` | 11 files | 11 filings | 66.2 s |
| 2 | Section extraction | `flatMap`, `filter` | 11 filings | 102 sections | 54.3 s |
| 3 | Sentence tokenisation | `mapPartitions`, `filter`, `count` | 102 sections | 7,015 sentences | 44.5 s |
| 4 | Global term frequency | `flatMap`, `map`, `filter`, `reduceByKey`, `takeOrdered` | 7,015 | 50 top words | 28.0 s |
| 5 | Document frequency | `combineByKey`, `count` | 7,015 | 5,838 words | 16.1 s |
| 6 | Section statistics | `map`, `reduceByKey`, `aggregateByKey`, `join`, `sortBy` | 7,015 | 101 sections | 71.8 s |
| 7 | Temporal shift | `groupByKey`, `map`, `sortBy`, `flatMap`, `filter` | 102 | 34 features | 18.6 s |
| 8 | Cross-section divergence | `groupByKey`, `flatMap`, `filter` | 102 | 33 features | 7.7 s |
| 9 | Change signals | `union`, `map`, `filter`, `takeOrdered` | — | 30 signals | 10.0 s |
| 10 | Chunk generation | `mapPartitions`, `collect`, `createDataFrame`, `write.parquet` | 102 | 3,759 chunks | 69.2 s |
| 11 | RDD vs DataFrame benchmark | `flatMap`, `map`, `reduceByKey` vs `groupBy` | 3,759 | 4,914 words | 55.2 s |
| 12 | RDD + DataFrame parity | `textFile`, `first`, `filter`, `map`, `reduceByKey`, `read.csv`, `groupBy`, `agg`, `sql`, `toDF` | 101 | 69 sections | 88.1 s |

Totals: 5 companies, 11 filings, 102 sections, 7,015 sentences, 3,759 chunks,
30 change signals.

### Stage 11: RDD vs DataFrame

Same Parquet rows, same word count, two APIs:

| Path | Time | Words |
| --- | --- | --- |
| RDD (`flatMap` + `map` + `reduceByKey`) | 23,955.3 ms | 4,914 |
| DataFrame (`explode` + `groupBy().count()`) | 3,088.7 ms | 4,914 |

DataFrame wins by **7.76x** and the two answers match exactly. That is the honest
result: the DataFrame API goes through Catalyst and Tungsten, so for a simple
group-and-count it is much faster. The RDD API is still used for the main
pipeline because the work is unstructured text with custom partition-level
steps, not a table of numbers.

### Stage 12: the same question twice

Question: which sections have fewer than 500 tokens, and how many does each
company have?

| Company | RDD | DataFrame |
| --- | --- | --- |
| AAPL | 18 | 18 |
| AMZN | 11 | 11 |
| GOOGL | 3 | 3 |
| MSFT | 24 | 24 |
| NVDA | 13 | 13 |
| **Total** | **69** | **69** |

`match: true`. The RDD side reads the CSV with `textFile(..., minPartitions=8)`
and uses `filter` + `map` + `reduceByKey`. The DataFrame side reads the same CSV
with `read.csv(header=True, schema=...)` and uses `filter` + `groupBy` + `agg`,
plus `explain(True)`, `show()`, a SQL view, and a DataFrame -> RDD -> DataFrame
round trip.

This stage is the classroom example from the vital-signs exercise, mapped across:
ward becomes ticker, SpO2 < 92 becomes tokens < 500, `vitals.csv` becomes
`section_stats.csv`.

---

## 5. Where the code lives

All Spark code is in `services/ingestion-us/app/spark/`:

| File | What it does |
| --- | --- |
| `pipeline.py` | The 12-stage RDD pipeline. This is the file to open in the viva. |
| `section_analysis.py` | Stage 12: the RDD and DataFrame parity check. |
| `session.py` | Builds the Spark session (`local[1]`, 512 MB, small JVM memory). |
| `runner.py` | Command line entry: `python -m app.spark.runner`. |

The rest of `services/ingestion-us/app/`:

| File | What it does |
| --- | --- |
| `main.py` | FastAPI service on port 8001, ingest jobs, starts the Spark subprocess. |
| `edgar_client.py` | Talks to the SEC: ticker -> CIK -> filing list -> download HTML. |
| `xbrl_parser.py` | Cleans the HTML and splits a filing into `item_1`, `item_1a`, `item_7`, ... |
| `chunker.py` | Splits text into overlapping ~140-word chunks. |
| `storage.py` | Writes raw and curated JSON; optional Supabase mirror. |
| `filing_manifest.py` | Keeps `data/raw/filings/manifest.json` up to date. |
| `ingest_jobs.py` | Saves job records so a restart does not lose them. |
| `models.py` | Request and response models. |

Data flow:

```
SEC EDGAR
  -> edgar_client.py (download)
  -> xbrl_parser.py (clean + split into sections)
  -> data/raw/filings/<TICKER>/*.json
  -> pipeline.py (PySpark)
  -> data/curated/latest/*.json + *.parquet
  -> api-gateway (FastAPI, port 8000)
  -> Next.js frontend (port 3000)
```

---

## 6. Why the system is built this way

### Why Spark at all?

The work is text comparison across many documents. Spark gives me:

- a real distributed data-flow model (`map`, `flatMap`, `reduceByKey`, `join`),
- partition-level control for expensive tokenising (`mapPartitions`),
- shared counters and broadcast values,
- and a fair RDD vs DataFrame comparison on the same data.

For 11 filings a plain Python loop would be faster. I am not pretending
otherwise. The point is that the same code would scale by changing
`local[1]` to a cluster master; the pipeline does not change.

### Why microservices?

I split the system by responsibility, not by file type:

| Service | Port | Responsibility |
| --- | --- | --- |
| `ingestion-us` | 8001 | SEC download, parsing, Spark pipeline |
| `ingestion-market` | 8002 | price history and market data |
| `nlp-engine` | 8003 | FinBERT sentiment / embeddings |
| `backtester` | 8004 | backtest over change signals |
| `api-gateway` | 8000 | one public API, proxy and aggregation |
| `frontend` | 3000 | Next.js UI |

Reasons this is better than one big server:

1. **Failure isolation.** If FinBERT fails to load, the filing pipeline and the
   dashboard still work.
2. **Different resource profiles.** Spark wants a JVM and megabytes of worker
   memory. FinBERT wants a PyTorch model. The gateway should stay small and fast.
3. **Independent restart.** I fixed the Spark startup crash without touching the
   gateway or the frontend.
4. **Clear API boundary.** The frontend only calls the gateway. It never knows
   which service produced a number.
5. **Subprocess isolation for Spark.** `main.py` runs the Spark job as a separate
   process. When it ends, the JVM and all Python workers are freed. Keeping a
   Spark session alive inside a web server leaks native memory.

The cost is real: more processes to start, more ports, more config. That is why
`start-dev.ps1` exists and why the health endpoint checks all four dependencies.

### Why local files if Supabase is configured?

Both are real. The keys are in `.env` and the client connects
(`GET /health` reports `supabase_mirror: true`).

But the **source of truth is the local curated snapshot**:

- Spark writes the complete result to `data/curated/latest/`.
- Ingestion saves locally first, then tries to mirror to Supabase.
- If Supabase rejects a write (missing table, RLS rule, network), the job logs a
  warning and still succeeds.
- Reads are local-first. Supabase is only used to fill gaps.

The reason is concrete: my Supabase project currently holds only AAPL and 2
filings. If the API read Supabase first, the UI would show 5 companies but 2
filings, which is contradictory. Local-first keeps the demo consistent and lets
it run with no internet.

Honest answer if asked: "The mirror is enabled, but it is not complete yet. The
local snapshot is canonical so the demo cannot break. Backfilling Supabase is
the remaining step."

### Why only 5 companies?

There is no code limit. The app fetches **on demand, one ticker at a time**.
Downloading all Fortune 500 companies would mean:

- SEC asks automated clients to stay around 10 requests/second, so hundreds of
  companies take hours,
- parsing hundreds of filings on one laptop (`local[1]`) takes many more hours,
- and the pipeline reprocesses the whole raw snapshot on every rebuild.

Five tickers were chosen to keep the demo fast and inside SEC limits. Adding a
company needs no code change: **Add company** downloads it and rebuilds.

### Why RDDs instead of DataFrames everywhere?

Because the main data is a nested JSON document with variable sections. I need
to emit zero, one, or many rows per input (`flatMap`), process a whole partition
at once (`mapPartitions`), keep a list accumulator per key (`aggregateByKey`),
and give a word three functions (`combineByKey`). DataFrames are better for the
flat, tabular part, which is exactly what stage 11 and stage 12 show.

---

## 7. Status right now

### Working

- SEC download, HTML cleaning, section splitting, local save.
- Full PySpark pipeline, 12 stages, writes JSON + Parquet.
- RDD vs DataFrame benchmark with matching answers (7.76x).
- RDD/DataFrame parity stage (69 = 69).
- Gateway API: companies, filings, anomalies, pipeline latest, raw snapshot,
  health, market prices, ingest proxy.
- Frontend pages: Overview, Companies, Company detail, Filings, Filings diff,
  Change flags, Change detail, Data pipeline, Backtest. All load live values.
- Company detail actions: "Update from SEC" (download + full rebuild + poll) and
  "Rebuild results" (full rebuild only).
- Loading states: pages show "Loading..." rather than a fake 0 or "not
  reachable" while data is in flight.
- Tests: `ingestion-us` 29 passed / 1 skipped; `api-gateway` 9 passed.
- Restart script is idempotent and uses detached processes.

### Finished

- Five companies with 17 raw filings downloaded (AAPL 6, AMZN 5, MSFT 3,
  NVDA 2, GOOGL 1).
- Last curated run: 11 filings, 102 sections, 7,015 sentences, 3,759 chunks,
  30 change signals, 5,838 distinct terms.
- Supabase mirror wired in as optional and non-fatal.
- Per-ticker runs can no longer delete other companies from the curated output.

### Still in progress / honest gaps

- **17 raw vs 11 curated.** Six filings were downloaded after the last run. The
  pipeline page says "17 downloaded · 11 used in the latest run". Pressing
  "Rebuild results" includes them, but costs 10-15 minutes.
- **Supabase is partial.** Only AAPL rows are there. The mirror needs a backfill.
- **Add-company flow is implemented but not proven end to end** after the latest
  changes. The code path is SEC ingest -> full pipeline -> poll; a cold run is
  10-15 minutes.
- **FinBERT is loaded but not in the main pipeline.** `nlp-engine` is healthy and
  the gateway has a client for it, but the change scores are computed with
  cosine distance and Jensen-Shannon divergence, not model sentiment.
- **Deployment configs exist** (`railway.json`, `vercel.json`, Dockerfiles) but
  were not deployed from this machine.
- **No auth server.** Login is a local demo session; any email/password works and
  nothing leaves the browser. That is deliberate and stated on the login page.

---

## 8. Final technical summary

> Anomaly Engine is a text-change detector for SEC filings. A FastAPI ingestion
> service downloads 10-K/10-Q documents from EDGAR, cleans the HTML, splits each
> filing into sections, and saves a raw JSON snapshot. A PySpark RDD pipeline
> then processes the whole snapshot in 12 stages: it normalises filings, expands
> them into sections, tokenises sentences per partition, computes global term
> frequency and document frequency, builds per-section statistics with
> `aggregateByKey` and `join`, groups sections by company and section type to
> measure year-over-year drift, groups sections by filing to measure internal
> divergence, unions both signal types into one ranked list, packs sentences into
> overlapping chunks, and finally answers the same low-detail-section question
> with both the RDD and DataFrame APIs to prove they agree. Each comparison is a
> weighted mix of cosine distance and Jensen-Shannon divergence, between 0 and 1.
> Results are written as JSON and Parquet to `data/curated/latest`. A FastAPI
> gateway serves them through one API, reading local artifacts first and using
> Supabase as an optional mirror, and a Next.js frontend displays companies,
> filings, change flags, prices, and the pipeline itself. The last run processed
> 11 filings into 102 sections, 7,015 sentences, 3,759 chunks and 30 signals in
> 580.73 seconds; the DataFrame version of the benchmark word count was 7.76x
> faster than the RDD version with identical results, and the RDD/DataFrame
> parity check returned 69 low-detail sections on both sides.

---

## 9. Demo script (about 3 minutes)

1. `powershell -ExecutionPolicy Bypass -File "D:\Anomaly Engine\start-dev.ps1" -IncludeFrontend`
2. Wait for `http://localhost:8000/health` to show 4/4 dependencies.
3. Open `http://localhost:3000`, sign in with any email/password.
4. **Overview**: live counts (5 companies, 11 filings, 30 flags) and the 12-step
   strip. Click a step to show its operation list.
5. **Data pipeline**: point at stage 11 (7.76x) and stage 12 (69 = 69).
6. **Companies -> NVDA**: show 2 filings, 5 flags, and the SEC ID. Explain
   "Update from SEC" without pressing it.
7. **Change flags**: pick GOOGL, show the one flag, open the detail page, read
   the added/removed terms.
8. Open `services/ingestion-us/app/spark/pipeline.py` and show `reduceByKey`,
   `combineByKey`, `aggregateByKey`, `groupByKey`, `join`, `union`.
9. Close with the scalability line: change `SPARK_MASTER` and the same code runs
   on a cluster; local `[1]` is only for this laptop.

If asked to run the pipeline, click **Run the analysis** once and keep talking.
It takes about 10 minutes. The previous results stay on screen while it runs.

---

## 10. Quick answers

**Is this real data?** Yes, downloaded from SEC EDGAR. Company names, CIKs,
accession numbers and filing dates come from the SEC responses.

**Are the numbers hardcoded?** No. Every number in the UI comes from the API,
which reads the artifacts of the last run. Missing values show `—`.

**Why does the change score stop at 1?** It is `min(1, 0.55 * cosine + 0.45 * (2.5 * JS))`.
The weights are a design choice, not a trained model. It is a screening signal,
not proof that a company did something wrong.

**Why cosine and JS divergence?** Cosine compares the direction of the word
vectors. JS divergence compares the shape of the word distributions and is
symmetric and bounded, unlike plain KL divergence.

**What does `persist(MEMORY_AND_DISK)` do?** Keeps an RDD after it is computed so
later stages do not recompute it. If memory runs out, the rest goes to disk. The
pipeline unpersists everything at the end.

**Why `local[1]`?** The laptop ran out of memory with a bigger heap and more
slots. 512 MB and one slot is enough for a few megabytes of text. The code is
unchanged on a bigger machine.
