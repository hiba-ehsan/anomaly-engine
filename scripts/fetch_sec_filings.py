"""Fetch real SEC EDGAR filings into a local raw snapshot for the Spark job.

Usage (PowerShell, from the repository root):

    services\\ingestion-us\\venv\\Scripts\\python.exe scripts\\fetch_sec_filings.py `
        --tickers AAPL MSFT --tickers-filings 2 --max-10q 1

The output is intentionally plain JSON so the PySpark RDD pipeline can read it
without a database.  Existing files are skipped, which makes the script safe to
re-run when a download was interrupted.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "services" / "ingestion-us"))

from app.edgar_client import EdgarClient  # noqa: E402
from app.xbrl_parser import clean_html, extract_sections  # noqa: E402


def raw_dir() -> Path:
    import os

    return Path(os.getenv("ANOMALY_RAW_DIR", REPO_ROOT / "data" / "raw" / "filings"))


async def fetch_one(edgar: EdgarClient, company, filing, out_dir: Path) -> dict | None:
    target = out_dir / company.ticker / f"{filing.accession_number}.json"
    if target.exists():
        try:
            existing = json.loads(target.read_text(encoding="utf-8"))
            if existing.get("sections"):
                print(f"  = cached {company.ticker} {filing.filing_type} {filing.filing_date}")
                return existing
        except Exception:
            pass

    if not filing.source_url:
        return None

    html = await edgar.fetch_filing_html(filing.source_url)
    if not html:
        print(f"  ! download failed {company.ticker} {filing.filing_type} {filing.filing_date}")
        return None

    sections = extract_sections(html)
    clean_text = clean_html(html)

    record = {
        "ticker": company.ticker,
        "cik": company.cik,
        "company_name": company.name,
        "filing_type": filing.filing_type,
        "filing_date": filing.filing_date.isoformat(),
        "period_of_report": filing.period_of_report.isoformat() if filing.period_of_report else None,
        "accession_number": filing.accession_number,
        "source_url": filing.source_url,
        "sections": sections,
        "clean_text": clean_text,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "html_bytes": len(html),
    }

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(record), encoding="utf-8")
    print(
        f"  + {company.ticker} {filing.filing_type} {filing.filing_date} "
        f"({len(sections)} sections, {len(clean_text):,} chars, {len(html) / 1e6:.1f} MB html)"
    )
    return record


async def main_async(args: argparse.Namespace) -> int:
    edgar = EdgarClient()
    out_dir = raw_dir()
    records: list[dict] = []
    try:
        for ticker in args.tickers:
            company = await edgar.resolve_company(ticker)
            if not company:
                print(f"! unknown ticker {ticker}")
                continue
            print(f"* {company.ticker} ({company.name}, CIK {company.cik})")
            requests = [("10-K", args.max_10k), ("10-Q", args.max_10q)]
            for filing_type, limit in requests:
                if limit <= 0:
                    continue
                filings = await edgar.get_filings(company.cik, [filing_type], limit)
                for filing in filings[:limit]:
                    try:
                        record = await fetch_one(edgar, company, filing, out_dir)
                    except Exception as exc:  # keep going on a single bad document
                        print(f"  ! {type(exc).__name__}: {exc}")
                        record = None
                    if record:
                        records.append(record)
                    await asyncio.sleep(0.15)
    finally:
        await edgar.close()

    manifest_path = out_dir / "manifest.json"
    if records:
        existing: list[dict] = []
        if manifest_path.exists():
            try:
                existing = json.loads(manifest_path.read_text(encoding="utf-8"))
            except Exception:
                existing = []
        keyed = {(r["accession_number"], r["ticker"]): r for r in existing}
        for record in records:
            keyed[(record["accession_number"], record["ticker"])] = record
        manifest = sorted(
            [
                {
                    "ticker": r["ticker"],
                    "filing_type": r["filing_type"],
                    "filing_date": r["filing_date"],
                    "accession_number": r["accession_number"],
                    "sections": sorted(r.get("sections", {}).keys()),
                }
                for r in keyed.values()
            ],
            key=lambda r: (r["ticker"], r["filing_date"]),
            reverse=True,
        )
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    total = len(list(out_dir.glob("*/*.json")))
    print(f"\nSnapshot contains {total} filing JSON files under {out_dir}")
    return 0 if total else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tickers", nargs="+", default=["AAPL", "MSFT"])
    parser.add_argument("--max-10k", type=int, default=2)
    parser.add_argument("--max-10q", type=int, default=1)
    args = parser.parse_args()
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    raise SystemExit(main())
