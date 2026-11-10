import asyncio
import json
from datetime import date
from unittest.mock import AsyncMock

import httpx
import pytest

from app.edgar_client import EdgarClient, EdgarClientError
from app.ingest_jobs import IngestJobStore
from app.models import CompanyInfo, FilingInfo, IngestRequest
from app.storage import Storage
from app import main as ingestion_main


@pytest.fixture
def edgar_client(monkeypatch):
    async def no_wait(_seconds):
        return None

    monkeypatch.setattr(asyncio, "sleep", no_wait)
    client = EdgarClient()
    yield client
    asyncio.run(client.close())


@pytest.fixture
def storage(tmp_path, monkeypatch):
    for key in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SUPABASE_KEY"):
        monkeypatch.delenv(key, raising=False)
    return Storage(data_root=tmp_path)


@pytest.fixture
def company():
    return CompanyInfo(ticker="AMZN", cik="0001018724", name="Amazon.com, Inc.")


@pytest.fixture
def filing():
    return FilingInfo(
        ticker="AMZN",
        filing_type="10-K",
        filing_date=date(2025, 2, 1),
        accession_number="0001018724-25-000001",
        source_url="https://www.sec.gov/Archives/edgar/data/example",
    )


def test_persist_local_filing_is_idempotent(tmp_path, storage, company, filing):
    first = storage.persist_local_filing(
        company, filing, {"item_1": "text"}, "text"
    )
    second = storage.persist_local_filing(
        company, filing, {"item_1": "updated"}, "updated"
    )
    files = list((tmp_path / "raw" / "filings" / company.ticker).glob("*.json"))

    assert first == second
    assert len(files) == 1
    record = json.loads(files[0].read_text(encoding="utf-8"))
    assert record["ticker"] == "AMZN"
    assert record["cik"] == "0001018724"
    assert record["filing_type"] == "10-K"
    assert record["filing_date"] == "2025-02-01"
    assert record["accession_number"] == filing.accession_number
    assert record["source_url"] == filing.source_url
    assert record["sections"] == {"item_1": "updated"}
    assert record["clean_text"] == "updated"


def test_persist_local_company_upserts_by_ticker(tmp_path, storage, company):
    first_id = storage.persist_local_company(company)
    original = json.loads(
        (tmp_path / "ingestion" / "companies.json").read_text(encoding="utf-8")
    )[0]
    second_id = storage.persist_local_company(
        company.model_copy(update={"name": "Amazon"})
    )
    catalog = json.loads(
        (tmp_path / "ingestion" / "companies.json").read_text(encoding="utf-8")
    )

    assert first_id == second_id
    assert len(catalog) == 1
    assert catalog[0]["id"] == first_id
    assert catalog[0]["name"] == "Amazon"
    assert catalog[0]["created_at"] == original["created_at"]


def test_shared_company_catalog_merges_seed_ingested_and_curated_sources(
    tmp_path, storage
):
    seed = tmp_path / "seed" / "companies.json"
    seed.parent.mkdir(parents=True)
    seed.write_text(
        json.dumps(
            [
                {"ticker": "AMZN", "name": "Seed Amazon"},
                {"ticker": "MSFT", "name": "Microsoft"},
            ]
        ),
        encoding="utf-8",
    )
    curated = tmp_path / "curated" / "latest" / "companies.json"
    curated.parent.mkdir(parents=True)
    curated.write_text(
        json.dumps([{"ticker": "AMZN", "name": "Curated Amazon"}]),
        encoding="utf-8",
    )
    storage.persist_local_company(
        CompanyInfo(ticker="NVDA", cik="0001045810", name="NVIDIA")
    )

    companies = storage.list_local_companies()

    assert {company["ticker"] for company in companies} == {
        "AMZN",
        "MSFT",
        "NVDA",
    }
    assert next(company for company in companies if company["ticker"] == "AMZN")[
        "name"
    ] == "Curated Amazon"


