import os
import asyncio
import httpx
import logging
from typing import Optional

from .models import CompanyInfo, FilingInfo


logger = logging.getLogger(__name__)


class EdgarClientError(RuntimeError):
    """Raised when SEC data cannot be retrieved or decoded."""


class EdgarClient:
    BASE_URL = "https://data.sec.gov"
    TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
    USER_AGENT = os.getenv("EDGAR_USER_AGENT", "AnomalyEngine/1.0 (research@anomalyengine.dev)")
    MAX_ATTEMPTS = 3
    RETRY_BASE_SECONDS = 0.5
    MAX_RETRY_SECONDS = 4.0

    def __init__(self):
        self.ticker_map: dict[str, dict] = {}
        self._rate_limit_lock = asyncio.Lock()
        self._last_request_at = 0.0
        self.client = httpx.AsyncClient(
            headers={"User-Agent": self.USER_AGENT},
            timeout=30.0,
            follow_redirects=True,
        )

    async def close(self):
        await self.client.aclose()

    async def _rate_limit(self):
        async with self._rate_limit_lock:
            now = asyncio.get_running_loop().time()
            delay = max(0.2 - (now - self._last_request_at), 0.0)
            if delay:
                await asyncio.sleep(delay)
            self._last_request_at = asyncio.get_running_loop().time()

    async def _request(self, url: str) -> httpx.Response:
        for attempt in range(1, self.MAX_ATTEMPTS + 1):
            try:
                await self._rate_limit()
                response = await self.client.get(url)
            except httpx.TransportError as exc:
                if attempt == self.MAX_ATTEMPTS:
                    raise EdgarClientError(
                        f"SEC request failed after {attempt} attempts: {exc}"
                    ) from exc
                delay = min(
                    self.RETRY_BASE_SECONDS * (2 ** (attempt - 1)),
                    self.MAX_RETRY_SECONDS,
                )
                logger.warning(
                    "SEC transport error on attempt %s/%s; retrying in %.1fs: %s",
                    attempt,
                    self.MAX_ATTEMPTS,
                    delay,
                    exc,
                )
                await asyncio.sleep(delay)
                continue

            if response.status_code == 429 or response.status_code >= 500:
                if attempt == self.MAX_ATTEMPTS:
                    raise EdgarClientError(
                        f"SEC returned HTTP {response.status_code} after "
                        f"{attempt} attempts"
                    )
                delay = min(
                    self.RETRY_BASE_SECONDS * (2 ** (attempt - 1)),
                    self.MAX_RETRY_SECONDS,
                )
                retry_after = response.headers.get("Retry-After")
                if retry_after:
                    try:
                        delay = min(max(float(retry_after), 0.0), self.MAX_RETRY_SECONDS)
                    except ValueError:
                        pass
                logger.warning(
                    "SEC returned HTTP %s on attempt %s/%s; retrying in %.1fs",
                    response.status_code,
                    attempt,
                    self.MAX_ATTEMPTS,
                    delay,
                )
                await asyncio.sleep(delay)
                continue

            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                raise EdgarClientError(
                    f"SEC rejected the request with HTTP {response.status_code}"
                ) from exc
            return response

        raise EdgarClientError("SEC request attempts exhausted")

    async def _get(self, url: str) -> dict:
        response = await self._request(url)
        try:
            data = response.json()
        except ValueError as exc:
            raise EdgarClientError("SEC returned invalid JSON") from exc
        if not isinstance(data, dict):
            raise EdgarClientError("SEC returned an unexpected JSON response")
        return data

    async def load_ticker_map(self):
        if self.ticker_map:
            return
        data = await self._get(self.TICKERS_URL)
        if not data:
            raise EdgarClientError("SEC returned an empty company ticker list")
        for entry in data.values():
            if not isinstance(entry, dict):
                raise EdgarClientError("SEC returned malformed company ticker data")
            ticker = str(entry.get("ticker", "")).upper()
            cik = entry.get("cik_str")
            name = entry.get("title")
            if not ticker or cik is None or not name:
                raise EdgarClientError("SEC returned incomplete company ticker data")
            self.ticker_map[ticker] = {
                "cik": str(cik).zfill(10),
                "name": str(name),
            }
        if not self.ticker_map:
            raise EdgarClientError("SEC returned an empty company ticker list")

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

        filings = []
        filing_data = data.get("filings")
        if not isinstance(filing_data, dict):
            raise EdgarClientError("SEC returned malformed filing metadata")
        recent = filing_data.get("recent")
        if not isinstance(recent, dict):
            raise EdgarClientError("SEC returned malformed filing metadata")
        forms = recent.get("form", [])
        dates = recent.get("filingDate", [])
        accessions = recent.get("accessionNumber", [])
        primary_docs = recent.get("primaryDocument", [])
        periods = recent.get("periodOfReport", [])
        if not all(
            isinstance(values, list)
            for values in (forms, dates, accessions, primary_docs, periods)
        ):
            raise EdgarClientError("SEC returned malformed filing metadata")

        for i, form in enumerate(forms[:200]):
            if form in filing_types and len(filings) < max_filings:
                if i >= min(len(dates), len(accessions), len(primary_docs)):
                    raise EdgarClientError("SEC returned incomplete filing metadata")
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

    async def fetch_filing_html(self, url: str) -> str:
        response = await self._request(url)
        return response.text
