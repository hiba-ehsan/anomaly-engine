'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useBacktest } from '@/lib/hooks';
import { Sidebar } from '@/components/ui/Sidebar';
import { KineticTickerRibbon } from '@/components/ui/KineticTickerRibbon';

export default function BacktestPage() {
  return (
    <Suspense fallback={<div className="flex h-screen bg-ground"><Sidebar /><div className="flex-1" /></div>}>
      <BacktestExplorer />
    </Suspense>
  );
}

function BacktestExplorer() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ticker = (searchParams.get('ticker') || 'AAPL').toUpperCase();
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
    <div className="flex h-screen bg-ground text-ink overflow-hidden">
      <div className="hidden lg:block shrink-0">
        <Sidebar />
      </div>

      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <KineticTickerRibbon />

        <header className="sticky top-0 z-10 bg-ground-tint/95 backdrop-blur border-b border-line">
          <div className="flex items-center justify-between px-6 py-4">
            <div>
              <span className="text-[10px] font-mono text-accent uppercase tracking-widest block">
                Results test
              </span>
              <h1 className="text-2xl font-black uppercase tracking-tight text-white leading-none">
                Did the flags predict stock moves?
              </h1>
            </div>
            <span className="badge badge-accent font-mono">
              {results.length > 0 ? `${results.length} flags checked` : 'No results yet'}
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6 space-y-6">
          <form onSubmit={submit} className="card p-5 bg-ground-tint flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[11px] font-mono text-ink-dim uppercase tracking-widest mb-1.5">
                Company ticker
              </label>
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="e.g. AAPL, MSFT"
                className="input-field w-44 font-mono uppercase"
              />
            </div>
            <button type="submit" className="btn-kinetic !px-4 !py-2.5 text-xs flex items-center gap-1.5">
              <span>Run test</span>
              <span className="font-mono">→</span>
            </button>
            <p className="text-xs text-ink-dim font-mono pl-2">
              Compares each filing date with how the stock moved afterwards, relative to the market.
            </p>
          </form>

          {ticker && backtestData && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <SummaryCard title="Flags checked" value={summary.signals ?? results.length} accent="value" />
              <SummaryCard
                title="Average change score"
                value={summary.mean_score != null ? Number(summary.mean_score).toFixed(3) : '—'}
                accent="accent"
              />
              <SummaryCard title="Company" value={ticker} accent="white" />
            </div>
          )}

          {summary.note && (
            <div className="card p-4 text-xs font-mono text-ink-dim">
              {summary.note}
            </div>
          )}

          {isLoading ? (
            <div className="card p-12 flex justify-center items-center gap-3 text-xs font-mono text-ink-dim">
              <span className="w-2 h-2 rounded-full bg-accent animate-ping" />
              <span>Calculating results…</span>
            </div>
          ) : results.length > 0 ? (
            <div className="card p-0 overflow-hidden">
              <div className="px-6 py-4 border-b border-line bg-ground-tint flex items-center justify-between">
                <span className="text-sm font-bold uppercase tracking-tight text-white font-mono">
                  Results by filing date
                </span>
                <span className="text-xs font-mono text-value">
                  {results.length} flags
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Change type</th>
                      <th>Change score</th>
                      <th>Filing date</th>
                      <th>30-day return vs market</th>
                      <th>60-day return vs market</th>
                      <th>90-day return vs market</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((row, idx) => (
                      <tr key={`${row.signal_id ?? 'signal'}-${idx}`} className="hover:bg-ground-tint transition-colors">
                        <td className="font-mono font-bold text-ink">
                          {row.signal_type ? String(row.signal_type).replace(/_/g, ' ') : '—'}
                        </td>
                        <td className="font-mono font-bold text-value">
                          {row.score != null ? Number(row.score).toFixed(3) : '—'}
                        </td>
                        <td className="font-mono text-xs text-ink-dim">
                          {row.filing_date ? new Date(row.filing_date).toLocaleDateString() : '—'}
                        </td>
                        <td className="font-mono text-xs text-green-400">
                          {row.car_30d != null ? `${Number(row.car_30d).toFixed(2)}%` : '—'}
                        </td>
                        <td className="font-mono text-xs text-green-400">
                          {row.car_60d != null ? `${Number(row.car_60d).toFixed(2)}%` : '—'}
                        </td>
                        <td className="font-mono text-xs text-green-400">
                          {row.car_90d != null ? `${Number(row.car_90d).toFixed(2)}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="card p-12 text-center text-xs font-mono text-ink-dim">
              No results for {ticker}. Run the data pipeline for this company first.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function SummaryCard({ title, value, accent = 'value' }: { title: string; value: string | number; accent?: 'value' | 'accent' | 'white' }) {
  const colorMap = {
    value: 'text-value',
    accent: 'text-accent',
    white: 'text-white',
  };

  return (
    <div className="stat-card border-l-4 border-l-accent">
      <p className="text-[10px] font-mono text-ink-dim uppercase tracking-widest mb-1">{title}</p>
      <p className={`text-2xl font-black font-mono tabular-nums ${colorMap[accent]}`}>{value}</p>
    </div>
  );
}
