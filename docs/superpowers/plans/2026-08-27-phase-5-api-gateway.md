# Anomaly Engine — Phase 5: API Gateway

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the central API Gateway — the single entry point the frontend talks to. It fans out to all backend services (ingestion-us, ingestion-market, nlp-engine, backtester), talks to Supabase directly, and exposes a unified REST API.

**Architecture:** FastAPI service on port 8000. Frontend never calls the microservices directly — only the gateway. The gateway owns the business logic: orchestration, aggregation, validation, and data retrieval from Supabase.

**Tech Stack:** Python 3.11, FastAPI, tenacity (retries), SWR-compatible JSON responses

---

## File Structure

```
services/api-gateway/
├── Dockerfile
├── requirements.txt
└── app/
    ├── __init__.py
    ├── main.py                    # FastAPI app + all REST routes
    └── clients/
        ├── __init__.py
        ├── base_client.py         # Shared httpx client with tenacity retries
        ├── ingestion_us.py        # SEC EDGAR ingestion service client
        ├── ingestion_market.py    # Market data service client
        ├── nlp.py                 # FinBERT NLP service client
        ├── backtester.py          # Backtest service client
        └── supabase.py            # Direct Supabase (PostgREST) client
```

---

### Task 1: Base Client + Service Clients

**Files:**
- Create: `services/api-gateway/app/clients/base_client.py`
- Create: `services/api-gateway/app/clients/ingestion_us.py`
- Create: `services/api-gateway/app/clients/ingestion_market.py`
- Create: `services/api-gateway/app/clients/nlp.py`
- Create: `services/api-gateway/app/clients/backtester.py`
- Create: `services/api-gateway/app/clients/supabase.py`

**Interfaces:**
- Produces: One client class per backend service, all using a shared retry-capable HTTP client

- [ ] **Step 1: Create base_client.py**

```python
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

class BaseClient:
    def __init__(self, base_url: str, service_name: str):
        self.base_url = base_url
        self.service_name = service_name
        self.client = httpx.Client(timeout=60.0)

    def _url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    @staticmethod
    def _retry(func):
        return retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10))(func)

    def post(self, path: str, json=None):
        return self.client.post(self._url(path), json=json)

    def get(self, path: str):
        return self.client.get(self._url(path))
```

- [ ] **Step 2: Create the five service clients covering ingest, market, NLP, backtest, and Supabase/PostgREST operations**

```python
# ingestion_us.py
class IngestionUSClient(BaseClient):
    def __init__(self, base_url: str):
        super().__init__(base_url, "ingestion-us")

    def ingest_company(self, ticker: str, filing_types=None, max_filings=20, start_date=None, end_date=None):
        payload = {"ticker": ticker, "filing_types": filing_types or ["10-K", "10-Q"], "max_filings": max_filings}
        if start_date: payload["start_date"] = start_date
        if end_date: payload["end_date"] = end_date
        return self.post("/ingest", json=payload)
```

- [ ] **Step 3: Commit**

```bash
git add services/api-gateway/app/clients/
git commit -m "feat: add api-gateway service clients with retry"
```

---

### Task 2: Main FastAPI App with All Routes

**Files:**
- Create: `services/api-gateway/app/main.py`

**Interfaces:**
- Consumes: All service clients
- Produces: Full REST API for companies, filings, anomalies, market data, backtest, search, health

- [ ] **Step 1: Create main.py with these route groups**

```python
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Anomaly Engine API Gateway", version="0.1.0")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

# Health: aggregates backend service health
@app.get("/health")
async def health():
    return {"status": "healthy", "service": "api-gateway",
            "dependencies": {"ingestion-us": True, "ingestion-market": True,
                             "nlp-engine": True, "backtester": True}}

# GET /api/v1/companies?limit=&offset=        -> list companies
# GET /api/v1/companies/{ticker}               -> company detail
# POST /api/v1/companies/{ticker}/ingest       -> trigger SEC + market ingestion (returns job ids)
# GET /api/v1/filings?ticker=&filing_type=     -> list filings
# GET /api/v1/filings/{id}                     -> filing detail with sections
# GET /api/v1/filings/{id}/chunks              -> filing chunks
# GET /api/v1/filings/{id}/sentiment           -> per-chunk FinBERT scores
# GET /api/v1/anomalies?ticker=&signal_type=&min_score=  -> anomaly signals
# GET /api/v1/anomalies/{id}                   -> anomaly detail
# POST /api/v1/anomalies/analyze/{ticker}      -> kick off NLP analysis
# POST /api/v1/search/similar                  -> pgvector semantic search
# GET /api/v1/market/{ticker}/prices?limit=    -> OHLCV history
# POST /api/v1/market/{ticker}/news            -> Finnhub news
# GET /api/v1/market/{ticker}/quote            -> live quote
# GET /api/v1/backtest/{ticker}                -> stored backtest result
# POST /api/v1/backtest/run/{ticker}           -> run backtest now
```

- [ ] **Step 2: Dockerfile + requirements.txt**

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

```txt
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
pydantic>=2.0
httpx>=0.27.0
tenacity>=8.0.0
python-dotenv>=1.0.0
```

- [ ] **Step 3: Verify** — `curl http://localhost:8000/health` returns all dependencies true; `curl http://localhost:8000/api/v1/companies` returns `{"companies":[],"total":0}`.

- [ ] **Step 4: Commit**

```bash
git add services/api-gateway/
git commit -m "feat: api-gateway complete with full REST API"
```