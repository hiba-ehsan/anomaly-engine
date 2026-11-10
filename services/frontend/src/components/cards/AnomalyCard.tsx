'use client';

import React from 'react';

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

export function AnomalyCard({
  signalType,
  score,
  detectedAt,
  sentence,
  cosineDistance,
  klDivergence,
  rank,
}: AnomalyCardProps) {
  const isHigh = score > 0.7;
  const isMid = score > 0.4 && score <= 0.7;
  const severityLabel = isHigh ? 'Big change' : isMid ? 'Notable change' : 'Small change';

  return (
    <article className="card p-5 flex flex-col justify-between transition-all duration-200 hover:border-line-strong hover:bg-ground-tint group">
      {/* Top Meta Bar */}
      <div>
        <div className="flex items-center justify-between gap-2 pb-3 mb-3 border-b border-line">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold px-1.5 py-0.5 bg-ground border border-line text-accent">
              {rank != null ? `#${rank}` : 'Flag'}
            </span>
            <span className="font-mono text-xs font-bold text-white uppercase tracking-wider">
              {signalType.replace(/_/g, ' ')}
            </span>
          </div>
          <span
            className={
              'badge ' +
              (isHigh
                ? 'badge-red'
                : isMid
                ? 'badge-orange'
                : 'badge-yellow')
            }
          >
            {severityLabel}
          </span>
        </div>

        {/* Primary Value Number */}
        <div className="flex items-baseline justify-between my-2">
          <span className="text-[10px] font-mono text-ink-dim uppercase tracking-widest">
            Change score
          </span>
          <span className="text-3xl font-mono font-bold text-value tabular-nums">
            {score.toFixed(3)}
          </span>
        </div>

        {/* Progress Bar with Kinetic Accent */}
        <div className="h-1 bg-ground border border-line overflow-hidden mb-3">
          <div
            className={`h-full transition-all duration-500 ${
              isHigh ? 'bg-red-500' : isMid ? 'bg-accent' : 'bg-value'
            }`}
            style={{ width: `${Math.min(100, Math.max(5, score * 100))}%` }}
          />
        </div>

        {/* Sentence Text / Description */}
        {sentence && (
          <p className="text-xs text-ink-muted line-clamp-3 leading-relaxed mb-4 font-sans bg-ground/60 p-2.5 border-l-2 border-line">
            "{sentence}"
          </p>
        )}
      </div>

      {/* Numerical Metrics Footer */}
      <div className="pt-3 border-t border-line grid grid-cols-2 gap-2 text-xs font-mono">
        <div>
          <span className="text-[10px] text-ink-dim block uppercase">Text difference</span>
          <span className="text-ink font-semibold">
            {cosineDistance != null ? cosineDistance.toFixed(3) : '—'}
          </span>
        </div>
        <div className="text-right">
          <span className="text-[10px] text-ink-dim block uppercase">Word difference</span>
          <span className="text-ink font-semibold">
            {klDivergence != null ? klDivergence.toFixed(3) : '—'}
          </span>
        </div>
      </div>
    </article>
  );
}
