"""Opt-in smoke test that proves a Spark RDD action really runs.

Enable with:

    RUN_SPARK_TESTS=1 pytest services/ingestion-us/tests/test_spark_smoke.py -q

The API itself always runs Spark in a subprocess, so this is the only test that
pays the JVM startup cost.
"""

from __future__ import annotations

import os

import pytest

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_SPARK_TESTS") != "1",
    reason="set RUN_SPARK_TESTS=1 to start a local JVM",
)


def test_reduce_by_key_action():
    from app.spark.session import build_session

    spark = build_session("anomaly-engine-pytest")
    try:
        rdd = spark.sparkContext.parallelize(
            [("aapl", 1), ("aapl", 2), ("msft", 3), ("msft", 4)], 2
        )
        totals = dict(rdd.reduceByKey(lambda left, right: left + right).collect())
        assert totals == {"aapl": 3, "msft": 7}
    finally:
        spark.stop()
