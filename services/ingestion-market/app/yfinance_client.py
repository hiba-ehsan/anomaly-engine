import yfinance as yf
from datetime import datetime, timedelta
from typing import Optional


class YFinanceClient:
    def get_price_history(
        self, ticker: str, start_date: Optional[str] = None, end_date: Optional[str] = None
    ) -> list[dict]:
        try:
            stock = yf.Ticker(ticker)
            if not start_date:
                start_date = (datetime.now() - timedelta(days=5*365)).strftime("%Y-%m-%d")
            if not end_date:
                end_date = datetime.now().strftime("%Y-%m-%d")

            df = stock.history(start=start_date, end=end_date, auto_adjust=False)
            if df.empty:
                return []

            records = []
            for idx, row in df.iterrows():
                records.append({
                    "date": idx.strftime("%Y-%m-%d"),
                    "open": round(float(row["Open"]), 2),
                    "high": round(float(row["High"]), 2),
                    "low": round(float(row["Low"]), 2),
                    "close": round(float(row["Close"]), 2),
                    "volume": int(row["Volume"]),
                    "adjusted_close": round(float(row["Adj Close"]), 2),
                })
            return records
        except Exception as e:
            raise Exception(f"YFinance error for {ticker}: {str(e)}")

    def get_info(self, ticker: str) -> dict:
        try:
            stock = yf.Ticker(ticker)
            info = stock.info
            return {
                "name": info.get("longName", info.get("shortName", ticker)),
                "sector": info.get("sector", "Unknown"),
                "market_cap": info.get("marketCap", 0),
                "currency": info.get("currency", "USD"),
            }
        except Exception:
            return {"name": ticker, "sector": "Unknown", "market_cap": 0, "currency": "USD"}
