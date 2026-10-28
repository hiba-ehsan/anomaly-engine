from pydantic import BaseModel
from typing import Optional, List


class SentimentRequest(BaseModel):
    texts: List[str]


class SentimentScore(BaseModel):
    positive: float
    negative: float
    neutral: float


class SentimentResponse(BaseModel):
    scores: List[SentimentScore]
    model_version: str = "finbert-base"


class EmbeddingRequest(BaseModel):
    texts: List[str]
    model_version: str = "finbert-base"


class EmbeddingResponse(BaseModel):
    embeddings: List[List[float]]
    model_version: str
    dimensions: int = 768


class AttentionRequest(BaseModel):
    text: str


class AttentionMatrix(BaseModel):
    layers: List[List[List[float]]]


class AttentionResponse(BaseModel):
    attention: AttentionMatrix
    tokens: List[str]
    input_text: str


class DivergenceRequest(BaseModel):
    filing_a_id: str
    filing_b_id: str
    signal_type: str


class DivergenceDetails(BaseModel):
    cosine_distance: Optional[float] = None
    kl_divergence: Optional[float] = None
    entropy: Optional[float] = None
    key_sentences: Optional[List[str]] = None