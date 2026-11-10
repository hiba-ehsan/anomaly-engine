from typing import Literal, Optional

from pydantic import BaseModel, Field


class IngestRequest(BaseModel):
    filing_types: list[Literal["10-K", "10-Q", "8-K"]] = Field(
        default_factory=lambda: ["10-K", "10-Q", "8-K"],
        min_length=1,
        max_length=3,
    )
    max_filings: int = Field(default=10, ge=1, le=10)
    start_date: Optional[str] = None
    end_date: Optional[str] = None
