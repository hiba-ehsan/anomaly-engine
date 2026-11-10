'use client';

import { useEffect, useMemo, useState } from 'react';
import { Sidebar } from '@/components/ui/Sidebar';
import { KineticTickerRibbon } from '@/components/ui/KineticTickerRibbon';
import { api } from '@/lib/api';
import { usePipelineLatest, usePipelineRaw } from '@/lib/hooks';

type Stage = {
  name: string;
  operations: string[];
  input_rows: number | null;
  output_rows: number | null;
  duration_ms: number | null;
};

function shown(value: unknown): string {
  return value == null || value === '' ? '—' : String(value);
}

function rowCount(value: number | null | undefined): string {
  return value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString();
}

export default function PipelinePage() {
  const { data: latest, mutate, isLoading } = usePipelineLatest();
  const { data: raw } = usePipelineRaw();
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

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
        if (!cancelled) setError(err?.message || 'Could not check the job status.');
      }
      if (!cancelled) timer = setTimeout(poll, 1500);
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, mutate]);

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
      // The pipeline always processes every downloaded filing, so a company
      // filter would be misleading: leave it out and run the full snapshot.
      const created = await api.pipeline.run(undefined, false);
      setJob(created);
      setJobId(created?.job_id || null);
    } catch (err: any) {
      setError(err?.message || 'Could not start the pipeline.');
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
    <div className="flex h-screen bg-ground text-ink overflow-hidden">
      <div className="hidden lg:block shrink-0">
        <Sidebar />
      </div>
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <KineticTickerRibbon />
        <header className="sticky top-0 z-10 bg-ground-tint/95 backdrop-blur border-b border-line">
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
            <div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-accent uppercase tracking-widest block">Data pipeline</span>
                <h1 className="text-2xl font-black uppercase tracking-tight text-white leading-none">How filings are processed</h1>
                <span className="badge badge-accent font-mono">
                  Spark {latest?.spark_version ?? '—'}
                </span>
              </div>
              <p className="text-xs text-ink-muted mt-1 font-sans">
                Reads the filings, splits them into sections, compares the wording, and saves the results.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`badge ${running ? 'badge-orange' : 'badge-yellow'}`}>
                {running ? job?.status || 'starting' : latest ? 'Results ready' : 'Not run yet'}
              </span>
              <button onClick={startRun} disabled={running} className="btn-kinetic !px-4 !py-2 text-xs flex items-center gap-1.5">
                <span>{running ? 'Running…' : 'Run the pipeline'}</span>
                <span className="font-mono">→</span>
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6 space-y-6">
          {error && (
            <div className="card border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
              {error}
            </div>
          )}

          <section className="card p-5">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-[260px]">
                <p className="text-sm text-ink">
                  This rebuilds every company from all downloaded filings.
                </p>
                <p className="text-xs text-ink-dim mt-1">
                  Nothing is filtered out, so a single company can never disappear from the results.
                </p>
              </div>
              <div className="text-xs text-ink-dim font-mono">
                {raw?.total
                  ? `${raw.total} downloaded · ${latest?.counts?.filings ?? '—'} used in the latest run`
                  : 'Checking downloaded filings…'}
                {job?.job_id && <span className="ml-3 text-ink-muted">job {String(job.job_id).slice(0, 8)}</span>}
              </div>
            </div>
            {job && (
              <div className="mt-4 rounded-lg border border-line bg-ground p-3 text-xs font-mono text-ink-muted">
                Status: <span className="text-accent">{shown(job.status)}</span>
                {job.duration_seconds != null ? ` · ${job.duration_seconds}s` : ''}
                {job.error ? <span className="text-red-400"> · {job.error}</span> : null}
                {job.run_id ? ` · run ${job.run_id}` : ''}
              </div>
            )}
          </section>

          {isLoading && !latest ? (
            <div className="card p-16 flex justify-center">
              <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            </div>
          ) : !latest ? (
            <section className="card p-10 text-center">
              <h2 className="text-lg font-bold text-white mb-2">No pipeline results yet</h2>
              <p className="text-sm text-ink-muted max-w-xl mx-auto">
                Put SEC filing files in <code className="text-accent">data/raw/filings/&lt;TICKER&gt;/</code>, then press
                “Run the pipeline”.
              </p>
            </section>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
                <Metric title="Filings" value={rowCount(counts.filings)} />
                <Metric title="Sections" value={rowCount(counts.sections)} />
                <Metric title="Sentences" value={rowCount(counts.sentences)} />
                <Metric title="Passages" value={rowCount(counts.chunks)} />
                <Metric title="Change flags" value={rowCount(counts.anomalies)} accent="danger" />
                <Metric title="Run time" value={latest.duration_seconds != null ? `${latest.duration_seconds}s` : '—'} />
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <section className="xl:col-span-2 card p-0 overflow-hidden">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-line">
                    <div>
                      <h2 className="text-lg font-bold text-white">Steps in the pipeline</h2>
                      <p className="text-xs text-ink-muted mt-0.5">
                        Each step, in order, with how long it took.
                      </p>
                    </div>
                    <span className="text-xs font-mono text-ink-dim">
                      Spark {latest.spark_version ?? '—'} · {latest.master ?? '—'}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Step</th>
                          <th>What it does</th>
                          <th>Rows in / out</th>
                          <th className="w-48">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stages.map((stage, stageIdx) => (
                          <tr key={`${stage.name}-${stageIdx}`}>
                            <td className="font-medium text-ink whitespace-nowrap">{shown(stage.name)}</td>
                            <td>
                              <div className="flex flex-wrap gap-1">
                                {stage.operations.map((operation, opIdx) => (
                                  <span key={`${stage.name}-${operation}-${opIdx}`} className="rounded bg-ground px-1.5 py-0.5 font-mono text-[10px] text-ink-muted border border-line">
                                    {operation}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="font-mono text-xs text-ink-muted whitespace-nowrap">
                              {rowCount(stage.input_rows)} / {rowCount(stage.output_rows)}
                            </td>
                            <td>
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 flex-1 rounded bg-ground overflow-hidden">
                                  <div
                                    className="h-full rounded bg-accent"
                                    style={{ width: `${Math.max(3, ((Number(stage.duration_ms) || 0) / maxStageMs) * 100)}%` }}
                                  />
                                </div>
                                <span className="w-16 text-right font-mono text-xs text-ink-muted">
                                  {stage.duration_ms != null ? `${Number(stage.duration_ms).toFixed(0)} ms` : '—'}
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
                  <div className="px-6 py-4 border-b border-line">
                    <h2 className="text-lg font-bold text-white">Speed check</h2>
                    <p className="text-xs text-ink-muted mt-0.5">Same word count done two ways</p>
                  </div>
                  {benchmark ? (
                    <div className="p-6 space-y-4">
                      <BenchmarkRow
                        label="Older RDD method"
                        ms={benchmark.rdd_ms}
                        terms={benchmark.rdd_terms}
                        winner={benchmark.fastest === 'RDD'}
                      />
                      <BenchmarkRow
                        label="DataFrame method"
                        ms={benchmark.dataframe_ms}
                        terms={benchmark.dataframe_terms}
                        winner={benchmark.fastest === 'DataFrame'}
                      />
                      <div className="rounded-lg border border-line bg-ground p-4">
                        <p className="text-xs uppercase tracking-widest text-ink-dim">Faster method</p>
                        <p className="text-2xl font-bold text-accent">{benchmark.fastest ?? '—'}</p>
                        <p className="text-xs text-ink-muted mt-1">
                          {benchmark.speedup_dataframe_vs_rdd != null
                            ? `${benchmark.speedup_dataframe_vs_rdd}× faster than the other method`
                            : 'Speed-up not recorded'}
                          {' · '}
                          {benchmark.match === true ? 'same result' : 'results differ'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="p-6 text-sm text-ink-muted">No speed check has run yet.</p>
                  )}
                </section>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <section className="card p-6">
                  <h2 className="text-lg font-bold text-white mb-1">Most common words</h2>
                  <p className="text-xs text-ink-muted mb-4">Words that appear most often across all filings</p>
                  <div className="flex flex-wrap gap-2">
                    {topTerms.slice(0, 24).map((term, idx) => (
                      <span key={`${term.term}-${idx}`} className="rounded-md border border-line bg-ground px-2 py-1 text-xs">
                        <span className="text-ink">{term.term}</span>
                        <span className="ml-1.5 font-mono text-accent">{term.count}</span>
                      </span>
                    ))}
                    {topTerms.length === 0 && (
                      <span className="text-xs text-ink-dim font-mono">No words recorded yet.</span>
                    )}
                  </div>
                </section>

                <section className="xl:col-span-2 card p-0 overflow-hidden">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-line">
                    <div>
                      <h2 className="text-lg font-bold text-white">Change flags</h2>
                      <p className="text-xs text-ink-muted mt-0.5">Places where the wording changed the most</p>
                    </div>
                    <span className="badge badge-red">{anomalies.length} flags</span>
                  </div>
                  <div className="overflow-x-auto max-h-[420px]">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Company</th>
                          <th>Change type</th>
                          <th>Section</th>
                          <th>Score</th>
                          <th>Text difference</th>
                          <th>Word difference</th>
                        </tr>
                      </thead>
                      <tbody>
                        {anomalies.slice(0, 20).map((signal, idx) => (
                          <tr key={`${signal.id ?? 'signal'}-${idx}`}>
                            <td className="font-mono font-bold text-accent">{shown(signal.ticker)}</td>
                            <td>
                              <span className={'badge ' + (signal.score > 0.7 ? 'badge-red' : signal.score > 0.4 ? 'badge-yellow' : 'badge-blue')}>
                                {String(signal.signal_type || 'change').replace(/_/g, ' ')}
                              </span>
                            </td>
                            <td className="text-xs text-ink-muted">
                              {signal.section_a ? String(signal.section_a).replace('item_', 'item ') : '—'}
                              {signal.section_b && signal.section_b !== signal.section_a
                                ? ` → ${String(signal.section_b).replace('item_', 'item ')}`
                                : ''}
                            </td>
                            <td className="font-mono font-bold text-white">
                              {signal.score != null ? Number(signal.score).toFixed(3) : '—'}
                            </td>
                            <td className="font-mono text-xs text-ink-muted">
                              {signal.details?.cosine_distance != null ? Number(signal.details.cosine_distance).toFixed(3) : '—'}
                            </td>
                            <td className="font-mono text-xs text-ink-muted">
                              {signal.details?.js_divergence != null ? Number(signal.details.js_divergence).toFixed(3) : '—'}
                            </td>
                          </tr>
                        ))}
                        {anomalies.length === 0 && (
                          <tr><td colSpan={6} className="text-center py-8 text-ink-muted">No change flags found.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <section className="card p-0 overflow-hidden">
                  <div className="px-6 py-4 border-b border-line">
                    <h2 className="text-lg font-bold text-white">Section sizes</h2>
                    <p className="text-xs text-ink-muted mt-0.5">How many words are in each section</p>
                  </div>
                  <div className="overflow-x-auto max-h-[360px]">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Company</th>
                          <th>Section</th>
                          <th>Words</th>
                          <th>Word variety</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sectionStats.slice(0, 18).map((row, index) => (
                          <tr key={`${row.filing_key}-${row.section_type}-${index}`}>
                            <td className="font-mono text-xs text-ink-muted">
                              {shown(row.ticker)} <span className="text-ink-dim">{row.filing_type}</span>
                            </td>
                            <td className="text-xs text-ink">
                              {row.section_type ? String(row.section_type).replace('item_', 'item ') : '—'}
                            </td>
                            <td className="font-mono text-xs">{rowCount(row.tokens)}</td>
                            <td className="font-mono text-xs text-ink-muted">
                              {row.normalised_entropy != null ? Number(row.normalised_entropy).toFixed(3) : '—'}
                            </td>
                          </tr>
                        ))}
                        {sectionStats.length === 0 && (
                          <tr><td colSpan={4} className="text-center py-8 text-ink-muted">No section data yet.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="card p-0 overflow-hidden">
                  <div className="px-6 py-4 border-b border-line">
                    <h2 className="text-lg font-bold text-white">Saved files</h2>
                    <p className="text-xs text-ink-muted mt-0.5">Files written by the last run</p>
                  </div>
                  <div className="divide-y divide-line">
                    {artifacts.map((artifact) => (
                      <div key={artifact.name} className="flex items-center justify-between px-6 py-3 text-sm">
                        <span className="font-mono text-ink">{artifact.name}</span>
                        <span className="text-xs text-ink-muted">
                          {artifact.format} · {artifact.rows != null ? `${artifact.rows} rows` : '—'} · {formatBytes(artifact.bytes)}
                        </span>
                      </div>
                    ))}
                    {artifacts.length === 0 && (
                      <div className="px-6 py-6 text-sm text-ink-muted">No files recorded for this run.</div>
                    )}
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
      <div className={`absolute top-0 left-0 h-full w-1 ${accent === 'danger' ? 'bg-red-500' : 'bg-accent'}`} />
      <p className="text-[10px] font-mono font-bold text-ink-dim tracking-widest uppercase mb-1">{title}</p>
      <p className={`text-2xl font-black font-mono tabular-nums ${accent === 'danger' ? 'text-red-400' : 'text-value'}`}>{value}</p>
    </div>
  );
}

function BenchmarkRow({
  label,
  ms,
  terms,
  winner,
}: {
  label: string;
  ms: number | null | undefined;
  terms: number | null | undefined;
  winner: boolean;
}) {
  return (
    <div className={`rounded-lg border p-4 ${winner ? 'border-accent/50 bg-accent/5' : 'border-line bg-ground'}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink">{label}</span>
        {winner && <span className="badge badge-yellow">faster</span>}
      </div>
      <div className="mt-2 flex items-end justify-between">
        <span className="text-2xl font-bold text-white tabular-nums">
          {ms != null ? `${Number(ms).toLocaleString()} ms` : '—'}
        </span>
        <span className="text-xs text-ink-muted font-mono">
          {terms != null ? `${Number(terms).toLocaleString()} words` : '—'}
        </span>
      </div>
    </div>
  );
}

function formatBytes(bytes: number | undefined): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
