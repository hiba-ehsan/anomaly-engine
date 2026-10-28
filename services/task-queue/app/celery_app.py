from celery import Celery
import os

celery = Celery(
    "anomaly_engine",
    broker=os.getenv("REDIS_URL", "redis://redis:6379/0"),
    backend=os.getenv("REDIS_URL", "redis://redis:6379/0"),
    include=[
        "app.tasks.ingest_tasks",
        "app.tasks.nlp_tasks",
        "app.tasks.backtest_tasks",
        "app.tasks.pipeline_tasks",
    ],
)

celery.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_routes={
        "app.tasks.ingest_tasks.*": {"queue": "ingestion"},
        "app.tasks.nlp_tasks.*": {"queue": "nlp"},
        "app.tasks.backtest_tasks.*": {"queue": "backtest"},
        "app.tasks.pipeline_tasks.*": {"queue": "pipeline"},
    },
)
