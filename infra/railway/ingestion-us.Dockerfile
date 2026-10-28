# Railway build for the PySpark ingestion service.
#
# Build context MUST be the repository root, because the image ships the SEC
# snapshot (data/raw) and the latest curated artifacts.  On Railway:
#   Root Directory:      /            (repository root)
#   Config file path:    railway.ingestion.json
#   Dockerfile path:     infra/railway/ingestion-us.Dockerfile
#
# Spark needs ~1 GB of headroom.  Use a Railway plan with at least 1 GB RAM;
# 2 GB is comfortable.  SPARK_DRIVER_MEMORY is deliberately small because the
# demo corpus is only ~2 MB of filings.

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 \
    ANOMALY_DATA_DIR=/app/data \
    SPARK_HOME=/usr/local/lib/python3.11/site-packages/pyspark \
    SPARK_LOCAL_DIR=/tmp/spark \
    SPARK_MASTER=local[1] \
    SPARK_PARALLELISM=1 \
    SPARK_DRIVER_MEMORY=512m

# Java is required by Spark.  procps gives the JVM `ps`; bash is used by the
# pyspark launcher scripts.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        openjdk-17-jre-headless bash procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY services/ingestion-us/requirements.txt ./requirements.txt
RUN pip install --upgrade pip \
    && pip install -r requirements.txt \
    && python -m spacy download en_core_web_sm

COPY services/ingestion-us/ ./
COPY data/raw ./data/raw
COPY data/curated/latest ./data/curated/latest

RUN mkdir -p /app/data/curated/runs /tmp/spark

EXPOSE 8001

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8001}"]
