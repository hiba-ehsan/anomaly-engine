# Anomaly Engine — Phase 6: Task Queue (Celery)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the async task orchestration layer with Celery. Long-running work (SEC ingestion, FinBERT analysis, backtests) must not block API responses. The gateway submits tasks; Celery workers execute them in queues.

**Architecture:** Celery worker service. Four queues: `ingestion`, `nlp`, `backtest`, `pipeline`. Uses Redis Cloud as broker/backend (no local Redis). Tasks call the same backend services the gateway does.

**Tech Stack:** Python 3.11, Celery 5.x, Redis (Cloud), tenacity for retries

---

## File Structure

```
services/task-queue/
├── Dockerfile
├── requirements.txt
└── app/
    ├── __init__.py
    ├── celery_app.py              # Celery instance + config + task registry
    ├── tasks/
    │   ├── __init__.py
    │   ├── ingest_tasks.py        # Company, prices, news, full ingest
    │   ├── nlp_tasks.py           # Analyze filing, compute divergence
    │   ├── backtest_tasks.py      # Run backtest (single/all signals)
    │   └── pipeline_tasks.py      # Daily update, weekly deep analysis
```

---

### Task 1: Celery Base + Task Registry

**Files:**
- Create: `services/task-queue/app/celery_app.py`

**Interfaces:**
- Produces: Configured Celery instance with routing for the four queues and auto-discovery of task modules

- [ ] **Step 1: Create celery_app.py**

```python
import os
from celery import Celery

celery_app = Celery(
    "anomaly_engine",
    broker=os.getenv("REDIS_URL"),
    backend=os.getenv("REDIS_URL"),
    include=["app.tasks.ingest_tasks", "app.tasks.nlp_tasks",
             "app.tasks.backtest_tasks", "app.tasks.pipeline_tasks"],
)

celery_app.conf.update(
    task_routes={
        "app.tasks.ingest_tasks.*": {"queue": "ingestion"},
        "app.tasks.nlp_tasks.*": {"queue": "nlp"},
        "app.tasks.backtest_tasks.*": {"queue": "backtest"},
        "app.tasks.pipeline_tasks.*": {"queue": "pipeline"},
    },
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    broker_connection_retry_on_startup=True,
    task_track_started=True,
)
```

- [ ] **Step 2: Commit**

```bash
git add services/task-queue/app/celery_app.py
git commit -m "feat: celery base with 4-queue routing"
```

---

### Task 2: Ingestion Tasks

**Files:**
- Create: `services/task-queue/app/tasks/ingest_tasks.py`

**Interfaces:**
- Consumes: ingestion-us and ingestion-market service clients (shared via the packages folder)
- Produces: `ingest_company`, `ingest_prices`, `ingest_news`, `full_ingest`

- [ ] **Step 1: Create ingest_tasks.py**

```python
from app.celery_app import celery_app
from app.tasks.shared import ingestion_us_client, ingestion_market_client


@celery_app.task(name="app.tasks.ingest_tasks.ingest_company", bind=True, max_retries=3)
def ingest_company(self, ticker: str, filing_types=None, max_filings=20):
    resp = ingestion_us_client.ingest_company(ticker, filing_types, max_filings)
    if resp.status_code != 200:
        raise self.retry(exc=Exception(f"ingestion-us failed: {resp.status_code}"), countdown=60)
    return {"ticker": ticker, "filings": len(resp.json().get("filings", []))}


@celery_app.task(name="app.tasks.ingest_tasks.ingest_prices")
def ingest_prices(ticker: str, lookback_years: int = 5):
    return ingestion_market_client.ingest_prices(ticker, lookback_years).json()


@celery_app.task(name="app.tasks.ingest_tasks.ingest_news")
def ingest_news(ticker: str, days_back: int = 30):
    return ingestion_market_client.ingest_news(ticker, days_back).json()


@celery_app.task(name="app.tasks.ingest_tasks.full_ingest")
def full_ingest(ticker: str, filing_types=None, max_filings=20):
    ingest_company.delay(ticker, filing_types, max_filings)
    ingest_prices.delay(ticker)
    ingest_news.delay(ticker)
    return {"ticker": ticker, "status": "queued"}
```

- [ ] **Step 2: Commit**

```bash
git add services/task-queue/app/tasks/ingest_tasks.py
git commit -m "feat: celery ingestion tasks"
```

---

### Task 3: NLP Tasks

**Files:**
- Create: `services/task-queue/app/tasks/nlp_tasks.py`

**Interfaces:**
- Produces: `analyze_filing`, `compute_divergence`, `compute_all_divergences`

- [ ] **Step 1: Create nlp_tasks.py**

