import asyncio
import importlib.util
import json
import logging
import os
import shutil
import subprocess
import sys
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .models import IngestRequest
from .edgar_client import EdgarClient
from .ingest_jobs import IngestJobStore
from .xbrl_parser import extract_sections, clean_html
from .chunker import chunk_sections
from .storage import Storage, curated_dir, data_dir

edgar = EdgarClient()
storage = Storage()
ingest_jobs = IngestJobStore()


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Close the shared SEC HTTP client when the service stops.  Recent FastAPI
    # releases no longer expose add_event_handler(), so lifespan is the portable
    # way to run shutdown hooks.
    yield
    await edgar.close()


app = FastAPI(
    title="Ingestion US (SEC EDGAR + PySpark RDD)",
    version="0.2.0",
    lifespan=lifespan,
)
logger = logging.getLogger(__name__)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Spark jobs are process-local (single-container demo). The lock guarantees one
# pipeline at a time.  The pipeline itself runs in a child process so the JVM,
# py4j gateway and Python workers are fully released after each run; keeping
# PySpark inside the FastAPI process leaked hundreds of MB on a small laptop.
spark_jobs: dict[str, dict] = {}
_spark_lock = threading.Lock()
SERVICE_ROOT = Path(__file__).resolve().parents[1]


class SparkRunRequest(BaseModel):
    tickers: Optional[list[str]] = None
    wait: bool = False


@app.get("/health")
async def health():
    spark_available = bool(shutil.which("java")) and importlib.util.find_spec("pyspark") is not None
    return {
        "status": "healthy",
        "service": "ingestion-us",
        "spark": "available" if spark_available else "unavailable",
        "spark_runner": "subprocess",
        "storage": "supabase" if storage.enabled else "local-artifacts",
        "data_dir": str(data_dir()),
    }



# PySpark RDD pipeline


