# Shared Company Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SEC company ingestion work without Supabase, safely share the five requested companies across local profiles, and report real progress and failures.

**Architecture:** Keep local profiles as browser-only identities and company/filing data in shared local files. The ingestion service will resolve and fetch SEC filings with bounded retries, atomically persist company and filing records, and expose durable job status; the gateway and frontend will proxy and display that status. Spark remains a separate operation that processes the shared raw filing snapshot.

**Tech Stack:** Python 3.11, FastAPI, httpx, pytest, local JSON artifacts, Next.js/React, TypeScript, PySpark.

## Global Constraints

- The five shared companies are AAPL, MSFT, AMZN, NVDA, and GOOGL.
- Local profiles remain browser-local demo identities; do not imply authentication or account isolation.
- Local SEC ingestion must work without Supabase.
- SEC retries are bounded and apply only to transient failures.
- Never report a fetch or pipeline as successful until that operation actually completes.
- SEC/provider availability cannot be guaranteed; errors must remain actionable and data writes idempotent.
- Preserve all pre-existing worktree/index changes; never include unrelated staged paths in feature commits.

---

## File map

- `data/seed/companies.json` — versioned metadata for the five default companies.
- `data/ingestion/companies.json` — generated shared company metadata discovered during SEC ingestion.
- `.gitignore` — exclude generated local company/job data and downloaded SEC filings.
- `services/ingestion-us/app/edgar_client.py` — SEC lookup, filing metadata, and bounded request retry behavior.
- `services/ingestion-us/app/models.py` — validated ingest request and job response fields.
- `services/ingestion-us/app/storage.py` — shared runtime catalog and raw filing persistence, plus existing optional Supabase writes.
- `services/ingestion-us/app/ingest_jobs.py` — atomic, file-backed ingest job lifecycle and restart recovery.
- `services/ingestion-us/app/main.py` — asynchronous ingest and job-status endpoints.
- `services/ingestion-us/tests/test_local_ingestion.py` — deterministic tests for SEC failures, local writes, and job status.
- `services/api-gateway/app/clients/local_store.py` — merge seeded, locally ingested, and curated companies.
- `services/api-gateway/app/clients/ingestion_us_client.py` — typed gateway calls for starting and polling ingestion.
- `services/api-gateway/app/clients/base_client.py` — retry only transient service failures.
- `services/api-gateway/app/main.py` — route ingest requests to SEC ingestion in both storage modes and proxy job status.
- `services/api-gateway/tests/test_company_ingestion.py` — gateway routing and error-response tests.
- `services/frontend/src/lib/api.ts` — typed ingest start/status methods and network error context.
- `services/frontend/src/components/modals/AddCompanyModal.tsx` — poll job status and render truthful terminal state.
- `scripts/fetch_sec_filings.py` — use the same five default tickers for repeatable initial population.
- `README.md` — document local start, company fetch, and separate pipeline execution.

## Task 1: Create the shared five-company catalog

**Files:**
- Create: `data/seed/companies.json`
- Modify: `.gitignore`
- Modify: `services/api-gateway/app/clients/local_store.py`
- Test: `services/api-gateway/tests/test_local_store.py`

**Interfaces:**
- `LocalStore.list_companies(limit: int = 100, offset: int = 0) -> list[dict]` returns a ticker-deduplicated merge of seed, runtime, and curated companies.
- `LocalStore.get_company_by_ticker(ticker: str) -> Optional[dict]` finds a company in either source, case-insensitively.
- Seed entries use the existing company shape: `id`, `ticker`, `name`, `cik`, `jurisdiction`, `sector`, and `created_at`. IDs must match `stable_id("company", ticker)` so future Spark output joins to the same company.

- [ ] **Step 1: Add failing catalog contract tests**

Add `json` to the imports in `test_local_store.py`. The first test checks the repository's shared seed; the second isolates source merging under `tmp_path`:

```python
def test_seed_catalog_has_five_shared_companies():
    companies = LocalStore().list_companies()
    assert {company["ticker"] for company in companies} >= {
        "AAPL", "MSFT", "AMZN", "NVDA", "GOOGL"
    }


def test_curated_company_overrides_seed_without_duplicate_ticker(tmp_path):
    root = tmp_path / "curated" / "latest"
    root.mkdir(parents=True)
    (tmp_path / "seed" / "companies.json").parent.mkdir(parents=True)
    (tmp_path / "seed" / "companies.json").write_text(
        json.dumps([{"ticker": "AMZN", "name": "Amazon.com, Inc."}]),
        encoding="utf-8",
    )
    (tmp_path / "ingestion").mkdir()
    (tmp_path / "ingestion" / "companies.json").write_text(
        json.dumps([]), encoding="utf-8"
    )
    (root / "companies.json").write_text(
        json.dumps([{"ticker": "AMZN", "name": "Amazon Incorporated"}]),
        encoding="utf-8",
    )
    store = LocalStore(root)
    companies = store.list_companies()
    assert [company["ticker"] for company in companies].count("AMZN") == 1
    assert store.get_company_by_ticker("amzn")["name"] == "Amazon Incorporated"
```

