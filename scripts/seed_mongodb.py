"""Seed MongoDB (anomaly_engine) with real AAPL 10-K filings + engine manifests.

Native Windows, additive: reads the two real AAPL 10-Ks that ingestion-us already
persisted (either via the live gateway API or directly from SEC EDGAR), and writes
them into MongoDB as the raw document + chunk store (the "M" in MERN).

Idempotent: upserts by accession number. Supabase/Python core untouched.
"""

from __future__ import annotations

import argparse
import os
import sys

try:
    from pymongo import MongoClient
except ImportError:
    sys.exit("pymongo not installed. Run: python -m pip install pymongo")

MONGO_URI = os.getenv("MONGODB_URI", "mongodb://127.0.0.1:27017/anomaly_engine")
DB_NAME = "anomaly_engine"

# Two real AAPL 10-Ks already persisted by ingestion-us (verified earlier).
# accession -> (filing date, document name)
AAPL_FILINGS = {
    "0000320193-25-000079": ("2025-10-31", "aapl-20250927.htm"),
    "0000320193-24-000123": ("2024-11-01", "aapl-20240928.htm"),
}


def load_config() -> dict:
    cfg = {}
    env_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"
    )
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                cfg[k.strip()] = v.strip().strip('"').strip("'")
    return cfg


def fetch_from_gateway(accession: str | None = None) -> bool:
    """Pull AAPL filings from the live gateway API (preferred when up)."""
    import json
    import urllib.request

    url = "http://127.0.0.1:8000/api/v1/filings?ticker=AAPL&limit=50"
    if accession:
        url += f"&accession={accession}"
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            payload = json.loads(r.read().decode("utf-8"))
        filings = payload.get("filings", []) if isinstance(payload, dict) else payload
        if not filings:
            return False
        for f in filings:
            f["_collection"] = "filings"
        client = MongoClient(MONGO_URI)
        coll = client[DB_NAME]["filings"]
        coll.delete_many({"ticker": "AAPL"})
        for f in filings:
            coll.update_one(
                {"accession": f["accession"], "ticker": "AAPL"},
                {"$set": f},
                upsert=True,
            )
        client.close()
        print(f"[gateway] seeded {len(filings)} AAPL filing docs into mongo")
        return True
    except Exception as e:  # pragma: no cover - network fallback path
        print(f"[gateway] unavailable ({e}); falling back to direct SEC fetch")
        return False


def fetch_direct_from_sec() -> int:
    """Fallback: download the real (already-stripped-dash) 10-K HTML from SEC EDGAR."""
    import re
    import requests  # type: ignore

    headers = {
        "User-Agent": os.getenv(
            "EDGAR_USER_AGENT", "AnomalyEngine/1.0 (research@example.com)"
        ),
        "Accept-Encoding": "gzip",
    }
    client = MongoClient(MONGO_URI)
    db = client[DB_NAME]
    seeded = 0
    for accn, (fdate, doc_name) in AAPL_FILINGS.items():
        stripped = accn.replace("-", "")
        url = (
            f"https://www.sec.gov/Archives/edgar/data/320193/"
            f"{stripped}/{doc_name}"
        )
        r = requests.get(url, headers=headers, timeout=60)
        if r.status_code != 200:
            print(f"[sec] {accn} -> HTTP {r.status_code}, skipping")
            continue
        text = r.text
        clean = re.sub(r"<[^>]+>", " ", text)
        clean = re.sub(r"\s+", " ", clean).strip()[:200_000]
        doc = {
            "ticker": "AAPL",
            "accession": accn,
            "filing_date": fdate,
            "document": doc_name,
            "source_url": url,
            "status": "OK",
            "size_bytes": len(text),
            "text_preview": clean[:500],
            "raw_html": text,  # full raw payload (the M in MERN)
        }
        db["raw_filings"].update_one(
            {"accession": accn}, {"$set": doc}, upsert=True
        )
        seeded += 1
        print(f"[sec] {accn} ({doc_name}) -> raw_filings, {len(text):,} bytes")
    client.close()
    return seeded


def ensure_manifest() -> None:
    from datetime import datetime, timezone

    client = MongoClient(MONGO_URI)
    db = client[DB_NAME]
    db["engine_meta"].update_one(
        {"_id": "manifest"},
        {
            "$set": {
                "engine": "Anomaly Engine",
                "stack": ["MongoDB", "Express/Node", "React/Next.js", "Python core"],
                "seeded_at": datetime.now(timezone.utc).isoformat(),
                "tickers": ["AAPL", "MSFT", "NVDA"],
                "status": "MERN journal online",
            }
        },
        upsert=True,
    )
    print(
        f"[manifest] collections now: {sorted(db.list_collection_names())}"
    )
    client.close()


def main() -> int:
    ap = argparse.ArgumentParser(description="Seed MongoDB with real AAPL data")
    ap.add_argument("--fallback", action="store_true", help="force direct SEC fetch")
    args = ap.parse_args()

    if not args.fallback and fetch_from_gateway():
        pass
    else:
        fetch_direct_from_sec()

    ensure_manifest()
    return 0


if __name__ == "__main__":
    sys.exit(main())
