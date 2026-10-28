import importlib.util
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .models import IngestRequest, IngestStatus
from .edgar_client import EdgarClient
from .xbrl_parser import extract_sections, clean_html
from .chunker import chunk_sections
from .storage import Storage, curated_dir, data_dir

app = FastAPI(title="Ingestion US (SEC EDGAR + PySpark RDD)", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

edgar = EdgarClient()
storage = Storage()
jobs: dict[str, IngestStatus] = {}

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


# --------------------------------------------------------------------------
# PySpark RDD pipeline
# --------------------------------------------------------------------------


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
# Legacy Supabase ingest (kept available when SUPABASE_* is configured)
# --------------------------------------------------------------------------


@app.post("/ingest/company")
async def ingest_company(req: IngestRequest):
    if not storage.enabled:
        raise HTTPException(
            status_code=503,
            detail=(
                "Supabase is not configured. Use POST /spark/run for the local "
                "Spark pipeline, or configure SUPABASE_URL/SUPABASE_SERVICE_KEY."
            ),
        )

    job_id = str(uuid.uuid4())
    status = IngestStatus(job_id=job_id, status="pending", ticker=req.ticker)
    jobs[job_id] = status

    company = await edgar.resolve_company(req.ticker)
    if not company:
        raise HTTPException(status_code=404, detail=f"Company {req.ticker} not found")

    company_id = await storage.upsert_company(company)
    status.status = "running"

    filings = await edgar.get_filings(company.cik, req.filing_types, req.max_filings)
    status.filings_found = len(filings)

    for filing in filings:
        try:
            html = await edgar.fetch_filing_html(filing.source_url)
            if not html:
                continue

            sections = extract_sections(html)
            clean = clean_html(html)
            filing_id = await storage.upsert_filing(company_id, filing, sections, clean)

            all_chunks = chunk_sections(sections)
            await storage.upsert_chunks(filing_id, all_chunks)
            status.filings_ingested += 1
        except Exception as e:
            status.error = str(e)

    status.status = "completed"
    return {"job_id": job_id, "status": status.model_dump()}


@app.get("/ingest/status/{job_id}")
async def ingest_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return jobs[job_id].model_dump()


@app.get("/ingest/companies")
async def list_companies():
    """Local curated companies first, then Supabase when configured."""
    local_path = curated_dir() / "companies.json"
    if local_path.exists():
        return {"companies": json.loads(local_path.read_text(encoding="utf-8"))}
    return {"companies": []}