Update the existing assertion in `test_companies_and_filings` from exact equality with `{"AAPL", "MSFT"}` to asserting that those tickers are present; the shared catalog intentionally adds three.

- [ ] **Step 2: Run the focused test and verify the missing catalog fails**

Run: `services\api-gateway\venv\Scripts\python.exe -m pytest services\api-gateway\tests\test_local_store.py -q`

Expected: the five-company assertions fail before catalog support is implemented.

- [ ] **Step 3: Add the five-company JSON catalog**

Add entries for Apple Inc. (`AAPL`, CIK `0000320193`), Microsoft Corporation (`MSFT`, `0000789019`), Amazon.com, Inc. (`AMZN`, `0001018724`), NVIDIA Corporation (`NVDA`, `0001045810`), and Alphabet Inc. (`GOOGL`, `0001652044`). Use deterministic `stable_id("company", ticker)` values and the existing curated company field names. Keep the seed separate from the runtime registry and `curated/latest/companies.json`, which Spark rewrites.

- [ ] **Step 4: Merge sources in `LocalStore`**

Resolve the data root as `self.root.parents[1]` when a curated root is injected, or use the existing default root otherwise. Merge `seed/companies.json`, `ingestion/companies.json`, and curated `companies.json` in that order so newer runtime/curated rows override seed rows. Sort by ticker before applying `offset` and `limit`. Preserve the existing case-insensitive lookup behavior and do not silently return an empty list if a present catalog is malformed; surface/log the parse error using the repository's existing logging convention.

- [ ] **Step 5: Run the local-store tests**

Run: `services\api-gateway\venv\Scripts\python.exe -m pytest services\api-gateway\tests\test_local_store.py -q`

Expected: all assertions pass and existing curated filing tests remain unchanged.

- [ ] **Step 6: Commit the catalog task**

Add `data/ingestion/` and `data/raw/filings/` to `.gitignore`, without ignoring the versioned seed. Stage only `.gitignore`, `data/seed/companies.json`, `services/api-gateway/app/clients/local_store.py`, and `services/api-gateway/tests/test_local_store.py`; inspect `git diff --cached --name-only` before committing. If unrelated paths are already staged, keep them out of this commit and preserve their staged state. Commit as `feat: add shared five-company catalog`.

## Task 2: Fetch and atomically persist SEC filings in local mode

**Files:**
- Modify: `services/ingestion-us/app/edgar_client.py`
- Modify: `services/ingestion-us/app/storage.py`
- Modify: `services/ingestion-us/app/models.py`
- Modify: `services/ingestion-us/app/main.py`
- Create: `services/ingestion-us/tests/test_local_ingestion.py`

**Interfaces:**
- Add `EdgarClientError`, raised when the SEC ticker map or filing metadata cannot be retrieved after bounded retries; unknown tickers remain distinguishable from provider failures.
- `Storage(data_root: Path | None = None)` accepts an injectable data root for tests.
- `Storage.persist_local_company(company: CompanyInfo) -> str` atomically upserts `data/ingestion/companies.json`.
- `Storage.persist_local_filing(company: CompanyInfo, filing: FilingInfo, sections: dict[str, str], clean_text: str) -> Path` writes the raw filing.
- Raw filing JSON stays at `data/raw/filings/<TICKER>/<accession>.json`, matching `load_raw_filings`; its fields match the existing `fetch_sec_filings.py` record shape.
- `Storage` must persist local files in every mode; when Supabase is configured, keep existing upserts in addition to the local snapshot required by Spark.

- [ ] **Step 1: Add failing local persistence tests**

Create a fixture that removes `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and `SUPABASE_KEY`, then constructs `Storage(data_root=tmp_path)`. Define company and filing fixtures as shown, and also assert the stored record contains ticker, CIK, filing type, filing date, accession number, source URL, sections, and clean text:

```python
import json
from datetime import date

import pytest

