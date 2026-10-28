# Anomaly Engine — Phase 3: ingestion-market (YFinance + Finnhub)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a market data ingestion service that fetches daily OHLCV price history from YFinance and news from Finnhub, stores everything in Supabase.

**Architecture:** FastAPI service running on port 8002 with yfinance, httpx for Finnhub, and Supabase client for storage.

**Tech Stack:** Python 3.11, FastAPI, yfinance, httpx, Supabase Python client

## Global Constraints

- Python 3.11 for all backend services
- Supabase Cloud for PostgreSQL — no local DB container
- Finnhub free tier: 60 calls/min — cache aggressively
- YFinance: no rate limit but cache to avoid redundant calls

---

## File Structure

```
services/ingestion-market/
├── Dockerfile
├── requirements.txt
└── app/
    ├── __init__.py
    ├── main.py                # FastAPI routes
    ├── yfinance_client.py     # YFinance price data
    ├── finnhub_client.py      # Finnhub news + quotes
    ├── storage.py             # Supabase client
    └── models.py              # Pydantic models
```

---

### Task 1: Models + YFinance Client

**Files:**
- Create: `services/ingestion-market/app/models.py`
- Create: `services/ingestion-market/app/yfinance_client.py`

**Interfaces:**
- Produces: PriceHistoryCreate, NewsItem models; YFinanceClient class

- [ ] **Step 1: Create models.py**

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


class NewsItem(BaseModel):
    headline: str
    source: str
    url: str
    summary: Optional[str] = None
    published_at: Optional[str] = None
    sentiment: Optional[str] = None


class PriceIngestRequest(BaseModel):
    ticker: str
    start_date: Optional[str] = None  # YYYY-MM-DD
    end_date: Optional[str] = None


class NewsIngestRequest(BaseModel):
    ticker: str
    days_back: int = 30


class IngestStatus(BaseModel):
    job_id: str
    status: str
    ticker: str
    records_created: int = 0
    error: Optional[str] = None
```

- [ ] **Step 2: Create yfinance_client.py**

```python
import yfinance as yf
from datetime import datetime, timedelta
from typing import Optional
import pandas as pd


class YFinanceClient:
    def get_price_history(
        self, ticker: str, start_date: Optional[str] = None, end_date: Optional[str] = None
    ) -> list[dict]:
        try:
            stock = yf.Ticker(ticker)
            if not start_date:
                start_date = (datetime.now() - timedelta(days=5*365)).strftime("%Y-%m-%d")
            if not end_date:
                end_date = datetime.now().strftime("%Y-%m-%d")

            df = stock.history(start=start_date, end=end_date, auto_adjust=False)
            if df.empty:
                return []

            records = []
            for idx, row in df.iterrows():
                records.append({
                    "date": idx.strftime("%Y-%m-%d"),
                    "open": round(float(row["Open"]), 2),
                    "high": round(float(row["High"]), 2),
                    "low": round(float(row["Low"]), 2),
                    "close": round(float(row["Close"]), 2),
                    "volume": int(row["Volume"]),
                    "adjusted_close": round(float(row["Adj Close"]), 2),
                })
            return records
        except Exception as e:
            raise Exception(f"YFinance error for {ticker}: {str(e)}")

    def get_info(self, ticker: str) -> dict:
        try:
            stock = yf.Ticker(ticker)
            info = stock.info
            return {
                "name": info.get("longName", info.get("shortName", ticker)),
                "sector": info.get("sector", "Unknown"),
                "market_cap": info.get("marketCap", 0),
                "currency": info.get("currency", "USD"),
            }
        except Exception:
            return {"name": ticker, "sector": "Unknown", "market_cap": 0, "currency": "USD"}
```

- [ ] **Step 3: Commit**

```bash
git add services/ingestion-market/app/models.py services/ingestion-market/app/yfinance_client.py
git commit -m "feat: add ingestion-market models and YFinance client"
```

---

### Task 2: Finnhub Client + Storage

**Files:**
- Create: `services/ingestion-market/app/finnhub_client.py`
- Create: `services/ingestion-market/app/storage.py`

**Interfaces:**
- Consumes: NewsItem, PriceHistoryCreate from models.py
- Produces: FinnhubClient class; Storage class for Supabase

- [ ] **Step 1: Create finnhub_client.py**

```python
import os
import httpx
from datetime import datetime, timedelta
from typing import Optional


class FinnhubClient:
    BASE_URL = "https://finnhub.io/api/v1"

    def __init__(self):
        self.api_key = os.getenv("FINNHUB_API_KEY", "")
        self.client = httpx.AsyncClient(timeout=15.0)

    async def close(self):
        await self.client.aclose()

    async def get_company_news(self, ticker: str, days_back: int = 30) -> list[dict]:
        if not self.api_key:
            return []

        from_date = (datetime.now() - timedelta(days=days_back)).strftime("%Y-%m-%d")
        to_date = datetime.now().strftime("%Y-%m-%d")

        url = f"{self.BASE_URL}/company-news"
        params = {
            "symbol": ticker,
            "from": from_date,
            "to": to_date,
            "token": self.api_key,
        }

        try:
            resp = await self.client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()

            news = []
            for item in data[:50]:
                news.append({
                    "headline": item.get("headline", ""),
                    "source": item.get("source", ""),
                    "url": item.get("url", ""),
                    "summary": item.get("summary", ""),
                    "published_at": datetime.fromtimestamp(item.get("datetime", 0)).isoformat() if item.get("datetime") else None,
                })
            return news
        except Exception:
            return []

    async def get_quote(self, ticker: str) -> Optional[dict]:
        if not self.api_key:
            return None

        url = f"{self.BASE_URL}/quote"
        params = {"symbol": ticker, "token": self.api_key}

        try:
            resp = await self.client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
            return {
                "current_price": data.get("c", 0),
                "change": data.get("d", 0),
                "percent_change": data.get("dp", 0),
                "high": data.get("h", 0),
                "low": data.get("l", 0),
                "open": data.get("o", 0),
                "previous_close": data.get("pc", 0),
            }
        except Exception:
            return None
