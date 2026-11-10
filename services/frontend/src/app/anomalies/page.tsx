'use client';

import { useAnomalies, useCompanies } from '@/lib/hooks';
import { Sidebar } from '@/components/ui/Sidebar';
import { KineticTickerRibbon } from '@/components/ui/KineticTickerRibbon';
import { ContradictionModal, AnomalySignalItem } from '@/components/modals/ContradictionModal';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useState, Suspense } from 'react';

const CHANGE_TYPES = [
  { value: 'cross_section', label: 'Sections differ from each other' },
  { value: 'temporal_shift', label: 'Wording changed over time' },
  { value: 'attention_drift', label: 'Wording drifted from the usual style' },
];

export default function AnomaliesPage() {
  return (
    <Suspense fallback={<div className="flex h-screen bg-ground"><Sidebar /><div className="flex-1" /></div>}>
      <AnomaliesExplorer />
    </Suspense>
  );
}

function AnomaliesExplorer() {
  const searchParams = useSearchParams();
  const initialTicker = searchParams.get('ticker') || '';
  const initialChangeType = searchParams.get('signal_type') || '';
  const initialMinScore = Number.parseFloat(searchParams.get('min_score') || '0.3');

  const { data: companiesData, isLoading: companiesLoading } = useCompanies(100);
  const companies = companiesData?.companies ?? [];

  const [pickedTicker, setPickedTicker] = useState(initialTicker);
  const [changeType, setChangeType] = useState(initialChangeType);
  const [minScore, setMinScore] = useState(
    Number.isFinite(initialMinScore) ? initialMinScore : 0.3
  );
  const [selectedSignal, setSelectedSignal] = useState<AnomalySignalItem | null>(null);

  const fallbackTicker = companies.length > 0 ? companies[0].ticker : '';
  const ticker = pickedTicker || fallbackTicker;
  const tickerKnown = Boolean(ticker) && companies.some((company) => company.ticker === ticker);
  const activeTicker = tickerKnown ? ticker : '';

  const { data: anomaliesData, isLoading } = useAnomalies(
    activeTicker
      ? {
          ticker: activeTicker,
          signalType: changeType || undefined,
          minScore,
        }
      : null
  );

  const signals = anomaliesData?.signals ?? [];
  const total = anomaliesData?.total;

  return (
    <div className="flex h-screen bg-ground text-ink overflow-hidden">
      <div className="hidden lg:block shrink-0">
        <Sidebar />
      </div>

      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <KineticTickerRibbon />

        <header className="sticky top-0 z-10 bg-ground-tint/95 backdrop-blur border-b border-line">
          <div className="px-6 py-4 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-mono text-accent uppercase tracking-widest block">
                Change flags
              </span>
              <h1 className="text-2xl font-black uppercase tracking-tight text-white leading-none">
                Changes found in filings
              </h1>
            </div>
            <span className="badge badge-accent font-mono">
              {companiesLoading || (activeTicker && isLoading)
                ? 'Loading…'
                : total != null
                ? `${total} ${total === 1 ? 'flag' : 'flags'}`
                : '—'}
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6 space-y-6">
          <section className="card p-5 bg-ground-tint">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="min-w-[220px]">
                <label className="block text-[11px] font-mono text-ink-dim uppercase tracking-widest mb-1.5">
                  Company
                </label>
                <select
                  value={activeTicker}
                  onChange={(event) => setPickedTicker(event.target.value)}
                  className="input-field font-mono cursor-pointer"
                >
                  {companiesLoading && <option value="">Loading companies…</option>}
                  {!companiesLoading && companies.length === 0 && (
                    <option value="">No companies yet</option>
                  )}
                  {companies.map((company) => (
                    <option key={company.ticker} value={company.ticker}>
                      {company.ticker} · {company.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="min-w-[200px]">
                <label className="block text-[11px] font-mono text-ink-dim uppercase tracking-widest mb-1.5">
                  What kind of change
                </label>
                <select
                  value={changeType}
                  onChange={(event) => setChangeType(event.target.value)}
                  className="input-field font-mono cursor-pointer"
                >
                  <option value="">All kinds of change</option>
                  {CHANGE_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="min-w-[170px]">
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-[11px] font-mono text-ink-dim uppercase tracking-widest">
                    Smallest change score
                  </label>
                  <span className="font-mono text-xs text-value font-bold">{minScore.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={minScore}
                  onChange={(event) => setMinScore(Number.parseFloat(event.target.value))}
                  className="w-full accent-accent"
                />
              </div>
            </div>
            <p className="mt-3 text-xs text-ink-muted font-sans">
              A higher change score means the wording changed more than usual. A flag is a hint to
              read that section, not proof that something is wrong.
            </p>
          </section>

          <section className="card p-0 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-ground-tint">
              <h3 className="text-base font-bold text-white uppercase tracking-tight font-mono">
                Changes found <span className="text-value">({signals.length})</span>
              </h3>
              {activeTicker && (
                <span className="text-xs text-ink-dim font-mono">
                  {activeTicker} · smallest score {minScore.toFixed(2)}
                </span>
              )}
            </div>

            {companiesLoading || isLoading ? (
              <div className="flex justify-center items-center py-16 gap-3 text-xs font-mono text-ink-dim">
                <span className="w-2 h-2 rounded-full bg-accent animate-ping" />
                <span>{companiesLoading ? 'Loading companies…' : 'Loading results…'}</span>
              </div>
            ) : companies.length === 0 ? (
              <div className="text-center py-16 text-ink-dim font-sans text-sm space-y-3">
                <p>No companies are being watched yet, so there is nothing to compare.</p>
                <Link href="/companies" className="btn-secondary inline-flex text-xs">
                  Add a company →
                </Link>
              </div>
            ) : signals.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>What kind of change</th>
                      <th>Change score</th>
                      <th>Section</th>
                      <th>Compared with</th>
                      <th>Text difference</th>
                      <th className="text-right">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {signals.map((anomaly, sIdx) => (
                      <tr
                        key={`${anomaly.id ?? 'anomaly'}-${sIdx}`}
                        onClick={() => setSelectedSignal(anomaly)}
                        className="hover:bg-ground-tint transition-colors cursor-pointer group"
                      >
                        <td className="font-mono font-bold text-value text-sm">{anomaly.ticker || '—'}</td>
                        <td>
                          <span className={'badge ' + anomalyClass(Number(anomaly.score))}>
                            {String(anomaly.signal_type || 'change').replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="font-mono font-bold text-white tabular-nums text-sm">
                          {anomaly.score != null ? Number(anomaly.score).toFixed(3) : '—'}
                        </td>
                        <td className="text-ink text-xs font-mono">
                          {anomaly.section_a ? String(anomaly.section_a).replace('item_', 'Item ') : '—'}
                        </td>
                        <td className="text-ink-dim text-xs font-mono">
                          {anomaly.section_b ? String(anomaly.section_b).replace('item_', 'Item ') : '—'}
                        </td>
                        <td className="font-mono text-xs text-ink-dim">
                          {anomaly.details?.cosine_distance != null
                            ? Number(anomaly.details.cosine_distance).toFixed(3)
                            : '—'}
                        </td>
                        <td className="text-right">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedSignal(anomaly);
                            }}
                            className="inline-flex items-center gap-1 text-xs font-mono font-bold text-accent hover:text-accent-warm group-hover:underline"
                          >
                            View details →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-16 text-ink-dim font-sans text-sm">
                No changes match these filters. Try a lower change score.
              </div>
            )}
          </section>
        </main>
      </div>

      <ContradictionModal
        signal={selectedSignal}
        isOpen={Boolean(selectedSignal)}
        onClose={() => setSelectedSignal(null)}
      />
    </div>
  );
}

function anomalyClass(score: number): string {
  if (score > 0.7) return 'badge-red';
  if (score > 0.4) return 'badge-orange';
  return 'badge-yellow';
}
