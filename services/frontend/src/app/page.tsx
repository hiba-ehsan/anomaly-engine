'use client';

import { useCompanies, useAnomalies, useMarketPrices } from '@/lib/hooks';
import { Sidebar } from '@/components/ui/Sidebar';
import { AnomalyGrid } from '@/components/cards/AnomalyGrid';
import { CountUpStat } from '@/components/stats/CountUpStat';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { PriceChart } from '@/components/charts/PriceChart';

export default function Dashboard() {
  const { data: companiesData } = useCompanies(20);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [now, setNow] = useState<string>('');

  const companies = companiesData && companiesData.companies ? companiesData.companies : [];
  const companyTotal = companiesData && companiesData.total ? companiesData.total : 0;
  const firstTicker = selectedTicker || (companies.length > 0 ? companies[0].ticker : null);
  const { data: anomaliesData } = useAnomalies(firstTicker ? { ticker: firstTicker, minScore: 0.3 } : null);
  const { data: pricesData } = useMarketPrices(firstTicker, 200);

  const anomalySignals = anomaliesData && anomaliesData.signals ? anomaliesData.signals : [];
  const recentAnomalies = anomalySignals.slice(0, 5);
  const totalAnomalies = anomalySignals.length;
  const highSeverity = anomalySignals.filter((a) => a.score > 0.7).length;

  useEffect(() => {
    setNow(new Date().toLocaleTimeString());
  }, []);

  return (
    <div className="flex h-screen bg-navy-950">
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      <div className="flex-1 overflow-auto">
        <header className="sticky top-0 z-10 bg-navy-950/90 backdrop-blur border-b border-navy-800">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <h1 className="text-2xl font-bold text-white">Dashboard</h1>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                {companyTotal} Companies
              </span>
            </div>
            <span className="text-sm text-navy-400 font-mono">Last updated: {now}</span>
          </div>
        </header>

        <main className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title="Companies Tracked" value={companyTotal} accent="yellow" label={firstTicker ? `Active: ${firstTicker}` : 'No data'} />
            <StatCard title="Anomaly Signals" value={totalAnomalies} accent="yellow" label={firstTicker ? `${firstTicker} filings` : 'No data'} />
            <StatCard title="High Severity" value={highSeverity} accent="red" label="score > 0.70" />
            <StatCard title="System Health" value="Operational" accent="green" label="All services live" />
          </div>

          <section className="card">
            <div className="flex items-center justify-between px-6 py-4 border-b border-navy-800">
              <div>
                <h3 className="text-lg font-bold text-white">
                  {firstTicker
                    ? <span>{firstTicker} <span className="text-navy-400 font-normal">Price History</span></span>
                    : 'Price History'}
                </h3>
              </div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md bg-yellow-500/10 border border-yellow-500/20 text-yellow-400">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v3m0 6v3m0 6v3" />
                </svg>
                Anomaly markers
              </span>
            </div>
            <div className="p-4">
              {firstTicker && pricesData && pricesData.prices ? (
                <PriceChart prices={pricesData.prices} anomalies={anomalySignals} height={360} />
              ) : (
                <div className="h-[360px] flex flex-col items-center justify-center gap-2 text-navy-400">
                  <svg className="w-10 h-10 opacity-40" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                  </svg>
                  <p className="text-sm">No price data yet. Add and ingest a company to see the candlestick chart.</p>
                </div>
              )}
            </div>
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 card flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-navy-800">
                <h2 className="text-lg font-bold text-white">Tracked Companies</h2>
                <Link href="/companies" className="btn-primary !px-4 !py-2 !text-xs">
                  <span className="flex items-center gap-1.5">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    Add Company
                  </span>
                </Link>
              </div>
              <div className="flex-1 overflow-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Name</th>
                      <th>Sector</th>
                      <th>Jurisdiction</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companies.map((company) => (
                      <tr
                        key={company.id}
                        onClick={() => setSelectedTicker(company.ticker)}
                        className={`cursor-pointer ${selectedTicker === company.ticker ? 'bg-navy-800/60' : ''}`}
                      >
                        <td className="font-mono font-bold text-yellow-400">{company.ticker}</td>
                        <td className="text-navy-100">{company.name}</td>
                        <td className="text-navy-400">{company.sector || 'N/A'}</td>
                        <td>
                          <span className="badge badge-blue">{company.jurisdiction}</span>
                        </td>
                        <td>
                          <Link
                            href={'/companies/' + company.ticker}
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
                    {companies.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center py-10 text-navy-400">
                          No companies tracked yet. Click &quot;Add Company&quot; to start.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-navy-800">
                <h3 className="text-lg font-bold text-white">Anomaly Feed</h3>
                <Link href="/anomalies" className="text-xs font-medium text-yellow-400 hover:text-yellow-300">
                  View all
                </Link>
              </div>
              <div className="flex-1 overflow-auto">
                {recentAnomalies.length > 0 ? (
                  <ul className="divide-y divide-navy-800">
                    {recentAnomalies.map((anomaly) => (
                      <li key={anomaly.id} className="px-5 py-3 hover:bg-navy-800/40 transition-colors">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className={'badge ' + severityClass(anomaly.score)}>
                            {anomaly.signal_type.replace(/_/g, ' ')}
                          </span>
                          <span className="font-mono text-sm font-bold text-white">{anomaly.score.toFixed(2)}</span>
                        </div>
                        <p className="text-xs text-navy-400">
                          {anomaly.company_id ? anomaly.company_id.slice(0, 10) : ''}
                          <span className="mx-1 text-navy-600">·</span>
                          {new Date(anomaly.detected_at).toLocaleDateString()}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="flex-1 flex items-center justify-center p-8 text-sm text-navy-400">
                    No anomalies detected yet for {firstTicker || 'your portfolio'}.
                  </div>
                )}
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function severityClass(score: number): string {
  if (score > 0.7) return 'badge-red';
  if (score > 0.4) return 'badge-yellow';
  return 'badge-blue';
}

function StatCard({
  title,
  value,
  accent = 'yellow',
  label,
}: {
  title: string;
  value: number | string;
  accent?: 'yellow' | 'green' | 'red';
  label?: string;
}) {
  const accentBar = {
    yellow: 'bg-yellow-500',
    green: 'bg-green-500',
    red: 'bg-red-500',
  };

  return (
    <div className={'stat-card relative overflow-hidden'}>
      <div className={'absolute top-0 left-0 w-1 h-full ' + accentBar[accent]}></div>
      <p className="text-xs font-semibold text-navy-400 tracking-widest uppercase mb-1">{title}</p>
      <p className="text-3xl font-bold text-white tabular-nums">{value}</p>
      {label && <p className="mt-1 text-xs text-navy-500">{label}</p>}
    </div>
  );
}