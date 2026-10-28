'use client';

import { useState } from 'react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useFiling, useFilingChunks, useFilingSentiment } from '@/lib/hooks';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface FilingViewerProps {
  filingId: string;
  ticker: string;
}

export function FilingViewer({ filingId, ticker }: FilingViewerProps) {
  const { data: filingData, isLoading: filingLoading } = useFiling(filingId);
  const { data: chunksData } = useFilingChunks(filingId);
  const { data: sentimentData } = useFilingSentiment(filingId);
  const [viewMode, setViewMode] = useState<'single' | 'diff'>('single');
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
    return <div className="text-center py-8 text-gray-500">Filing not found</div>;
  }

  const getSentimentColor = (score: { positive: number; negative: number; neutral: number }) => {
    const max = Math.max(score.positive, score.negative, score.neutral);
    if (max === score.negative) return 'bg-red-900/30 text-red-400 border-red-800';
    if (max === score.positive) return 'bg-green-900/30 text-green-400 border-green-800';
    return 'bg-yellow-900/30 text-yellow-400 border-yellow-800';
  };

  return (
    <div className="flex h-screen bg-gray-950 overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-gray-950/95 backdrop-blur-sm border-b border-gray-900">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-4">
              <span className="text-2xl font-bold text-white">
                {filing.sections ? Object.keys(filing.sections).join(', ') : 'Filing'}
              </span>
              <Badge variant="info">{filing.filing_type}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={viewMode}
                onChange={(e) => setViewMode(e.target.value as 'single' | 'diff')}
                className="px-3 py-1 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
              >
                <option value="single">Single View</option>
                <option value="diff">Diff View</option>
              </select>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6">
          <div className="space-y-6">
            {/* Filing Metadata */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl border border-gray-800 bg-gray-800/50">
                <p className="text-sm text-gray-400">Filing Date</p>
                <p className="text-lg font-bold text-white">{new Date(filing.filing_date).toLocaleDateString()}</p>
              </div>
              <div className="p-4 rounded-xl border border-gray-800 bg-gray-800/50">
                <p className="text-sm text-gray-400">Period of Report</p>
                <p className="text-lg font-bold text-white">{filing.period_of_report ? new Date(filing.period_of_report).toLocaleDateString() : 'N/A'}</p>
              </div>
              <div className="p-4 rounded-xl border border-gray-800 bg-gray-800/50">
                <p className="text-sm text-gray-400">Accession</p>
                <p className="text-lg font-bold text-white font-mono text-sm">{filing.accession_number || 'N/A'}</p>
              </div>
              <div className="p-4 rounded-xl border border-gray-800 bg-gray-800/50">
                <p className="text-sm text-gray-400">Sections</p>
                <p className="text-lg font-bold text-white">{filing.sections ? Object.keys(filing.sections).length : 0}</p>
              </div>
            </div>

            {/* Sections Tabs */}
            {filing.sections && (
              <div className="border-b border-gray-800">
                <nav className="flex space-x-8 px-4" aria-label="Sections">
                  {Object.entries(filing.sections).map(([key, content]) => (
                    <button
                      key={key}
                      className="py-4 text-sm font-medium text-gray-400 hover:text-white border-b-2 border-transparent hover:border-blue-500 transition-colors"
                    >
                      {key.replace('_', ' ').toUpperCase()}
                    </button>
                  ))}
                </nav>
              </div>
            )}

            {/* Content */}
            <div className="max-w-5xl mx-auto">
              {viewMode === 'single' ? (
                <SingleView
                  sections={filing.sections || {}}
                  chunks={chunks}
                  sentiments={sentiments}
                  selectedChunk={selectedChunk}
                  onSelectChunk={setSelectedChunk}
                />
              ) : (
                <DiffView
                  sections={filing.sections || {}}
                  chunks={chunks}
                  sentiments={sentiments}
                />
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function SingleView({
  sections,
  chunks,
  sentiments,
  selectedChunk,
  onSelectChunk,
}: {
  sections: Record<string, string>;
  chunks: any[];
  sentiments: any[];
  selectedChunk: number | null;
  onSelectChunk: (idx: number) => void;
}) {
  return (
    <div className="space-y-6">
      {Object.entries(sections).map(([sectionKey, content]) => (
        <div key={sectionKey} className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
          <h3 className="text-lg font-bold text-white mb-4 capitalize">{sectionKey.replace('_', ' ')}</h3>
          <div className="prose prose-invert max-w-none whitespace-pre-wrap text-gray-300 leading-relaxed">
            {content}
          </div>
        </div>
      ))}
    </div>
  );
}

function DiffView({
  sections,
  chunks,
  sentiments,
}: {
  sections: Record<string, string>;
  chunks: any[];
  sentiments: any[];
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
          <h3 className="text-lg font-bold text-white mb-4">Original (Earlier Filing)</h3>
          <div className="prose prose-invert max-w-none whitespace-pre-wrap text-gray-300 leading-relaxed min-h-[300px]">
            {Object.values(sections).join('\n\n')}
          </div>
        </div>
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
          <h3 className="text-lg font-bold text-white mb-4">Current (Latest Filing)</h3>
          <div className="prose prose-invert max-w-none whitespace-pre-wrap text-gray-300 leading-relaxed min-h-[300px]">
            {Object.values(sections).join('\n\n')}
          </div>
        </div>
      </div>
      <p className="text-center text-gray-500 text-sm">Diff view compares sections across filings. Select two filings to compare.</p>
    </div>
  );
}