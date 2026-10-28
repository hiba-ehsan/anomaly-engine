from pydantic import BaseModel


class SearchRequest(BaseModel):
    query: str
    match_count: int = 10
    match_threshold: float = 0.7


class SimilarityResult(BaseModel):
    chunk_id: str
    text: str
    company_ticker: str
    filing_type: str
    filing_date: str
    similarity: float


class SearchResponse(BaseModel):
    results: list[SimilarityResult]
    total: int
