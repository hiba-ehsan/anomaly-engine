'use client';

import { AnomalyCard, type AnomalyCardProps } from '@/components/cards/AnomalyCard';
import { severityFromScore } from '@/lib/severity';
import { CountUpStat } from '@/components/stats/CountUpStat';

const svg = {
  path: 'M12 3v18M3 12h0l3-3M21 12h0l-3-3',
};

export function AnomalyGrid({ anomalies, total }: { anomalies: AnomalyCardProps[]; total?: number }) {
  if (!anomalies || anomalies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <span className="inline-flex w-10 h-10 items-center justify-center rounded-full border border-dashed border-navy-600 text-navy-500">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d={svg.path} />
          </svg>
        </span>
        <p className="text-sm text-navy-400">No change flags found yet.</p>
        {total != null && total > 0 && (
          <p className="text-xs text-navy-500 font-mono">{total} changes scored below the current minimum</p>
        )}
      </div>
    );
  }

  const severityOrder: Record<string, number> = { high: 0, elevated: 1, watch: 2 };
  const sorted = [...anomalies].sort(
    (a, b) =>
      severityOrder[severityFromScore(b.score)] -
        severityOrder[severityFromScore(a.score)] ||
      b.score - a.score
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8 gap-y-6">
      {sorted.map((anomaly, index) => (
        <AnomalyCard key={`${anomaly.id ?? anomaly.signalType}-${index}`} {...anomaly} />
      ))}
    </div>
  );
}
