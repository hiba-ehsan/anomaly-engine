import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .clients import (
    BacktesterClient,
    IngestionMarketClient,
    IngestionUSClient,
    NLPClient,
    SupabaseClient,
)
from .clients.local_store import LocalStore
from .schemas.ingest import IngestRequest

logger = logging.getLogger(__name__)

ingestion_us: IngestionUSClient = None
ingestion_market: IngestionMarketClient = None
nlp_engine: NLPClient = None
backtester: BacktesterClient = None
supabase: SupabaseClient = None
local = LocalStore()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global ingestion_us, ingestion_market, nlp_engine, backtester, supabase
    ingestion_us = IngestionUSClient()
    ingestion_market = IngestionMarketClient()
    nlp_engine = NLPClient()
    backtester = BacktesterClient()
    supabase = SupabaseClient()
    yield
    await ingestion_us.close()
    await ingestion_market.close()
    await nlp_engine.close()
    await backtester.close()


app = FastAPI(title="Anomaly Engine API Gateway", version="0.2.0", lifespan=lifespan)

_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_origin_regex=os.getenv("CORS_ORIGIN_REGEX") or None,
    allow_credentials="*" not in _origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def _health(client, timeout: float = 2.5) -> bool:
    try:
        return await asyncio.wait_for(client.health_check(), timeout=timeout)
    except Exception:
        return False


@app.get("/health")
async def health():
    dependencies = dict(
        zip(
            ["ingestion-us", "ingestion-market", "nlp-engine", "backtester"],
            await asyncio.gather(
                _health(ingestion_us),
                _health(ingestion_market),
                _health(nlp_engine),
                _health(backtester),
            ),
        )
    )
    return {
        "status": "healthy",
        "service": "api-gateway",
        "data_source": supabase.source,
        "supabase_mirror": supabase.mirror_enabled,
        "pipeline_run": (local.summary() or {}).get("run_id"),
        "dependencies": dependencies,
    }


# ---------------------------------------------------------------------------
# Companies
# ---------------------------------------------------------------------------


@app.get("/api/v1/companies")
async def list_companies(limit: int = Query(100, le=500), offset: int = Query(0, ge=0)):
    companies = await supabase.list_companies(limit=limit, offset=offset)
    return {"companies": companies, "total": len(companies)}


@app.get("/api/v1/companies/{ticker}")
async def get_company(ticker: str):
    company = await supabase.get_company_by_ticker(ticker)
    if not company:
        raise HTTPException(status_code=404, detail=f"Company {ticker} not found")
    return company


@app.post("/api/v1/companies/{ticker}/ingest", status_code=202)
async def ingest_company(ticker: str, request: IngestRequest):
    """Fetch SEC filings through ingestion-us, independent of storage mode."""
    try:
        return await ingestion_us.ingest_company(
            ticker=ticker.upper(),
            filing_types=request.filing_types,
            max_filings=request.max_filings,
        )
    except httpx.HTTPStatusError as exc:
        status_code = (
            exc.response.status_code
            if 400 <= exc.response.status_code < 500
            else 503
        )
        raise HTTPException(
            status_code=status_code,
            detail=f"ingestion-us rejected the request: {exc.response.text}",
        ) from exc
    except Exception as exc:
        logger.exception("Could not start SEC ingestion for %s", ticker)
        raise HTTPException(
            status_code=503,
            detail=f"ingestion-us is unavailable: {exc}",
        ) from exc


@app.get("/api/v1/companies/ingest/status/{job_id}")
async def company_ingest_status(job_id: str):
    try:
        return await ingestion_us.get_ingest_status(job_id)
    except httpx.HTTPStatusError as exc:
        status_code = (
            exc.response.status_code
            if 400 <= exc.response.status_code < 500
            else 503
        )
        raise HTTPException(
            status_code=status_code,
            detail=f"ingestion-us rejected the status request: {exc.response.text}",
        ) from exc
    except Exception as exc:
        logger.exception("Could not read SEC ingestion job %s", job_id)
        raise HTTPException(
            status_code=503,
            detail=f"ingestion-us is unavailable: {exc}",
        ) from exc


