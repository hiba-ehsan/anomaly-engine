'use client';

export interface AnomalyCardProps {
  id?: string;
  signalType: string;
  score: number;
  detectedAt: string;
  sentence?: string;
  cosineDistance?: number;
  klDivergence?: number;
  rank?: number;
}

const GRADIENT = {
  high: 'from-cyan-400 via-violet-500 to-fuchsia-500',
  mid: 'from-cyan-400/70 via-violet-500/60 to-fuchsia-500/50',
  low: 'from-cyan-400/30 via-violet-500/25 to-fuchsia-500/20',
};

export function AnomalyCard({ signalType, score, detectedAt, sentence, cosineDistance, klDivergence, rank }: AnomalyCardProps) {
  const severity = score > 0.7 ? 'high' : score > 0.4 ? 'mid' : 'low';
  const pct = Math.round(score * 100);
  const severityLabel = severity === 'high' ? 'Critical' : severity === 'mid' ? 'Elevated' : 'Watch';

  return (
    <article className="group relative overflow-hidden rounded-xl bg-navy-950/60 p-px">
      <div className={'absolute inset-0 rounded-xl bg-gradient-to-br ' + GRADIENT[severity] + ' opacity-90'} />
      <div className="absolute inset-px rounded-[11px] bg-navy-950/90" />
      <div className="relative z-10 p-5 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-navy-900 border border-white/10 font-mono text-[11px] text-cyan-300 tabular-nums">
              {rank != null ? rank : '#'}
            </span>
            <span className="font-mono text-sm font-semibold text-cyan-300 uppercase tracking-wide">{signalType.replace(/_/g, ' ')}</span>
          </div>
          <span
            className={
              'inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-medium tabular-nums ' +
              (severity === 'high'
                ? 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300'
                : severity === 'mid'
                  ? 'border-violet-500/40 bg-violet-500/10 text-violet-300'
                  : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300')
            }
          >
            {severityLabel}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 rounded-full bg-navy-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-500 transition-[width] duration-700 ease-out"
              style={{ width: pct + '%' }}
            />
          </div>
          <span className="font-mono text-lg font-bold text-white tabular-nums leading-none">
            {score.toFixed(2)}
          </span>
        </div>

        {sentence && (
          <p className="text-sm text-navy-300 line-clamp-3 border-l-2 border-cyan-500/30 pl-3">{sentence}</p>
        )}

        <div className="flex items-center gap-4 text-navy-400 font-mono text-[11px]">
          {cosineDistance != null && (
            <span className="flex items-center gap-1">
              <span className="text-navy-500">Δcos</span>
              <span className="text-navy-200 tabular-nums">{cosineDistance.toFixed(3)}</span>
            </span>
          )}
          {klDivergence != null && (
            <span className="flex items-center gap-1">
              <span className="text-navy-500">KL</span>
              <span className="text-navy-200 tabular-nums">{klDivergence.toFixed(2)}</span>
            </span>
          )}
          <span className="ml-auto text-navy-500">{new Date(detectedAt).toLocaleDateString()}</span>
        </div>
      </div>
    </article>
  );
}
