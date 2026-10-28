# Anomaly Engine — Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the monorepo, Docker Compose orchestration, shared Pydantic schemas, Supabase database schema, and Redis — the foundation all services build on.

**Architecture:** Monorepo with 6 microservice directories, shared schema package, Docker Compose for local orchestration, Supabase Cloud for PostgreSQL + pgvector.

**Tech Stack:** Python 3.11, FastAPI, Docker, Redis 7, Supabase (Cloud), Pydantic v2, SQLAlchemy (for migrations)

## Global Constraints

- Python 3.11 for all backend services (PyTorch 2.4+ compatibility)
- Supabase Cloud (free tier) for PostgreSQL + pgvector — no local DB container
- Docker Compose for local service orchestration
- Pydantic v2 for all schema definitions
- All services communicate via HTTP/gRPC through api-gateway
- Redis 7 as Celery broker + cache

---

## File Structure

```
anomaly-engine/
├── docker-compose.yml              # Production compose
├── docker-compose.dev.yml          # Dev overrides (hot-reload)
├── .env.example                    # Environment variable template
├── .gitignore
├── packages/
│   └── schemas/
│       ├── __init__.py
│       ├── company.py
│       ├── filing.py
│       ├── sentiment.py
│       ├── anomaly.py
│       ├── market.py
│       ├── backtest.py
│       └── search.py
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql
├── services/
│   ├── api-gateway/
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   └── app/
│   │       ├── __init__.py
│   │       └── main.py
│   ├── ingestion-us/
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   └── app/
│   │       ├── __init__.py
│   │       └── main.py
│   ├── ingestion-market/
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   └── app/
│   │       ├── __init__.py
│   │       └── main.py
│   ├── nlp-engine/
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   └── app/
│   │       ├── __init__.py
│   │       └── main.py
│   ├── backtester/
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   └── app/
│   │       ├── __init__.py
│   │       └── main.py
│   ├── task-queue/
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   └── app/
│   │       ├── __init__.py
│   │       ├── celery_app.py
│   │       └── tasks/
│   │           ├── __init__.py
│   │           ├── ingest_tasks.py
│   │           ├── nlp_tasks.py
│   │           └── backtest_tasks.py
│   └── frontend/
│       ├── Dockerfile
│       ├── package.json
│       ├── next.config.js
│       ├── tailwind.config.js
│       ├── tsconfig.json
│       └── src/
│           └── app/
│               ├── layout.tsx
│               └── page.tsx
└── infra/
    └── redis.conf
```

---

### Task 1: Git Init + .gitignore + .env.example

**Files:**
- Create: `.gitignore`
- Create: `.env.example`

**Interfaces:**
- Produces: Repository root with proper ignore rules and environment template

- [ ] **Step 1: Create .gitignore**

```gitignore
# Python
__pycache__/
*.py[cod]
*$py.class
*.egg-info/
dist/
build/
.eggs/
*.egg
.venv/
venv/
env/

# Docker
docker-compose.override.yml

# Environment
.env
.env.local
.env.*.local

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# Node
node_modules/
.next/
out/

# Jupyter
.ipynb_checkpoints/

# OS
.DS_Store
Thumbs.db

# Model cache
models/
*.bin
*.pt
*.onnx

# Data
*.csv
*.json
!package.json
!tsconfig.json
```

- [ ] **Step 2: Create .env.example**

```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=eyJ...anon-key
SUPABASE_SERVICE_KEY=eyJ...service-role-key

# Redis
REDIS_URL=redis://redis:6379/0

# External APIs
FINNHUB_API_KEY=your-finnhub-key

# Model
FINBERT_MODEL=ProsusAI/finbert
MODEL_DEVICE=cpu

# SEC EDGAR
EDGAR_USER_AGENT=AnomalyEngine/1.0 (research@anomalyengine.dev)
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore .env.example
git commit -m "chore: init repo with gitignore and env template"
```

---

### Task 2: Shared Pydantic Schemas

