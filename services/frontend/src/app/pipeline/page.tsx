'use client';

import { useEffect, useMemo, useState } from 'react';
import { Sidebar } from '@/components/ui/Sidebar';
import { api } from '@/lib/api';
import { usePipelineLatest, usePipelineRaw } from '@/lib/hooks';

type Stage = {
  name: string;
  operations: string[];
  input_rows: number | null;
  output_rows: number | null;
  duration_ms: number;
};

export default function PipelinePage() {
  const { data: latest, mutate, isLoading } = usePipelineLatest();
  const { data: raw } = usePipelineRaw();
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [tickers, setTickers] = useState('');

  const running = Boolean(jobId) || job?.status === 'running' || job?.status === 'queued';

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const next = await api.pipeline.status(jobId);
        if (cancelled) return;
        setJob(next);
        if (next.status === 'completed' || next.status === 'failed') {
          setJobId(null);
          await mutate();
          return;
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Unable to poll the Spark job');
      }
      if (!cancelled) timer = setTimeout(poll, 1500);
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, mutate]);

  // Keep the summary fresh while a job is in flight.
  useEffect(() => {
    if (running) {
      const timer = setInterval(() => mutate(), 4000);
      return () => clearInterval(timer);
    }
  }, [running, mutate]);

  async function startRun() {
    setError(null);
    setJob(null);
    try {
      const requested = tickers
        .split(',')
        .map((ticker) => ticker.trim().toUpperCase())
        .filter(Boolean);
      const created = await api.pipeline.run(requested.length ? requested : undefined, false);
      setJob(created);
      setJobId(created?.job_id || null);
    } catch (err: any) {
      setError(err?.message || 'Could not start the Spark pipeline');
    }
  }

  const stages: Stage[] = latest?.stages || [];
  const maxStageMs = useMemo(
    () => Math.max(1, ...stages.map((stage) => Number(stage.duration_ms) || 0)),
    [stages]
  );
  const benchmark = latest?.benchmark;
  const counts = latest?.counts || {};
  const anomalies: any[] = latest?.anomalies || [];
  const topTerms: any[] = latest?.top_terms || [];
  const artifacts: any[] = latest?.artifacts || [];
  const sectionStats: any[] = latest?.section_stats || [];

  return (
    <div className="flex h-screen bg-navy-950">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <header className="sticky top-0 z-10 bg-navy-950/90 backdrop-blur border-b border-navy-800">
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-white">Spark ETL Pipeline</h1>
                <span className="badge badge-yellow">PySpark RDD</span>
              </div>
              <p className="text-sm text-navy-400 mt-0.5">
                SEC filings → sentences → RDD feature engineering → Parquet + JSON artifacts
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`badge ${running ? 'badge-yellow' : 'badge-blue'}`}>
                {running ? job?.status || 'starting' : latest ? 'artifacts ready' : 'not run'}
              </span>
              <button onClick={startRun} disabled={running} className="btn-primary !px-4 !py-2 !text-xs">
                {running ? 'Running Spark job…' : 'Run RDD pipeline'}
              </button>
            </div>
          </div>
        </header>

        <main className="p-6 space-y-6">
          {error && (
            <div className="card border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
              {error}
            </div>
          )}

          <section className="card p-5">
            <div className="flex flex-wrap items-end gap-4">
              <div className="min-w-[240px] flex-1">
                <label className="block text-[11px] font-semibold text-navy-400 tracking-widest uppercase mb-1.5">
                  Tickers (optional, comma separated)
                </label>
                <input
                  value={tickers}
                  onChange={(event) => setTickers(event.target.value.toUpperCase())}
                  placeholder="AAPL, MSFT"
                  className="input-field font-mono"
                />
              </div>
              <div className="text-xs text-navy-400 font-mono">
                {raw?.total ? `${raw.total} raw SEC filings available` : 'checking raw snapshot…'}
                {job?.job_id && <span className="ml-3 text-navy-500">job {String(job.job_id).slice(0, 8)}</span>}
              </div>
            </div>
            {job && (
              <div className="mt-4 rounded-lg border border-navy-700 bg-navy-900/50 p-3 text-xs font-mono text-navy-300">
                status: <span className="text-yellow-400">{job.status}</span>
                {job.duration_seconds ? ` · ${job.duration_seconds}s` : ''}
                {job.error ? <span className="text-red-400"> · {job.error}</span> : null}
                {job.run_id ? ` · run ${job.run_id}` : ''}
              </div>
            )}
          </section>

          {isLoading && !latest ? (
            <div className="card p-16 flex justify-center">
              <div className="w-8 h-8 rounded-full border-2 border-yellow-500 border-t-transparent animate-spin" />
            </div>
          ) : !latest ? (
            <section className="card p-10 text-center">
              <h2 className="text-lg font-bold text-white mb-2">No pipeline artifacts yet</h2>
              <p className="text-sm text-navy-400 max-w-xl mx-auto">
                Add SEC JSON files under <code className="text-yellow-400">data/raw/filings/&lt;TICKER&gt;/</code> with{' '}
                <code className="text-yellow-400">scripts/fetch_sec_filings.py</code>, then press “Run RDD pipeline”.
              </p>
            </section>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
                <Metric title="Filings" value={counts.filings ?? 0} />
                <Metric title="Sections" value={counts.sections ?? 0} />
                <Metric title="Sentences" value={counts.sentences ?? 0} />
                <Metric title="Chunks" value={counts.chunks ?? 0} />
                <Metric title="Anomalies" value={counts.anomalies ?? 0} accent="danger" />
                <Metric title="Duration" value={`${latest.duration_seconds ?? 0}s`} />
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <section className="xl:col-span-2 card p-0 overflow-hidden">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-navy-800">
                    <div>
                      <h2 className="text-lg font-bold text-white">RDD stages</h2>
                      <p className="text-xs text-navy-400 mt-0.5">
                        Explicit transformations/actions, timed by the driver
                      </p>
                    </div>
                    <span className="text-xs font-mono text-navy-500">
                      Spark {latest.spark_version} · {latest.master}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Stage</th>
                          <th>RDD operations</th>
                          <th>Rows in / out</th>
                          <th className="w-48">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stages.map((stage) => (
                          <tr key={stage.name}>
                            <td className="font-medium text-navy-100 whitespace-nowrap">{stage.name}</td>
                            <td>
                              <div className="flex flex-wrap gap-1">
                                {stage.operations.map((operation) => (
                                  <span key={operation} className="rounded bg-navy-800 px-1.5 py-0.5 font-mono text-[10px] text-navy-300">
                                    {operation}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="font-mono text-xs text-navy-400 whitespace-nowrap">
                              {stage.input_rows ?? '—'} / {stage.output_rows ?? '—'}
                            </td>
                            <td>
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 flex-1 rounded bg-navy-800 overflow-hidden">
                                  <div
                                    className="h-full rounded bg-yellow-500"
                                    style={{ width: `${Math.max(3, (stage.duration_ms / maxStageMs) * 100)}%` }}
                                  />
                                </div>
                                <span className="w-16 text-right font-mono text-xs text-navy-300">
                                  {Number(stage.duration_ms).toFixed(0)} ms
                                </span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="card p-0 overflow-hidden">
                  <div className="px-6 py-4 border-b border-navy-800">
                    <h2 className="text-lg font-bold text-white">RDD vs DataFrame</h2>
                    <p className="text-xs text-navy-400 mt-0.5">Same Parquet rows, same word-count result</p>
                  </div>
                  {benchmark ? (
                    <div className="p-6 space-y-4">
                      <BenchmarkRow label="RDD reduceByKey" ms={benchmark.rdd_ms} terms={benchmark.rdd_terms} winner={benchmark.fastest === 'RDD'} />
                      <BenchmarkRow label="DataFrame groupBy" ms={benchmark.dataframe_ms} terms={benchmark.dataframe_terms} winner={benchmark.fastest === 'DataFrame'} />
                      <div className="rounded-lg border border-navy-700 bg-navy-900/60 p-4">
                        <p className="text-xs uppercase tracking-widest text-navy-400">Fastest</p>
                        <p className="text-2xl font-bold text-yellow-400">{benchmark.fastest}</p>
                        <p className="text-xs text-navy-400 mt-1">
                          {benchmark.speedup_dataframe_vs_rdd ? `${benchmark.speedup_dataframe_vs_rdd}× vs RDD` : '—'} · results {benchmark.match ? 'match' : 'differ'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="p-6 text-sm text-navy-400">Benchmark pending.</p>
                  )}
                </section>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <section className="card p-6">
                  <h2 className="text-lg font-bold text-white mb-1">Top corpus terms</h2>
                  <p className="text-xs text-navy-400 mb-4">reduceByKey over tokenised RDD</p>
                  <div className="flex flex-wrap gap-2">
                    {topTerms.slice(0, 24).map((term) => (
                      <span key={term.term} className="rounded-md border border-navy-700 bg-navy-900 px-2 py-1 text-xs">
                        <span className="text-navy-100">{term.term}</span>
                        <span className="ml-1.5 font-mono text-yellow-400">{term.count}</span>
                      </span>
                    ))}
                  </div>
                </section>

                <section className="xl:col-span-2 card p-0 overflow-hidden">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-navy-800">
                    <div>
                      <h2 className="text-lg font-bold text-white">Anomaly features</h2>
                      <p className="text-xs text-navy-400 mt-0.5">Temporal shift + cross-section divergence</p>
                    </div>
                    <span className="badge badge-red">{anomalies.length} signals</span>
                  </div>
                  <div className="overflow-x-auto max-h-[420px]">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Ticker</th>
                          <th>Type</th>
                          <th>Section</th>
                          <th>Score</th>
                          <th>Cosine</th>
                          <th>JS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {anomalies.slice(0, 20).map((signal) => (
                          <tr key={signal.id}>
                            <td className="font-mono font-bold text-yellow-400">{signal.ticker}</td>
                            <td>
                              <span className={'badge ' + (signal.score > 0.7 ? 'badge-red' : signal.score > 0.4 ? 'badge-yellow' : 'badge-blue')}>
                                {String(signal.signal_type).replace(/_/g, ' ')}
                              </span>
                            </td>
                            <td className="text-xs text-navy-300">
                              {String(signal.section_a || '').replace('item_', 'item ')}
                              {signal.section_b && signal.section_b !== signal.section_a ? ` → ${String(signal.section_b).replace('item_', 'item ')}` : ''}
                            </td>
                            <td className="font-mono font-bold text-white">{Number(signal.score).toFixed(3)}</td>
                            <td className="font-mono text-xs text-navy-400">{Number(signal.details?.cosine_distance ?? 0).toFixed(3)}</td>
                            <td className="font-mono text-xs text-navy-400">{Number(signal.details?.js_divergence ?? 0).toFixed(3)}</td>
                          </tr>
                        ))}
                        {anomalies.length === 0 && (
                          <tr><td colSpan={6} className="text-center py-8 text-navy-400">No signals above threshold.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <section className="card p-0 overflow-hidden">
                  <div className="px-6 py-4 border-b border-navy-800">
                    <h2 className="text-lg font-bold text-white">Section statistics</h2>
                    <p className="text-xs text-navy-400 mt-0.5">aggregateByKey + join per filing section</p>
                  </div>
                  <div className="overflow-x-auto max-h-[360px]">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Filing</th>
                          <th>Section</th>
                          <th>Tokens</th>
                          <th>Entropy</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sectionStats.slice(0, 18).map((row, index) => (
                          <tr key={`${row.filing_key}-${row.section_type}-${index}`}>
                            <td className="font-mono text-xs text-navy-300">
                              {row.ticker} <span className="text-navy-500">{row.filing_type}</span>
                            </td>
                            <td className="text-xs text-navy-100">{String(row.section_type).replace('item_', 'item ')}</td>
                            <td className="font-mono text-xs">{row.tokens}</td>
                            <td className="font-mono text-xs text-navy-400">{Number(row.normalised_entropy).toFixed(3)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="card p-0 overflow-hidden">
                  <div className="px-6 py-4 border-b border-navy-800">
                    <h2 className="text-lg font-bold text-white">Artifacts</h2>
                    <p className="text-xs text-navy-400 mt-0.5">Curated outputs consumed by the gateway</p>
                  </div>
                  <div className="divide-y divide-navy-800">
                    {artifacts.map((artifact) => (
                      <div key={artifact.name} className="flex items-center justify-between px-6 py-3 text-sm">
                        <span className="font-mono text-navy-100">{artifact.name}</span>
                        <span className="text-xs text-navy-400">
                          {artifact.format} · {artifact.rows ?? 1} rows · {formatBytes(artifact.bytes)}
                        </span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between px-6 py-3 text-sm">
                      <span className="font-mono text-navy-100">chunks.parquet</span>
                      <span className="text-xs text-navy-400">parquet · {counts.chunks ?? 0} rows</span>
                    </div>
                  </div>
                </section>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function Metric({ title, value, accent = 'default' }: { title: string; value: string | number; accent?: 'default' | 'danger' }) {
  return (
    <div className={`stat-card relative overflow-hidden ${accent === 'danger' ? 'stat-card-negative' : ''}`}>
      <div className={`absolute top-0 left-0 h-full w-1 ${accent === 'danger' ? 'bg-red-500' : 'bg-yellow-500'}`} />
      <p className="text-[11px] font-semibold text-navy-400 tracking-widest uppercase mb-1">{title}</p>
      <p className="text-2xl font-bold text-white tabular-nums">{value}</p>
    </div>
  );
}

function BenchmarkRow({ label, ms, terms, winner }: { label: string; ms: number; terms: number; winner: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${winner ? 'border-yellow-500/50 bg-yellow-500/5' : 'border-navy-700 bg-navy-900/40'}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-navy-100">{label}</span>
        {winner && <span className="badge badge-yellow">fastest</span>}
      </div>
      <div className="mt-2 flex items-end justify-between">
        <span className="text-2xl font-bold text-white tabular-nums">{ms} ms</span>
        <span className="text-xs text-navy-400 font-mono">{terms.toLocaleString()} terms</span>
      </div>
    </div>
  );
}

function formatBytes(bytes: number | undefined): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
