import useSWR from 'swr';
import type { Company, Filing, FilingChunk, AnomalySignal, SearchResult, CandlestickData, AnomalyMarker } from '@/types';
import { API_BASE, API_ORIGIN, apiUrl } from '@/lib/config';

export { API_BASE, API_ORIGIN, apiUrl };

const fetcher = (path: string) =>
  fetch(apiUrl(path)).then((res) => {
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  });

const originFetcher = (path: string) =>
  fetch(`${API_ORIGIN}${path}`).then((res) => {
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  });

export function useHealth() {
  return useSWR<{ status?: string; service?: string; version?: string }>('/health', originFetcher, {
    refreshInterval: 30000,
    shouldRetryOnError: false,
  });
}

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
  const key = params ? `/anomalies?${qs}` : null;
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
  const seenTimes = new Set<number>();
  return (prices || [])
    .filter((p) => p && p.open !== null && p.high !== null && p.low !== null && p.close !== null)
    .map((p) => {
      const timeInSec = Math.floor(new Date(p.date || p.timestamp || p.time).getTime() / 1000);
      return {
        time: timeInSec as any,
        open: Number(p.open),
        high: Number(p.high),
        low: Number(p.low),
        close: Number(p.close),
      };
    })
    .filter((p) => {
      if (typeof p.time !== 'number' || isNaN(p.time) || seenTimes.has(p.time)) return false;
      seenTimes.add(p.time);
      return true;
    })
    .sort((a, b) => (a.time as number) - (b.time as number));
}

// Convert anomalies to TradingView markers (strictly sorted ascending by time)
export function anomaliesToMarkers(anomalies: any[]): AnomalyMarker[] {
  return (anomalies || [])
    .filter((a) => a && (a.detected_at || a.filing_date || a.created_at))
    .map((a) => {
      const dateVal = a.detected_at || a.filing_date || a.created_at;
      const timeInSec = Math.floor(new Date(dateVal).getTime() / 1000);
      return {
        time: timeInSec as any,
        position: 'aboveBar' as const,
        color: a.score > 0.7 ? '#ef4444' : a.score > 0.4 ? '#ff951f' : '#edcd8c',
        shape: 'arrowDown' as const,
        text: `${String(a.signal_type || 'drift').replace(/_/g, ' ')}: ${Number(a.score || 0).toFixed(2)}`,
      };
    })
    .filter((m) => typeof m.time === 'number' && !isNaN(m.time))
    .sort((a, b) => (a.time as number) - (b.time as number));
}
