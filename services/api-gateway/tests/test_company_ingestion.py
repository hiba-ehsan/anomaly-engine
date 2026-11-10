import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from app import main as gateway_main
from app.clients.base_client import BaseServiceClient


def test_company_ingestion_uses_sec_service_in_every_storage_mode(monkeypatch):
    ingestion = SimpleNamespace(
        ingest_company=AsyncMock(
            return_value={
                "job_id": "job-1",
                "status": "queued",
                "ticker": "AMZN",
            }
        ),
        get_ingest_status=AsyncMock(
            return_value={"job_id": "job-1", "status": "completed"}
        ),
        start_spark_run=AsyncMock(
            side_effect=AssertionError("company fetch must not invoke Spark")
        ),
    )
    monkeypatch.setattr(gateway_main, "ingestion_us", ingestion)

    async def exercise_api(source):
        monkeypatch.setattr(
            gateway_main, "supabase", SimpleNamespace(source=source)
        )
        transport = httpx.ASGITransport(app=gateway_main.app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            started = await client.post(
                "/api/v1/companies/AMZN/ingest",
                json={"filing_types": ["10-K", "10-Q"], "max_filings": 5},
            )
            status = await client.get(
                "/api/v1/companies/ingest/status/job-1"
            )
            return started, status

    for source in ("local-artifacts", "supabase"):
        started, status = asyncio.run(exercise_api(source))
        assert started.status_code == 202
        assert started.json()["job_id"] == "job-1"
        assert status.status_code == 200
        assert status.json()["status"] == "completed"

    assert ingestion.ingest_company.await_count == 2
    assert ingestion.start_spark_run.await_count == 0


def test_gateway_reports_ingestion_service_unavailable(monkeypatch):
    ingestion = SimpleNamespace(
        ingest_company=AsyncMock(side_effect=httpx.ConnectError("connection refused")),
    )
    monkeypatch.setattr(gateway_main, "ingestion_us", ingestion)

    async def request():
        transport = httpx.ASGITransport(app=gateway_main.app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            return await client.post(
                "/api/v1/companies/AMZN/ingest", json={}
            )

    response = asyncio.run(request())

    assert response.status_code == 503
    assert "ingestion-us" in response.json()["detail"]


def test_base_client_does_not_retry_permanent_http_errors(monkeypatch):
    async def no_wait(_seconds):
        return None

    monkeypatch.setattr(asyncio, "sleep", no_wait)
    service = BaseServiceClient("https://service.test")
    request = httpx.Request("GET", "https://service.test/company")
    service.client.request = AsyncMock(
        return_value=httpx.Response(404, request=request)
    )

    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(service.get("/company"))

    assert service.client.request.await_count == 1
    asyncio.run(service.close())