def test_ingest_request_normalizes_and_validates_ticker_and_limits():
    request = IngestRequest(ticker=" amzn ", filing_types=["10-K"], max_filings=5)

    assert request.ticker == "AMZN"
    assert request.max_filings == 5

    with pytest.raises(ValueError):
        IngestRequest(ticker="AMZN", filing_types=["invalid"])
    with pytest.raises(ValueError):
        IngestRequest(ticker="AMZN", max_filings=11)


@pytest.mark.parametrize("transient_status", [429, 503])
def test_resolve_company_retries_transient_sec_failure(
    edgar_client, transient_status
):
    request = httpx.Request("GET", EdgarClient.TICKERS_URL)
    response = httpx.Response(
        200,
        json={
            "0": {
                "ticker": "AMZN",
                "cik_str": 1018724,
                "title": "Amazon.com, Inc.",
            }
        },
        request=request,
    )
    edgar_client.client.get = AsyncMock(
        side_effect=[httpx.Response(transient_status, request=request), response]
    )

    company = asyncio.run(edgar_client.resolve_company("AMZN"))

    assert company is not None
    assert company.cik == "0001018724"
    assert edgar_client.client.get.await_count == 2


@pytest.mark.parametrize("permanent_status", [400, 403, 404])
def test_resolve_company_does_not_retry_permanent_sec_failure(
    edgar_client, permanent_status
):
    request = httpx.Request("GET", EdgarClient.TICKERS_URL)
    edgar_client.client.get = AsyncMock(
        return_value=httpx.Response(permanent_status, request=request)
    )

    with pytest.raises(EdgarClientError, match=f"HTTP {permanent_status}"):
        asyncio.run(edgar_client.resolve_company("AMZN"))

    assert edgar_client.client.get.await_count == 1


def test_resolve_company_raises_after_transport_retries_are_exhausted(edgar_client):
    request = httpx.Request("GET", EdgarClient.TICKERS_URL)
    edgar_client.client.get = AsyncMock(
        side_effect=httpx.ConnectError("connection refused", request=request)
    )

    with pytest.raises(EdgarClientError, match="after 3 attempts"):
        asyncio.run(edgar_client.resolve_company("AMZN"))

    assert edgar_client.client.get.await_count == 3


def test_empty_sec_ticker_map_is_not_reported_as_unknown_ticker(edgar_client):
    request = httpx.Request("GET", EdgarClient.TICKERS_URL)
    edgar_client.client.get = AsyncMock(
        return_value=httpx.Response(200, json={}, request=request)
    )

    with pytest.raises(EdgarClientError, match="empty company ticker list"):
        asyncio.run(edgar_client.resolve_company("AMZN"))


def test_ingest_job_store_persists_terminal_status_across_instances(tmp_path):
    first_store = IngestJobStore(tmp_path)
    queued = first_store.create("AMZN")
    first_store.update(
        queued.job_id,
        status="running",
        started_at="2026-11-01T10:00:00+00:00",
    )
    first_store.update(
        queued.job_id,
        status="completed",
        filings_found=2,
        filings_ingested=2,
        finished_at="2026-11-01T10:00:10+00:00",
    )

    restored = IngestJobStore(tmp_path).get(queued.job_id)

    assert restored is not None
    assert restored.status == "completed"
    assert restored.filings_ingested == 2


def test_ingest_job_store_marks_interrupted_jobs_failed_after_restart(tmp_path):
    first_store = IngestJobStore(tmp_path)
    queued = first_store.create("AMZN")
    first_store.update(queued.job_id, status="running")

    restored = IngestJobStore(tmp_path).get(queued.job_id)

    assert restored is not None
    assert restored.status == "failed"
    assert "restart" in restored.error.lower()
    assert restored.finished_at is not None


def test_ingest_job_store_returns_none_for_unknown_id(tmp_path):
    assert IngestJobStore(tmp_path).get("missing") is None