```python
from app.celery_app import celery_app
from app.tasks.shared import nlp_client, supabase_client


@celery_app.task(name="app.tasks.nlp_tasks.analyze_filing")
def analyze_filing(filing_id: str):
    filing = supabase_client.get_filing(filing_id)
    chunks = supabase_client.get_filing_chunks(filing_id)
    texts = [c["chunk_text"] for c in chunks]
    sentiment = nlp_client.sentiment(texts).json()
    embeddings = nlp_client.embeddings(texts).json()
    supabase_client.save_filing_sentiment(filing_id, sentiment["scores"])
    supabase_client.save_chunk_embeddings(filing_id, embeddings["embeddings"], [c["id"] for c in chunks])
    return {"filing_id": filing_id, "chunks_analyzed": len(texts)}


@celery_app.task(name="app.tasks.nlp_tasks.compute_divergence")
def compute_divergence(filing_a_id: str, filing_b_id: str, signal_type: str = "temporal_shift"):
    a_vec = supabase_client.get_avg_embedding(filing_a_id)
    b_vec = supabase_client.get_avg_embedding(filing_b_id)
    result = nlp_client.divergence(a_vec, b_vec).json()
    supabase_client.insert_anomaly({
        "company_id": ...,
        "filing_a_id": filing_a_id,
        "filing_b_id": filing_b_id,
        "signal_type": signal_type,
        "score": result.get("cosine_distance", 0.0),
        "details": result,
    })
    return result


@celery_app.task(name="app.tasks.nlp_tasks.compute_all_divergences")
def compute_all_divergences(company_id: str):
    # Fetch all filings for company, compute pairwise temporal shifts
    ... 
```

- [ ] **Step 2: Commit**

```bash
git add services/task-queue/app/tasks/nlp_tasks.py
git commit -m "feat: celery nlp analysis tasks"
```

---

### Task 4: Backtest + Pipeline Tasks

**Files:**
- Create: `services/task-queue/app/tasks/backtest_tasks.py`
- Create: `services/task-queue/app/tasks/pipeline_tasks.py`

**Interfaces:**
- Produces: `run_backtest*`, `run_full_pipeline`, `daily_update`, `weekly_deep_analysis`

- [ ] **Step 1: Create backtest_tasks.py**

```python
from app.celery_app import celery_app
from app.tasks.shared import backtester_client

@celery_app.task(name="app.tasks.backtest_tasks.run_backtest")
def run_backtest(ticker: str, signal_type: str, min_score: float):
    return backtester_client.run(ticker, signal_type, min_score).json()

@celery_app.task(name="app.tasks.backtest_tasks.run_backtest_for_signal")
def run_backtest_for_signal(ticker: str, signal_type: str):
    return run_backtest(ticker, signal_type, 0.3)

@celery_app.task(name="app.tasks.backtest_tasks.run_backtest_for_all_signals")
def run_backtest_for_all_signals(ticker: str):
    return [run_backtest(ticker, s, 0.3) for s in ["cross_section", "temporal_shift", "attention_drift"]]
```

- [ ] **Step 2: Create pipeline_tasks.py**

```python
from app.celery_app import celery_app
from app.tasks.ingest_tasks import full_ingest
from app.tasks.nlp_tasks import compute_all_divergences
from app.tasks.backtest_tasks import run_backtest_for_all_signals

@celery_app.task(name="app.tasks.pipeline_tasks.run_full_pipeline")
def run_full_pipeline(ticker: str):
    res = full_ingest(ticker).get()
    compute_all_divergences.delay(res["ticker"])
    run_backtest_for_all_signals.delay(res["ticker"])
    return {"status": "pipeline queued", "ticker": ticker}

@celery_app.task(name="app.tasks.pipeline_tasks.daily_update")
def daily_update():
    # Pull all tracked companies, ingest latest filings + prices
    ...

@celery_app.task(name="app.tasks.pipeline_tasks.weekly_deep_analysis")
def weekly_deep_analysis():
    # Re-run full divergence + backtests on all companies
    ...
```

- [ ] **Step 3: Dockerfile + requirements.txt**

```dockerfile
FROM python:3.11-slim AS base
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["celery", "-A", "app.celery_app.celery_app", "worker", "--loglevel=info", "--concurrency=2"]

FROM base AS development
CMD ["celery", "-A", "app.celery_app.celery_app", "worker", "--loglevel=info", "--concurrency=2", "--pool=solo"]
```

```txt
celery>=5.3.0
redis>=5.0.0
httpx>=0.27.0
tenacity>=8.0.0
```

- [ ] **Step 4: Commit**

```bash
git add services/task-queue/
git commit -m "feat: task-queue complete with celery workers"
```