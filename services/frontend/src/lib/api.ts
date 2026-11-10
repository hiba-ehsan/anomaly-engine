import type {
  Company,
  IngestJob,
  Filing,
  FilingChunk,
  SentimentScore,
  AttentionMatrix,
  ChunkSentiment,
  AnomalySignal,
  PriceHistory,
  BacktestResult,
  SearchResult,
  CandlestickData,
  AnomalyMarker,
} from '@/types';
import { API_ORIGIN, apiUrl } from '@/lib/config';

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      ...options,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ApiError(
      0,
      `Cannot reach the API at ${API_ORIGIN}. Check that the gateway is running and reachable, then retry. (${detail})`
    );
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
    throw new ApiError(res.status, err.detail || res.statusText);
  }

  return res.json();
}

export const api = {
  // Companies
  companies: {
    list: (limit = 100, offset = 0) =>
      fetchJson<{ companies: Company[]; total: number }>(
        `/companies?limit=${limit}&offset=${offset}`
      ),
    get: (ticker: string) => fetchJson<Company>(`/companies/${ticker}`),
    ingest: (ticker: string, data: { filing_types?: string[]; max_filings?: number; start_date?: string; end_date?: string }) =>
      fetchJson<IngestJob>(`/companies/${encodeURIComponent(ticker)}/ingest`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    ingestStatus: (jobId: string) =>
      fetchJson<IngestJob>(`/companies/ingest/status/${encodeURIComponent(jobId)}`),
  },

  // Filings
  filings: {
    list: (params: { ticker?: string; filing_type?: string; limit?: number; offset?: number }) => {
      const qs = new URLSearchParams();
      if (params.ticker) qs.set('ticker', params.ticker);
      if (params.filing_type) qs.set('filing_type', params.filing_type);
      if (params.limit) qs.set('limit', params.limit.toString());
      if (params.offset) qs.set('offset', params.offset.toString());
      return fetchJson<{ filings: Filing[]; total: number }>(`/filings?${qs}`);
    },
    get: (id: string) => fetchJson<Filing>(`/filings/${id}`),
    chunks: (id: string) => fetchJson<{ chunks: FilingChunk[]; total: number }>(`/filings/${id}/chunks`),
    sentiment: (id: string) => fetchJson<{ scores: any[]; total: number }>(`/filings/${id}/sentiment`),
  },

  // Anomalies
  anomalies: {
    list: (params: { ticker?: string; signal_type?: string; min_score?: number; limit?: number; offset?: number }) => {
      const qs = new URLSearchParams();
      if (params.ticker) qs.set('ticker', params.ticker);
      if (params.signal_type) qs.set('signal_type', params.signal_type);
      if (params.min_score !== undefined) qs.set('min_score', params.min_score.toString());
      if (params.limit) qs.set('limit', params.limit.toString());
      if (params.offset) qs.set('offset', params.offset.toString());
      return fetchJson<{ signals: AnomalySignal[]; total: number }>(`/anomalies?${qs}`);
    },
    get: (id: string) => fetchJson<AnomalySignal>(`/anomalies/${id}`),
    analyze: (ticker: string) =>
      fetchJson<any>(`/anomalies/analyze/${ticker}`, { method: 'POST' }),
  },

  // PySpark RDD pipeline
  pipeline: {
    latest: () => fetchJson<any>('/pipeline/latest'),
    run: (tickers?: string[], wait = false) =>
      fetchJson<any>('/pipeline/run', {
        method: 'POST',
        body: JSON.stringify({ tickers, wait }),
      }),
    status: (jobId: string) => fetchJson<any>(`/pipeline/status/${jobId}`),
    raw: () => fetchJson<{ files: any[]; total: number }>('/pipeline/raw'),
  },

  // Search
  search: {
    similar: (embedding: number[], count = 10, threshold = 0.7) =>
      fetchJson<{ results: SearchResult[]; total: number }>('/search/similar', {
        method: 'POST',
        body: JSON.stringify({ query_embedding: embedding, match_count: count, match_threshold: threshold }),
      }),
  },

  // Backtest
  backtest: {
    get: (ticker: string) => fetchJson<any>(`/backtest/${ticker}`),
    run: (ticker: string) => fetchJson<any>(`/backtest/run/${ticker}`, { method: 'POST' }),
  },

  // Market data
  market: {
    prices: (ticker: string, limit = 500) =>
      fetchJson<{ prices: any[]; total: number }>(`/market/${ticker}/prices?limit=${limit}`),
    news: (ticker: string, days_back = 30) =>
      fetchJson<any>(`/market/${ticker}/news?days_back=${days_back}`),
    quote: (ticker: string) => fetchJson<any>(`/market/${ticker}/quote`),
  },

  // Health (gateway root, not under /api/v1)
  health: () => fetchJson<{ status: string; service: string; dependencies: Record<string, boolean> }>('/health'),
};

// Re-export types
export type {
  Company,
  IngestJob,
  Filing,
  FilingChunk,
  SentimentScore,
  AttentionMatrix,
  ChunkSentiment,
  AnomalySignal,
  PriceHistory,
  BacktestResult,
  SearchResult,
  CandlestickData,
  AnomalyMarker,
} from '@/types';
