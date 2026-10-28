from celery import chain, group
from app.celery_app import celery


@celery.task(name="pipeline.run_full_pipeline", bind=True, max_retries=2, default_retry_delay=300)
def run_full_pipeline(self, ticker: str, filing_types: list = None, max_filings: int = 10):
    """
    Run the complete Anomaly Engine pipeline for a ticker:
    1. Ingest SEC filings + market data
    2. Analyze filings with FinBERT (sentiment, embeddings)
    3. Compute divergence signals between filings
    4. Run backtest on detected signals
    """
    if filing_types is None:
        filing_types = ["10-K", "10-Q", "8-K"]
    
    # Step 1: Full ingestion (SEC + market + news)
    from app.tasks.ingest_tasks import full_ingest
    ingest_result = full_ingest(ticker=ticker, filing_types=filing_types, max_filings=max_filings)
    
    # Step 2: Wait for ingestion, then compute divergences
    from app.tasks.nlp_tasks import compute_all_divergences
    
    # Step 3: Backtest on signals
    from app.tasks.backtest_tasks import run_backtest_for_all_signals
    
    # Chain the pipeline
    pipeline = chain(
        # Ingest everything
        full_ingest.s(ticker, filing_types, max_filings),
        # Analyze all filings for divergence
        compute_all_divergences.s(),
        # Backtest on detected signals
        run_backtest_for_all_signals.s(),
    )
    
    result = pipeline.apply_async()
    return {
        "ticker": ticker,
        "pipeline_job_id": result.id,
        "status": "started",
    }


@celery.task(name="pipeline.daily_update", bind=True)
def daily_update(self):
    """
    Scheduled task to run daily: update prices, news, and re-analyze for all tracked companies.
    """
    from supabase import create_client
    import os
    
    SUPABASE_URL = os.getenv("SUPABASE_URL")
    SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY")
    
    from supabase import create_client
    supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY"))
    
    # Get all tracked companies
    companies = supabase.table("companies").select("ticker").execute()
    
    if not companies.data:
        return {"status": "completed", "companies_updated": 0}
    
    # Update each company (in parallel)
    from app.tasks.ingest_tasks import full_ingest
    from app.tasks.nlp_tasks import compute_all_divergences
    from app.tasks.backtest_tasks import run_backtest_for_all_signals
    
    tasks = []
    for company in companies.data:
        ticker = company["ticker"]
        # Chain: ingest → analyze → backtest
        from celery import chain
        from app.tasks.ingest_tasks import full_ingest
        from app.tasks.nlp_tasks import compute_all_divergences
        from app.tasks.backtest_tasks import run_backtest_for_all_signals
        
        pipeline = chain(
            full_ingest.s(ticker, ["10-K", "10-Q", "8-K"], 5),
            compute_all_divergences.s(),
            run_backtest_for_all_signals.s(),
        )
        tasks.append(pipeline.s())
    
    # Run all companies in parallel
    if tasks:
        group(tasks).apply_async()
    
    return {"status": "started", "companies_queued": len(companies.data)}


@celery.task(name="pipeline.weekly_deep_analysis", bind=True)
def weekly_deep_analysis(self):
    """
    Weekly task: deep analysis with max filings, full backtest retraining.
    """
    from supabase import create_client
    import os
    
    from supabase import create_client
    supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY"))
    
    companies = supabase.table("companies").select("ticker").execute()
    
    from app.tasks.ingest_tasks import full_ingest
    from app.tasks.nlp_tasks import compute_all_divergences
    from app.tasks.backtest_tasks import run_backtest_for_all_signals
    
    tasks = []
    for company in companies.data:
        ticker = company["ticker"]
        from celery import chain
        from app.tasks.ingest_tasks import full_ingest
        from app.tasks.nlp_tasks import compute_all_divergences
        from app.tasks.backtest_tasks import run_backtest_for_all_signals
        
        pipeline = chain(
            full_ingest.s(ticker, ["10-K", "10-Q", "8-K"], 20),  # More filings
            compute_all_divergences.s(),
            run_backtest_for_all_signals.s(),
        )
        tasks.append(pipeline.s())
    
    if tasks:
        group(tasks).apply_async()
    
    return {"status": "started", "companies_queued": len(companies.data)}