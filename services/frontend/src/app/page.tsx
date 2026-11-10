'use client';

import { useCompanies, useAnomalies, useMarketPrices, usePipelineLatest } from '@/lib/hooks';
import { Sidebar } from '@/components/ui/Sidebar';
import { KineticTickerRibbon } from '@/components/ui/KineticTickerRibbon';
import { AddCompanyModal } from '@/components/modals/AddCompanyModal';
import { ContradictionModal, AnomalySignalItem } from '@/components/modals/ContradictionModal';
import { RddStageModal, RddStageInfo } from '@/components/modals/RddStageModal';
import { api } from '@/lib/api';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { PriceChart } from '@/components/charts/PriceChart';

/**
 * Extra detail for each processing step. Names, row counts and timings all come
 * from the API, so nothing here is a made-up measurement.
 */
const STAGE_GUIDE: Array<{
  type: RddStageInfo['type'];
  codeSnippet: string;
  rationale: string;
}> = [
  {
    type: 'Narrow (Zero Shuffle)',
    codeSnippet: `raw_rdd = sc.parallelize(records, 8)\nfilings_rdd = raw_rdd.map(normalise_filing).filter(lambda r: r is not None).persist(StorageLevel.MEMORY_AND_DISK)`,
    rationale: 'Turns the downloaded filings into the first Spark dataset, cleans each record, and keeps it in memory.',
  },
  {
    type: 'Narrow (Zero Shuffle)',
    codeSnippet: `section_rdd = filings_rdd.flatMap(lambda row: [\n    {"filing_key": row["filing_key"], "section_type": k, "text": v}\n    for k, v in row["sections"].items()\n]).filter(lambda row: len(row["text"]) > 400)`,
    rationale: 'Splits each filing into its named sections, such as risk factors and management discussion.',
  },
  {
    type: 'Narrow (Zero Shuffle)',
    codeSnippet: `sentence_rdd = section_rdd.mapPartitions(lambda part: (\n    sentence for sec in part for sentence in emit_sentences(sec)\n)).filter(lambda row: row["token_count"] > 3)`,
    rationale: 'Breaks every section into sentences so the wording can be compared.',
  },
  {
    type: 'Wide (Shuffle Dependency)',
    codeSnippet: `token_pairs = sentence_rdd.flatMap(lambda r: [(t, 1) for t in tokenize(r["text"])])\n.filter(lambda p: p[0] not in stopwords.value)\n.reduceByKey(lambda a, b: a + b)\ntop_terms = token_pairs.takeOrdered(50, key=lambda p: -p[1])`,
    rationale: 'Counts how often each word appears across all filings and keeps the most common words.',
  },
  {
    type: 'Wide (Shuffle Dependency)',
    codeSnippet: `doc_freq = tokens_rdd.combineByKey(\n    lambda doc_id: {doc_id},\n    lambda acc, doc_id: acc | {doc_id},\n    lambda acc1, acc2: acc1 | acc2\n).mapValues(len)`,
    rationale: 'Records how many different filings each word appears in, which helps weigh rare words.',
  },
  {
    type: 'Wide (Shuffle Dependency)',
    codeSnippet: `stats = section_tokens.aggregateByKey(\n    (0, 0.0), # (token_count, entropy_sum)\n    lambda acc, w: (acc[0] + 1, acc[1] + p_log_p(w)),\n    lambda a1, a2: (a1[0] + a2[0], a1[1] + a2[1])\n).join(section_metadata)`,
    rationale: 'Measures the size and word variety of every section in one pass.',
  },
  {
    type: 'Wide (Shuffle Dependency)',
    codeSnippet: `temporal = section_vectors.groupByKey()\n.map(lambda kv: (kv[0], sorted(list(kv[1]), key=lambda f: f["date"])))\n.flatMap(compute_temporal_divergence)`,
    rationale: 'Compares the same section across different filing dates to see what changed over time.',
  },
  {
    type: 'Wide (Shuffle Dependency)',
    codeSnippet: `cross = section_vectors.map(lambda kv: (kv[0][0], (kv[0][1], kv[1])))\n.groupByKey().flatMap(cross_section_features)`,
    rationale: 'Compares two sections of the same filing, for example risk factors against the management discussion.',
  },
  {
    type: 'Wide (Shuffle Dependency)',
    codeSnippet: `signals = temporal_features.map(_to_signal).union(cross_features.map(_to_signal))\n.filter(lambda s: s["score"] >= 0.01)\n.takeOrdered(30, key=lambda s: -s["score"])`,
    rationale: 'Turns every comparison into a ranked change flag, with the biggest changes first.',
  },
  {
    type: 'Narrow (Zero Shuffle)',
    codeSnippet: `chunk_rdd = section_rdd.mapPartitions(pack_sentences_into_chunks)\nchunk_df = spark.createDataFrame(chunk_rdd, schema=chunk_schema)\nchunk_df.write.mode("overwrite").parquet("chunks.parquet")`,
    rationale: 'Groups sentences into short passages and saves them as Parquet files for the language model step.',
  },
  {
    type: 'Wide (Shuffle Dependency)',
    codeSnippet: `# RDD path:\nrdd_cnt = parquet_rdd.flatMap(tok).map(lambda w: (w, 1)).reduceByKey(add).count()\n# DataFrame path:\ndf_cnt = parquet_df.groupBy("word").count().count()`,
    rationale: 'Runs the same word count twice, once with the older RDD API and once with the DataFrame API, then compares the results and speed.',
  },
  {
    type: 'Wide (Shuffle Dependency)',
    codeSnippet: `lines = sc.textFile("section_stats.csv", minPartitions=8)\nheader = lines.first()\nlow_detail = lines.filter(lambda l: l != header).filter(tokens_lt_500)\n.map(lambda r: (r[0], 1)).reduceByKey(add).collect()`,
    rationale: 'Performs a second check on section statistics and confirms both Spark APIs return the same counts.',
  },
];

