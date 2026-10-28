from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from .models import (
    SentimentRequest, SentimentResponse,
    EmbeddingRequest, EmbeddingResponse,
    AttentionRequest, AttentionResponse,
)
from .finbert_service import get_finbert
from .divergence import compute_all_signals, sentence_entropy

app = FastAPI(title="NLP Engine (FinBERT)", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    get_finbert()


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "nlp-engine", "model": "ProsusAI/finbert"}


@app.post("/analyze/sentiment", response_model=SentimentResponse)
async def analyze_sentiment(req: SentimentRequest):
    finbert = get_finbert()
    scores = finbert.get_sentiment(req.texts)
    return SentimentResponse(scores=scores)


@app.post("/analyze/embeddings", response_model=EmbeddingResponse)
async def analyze_embeddings(req: EmbeddingRequest):
    finbert = get_finbert()
    embeddings = finbert.get_embeddings(req.texts)
    return EmbeddingResponse(
        embeddings=embeddings,
        model_version=req.model_version,
    )


@app.post("/analyze/attention", response_model=AttentionResponse)
async def analyze_attention(req: AttentionRequest):
    finbert = get_finbert()
    result = finbert.get_attention(req.text)
    return AttentionResponse(
        attention=result["layers"],
        tokens=result["tokens"],
        input_text=req.text,
    )


@app.post("/analyze/divergence")
async def analyze_divergence(
    filing_a_embeddings: list[list[float]],
    filing_b_embeddings: list[list[float]],
    filing_a_sections: dict = None,
    filing_b_sections: dict = None,
    filing_a_attention: list = None,
    filing_b_attention: list = None,
):
    signals = compute_all_signals(
        filing_a_embeddings,
        filing_b_embeddings,
        filing_a_sections or {},
        filing_b_sections or {},
        filing_a_attention,
        filing_b_attention,
    )
    return {"signals": signals}


@app.post("/analyze/entropy")
async def analyze_entropy(texts: list[str]):
    finbert = get_finbert()
    scores = finbert.get_sentiment(texts)
    entropies = [sentence_entropy(s) for s in scores]
    return {"texts": texts, "entropies": entropies, "mean_entropy": sum(entropies)/len(entropies) if entropies else 0}