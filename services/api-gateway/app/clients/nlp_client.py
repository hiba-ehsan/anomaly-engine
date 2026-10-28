import os
from typing import Optional, Dict, Any, List
from .base_client import BaseServiceClient


class NLPClient(BaseServiceClient):
    """Client for nlp-engine service (FinBERT)."""

    def __init__(self):
        base_url = os.getenv("NLP_ENGINE_URL", "http://nlp-engine:8003")
        super().__init__(base_url)

    async def analyze_sentiment(self, texts: List[str]) -> Dict[str, Any]:
        """Get sentiment scores for texts."""
        return await self.post("/analyze/sentiment", json={"texts": texts})

    async def get_embeddings(self, texts: List[str], model_version: str = "finbert-base") -> Dict[str, Any]:
        """Get 768-dim embeddings for texts."""
        return await self.post("/analyze/embeddings", json={"texts": texts, "model_version": model_version})

    async def get_attention(self, text: str) -> Dict[str, Any]:
        """Get attention matrices for a single text."""
        return await self.post("/analyze/attention", json={"text": text})

    async def analyze_divergence(
        self,
        filing_a_embeddings: List[List[float]],
        filing_b_embeddings: List[List[float]],
        filing_a_sections: Dict = None,
        filing_b_sections: Dict = None,
        filing_a_attention: List = None,
        filing_b_attention: List = None,
    ) -> Dict[str, Any]:
        """Compute divergence signals between two filings."""
        payload = {
            "filing_a_embeddings": filing_a_embeddings,
            "filing_b_embeddings": filing_b_embeddings,
            "filing_a_sections": filing_a_sections or {},
            "filing_b_sections": filing_b_sections or {},
            "filing_a_attention": filing_a_attention,
            "filing_b_attention": filing_b_attention,
        }
        return await self.post("/analyze/divergence", json=payload)

    async def analyze_entropy(self, texts: List[str]) -> Dict[str, Any]:
        """Compute sentence-level entropy for texts."""
        return await self.post("/analyze/entropy", json={"texts": texts})

    async def health_check(self) -> bool:
        try:
            result = await self.get("/health")
            return result.get("status") == "healthy"
        except Exception:
            return False