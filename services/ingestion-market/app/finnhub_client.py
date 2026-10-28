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
