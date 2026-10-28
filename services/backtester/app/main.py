from fastapi import FastAPI

app = FastAPI(title="Backtester (CAR + XGBoost)", version="0.1.0")


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "backtester"}


@app.post("/backtest/run/{ticker}")
async def run_backtest(ticker: str):
    return {"ticker": ticker, "status": "stub"}


@app.get("/backtest/{ticker}/results")
async def get_results(ticker: str):
    return {"ticker": ticker, "results": []}


@app.get("/backtest/performance")
async def get_performance():
    return {"status": "stub"}