function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString();
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

const RDD_STAGES_INFO: RddStageInfo[] = [];

export default function Dashboard() {
  const {
    data: companiesData,
    mutate: mutateCompanies,
    isLoading: companiesLoading,
  } = useCompanies(20);
  const {
    data: pipelineData,
    mutate: mutatePipeline,
    isLoading: pipelineLoading,
  } = usePipelineLatest();
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedSignal, setSelectedSignal] = useState<AnomalySignalItem | null>(null);
  const [selectedStage, setSelectedStage] = useState<RddStageInfo | null>(null);
  const [now, setNow] = useState<string>('');
  const [runningSpark, setRunningSpark] = useState(false);
  const [sparkStatus, setSparkStatus] = useState<string | null>(null);

  const companies = companiesData?.companies ?? [];
  const companyTotal = companiesData?.total ?? companies.length;
  const firstTicker = selectedTicker || (companies.length > 0 ? companies[0].ticker : null);
  const { data: anomaliesData, isLoading: anomaliesLoading } = useAnomalies(
    firstTicker ? { ticker: firstTicker, minScore: 0.3 } : null
  );
  const { data: pricesData, isLoading: pricesLoading } = useMarketPrices(firstTicker, 200);

  const anomalySignals = anomaliesData?.signals ?? [];
  const recentAnomalies = anomalySignals.slice(0, 6);
  const totalAnomalies = anomaliesData?.total ?? anomalySignals.length;
  const highSeverity = anomalySignals.filter((a) => Number(a.score) > 0.7).length;

  const benchmark = pipelineData?.benchmark;
  const counts = pipelineData?.counts || {};
  const lastRunId = pipelineData?.run_id ?? null;
  const sparkVersion = pipelineData?.spark_version ?? null;
  const master = pipelineData?.master ?? null;

  const liveStages: RddStageInfo[] = Array.isArray(pipelineData?.stages)
    ? pipelineData.stages.map((stage: any, idx: number) => {
        const guide = STAGE_GUIDE[idx];
        return {
          index: idx + 1,
          name: stage?.name ?? `Step ${idx + 1}`,
          operations: Array.isArray(stage?.operations) ? stage.operations : [],
          type: guide?.type ?? 'Narrow (Zero Shuffle)',
          codeSnippet: guide?.codeSnippet ?? '',
          inRows: formatNumber(stage?.input_rows),
          outRows: formatNumber(stage?.output_rows),
          rationale: guide?.rationale ?? '',
        };
      })
    : RDD_STAGES_INFO;

  const lastRunDate = formatDate(pipelineData?.completed_at);

  useEffect(() => {
    setNow(new Date().toLocaleTimeString());
    const timer = setInterval(() => setNow(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleRunSpark = async () => {
    setRunningSpark(true);
    setSparkStatus('Starting the analysis…');
    try {
      const job = await api.pipeline.run(undefined, false);
      if (!job?.job_id) {
        throw new Error('The server did not return a job ID.');
      }

      setSparkStatus('The analysis is running…');
      let status = job;
      while (status.status === 'queued' || status.status === 'running') {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        status = await api.pipeline.status(job.job_id);
        setSparkStatus(`The analysis is running (${status.status})…`);
      }

      if (status.status !== 'completed') {
        throw new Error(status.error || `The job stopped with status "${status.status}".`);
      }

      await mutatePipeline();
      setSparkStatus('Finished. The latest results are now shown.');
      setTimeout(() => setSparkStatus(null), 4000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setSparkStatus(`The analysis failed: ${message}`);
    }
    setRunningSpark(false);
  };

  return (
    <div className="flex h-screen bg-ground text-ink overflow-hidden">
      <div className="hidden lg:block shrink-0">
        <Sidebar />
      </div>

      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <KineticTickerRibbon />

        <header className="sticky top-0 z-10 bg-ground-tint/95 backdrop-blur border-b border-line">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div>
                <span className="text-[10px] font-mono text-accent uppercase tracking-widest block">
                  Overview
                </span>
                <h1 className="text-2xl font-black uppercase tracking-tight text-white leading-none">
                  What changed in company filings
                </h1>
              </div>
              <span className="badge badge-accent">
                {companiesLoading
                  ? 'Loading…'
                  : `${companyTotal} ${companyTotal === 1 ? 'company' : 'companies'}`}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <span className="hidden sm:inline-block text-xs text-ink-dim font-mono">
                Time: <span className="text-white">{now}</span>
              </span>
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="btn-kinetic !px-4 !py-2 text-xs flex items-center gap-1.5"
              >
                <span>Add company</span>
                <span className="font-mono">→</span>
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Companies tracked"
              value={companiesLoading ? '…' : companyTotal}
              accent="accent"
              label={
                companiesLoading
                  ? 'Loading the company list…'
                  : firstTicker
                  ? `Selected: ${firstTicker}`
                  : 'No company selected yet'
              }
            />
            <StatCard
              title="Change flags"
              value={totalAnomalies}
              accent="value"
              label={firstTicker ? `Found for ${firstTicker}` : 'Pick a company to see its flags'}
            />
            <StatCard
              title="Big changes"
              value={highSeverity}
              accent="red"
              label="Change score above 0.70"
            />
            <StatCard
              title="Last analysis"
              value={lastRunDate}
              accent="green"
              label={
                pipelineLoading
                  ? 'Loading the latest run…'
                  : lastRunId
                  ? `Run ${String(lastRunId).slice(0, 11)}`
                  : 'No analysis has run yet'
              }
            />
          </div>

          <section className="card p-0 border border-line bg-panel overflow-hidden">
            <div className="flex flex-wrap items-center justify-between px-6 py-4 border-b border-line bg-ground-tint">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 bg-accent rounded-full animate-pulse" />
                <div>
                  <span className="text-[10px] font-mono text-accent uppercase tracking-widest block">
                    Data pipeline
                  </span>
                  <h2 className="text-lg font-black uppercase tracking-tight text-white font-mono">
                    How the filings are processed
                  </h2>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleRunSpark}
                  disabled={runningSpark}
                  className="btn-kinetic !py-1.5 !px-3 text-xs flex items-center gap-1.5"
                >
                  <span>{runningSpark ? 'Running…' : 'Run the analysis'}</span>
                  <span className="font-mono">→</span>
                </button>
                <Link
                  href="/pipeline"
                  className="btn-secondary !py-1.5 !px-3 text-xs font-mono"
                  title="See every step in detail"
                >
                  Full details →
                </Link>
              </div>
            </div>

            {sparkStatus && (
              <div className="px-6 py-2.5 bg-ground border-b border-line text-xs font-mono text-value flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-value rounded-full animate-ping" />
                <span>{sparkStatus}</span>
              </div>
            )}

            <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-mono text-ink-dim uppercase tracking-widest">
                      Steps in order (click a step for its code)
                    </span>
                    <span className="text-[10px] font-mono text-accent">Click to open</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
                    {liveStages.length > 0 ? (
                      liveStages.map((step, idx) => (
                        <button
                          key={`${step.name}-${idx}`}
                          type="button"
                          onClick={() => setSelectedStage(step)}
                          className="px-2 py-1 bg-ground border border-line text-ink-muted hover:border-accent hover:text-white transition-all text-left flex items-center group cursor-pointer"
                          title="Show the code for this step"
                        >
                          <span className="text-accent font-bold mr-1">#{step.index}</span>
                          <span className="text-white font-semibold group-hover:text-accent transition-colors">
                            {step.operations[0] || step.name}
                          </span>
                          <span className="text-[9px] text-ink-dim ml-1">({step.name})</span>
                        </button>
                      ))
                    ) : (
                      <span className="text-xs text-ink-dim font-mono">
                        {pipelineLoading
                          ? 'Loading the pipeline steps…'
                          : 'No pipeline run yet. Run the analysis to see the steps.'}
                      </span>
                    )}
                  </div>
                </div>

                <div className="pt-3 border-t border-line grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                  <MetricBox label="Filings read" value={formatNumber(counts.filings)} />
                  <MetricBox label="Sections found" value={formatNumber(counts.sections)} />
                  <MetricBox label="Sentences" value={formatNumber(counts.sentences)} valueClass="text-value" />
                  <MetricBox label="Passages saved" value={formatNumber(counts.chunks)} valueClass="text-accent" />
                </div>
              </div>

              <div className="lg:col-span-5 bg-ground p-4 border border-line flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-mono text-ink-dim uppercase tracking-widest">
                      Speed check: same word count, two methods
                    </span>
                    <span
                      className={`badge font-mono text-[10px] ${
                        benchmark?.match === true ? 'badge-green' : 'badge-gray'
                      }`}
                    >
                      {benchmark?.match === true ? 'Same result' : '—'}
                    </span>
                  </div>

                  <div className="space-y-2 font-mono text-xs mb-3">
                    <div className="flex items-center justify-between p-2 bg-panel border border-line">
                      <span className="text-ink">Older RDD method</span>
                      <span className="text-white font-bold">
                        {benchmark?.rdd_ms != null ? `${formatNumber(benchmark.rdd_ms)} ms` : '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between p-2 bg-panel border border-line">
                      <span className="text-accent">DataFrame method</span>
                      <span className="text-value font-bold">
                        {benchmark?.dataframe_ms != null ? `${formatNumber(benchmark.dataframe_ms)} ms` : '—'}
                      </span>
                    </div>
                  </div>

                  <p className="text-[11px] text-ink-dim leading-relaxed font-sans">
                    {benchmark?.speedup_dataframe_vs_rdd != null ? (
                      <>
                        The DataFrame method was{' '}
                        <span className="text-value font-bold">
                          {benchmark.speedup_dataframe_vs_rdd}× faster
                        </span>{' '}
                        on the same data.
                      </>
                    ) : (
                      'No speed comparison has been recorded yet.'
                    )}
                  </p>
                </div>

                <div className="mt-3 pt-3 border-t border-line flex items-center justify-between text-[10px] font-mono text-ink-dim">
                  <span>
                    Spark {sparkVersion ?? '—'}
                    {master ? ` · ${master}` : ''}
                  </span>
                  <span className="text-accent font-semibold">
                    {benchmark?.match === true ? 'Both methods agree' : 'Waiting for a run'}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className="card p-0">
            <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-ground-tint">
              <div>
                <span className="text-[10px] font-mono text-ink-dim uppercase tracking-wider block">
                  Stock price
                </span>
                <h3 className="text-lg font-bold text-white uppercase tracking-tight">
                  {firstTicker ? (
                    <span>
                      {firstTicker} <span className="text-ink-dim font-normal">· price and flag dates</span>
                    </span>
                  ) : (
                    'No company selected'
                  )}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="badge badge-yellow">
                  {firstTicker
                    ? anomaliesLoading
                      ? 'Loading flags…'
                      : `${anomalySignals.length} flags marked`
                    : 'No flags'}
                </span>
              </div>
            </div>

            <div className="p-4">
              {firstTicker && pricesData?.prices && pricesData.prices.length > 0 ? (
                <PriceChart prices={pricesData.prices} anomalies={anomalySignals} height={340} />
              ) : companiesLoading || (firstTicker && pricesLoading) ? (
                <div className="h-[320px] flex items-center justify-center text-ink-dim font-mono text-xs uppercase tracking-wider bg-ground/50 border border-line m-2">
                  Loading the price chart…
                </div>
              ) : (
                <div className="h-[320px] flex flex-col items-center justify-center gap-3 text-ink-dim bg-ground/50 border border-line m-2">
                  <div className="text-accent font-mono text-sm uppercase tracking-wider">
                    No price data yet
                  </div>
                  <p className="text-xs max-w-md text-center text-ink-muted">
                    Stock prices are not loaded for this company. You can still read its change flags below,
                    or run the analysis to refresh the data.
                  </p>
                  <button onClick={handleRunSpark} className="btn-kinetic text-xs mt-2">
                    Run the analysis →
                  </button>
                </div>
              )}
            </div>
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 card p-0 flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-ground-tint">
                <div>
                  <span className="text-[10px] font-mono text-accent uppercase tracking-wider block">
                    Companies
                  </span>
                  <h2 className="text-lg font-bold text-white uppercase tracking-tight">
                    Companies being watched
                  </h2>
                </div>
                <button
                  onClick={() => setIsAddModalOpen(true)}
                  className="btn-secondary !py-1.5 !px-3 text-xs flex items-center gap-1 font-mono"
                >
                  <span>+ Add company</span>
                </button>
              </div>

              <div className="flex-1 overflow-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Company name</th>
                      <th>Industry</th>
                      <th>Country</th>
                      <th className="text-right">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companies.map((company, cIdx) => (
                      <tr
                        key={`${company.id ?? company.ticker}-${cIdx}`}
                        onClick={() => setSelectedTicker(company.ticker)}
                        className={`cursor-pointer transition-colors ${
                          selectedTicker === company.ticker ? 'bg-line/30 border-l-2 border-l-accent' : ''
                        }`}
                      >
                        <td className="font-mono font-bold text-value text-sm">{company.ticker}</td>
                        <td className="text-white font-medium">{company.name}</td>
                        <td className="text-ink-muted text-xs">{company.sector || '—'}</td>
                        <td>
                          <span className="badge badge-gray">{company.jurisdiction || '—'}</span>
                        </td>
                        <td className="text-right">
                          <Link
                            href={'/companies/' + company.ticker}
                            className="inline-flex items-center gap-1 text-xs font-mono font-bold text-accent hover:text-accent-warm"
                          >
                            Open →
                          </Link>
                        </td>
                      </tr>
                    ))}
                    {companies.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center py-10 text-ink-dim font-mono text-xs">
                          {companiesLoading
                            ? 'Loading companies…'
                            : 'No companies yet. Add one to get started.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card p-0 flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-ground-tint">
                <div>
                  <span className="text-[10px] font-mono text-value uppercase tracking-wider block">
                    Recent findings
                  </span>
                  <h3 className="text-lg font-bold text-white uppercase tracking-tight">
                    Latest change flags
                  </h3>
                </div>
                <Link href="/anomalies" className="text-xs font-mono text-accent hover:underline">
                  See all →
                </Link>
              </div>

              <div className="flex-1 overflow-auto divide-y divide-line">
                {recentAnomalies.length > 0 ? (
                  recentAnomalies.map((anomaly, idx) => (
                    <div
                      key={`${anomaly.id ?? 'signal'}-${idx}`}
                      onClick={() => setSelectedSignal(anomaly)}
                      className="p-4 hover:bg-ground-tint/80 transition-colors cursor-pointer group"
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className={'badge ' + severityBadge(Number(anomaly.score))}>
                          {String(anomaly.signal_type || 'change').replace(/_/g, ' ')}
                        </span>
                        <span className="font-mono font-bold text-value text-sm">
                          {Number(anomaly.score).toFixed(3)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs font-mono text-ink-dim">
                        <span>
                          {anomaly.ticker || firstTicker || '—'}
                          <span className="mx-1.5 text-line">·</span>
                          {formatDate(anomaly.filing_date || anomaly.detected_at)}
                        </span>
                        <span className="text-[10px] text-accent font-bold group-hover:underline">
                          Details →
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-xs font-mono text-ink-dim flex flex-col items-center justify-center gap-2">
                    <span className="w-8 h-8 rounded-full border border-dashed border-line flex items-center justify-center text-ink-dim">
                      0
                    </span>
                    <span>
                      {anomaliesLoading
                        ? `Loading the change flags for ${firstTicker ?? 'this company'}…`
                        : firstTicker
                        ? `No change flags for ${firstTicker} yet.`
                        : 'Select a company to see its change flags.'}
                    </span>
                    <button onClick={handleRunSpark} className="text-accent hover:underline mt-1 font-mono text-xs">
                      Run the analysis →
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>
        </main>
      </div>

      <AddCompanyModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={() => mutateCompanies()}
      />

      <ContradictionModal
        signal={selectedSignal}
        isOpen={Boolean(selectedSignal)}
        onClose={() => setSelectedSignal(null)}
      />

      <RddStageModal
        stage={selectedStage}
        isOpen={Boolean(selectedStage)}
        onClose={() => setSelectedStage(null)}
      />
    </div>
  );
}

function severityBadge(score: number): string {
  if (score > 0.7) return 'badge-red';
  if (score > 0.4) return 'badge-orange';
  return 'badge-yellow';
}

function MetricBox({
  label,
  value,
  valueClass = 'text-white',
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="p-2.5 bg-ground border border-line">
      <span className="text-[10px] text-ink-dim block uppercase">{label}</span>
      <span className={`font-bold text-base ${valueClass}`}>{value}</span>
    </div>
  );
}

function StatCard({
  title,
  value,
  accent = 'accent',
  label,
}: {
  title: string;
  value: number | string;
  accent?: 'accent' | 'value' | 'green' | 'red';
  label?: string;
}) {
  const accentBorder = {
    accent: 'border-l-accent',
    value: 'border-l-value',
    green: 'border-l-green-500',
    red: 'border-l-red-500',
  };

  const accentColor = {
    accent: 'text-accent',
    value: 'text-value',
    green: 'text-green-400',
    red: 'text-red-400',
  };

  return (
    <div className={`stat-card border-l-4 ${accentBorder[accent]}`}>
      <p className="text-[10px] font-mono text-ink-dim uppercase tracking-widest mb-1">{title}</p>
      <p className={`text-3xl font-black tabular-nums tracking-tight font-mono ${accentColor[accent]}`}>
        {value}
      </p>
      {label && <p className="mt-1 text-xs text-ink-muted font-sans">{label}</p>}
    </div>
  );
}
