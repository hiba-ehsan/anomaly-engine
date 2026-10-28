from pydantic import BaseModel
from datetime import date
from typing import Optional


class CompanyInfo(BaseModel):
    ticker: str
    cik: Optional[str] = None
    name: str
    jurisdiction: str = "US"
    sector: Optional[str] = None


class FilingInfo(BaseModel):
    ticker: str
    filing_type: str
    filing_date: date
    accession_number: str
    period_of_report: Optional[date] = None
    source_url: Optional[str] = None


class FilingChunk(BaseModel):
    filing_id: str
    section_type: str
    chunk_index: int
    text: str
    token_count: int


class IngestRequest(BaseModel):
    ticker: str
    filing_types: list[str] = ["10-K", "10-Q", "8-K"]
    max_filings: int = 10


class IngestStatus(BaseModel):
    job_id: str
    status: str
    ticker: str
    filings_found: int = 0
    filings_ingested: int = 0
    error: Optional[str] = None