def _run_spark_job(job_id: str, tickers: Optional[list[str]]) -> None:
    job = spark_jobs[job_id]
    job.update(status="running", started_at=datetime.now(timezone.utc).isoformat())
    started = time.perf_counter()
    try:
        with _spark_lock:
            command = [sys.executable, "-u", "-m", "app.spark.runner"]
            if tickers:
                command.extend(["--tickers", *tickers])

            env = os.environ.copy()
            env["PYTHONUNBUFFERED"] = "1"
            env["ANOMALY_DATA_DIR"] = str(data_dir())
            timeout = float(os.getenv("SPARK_JOB_TIMEOUT_SECONDS", "1800"))

            completed = subprocess.run(
                command,
                cwd=str(SERVICE_ROOT),
                env=env,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            job["runner_command"] = " ".join(command)

            if completed.returncode != 0:
                tail = (completed.stderr or completed.stdout or "").strip()[-4000:]
                raise RuntimeError(
                    f"Spark runner exited with code {completed.returncode}: {tail}"
                )

            summary_path = curated_dir() / "run_summary.json"
            summary = json.loads(summary_path.read_text(encoding="utf-8"))

        job.update(
            status="completed",
            finished_at=datetime.now(timezone.utc).isoformat(),
            duration_seconds=round(time.perf_counter() - started, 2),
            run_id=summary["run_id"],
            summary={
                "input": summary["input"],
                "counts": summary["counts"],
                "benchmark": summary["benchmark"],
                "artifacts": summary["artifacts"],
            },
        )
    except Exception as exc:
        job.update(
            status="failed",
            finished_at=datetime.now(timezone.utc).isoformat(),
            duration_seconds=round(time.perf_counter() - started, 2),
            error=f"{type(exc).__name__}: {exc}",
        )


@app.post("/spark/run")
async def start_spark_run(request: SparkRunRequest):
    """Start (or synchronously run) the RDD pipeline over the local snapshot."""
    raw_files = list((data_dir() / "raw" / "filings").glob("*/*.json"))
    if not raw_files:
        raise HTTPException(
            status_code=409,
            detail=(
                "No raw SEC filings found. Run scripts/fetch_sec_filings.py "
                "or POST /spark/run after adding data/raw/filings/<TICKER>/*.json."
            ),
        )

    job_id = str(uuid.uuid4())
    spark_jobs[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "queued_at": datetime.now(timezone.utc).isoformat(),
        "tickers": request.tickers,
        "raw_files": len(raw_files),
        "error": None,
    }

    if request.wait:
        _run_spark_job(job_id, request.tickers)
        return spark_jobs[job_id]

    thread = threading.Thread(target=_run_spark_job, args=(job_id, request.tickers), daemon=True)
    thread.start()
    return spark_jobs[job_id]


@app.get("/spark/status/{job_id}")
async def spark_status(job_id: str):
    job = spark_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Spark job not found")
    return job


@app.get("/spark/latest")
async def spark_latest():
    path = curated_dir() / "run_summary.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="No pipeline run yet")
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/spark/raw")
async def spark_raw():
    raw_dir = data_dir() / "raw" / "filings"
    files = []
    for path in sorted(raw_dir.glob("*/*.json")):
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        files.append(
            {
                "ticker": record.get("ticker"),
                "filing_type": record.get("filing_type"),
                "filing_date": record.get("filing_date"),
                "accession_number": record.get("accession_number"),
                "sections": sorted(record.get("sections", {})),
                "chars": sum(len(text) for text in record.get("sections", {}).values()),
            }
        )
    return {"files": files, "total": len(files)}


# --------------------------------------------------------------------------
# SEC company ingestion
# --------------------------------------------------------------------------


def _parse_filing_document(html: str) -> tuple[dict, str]:
    """CPU-bound HTML parsing, executed in a worker thread."""
    return extract_sections(html), clean_html(html)


async def _run_company_ingest(job_id: str, req: IngestRequest) -> None:
    storage_warnings: list[str] = []
    ingest_jobs.update(
        job_id,
        status="running",
        started_at=datetime.now(timezone.utc).isoformat(),
    )
    try:
        company = await edgar.resolve_company(req.ticker)
        if company is None:
            raise ValueError(f"Unknown SEC ticker: {req.ticker.upper()}")
        if not company.cik:
            raise ValueError(f"SEC company {company.ticker} has no CIK")

        # The local snapshot is the source of truth for the demo and the Spark
        # pipeline.  Supabase is an optional mirror: a missing table, RLS rule,
        # or network hiccup must not throw away a filing that was fetched.
        company_id = storage.persist_local_company(company)
        if storage.enabled:
            try:
                company_id = await storage.upsert_company(company)
            except Exception as exc:
                logger.warning(
                    "Supabase company copy failed for %s: %s",
                    company.ticker,
                    exc,
                )
                storage_warnings.append(
                    f"Saved company locally, but the Supabase copy failed: {exc}"
                )
        filings = await edgar.get_filings(
            company.cik, req.filing_types, req.max_filings
        )
        ingest_jobs.update(job_id, filings_found=len(filings))
        if not filings:
            raise ValueError(
                f"No matching SEC filings found for {company.ticker} "
                f"({', '.join(req.filing_types)})"
            )

        errors = []
        filings_ingested = 0
        for filing in filings:
            try:
                if not filing.source_url:
                    raise ValueError("SEC filing has no source URL")
                html = await edgar.fetch_filing_html(filing.source_url)
                if not html.strip():
                    raise ValueError("SEC returned an empty filing document")

                # Parsing a 400 kB filing is CPU-heavy.  Run it in a worker
                # thread so the service keeps answering /health and status polls
                # while a company is being downloaded (otherwise the dashboard
                # shows "backend not reachable" during every ingest).
                sections, clean_text = await asyncio.to_thread(
                    _parse_filing_document, html
                )
                await asyncio.to_thread(
                    storage.persist_local_filing,
                    company,
                    filing,
                    sections,
                    clean_text,
                )
                if storage.enabled:
                    try:
                        filing_id = await storage.upsert_filing(
                            company_id, filing, sections, clean_text
                        )
                        await storage.upsert_chunks(
                            filing_id,
                            await asyncio.to_thread(chunk_sections, sections),
                        )
                    except Exception as exc:
                        logger.warning(
                            "Supabase filing copy failed for %s %s: %s",
                            company.ticker,
                            filing.accession_number,
                            exc,
                        )
                        storage_warnings.append(
                            "Saved filing locally, but the Supabase copy "
                            f"failed for {filing.filing_type} "
                            f"{filing.filing_date}: {exc}"
                        )
                filings_ingested += 1
                ingest_jobs.update(
                    job_id,
                    filings_ingested=filings_ingested,
                )
            except Exception as exc:
                logger.exception(
                    "Could not ingest %s %s filing %s",
                    company.ticker,
                    filing.filing_type,
                    filing.accession_number,
                )
                errors.append(
                    f"{filing.filing_type} {filing.filing_date}: "
                    f"{type(exc).__name__}: {exc}"
                )

        if errors:
            raise RuntimeError(
                f"Failed to ingest {len(errors)} of {len(filings)} filings: "
                + "; ".join(errors)
            )

        ingest_jobs.update(
            job_id,
            status="completed",
            warnings=storage_warnings,
            finished_at=datetime.now(timezone.utc).isoformat(),
        )
    except Exception as exc:
        logger.exception("Company ingestion job %s failed", job_id)
        ingest_jobs.update(
            job_id,
            status="failed",
            error=f"{type(exc).__name__}: {exc}",
            warnings=storage_warnings,
            finished_at=datetime.now(timezone.utc).isoformat(),
        )


@app.post("/ingest/company", status_code=202)
async def ingest_company(req: IngestRequest, background_tasks: BackgroundTasks):
    status = ingest_jobs.create(req.ticker)
    background_tasks.add_task(_run_company_ingest, status.job_id, req)
    return status.model_dump(mode="json")


@app.get("/ingest/status/{job_id}")
async def ingest_status(job_id: str):
    status = ingest_jobs.get(job_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return status.model_dump(mode="json")


@app.get("/ingest/companies")
async def list_companies():
    """Return the shared seed, fetched, and curated company catalog."""
    try:
        return {"companies": storage.list_local_companies()}
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        logger.exception("Could not read the shared company catalog")
        raise HTTPException(
            status_code=500, detail=f"Could not read company catalog: {exc}"
        ) from exc