**Files:**
- Create: `packages/schemas/__init__.py`
- Create: `packages/schemas/company.py`
- Create: `packages/schemas/filing.py`
- Create: `packages/schemas/sentiment.py`
- Create: `packages/schemas/anomaly.py`
- Create: `packages/schemas/market.py`
- Create: `packages/schemas/backtest.py`
- Create: `packages/schemas/search.py`
- Create: `packages/schemas/pyproject.toml`

**Interfaces:**
- Produces: Importable Pydantic models used by all services

- [ ] **Step 1: Create pyproject.toml for schemas package**

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "anomaly-schemas"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "pydantic>=2.0",
]
```

- [ ] **Step 2: Create company.py**

```python
from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class CompanyCreate(BaseModel):
    ticker: str
    cik: Optional[str] = None
    name: str
    jurisdiction: str = "US"
    sector: Optional[str] = None


class CompanyResponse(BaseModel):
    id: str
    ticker: str
    cik: Optional[str]
    name: str
    jurisdiction: str
    sector: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class CompanyList(BaseModel):
    companies: list[CompanyResponse]
    total: int
```

- [ ] **Step 3: Create filing.py**

```python
from pydantic import BaseModel
from datetime import date, datetime
from typing import Optional


class FilingCreate(BaseModel):
    company_id: str
    filing_type: str
    filing_date: date
    accession_number: Optional[str] = None
    period_of_report: Optional[date] = None
    source_url: Optional[str] = None
    raw_html: Optional[str] = None
    clean_text: Optional[str] = None
    sections: Optional[dict] = None
    metadata: Optional[dict] = None


class FilingResponse(BaseModel):
    id: str
    company_id: str
    filing_type: str
    filing_date: date
    accession_number: Optional[str]
    period_of_report: Optional[date]
    source_url: Optional[str]
    sections: Optional[dict]
    metadata: Optional[dict]
    ingested_at: datetime

    model_config = {"from_attributes": True}


class FilingChunk(BaseModel):
    id: str
    filing_id: str
    section_type: Optional[str]
    chunk_index: int
    text: str
    token_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class FilingList(BaseModel):
    filings: list[FilingResponse]
    total: int
```

- [ ] **Step 4: Create sentiment.py**

```python
from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class SentimentScore(BaseModel):
    positive: float
    negative: float
    neutral: float


class AttentionMatrix(BaseModel):
    layers: list[list[list[float]]]
    # layers[layer_idx][head_idx] = seq_len x seq_len matrix


class ChunkSentiment(BaseModel):
    chunk_id: str
    sentiment: SentimentScore
    attention: Optional[AttentionMatrix] = None


class EmbeddingRequest(BaseModel):
    texts: list[str]
    model_version: str = "finbert-base"


class EmbeddingResponse(BaseModel):
    embeddings: list[list[float]]
    model_version: str
    dimensions: int = 768


class SentimentRequest(BaseModel):
    texts: list[str]


class SentimentResponse(BaseModel):
    scores: list[SentimentScore]
```

- [ ] **Step 5: Create anomaly.py**

```python
from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class DivergenceDetails(BaseModel):
    cosine_distance: Optional[float] = None
    kl_divergence: Optional[float] = None
    entropy: Optional[float] = None
    key_sentences: Optional[list[str]] = None


class AnomalySignalCreate(BaseModel):
    company_id: str
    signal_type: str  # 'cross_section', 'temporal_shift', 'attention_drift'
    score: float
    filing_a_id: str
    filing_b_id: str
    details: Optional[DivergenceDetails] = None


class AnomalySignalResponse(BaseModel):
    id: str
    company_id: str
    signal_type: str
    score: float
    filing_a_id: str
    filing_b_id: str
    details: Optional[DivergenceDetails]
    detected_at: datetime

    model_config = {"from_attributes": True}


class AnomalyList(BaseModel):
    signals: list[AnomalySignalResponse]
    total: int
```

- [ ] **Step 6: Create market.py**

```python
from pydantic import BaseModel
from datetime import date, datetime
from typing import Optional


