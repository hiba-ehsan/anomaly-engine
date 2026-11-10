export interface Company {
  id: string;
  ticker: string;
  cik?: string;
  name: string;
  jurisdiction: string;
  sector?: string;
  created_at: string;
}

export interface IngestJob {
  job_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  ticker: string;
  filings_found: number;
  filings_ingested: number;
  error?: string | null;
  warnings?: string[];
  queued_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface Filing {
  id: string;
  company_id: string;
  filing_type: string;
  filing_date: string;
  accession_number?: string;
  period_of_report?: string;
  source_url?: string;
  sections?: Record<string, string>;
  metadata?: Record<string, any>;
  ingested_at: string;
}

export interface FilingChunk {
  id: string;
  filing_id: string;
  section_type?: string;
  chunk_index: number;
  text: string;
  token_count: number;
  created_at: string;
}

export interface SentimentScore {
  positive: number;
  negative: number;
  neutral: number;
}

export interface AttentionMatrix {
  layers: number[][][];
}

export interface ChunkSentiment {
  chunk_id: string;
  sentiment: SentimentScore;
  attention?: AttentionMatrix;
}

export interface AnomalySignal {
  id: string;
  company_id: string;
  ticker?: string;
  signal_type: 'cross_section' | 'temporal_shift' | 'attention_drift';
  score: number;
  filing_a_id: string;
  filing_b_id: string;
  section_a?: string;
  section_b?: string;
  rank?: number;
  severity?: 'low' | 'medium' | 'high' | string;
  details?: {
    cosine_distance?: number;
    js_divergence?: number;
    kl_divergence?: number;
    entropy_delta?: number;
    entropy?: number;
    terms_added?: [string, number][];
    terms_removed?: [string, number][];
    key_sentences?: string[];
  };
  detected_at: string;
  /** Date of the filing this flag refers to, when the backend supplies it. */
  filing_date?: string;
}

export interface PriceHistory {
  id: string;
  company_id: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjusted_close: number;
  source: string;
}

export interface BacktestResult {
  id: string;
  signal_id: string;
  car_30d?: number;
  car_60d?: number;
  car_90d?: number;
  volatility_before?: number;
  volatility_after?: number;
  xgboost_prediction?: number;
  xgboost_confidence?: number;
  created_at: string;
}

export interface SearchResult {
  chunk_id: string;
  text: string;
  company_ticker: string;
  filing_type: string;
  filing_date: string;
  similarity: number;
}

export interface CandlestickData {
  time: number | string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface AnomalyMarker {
  time: number | string;
  position: 'aboveBar' | 'belowBar';
  color: string;
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
  text: string;
}