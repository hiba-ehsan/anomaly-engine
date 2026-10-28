# Anomaly Engine — Design Specification

**Date:** 2026-08-27
**Status:** Approved
**Scope:** Working prototype — SEC EDGAR (US) first, expandable to PK/QA/CN markets

## 1. Overview

Anomaly Engine detects contradictions between companies' public statements and their regulatory filings using FinBERT NLP analysis, before the stock market notices. It pulls SEC filings (10-K, 10-Q, 8-K), analyzes tone and attention patterns, calculates discrepancy scores, and backtests whether high-contradiction scores predict stock drops or volatility.

## 2. System Architecture

### 2.1 Microservices Layout

| Service | Tech | Port | Owns | Communicates Via |
|---|---|---|---|---|
| `api-gateway` | FastAPI (Python 3.11) | 8000 | Routes requests, auth, aggregation | HTTP/gRPC to all services |
| `ingestion-us` | FastAPI + asyncio (Python 3.11) | 8001 | SEC EDGAR adapter, ticker resolution | HTTP to api-gateway |
| `ingestion-market` | FastAPI + asyncio (Python 3.11) | 8002 | YFinance + Finnhub price feeds | HTTP to api-gateway |
| `nlp-engine` | FastAPI + PyTorch (Python 3.11) | 8003 | FinBERT inference, divergence math | gRPC to api-gateway |
| `backtester` | FastAPI + XGBoost (Python 3.11) | 8004 | CAR calculation, volatility prediction | HTTP to api-gateway |
| `task-queue` | Celery + Redis | — | Async job orchestration | Redis pub/sub |
| `redis` | Redis 7 | 6379 | Broker + cache | — |
| `frontend` | Next.js 14 (App Router) | 3000 | Research dashboard | HTTP to api-gateway |

### 2.2 Design Decisions

- **API Gateway pattern** — frontend only talks to `api-gateway`, which fans out to downstream services
- **Each ingestion adapter is its own service** — easy to add SECP/QSE/CNINFO later as new containers
- **NLP engine is isolated** — FinBERT model loading doesn't block API responses
- **Backtester is isolated** — XGBoost training runs independently
- **Task queue orchestrates multi-step workflows** — e.g., "ingest filing → analyze → store → trigger backtest"
- **Python 3.11** for all backend services (stable PyTorch 2.4+ support)

### 2.3 Monorepo Structure

```
anomaly-engine/
├── docker-compose.yml
├── docker-compose.dev.yml
├── services/
│   ├── api-gateway/
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   └── app/
│   │       ├── main.py
│   │       ├── routes/
│   │       │   ├── companies.py
│   │       │   ├── filings.py
│   │       │   ├── anomalies.py
│   │       │   ├── search.py
│   │       │   ├── backtest.py
│   │       │   └── market.py
│   │       └── clients/
│   │           ├── ingestion_us_client.py
│   │           ├── ingestion_market_client.py
│   │           ├── nlp_client.py
│   │           ├── backtester_client.py
│   │           └── supabase_client.py
│   ├── ingestion-us/
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   └── app/
│   │       ├── main.py
│   │       ├── edgar_client.py
│   │       ├── xbrl_parser.py
│   │       └── chunker.py
│   ├── ingestion-market/
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   └── app/
│   │       ├── main.py
│   │       ├── yfinance_client.py
│   │       └── finnhub_client.py
│   ├── nlp-engine/
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   └── app/
│   │       ├── main.py
│   │       ├── finbert_service.py
│   │       ├── divergence.py
│   │       └── attention.py
│   ├── backtester/
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   └── app/
│   │       ├── main.py
│   │       ├── car_engine.py
│   │       └── xgboost_model.py
│   ├── task-queue/
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   └── app/
│   │       ├── celery_app.py
│   │       └── tasks/
│   │           ├── ingest_tasks.py
│   │           ├── nlp_tasks.py
│   │           └── backtest_tasks.py
│   └── frontend/
│       ├── Dockerfile
│       ├── package.json
│       └── src/
│           ├── app/
│           ├── components/
│           └── lib/
├── packages/
│   └── schemas/
│       ├── __init__.py
│       ├── company.py        # CompanyCreate, CompanyResponse, CompanyList
│       ├── filing.py         # FilingCreate, FilingResponse, FilingSection, FilingChunk
│       ├── anomaly.py        # AnomalySignalCreate, AnomalySignalResponse, DivergenceDetails
│       ├── market.py         # PriceHistoryCreate, PriceHistoryResponse, NewsItem
│       ├── backtest.py       # BacktestRequest, BacktestResult, CARResult
│       ├── sentiment.py      # SentimentScore, AttentionMatrix, EmbeddingRequest
│       └── search.py         # SearchRequest, SimilarityResult
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql
└── infra/
    └── redis.conf
```

