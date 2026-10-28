# Railway build for the FastAPI gateway.
#
# Build context MUST be the repository root so the image can bundle the latest
# curated artifacts as a no-database fallback:
#   Root Directory:      /            (repository root)
#   Config file path:    railway.json
#   Dockerfile path:     infra/railway/api-gateway.Dockerfile
#
# Set INGESTION_US_URL to the private URL of the Spark service, e.g.
#   http://anomaly-ingestion-us.railway.internal:8001
# and CORS_ORIGINS to the Vercel production/preview domains.

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    ANOMALY_DATA_DIR=/app/data

WORKDIR /app

COPY services/api-gateway/requirements.txt ./requirements.txt
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY services/api-gateway/ ./
COPY data/curated/latest ./data/curated/latest

EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
