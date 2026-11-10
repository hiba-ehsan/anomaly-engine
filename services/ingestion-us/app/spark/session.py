"""Builds one small local Spark session for a job."""

from __future__ import annotations
from pyspark.sql import SparkSession

import importlib.util
import os
import sys
from pathlib import Path


def _prepare_environment() -> None:
    os.environ["PYSPARK_PYTHON"] = sys.executable
    os.environ["PYSPARK_DRIVER_PYTHON"] = sys.executable
    os.environ.setdefault("SPARK_LOCAL_IP", "127.0.0.1")

    # point SPARK_HOME straight at the installed pyspark, faster and safer
    spec = importlib.util.find_spec("pyspark")
    if spec and spec.submodule_search_locations:
        os.environ.setdefault("SPARK_HOME", str(list(spec.submodule_search_locations)[0]))

    # Hadoop on Windows needs winutils.exe; the repo keeps a copy in infra/hadoop
    parents = Path(__file__).resolve().parents
    repo_root = parents[4] if len(parents) > 4 else parents[2]
    hadoop_home = Path(os.getenv("HADOOP_HOME", repo_root / "infra" / "hadoop"))
    if (hadoop_home / "bin" / "winutils.exe").exists():
        os.environ["HADOOP_HOME"] = str(hadoop_home)
        os.environ["hadoop.home.dir"] = str(hadoop_home)
        os.environ["PATH"] = f"{hadoop_home / 'bin'}{os.pathsep}{os.environ.get('PATH', '')}"


_prepare_environment()


def build_session(app_name: str = "anomaly-engine-sec-rdd") -> SparkSession:
    # create (or reuse) the local session. The defaults are small on purpose:
    # the corpus is a few MB, and bigger settings ran this laptop out of memory.
    # Override with SPARK_MASTER / SPARK_DRIVER_MEMORY on a larger machine.
    master = os.getenv("SPARK_MASTER", "local[1]")
    driver_memory = os.getenv("SPARK_DRIVER_MEMORY", "512m")
    parallelism = os.getenv("SPARK_PARALLELISM", "1")

    # keep the JVM's own memory small too (metaspace, compiler, threads)
    java_options = os.getenv(
        "SPARK_DRIVER_JAVA_OPTIONS",
        "-XX:MaxMetaspaceSize=160m -XX:ReservedCodeCacheSize=48m "
        "-XX:TieredStopAtLevel=1 -Xss1m",
    )

    parents = Path(__file__).resolve().parents
    repo_root = parents[4] if len(parents) > 4 else parents[2]
    local_dir = Path(os.getenv("SPARK_LOCAL_DIR") or str(repo_root / ".spark-tmp"))
    try:
        local_dir.mkdir(parents=True, exist_ok=True)
        local_dir_value = str(local_dir)
    except OSError:
        local_dir_value = os.getenv("TEMP", ".")

    builder = (
        SparkSession.builder.appName(app_name)
        .master(master)
        .config("spark.driver.memory", driver_memory)
        .config("spark.driver.extraJavaOptions", java_options)
        .config("spark.driver.host", "127.0.0.1")
        .config("spark.driver.bindAddress", "127.0.0.1")
        .config("spark.driver.maxResultSize", "128m")
        .config("spark.local.dir", local_dir_value)
        .config("spark.ui.enabled", "false")
        .config("spark.sql.shuffle.partitions", parallelism)
        .config("spark.sql.adaptive.enabled", "false")
        .config("spark.sql.parquet.compression.codec", "snappy")
        .config("spark.serializer", "org.apache.spark.serializer.KryoSerializer")
        .config("spark.default.parallelism", parallelism)
        .config("spark.sql.execution.arrow.pyspark.enabled", "false")
        .config("spark.python.worker.reuse", "true")
        .config("spark.python.worker.memory", "256m")
        .config("spark.memory.fraction", "0.5")
        .config("spark.memory.storageFraction", "0.3")
    )

    spark_home = os.getenv("SPARK_HOME")
    if spark_home and Path(spark_home).exists():
        builder = builder.config("spark.home", spark_home)

    return builder.getOrCreate()
