"""Read-only access to the curated artifacts produced by the Spark pipeline.

This is the demo-safe data source: it works with no Supabase, no network and no
database migrations.  Files are cached by modification time so a newly finished
Spark run is visible to the API immediately.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Optional


_PARENTS = Path(__file__).resolve().parents
REPO_ROOT = _PARENTS[4] if len(_PARENTS) > 4 else _PARENTS[2]
logger = logging.getLogger(__name__)


def data_dir() -> Path:
    return Path(os.getenv("ANOMALY_DATA_DIR", REPO_ROOT / "data"))


def curated_dir() -> Path:
    return data_dir() / "curated" / "latest"


class LocalStore:
    def __init__(self, root: Optional[Path] = None):
        self.root = Path(root) if root else curated_dir()
        self.data_root = self.root.parents[1] if root else data_dir()
        self._cache: dict[str, tuple[float, Any]] = {}

    # ---------------------------------------------------------------- loading
    def _load(self, name: str, default: Any = None) -> Any:
        path = self.root / name
        if not path.exists():
            return default
        try:
            mtime = path.stat().st_mtime
            cached = self._cache.get(name)
            if cached and cached[0] == mtime:
                return cached[1]
            payload = json.loads(path.read_text(encoding="utf-8"))
            self._cache[name] = (mtime, payload)
            return payload
        except Exception:
            return default

    @property
    def available(self) -> bool:
        return (self.root / "run_summary.json").exists()

    def summary(self) -> Optional[dict]:
        return self._load("run_summary.json")

    # ---------------------------------------------------------------- company
    def _load_company_source(self, path: Path) -> list[dict]:
        if not path.exists():
            return []
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            logger.error("Could not read company catalog %s: %s", path, exc)
            raise
        if not isinstance(payload, list) or any(
            not isinstance(company, dict) or not company.get("ticker")
            for company in payload
        ):
            error = ValueError(f"Company catalog must be a list of companies: {path}")
            logger.error("%s", error)
            raise error
        return payload

    def _companies(self) -> list[dict]:
        sources = (
            self._load_company_source(self.data_root / "seed" / "companies.json"),
            self._load_company_source(
                self.data_root / "ingestion" / "companies.json"
            ),
            self._load("companies.json", []) or [],
        )
        merged: dict[str, dict] = {}
        for companies in sources:
            for company in companies:
                ticker = str(company.get("ticker", "")).upper()
                if ticker:
                    merged[ticker] = company
        return sorted(merged.values(), key=lambda company: company["ticker"])

    def list_companies(self, limit: int = 100, offset: int = 0) -> list[dict]:
        companies = self._companies()
        return companies[offset : offset + limit]

    def get_company_by_ticker(self, ticker: str) -> Optional[dict]:
        ticker = ticker.upper()
        for company in self._companies():
            if str(company.get("ticker", "")).upper() == ticker:
                return company
        return None

    # ----------------------------------------------------------------- filings
    def get_filings_by_company(self, company_id: str, limit: int = 50) -> list[dict]:
        filings = [
            filing
            for filing in self._load("filings.json", []) or []
            if filing.get("company_id") == company_id
        ]
        filings.sort(key=lambda filing: filing.get("filing_date") or "", reverse=True)
        return filings[:limit]

    def get_filing(self, filing_id: str) -> Optional[dict]:
        for filing in self._load("filings.json", []) or []:
            if filing.get("id") == filing_id:
                return filing
        return None

    def get_filing_chunks(self, filing_id: str) -> list[dict]:
        chunks = [
            chunk
            for chunk in self._load("chunks.json", []) or []
            if chunk.get("filing_id") == filing_id
        ]
        chunks.sort(key=lambda chunk: (chunk.get("section_type") or "", chunk.get("chunk_index") or 0))
        return chunks

    def get_sentiment_for_filing(self, filing_id: str) -> list[dict]:
        return []

    # ---------------------------------------------------------------- anomalies
    def get_anomalies_for_company(self, company_id: str, limit: int = 50) -> list[dict]:
        signals = [
            signal
            for signal in self._load("anomalies.json", []) or []
            if signal.get("company_id") == company_id
        ]
        signals.sort(key=lambda signal: signal.get("score") or 0, reverse=True)
        return signals[:limit]

    def get_anomaly(self, signal_id: str) -> Optional[dict]:
        for signal in self._load("anomalies.json", []) or []:
            if signal.get("id") == signal_id:
                return signal
        return None

    # ------------------------------------------------------------------ market
    def get_price_history(self, company_id: str, limit: int = 500) -> list[dict]:
        prices = [
            price
            for price in self._load("prices.json", []) or []
            if price.get("company_id") in (company_id, None)
        ]
        prices.sort(key=lambda price: price.get("date") or "", reverse=True)
        return prices[:limit]

    def match_embeddings(self, *_args, **_kwargs) -> list[dict]:
        return []

    # ---------------------------------------------------------------- pipeline
    def top_terms(self) -> list[dict]:
        return self._load("top_terms.json", []) or []

    def section_stats(self) -> list[dict]:
        return self._load("section_stats.json", []) or []

    def features(self) -> dict:
        return self._load("features.json", {}) or {}
