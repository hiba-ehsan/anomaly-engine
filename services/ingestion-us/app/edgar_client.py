import os
import asyncio
import httpx
from typing import Optional
from .models import CompanyInfo, FilingInfo


class EdgarClient:
    BASE_URL = "https://data.sec.gov"
    TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
    USER_AGENT = os.getenv("EDGAR_USER_AGENT", "AnomalyEngine/1.0 (research@anomalyengine.dev)")

    def __init__(self):
        self.ticker_map: dict[str, dict] = {}
        self.client = httpx.AsyncClient(
            headers={"User-Agent": self.USER_AGENT},
            timeout=30.0,
            follow_redirects=True,
        )

    async def close(self):
        await self.client.aclose()

    async def _rate_limit(self):
        await asyncio.sleep(0.2)

    async def _get(self, url: str) -> Optional[dict]:
        try:
            await self._rate_limit()
            resp = await self.client.get(url)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                await asyncio.sleep(5)
                return await self._get(url)
            return None
        except Exception:
            return None

    async def load_ticker_map(self):
        if self.ticker_map:
            return
        data = await self._get(self.TICKERS_URL)
        if data:
            for entry in data.values():
                ticker = entry.get("ticker", "").upper()
                self.ticker_map[ticker] = {
                    "cik": str(entry.get("cik_str", "")).zfill(10),
                    "name": entry.get("title", ""),
                }

    async def resolve_company(self, ticker: str) -> Optional[CompanyInfo]:
        await self.load_ticker_map()
        info = self.ticker_map.get(ticker.upper())
        if not info:
            return None
        return CompanyInfo(
            ticker=ticker.upper(),
            cik=info["cik"],
            name=info["name"],
            jurisdiction="US",
        )

    async def get_filings(
        self, cik: str, filing_types: list[str], max_filings: int = 10
    ) -> list[FilingInfo]:
        url = f"{self.BASE_URL}/submissions/CIK{cik}.json"
        data = await self._get(url)
        if not data:
            return []

        filings = []
        recent = data.get("filings", {}).get("recent", {})
        forms = recent.get("form", [])
        dates = recent.get("filingDate", [])
        accessions = recent.get("accessionNumber", [])
        primary_docs = recent.get("primaryDocument", [])
        periods = recent.get("periodOfReport", [])

        for i, form in enumerate(forms[:200]):
            if form in filing_types and len(filings) < max_filings:
                accn = accessions[i]
                accn_dash = accn.replace("-", "")
                filings.append(FilingInfo(
                    ticker=data.get("tickers", [""])[0] if data.get("tickers") else "",
                    filing_type=form,
                    filing_date=dates[i],
                    accession_number=accn,
                    period_of_report=periods[i] if i < len(periods) else None,
                    source_url=f"https://www.sec.gov/Archives/edgar/data/{cik.lstrip('0')}/{accn_dash}/{primary_docs[i]}",
                ))

        return filings

    async def fetch_filing_html(self, url: str) -> Optional[str]:
        try:
            await self._rate_limit()
            resp = await self.client.get(url)
            resp.raise_for_status()
            return resp.text
        except Exception:
            return None
