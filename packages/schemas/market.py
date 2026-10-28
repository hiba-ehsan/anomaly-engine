from pydantic import BaseModel
from datetime import date
from typing import Optional


class PriceHistoryCreate(BaseModel):
    company_id: str
    date: date
    open: float
    high: float
    low: float
    close: float
    volume: int
    adjusted_close: float
    source: str = "yfinance"


class PriceHistoryResponse(BaseModel):
    id: str
    company_id: str
    date: date
    open: float
    high: float
    low: float
    close: float
    volume: int
    adjusted_close: float
    source: str

    model_config = {"from_attributes": True}


class NewsItem(BaseModel):
    headline: str
    source: str
    url: str
    summary: Optional[str] = None
    published_at: Optional[str] = None
    sentiment: Optional[str] = None
