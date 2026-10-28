from pydantic import BaseModel
from datetime import date, datetime
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


class NewsItem(BaseModel):
    headline: str
    source: str
    url: str
    summary: Optional[str] = None
    published_at: Optional[str] = None
    sentiment: Optional[str] = None


class PriceIngestRequest(BaseModel):
    ticker: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class NewsIngestRequest(BaseModel):
    ticker: str
    days_back: int = 30


class IngestStatus(BaseModel):
    job_id: str
    status: str
    ticker: str
    records_created: int = 0
    error: Optional[str] = None