## 3. Database Schema (Supabase + pgvector)

### 3.1 Tables

```sql
-- Companies master table
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker TEXT UNIQUE NOT NULL,
    cik TEXT,
    name TEXT NOT NULL,
    jurisdiction TEXT NOT NULL,
    sector TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Filings (one row per document)
CREATE TABLE filings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id),
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

-- Filing chunks (sentence/paragraph level)
CREATE TABLE filing_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filing_id UUID REFERENCES filings(id),
    section_type TEXT,
    chunk_index INT,
    text TEXT NOT NULL,
    token_count INT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Embeddings (pgvector)
CREATE TABLE embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id UUID REFERENCES filing_chunks(id),
    model_version TEXT DEFAULT 'finbert-base',
    embedding VECTOR(768),
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON embeddings USING hnsw (embedding vector_cosine_ops);

-- Sentiment analysis results
CREATE TABLE sentiment_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id UUID REFERENCES filing_chunks(id),
    positive FLOAT NOT NULL,
    negative FLOAT NOT NULL,
    neutral FLOAT NOT NULL,
    attention_weights JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Anomaly signals
CREATE TABLE anomaly_signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id),
    signal_type TEXT NOT NULL,
    score FLOAT NOT NULL,
    filing_a_id UUID REFERENCES filings(id),
    filing_b_id UUID REFERENCES filings(id),
    details JSONB,
    detected_at TIMESTAMPTZ DEFAULT now()
);

-- Price history
CREATE TABLE price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id),
    date DATE NOT NULL,
    open FLOAT, high FLOAT, low FLOAT, close FLOAT,
    volume BIGINT,
    adjusted_close FLOAT,
    source TEXT DEFAULT 'yfinance',
    UNIQUE(company_id, date)
);

-- Backtest results
CREATE TABLE backtest_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_id UUID REFERENCES anomaly_signals(id),
    car_30d FLOAT,
    car_60d FLOAT,
    car_90d FLOAT,
    volatility_before FLOAT,
    volatility_after FLOAT,
    xgboost_prediction FLOAT,
    xgboost_confidence FLOAT,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

### 3.2 RPC Function

```sql
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
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT
        fc.id AS chunk_id, fc.text, c.ticker AS company_ticker,
        f.filing_type, f.filing_date,
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

## 4. Data Ingestion Layer

### 4.1 ingestion-us — SEC EDGAR

**Workflow:**
1. Ticker → CIK resolution (cache `company_tickers.json`, refresh weekly)
2. Fetch submissions from `data.sec.gov/submissions/CIK{cik}.json`
3. Filter by form type (10-K, 10-Q, 8-K)
4. Fetch raw HTML from EDGAR archives
5. Parse XBRL inline tags → extract `sections` JSONB
6. Clean text: strip HTML, normalize whitespace, fix encoding
7. Chunk into sentences (spaCy sentence tokenizer)
8. Store `filings` + `filing_chunks` in Supabase

**Key details:**
- Library: `edgartools` for high-level filing access
- Rate limiter: 5 req/s with `asyncio.sleep(0.2)`
- User-Agent: `AnomalyEngine/1.0 (research@anomalyengine.dev)`
- Retry with exponential backoff on 429/503

### 4.2 ingestion-market — YFinance + Finnhub

**Workflow:**
1. Accept ticker + date range
2. Fetch daily OHLCV from YFinance
3. Fetch real-time quotes + news from Finnhub
4. Normalize to `price_history` schema
5. Store in Supabase

**Key details:**
- YFinance: `yf.download(ticker, start=date, end=date, interval="1d")`
- Finnhub: 60 calls/min free tier, cache aggressively
- Backfill 5 years of daily data per company on first ingest

### 4.3 Ingestion API Endpoints

```
POST /ingest/company          # Trigger full ingest for a ticker
GET  /ingest/status/{job_id}  # Check job progress
GET  /ingest/companies        # List ingested companies
```

