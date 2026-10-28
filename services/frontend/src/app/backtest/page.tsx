'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useBacktest } from '@/lib/hooks';
import { Sidebar } from '@/components/ui/Sidebar';

export default function BacktestPage() {
  return (
    <Suspense fallback={<div className="flex h-screen bg-navy-950"><Sidebar /><div className="flex-1" /></div>}>
      <BacktestExplorer />
    </Suspense>
  );
}

function BacktestExplorer() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ticker = (searchParams.get('ticker') || '').toUpperCase();
  const [input, setInput] = useState(ticker);

  const { data: backtestData, isLoading } = useBacktest(ticker || null);
  const results: any[] = backtestData?.results || [];
  const summary = backtestData?.summary || {};

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const next = input.trim().toUpperCase();
    router.push(next ? `/backtest?ticker=${encodeURIComponent(next)}` : '/backtest');
  }

  return (
    <div className="flex h-screen bg-navy-950">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <header className="sticky top-0 z-10 bg-navy-950/90 backdrop-blur border-b border-navy-800">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex flex-col">
              <h1 className="text-2xl font-bold text-white">Backtest Results</h1>
              <p className="text-sm text-navy-400 mt-0.5">
                Anomaly signals ranked from the Spark RDD pipeline
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
              Signal review
            </span>
          </div>
        </header>

        <main className="p-6 space-y-6">
          <form onSubmit={submit} className="card p-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-navy-400 tracking-widest uppercase mb-1.5">
                Ticker
              </label>
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="AAPL"
                className="input-field w-44 font-mono uppercase"
              />
            </div>
            <button type="submit" className="btn-primary !px-4 !py-2 !text-xs">
              Load signals
            </button>
            <p className="text-xs text-navy-500 pb-2">
              CAR / volatility metrics require price history and are reported as N/A until the market job runs.
            </p>
          </form>

          {ticker && backtestData && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <SummaryCard title="Signals" value={summary.signals ?? results.length} />
              <SummaryCard title="Mean score" value={Number(summary.mean_score ?? 0).toFixed(2)} />
              <SummaryCard title="Ticker" value={ticker} />
            </div>
          )}

          {isLoading ? (
            <div className="card p-10 flex justify-center">
              <div className="w-8 h-8 rounded-full border-2 border-yellow-500 border-t-transparent animate-spin" />
            </div>
          ) : ticker && results.length > 0 ? (
            <section className="card p-0 overflow-hidden">
              <div className="px-6 py-4 border-b border-navy-800">
                <h2 className="text-lg font-bold text-white">{ticker} anomaly signals</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Signal</th>
                      <th>Score</th>
                      <th>Detected</th>
                      <th>CAR 30d</th>
                      <th>CAR 60d</th>
                      <th>CAR 90d</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((result) => (
                      <tr key={result.signal_id}>
                        <td>
                          <span className={'badge ' + scoreClass(result.score)}>
                            {String(result.signal_type || '').replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="font-mono font-bold text-white">
                          {Number(result.score || 0).toFixed(2)}
                        </td>
                        <td className="text-navy-300">
                          {result.filing_date ? new Date(result.filing_date).toLocaleDateString() : 'N/A'}
                        </td>
                        <td className="text-navy-400">{formatPct(result.car_30d)}</td>
                        <td className="text-navy-400">{formatPct(result.car_60d)}</td>
                        <td className="text-navy-400">{formatPct(result.car_90d)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <div className="card p-6 text-center text-navy-400">
              {ticker
                ? `No anomaly signals for ${ticker}. Run the Spark ETL from the Pipeline page first.`
                : 'Enter a ticker (e.g. AAPL) to review its anomaly signals.'}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function SummaryCard({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="stat-card">
      <p className="text-xs font-semibold text-navy-400 tracking-widest uppercase mb-1">{title}</p>
      <p className="text-3xl font-bold text-white tabular-nums">{value}</p>
    </div>
  );
}

function scoreClass(score: number | null | undefined): string {
  const numeric = Number(score || 0);
  if (numeric > 0.7) return 'badge-red';
  if (numeric > 0.4) return 'badge-yellow';
  return 'badge-blue';
}

function formatPct(value: number | null | undefined): string {
  return value === null || value === undefined ? 'N/A' : `${Number(value).toFixed(2)}%`;
}