# ---------------------------------------------------------------------------
# PySpark pipeline
# ---------------------------------------------------------------------------


class PipelineRunRequest(BaseModel):
    tickers: Optional[list[str]] = None
    wait: bool = False


@app.get("/api/v1/pipeline/latest")
async def pipeline_latest():
    try:
        return await asyncio.wait_for(ingestion_us.spark_latest(), timeout=5.0)
    except Exception:
        summary = local.summary()
        if summary:
            return {**summary, "source": "local-artifacts"}
        raise HTTPException(
            status_code=404,
            detail="No pipeline run yet. Start ingestion-us and POST /api/v1/pipeline/run.",
        )


@app.post("/api/v1/pipeline/run")
async def pipeline_run(request: PipelineRunRequest):
    try:
        return await asyncio.wait_for(
            ingestion_us.start_spark_run(tickers=request.tickers, wait=request.wait),
            timeout=900.0 if request.wait else 15.0,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "ingestion-us is not reachable. Start it on port 8001 "
                f"(uvicorn app.main:app --port 8001). Error: {exc}"
            ),
        ) from exc


@app.get("/api/v1/pipeline/status/{job_id}")
async def pipeline_status(job_id: str):
    try:
        return await asyncio.wait_for(ingestion_us.spark_status(job_id), timeout=5.0)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"ingestion-us unavailable: {exc}") from exc


@app.get("/api/v1/pipeline/raw")
async def pipeline_raw():
    try:
        return await asyncio.wait_for(ingestion_us.spark_raw(), timeout=10.0)
    except Exception:
        return {"files": [], "total": 0}


# ---------------------------------------------------------------------------
# Filings
# ---------------------------------------------------------------------------


@app.get("/api/v1/filings")
async def list_filings(
    ticker: str = Query(None),
    filing_type: str = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
):
    if not ticker:
        raise HTTPException(status_code=400, detail="ticker query parameter required")

    company = await supabase.get_company_by_ticker(ticker)
    if not company:
        raise HTTPException(status_code=404, detail=f"Company {ticker} not found")

    filings = await supabase.get_filings_by_company(company["id"], limit=limit + offset)
    if filing_type:
        filings = [f for f in filings if f.get("filing_type") == filing_type]
    return {"filings": filings[offset : offset + limit], "total": len(filings)}


@app.get("/api/v1/filings/{filing_id}")
async def get_filing(filing_id: str):
    filing = await supabase.get_filing(filing_id)
    if not filing:
        raise HTTPException(status_code=404, detail="Filing not found")
    return filing


@app.get("/api/v1/filings/{filing_id}/chunks")
async def get_filing_chunks(filing_id: str):
    chunks = await supabase.get_filing_chunks(filing_id)
    return {"chunks": chunks, "total": len(chunks)}


@app.get("/api/v1/filings/{filing_id}/sentiment")
async def get_filing_sentiment(filing_id: str):
    scores = await supabase.get_sentiment_for_filing(filing_id)
    return {"scores": scores, "total": len(scores)}




@app.get("/api/v1/anomalies")
async def list_anomalies(
    ticker: str = Query(None),
    signal_type: str = Query(None),
    min_score: float = Query(0.0, ge=0.0, le=1.0),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
):
    if not ticker:
        raise HTTPException(status_code=400, detail="ticker query parameter required")

    company = await supabase.get_company_by_ticker(ticker)
    if not company:
        raise HTTPException(status_code=404, detail=f"Company {ticker} not found")

    signals = await supabase.get_anomalies_for_company(company["id"], limit=200)
    if signal_type:
        signals = [s for s in signals if s.get("signal_type") == signal_type]
    signals = [s for s in signals if float(s.get("score") or 0) >= min_score]
    return {"signals": signals[offset : offset + limit], "total": len(signals)}


@app.get("/api/v1/anomalies/{signal_id}")
async def get_anomaly(signal_id: str):
    signal = await supabase.get_anomaly(signal_id)
    if not signal:
        raise HTTPException(status_code=404, detail="Anomaly signal not found")
    return signal


