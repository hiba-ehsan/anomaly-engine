"""Storage adapters for ingestion-us.

Supabase is optional: the mid-term demo runs entirely from the curated artifacts
written by the Spark job, so constructing this class must never fail when the
database is not configured (a previous source of startup crashes).
"""

from __future__ import annotations

import json
import hashlib
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .models import CompanyInfo, FilingInfo


_LOCAL_COMPANY_LOCK = threading.Lock()
_PARENTS = Path(__file__).resolve().parents
# local:  .../Anomaly Engine/services/ingestion-us/app/storage.py -> parents[3]
# image:  /app/app/storage.py                                   -> parents[1]
REPO_ROOT = _PARENTS[3] if len(_PARENTS) > 3 else _PARENTS[1]


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


def atomic_write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary_path.open("x", encoding="utf-8") as file:
            json.dump(payload, file, indent=2)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


class Storage:
    def __init__(self, data_root: Optional[Path] = None):
        self.data_root = Path(data_root) if data_root is not None else data_dir()
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

    @staticmethod
    def _atomic_write_json(path: Path, payload: object) -> None:
        atomic_write_json(path, payload)

    def persist_local_company(self, company: CompanyInfo) -> str:
        company_id = hashlib.md5(
            f"company|{company.ticker.upper()}".encode("utf-8")
        ).hexdigest()
        path = self.data_root / "ingestion" / "companies.json"
        with _LOCAL_COMPANY_LOCK:
            companies = []
            if path.exists():
                companies = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(companies, list) or any(
                    not isinstance(item, dict) for item in companies
                ):
                    raise ValueError(f"Invalid local company catalog: {path}")

            existing = next(
                (
                    item
                    for item in companies
                    if str(item.get("ticker", "")).upper() == company.ticker.upper()
                ),
                {},
            )
            record = {
                **existing,
                "id": company_id,
                "ticker": company.ticker.upper(),
                "cik": company.cik,
                "name": company.name,
                "jurisdiction": company.jurisdiction,
                "sector": company.sector,
                "created_at": existing.get(
                    "created_at", datetime.now(timezone.utc).isoformat()
                ),
            }
            updated = [
                item
                for item in companies
                if str(item.get("ticker", "")).upper() != company.ticker.upper()
            ]
            updated.append(record)
            self._atomic_write_json(path, updated)
        return company_id

    def list_local_companies(self) -> list[dict]:
        sources = (
            self.data_root / "seed" / "companies.json",
            self.data_root / "ingestion" / "companies.json",
            self.data_root / "curated" / "latest" / "companies.json",
        )
        merged: dict[str, dict] = {}
        for path in sources:
            if not path.exists():
                continue
            payload = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(payload, list) or any(
                not isinstance(company, dict) or not company.get("ticker")
                for company in payload
            ):
                raise ValueError(f"Invalid company catalog: {path}")
            for company in payload:
                merged[str(company["ticker"]).upper()] = company
        return sorted(merged.values(), key=lambda company: company["ticker"])

    def persist_local_filing(
        self,
        company: CompanyInfo,
        filing: FilingInfo,
        sections: dict[str, str],
        clean_text: str,
    ) -> Path:
        path = (
            self.data_root
            / "raw"
            / "filings"
            / company.ticker.upper()
            / f"{filing.accession_number}.json"
        )
        self._atomic_write_json(
            path,
            {
                "ticker": company.ticker.upper(),
                "cik": company.cik,
                "company_name": company.name,
                "filing_type": filing.filing_type,
                "filing_date": filing.filing_date.isoformat(),
                "period_of_report": (
                    filing.period_of_report.isoformat()
                    if filing.period_of_report
                    else None
                ),
                "accession_number": filing.accession_number,
                "source_url": filing.source_url,
                "sections": sections,
                "clean_text": clean_text,
                "fetched_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        return path

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
            .select("id")
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
            .select("id")
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
                .select("id")
                .execute()
            )
            ids.append(result.data[0]["id"])
        return ids

    async def get_company_by_ticker(self, ticker: str) -> Optional[dict]:
        if not self.client:
            for company in self.list_local_companies():
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