class PriceHistoryCreate(BaseModel):
    company_id: str
    date: date
    open: float
    high: float
    low: float
    close: float
    volume: int
    adjusted_close: float
    source: str = "yfinance"


class PriceHistoryResponse(BaseModel):
    id: str
    company_id: str
    date: date
    open: float
    high: float
    low: float
    close: float
    volume: int
    adjusted_close: float
    source: str

    model_config = {"from_attributes": True}


class NewsItem(BaseModel):
    headline: str
    source: str
    url: str
    summary: Optional[str] = None
    published_at: Optional[datetime] = None
    sentiment: Optional[str] = None
```

- [ ] **Step 7: Create backtest.py**

```python
from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class BacktestRequest(BaseModel):
    ticker: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class CARResult(BaseModel):
    car_30d: Optional[float] = None
    car_60d: Optional[float] = None
    car_90d: Optional[float] = None
    t_stat: Optional[float] = None
    p_value: Optional[float] = None


class BacktestResult(BaseModel):
    id: str
    signal_id: str
    car_30d: Optional[float]
    car_60d: Optional[float]
    car_90d: Optional[float]
    volatility_before: Optional[float]
    volatility_after: Optional[float]
    xgboost_prediction: Optional[float]
    xgboost_confidence: Optional[float]
    created_at: datetime

    model_config = {"from_attributes": True}


class BacktestPerformance(BaseModel):
    total_signals: int
    high_score_signals: int
    predicted_drop_accuracy: float
    avg_car_30d: float
    avg_car_90d: float
```

- [ ] **Step 8: Create search.py**

```python
from pydantic import BaseModel
from typing import Optional


class SearchRequest(BaseModel):
    query: str
    match_count: int = 10
    match_threshold: float = 0.7


class SimilarityResult(BaseModel):
    chunk_id: str
    text: str
    company_ticker: str
    filing_type: str
    filing_date: str
    similarity: float


class SearchResponse(BaseModel):
    results: list[SimilarityResult]
    total: int
```

- [ ] **Step 9: Create __init__.py**

```python
from .company import CompanyCreate, CompanyResponse, CompanyList
from .filing import FilingCreate, FilingResponse, FilingChunk, FilingList
from .sentiment import (
    SentimentScore, AttentionMatrix, ChunkSentiment,
    EmbeddingRequest, EmbeddingResponse, SentimentRequest, SentimentResponse,
)
from .anomaly import AnomalySignalCreate, AnomalySignalResponse, AnomalyList, DivergenceDetails
from .market import PriceHistoryCreate, PriceHistoryResponse, NewsItem
from .backtest import BacktestRequest, BacktestResult, BacktestPerformance, CARResult
from .search import SearchRequest, SearchResponse, SimilarityResult

__all__ = [
    "CompanyCreate", "CompanyResponse", "CompanyList",
    "FilingCreate", "FilingResponse", "FilingChunk", "FilingList",
    "SentimentScore", "AttentionMatrix", "ChunkSentiment",
    "EmbeddingRequest", "EmbeddingResponse", "SentimentRequest", "SentimentResponse",
    "AnomalySignalCreate", "AnomalySignalResponse", "AnomalyList", "DivergenceDetails",
    "PriceHistoryCreate", "PriceHistoryResponse", "NewsItem",
    "BacktestRequest", "BacktestResult", "BacktestPerformance", "CARResult",
    "SearchRequest", "SearchResponse", "SimilarityResult",
]
```

- [ ] **Step 10: Commit**

```bash
git add packages/
git commit -m "feat: add shared Pydantic schemas for all services"
```

---

### Task 3: Supabase Database Schema

**Files:**
- Create: `supabase/migrations/001_initial_schema.sql`

**Interfaces:**
- Produces: Database tables and RPC functions used by all services via Supabase client

- [ ] **Step 1: Write the migration SQL**

```sql
-- Anomaly Engine - Initial Schema
-- Run against Supabase Cloud SQL editor or via supabase db push

