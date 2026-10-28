from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class DivergenceDetails(BaseModel):
    cosine_distance: Optional[float] = None
    kl_divergence: Optional[float] = None
    entropy: Optional[float] = None
    key_sentences: Optional[list[str]] = None


class AnomalySignalCreate(BaseModel):
    company_id: str
    signal_type: str
    score: float
    filing_a_id: str
    filing_b_id: str
    details: Optional[DivergenceDetails] = None


class AnomalySignalResponse(BaseModel):
    id: str
    company_id: str
    signal_type: str
    score: float
    filing_a_id: str
    filing_b_id: str
    details: Optional[DivergenceDetails]
    detected_at: datetime

    model_config = {"from_attributes": True}


class AnomalyList(BaseModel):
    signals: list[AnomalySignalResponse]
    total: int
