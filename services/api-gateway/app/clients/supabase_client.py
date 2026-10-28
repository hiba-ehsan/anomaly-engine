import logging
import os
from typing import Any, Dict, List, Optional

from .local_store import LocalStore

logger = logging.getLogger(__name__)


class SupabaseClient:
    """Database access with a transparent local-artifact fallback.

    Supabase is used when configured and reachable.  If credentials are absent
    or any query fails (offline demo / DNS outage), reads fall back to the JSON
    artifacts written by the Spark pipeline instead of crashing the gateway.
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
        return "supabase" if self.client else "local-artifacts"

    # ------------------------------------------------------------------ company
    async def get_company_by_ticker(self, ticker: str) -> Optional[Dict]:
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
        return self.local.get_company_by_ticker(ticker)

    async def list_companies(self, limit: int = 100, offset: int = 0) -> List[Dict]:
        if self.client:
            try:
                result = (
                    self.client.table("companies")
                    .select("*")
                    .range(offset, offset + limit - 1)
                    .execute()
                )
                if result.data:
                    return result.data
            except Exception as exc:
                logger.warning("Supabase company list failed: %s", exc)
        return self.local.list_companies(limit=limit, offset=offset)

    # ------------------------------------------------------------------ filings
    async def get_filings_by_company(self, company_id: str, limit: int = 50) -> List[Dict]:
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
        return self.local.get_filings_by_company(company_id, limit=limit)

    async def get_filing(self, filing_id: str) -> Optional[Dict]:
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
        return self.local.get_filing(filing_id)

    async def get_filing_chunks(self, filing_id: str) -> List[Dict]:
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
        return self.local.get_filing_chunks(filing_id)

    # -------------------------------------------------------- sentiment / search
    async def get_sentiment_for_filing(self, filing_id: str) -> List[Dict]:
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
        return self.local.get_sentiment_for_filing(filing_id)

    # ----------------------------------------------------------------- anomalies
    async def get_anomalies_for_company(self, company_id: str, limit: int = 50) -> List[Dict]:
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
        return self.local.get_anomalies_for_company(company_id, limit=limit)

    async def get_anomaly(self, signal_id: str) -> Optional[Dict]:
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
        return self.local.get_anomaly(signal_id)

    # -------------------------------------------------------------------- market
    async def get_price_history(self, company_id: str, limit: int = 500) -> List[Dict]:
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
        return self.local.get_price_history(company_id, limit=limit)

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