-- Companies master table
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker TEXT UNIQUE NOT NULL,
    cik TEXT,
    name TEXT NOT NULL,
    jurisdiction TEXT NOT NULL DEFAULT 'US',
    sector TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Filings (one row per document)
CREATE TABLE IF NOT EXISTS filings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    filing_type TEXT NOT NULL,
    filing_date DATE NOT NULL,
    accession_number TEXT,
    period_of_report DATE,
    source_url TEXT,
    raw_html TEXT,
    clean_text TEXT,
    sections JSONB,
    metadata JSONB,
    ingested_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_filings_company_id ON filings(company_id);
CREATE INDEX idx_filings_filing_type ON filings(filing_type);
CREATE INDEX idx_filings_filing_date ON filings(filing_date);

-- Filing chunks (sentence/paragraph level)
CREATE TABLE IF NOT EXISTS filing_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filing_id UUID REFERENCES filings(id) ON DELETE CASCADE,
    section_type TEXT,
    chunk_index INT,
    text TEXT NOT NULL,
    token_count INT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_filing_chunks_filing_id ON filing_chunks(filing_id);

-- Embeddings (pgvector)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id UUID REFERENCES filing_chunks(id) ON DELETE CASCADE,
    model_version TEXT DEFAULT 'finbert-base',
    embedding VECTOR(768),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_embeddings_chunk_id ON embeddings(chunk_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw ON embeddings USING hnsw (embedding vector_cosine_ops);

-- Sentiment analysis results
CREATE TABLE IF NOT EXISTS sentiment_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id UUID REFERENCES filing_chunks(id) ON DELETE CASCADE,
    positive FLOAT NOT NULL,
    negative FLOAT NOT NULL,
    neutral FLOAT NOT NULL,
    attention_weights JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sentiment_scores_chunk_id ON sentiment_scores(chunk_id);

-- Anomaly signals
CREATE TABLE IF NOT EXISTS anomaly_signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    signal_type TEXT NOT NULL,
    score FLOAT NOT NULL,
    filing_a_id UUID REFERENCES filings(id),
    filing_b_id UUID REFERENCES filings(id),
    details JSONB,
    detected_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_anomaly_signals_company_id ON anomaly_signals(company_id);
CREATE INDEX idx_anomaly_signals_score ON anomaly_signals(score DESC);

-- Price history
CREATE TABLE IF NOT EXISTS price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    open FLOAT,
    high FLOAT,
    low FLOAT,
    close FLOAT,
    volume BIGINT,
    adjusted_close FLOAT,
    source TEXT DEFAULT 'yfinance',
    UNIQUE(company_id, date)
);

CREATE INDEX idx_price_history_company_date ON price_history(company_id, date);

-- Backtest results
CREATE TABLE IF NOT EXISTS backtest_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_id UUID REFERENCES anomaly_signals(id) ON DELETE CASCADE,
    car_30d FLOAT,
    car_60d FLOAT,
    car_90d FLOAT,
    volatility_before FLOAT,
    volatility_after FLOAT,
    xgboost_prediction FLOAT,
    xgboost_confidence FLOAT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_backtest_results_signal_id ON backtest_results(signal_id);

