import useSWR from 'swr';
import type { Company, Filing, FilingChunk, AnomalySignal, SearchResult, CandlestickData, AnomalyMarker } from '@/types';
import { API_BASE, API_ORIGIN, apiUrl } from '@/lib/config';

export { API_BASE, API_ORIGIN, apiUrl };

const fetcher = (path: string) =>
  fetch(apiUrl(path)).then((res) => {
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  });

type CompaniesResponse = { companies: Company[]; total: number };
type FilingsResponse = { filings: Filing[]; total: number };
type ChunksResponse = { chunks: FilingChunk[]; total: number };
type SentimentResponse = { scores: any[]; total: number };
type AnomaliesResponse = { signals: AnomalySignal[]; total: number };
type SearchResponse = { results: SearchResult[]; total: number };
type MarketPricesResponse = { prices: any[]; total: number };

export function useCompanies(limit = 100, offset = 0) {
  return useSWR<CompaniesResponse>(`/companies?limit=${limit}&offset=${offset}`, fetcher);
}

export function useCompany(ticker: string | null) {
  return useSWR<Company>(ticker ? `/companies/${ticker}` : null, fetcher);
}

export function useFilings(ticker: string | null, filingType?: string) {
  const qs = new URLSearchParams();
  if (ticker) qs.set('ticker', ticker);
  if (filingType) qs.set('filing_type', filingType);
  return useSWR<FilingsResponse>(ticker ? `/filings?${qs}` : null, fetcher);
}

export function useFiling(filingId: string | null) {
  return useSWR<Filing>(filingId ? `/filings/${filingId}` : null, fetcher);
}

export function useFilingChunks(filingId: string | null) {
  return useSWR<ChunksResponse>(filingId ? `/filings/${filingId}/chunks` : null, fetcher);
}

export function useFilingSentiment(filingId: string | null) {
  return useSWR<SentimentResponse>(filingId ? `/filings/${filingId}/sentiment` : null, fetcher);
}

export function useAnomalies(params: { ticker?: string; signalType?: string; minScore?: number } | null) {
  const qs = new URLSearchParams();
  if (params?.ticker) qs.set('ticker', params.ticker);
  if (params?.signalType) qs.set('signal_type', params.signalType);
  if (params?.minScore !== undefined) qs.set('min_score', params.minScore.toString());
  const key = params && params.ticker ? `/anomalies?${qs}` : null;
  return useSWR<AnomaliesResponse>(key, fetcher);
}

export function useAnomaly(signalId: string | null) {
  return useSWR<AnomalySignal>(signalId ? `/anomalies/${signalId}` : null, fetcher);
}

export function useMarketPrices(ticker: string | null, limit = 500) {
  return useSWR<MarketPricesResponse>(ticker ? `/market/${ticker}/prices?limit=${limit}` : null, fetcher);
}

export function useMarketNews(ticker: string | null, daysBack = 30) {
  return useSWR<any>(ticker ? `/market/${ticker}/news?days_back=${daysBack}` : null, fetcher);
}

export function useMarketQuote(ticker: string | null) {
  return useSWR<any>(ticker ? `/market/${ticker}/quote` : null, fetcher);
}

export function useBacktest(ticker: string | null) {
  return useSWR<any>(ticker ? `/backtest/${ticker}` : null, fetcher);
}

export function usePipelineLatest(refreshMs = 0) {
  return useSWR<any>('/pipeline/latest', fetcher, {
    refreshInterval: refreshMs,
    shouldRetryOnError: false,
  });
}

export function usePipelineRaw() {
  return useSWR<{ files: any[]; total: number }>('/pipeline/raw', fetcher);
}

export function useSearchSimilar(embedding: number[] | null, count = 10, threshold = 0.7) {
  return useSWR<SearchResponse>(
    embedding ? ['/search/similar', { query_embedding: embedding, match_count: count, match_threshold: threshold }] : null,
    ([url, body]) =>
      fetch(apiUrl(url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.json())
  );
}

// Helper to convert price data to candlestick format for TradingView
export function pricesToCandlesticks(prices: any[]): CandlestickData[] {
  return prices
    .filter((p) => p.open !== null && p.high !== null && p.low !== null && p.close !== null)
    .map((p) => ({
      time: new Date(p.date).getTime() / 1000, // TradingView expects seconds
      open: p.open,
      high: p.high,
      low: p.low,
      close: p.close,
    }))
    .sort((a, b) => (a.time as number) - (b.time as number));
}

// Convert anomalies to TradingView markers
export function anomaliesToMarkers(anomalies: any[]): AnomalyMarker[] {
  return anomalies.map((a) => ({
    time: new Date(a.detected_at).getTime() / 1000,
    position: 'aboveBar' as const,
    color: a.score > 0.7 ? '#ef4444' : a.score > 0.4 ? '#f59e0b' : '#22c55e',
    shape: 'arrowDown' as const,
    text: `${a.signal_type}: ${a.score.toFixed(2)}`,
  }));
}