from app.models import CompanyInfo, FilingInfo
from app.storage import Storage


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
    first = storage.persist_local_filing(company, filing, {"item_1": "text"}, "text")
    second = storage.persist_local_filing(company, filing, {"item_1": "updated"}, "updated")
    files = list((tmp_path / "raw" / "filings" / company.ticker).glob("*.json"))
    assert first == second
    assert len(files) == 1
    record = json.loads(files[0].read_text(encoding="utf-8"))
    assert record["ticker"] == "AMZN"
    assert record["cik"] == "0001018724"
    assert record["filing_type"] == "10-K"
    assert record["accession_number"] == filing.accession_number
    assert record["sections"] == {"item_1": "updated"}
    assert record["clean_text"] == "updated"
```

- [ ] **Step 2: Verify the persistence tests fail**

Run: `services\ingestion-us\venv\Scripts\python.exe -m pytest services\ingestion-us\tests\test_local_ingestion.py -q`

Expected: fail because local persistence is not implemented.

- [ ] **Step 3: Implement atomic local upserts**

Use the shared `data_dir()` and `curated_dir()` helpers. Write JSON to a sibling temporary file and replace the target with `os.replace`; create parent directories first. Update `data/ingestion/companies.json` by ticker without deleting other entries, using a process lock for the read/modify/write sequence. Use `stable_id("company", ticker)` for the local company ID. Retain the current Supabase upserts when configured.

- [ ] **Step 4: Add bounded SEC retry tests**

Mock `httpx.AsyncClient.get` to verify that HTTP 429 and transient 5xx/transport errors retry no more than three attempts, then either return decoded JSON or raise `EdgarClientError`. Verify a permanent 4xx is not retried and an unavailable ticker map is not misreported as an unknown ticker.

- [ ] **Step 5: Implement bounded retries and clear SEC errors**

In `EdgarClient`, retry only 429, 5xx, and transport/time-out failures, with capped exponential waits and at most three attempts. Do not recurse indefinitely on 429. Keep successful SEC responses unchanged; raise `EdgarClientError` after retries instead of converting provider failure to `None` or an empty filing list.

- [ ] **Step 6: Exercise the fetch-to-file service path**

Add an async test that replaces the SEC client with a deterministic fake, returns a valid company and two filing records, and asserts `persist_local_company` and `persist_local_filing` are called with parsed sections. Add cases for unknown ticker, no matching filings, exhausted SEC retries, and file-write errors. Assert each result is a truthful client/provider/storage error, not a successful ingest.

- [ ] **Step 7: Run ingestion tests**

Run: `services\ingestion-us\venv\Scripts\python.exe -m pytest services\ingestion-us\tests\test_local_ingestion.py services\ingestion-us\tests\test_spark_helpers.py -q`

Expected: new ingestion/storage tests pass and existing raw snapshot/pipeline helper tests remain green.

- [ ] **Step 8: Commit SEC persistence**

Stage only the two ingestion modules and the new test file; inspect the staged path list. Commit as `feat: persist SEC filings in shared local storage`.

## Task 3: Add durable job status and route the gateway through real ingestion

**Files:**
- Create: `services/ingestion-us/app/ingest_jobs.py`
- Modify: `services/ingestion-us/app/models.py`
- Modify: `services/ingestion-us/app/main.py`
- Modify: `services/api-gateway/app/clients/base_client.py`
- Modify: `services/api-gateway/app/clients/ingestion_us_client.py`
- Modify: `services/api-gateway/app/main.py`
- Create: `services/api-gateway/tests/test_company_ingestion.py`
- Test: `services/ingestion-us/tests/test_local_ingestion.py`

**Interfaces:**
- `POST /ingest/company` returns `{job_id, status, ticker}` immediately, with status `queued`.
- `GET /ingest/status/{job_id}` returns `IngestStatus` with `queued`, `running`, `completed`, or `failed`, filing counts, optional `queued_at`, `started_at`, and `finished_at` timestamps, and an error on failure. Add those optional timestamp fields to the existing model.
- `IngestJobStore.create(ticker) -> IngestStatus`, `IngestJobStore.update(job_id, **changes) -> IngestStatus`, and `IngestJobStore.get(job_id) -> IngestStatus | None` persist JSON under `data/ingestion/jobs/`.
- The gateway exposes `GET /api/v1/companies/ingest/status/{job_id}` and forwards start/status calls to ingestion-us in both local and Supabase modes. The company-fetch route must never invoke Spark as a substitute for downloading filings.

- [ ] **Step 1: Write failing job-store tests**

Test create/update/get, atomic JSON replacement, a missing ID, and service restart recovery. On service startup, convert persisted `queued` or `running` jobs to `failed` with a clear interruption error; retain terminal jobs for polling.

```python
def test_job_store_persists_terminal_status_across_instances(tmp_path):
    first = IngestJobStore(tmp_path)
    job = first.create("AMZN")
    first.update(job.job_id, status="completed", filings_found=2, filings_ingested=2)
    reloaded = IngestJobStore(tmp_path).get(job.job_id)
    assert reloaded.status == "completed"
    assert reloaded.filings_ingested == 2