-- RPC function for fast cosine similarity search
CREATE OR REPLACE FUNCTION match_embeddings(
    query_embedding VECTOR(768),
    match_count INT DEFAULT 10,
    match_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
    chunk_id UUID,
    text TEXT,
    company_ticker TEXT,
    filing_type TEXT,
    filing_date DATE,
    similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        fc.id AS chunk_id,
        fc.text,
        c.ticker AS company_ticker,
        f.filing_type,
        f.filing_date,
        1 - (e.embedding <=> query_embedding) AS similarity
    FROM embeddings e
    JOIN filing_chunks fc ON fc.id = e.chunk_id
    JOIN filings f ON f.id = fc.filing_id
    JOIN companies c ON c.id = f.company_id
    WHERE 1 - (e.embedding <=> query_embedding) > match_threshold
    ORDER BY e.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/
git commit -m "feat: add initial database schema with pgvector"
```

---

### Task 4: Docker Compose + Service Stubs

**Files:**
- Create: `docker-compose.yml`
- Create: `docker-compose.dev.yml`
- Create: `infra/redis.conf`
- Create: `services/api-gateway/Dockerfile`
- Create: `services/api-gateway/requirements.txt`
- Create: `services/api-gateway/app/__init__.py`
- Create: `services/api-gateway/app/main.py`
- Create: `services/ingestion-us/Dockerfile`
- Create: `services/ingestion-us/requirements.txt`
- Create: `services/ingestion-us/app/__init__.py`
- Create: `services/ingestion-us/app/main.py`
- Create: `services/ingestion-market/Dockerfile`
- Create: `services/ingestion-market/requirements.txt`
- Create: `services/ingestion-market/app/__init__.py`
- Create: `services/ingestion-market/app/main.py`
- Create: `services/nlp-engine/Dockerfile`
- Create: `services/nlp-engine/requirements.txt`
- Create: `services/nlp-engine/app/__init__.py`
- Create: `services/nlp-engine/app/main.py`
- Create: `services/backtester/Dockerfile`
- Create: `services/backtester/requirements.txt`
- Create: `services/backtester/app/__init__.py`
- Create: `services/backtester/app/main.py`
- Create: `services/task-queue/Dockerfile`
- Create: `services/task-queue/requirements.txt`
- Create: `services/task-queue/app/__init__.py`
- Create: `services/task-queue/app/celery_app.py`
- Create: `services/task-queue/app/tasks/__init__.py`
- Create: `services/task-queue/app/tasks/ingest_tasks.py`
- Create: `services/task-queue/app/tasks/nlp_tasks.py`
- Create: `services/task-queue/app/tasks/backtest_tasks.py`
- Create: `services/frontend/Dockerfile`
- Create: `services/frontend/package.json`
- Create: `services/frontend/next.config.js`
- Create: `services/frontend/tailwind.config.js`
- Create: `services/frontend/tsconfig.json`
- Create: `services/frontend/src/app/layout.tsx`
- Create: `services/frontend/src/app/page.tsx`
- Create: `services/frontend/src/app/globals.css`

**Interfaces:**
- Consumes: Shared schemas (Task 2)
- Produces: All services running via `docker-compose up`, health endpoints responding

- [ ] **Step 1: Create infra/redis.conf**

```conf
maxmemory 128mb
maxmemory-policy allkeys-lru
appendonly yes
appendfsync everysec
```

- [ ] **Step 2: Create docker-compose.yml**

```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - ./infra/redis.conf:/usr/local/etc/redis/redis.conf
    command: redis-server /usr/local/etc/redis/redis.conf
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

  api-gateway:
    build: ./services/api-gateway
    ports:
      - "8000:8000"
    env_file: .env
    depends_on:
      redis:
        condition: service_healthy
    volumes:
      - ./packages:/app/packages

  ingestion-us:
    build: ./services/ingestion-us
    ports:
      - "8001:8001"
    env_file: .env
    depends_on:
      redis:
        condition: service_healthy
    volumes:
      - ./packages:/app/packages

  ingestion-market:
    build: ./services/ingestion-market
    ports:
      - "8002:8002"
    env_file: .env
    depends_on:
      redis:
        condition: service_healthy
    volumes:
      - ./packages:/app/packages

  nlp-engine:
    build: ./services/nlp-engine
    ports:
      - "8003:8003"
    env_file: .env
    volumes:
      - ./packages:/app/packages
      - model-cache:/root/.cache/huggingface

  backtester:
    build: ./services/backtester
    ports:
      - "8004:8004"
    env_file: .env
    depends_on:
      - nlp-engine
    volumes:
      - ./packages:/app/packages

  task-queue:
    build: ./services/task-queue
    env_file: .env
    depends_on:
      redis:
        condition: service_healthy
    volumes:
      - ./packages:/app/packages

  frontend:
    build: ./services/frontend
    ports:
      - "3000:3000"
    depends_on:
      - api-gateway

volumes:
  model-cache:
```

- [ ] **Step 3: Create docker-compose.dev.yml**

```yaml
services:
  api-gateway:
    build:
      context: ./services/api-gateway
      target: development
    volumes:
      - ./services/api-gateway/app:/app/app
      - ./packages:/app/packages

  ingestion-us:
    build:
      context: ./services/ingestion-us
      target: development
    volumes:
      - ./services/ingestion-us/app:/app/app
      - ./packages:/app/packages

  ingestion-market:
    build:
      context: ./services/ingestion-market
      target: development
    volumes:
      - ./services/ingestion-market/app:/app/app
      - ./packages:/app/packages

  nlp-engine:
    build:
      context: ./services/nlp-engine
      target: development
    volumes:
      - ./services/nlp-engine/app:/app/app
      - ./packages:/app/packages

  backtester:
    build:
      context: ./services/backtester
      target: development
    volumes:
      - ./services/backtester/app:/app/app
      - ./packages:/app/packages

  frontend:
    volumes:
      - ./services/frontend/src:/app/src
```

- [ ] **Step 4: Create all service Dockerfiles (multi-stage, production + dev)**

**api-gateway/Dockerfile:**

```dockerfile
FROM python:3.11-slim AS base
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM base AS development
RUN pip install --no-cache-dir watchdog[watchmedo]
CMD ["watchmedo", "auto-restart", "--pattern=*.py", "--recursive", "--", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
```

**ingestion-us/Dockerfile:**

```dockerfile
FROM python:3.11-slim AS base
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]

FROM base AS development
RUN pip install --no-cache-dir watchdog[watchmedo]
CMD ["watchmedo", "auto-restart", "--pattern=*.py", "--recursive", "--", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--reload"]
```

**ingestion-market/Dockerfile:**

```dockerfile
FROM python:3.11-slim AS base
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8002
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]

FROM base AS development
RUN pip install --no-cache-dir watchdog[watchmedo]
CMD ["watchmedo", "auto-restart", "--pattern=*.py", "--recursive", "--", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002", "--reload"]
```

**nlp-engine/Dockerfile:**

```dockerfile
FROM python:3.11-slim AS base
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8003
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8003"]

FROM base AS development
RUN pip install --no-cache-dir watchdog[watchmedo]
CMD ["watchmedo", "auto-restart", "--pattern=*.py", "--recursive", "--", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8003", "--reload"]
```

**backtester/Dockerfile:**

```dockerfile
FROM python:3.11-slim AS base
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8004
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8004"]

FROM base AS development
RUN pip install --no-cache-dir watchdog[watchmedo]
CMD ["watchmedo", "auto-restart", "--pattern=*.py", "--recursive", "--", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8004", "--reload"]
```

**task-queue/Dockerfile:**

```dockerfile
FROM python:3.11-slim AS base
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["celery", "-A", "app.celery_app:celery", "worker", "--loglevel=info", "--concurrency=2"]

FROM base AS development
CMD ["celery", "-A", "app.celery_app:celery", "worker", "--loglevel=debug", "--concurrency=1", "--autoscale=1,0"]
```

**frontend/Dockerfile:**

```dockerfile
FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]
```

- [ ] **Step 5: Create all requirements.txt files**

**api-gateway/requirements.txt:**

```
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
pydantic>=2.0
supabase>=2.0
tenacity>=8.0
httpx>=0.27.0
celery[redis]>=5.4.0
```

**ingestion-us/requirements.txt:**

```
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
pydantic>=2.0
supabase>=2.0
edgartools>=3.0
httpx>=0.27.0
spacy>=3.7
```

**ingestion-market/requirements.txt:**

```
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
pydantic>=2.0
supabase>=2.0
yfinance>=0.2.40
httpx>=0.27.0
```

**nlp-engine/requirements.txt:**

```
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
pydantic>=2.0
torch>=2.4.0
transformers>=4.40.0
numpy>=1.26.0
scipy>=1.12.0
```

**backtester/requirements.txt:**

```
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
pydantic>=2.0
supabase>=2.0
xgboost>=2.0
scikit-learn>=1.4.0
pandas>=2.2.0
numpy>=1.26.0
yfinance>=0.2.40
httpx>=0.27.0
```

**task-queue/requirements.txt:**

```
celery[redis]>=5.4.0
supabase>=2.0
httpx>=0.27.0
pydantic>=2.0
```

- [ ] **Step 6: Create all service main.py stubs**

**api-gateway/app/main.py:**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Anomaly Engine API Gateway", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "api-gateway"}


@app.get("/api/v1/companies")
async def list_companies():
    return {"companies": [], "total": 0}


@app.get("/api/v1/companies/{ticker}")
async def get_company(ticker: str):
    return {"ticker": ticker, "message": "stub"}


@app.post("/api/v1/companies/{ticker}/ingest")
async def ingest_company(ticker: str):
    return {"ticker": ticker, "status": "ingest_triggered"}


@app.get("/api/v1/filings")
async def list_filings():
    return {"filings": [], "total": 0}


@app.get("/api/v1/filings/{filing_id}")
async def get_filing(filing_id: str):
    return {"filing_id": filing_id, "message": "stub"}


@app.get("/api/v1/filings/{filing_id}/chunks")
async def get_filing_chunks(filing_id: str):
    return {"chunks": [], "total": 0}


@app.get("/api/v1/anomalies")
async def list_anomalies():
    return {"signals": [], "total": 0}


@app.post("/api/v1/search/similar")
async def search_similar():
    return {"results": [], "total": 0}


@app.get("/api/v1/backtest/{ticker}")
async def get_backtest(ticker: str):
    return {"ticker": ticker, "message": "stub"}


@app.post("/api/v1/backtest/run/{ticker}")
async def run_backtest(ticker: str):
    return {"ticker": ticker, "status": "backtest_triggered"}
```

**ingestion-us/app/main.py:**

```python
from fastapi import FastAPI

app = FastAPI(title="Ingestion US (SEC EDGAR)", version="0.1.0")


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "ingestion-us"}


@app.post("/ingest/company")
async def ingest_company():
    return {"status": "stub"}


@app.get("/ingest/status/{job_id}")
async def ingest_status(job_id: str):
    return {"job_id": job_id, "status": "stub"}


@app.get("/ingest/companies")
async def list_ingested():
    return {"companies": []}
```

**ingestion-market/app/main.py:**

```python
from fastapi import FastAPI

app = FastAPI(title="Ingestion Market (YFinance + Finnhub)", version="0.1.0")


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "ingestion-market"}


@app.post("/ingest/prices")
async def ingest_prices():
    return {"status": "stub"}


@app.get("/ingest/status/{job_id}")
async def ingest_status(job_id: str):
    return {"job_id": job_id, "status": "stub"}
```

**nlp-engine/app/main.py:**

```python
from fastapi import FastAPI

app = FastAPI(title="NLP Engine (FinBERT)", version="0.1.0")


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "nlp-engine"}


@app.post("/analyze/sentiment")
async def analyze_sentiment():
    return {"status": "stub"}


@app.post("/analyze/embeddings")
async def analyze_embeddings():
    return {"status": "stub"}


@app.post("/analyze/attention")
async def analyze_attention():
    return {"status": "stub"}


@app.post("/analyze/divergence")
async def analyze_divergence():
    return {"status": "stub"}
```

**backtester/app/main.py:**

```python
from fastapi import FastAPI

app = FastAPI(title="Backtester (CAR + XGBoost)", version="0.1.0")


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "backtester"}


@app.post("/backtest/run/{ticker}")
async def run_backtest(ticker: str):
    return {"ticker": ticker, "status": "stub"}


@app.get("/backtest/{ticker}/results")
async def get_results(ticker: str):
    return {"ticker": ticker, "results": []}


@app.get("/backtest/performance")
async def get_performance():
    return {"status": "stub"}
```

**task-queue/app/celery_app.py:**

```python
from celery import Celery
import os

celery = Celery(
    "anomaly_engine",
    broker=os.getenv("REDIS_URL", "redis://redis:6379/0"),
    backend=os.getenv("REDIS_URL", "redis://redis:6379/0"),
)

celery.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_routes={
        "app.tasks.ingest_tasks.*": {"queue": "ingestion"},
        "app.tasks.nlp_tasks.*": {"queue": "nlp"},
        "app.tasks.backtest_tasks.*": {"queue": "backtest"},
    },
)
```

**task-queue/app/tasks/ingest_tasks.py:**

```python
from app.celery_app import celery


@celery.task(name="ingest.ingest_company")
def ingest_company(ticker: str):
    return {"ticker": ticker, "status": "stub"}
```

**task-queue/app/tasks/nlp_tasks.py:**

```python
from app.celery_app import celery


@celery.task(name="nlp.analyze_filing")
def analyze_filing(filing_id: str):
    return {"filing_id": filing_id, "status": "stub"}
```

**task-queue/app/tasks/backtest_tasks.py:**

```python
from app.celery_app import celery


@celery.task(name="backtest.run_backtest")
def run_backtest(ticker: str):
    return {"ticker": ticker, "status": "stub"}
```

- [ ] **Step 7: Create frontend stubs**

**services/frontend/package.json:**

```json
{
  "name": "anomaly-engine-frontend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "swr": "^2.2.0",
    "lightweight-charts": "^4.2.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.4.0"
  }
}
```

**services/frontend/next.config.js:**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
};

module.exports = nextConfig;
```

**services/frontend/tailwind.config.js:**

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
```

**services/frontend/tsconfig.json:**

```json
{
  "compilerOptions": {
    "target": "es5",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

**services/frontend/src/app/globals.css:**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

**services/frontend/src/app/layout.tsx:**

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Anomaly Engine',
  description: 'SEC filing contradiction detection',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-100">{children}</body>
    </html>
  );
}
```

**services/frontend/src/app/page.tsx:**

```tsx
export default function Home() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-4xl font-bold mb-4">Anomaly Engine</h1>
      <p className="text-gray-400">SEC filing contradiction detection dashboard</p>
    </main>
  );
}
```

- [ ] **Step 8: Create all __init__.py files**

Create empty `__init__.py` files in:
- `services/api-gateway/app/__init__.py`
- `services/ingestion-us/app/__init__.py`
- `services/ingestion-market/app/__init__.py`
- `services/nlp-engine/app/__init__.py`
- `services/backtester/app/__init__.py`
- `services/task-queue/app/__init__.py`
- `services/task-queue/app/tasks/__init__.py`

- [ ] **Step 9: Commit**

```bash
git add .
git commit -m "feat: add Docker Compose, service stubs, and frontend shell"
```

---

### Task 5: Verify Foundation

- [ ] **Step 1: Copy .env.example to .env and fill in Supabase credentials**

```bash
cp .env.example .env
# Edit .env with real Supabase credentials
```

- [ ] **Step 2: Run database migration**

Go to Supabase Cloud SQL Editor and run the contents of `supabase/migrations/001_initial_schema.sql`.

- [ ] **Step 3: Start Docker Compose**

```bash
docker compose up -d
```

Expected: All 8 services start. Redis healthcheck passes.

- [ ] **Step 4: Verify health endpoints**

```bash
curl http://localhost:8000/health   # api-gateway
curl http://localhost:8001/health   # ingestion-us
curl http://localhost:8002/health   # ingestion-market
curl http://localhost:8003/health   # nlp-engine
curl http://localhost:8004/health   # backtester
curl http://localhost:3000          # frontend
```

All should return `{"status": "healthy", ...}` or the Next.js page.

- [ ] **Step 5: Commit**

```bash
git add .env.example
git commit -m "chore: verify foundation services are running"
```
