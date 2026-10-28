from pydantic import BaseModel
from datetime import date, datetime
from typing import Optional


class FilingCreate(BaseModel):
    company_id: str
    filing_type: str
    filing_date: date
    accession_number: Optional[str] = None
    period_of_report: Optional[date] = None
    source_url: Optional[str] = None
    raw_html: Optional[str] = None
    clean_text: Optional[str] = None
    sections: Optional[dict] = None
    metadata: Optional[dict] = None


class FilingResponse(BaseModel):
    id: str
    company_id: str
    filing_type: str
    filing_date: date
    accession_number: Optional[str]
    period_of_report: Optional[date]
    source_url: Optional[str]
    sections: Optional[dict]
    metadata: Optional[dict]
    ingested_at: datetime

    model_config = {"from_attributes": True}


class FilingChunk(BaseModel):
    id: str
    filing_id: str
    section_type: Optional[str]
    chunk_index: int
    text: str
    token_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class FilingList(BaseModel):
    filings: list[FilingResponse]
    total: int
