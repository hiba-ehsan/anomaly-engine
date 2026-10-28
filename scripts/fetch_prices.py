"""Fetch daily price history for every curated company.

The Spark pipeline curates filings only.  The dashboard still wants a price
chart and the CAR hint needs closes, so this helper fills the gap:

    python scripts/fetch_prices.py
    python scripts/fetch_prices.py --tickers AAPL MSFT --years 3

Output: data/curated/latest/prices.json
Each row carries ``company_id`` so the gateway's LocalStore can join it with
companies.json without any database.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
CURATED_DIR = DATA_DIR / "curated" / "latest"


def load_companies() -> list[dict]:
    path = CURATED_DIR / "companies.json"
    if not path.exists():
        raise SystemExit(f"Missing {path}; run the Spark pipeline first.")
    return json.loads(path.read_text(encoding="utf-8"))


def fetch_history(ticker: str, years: int) -> list[dict]:
    import yfinance as yf

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=years * 365)
    frame = yf.Ticker(ticker).history(
        start=start.strftime("%Y-%m-%d"),
        end=end.strftime("%Y-%m-%d"),
        auto_adjust=False,
    )
    if frame is None or frame.empty:
        return []

    has_adjusted = "Adj Close" in frame.columns
    rows: list[dict] = []
    for index, row in frame.iterrows():
        rows.append(
            {
                "date": index.strftime("%Y-%m-%d"),
                "open": round(float(row["Open"]), 2),
                "high": round(float(row["High"]), 2),
                "low": round(float(row["Low"]), 2),
                "close": round(float(row["Close"]), 2),
                "volume": int(row["Volume"]),
                "adjusted_close": round(
                    float(row["Adj Close"] if has_adjusted else row["Close"]), 2
                ),
            }
        )
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tickers", nargs="*", help="Defaults to curated companies")
    parser.add_argument("--years", type=int, default=3)
    args = parser.parse_args()

    companies = load_companies()
    by_ticker = {company["ticker"]: company for company in companies}
    tickers = args.tickers or list(by_ticker)

    all_rows: list[dict] = []
    for ticker in tickers:
        company = by_ticker.get(ticker)
        if not company:
            print(f"skip {ticker}: not in companies.json")
            continue
        try:
            rows = fetch_history(ticker, args.years)
        except Exception as exc:  # network / rate limit
            print(f"skip {ticker}: {exc}")
            continue
        for row in rows:
            row["company_id"] = company["id"]
            row["ticker"] = ticker
        all_rows.extend(rows)
        print(f"{ticker}: {len(rows)} rows")

    if not all_rows:
        raise SystemExit("No price rows fetched (network blocked?).")

    all_rows.sort(key=lambda row: (row["ticker"], row["date"]))
    out = CURATED_DIR / "prices.json"
    out.write_text(json.dumps(all_rows, indent=2), encoding="utf-8")
    print(f"wrote {out} ({len(all_rows)} rows)")


if __name__ == "__main__":
    main()
