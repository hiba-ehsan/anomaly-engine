import logging
import os
from typing import Any, Dict, List, Optional

from .local_store import LocalStore

logger = logging.getLogger(__name__)


class SupabaseClient:
    """Read access that prefers the local artifacts, with Supabase as a fallback.

    The Spark pipeline writes ``data/curated/latest`` and that snapshot is the
    canonical source for the demo: it is complete, offline-safe and consistent
    with what the dashboard shows.  Supabase is used as an optional mirror, so a
    partially populated project can never make the UI disagree with itself (for
    example showing 5 companies but only 2 filings for one of them).
    """

    def __init__(self):
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY")
        self.client = None
        self.local = LocalStore()
        self.error: Optional[str] = None
        if url and key:
            try:
                from supabase import create_client

                self.client = create_client(url, key)
            except Exception as exc:
                self.error = f"{type(exc).__name__}: {exc}"
                logger.warning("Supabase unavailable, using local artifacts: %s", self.error)

    @property
    def source(self) -> str:
        if self.local.available:
            return "local-artifacts"
        return "supabase" if self.client else "local-artifacts"

    @property
    def mirror_enabled(self) -> bool:
        return self.client is not None

    # ------------------------------------------------------------------ company
    async def get_company_by_ticker(self, ticker: str) -> Optional[Dict]:
        company = self.local.get_company_by_ticker(ticker)
        if company:
            return company
        if self.client:
            try:
                result = (
                    self.client.table("companies")
                    .select("*")
                    .eq("ticker", ticker.upper())
                    .execute()
                )
                if result.data:
                    return result.data[0]
            except Exception as exc:
                logger.warning("Supabase company lookup failed: %s", exc)
        return None

    async def list_companies(self, limit: int = 100, offset: int = 0) -> List[Dict]:
        # Local first.  Supabase may contain issuers the snapshot does not have
        # (or fewer of them), so it only fills gaps instead of replacing rows.
        local_companies = self.local.list_companies(limit=limit + offset)
        merged: Dict[str, Dict] = {
            str(company.get("ticker") or company.get("id") or ""): company
            for company in local_companies
        }
        if self.client and len(merged) < limit + offset:
            try:
                result = (
                    self.client.table("companies")
                    .select("*")
                    .range(offset, offset + limit - 1)
                    .execute()
                )
                for company in result.data or []:
                    key = str(company.get("ticker") or company.get("id") or "")
                    merged.setdefault(key, company)
            except Exception as exc:
                logger.warning("Supabase company list failed: %s", exc)
        return list(merged.values())[offset : offset + limit]

    # ------------------------------------------------------------------ filings
    async def get_filings_by_company(self, company_id: str, limit: int = 50) -> List[Dict]:
        filings = self.local.get_filings_by_company(company_id, limit=limit)
        if filings:
            return filings
        if self.client:
            try:
                result = (
                    self.client.table("filings")
                    .select("*")
                    .eq("company_id", company_id)
                    .order("filing_date", desc=True)
                    .limit(limit)
                    .execute()
                )
                if result.data:
                    return result.data
            except Exception as exc:
                logger.warning("Supabase filing list failed: %s", exc)
        return []

    async def get_filing(self, filing_id: str) -> Optional[Dict]:
        filing = self.local.get_filing(filing_id)
        if filing:
            return filing
        if self.client:
            try:
                result = (
                    self.client.table("filings")
                    .select("*")
                    .eq("id", filing_id)
                    .execute()
                )
                if result.data:
                    return result.data[0]
            except Exception as exc:
                logger.warning("Supabase filing lookup failed: %s", exc)
        return None

    async def get_filing_chunks(self, filing_id: str) -> List[Dict]:
        chunks = self.local.get_filing_chunks(filing_id)
        if chunks:
            return chunks
        if self.client:
            try:
                result = (
                    self.client.table("filing_chunks")
                    .select("*")
                    .eq("filing_id", filing_id)
                    .order("chunk_index")
                    .execute()
                )
                if result.data:
                    return result.data
            except Exception as exc:
                logger.warning("Supabase chunk lookup failed: %s", exc)
        return []

    # -------------------------------------------------------- sentiment / search
    async def get_sentiment_for_filing(self, filing_id: str) -> List[Dict]:
        scores = self.local.get_sentiment_for_filing(filing_id)
        if scores:
            return scores
        if self.client:
            try:
                result = (
                    self.client.table("sentiment_scores")
                    .select("*, filing_chunks!inner(filing_id)")
                    .eq("filing_chunks.filing_id", filing_id)
                    .execute()
                )
                return result.data
            except Exception as exc:
                logger.warning("Supabase sentiment lookup failed: %s", exc)
        return []

    # ----------------------------------------------------------------- anomalies
    async def get_anomalies_for_company(self, company_id: str, limit: int = 50) -> List[Dict]:
        signals = self.local.get_anomalies_for_company(company_id, limit=limit)
        if signals:
            return signals
        if self.client:
            try:
                result = (
                    self.client.table("anomaly_signals")
                    .select("*")
                    .eq("company_id", company_id)
                    .order("detected_at", desc=True)
                    .limit(limit)
                    .execute()
                )
                if result.data:
                    return result.data
            except Exception as exc:
                logger.warning("Supabase anomaly lookup failed: %s", exc)
        return []

    async def get_anomaly(self, signal_id: str) -> Optional[Dict]:
        signal = self.local.get_anomaly(signal_id)
        if signal:
            return signal
        if self.client:
            try:
                result = (
                    self.client.table("anomaly_signals")
                    .select("*")
                    .eq("id", signal_id)
                    .execute()
                )
                if result.data:
                    return result.data[0]
            except Exception as exc:
                logger.warning("Supabase anomaly detail failed: %s", exc)
        return None

    # -------------------------------------------------------------------- market
    async def get_price_history(self, company_id: str, limit: int = 500) -> List[Dict]:
        prices = self.local.get_price_history(company_id, limit=limit)
        if prices:
            return prices
        if self.client:
            try:
                result = (
                    self.client.table("price_history")
                    .select("*")
                    .eq("company_id", company_id)
                    .order("date", desc=True)
                    .limit(limit)
                    .execute()
                )
                if result.data:
                    return result.data
            except Exception as exc:
                logger.warning("Supabase price lookup failed: %s", exc)
        return []

    # --------------------------------------------------------------- vector search
    async def match_embeddings(
        self,
        query_embedding: list,
        match_count: int = 10,
        match_threshold: float = 0.7,
    ) -> List[Dict]:
        if not self.client:
            return self.local.match_embeddings(query_embedding, match_count, match_threshold)
        try:
            result = self.client.rpc(
                "match_embeddings",
                {
                    "query_embedding": query_embedding,
                    "match_count": match_count,
                    "match_threshold": match_threshold,
                },
            ).execute()
            return result.data
        except Exception as exc:
            logger.warning("Supabase vector search failed: %s", exc)
            return []
