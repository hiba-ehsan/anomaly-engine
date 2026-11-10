'use client';

import React from 'react';

export interface AnomalyDetails {
  cosine_distance?: number;
  js_divergence?: number;
  entropy_delta?: number;
  terms_added?: [string, number][];
  terms_removed?: [string, number][];
  explanation?: string;
}

export interface AnomalySignalItem {
  id?: string;
  ticker?: string;
  signal_type?: string;
  score?: number;
  section_a?: string;
  section_b?: string;
  filing_date?: string;
  detected_at?: string;
  severity?: string;
  rank?: number;
  details?: AnomalyDetails;
}

interface ContradictionModalProps {
  signal: AnomalySignalItem | null;
  isOpen: boolean;
  onClose: () => void;
}

function formatMetric(value?: number, digits = 3) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

export function ContradictionModal({ signal, isOpen, onClose }: ContradictionModalProps) {
  if (!isOpen || !signal) return null;

  const score = Number(signal.score || 0);
  const isHigh = score > 0.7;
  const isMid = score > 0.4 && score <= 0.7;
  const details = signal.details || {};
  const termsAdded = details.terms_added || [];
  const termsRemoved = details.terms_removed || [];

  const sectionAName = signal.section_a ? String(signal.section_a).replace('item_', 'Item ') : '—';
  const sectionBName = signal.section_b ? String(signal.section_b).replace('item_', 'Item ') : '—';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ground/85 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-2xl bg-panel border border-line shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-ground-tint shrink-0">
          <div className="flex items-center gap-3">
            <span className="w-3 h-3 bg-accent rounded-full animate-pulse" />
            <div>
              <span className="text-[10px] font-mono text-accent uppercase tracking-widest block">
                Why this was flagged
              </span>
              <h2 className="text-lg font-black uppercase tracking-tight text-white font-mono">
                {signal.ticker || '—'} · {signal.signal_type ? String(signal.signal_type).replace(/_/g, ' ') : 'change'}
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-ink-muted hover:text-white hover:bg-line/40 transition-colors font-mono text-lg"
          >
            ×
          </button>
        </div>

        {/* Metrics */}
        <div className="p-6 overflow-y-auto space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
            <div className="p-3 bg-ground border border-line">
              <span className="text-[10px] text-ink-dim block uppercase">Change score</span>
              <span className="text-2xl font-black text-value tabular-nums">{formatMetric(score)}</span>
            </div>
            <div className="p-3 bg-ground border border-line">
              <span className="text-[10px] text-ink-dim block uppercase">Text difference (0–1)</span>
              <span className="text-xl font-bold text-white tabular-nums">
                {formatMetric(details.cosine_distance)}
              </span>
            </div>
            <div className="p-3 bg-ground border border-line">
              <span className="text-[10px] text-ink-dim block uppercase">Vocabulary difference (0–1)</span>
              <span className="text-xl font-bold text-white tabular-nums">
                {formatMetric(details.js_divergence)}
              </span>
            </div>
            <div className="p-3 bg-ground border border-line">
              <span className="text-[10px] text-ink-dim block uppercase">Variety change</span>
              <span className={`text-xl font-bold tabular-nums ${Number(details.entropy_delta || 0) < 0 ? 'text-accent' : 'text-green-400'}`}>
                {formatMetric(details.entropy_delta, 2)}
              </span>
            </div>
          </div>

          {/* Sections compared */}
          <div>
            <div className="text-[10px] font-mono text-ink-dim uppercase tracking-widest mb-2">
              Sections compared
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3 bg-ground border border-line">
                <span className="text-[10px] font-mono text-accent uppercase font-bold block mb-1">Section in this filing</span>
                <p className="font-mono text-sm font-bold text-white">{sectionAName}</p>
                <p className="text-xs text-ink-dim mt-1 font-mono">
                  Company: {signal.ticker || '—'} · Date: {signal.filing_date || '—'}
                </p>
              </div>

              <div className="p-3 bg-ground border border-line">
                <span className="text-[10px] font-mono text-value uppercase font-bold block mb-1">Compared with</span>
                <p className="font-mono text-sm font-bold text-white">{sectionBName}</p>
                <p className="text-xs text-ink-dim mt-1 font-mono">
                  The same section in an earlier filing, or another section in the same filing.
                </p>
              </div>
            </div>
          </div>

          {/* Words that changed */}
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono text-ink-dim uppercase tracking-widest">
                  Words that became more common
                </span>
                <span className="text-[10px] font-mono text-ink-dim">Count from the data pipeline</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {termsAdded.length > 0 ? (
                  termsAdded.map(([term, count], idx) => (
                    <span
                      key={`${signal.id ?? 'sig'}-added-${term}-${idx}`}
                      className="px-2 py-1 bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-mono"
                    >
                      +{term} <span className="text-white/60 font-bold">({count})</span>
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-ink-dim font-mono italic">
                    No word-level data for this comparison.
                  </span>
                )}
              </div>
            </div>

            <div>
              <div className="text-[10px] font-mono text-ink-dim uppercase tracking-widest mb-2">
                Words that disappeared
              </div>
              <div className="flex flex-wrap gap-1.5">
                {termsRemoved.length > 0 ? (
                  termsRemoved.map(([term, count], idx) => (
                    <span
                      key={`${signal.id ?? 'sig'}-rem-${term}-${idx}`}
                      className="px-2 py-1 bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-mono"
                    >
                      -{term} <span className="text-white/60 font-bold">({count})</span>
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-ink-dim font-mono italic">
                    No word-level data for this comparison.
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Plain-language interpretation */}
          <div className="p-3.5 bg-ground border-l-2 border-accent text-xs font-sans text-ink-muted leading-relaxed">
            <span className="text-white font-semibold font-mono block text-[11px] mb-1">
              WHAT THIS MEANS
            </span>
            {isHigh ? (
              <span>
                The wording changed a lot here. That is a hint, not proof of a problem.
                Open the two sections and read them yourself.
              </span>
            ) : isMid ? (
              <span>
                The wording changed moderately. Worth a quick read of the section.
              </span>
            ) : (
              <span>
                Only a small wording change. Nothing unusual in this comparison.
              </span>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-line bg-ground-tint flex items-center justify-between text-xs font-mono shrink-0">
          <span className="text-ink-dim">
            FLAG ID: <span className="text-white">{String(signal.id || '—').slice(0, 16)}</span>
          </span>
          <button
            onClick={onClose}
            className="btn-kinetic !px-4 !py-1.5 text-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
