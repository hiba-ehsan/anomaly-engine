from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class CompanyCreate(BaseModel):
    ticker: str
    cik: Optional[str] = None
    name: str
    jurisdiction: str = "US"
    sector: Optional[str] = None


class CompanyResponse(BaseModel):
    id: str
    ticker: str
    cik: Optional[str]
    name: str
    jurisdiction: str
    sector: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class CompanyList(BaseModel):
    companies: list[CompanyResponse]
    total: int
