'use client';

import React from 'react';
import { useCompanies, usePipelineLatest, useHealth } from '@/lib/hooks';

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString();
}

export function KineticTickerRibbon() {
  const { data: companiesData, isLoading: companiesLoading } = useCompanies(500);
  const { data: pipeline, isLoading: pipelineLoading } = usePipelineLatest();
  const { data: health, isLoading: healthLoading } = useHealth();

  const companyTotal = companiesData?.total ?? companiesData?.companies?.length ?? null;
  const counts = pipeline?.counts || {};
  const lastRun = formatDate(pipeline?.completed_at);

  const items = [
    {
      label: 'BACKEND',
      value: health ? 'Online' : healthLoading ? 'Checking…' : 'Not reachable',
      status: health ? 'accent' : 'normal',
    },
    {
      label: 'COMPANIES',
      value: companyTotal != null ? `${companyTotal} tracked` : companiesLoading ? 'Loading…' : 'None yet',
      status: 'normal',
    },
    {
      label: 'LAST ANALYSIS',
      value: lastRun || (pipelineLoading ? 'Loading…' : 'No run yet'),
      status: 'normal',
    },
    {
      label: 'FILINGS',
      value: counts.filings != null ? `${counts.filings} processed` : pipelineLoading ? 'Loading…' : 'No data',
      status: 'normal',
    },
    {
      label: 'CHANGES FOUND',
      value: counts.anomalies != null ? `${counts.anomalies} flags` : pipelineLoading ? 'Loading…' : 'No data',
      status: 'value',
    },
    {
      label: 'ENGINE',
      value: pipeline?.spark_version ? `Spark ${pipeline.spark_version}` : 'Spark',
      status: 'accent',
    },
  ];

  return (
    <div className="kinetic-marquee-container py-1.5 px-4 text-xs font-mono flex items-center select-none" aria-label="System status">
      <div className="flex items-center gap-2 pr-4 border-r border-line shrink-0 z-10 bg-ground">
        <span className={`w-2 h-2 rounded-full ${health ? 'bg-accent animate-pulse' : 'bg-ink-dim'}`} />
        <span className="text-[10px] uppercase font-bold text-ink tracking-wider">SYSTEM STATUS:</span>
      </div>

      <div className="overflow-hidden whitespace-nowrap flex-1">
        <div className="kinetic-marquee-track">
          {[...items, ...items, ...items].map((item, idx) => (
            <span key={idx} className="inline-flex items-center mx-4 gap-2 text-ink-muted">
              <span className="text-ink-dim text-[10px] tracking-widest">{item.label}</span>
              <span
                className={
                  item.status === 'accent'
                    ? 'text-accent font-bold'
                    : item.status === 'value'
                    ? 'text-value font-bold'
                    : 'text-ink font-medium'
                }
              >
                {item.value}
              </span>
              <span className="text-line mx-2">/</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
