from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .models import IngestStatus
from .storage import atomic_write_json, data_dir


_JOB_LOCK = threading.RLock()
_TERMINAL_STATUSES = {"completed", "failed"}
_ALLOWED_TRANSITIONS = {
    "queued": {"running", "failed"},
    "running": {"completed", "failed"},
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class IngestJobStore:
    def __init__(self, data_root: Optional[Path] = None):
        root = Path(data_root) if data_root is not None else data_dir()
        self.jobs_dir = root / "ingestion" / "jobs"
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
        self._recover_interrupted_jobs()

    def _path(self, job_id: str) -> Optional[Path]:
        try:
            canonical_id = str(uuid.UUID(job_id))
        except (ValueError, AttributeError):
            return None
        return self.jobs_dir / f"{canonical_id}.json"

    def _read(self, path: Path) -> IngestStatus:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            return IngestStatus.model_validate(payload)
        except (OSError, json.JSONDecodeError, ValueError) as exc:
            raise RuntimeError(f"Could not read ingestion job {path}: {exc}") from exc

    def _write(self, job: IngestStatus) -> None:
        path = self._path(job.job_id)
        if path is None:
            raise ValueError(f"Invalid ingestion job ID: {job.job_id}")
        atomic_write_json(path, job.model_dump(mode="json"))

    def _recover_interrupted_jobs(self) -> None:
        with _JOB_LOCK:
            for path in self.jobs_dir.glob("*.json"):
                job = self._read(path)
                if job.status in {"queued", "running"}:
                    recovered = IngestStatus.model_validate(
                        {
                            **job.model_dump(),
                            "status": "failed",
                            "error": "Ingestion interrupted by service restart.",
                            "finished_at": _now(),
                        }
                    )
                    self._write(recovered)

    def create(self, ticker: str) -> IngestStatus:
        job = IngestStatus(
            job_id=str(uuid.uuid4()),
            status="queued",
            ticker=ticker.upper(),
            queued_at=_now(),
        )
        with _JOB_LOCK:
            self._write(job)
        return job

    def update(self, job_id: str, **changes) -> IngestStatus:
        with _JOB_LOCK:
            job = self.get(job_id)
            if job is None:
                raise KeyError(f"Ingestion job not found: {job_id}")
            if job.status in _TERMINAL_STATUSES:
                raise ValueError(f"Ingestion job {job_id} is already terminal")

            allowed_fields = set(IngestStatus.model_fields) - {
                "job_id",
                "ticker",
            }
            unknown_fields = set(changes) - allowed_fields
            if unknown_fields:
                raise ValueError(
                    f"Unsupported ingestion job fields: {sorted(unknown_fields)}"
                )

            next_status = changes.get("status", job.status)
            if next_status != job.status and next_status not in _ALLOWED_TRANSITIONS[job.status]:
                raise ValueError(
                    f"Invalid ingestion job transition: {job.status} -> {next_status}"
                )

            updated = IngestStatus.model_validate(
                {**job.model_dump(), **changes, "job_id": job.job_id, "ticker": job.ticker}
            )
            if updated.filings_ingested > updated.filings_found:
                raise ValueError("Ingested filing count cannot exceed filings found")
            self._write(updated)
            return updated

    def get(self, job_id: str) -> Optional[IngestStatus]:
        path = self._path(job_id)
        if path is None or not path.exists():
            return None
        with _JOB_LOCK:
            return self._read(path)
