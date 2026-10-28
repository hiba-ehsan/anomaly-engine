FROM python:3.11-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 \
    ANOMALY_DATA_DIR=/app/data \
    SPARK_LOCAL_DIR=/tmp/spark \
    SPARK_MASTER=local[1] \
    SPARK_PARALLELISM=1 \
    SPARK_DRIVER_MEMORY=512m

# Java is required by Spark; bash/procps are used by the pyspark launcher.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        openjdk-17-jre-headless bash procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && python -m spacy download en_core_web_sm
COPY . .
RUN mkdir -p /app/data/curated/runs /tmp/spark
EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]

FROM base AS development
RUN pip install --no-cache-dir watchdog[watchmedo]
CMD ["watchmedo", "auto-restart", "--pattern=*.py", "--recursive", "--", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--reload"]
