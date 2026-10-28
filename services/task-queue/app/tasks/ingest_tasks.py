import httpx
import os
from app.celery_app import celery


INGESTION_US_URL = os.getenv("INGESTION_US_URL", "http://ingestion-us:8001")
INGESTION_MARKET_URL = os.getenv("INGESTION_MARKET_URL", "http://ingestion-market:8002")


@celery.task(name="ingest.ingest_company", bind=True, max_retries=3, default_retry_delay=60)
def ingest_company(self, ticker: str, filing_types: list = None, max_filings: int = 10):
    """Trigger SEC EDGAR ingestion for a company."""
    if filing_types is None:
        filing_types = ["10-K", "10-Q", "8-K"]
    
    try:
        with httpx.Client(timeout=60.0) as client:
            payload = {
                "ticker": ticker,
                "filing_types": filing_types,
                "max_filings": max_filings,
            }
            response = client.post(f"{INGESTION_US_URL}/ingest/company", json=payload)
            response.raise_for_status()
            return response.json()
    except Exception as exc:
        raise self.retry(exc=exc)


@celery.task(name="ingest.ingest_prices", bind=True, max_retries=3, default_retry_delay=60)
def ingest_prices(self, ticker: str, start_date: str = None, end_date: str = None):
    """Trigger market price ingestion for a company."""
    try:
        with httpx.Client(timeout=60.0) as client:
            payload = {"ticker": ticker}
            if start_date:
                payload["start_date"] = start_date
            if end_date:
                payload["end_date"] = end_date
            
            response = client.post(f"{INGESTION_MARKET_URL}/ingest/prices", json=payload)
            response.raise_for_status()
            return response.json()
    except Exception as exc:
        raise self.retry(exc=exc)


@celery.task(name="ingest.ingest_news", bind=True, max_retries=3, default_retry_delay=60)
def ingest_news(self, ticker: str, days_back: int = 30):
    """Trigger news ingestion from Finnhub."""
    try:
        with httpx.Client(timeout=60.0) as client:
            payload = {"ticker": ticker, "days_back": days_back}
            response = client.post(f"{INGESTION_MARKET_URL}/ingest/news", json=payload)
            response.raise_for_status()
            return response.json()
    except Exception as exc:
        raise self.retry(exc=exc)


@celery.task(name="ingest.full_ingest", bind=True, max_retries=3, default_retry_delay=60)
def full_ingest(self, ticker: str, filing_types: list = None, max_filings: int = 10):
    """Run full ingestion pipeline: SEC filings + market prices + news."""
    if filing_types is None:
        filing_types = ["10-K", "10-Q", "8-K"]
    
    # Chain: SEC filings → prices → news
    from celery import chain, group
    
    # Run SEC and market in parallel, then news
    sec_task = ingest_company.s(ticker=ticker, filing_types=filing_types, max_filings=max_filings)
    price_task = ingest_prices.s(ticker=ticker)
    news_task = ingest_news.s(ticker=ticker)
    
    # Run SEC and prices in parallel, then news
    pipeline = chain(
        group(sec_task, price_task),
        news_task
    )
    
    result = pipeline.apply_async()
    return {"job_id": result.id, "status": "started"}