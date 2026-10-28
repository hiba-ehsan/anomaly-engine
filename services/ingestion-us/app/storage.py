"""Storage adapters for ingestion-us.

Supabase is optional: the mid-term demo runs entirely from the curated artifacts
written by the Spark job, so constructing this class must never fail when the
database is not configured (a previous source of startup crashes).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

from .models import CompanyInfo, FilingInfo


_PARENTS = Path(__file__).resolve().parents
REPO_ROOT = _PARENTS[4] if len(_PARENTS) > 4 else _PARENTS[2]


def data_dir() -> Path:
    return Path(os.getenv("ANOMALY_DATA_DIR", REPO_ROOT / "data"))


def curated_dir() -> Path:
    return data_dir() / "curated" / "latest"


def read_artifact(name: str, default=None):
    path = curated_dir() / name
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


class Storage:
    def __init__(self):
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY")
        self.client = None
        self.error: Optional[str] = None
        if url and key:
            try:
                from supabase import create_client

                self.client = create_client(url, key)
            except Exception as exc:  # invalid URL / missing dependency / network
                self.error = f"{type(exc).__name__}: {exc}"

    @property
    def enabled(self) -> bool:
        return self.client is not None

    def _require(self):
        if not self.client:
            raise RuntimeError(
                "Supabase is not configured. Use the local Spark pipeline "
                "(POST /spark/run) or scripts/fetch_sec_filings.py."
            )
        return self.client

    async def upsert_company(self, company: CompanyInfo) -> str:
        result = (
            self._require()
            .table("companies")
            .upsert(
                {
                    "ticker": company.ticker,
                    "cik": company.cik,
                    "name": company.name,
                    "jurisdiction": company.jurisdiction,
                    "sector": company.sector,
                },
                on_conflict="ticker",
            )
            .execute()
        )
        return result.data[0]["id"]

    async def upsert_filing(self, company_id: str, filing: FilingInfo, sections: dict, clean_text: str) -> str:
        result = (
            self._require()
            .table("filings")
            .upsert(
                {
                    "company_id": company_id,
                    "filing_type": filing.filing_type,
                    "filing_date": filing.filing_date.isoformat(),
                    "accession_number": filing.accession_number,
                    "period_of_report": filing.period_of_report.isoformat() if filing.period_of_report else None,
                    "source_url": filing.source_url,
                    "sections": sections,
                    "clean_text": clean_text,
                },
                on_conflict="company_id,filing_type,filing_date",
            )
            .execute()
        )
        return result.data[0]["id"]

    async def upsert_chunks(self, filing_id: str, chunks: list[dict]) -> list[str]:
        ids = []
        for chunk in chunks:
            result = (
                self._require()
                .table("filing_chunks")
                .upsert(
                    {
                        "filing_id": filing_id,
                        "section_type": chunk["section_type"],
                        "chunk_index": chunk["chunk_index"],
                        "text": chunk["text"],
                        "token_count": chunk["token_count"],
                    }
                )
                .execute()
            )
            ids.append(result.data[0]["id"])
        return ids

    async def get_company_by_ticker(self, ticker: str) -> Optional[dict]:
        if not self.client:
            for company in read_artifact("companies.json", []):
                if company.get("ticker", "").upper() == ticker.upper():
                    return company
            return None
        result = (
            self.client.table("companies").select("*").eq("ticker", ticker.upper()).execute()
        )
        return result.data[0] if result.data else None

    async def get_filings_by_company(self, company_id: str) -> list[dict]:
        if not self.client:
            return [
                filing
                for filing in read_artifact("filings.json", [])
                if filing.get("company_id") == company_id
            ]
        result = (
            self.client.table("filings")
            .select("*")
            .eq("company_id", company_id)
            .order("filing_date", desc=True)
            .execute()
        )
        return result.data