## 5. NLP Engine

### 5.1 FinBERT Service

**Three inference endpoints:**

```
POST /analyze/sentiment     # text chunks → pos/neg/neutral + confidence
POST /analyze/embeddings    # text chunks → 768-dim vectors
POST /analyze/attention     # text → 12×12 attention matrices per layer
```

**Model loading:**
- Load FinBERT once on container start (~5s cold start)
- `BertModel` for embeddings + attention, `BertForSequenceClassification` for sentiment
- Batch inference: accumulate up to 32 chunks, process in parallel
- FP32 on CPU (50-150ms/sentence), GPU upgrade path available

**Attention extraction:**
- 12 layers × 12 heads, each attention matrix: `(seq_len, seq_len)`
- Store as JSON: `{ "layer_0": { "head_0": [[...], ...] }, ... }`
- Compute which tokens have highest attention to [CLS] → "key sentences"

### 5.2 Divergence Math Engine

| Signal | Formula | Detects |
|---|---|---|
| Cross-Section Discrepancy | Cosine distance between [CLS] embeddings of press release vs risk factors | CEO says X in public, legal says Y |
| Temporal Shift | Cosine distance between this quarter's vs last quarter's risk section embedding | Undisclosed operational changes |
| Attention Divergence | KL-divergence between attention weight distributions | Structural information asymmetry |

**Sentence-level entropy:**
- `H(s) = -Σ p_i * log(p_i)` where p_i is FinBERT softmax
- High entropy = model uncertain = potentially ambiguous language
- Flag sentences where entropy > threshold (calibrated per company)

### 5.3 Chunking Engine

- spaCy `en_core_web_sm` for sentence tokenization
- Extract sections: Item 1A (Risk Factors), Item 7 (MD&A), Item 8 (Financial Statements), 8-K press releases
- Max chunk: 512 tokens (FinBERT limit), split with 50-token overlap
- Each chunk: `{ text, section_type, chunk_index, token_count }`

## 6. Backend API Gateway

### 6.1 Routes

```
# Company Management
GET    /api/v1/companies
GET    /api/v1/companies/{ticker}
POST   /api/v1/companies/{ticker}/ingest

# Filing Access
GET    /api/v1/filings
GET    /api/v1/filings/{filing_id}
GET    /api/v1/filings/{filing_id}/chunks
GET    /api/v1/filings/{filing_id}/sentiment
GET    /api/v1/filings/{filing_id}/attention

# Anomaly Detection
GET    /api/v1/anomalies
GET    /api/v1/anomalies/{signal_id}
POST   /api/v1/anomalies/analyze/{ticker}
GET    /api/v1/anomalies/compare/{ticker_a}/{ticker_b}

# Search
POST   /api/v1/search/similar
POST   /api/v1/search/text

# Backtesting
GET    /api/v1/backtest/{ticker}
POST   /api/v1/backtest/run/{ticker}
GET    /api/v1/backtest/performance

# Market Data
GET    /api/v1/market/{ticker}/prices
GET    /api/v1/market/{ticker}/news
```

### 6.2 Background Task Orchestration

Full pipeline for a company:
1. Ingest filings (ingestion-us)
2. For each filing: chunk → embed → sentiment → divergence (nlp-engine)
3. Run backtest (backtester)

### 6.3 Resilience

- Circuit breaker pattern on all downstream calls (tenacity)
- Retry with exponential backoff (3 retries, 1s/2s/4s)
- Health checks on all services
- Graceful degradation — return filings without sentiment if NLP engine is down

## 7. Frontend Dashboard

### 7.1 Pages

| Route | Purpose |
|---|---|
| `/` | Dashboard home — recent anomalies, market overview |
| `/company/[ticker]` | Company deep-dive — price chart + anomaly markers, filing list |
| `/company/[ticker]/filing/[id]` | Filing viewer — side-by-side diff, section navigator, attention heatmap |
| `/anomalies` | Anomaly explorer — filterable table, severity ranking |
| `/anomalies/[id]` | Signal detail — both filings, divergence breakdown |
| `/backtest` | Backtesting results — CAR charts, XGBoost metrics |
| `/search` | Vector similarity search |

### 7.2 Key Components