def test_ingest_endpoint_fetches_and_persists_sec_filings(tmp_path, monkeypatch):
    async def no_wait(_seconds):
        return None

    monkeypatch.setattr(asyncio, "sleep", no_wait)
    edgar_client = EdgarClient()
    request = httpx.Request("GET", EdgarClient.TICKERS_URL)
    ticker_map = httpx.Response(
        200,
        json={
            "0": {
                "ticker": "AMZN",
                "cik_str": 1018724,
                "title": "Amazon.com, Inc.",
            }
        },
        request=request,
    )
    submissions = httpx.Response(
        200,
        json={
            "tickers": ["AMZN"],
            "filings": {
                "recent": {
                    "form": ["10-K", "10-Q"],
                    "filingDate": ["2025-02-01", "2025-05-01"],
                    "accessionNumber": [
                        "0001018724-25-000001",
                        "0001018724-25-000002",
                    ],
                    "primaryDocument": ["annual.html", "quarter.html"],
                    "periodOfReport": ["2024-12-31", "2025-03-31"],
                }
            },
        },
        request=httpx.Request(
            "GET", f"{EdgarClient.BASE_URL}/submissions/CIK0001018724.json"
        ),
    )
    html = (
        "<html><body><p>Item 1. Business</p><p>"
        + ("Amazon operates a large retail and cloud services business. " * 20)
        + "</p></body></html>"
    )
    html_response = httpx.Response(
        200,
        text=html,
        request=httpx.Request(
            "GET", "https://www.sec.gov/Archives/edgar/data/example"
        ),
    )
    edgar_client.client.get = AsyncMock(
        side_effect=[ticker_map, submissions, html_response, html_response]
    )
    monkeypatch.setattr(ingestion_main, "edgar", edgar_client)
    monkeypatch.setattr(ingestion_main, "storage", Storage(data_root=tmp_path))
    monkeypatch.setattr(
        ingestion_main, "ingest_jobs", IngestJobStore(tmp_path), raising=False
    )

    async def exercise_api():
        transport = httpx.ASGITransport(app=ingestion_main.app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            started = await client.post(
                "/ingest/company",
                json={
                    "ticker": "AMZN",
                    "filing_types": ["10-K", "10-Q"],
                    "max_filings": 2,
                },
            )
            assert started.status_code == 202
            job_id = started.json()["job_id"]
            status = await client.get(f"/ingest/status/{job_id}")
            return status

    try:
        status_response = asyncio.run(exercise_api())
    finally:
        asyncio.run(edgar_client.close())

    assert status_response.status_code == 200
    status = status_response.json()
    assert status["status"] == "completed"
    assert status["filings_found"] == 2
    assert status["filings_ingested"] == 2
    filings = list((tmp_path / "raw" / "filings" / "AMZN").glob("*.json"))
    assert len(filings) == 2


@pytest.mark.parametrize(
    ("ticker", "expected_error"),
    [
        ("NOPE", "Unknown SEC ticker"),
        ("AMZN", "No matching SEC filings"),
    ],
)
def test_ingest_endpoint_reports_unknown_tickers_and_empty_results(
    tmp_path, monkeypatch, ticker, expected_error
):
    class EmptySecClient:
        async def resolve_company(self, requested_ticker):
            if requested_ticker == "NOPE":
                return None
            return CompanyInfo(
                ticker="AMZN", cik="0001018724", name="Amazon.com, Inc."
            )

        async def get_filings(self, cik, filing_types, max_filings):
            return []

    monkeypatch.setattr(ingestion_main, "edgar", EmptySecClient())
    monkeypatch.setattr(ingestion_main, "storage", Storage(data_root=tmp_path))
    monkeypatch.setattr(ingestion_main, "ingest_jobs", IngestJobStore(tmp_path))

    async def exercise_api():
        transport = httpx.ASGITransport(app=ingestion_main.app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            started = await client.post(
                "/ingest/company", json={"ticker": ticker}
            )
            status = await client.get(
                f"/ingest/status/{started.json()['job_id']}"
            )
            return started, status

    started_response, status_response = asyncio.run(exercise_api())

    assert started_response.status_code == 202
    assert status_response.status_code == 200
    assert status_response.json()["status"] == "failed"
    assert expected_error in status_response.json()["error"]
