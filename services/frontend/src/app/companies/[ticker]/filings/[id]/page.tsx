'use client';

import { FilingViewer } from '@/components/filings/FilingViewer';
import { FilingDiffViewer } from '@/components/filings/FilingDiffViewer';
import { Sidebar } from '@/components/ui/Sidebar';
import { useParams, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import Link from 'next/link';

export default function FilingDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const ticker = params.ticker as string;
  const id = params.id as string;
  const compareId = searchParams.get('compare');

  const [showDiff, setShowDiff] = useState(false);
  const [compareFilingId, setCompareFilingId] = useState<string | null>(compareId);

  return (
    <div className="flex h-screen bg-gray-950">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <header className="sticky top-0 z-10 bg-gray-950/95 backdrop-blur-sm border-b border-gray-900">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-4">
              <Link href={'/companies/' + ticker} className="text-gray-400 hover:text-white">Back</Link>
              <div>
                <h1 className="text-2xl font-bold text-white">Filing Detail</h1>
                <p className="text-gray-400 text-sm">Filing ID: {id.slice(0, 12)}...</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowDiff(!showDiff)}>
                {showDiff ? 'Hide Diff' : 'Compare'}
              </Button>
            </div>
          </div>
        </header>

        <main className="p-6">
          {showDiff && compareFilingId ? (
            <FilingDiffViewer 
              filingA={{ 
                id: compareFilingId, 
                filing_type: '10-K', 
                filing_date: '2024-01-01',
                sections: {}
              }} 
              filingB={{ 
                id, 
                filing_type: '10-K', 
                filing_date: '2025-01-01',
                sections: {}
              }} 
              onClose={() => { setShowDiff(false); setCompareFilingId(null); }}
            />
          ) : (
            <FilingViewer filingId={id} ticker={ticker} />
          )}

          {!showDiff && (
            <div className="mt-6">
              <h2 className="text-xl font-bold text-white mb-4">Compare with Another Filing</h2>
              <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
                <p className="text-gray-400 mb-4">Select another filing to compare against this one.</p>
                <div className="flex gap-4 flex-wrap">
                  <Button 
                    variant="secondary" 
                    size="sm"
                    onClick={() => {
                      setCompareFilingId('previous-filing-id');
                      setShowDiff(true);
                    }}
                  >
                    Compare with Previous Quarter
                  </Button>
                  <Button 
                    variant="secondary" 
                    size="sm"
                    onClick={() => {
                      setCompareFilingId('previous-year-filing-id');
                      setShowDiff(true);
                    }}
                  >
                    Compare with Same Quarter Last Year
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => {
                      // Would open a modal with all filings
                    }}
                  >
                    Choose Specific Filing
                  </Button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}