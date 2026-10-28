import os
from typing import Optional, Dict, Any, List
from .base_client import BaseServiceClient


class IngestionMarketClient(BaseServiceClient):
    """Client for ingestion-market service (YFinance + Finnhub)."""

    def __init__(self):
        base_url = os.getenv("INGESTION_MARKET_URL", "http://ingestion-market:8002")
        super().__init__(base_url)

    async def ingest_prices(self, ticker: str, start_date: Optional[str] = None, end_date: Optional[str] = None) -> Dict[str, Any]:
        """Trigger price history ingestion for a company."""
        payload = {"ticker": ticker}
        if start_date:
            payload["start_date"] = start_date
        if end_date:
            payload["end_date"] = end_date
        return await self.post("/ingest/prices", json=payload)

    async def ingest_news(self, ticker: str, days_back: int = 30) -> Dict[str, Any]:
        """Fetch recent news for a company."""
        payload = {"ticker": ticker, "days_back": days_back}
        return await self.post("/ingest/news", json=payload)

    async def get_quote(self, ticker: str) -> Dict[str, Any]:
        """Get real-time quote."""
        return await self.get(f"/quote/{ticker}")

    async def get_ingest_status(self, job_id: str) -> Dict[str, Any]:
        return await self.get(f"/ingest/status/{job_id}")

    async def health_check(self) -> bool:
        try:
            result = await self.get("/health")
            return result.get("status") == "healthy"
        except Exception:
            return False