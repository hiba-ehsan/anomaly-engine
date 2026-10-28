import os
from typing import Optional, Dict, Any, List
from .base_client import BaseServiceClient


class IngestionUSClient(BaseServiceClient):
    """Client for ingestion-us service (SEC EDGAR)."""

    def __init__(self):
        base_url = os.getenv("INGESTION_US_URL", "http://ingestion-us:8001")
        super().__init__(base_url, timeout=600.0)

    async def ingest_company(self, ticker: str, filing_types: List[str] = None, max_filings: int = 10) -> Dict[str, Any]:
        """Trigger full ingestion for a company."""
        payload = {
            "ticker": ticker,
            "filing_types": filing_types or ["10-K", "10-Q", "8-K"],
            "max_filings": max_filings,
        }
        return await self.post("/ingest/company", json=payload)

    async def get_ingest_status(self, job_id: str) -> Dict[str, Any]:
        """Check ingestion job status."""
        return await self.get(f"/ingest/status/{job_id}")

    async def list_companies(self) -> List[Dict[str, Any]]:
        """List all ingested companies."""
        result = await self.get("/ingest/companies")
        return result.get("companies", [])

    # ------------------------------------------------------------- Spark RDD job
    async def start_spark_run(self, tickers: List[str] | None = None, wait: bool = False) -> Dict[str, Any]:
        """Start the PySpark RDD pipeline over the local raw snapshot."""
        payload: Dict[str, Any] = {"wait": wait}
        if tickers:
            payload["tickers"] = tickers
        return await self.post("/spark/run", json=payload)

    async def spark_status(self, job_id: str) -> Dict[str, Any]:
        return await self.get(f"/spark/status/{job_id}")

    async def spark_latest(self) -> Dict[str, Any]:
        return await self.get("/spark/latest")

    async def spark_raw(self) -> Dict[str, Any]:
        return await self.get("/spark/raw")

    async def health_check(self) -> bool:
        """Check if service is healthy."""
        try:
            result = await self.get("/health")
            return result.get("status") == "healthy"
        except Exception:
            return False