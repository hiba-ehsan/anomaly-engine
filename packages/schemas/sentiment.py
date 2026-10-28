from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class SentimentScore(BaseModel):
    positive: float
    negative: float
    neutral: float


class AttentionMatrix(BaseModel):
    layers: list[list[list[float]]]


class ChunkSentiment(BaseModel):
    chunk_id: str
    sentiment: SentimentScore
    attention: Optional[AttentionMatrix] = None


class EmbeddingRequest(BaseModel):
    texts: list[str]
    model_version: str = "finbert-base"


class EmbeddingResponse(BaseModel):
    embeddings: list[list[float]]
    model_version: str
    dimensions: int = 768


class SentimentRequest(BaseModel):
    texts: list[str]


class SentimentResponse(BaseModel):
    scores: list[SentimentScore]
