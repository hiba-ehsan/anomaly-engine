import httpx
import os
from app.celery_app import celery


BACKTESTER_URL = os.getenv("BACKTESTER_URL", "http://backtester:8004")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY")

from supabase import create_client
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


@celery.task(name="backtest.run_backtest", bind=True, max_retries=3, default_retry_delay=120)
def run_backtest(self, ticker: str, start_date: str = None, end_date: str = None):
    """Run CAR + XGBoost backtest for a company."""
    try:
        with httpx.Client(timeout=300.0) as client:
            payload = {"ticker": ticker}
            if start_date:
                payload["start_date"] = start_date
            if end_date:
                payload["end_date"] = end_date
            
            response = client.post(f"{BACKTESTER_URL}/backtest/run", json=payload)
            response.raise_for_status()
            return response.json()
    except Exception as exc:
        raise self.retry(exc=exc)


@celery.task(name="backtest.run_for_signal", bind=True, max_retries=3, default_retry_delay=60)
def run_backtest_for_signal(self, signal_id: str):
    """Run backtest specifically for an anomaly signal."""
    try:
        # Get signal details
        signal = supabase.table("anomaly_signals").select("*").eq("id", signal_id).execute()
        if not signal.data:
            return {"status": "error", "reason": "signal_not_found"}
        
        signal = signal.data[0]
        
        # Get company ticker
        company = supabase.table("companies").select("ticker").eq("id", signal["company_id"]).execute()
        if not company.data:
            return {"status": "error", "reason": "company_not_found"}
        
        ticker = company.data[0]["ticker"]
        
        with httpx.Client(timeout=300.0) as client:
            response = client.post(f"{BACKTESTER_URL}/backtest/run", json={"ticker": ticker})
            response.raise_for_status()
            result = response.json()
        
        # Store backtest result linked to signal
        supabase.table("backtest_results").upsert({
            "signal_id": signal_id,
            "car_30d": result.get("car_30d"),
            "car_60d": result.get("car_60d"),
            "car_90d": result.get("car_90d"),
            "volatility_before": result.get("volatility_before"),
            "volatility_after": result.get("volatility_after"),
            "xgboost_prediction": result.get("xgboost_prediction"),
            "xgboost_confidence": result.get("xgboost_confidence"),
        }).execute()
        
        return {"signal_id": signal_id, "status": "completed", "backtest_result": result}
    except Exception as exc:
        raise self.retry(exc=exc)


@celery.task(name="backtest.run_for_all_signals", bind=True, max_retries=2, default_retry_delay=300)
def run_backtest_for_all_signals(self, ticker: str = None):
    """Run backtest for all signals (optionally filtered by ticker)."""
    try:
        query = supabase.table("anomaly_signals").select("id")
        if ticker:
            company = supabase.table("companies").select("id").eq("ticker", ticker.upper()).execute()
            if company.data:
                query = query.eq("company_id", company.data[0]["id"])
        
        signals = query.execute()
        
        if not signals.data:
            return {"status": "skipped", "reason": "no_signals"}
        
        # Queue backtest for each signal
        from celery import group
        tasks = [run_backtest_for_signal.s(s["id"]) for s in signals.data]
        group(tasks).apply_async()
        
        return {"signals_queued": len(signals.data)}
    except Exception as exc:
        raise self.retry(exc=exc)