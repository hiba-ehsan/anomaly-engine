'use client';

export type MatrixSeverity = 'high' | 'elevated' | 'watch';

export function severityFromScore(score: number): MatrixSeverity {
  if (score > 0.7) return 'high';
  if (score > 0.45) return 'elevated';
  return 'watch';
}

export function severityLabel(severity: MatrixSeverity): string {
  return severity === 'high' ? 'CRITICAL' : severity === 'elevated' ? 'ELEVATED' : 'WATCH';
}
