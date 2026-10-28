from typing import List, Optional
from pydantic import BaseModel

class IngestRequest(BaseModel):
    filing_types: List[str] = ["10-K", "10-Q", "8-K"]
    max_filings: int = 10
    start_date: Optional[str] = None
    end_date: Optional[str] = None
