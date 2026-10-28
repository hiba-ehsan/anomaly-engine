import httpx
import os
from app.celery_app import celery


NLP_ENGINE_URL = os.getenv("NLP_ENGINE_URL", "http://nlp-engine:8003")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY")

from supabase import create_client
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


@celery.task(name="nlp.analyze_filing", bind=True, max_retries=3, default_retry_delay=60)
def analyze_filing(self, filing_id: str):
    """Analyze a single filing with FinBERT: sentiment, embeddings, attention."""
    try:
        # Get filing chunks from Supabase
        chunks_result = supabase.table("filing_chunks").select("*").eq("filing_id", filing_id).order("chunk_index").execute()
        chunks = chunks_result.data
        
        if not chunks:
            return {"filing_id": filing_id, "status": "no_chunks", "chunks_analyzed": 0}
        
        texts = [c["text"] for c in chunks]
        
        with httpx.Client(timeout=300.0) as client:
            # 1. Get sentiment for all chunks
            sent_resp = client.post(f"{NLP_ENGINE_URL}/analyze/sentiment", json={"texts": texts}, timeout=120.0)
            sent_resp.raise_for_status()
            sentiments = sent_resp.json()["scores"]
            
            # 2. Get embeddings for all chunks
            emb_resp = client.post(f"{NLP_ENGINE_URL}/analyze/embeddings", json={"texts": texts}, timeout=120.0)
            emb_resp.raise_for_status()
            embeddings = emb_resp.json()["embeddings"]
            
            # 3. Get attention for each chunk (optional, expensive)
            # Skip for batch processing, can be done on-demand
            
        # Store results in Supabase
        chunk_ids = [c["id"] for c in chunks]
        
        # Store sentiment
        for chunk_id, sentiment in zip(chunk_ids, sentiments):
            supabase.table("sentiment_scores").upsert({
                "chunk_id": chunk_id,
                "positive": sentiment["positive"],
                "negative": sentiment["negative"],
                "neutral": sentiment["neutral"],
            }).execute()
        
        # Store embeddings
        for chunk_id, embedding in zip(chunk_ids, embeddings):
            supabase.table("embeddings").upsert({
                "chunk_id": chunk_id,
                "model_version": "finbert-base",
                "embedding": embedding,
            }).execute()
        
        return {
            "filing_id": filing_id,
            "status": "completed",
            "chunks_analyzed": len(chunks),
        }
    except Exception as exc:
        raise self.retry(exc=exc)


@celery.task(name="nlp.compute_divergence", bind=True, max_retries=3, default_retry_delay=60)
def compute_divergence(self, filing_a_id: str, filing_b_id: str):
    """Compute divergence signals between two filings."""
    try:
        # Get embeddings for both filings
        emb_a = supabase.table("embeddings").select("embedding").eq("filing_chunks.filing_id", filing_a_id).execute()
        emb_b = supabase.table("embeddings").select("embedding").eq("filing_chunks.filing_id", filing_b_id).execute()
        
        if not emb_a.data or not emb_b.data:
            return {"status": "skipped", "reason": "missing_embeddings"}
        
        embeddings_a = [e["embedding"] for e in emb_a.data]
        embeddings_b = [e["embedding"] for e in emb_b.data]
        
        with httpx.Client(timeout=120.0) as client:
            payload = {
                "filing_a_embeddings": embeddings_a,
                "filing_b_embeddings": embeddings_b,
            }
            response = client.post(f"{NLP_ENGINE_URL}/analyze/divergence", json=payload)
            response.raise_for_status()
            signals = response.json()["signals"]
        
        # Store anomaly signals
        for signal in signals:
            supabase.table("anomaly_signals").upsert({
                "company_id": None,  # Would need company_id from filings
                "signal_type": signal.get("signal_type"),
                "score": signal.get("cosine_distance") or signal.get("kl_divergence") or 0,
                "filing_a_id": filing_a_id,
                "filing_b_id": filing_b_id,
                "details": signal,
            }).execute()
        
        return {
            "filing_a_id": filing_a_id,
            "filing_b_id": filing_b_id,
            "status": "completed",
            "signals_found": len(signals),
        }
    except Exception as exc:
        raise self.retry(exc=exc)


@celery.task(name="nlp.compute_all_divergences", bind=True, max_retries=3, default_retry_delay=120)
def compute_all_divergences(self, ticker: str):
    """Compute divergence for all filing pairs for a company."""
    try:
        # Get company ID
        company_result = supabase.table("companies").select("id").eq("ticker", ticker.upper()).execute()
        if not company_result.data:
            return {"status": "error", "reason": "company_not_found"}
        
        company_id = company_result.data[0]["id"]
        
        # Get recent filings (last 4 quarters)
        filings = supabase.table("filings").select("id, filing_type, filing_date").eq("company_id", company_id).order("filing_date", desc=True).limit(8).execute()
        
        if len(filings.data) < 2:
            return {"status": "skipped", "reason": "insufficient_filings"}
        
        # Compare each filing with previous one (temporal shift)
        tasks = []
        for i in range(len(filings.data) - 1):
            filing_a = filings.data[i]
            filing_b = filings.data[i + 1]
            tasks.append(compute_divergence.s(filing_a["id"], filing_b["id"]))
        
        if tasks:
            from celery import group
            group(tasks).apply_async()
        
        return {"ticker": ticker, "comparisons_queued": len(tasks)}
    except Exception as exc:
        raise self.retry(exc=exc)