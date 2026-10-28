'use client';

import { useAnomalies } from '@/lib/hooks';
import { Sidebar } from '@/components/ui/Sidebar';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Suspense } from 'react';

const signalTypes = ['cross_section', 'temporal_shift', 'attention_drift'];

export default function AnomaliesPage() {
  return (
    <Suspense fallback={<div className="flex h-screen bg-navy-950"><Sidebar /><div className="flex-1" /></div>}>
      <AnomaliesExplorer />
    </Suspense>
  );
}

function AnomaliesExplorer() {
  const searchParams = useSearchParams();
  const initialTicker = searchParams.get('ticker') || '';
  const initialSignalType = searchParams.get('signal_type') || '';
  const initialMinScore = parseFloat(searchParams.get('min_score') || '0.3');

  const [filterTicker, setFilterTicker] = useState(initialTicker);
  const [filterSignalType, setFilterSignalType] = useState(initialSignalType);
  const [filterMinScore, setFilterMinScore] = useState(initialMinScore);

  const { data: anomaliesData, isLoading } = useAnomalies({
    ticker: filterTicker || undefined,
    signalType: filterSignalType || undefined,
    minScore: filterMinScore,
  });

  const signals = anomaliesData && anomaliesData.signals ? anomaliesData.signals : [];
  const total = anomaliesData && anomaliesData.total ? anomaliesData.total : 0;

  return (
    <div className="flex h-screen bg-navy-950">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <header className="sticky top-0 z-10 bg-navy-950/90 backdrop-blur border-b border-navy-800">
          <div className="px-6 py-4">
            <h1 className="text-2xl font-bold text-white">Anomaly Explorer</h1>
            <p className="text-sm text-navy-400 mt-0.5">
              Contradiction signals between filings across time and across peers
            </p>
          </div>
        </header>

        <main className="p-6 space-y-6">
          <section className="card p-6">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs font-semibold text-navy-400 tracking-wide uppercase mb-1.5">
                  Ticker
                </label>
                <input
                  type="text"
                  placeholder="AAPL, MSFT..."
                  value={filterTicker}
                  onChange={(e) => setFilterTicker(e.target.value.toUpperCase())}
                  className="input-field"
                />
              </div>
              <div className="min-w-[180px]">
                <label className="block text-xs font-semibold text-navy-400 tracking-wide uppercase mb-1.5">
                  Signal Type
                </label>
                <select
                  value={filterSignalType}
                  onChange={(e) => setFilterSignalType(e.target.value)}
                  className="select-field"
                >
                  <option value="">All Types</option>
                  {signalTypes.map((t) => (
                    <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              <div className="min-w-[120px]">
                <label className="block text-xs font-semibold text-navy-400 tracking-wide uppercase mb-1.5">
                  Min Score ({filterMinScore.toFixed(1)})
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={filterMinScore}
                  onChange={(e) => setFilterMinScore(parseFloat(e.target.value))}
                  className="w-full accent-yellow-500"
                />
              </div>
            </div>
          </section>

          <section className="card p-0 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-navy-800">
              <h3 className="text-lg font-bold text-white">
                Signals <span className="text-navy-400 font-normal">({total})</span>
              </h3>
              {filterTicker && (
                <span className="text-xs text-navy-400 font-mono">
                  {filterTicker}
                  {filterSignalType ? ' / ' + filterSignalType.replace(/_/g, ' ') : ''}
                  {filterMinScore > 0 ? ' / min ' + filterMinScore.toFixed(1) : ''}
                </span>
              )}
            </div>

            {isLoading ? (
              <div className="flex justify-center py-16">
                <div className="w-8 h-8 rounded-full border-2 border-yellow-500 border-t-transparent animate-spin"></div>
              </div>
            ) : signals.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Signal</th>
                      <th>Score</th>
                      <th>Type</th>
                      <th>Filing A</th>
                      <th>Filing B</th>
                      <th>Detected</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {signals.map((anomaly) => (
                      <tr key={anomaly.id} className="cursor-pointer hover:bg-navy-800/50">
                        <td className="font-mono font-bold text-yellow-400">{anomaly.ticker}</td>
                        <td>
                          <span className={'badge ' + anomalyClass(anomaly.score)}>{anomaly.signal_type}</span>
                        </td>
                        <td className="font-bold text-white tabular-nums">{anomaly.score.toFixed(2)}</td>
                        <td className="capitalize text-navy-300">{anomaly.signal_type.replace(/_/g, ' ')}</td>
                        <td className="font-mono text-navy-400 text-xs">
                          {anomaly.filing_a_id ? anomaly.filing_a_id.slice(0, 8) : '-'}
                        </td>
                        <td className="font-mono text-navy-400 text-xs">
                          {anomaly.filing_b_id ? anomaly.filing_b_id.slice(0, 8) : '-'}
                        </td>
                        <td className="text-navy-400 text-sm">
                          {new Date(anomaly.detected_at).toLocaleDateString()}
                        </td>
                        <td>
                          <Link
                            href={'/anomalies/' + anomaly.id}
                            className="inline-flex items-center gap-1 text-sm font-medium text-yellow-400 hover:text-yellow-300"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-6 py-16 text-center text-navy-400">
                {filterTicker
                  ? 'No anomalies found matching your filters.'
                  : 'Enter a ticker and set a minimum score to explore signals.'}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

function anomalyClass(score: number): string {
  if (score > 0.7) return 'badge-red';
  if (score > 0.4) return 'badge-yellow';
  return 'badge-blue';
}
