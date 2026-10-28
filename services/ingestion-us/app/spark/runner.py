"""CLI runner for the PySpark RDD pipeline.

    python -m app.spark.runner --tickers AAPL MSFT
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

from .pipeline import DEFAULT_DATA_DIR, run_pipeline
from .session import build_session


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tickers", nargs="*", default=None)
    parser.add_argument("--raw-dir", type=Path, default=None)
    parser.add_argument("--data-dir", type=Path, default=None)
    args = parser.parse_args()

    spark = build_session("anomaly-engine-sec-rdd-cli")
    try:
        summary = run_pipeline(
            tickers=args.tickers,
            raw_dir=args.raw_dir,
            data_dir=args.data_dir or DEFAULT_DATA_DIR,
            spark=spark,
        )
    finally:
        spark.stop()

    print(
        json.dumps(
            {
                "run_id": summary["run_id"],
                "duration_seconds": summary["duration_seconds"],
                "counts": summary["counts"],
                "benchmark": summary["benchmark"],
                "artifacts": summary["artifacts"],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