```

- [ ] **Step 2: Create storage.py**

```python
import os
from supabase import create_client, Client
from typing import Optional


class Storage:
    def __init__(self):
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY")
        if not url or not key:
            raise ValueError("SUPABASE_URL and SUPABASE_KEY must be set")
        self.client: Client = create_client(url, key)

    async def upsert_company(self, ticker: str, name: str, sector: str) -> str:
        result = (
            self.client.table("companies")
            .upsert({
                "ticker": ticker.upper(),
                "name": name,
                "jurisdiction": "US",
                "sector": sector,
            }, on_conflict="ticker")
            .execute()
        )
        return result.data[0]["id"]

    async def upsert_price_batch(self, company_id: str, prices: list[dict]) -> int:
        rows = []
        for p in prices:
            rows.append({
                "company_id": company_id,
                "date": p["date"],
                "open": p["open"],
                "high": p["high"],
                "low": p["low"],
                "close": p["close"],
                "volume": p["volume"],
                "adjusted_close": p["adjusted_close"],
                "source": "yfinance",
            })

        result = (
            self.client.table("price_history")
            .upsert(rows, on_conflict="company_id,date")
            .execute()
        )
        return len(result.data) if result.data else 0

    async def get_company_by_ticker(self, ticker: str) -> Optional[dict]:
        result = (
            self.client.table("companies")
            .select("*")
            .eq("ticker", ticker.upper())
            .execute()
        )
        return result.data[0] if result.data else None
```

- [ ] **Step 3: Commit**

```bash
git add services/ingestion-market/app/finnhub_client.py services/ingestion-market/app/storage.py
git commit -m "feat: add Finnhub client and storage for market data"
```

---

### Task 3: Main FastAPI App

**Files:**
- Modify: `services/ingestion-market/app/main.py`

**Interfaces:**
- Consumes: All previous modules
- Produces: Full FastAPI app with working endpoints

- [ ] **Step 1: Replace main.py**

```python
import uuid
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from .models import PriceIngestRequest, NewsIngestRequest, IngestStatus
from .yfinance_client import YFinanceClient
from .finnhub_client import FinnhubClient
from .storage import Storage

app = FastAPI(title="Ingestion Market (YFinance + Finnhub)", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

yfinance_client = YFinanceClient()
finnhub_client = FinnhubClient()
storage = Storage()
jobs: dict[str, IngestStatus] = {}


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "ingestion-market"}


@app.post("/ingest/prices")
async def ingest_prices(req: PriceIngestRequest):
    job_id = str(uuid.uuid4())
    status = IngestStatus(job_id=job_id, status="pending", ticker=req.ticker)
    jobs[job_id] = status

    try:
        info = yfinance_client.get_info(req.ticker)
        company_id = await storage.upsert_company(req.ticker, info["name"], info["sector"])

        prices = yfinance_client.get_price_history(req.ticker, req.start_date, req.end_date)
        status.records_created = await storage.upsert_price_batch(company_id, prices)
        status.status = "completed"
    except Exception as e:
        status.status = "failed"
        status.error = str(e)

    return {"job_id": job_id, "status": status.model_dump()}


@app.post("/ingest/news")
async def ingest_news(req: NewsIngestRequest):
    news = await finnhub_client.get_company_news(req.ticker, req.days_back)
    return {"ticker": req.ticker, "news_count": len(news), "news": news}


@app.get("/ingest/status/{job_id}")
async def ingest_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return jobs[job_id].model_dump()


@app.get("/quote/{ticker}")
async def get_quote(ticker: str):
    quote = await finnhub_client.get_quote(ticker)
    if not quote:
        raise HTTPException(status_code=404, detail="Quote not found")
    return {"ticker": ticker, **quote}
```

- [ ] **Step 2: Commit**

```bash
git add services/ingestion-market/app/main.py
git commit -m "feat: add ingestion-market FastAPI routes"
```

---

### Task 4: Update Dockerfile + Verify

**Files:**
- Modify: `services/ingestion-market/Dockerfile`

**Interfaces:**
- Produces: Working Docker build

- [ ] **Step 1: Update Dockerfile**

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

- [ ] **Step 2: Verify imports**

```bash
python -c "
import sys
sys.path.insert(0, 'services/ingestion-market')
from app.models import PriceIngestRequest, NewsIngestRequest
from app.yfinance_client import YFinanceClient
from app.finnhub_client import FinnhubClient
print('All ingestion-market modules import OK')
"
```

- [ ] **Step 3: Commit**

```bash
git add services/ingestion-market/
git commit -m "feat: ingestion-market complete"
```
