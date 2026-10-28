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
