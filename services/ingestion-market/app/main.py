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