**TradingView Lightweight Charts:**
- Candlestick price data with anomaly event markers (red arrows for high scores)
- Zoom, crosshair, time range selection

**Side-by-Side Text Diff Heatmap:**
- Two filing passages rendered left/right
- Sentence-level color: green (aligned), yellow (mild drift), red (strong divergence)
- Click sentence → attention weight heatmap overlay
- Built with `react-diff-viewer` + custom overlay

**Cross-Market Comparison Matrix:**
- Filterable table: rows = companies, columns = metrics
- Heatmap coloring, filter by sector/date
- Note: multi-jurisdiction filtering (PK/QA/CN) is a future enhancement — prototype covers US only

**Anomaly Timeline:**
- Horizontal timeline with filing events + anomaly scores
- Correlate with price movements below

### 7.3 Tech Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 14 (App Router, RSC) |
| Styling | Tailwind CSS + shadcn/ui |
| Charts | TradingView Lightweight Charts + Recharts |
| State | RSC + SWR |
| API client | Generated from FastAPI OpenAPI spec |

## 8. Backtesting Engine

### 8.1 CAR (Cumulative Abnormal Returns)

Event study methodology:
1. Event window: [-5, +30] trading days around filing_date
2. Estimation window: [-250, -30] trading days
3. Market model: R_it = α_i + β_i * R_mt + ε_it (regress against S&P 500)
4. Abnormal returns: AR_it = R_it - (α̂_i + β̂_i * R_mt)
5. Cumulate: CAR[t1,t2] = Σ AR_it
6. Test significance: t-stat + bootstrap p-value

Outputs: `car_30d`, `car_60d`, `car_90d`, `volatility_before`, `volatility_after`

### 8.2 XGBoost Volatility Predictor

**Features:**

| Feature | Source |
|---|---|
| text_discrepancy_score | Cross-section cosine distance |
| cosine_drust | Temporal shift |
| sentence_entropy_mean | Avg FinBERT entropy |
| sentence_entropy_max | Max entropy |
| negative_sentiment_ratio | % negative chunks |
| attention_kl_divergence | KL-div between attention distributions |
| filing_length | Token count |
| days_since_last_filing | Recency signal |
| market_cap | From YFinance |
| sector | One-hot encoded |

**Target:** `volatility_jump` (binary: 1 if 30-day post-filing vol > 2× pre-filing vol)

**Training:** Time-series split (train on earlier filings, test on later), metrics: AUC-ROC, precision/recall

## 9. Infrastructure

### 9.1 Docker Compose Services

```yaml
services:
  api-gateway:     # build from services/api-gateway/
  ingestion-us:    # build from services/ingestion-us/
  ingestion-market: # build from services/ingestion-market/
  nlp-engine:      # build from services/nlp-engine/
  backtester:      # build from services/backtester/
  task-queue:      # build from services/task-queue/
  redis:           # redis:7-alpine
  frontend:        # build from services/frontend/
```

### 9.2 Environment Variables

```
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...

# Redis
REDIS_URL=redis://redis:6379/0

# External APIs
YFINANCE_ENABLED=true
FINNHUB_API_KEY=xxx

# Model
FINBERT_MODEL=ProsusAI/finbert
MODEL_DEVICE=cpu
```

### 9.3 Network

All services on a shared Docker bridge network. Frontend → api-gateway via port 8000. Internal services communicate via service names (e.g., `http://nlp-engine:8003`).

## 10. Phased Implementation (Layer-by-Layer)

| Phase | Layer | Deliverable |
|---|---|---|
| 1 | Schema + Supabase | Migrations run, tables exist, RPC function works |
| 2 | ingestion-us | Can ingest AAPL filings (10-K, 10-Q, 8-K) end-to-end |
| 3 | ingestion-market | Can fetch 5 years of AAPL price data |
| 4 | nlp-engine | FinBERT container running, sentiment + embeddings + attention working |
| 5 | Divergence engine | Anomaly signals computed between filings |
| 6 | api-gateway | All routes wired, inter-service communication working |
| 7 | task-queue | Celery workers orchestrating multi-step pipelines |
| 8 | frontend shell | Next.js running, company list + filing viewer |
| 9 | Dashboard features | TradingView charts, diff heatmap, anomaly markers |
| 10 | backtester | CAR calculation + XGBoost classifier |
| 11 | Full integration | End-to-end: ingest → analyze → detect → backtest → display |
