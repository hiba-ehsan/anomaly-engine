'use client';

import type { ReactNode } from 'react';
import { useCountUp } from '@/lib/useCountUp';

export function CountUpStat({
  title,
  value,
  label,
  accent = 'yellow',
}: {
  title: string;
  value: number;
  label?: string;
  accent?: 'yellow' | 'green' | 'red';
}) {
  const display = useCountUp(value);

  const accentBar = {
    yellow: 'bg-yellow-500',
    green: 'bg-green-500',
    red: 'bg-red-500',
  };

  return (
    <div className="stat-card relative overflow-hidden">
      <div className={'absolute top-0 left-0 w-1 h-full ' + accentBar[accent]}></div>
      <p className="text-xs font-semibold text-navy-400 tracking-widest uppercase mb-1">{title}</p>
      <p className="text-3xl font-bold text-white tabular-nums">{Math.round(display)}</p>
      {label && <p className="mt-1 text-xs text-navy-500">{label}</p>}
    </div>
  );
}
