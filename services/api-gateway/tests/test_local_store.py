"""Contract tests for the commit-backed curated artifacts.

The gateway's LocalStore is the demo-safe data source: no Supabase, no network.
These tests fail loudly if a future Spark change stops writing an artifact the
dashboard depends on.
"""

from __future__ import annotations

from app.clients.local_store import LocalStore


def store() -> LocalStore:
    local = LocalStore()
    assert local.available, "run the Spark pipeline before the gateway tests"
    return local


def test_summary_counts():
    summary = store().summary()
    assert summary["engine"] == "PySpark RDD"
    assert summary["counts"]["filings"] == 5
    assert summary["counts"]["chunks"] > 0
    assert summary["benchmark"]["match"] is True
    assert len(summary["stages"]) >= 10


def test_companies_and_filings():
    local = store()
    companies = local.list_companies()
    assert {company["ticker"] for company in companies} == {"AAPL", "MSFT"}

    aapl = local.get_company_by_ticker("aapl")
    assert aapl and aapl["ticker"] == "AAPL"
    assert local.get_company_by_ticker("NOPE") is None

    filings = local.get_filings_by_company(aapl["id"])
    assert len(filings) == 3
    assert {filing["filing_type"] for filing in filings} == {"10-K", "10-Q"}


def test_chunks_anomalies_and_features():
    local = store()
    company = local.get_company_by_ticker("MSFT")
    filings = local.get_filings_by_company(company["id"])
    chunks = local.get_filing_chunks(filings[0]["id"])
    assert chunks and "text" in chunks[0]

    anomalies = local.get_anomalies_for_company(company["id"])
    assert anomalies
    scores = [signal["score"] for signal in anomalies]
    assert scores == sorted(scores, reverse=True)
    assert local.get_anomaly(anomalies[0]["id"])["id"] == anomalies[0]["id"]

    assert local.top_terms()
    assert local.section_stats()
    assert "temporal" in local.features() and "cross_section" in local.features()


def test_price_history_is_newest_first():
    local = store()
    aapl = local.get_company_by_ticker("AAPL")
    prices = local.get_price_history(aapl["id"], limit=10)
    assert prices
    dates = [row["date"] for row in prices]
    assert dates == sorted(dates, reverse=True)
    assert all(row["close"] > 0 for row in prices)
