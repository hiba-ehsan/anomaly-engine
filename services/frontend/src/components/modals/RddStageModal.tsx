'use client';

import React from 'react';

export interface RddStageInfo {
  index: number;
  name: string;
  operations: string[];
  type: 'Narrow (Zero Shuffle)' | 'Wide (Shuffle Dependency)';
  codeSnippet: string;
  inRows: string | number;
  outRows: string | number;
  rationale: string;
}

interface RddStageModalProps {
  stage: RddStageInfo | null;
  isOpen: boolean;
  onClose: () => void;
}

export function RddStageModal({ stage, isOpen, onClose }: RddStageModalProps) {
  if (!isOpen || !stage) return null;

  const isWide = stage.type.includes('Wide');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ground/85 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-2xl bg-panel border border-line shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-ground-tint shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm px-2 py-0.5 bg-accent text-ground font-black">
              #{stage.index}
            </span>
            <div>
              <span className="text-[10px] font-mono text-accent uppercase tracking-widest block">
                Pipeline step
              </span>
              <h2 className="text-lg font-black uppercase tracking-tight text-white font-mono">
                {stage.name}
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

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Metrics Strip */}
          <div className="grid grid-cols-3 gap-3 font-mono text-xs">
            <div className="p-3 bg-ground border border-line">
              <span className="text-[10px] text-ink-dim block uppercase">Shuffles data?</span>
              <span className={`text-sm font-bold ${isWide ? 'text-accent' : 'text-green-400'}`}>
                {isWide ? 'Yes (moves data between workers)' : 'No'}
              </span>
            </div>
            <div className="p-3 bg-ground border border-line">
              <span className="text-[10px] text-ink-dim block uppercase">Rows before</span>
              <span className="text-base font-bold text-white tabular-nums">{stage.inRows}</span>
            </div>
            <div className="p-3 bg-ground border border-line">
              <span className="text-[10px] text-ink-dim block uppercase">Rows after</span>
              <span className="text-base font-bold text-value tabular-nums">{stage.outRows}</span>
            </div>
          </div>

          {/* Operations Applied */}
          <div>
            <div className="text-[10px] font-mono text-ink-dim uppercase tracking-widest mb-1.5">
              Spark operations used:
            </div>
            <div className="flex flex-wrap gap-1.5 font-mono text-xs">
              {stage.operations.map((op, opIdx) => (
                <span
                  key={`${stage.name}-${op}-${opIdx}`}
                  className="px-2 py-1 bg-ground border border-line text-white font-semibold"
                >
                  .{op}()
                </span>
              ))}
            </div>
          </div>

          {/* Actual Python Code Snippet */}
          <div>
            <div className="flex items-center justify-between mb-1.5 text-[10px] font-mono text-ink-dim uppercase tracking-widest">
              <span>Code used for this step</span>
              <span className="text-accent">services/ingestion-us/app/spark/pipeline.py</span>
            </div>
            <pre className="p-3.5 bg-ground border border-line font-mono text-xs text-ink overflow-x-auto leading-relaxed">
              <code>{stage.codeSnippet}</code>
            </pre>
          </div>

          {/* Plain-language explanation */}
          <div className="p-3.5 bg-ground border-l-2 border-value text-xs font-sans text-ink-muted leading-relaxed">
            <span className="text-value font-semibold font-mono block text-[11px] mb-1">
              WHAT THIS STEP DOES:
            </span>
            {stage.rationale || 'No description recorded for this step.'}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-line bg-ground-tint flex items-center justify-end text-xs font-mono shrink-0">
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

