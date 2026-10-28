from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class BacktestRequest(BaseModel):
    ticker: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class CARResult(BaseModel):
    car_30d: Optional[float] = None
    car_60d: Optional[float] = None
    car_90d: Optional[float] = None
    t_stat: Optional[float] = None
    p_value: Optional[float] = None


class BacktestResult(BaseModel):
    id: str
    signal_id: str
    car_30d: Optional[float]
    car_60d: Optional[float]
    car_90d: Optional[float]
    volatility_before: Optional[float]
    volatility_after: Optional[float]
    xgboost_prediction: Optional[float]
    xgboost_confidence: Optional[float]
    created_at: datetime

    model_config = {"from_attributes": True}


class BacktestPerformance(BaseModel):
    total_signals: int
    high_score_signals: int
    predicted_drop_accuracy: float
    avg_car_30d: float
    avg_car_90d: float
