from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


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
    ticker: str = Field(
        min_length=1,
        max_length=10,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9.-]*$",
    )
    filing_types: list[Literal["10-K", "10-Q", "8-K"]] = Field(
        default_factory=lambda: ["10-K", "10-Q", "8-K"],
        min_length=1,
        max_length=3,
    )
    max_filings: int = Field(default=10, ge=1, le=10)

    @field_validator("ticker", mode="before")
    @classmethod
    def normalize_ticker(cls, ticker: object) -> object:
        if isinstance(ticker, str):
            return ticker.strip().upper()
        return ticker


class IngestStatus(BaseModel):
    job_id: str
    status: Literal["queued", "running", "completed", "failed"]
    ticker: str
    filings_found: int = 0
    filings_ingested: int = 0
    error: Optional[str] = None
    # Non-fatal problems (for example, the optional Supabase copy failing)
    # never hide the filings that were successfully saved to the local snapshot.
    warnings: list[str] = Field(default_factory=list)
    queued_at: Optional[str] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
