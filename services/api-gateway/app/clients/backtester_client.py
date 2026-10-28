import os
from typing import Optional, Dict, Any
from .base_client import BaseServiceClient


class BacktesterClient(BaseServiceClient):
    """Client for backtester service (CAR + XGBoost)."""

    def __init__(self):
        base_url = os.getenv("BACKTESTER_URL", "http://backtester:8004")
        super().__init__(base_url)

    async def run_backtest(self, ticker: str, start_date: Optional[str] = None, end_date: Optional[str] = None) -> Dict[str, Any]:
        """Trigger backtest for a company."""
        payload = {"ticker": ticker}
        if start_date:
            payload["start_date"] = start_date
        if end_date:
            payload["end_date"] = end_date
        return await self.post("/backtest/run", json=payload)

    async def get_results(self, ticker: str) -> Dict[str, Any]:
        return await self.get(f"/backtest/{ticker}/results")

    async def get_performance(self) -> Dict[str, Any]:
        return await self.get("/backtest/performance")

    async def health_check(self) -> bool:
        try:
            result = await self.get("/health")
            return result.get("status") == "healthy"
        except Exception:
            return False