@app.post("/api/v1/anomalies/analyze/{ticker}")
async def analyze_company(ticker: str):
    """Run the Spark divergence pipeline for a ticker."""
    company = await supabase.get_company_by_ticker(ticker)
    if not company:
        raise HTTPException(status_code=404, detail=f"Company {ticker} not found")

    filings = await supabase.get_filings_by_company(company["id"], limit=10)
    if len(filings) < 2:
        return {
            "ticker": ticker,
            "filings_found": len(filings),
            "message": "Need at least 2 filings for temporal comparison",
        }

    try:
        job = await asyncio.wait_for(
            ingestion_us.start_spark_run(tickers=[ticker], wait=False), timeout=15.0
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Spark service unavailable: {exc}") from exc

    return {
        "ticker": ticker,
        "filings_found": len(filings),
        "job": job,
        "message": "Spark RDD analysis started - poll /api/v1/pipeline/status/{job_id}",
    }

#backtest

@app.post("/api/v1/search/similar")
async def search_similar(
    query_embedding: list[float],
    match_count: int = 10,
    match_threshold: float = 0.7,
):
    if len(query_embedding) != 768:
        raise HTTPException(status_code=400, detail="Embedding must be 768 dimensions")
    results = await supabase.match_embeddings(
        query_embedding=query_embedding,
        match_count=match_count,
        match_threshold=match_threshold,
    )
    return {"results": results, "total": len(results)}


@app.get("/api/v1/backtest/{ticker}")
async def get_backtest(ticker: str):
    company = await supabase.get_company_by_ticker(ticker)
    if not company:
        raise HTTPException(status_code=404, detail=f"Company {ticker} not found")

    anomalies = await supabase.get_anomalies_for_company(company["id"])
    results = [
        {
            "signal_id": anomaly.get("id"),
            "signal_type": anomaly.get("signal_type"),
            "score": anomaly.get("score"),
            "filing_date": anomaly.get("detected_at"),
            "car_30d": None,
            "car_60d": None,
            "car_90d": None,
        }
        for anomaly in anomalies
    ]
    return {
        "ticker": ticker,
        "results": results,
        "summary": {
            "signals": len(results),
            "mean_score": round(sum(item["score"] or 0 for item in results) / len(results), 4)
            if results
            else 0,
            "note": "CAR requires price history; run the market ingestion or add data/curated/latest/prices.json.",
        },
    }


@app.post("/api/v1/backtest/run/{ticker}")
async def run_backtest(ticker: str):
    try:
        result = await backtester.run_backtest(ticker=ticker)
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Backtester service unavailable: {exc}",
        ) from exc
    return {"ticker": ticker, "job": result}



#Market data


@app.get("/api/v1/market/{ticker}/prices")
async def get_market_prices(ticker: str, limit: int = Query(500, le=2000)):
    company = await supabase.get_company_by_ticker(ticker)
    if not company:
        raise HTTPException(status_code=404, detail=f"Company {ticker} not found")
    prices = await supabase.get_price_history(company["id"], limit=limit)
    return {"prices": prices, "total": len(prices)}


@app.get("/api/v1/market/{ticker}/news")
async def get_market_news(ticker: str, days_back: int = Query(30, le=365)):
    try:
        return await ingestion_market.ingest_news(ticker=ticker, days_back=days_back)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"News service unavailable: {exc}") from exc


@app.get("/api/v1/market/{ticker}/quote")
async def get_market_quote(ticker: str):
    try:
        quote = await ingestion_market.get_quote(ticker)
        if quote:
            return {"ticker": ticker, **quote}
    except Exception:
        pass

    company = await supabase.get_company_by_ticker(ticker)
    if company:
        prices = await supabase.get_price_history(company["id"], limit=1)
        if prices:
            latest = prices[0]
            return {
                "ticker": ticker,
                "price": latest.get("close"),
                "previous_close": latest.get("open"),
                "date": latest.get("date"),
                "source": "curated-prices",
            }
    raise HTTPException(status_code=404, detail="Quote not available")
