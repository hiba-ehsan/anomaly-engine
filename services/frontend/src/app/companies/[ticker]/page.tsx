'use client';

import { useCompany, useFilings, useAnomalies, useMarketPrices } from '@/lib/hooks';
import { Sidebar } from '@/components/ui/Sidebar';
import { api } from '@/lib/api';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { PriceChart } from '@/components/charts/PriceChart';

export default function CompanyDetailPage() {
  const params = useParams();
  const ticker = params.ticker as string;

  const { data: companyData, isLoading: companyLoading } = useCompany(ticker);
  const { data: filingsData, isLoading: filingsLoading } = useFilings(ticker);
  const { data: anomaliesData } = useAnomalies(ticker ? { ticker, minScore: 0.3 } : null);
  const { data: pricesData } = useMarketPrices(ticker, 200);

  const [action, setAction] = useState<'idle' | 'ingesting' | 'analyzing'>('idle');
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  async function runAction(kind: 'ingest' | 'analyze') {
    setAction(kind === 'ingest' ? 'ingesting' : 'analyzing');
    setActionMsg('Starting...');
    try {
      if (kind === 'ingest') {
        const job = await api.pipeline.run([ticker]);
        setActionMsg(job?.job_id ? `Spark job ${String(job.job_id).slice(0, 8)} started` : 'Spark pipeline started');
      } else {
        const data = await api.anomalies.analyze(ticker);
        setActionMsg(data?.message || 'Analysis complete');
      }
      setTimeout(() => { setAction('idle'); setActionMsg(null); }, 4000);
    } catch (e: any) {
      setActionMsg(e.message || 'Failed');
      setTimeout(() => { setAction('idle'); setActionMsg(null); }, 5000);
    }
  }

  if (companyLoading) {
    return (
      <div className="flex h-screen bg-navy-950">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="w-12 h-12 rounded-full border-4 border-yellow-500 border-t-transparent animate-spin"></div>
        </div>
      </div>
    );
  }

  const company = companyData || null;
  const filings = filingsData && filingsData.filings ? filingsData.filings.slice(0, 10) : [];
  const anomalies = anomaliesData && anomaliesData.signals ? anomaliesData.signals.slice(0, 10) : [];
  const anomalyTotal = anomaliesData && anomaliesData.total ? anomaliesData.total : 0;
  const prices = pricesData && pricesData.prices ? pricesData.prices : [];

  if (!company) {
    return (
      <div className="flex h-screen bg-navy-950">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-white mb-2">Company not found</h1>
            <p className="text-navy-400 mb-6">Ticker &quot;{ticker}&quot; is not in the database yet.</p>
            <button onClick={() => runAction('ingest')} disabled={action !== 'idle'} className="btn-primary">
              {action === 'ingesting' ? 'Ingesting...' : 'Ingest from SEC EDGAR'}
            </button>
            {actionMsg && (
              <p className="mt-4 text-xs font-mono text-navy-300 animate-fade-in">{actionMsg}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const highRisk = anomalies.filter((a) => a.score > 0.7).length;

  return (
    <div className="flex h-screen bg-navy-950">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <header className="sticky top-0 z-10 bg-navy-950/90 backdrop-blur border-b border-navy-800">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-4">
              <Link href="/companies" className="inline-flex items-center gap-1.5 text-navy-300 hover:text-yellow-400 font-medium text-sm transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Companies
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-white">
                  {company.name} <span className="font-mono text-yellow-400">({company.ticker})</span>
                </h1>
                <p className="text-navy-400 text-sm">{company.sector || 'Unknown sector'} · {company.jurisdiction}</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              {actionMsg && (
                <span className="text-xs text-navy-300 font-mono animate-fade-in">{actionMsg}</span>
              )}
              <button
                onClick={() => runAction('ingest')}
                disabled={action !== 'idle'}
                className="btn-secondary !px-4 !py-2 !text-xs"
              >
                {action === 'ingesting' ? 'Ingesting...' : 'Re-ingest'}
              </button>
              <button
                onClick={() => runAction('analyze')}
                disabled={action !== 'idle'}
                className="btn-primary !px-4 !py-2 !text-xs"
              >
                {action === 'analyzing' ? 'Analyzing...' : 'Analyze'}
              </button>
            </div>
          </div>
        </header>

        <main className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title="Filings" value={filings.length} />
            <StatCard title="Anomalies" value={anomalyTotal} variant={anomalyTotal > 0 ? 'danger' : 'default'} />
            <StatCard title="High Risk" value={highRisk} variant={highRisk > 0 ? 'danger' : 'default'} />
            <StatCard title="Price Points" value={prices.length} />
          </div>

          {prices.length > 0 && (
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white">{ticker} Price</h3>
                <span className="badge badge-yellow">1Y</span>
              </div>
              <PriceChart prices={prices} anomalies={anomalies} height={300} />
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Panel title="Recent Filings" actionHref={'/companies/' + ticker + '/filings'} actionLabel="View All">
              {filingsLoading ? (
                <div className="flex justify-center py-10">
                  <div className="w-6 h-6 rounded-full border-2 border-yellow-500 border-t-transparent animate-spin"></div>
                </div>
              ) : filings.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Date</th>
                        <th>Period</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filings.map((filing) => (
                        <tr key={filing.id}>
                          <td>
                            <span className="badge badge-blue">{filing.filing_type}</span>
                          </td>
                          <td className="text-navy-100">{new Date(filing.filing_date).toLocaleDateString()}</td>
                          <td className="text-navy-400">
                            {filing.period_of_report ? new Date(filing.period_of_report).toLocaleDateString() : 'N/A'}
                          </td>
                          <td>
                            <Link
                              href={'/companies/' + ticker + '/filings/' + filing.id}
                              className="inline-flex items-center gap-1 text-sm font-medium text-yellow-400 hover:text-yellow-300"
                            >
                              View
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                              </svg>
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-navy-400 text-center py-10">No filings yet. Run Re-ingest above.</p>
              )}
            </Panel>

            <Panel title="Recent Anomalies" actionHref={'/anomalies?ticker=' + ticker} actionLabel="View All">
              {anomalies.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Signal</th>
                        <th>Score</th>
                        <th>Detected</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {anomalies.map((anomaly) => (
                        <tr key={anomaly.id}>
                          <td>
                            <span className={'badge ' + anomalyClass(anomaly.score)}>{anomaly.signal_type}</span>
                          </td>
                          <td className="font-bold text-white tabular-nums">{anomaly.score.toFixed(2)}</td>
                          <td className="text-navy-400 text-sm">
                            {new Date(anomaly.detected_at).toLocaleDateString()}
                          </td>
                          <td>
                            <Link
                              href={'/anomalies/' + anomaly.id}
                              className="inline-flex items-center gap-1 text-sm font-medium text-yellow-400 hover:text-yellow-300"
                            >
                              View
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                              </svg>
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-navy-400 text-center py-10">No anomalies detected yet.</p>
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
      <div className="flex items-center justify-between px-6 py-4 border-b border-navy-800">
        <h3 className="text-lg font-bold text-white">{title}</h3>
        {actionHref && (
          <Link href={actionHref} className="text-sm font-medium text-yellow-400 hover:text-yellow-300">
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
  if (score > 0.4) return 'badge-yellow';
  return 'badge-blue';
}

function StatCard({
  title,
  value,
  variant = 'default',
}: {
  title: string;
  value: number | string;
  variant?: 'default' | 'danger';
}) {
  return (
    <div className={'stat-card ' + (variant === 'danger' ? 'stat-card-negative' : '')}>
      <p className="text-xs font-semibold text-navy-400 tracking-wide uppercase mb-1">{title}</p>
      <p className="text-3xl font-bold text-white tabular-nums">{value}</p>
    </div>
  );
}