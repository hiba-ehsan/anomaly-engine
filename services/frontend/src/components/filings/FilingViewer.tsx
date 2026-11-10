'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { useFiling, useFilingChunks, useFilingSentiment } from '@/lib/hooks';

interface FilingViewerProps {
  filingId: string;
  ticker: string;
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

export function FilingViewer({ filingId, ticker }: FilingViewerProps) {
  const { data: filingData, isLoading: filingLoading } = useFiling(filingId);
  const { data: chunksData } = useFilingChunks(filingId);
  const { data: sentimentData } = useFilingSentiment(filingId);
  const [selectedChunk, setSelectedChunk] = useState<number | null>(null);

  const filing = filingData;
  const chunks = chunksData?.chunks || [];
  const sentiments = sentimentData?.scores || [];

  if (filingLoading) {
    return (
      <div className="flex h-screen bg-gray-950 items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
      </div>
    );
  }

  if (!filing) {
    return <div className="text-center py-8 text-gray-500">This filing was not found.</div>;
  }

  return (
    <div className="flex h-screen bg-gray-950 overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="sticky top-0 z-10 bg-gray-950/95 backdrop-blur-sm border-b border-gray-900">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-4">
              <span className="text-2xl font-bold text-white">
                {ticker} · {filing.filing_type || 'Filing'}
              </span>
              <Badge variant="info">{formatDate(filing.filing_date)}</Badge>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6">
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl border border-gray-800 bg-gray-800/50">
                <p className="text-sm text-gray-400">Filed</p>
                <p className="text-lg font-bold text-white">{formatDate(filing.filing_date)}</p>
              </div>
              <div className="p-4 rounded-xl border border-gray-800 bg-gray-800/50">
                <p className="text-sm text-gray-400">Period covered</p>
                <p className="text-lg font-bold text-white">{formatDate(filing.period_of_report)}</p>
              </div>
              <div className="p-4 rounded-xl border border-gray-800 bg-gray-800/50">
                <p className="text-sm text-gray-400">SEC number</p>
                <p className="text-lg font-bold text-white font-mono text-sm">{filing.accession_number || '—'}</p>
              </div>
              <div className="p-4 rounded-xl border border-gray-800 bg-gray-800/50">
                <p className="text-sm text-gray-400">Sections</p>
                <p className="text-lg font-bold text-white">
                  {filing.sections ? Object.keys(filing.sections).length : '—'}
                </p>
              </div>
            </div>

            <div className="max-w-5xl mx-auto">
              <SingleView
                sections={filing.sections || {}}
                chunks={chunks}
                sentiments={sentiments}
                selectedChunk={selectedChunk}
                onSelectChunk={setSelectedChunk}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function SingleView({
  sections,
}: {
  sections: Record<string, string>;
  chunks: any[];
  sentiments: any[];
  selectedChunk: number | null;
  onSelectChunk: (idx: number) => void;
}) {
  const entries = Object.entries(sections);

  if (entries.length === 0) {
    return (
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6 text-gray-400 text-sm">
        No section text was saved for this filing.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {entries.map(([sectionKey, content]) => (
        <div key={sectionKey} className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
          <h3 className="text-lg font-bold text-white mb-4 capitalize">
            {sectionKey.replace(/_/g, ' ')}
          </h3>
          <div className="prose prose-invert max-w-none whitespace-pre-wrap text-gray-300 leading-relaxed">
            {content || '—'}
          </div>
        </div>
      ))}
    </div>
  );
}