```

- [ ] **Step 2: Verify job-store tests fail**

Run: `services\ingestion-us\venv\Scripts\python.exe -m pytest services\ingestion-us\tests\test_local_ingestion.py -q`

Expected: fail because `IngestJobStore` does not yet exist.

- [ ] **Step 3: Implement the file-backed job store**

Persist each job via write-temp-and-`os.replace` under `data/ingestion/jobs/<job_id>.json`. Validate allowed state transitions; never change a terminal job back to running. On initialization, mark only stale `queued`/`running` jobs failed and preserve completed/failed jobs.

- [ ] **Step 4: Convert SEC ingestion to a real asynchronous job**

Change `POST /ingest/company` to trim and uppercase the ticker, accept only `10-K`, `10-Q`, and `8-K`, and constrain `max_filings` to 1–10. Return 422 for invalid input, 404 for an unknown SEC ticker or no matching filings, 503 for exhausted SEC retries, and 500 for local persistence failures. Persist the queued job, schedule the ingest coroutine, and return the job ID. Update the job after each filing and set `completed` only after all requested local writes and configured Supabase writes succeed. On any failure, persist `failed`, the completed filing count, and a sanitized actionable error. Keep `GET /ingest/status/{job_id}` backed by `IngestJobStore`.

- [ ] **Step 5: Verify the service API lifecycle**

With the fake SEC client from Task 2, test POST returns queued, status progresses to completed, failed jobs expose the provider error, and a new store instance can retrieve the terminal state. Verify invalid tickers return 404, invalid request fields return 422, and unavailable SEC returns 503 rather than an empty success.

- [ ] **Step 6: Fix gateway routing and add status proxy**

Always call `ingestion_us.ingest_company` for the SEC-fetch request; remove the `local-artifacts` branch that calls `start_spark_run`. Keep any existing market-price request independent of the filing job: a market-service failure must not mark the SEC filing job failed or hide its job ID. Add a typed client method for `GET /ingest/status/{job_id}` and a gateway status route. Return upstream HTTP errors with their status/detail; distinguish connection failures as 503 and log the cause. Do not convert an unavailable gateway or ingestion service into success-shaped output.

- [ ] **Step 7: Stop retrying permanent gateway HTTP failures**

Update the retry predicate in `BaseServiceClient` to retry connection/time-out errors and HTTP 429/5xx only. Verify a 404/422 is sent once and remains the final response, while a 503 can retry up to the configured attempt limit.

- [ ] **Step 8: Add gateway contract tests**

Use FastAPI `TestClient` with mocked gateway clients. Assert local-artifact mode calls `ingest_company` and never calls `start_spark_run`; Supabase mode also starts SEC ingestion; status is proxied; upstream validation/provider errors retain useful status/detail; and an upstream connection error returns 503.

- [ ] **Step 9: Run backend suites**

Run:

```powershell
services\ingestion-us\venv\Scripts\python.exe -m pytest services\ingestion-us\tests -q
services\api-gateway\venv\Scripts\python.exe -m pytest services\api-gateway\tests -q
```

Expected: both suites pass, including the existing curated artifact contract tests.

- [ ] **Step 10: Commit API job flow**

Stage only `services/ingestion-us/app/ingest_jobs.py`, `services/ingestion-us/app/models.py`, `services/ingestion-us/app/main.py`, the gateway base/ingestion clients and routes, and both focused test files. Inspect `git diff --cached --name-only`. Commit as `feat: expose durable SEC ingestion jobs`.

## Task 4: Make the UI truthful and populate all five companies

**Files:**
- Modify: `services/frontend/src/lib/api.ts`
- Modify: `services/frontend/src/components/modals/AddCompanyModal.tsx`
- Modify: `scripts/fetch_sec_filings.py`
- Modify: `services/ingestion-us/tests/test_spark_helpers.py`
- Modify: `services/api-gateway/tests/test_local_store.py`
- Modify: `README.md`

**Interfaces:**
- `api.companies.ingest(ticker, request)` returns a typed queued job with `job_id`.
- `api.companies.ingestStatus(jobId)` returns the `IngestStatus` response.
- The modal polls status until completed/failed, leaves the modal open on failure, and calls `onSuccess` only after completion.

- [ ] **Step 1: Implement the typed status client and network diagnostics**

Add typed start/status response shapes. Catch network errors around the `fetch` call itself and include the configured API origin, a health-check URL, and a reminder that a different frontend origin must be allowed by `CORS_ORIGINS`; continue to display JSON `detail` for HTTP failures. Do not expose credentials or raw server traces.

- [ ] **Step 2: Replace optimistic modal success with polling**

After POST, require a returned `job_id`; poll `ingestStatus` every 1.5 seconds while queued/running. Display filing counts and current status. On completed, refresh the company list and close the modal. On failed/HTTP/network error, stop polling, keep the modal open, and display the actual actionable message. Stop the polling timer when the modal unmounts/closes. Use a finite 15-minute client deadline and a clear retry-later message; do not claim the server job was cancelled. Change `EXAMPLE_TICKERS` to the five shared tickers and make the helper buttons select those exact symbols.

- [ ] **Step 3: Verify UI type safety**

Run from the repository root:

```powershell
services\frontend\node_modules\.bin\tsc.cmd --noEmit -p services\frontend\tsconfig.json
```

Expected: zero type errors.

- [ ] **Step 4: Make the SEC bootstrap script default to the five tickers**

Change the script's default `--tickers` list to `AAPL MSFT AMZN NVDA GOOGL`; preserve explicit `--tickers` overrides and the existing cache behavior. Keep the filing limits configurable. Catch exhausted provider errors per ticker, print the failed ticker and actionable cause, continue attempting the remaining tickers, and return a nonzero exit code if any requested ticker could not be fetched.

Update `test_raw_snapshot_has_five_filings` to require at least five records and AAPL/MSFT to remain present before bootstrap; after bootstrap, require all five tickers. Keep ticker-specific checks (such as AAPL's three filings) scoped to that ticker. Update `test_summary_counts` from exactly five filings to at least five, and the curated company assertion to require AAPL/MSFT rather than reject the added companies.

- [ ] **Step 5: Document the operational flow**

Update the README to state that profiles are local-only, list the five shared catalog tickers, explain that **Fetch filings** downloads SEC input and **Execute RDD Pipeline** separately processes it, and show these exact PowerShell commands to start services, fetch the five defaults, and run Spark:

```powershell
.\start-dev.ps1 -IncludeFrontend
services\ingestion-us\venv\Scripts\python.exe scripts\fetch_sec_filings.py
$run = Invoke-RestMethod -Method Post -Uri http://localhost:8000/api/v1/pipeline/run -ContentType 'application/json' -Body '{"wait":false}'
do {
  Start-Sleep -Seconds 3
  $job = Invoke-RestMethod -Uri "http://localhost:8000/api/v1/pipeline/status/$($run.job_id)"
} while ($job.status -in @('queued', 'running'))
if ($job.status -ne 'completed') { throw $job.error }
```

State that SEC/network failures are retried a bounded number of times and reported.

- [ ] **Step 6: Populate and verify the real five-company snapshot**

With ingestion and gateway services running, run:

```powershell
services\ingestion-us\venv\Scripts\python.exe scripts\fetch_sec_filings.py
```

Then run the RDD pipeline through `POST http://localhost:8000/api/v1/pipeline/run` and poll its returned job ID at `/api/v1/pipeline/status/{job_id}` until terminal. Verify the company API returns all five tickers, `data/raw/filings/` contains filings under all five ticker directories, and the completed Spark summary lists all five tickers. If SEC is unavailable, report the exact failed tickers and do not claim five-company ingestion completed.

- [ ] **Step 7: Run end-to-end verification**

Run the two backend pytest commands from Task 3 and the TypeScript command from Step 3. Then use the UI to submit AMZN twice: the first request must produce a completed job and refresh the shared company list; the second must reuse cached data without duplicate raw filing files. Verify a deliberately invalid ticker displays an explicit not-found error and that a stopped API displays an actionable connection message.

- [ ] **Step 8: Commit frontend, bootstrap, and docs**

Stage only the frontend API/modal, fetch script, README, and any tests added for the UI contract. Inspect `git diff --cached --name-only` before committing. Commit as `feat: complete shared five-company SEC ingestion`.
