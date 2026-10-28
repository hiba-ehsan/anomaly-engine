-- Companies master table
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker TEXT UNIQUE NOT NULL,
    cik TEXT,
    name TEXT NOT NULL,
    jurisdiction TEXT NOT NULL DEFAULT 'US',
    sector TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Filings (one row per document)
CREATE TABLE IF NOT EXISTS filings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    filing_type TEXT NOT NULL,
    filing_date DATE NOT NULL,
    accession_number TEXT,
    period_of_report DATE,
    source_url TEXT,
    raw_html TEXT,
    clean_text TEXT,
    sections JSONB,
    metadata JSONB,
    ingested_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(company_id, filing_type, filing_date)
);

CREATE INDEX idx_filings_company_id ON filings(company_id);
CREATE INDEX idx_filings_filing_type ON filings(filing_type);
CREATE INDEX idx_filings_filing_date ON filings(filing_date);

-- Filing chunks (sentence/paragraph level)
CREATE TABLE IF NOT EXISTS filing_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filing_id UUID REFERENCES filings(id) ON DELETE CASCADE,
    section_type TEXT,
    chunk_index INT,
    text TEXT NOT NULL,
    token_count INT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_filing_chunks_filing_id ON filing_chunks(filing_id);

-- Embeddings (pgvector)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id UUID REFERENCES filing_chunks(id) ON DELETE CASCADE,
    model_version TEXT DEFAULT 'finbert-base',
    embedding VECTOR(768),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_embeddings_chunk_id ON embeddings(chunk_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw ON embeddings USING hnsw (embedding vector_cosine_ops);

-- Sentiment analysis results
CREATE TABLE IF NOT EXISTS sentiment_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id UUID REFERENCES filing_chunks(id) ON DELETE CASCADE,
    positive FLOAT NOT NULL,
    negative FLOAT NOT NULL,
    neutral FLOAT NOT NULL,
    attention_weights JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sentiment_scores_chunk_id ON sentiment_scores(chunk_id);

-- Anomaly signals
CREATE TABLE IF NOT EXISTS anomaly_signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    signal_type TEXT NOT NULL,
    score FLOAT NOT NULL,
    filing_a_id UUID REFERENCES filings(id),
    filing_b_id UUID REFERENCES filings(id),
    details JSONB,
    detected_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_anomaly_signals_company_id ON anomaly_signals(company_id);
CREATE INDEX idx_anomaly_signals_score ON anomaly_signals(score DESC);

-- Price history
CREATE TABLE IF NOT EXISTS price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    open FLOAT,
    high FLOAT,
    low FLOAT,
    close FLOAT,
    volume BIGINT,
    adjusted_close FLOAT,
    source TEXT DEFAULT 'yfinance',
    UNIQUE(company_id, date)
);

CREATE INDEX idx_price_history_company_date ON price_history(company_id, date);

-- Backtest results
CREATE TABLE IF NOT EXISTS backtest_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_id UUID REFERENCES anomaly_signals(id) ON DELETE CASCADE,
    car_30d FLOAT,
    car_60d FLOAT,
    car_90d FLOAT,
    volatility_before FLOAT,
    volatility_after FLOAT,
    xgboost_prediction FLOAT,
    xgboost_confidence FLOAT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_backtest_results_signal_id ON backtest_results(signal_id);

-- RPC function for fast cosine similarity search
CREATE OR REPLACE FUNCTION match_embeddings(
    query_embedding VECTOR(768),
    match_count INT DEFAULT 10,
    match_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
    chunk_id UUID,
    text TEXT,
    company_ticker TEXT,
    filing_type TEXT,
    filing_date DATE,
    similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        fc.id AS chunk_id,
        fc.text,
        c.ticker AS company_ticker,
        f.filing_type,
        f.filing_date,
        1 - (e.embedding <=> query_embedding) AS similarity
    FROM embeddings e
    JOIN filing_chunks fc ON fc.id = e.chunk_id
    JOIN filings f ON f.id = fc.filing_id
    JOIN companies c ON c.id = f.company_id
    WHERE 1 - (e.embedding <=> query_embedding) > match_threshold
    ORDER BY e.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
