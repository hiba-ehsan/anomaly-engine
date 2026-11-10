'use client';

import { useAnomaly } from '@/lib/hooks';
import { Sidebar } from '@/components/ui/Sidebar';
import Link from 'next/link';
import { useParams } from 'next/navigation';

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

function formatMetric(value?: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(4) : '—';
}

export default function AnomalyDetailPage() {
  const params = useParams();
  const signalId = params.id as string;
  const { data: signal, isLoading, error } = useAnomaly(signalId);

  return (
    <div className="flex h-screen bg-navy-950">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <header className="sticky top-0 z-10 bg-navy-950/90 backdrop-blur border-b border-navy-800">
          <div className="flex items-center gap-4 px-6 py-4">
            <Link
              href="/anomalies"
              className="inline-flex items-center gap-1.5 text-navy-300 hover:text-yellow-400 font-medium text-sm transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Change flags
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-white">
                {signal?.signal_type ? signal.signal_type.replace(/_/g, ' ') : 'Change flag'}
              </h1>
              <p className="text-sm text-navy-400">
                {signal?.ticker || 'Loading…'} · {signalId.slice(0, 8)}
              </p>
            </div>
          </div>
        </header>

        <main className="p-6 space-y-6">
          {isLoading ? (
            <div className="flex justify-center py-24">
              <div className="w-10 h-10 rounded-full border-4 border-yellow-500 border-t-transparent animate-spin" />
            </div>
          ) : error || !signal ? (
            <div className="card p-10 text-center">
              <h2 className="text-xl font-bold text-white mb-2">This change flag was not found</h2>
              <p className="text-navy-400 mb-6">
                It may belong to an older analysis. Run the analysis again and try once more.
              </p>
              <Link href="/anomalies" className="btn-primary inline-flex">
                Back to change flags
              </Link>
            </div>
          ) : (
            <>
              <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Metric
                  title="Change score"
                  value={signal.score != null ? Number(signal.score).toFixed(3) : '—'}
                  accent={Number(signal.score) > 0.7}
                />
                <Metric title="Level" value={signal.severity || '—'} />
                <Metric title="Company" value={signal.ticker || (signal.company_id ? signal.company_id.slice(0, 8) : '—')} />
                <Metric title="Found on" value={formatDate(signal.detected_at || signal.filing_date)} />
              </section>

              <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card p-6">
                  <h2 className="text-lg font-bold text-white mb-4">What was compared</h2>
                  <dl className="space-y-3">
                    <Row label="Text difference (0–1)" value={formatMetric(signal.details?.cosine_distance)} />
                    <Row label="Word mix difference (0–1)" value={formatMetric(signal.details?.js_divergence)} />
                    <Row label="Word variety change" value={formatMetric(signal.details?.entropy_delta)} />
                    <Row
                      label="Section in this filing"
                      value={signal.section_a ? String(signal.section_a).replace('item_', 'Item ') : '—'}
                    />
                    <Row
                      label="Compared with"
                      value={signal.section_b ? String(signal.section_b).replace('item_', 'Item ') : '—'}
                    />
                    <Row label="Rank in this run" value={signal.rank ?? '—'} />
                  </dl>
                </div>

                <div className="card p-6">
                  <h2 className="text-lg font-bold text-white mb-4">Filings compared</h2>
                  <div className="space-y-3 text-sm">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-navy-400 mb-1">This filing</p>
                      {signal.filing_a_id ? (
                        <Link
                          href={`/companies/${signal.ticker}/filings/${signal.filing_a_id}`}
                          className="font-mono text-yellow-400 hover:text-yellow-300"
                        >
                          {String(signal.filing_a_id).slice(0, 16)}
                        </Link>
                      ) : (
                        <span className="font-mono text-navy-400">—</span>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-navy-400 mb-1">
                        Compared with
                      </p>
                      {signal.filing_b_id ? (
                        <Link
                          href={`/companies/${signal.ticker}/filings/${signal.filing_b_id}`}
                          className="font-mono text-yellow-400 hover:text-yellow-300"
                        >
                          {String(signal.filing_b_id).slice(0, 16)}
                        </Link>
                      ) : (
                        <span className="font-mono text-navy-400">—</span>
                      )}
                    </div>
                    <p className="text-navy-400 pt-2">
                      A higher score means the wording in this section changed more than usual. It is a hint
                      that the section is worth reading, not proof of a problem.
                    </p>
                  </div>
                </div>
              </section>

              <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <TermPanel
                  title="Words that became more common"
                  terms={signal.details?.terms_added}
                  tone="text-emerald-400"
                />
                <TermPanel
                  title="Words that disappeared"
                  terms={signal.details?.terms_removed}
                  tone="text-rose-400"
                />
              </section>

              {signal.details?.key_sentences && signal.details.key_sentences.length > 0 && (
                <section className="card p-6">
                  <h2 className="text-lg font-bold text-white mb-4">Sentences worth reading</h2>
                  <ul className="space-y-3">
                    {signal.details.key_sentences.map((sentence, idx) => (
                      <li
                        key={`${sentence}-${idx}`}
                        className="border-l-2 border-yellow-500/50 pl-4 text-navy-200 text-sm"
                      >
                        {sentence}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function Metric({ title, value, accent = false }: { title: string; value: string | number; accent?: boolean }) {
  return (
    <div className={`stat-card ${accent ? 'stat-card-negative' : ''}`}>
      <p className="text-xs font-semibold text-navy-400 tracking-wide uppercase mb-1">{title}</p>
      <p className="text-2xl font-bold text-white tabular-nums capitalize">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-navy-800/70 pb-2">
      <dt className="text-navy-400 text-sm">{label}</dt>
      <dd className="text-navy-100 font-mono text-sm text-right">{value}</dd>
    </div>
  );
}

function TermPanel({
  title,
  terms,
  tone,
}: {
  title: string;
  terms?: [string, number][];
  tone: string;
}) {
  return (
    <div className="card p-6">
      <h2 className="text-lg font-bold text-white mb-4">{title}</h2>
      {terms && terms.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {terms.map(([term, count], idx) => (
            <span key={`${term}-${idx}`} className="px-2.5 py-1 rounded-md bg-navy-800 text-sm">
              <span className={tone}>{term}</span>
              <span className="text-navy-400 font-mono text-xs ml-1.5">×{count}</span>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-navy-400 text-sm">No word-level data for this comparison.</p>
      )}
    </div>
  );
}
