FROM python:3.11-slim AS base
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["celery", "-A", "app.celery_app:celery", "worker", "--loglevel=info", "--concurrency=2"]

FROM base AS development
CMD ["celery", "-A", "app.celery_app:celery", "worker", "--loglevel=debug", "--concurrency=1", "--autoscale=1,0"]
