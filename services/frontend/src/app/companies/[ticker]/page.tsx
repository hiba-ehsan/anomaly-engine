'use client';

import { useCompany, useFilings, useAnomalies, useMarketPrices } from '@/lib/hooks';
import { Sidebar } from '@/components/ui/Sidebar';
import { KineticTickerRibbon } from '@/components/ui/KineticTickerRibbon';
import { api } from '@/lib/api';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { PriceChart } from '@/components/charts/PriceChart';

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

export default function CompanyDetailPage() {
  const params = useParams();
  const ticker = (params.ticker as string).toUpperCase();

  const { data: companyData, isLoading: companyLoading, mutate: mutateCompany } = useCompany(ticker);
  const { data: filingsData, isLoading: filingsLoading, mutate: mutateFilings } = useFilings(ticker);
  const { data: anomaliesData, mutate: mutateAnomalies } = useAnomalies(
    ticker ? { ticker, minScore: 0.3 } : null
  );
  const { data: pricesData } = useMarketPrices(ticker, 200);

  const [action, setAction] = useState<'idle' | 'updating' | 'rebuilding'>('idle');
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  async function refreshAll() {
    await Promise.all([mutateCompany(), mutateFilings(), mutateAnomalies()]);
  }

  async function waitForPipeline(jobId: string) {
    const deadline = Date.now() + 30 * 60 * 1000;
    let job = await api.pipeline.status(jobId);
    while (job.status === 'running' || job.status === 'queued') {
      if (Date.now() > deadline) {
        throw new Error(
          'Rebuilding is taking longer than usual. Check the Data pipeline page in a few minutes.'
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
      job = await api.pipeline.status(jobId);
    }
    if (job.status === 'failed') {
      throw new Error(job.error || 'The rebuild failed. Check the Data pipeline page for details.');
    }
    return job;
  }

  // Downloads the newest 10-K/10-Q filings from SEC EDGAR, then rebuilds every
  // result so this company appears everywhere in the app (not just on this page).
  async function updateFromSec() {
    setAction('updating');
    setActionMsg('Downloading the latest filings from the SEC…');
    try {
      const started = await api.companies.ingest(ticker, {
        filing_types: ['10-K', '10-Q'],
        max_filings: 10,
      });
      const deadline = Date.now() + 20 * 60 * 1000;
      let job = started;
      while (job.status !== 'completed') {
        if (job.status === 'failed') {
          throw new Error(job.error || 'The SEC download failed.');
        }
        if (Date.now() > deadline) {
          throw new Error('The SEC download is taking longer than usual. Try again in a few minutes.');
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
        job = await api.companies.ingestStatus(started.job_id);
      }

      setAction('rebuilding');
      setActionMsg('Filings downloaded. Rebuilding all results…');
      const pipeline = await api.pipeline.run(undefined, false);
      await waitForPipeline(pipeline.job_id);
      await refreshAll();
      setActionMsg('Done. Filings and results are up to date.');
    } catch (e: any) {
      setActionMsg(e?.message || 'Something went wrong.');
    } finally {
      setAction('idle');
      setTimeout(() => setActionMsg(null), 9000);
    }
  }

  // Rebuilds results from the files already downloaded (no SEC request).
  async function rebuildResults() {
    setAction('rebuilding');
    setActionMsg('Rebuilding all results…');
    try {
      const pipeline = await api.pipeline.run(undefined, false);
      await waitForPipeline(pipeline.job_id);
      await refreshAll();
      setActionMsg('Done. Results rebuilt.');
    } catch (e: any) {
      setActionMsg(e?.message || 'The rebuild failed.');
    } finally {
      setAction('idle');
      setTimeout(() => setActionMsg(null), 9000);
    }
  }

  if (companyLoading) {
    return (
      <div className="flex h-screen bg-ground text-ink">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center gap-3 text-xs font-mono text-ink-dim">
          <span className="w-2 h-2 rounded-full bg-accent animate-ping" />
          <span>Loading {ticker}…</span>
        </div>
      </div>
    );
  }

  const company = companyData || null;
  const filings = filingsData?.filings ? filingsData.filings.slice(0, 10) : [];
  const allAnomalies = anomaliesData?.signals ?? [];
  const anomalies = allAnomalies.slice(0, 10);
  const anomalyTotal = anomaliesData?.total ?? allAnomalies.length;
  const prices = pricesData?.prices ?? [];
  const highRisk = allAnomalies.filter((a) => Number(a.score) > 0.7).length;
  const latestFiling = filings
    .map((filing) => filing.filing_date)
    .filter(Boolean)
    .sort()
    .reverse()[0];

  const companyMeta = [company?.sector, company?.jurisdiction].filter(Boolean).join(' · ');

  return (
    <div className="flex h-screen bg-ground text-ink overflow-hidden">
      <div className="hidden lg:block shrink-0">
        <Sidebar />
      </div>

      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <KineticTickerRibbon />

        <header className="sticky top-0 z-10 bg-ground-tint/95 backdrop-blur border-b border-line">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-4">
              <Link
                href="/companies"
                className="text-ink-dim hover:text-accent font-mono text-xs flex items-center gap-1 uppercase transition-colors"
              >
                ← Back
              </Link>
              <div>
                <span className="text-[10px] font-mono text-accent uppercase tracking-widest block">
                  Company · SEC ID {company?.cik || '—'}
                </span>
                <h1 className="text-2xl font-black uppercase tracking-tight text-white leading-none">
                  {company?.name || ticker} <span className="font-mono text-value">({ticker})</span>
                </h1>
                <p className="text-ink-dim text-xs font-mono mt-0.5">
                  {companyMeta || 'Company details not loaded'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {actionMsg && (
                <span className="text-xs text-value font-mono animate-fade-in">{actionMsg}</span>
              )}
              <button
                onClick={updateFromSec}
                disabled={action !== 'idle'}
                className="btn-secondary !px-4 !py-2 text-xs font-mono"
              >
                {action === 'updating' ? 'Downloading…' : 'Update from SEC'}
              </button>
              <button
                onClick={rebuildResults}
                disabled={action !== 'idle'}
                className="btn-kinetic !px-4 !py-2 text-xs flex items-center gap-1"
              >
                <span>{action === 'rebuilding' ? 'Rebuilding…' : 'Rebuild results'}</span>
                <span className="font-mono">→</span>
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title="Filings" value={filingsData?.filings?.length ?? '—'} accent="white" />
            <StatCard title="Change flags" value={anomalyTotal} accent="value" />
            <StatCard title="Big changes" value={highRisk} accent="red" />
            <StatCard title="Latest filing" value={formatDate(latestFiling)} accent="green" />
          </div>

          {prices.length > 0 && (
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4 border-b border-line pb-3">
                <div>
                  <span className="text-[10px] font-mono text-ink-dim uppercase tracking-wider block">
                    Stock price
                  </span>
                  <h3 className="text-base font-bold text-white uppercase tracking-tight">
                    {ticker} price and flag dates
                  </h3>
                </div>
                <span className="badge badge-yellow font-mono">{anomalies.length} flags marked</span>
              </div>
              <PriceChart prices={prices} anomalies={anomalies} height={300} />
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Panel
              title="Filings"
              actionHref={'/companies/' + ticker + '/filings'}
              actionLabel="See all →"
            >
              {filingsLoading ? (
                <div className="flex justify-center py-10 text-xs font-mono text-ink-dim">
                  Loading filings…
                </div>
              ) : filings.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Form</th>
                        <th>Filed</th>
                        <th>Period</th>
                        <th className="text-right">Open</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filings.map((filing) => (
                        <tr key={filing.id} className="hover:bg-ground-tint transition-colors">
                          <td>
                            <span className="badge badge-accent font-mono">{filing.filing_type || '—'}</span>
                          </td>
                          <td className="text-ink text-xs font-mono">{formatDate(filing.filing_date)}</td>
                          <td className="text-ink-dim text-xs font-mono">{formatDate(filing.period_of_report)}</td>
                          <td className="text-right">
                            <Link
                              href={`/companies/${ticker}/filings/${filing.id}`}
                              className="text-xs font-mono font-bold text-accent hover:underline"
                            >
                              Open →
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-ink-dim text-center py-10 font-mono text-xs">
                  No filings yet. Press “Update from SEC” above.
                </p>
              )}
            </Panel>

            <Panel title="Change flags" actionHref={'/anomalies?ticker=' + ticker} actionLabel="See all →">
              {anomalies.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Change type</th>
                        <th>Score</th>
                        <th>Text difference</th>
                        <th className="text-right">Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {anomalies.map((anomaly, idx) => (
                        <tr key={`${anomaly.id ?? 'anomaly'}-${idx}`} className="hover:bg-ground-tint transition-colors">
                          <td>
                            <span className={'badge ' + anomalyClass(Number(anomaly.score))}>
                              {String(anomaly.signal_type || 'change').replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="font-mono font-bold text-value text-sm">
                            {anomaly.score != null ? Number(anomaly.score).toFixed(3) : '—'}
                          </td>
                          <td className="text-ink-dim text-xs font-mono">
                            {anomaly.details?.cosine_distance != null
                              ? Number(anomaly.details.cosine_distance).toFixed(3)
                              : '—'}
                          </td>
                          <td className="text-right">
                            <Link
                              href={'/anomalies?ticker=' + ticker}
                              className="text-xs font-mono font-bold text-accent hover:underline"
                            >
                              View →
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-ink-dim text-center py-10 font-mono text-xs space-y-2">
                  <p>No change flags for {ticker} yet.</p>
                  <p className="text-[11px] text-accent">Press “Rebuild results” above to check its filings.</p>
                </div>
              )}
            </Panel>
          </div>
        </main>
      </div>
    </div>
  );
}

function Panel({
  title,
  children,
  actionHref,
  actionLabel,
}: {
  title: string;
  children: React.ReactNode;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-ground-tint">
        <h3 className="text-sm font-bold uppercase tracking-tight text-white font-mono">{title}</h3>
        {actionHref && (
          <Link href={actionHref} className="text-xs font-mono text-accent hover:underline">
            {actionLabel}
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

function anomalyClass(score: number): string {
  if (score > 0.7) return 'badge-red';
  if (score > 0.4) return 'badge-orange';
  return 'badge-yellow';
}

function StatCard({
  title,
  value,
  accent = 'white',
}: {
  title: string;
  value: number | string;
  accent?: 'white' | 'value' | 'red' | 'green';
}) {
  const colorMap = {
    white: 'text-white',
    value: 'text-value',
    red: 'text-red-400',
    green: 'text-green-400',
  };

  return (
    <div className="stat-card border-l-4 border-l-accent">
      <p className="text-[10px] font-mono text-ink-dim uppercase tracking-widest mb-1">{title}</p>
      <p className={`text-2xl font-black font-mono tabular-nums ${colorMap[accent]}`}>{value}</p>
    </div>
  );
}
