'use client';

import { FilingViewer } from '@/components/filings/FilingViewer';
import { FilingDiffViewer } from '@/components/filings/FilingDiffViewer';
import { Sidebar } from '@/components/ui/Sidebar';
import { useParams, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import Link from 'next/link';
import { useFiling, useFilings } from '@/lib/hooks';

export default function FilingDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const ticker = params.ticker as string;
  const id = params.id as string;
  const initialCompareId = searchParams.get('compare');

  const [showDiff, setShowDiff] = useState(Boolean(initialCompareId));
  const [compareFilingId, setCompareFilingId] = useState<string | null>(initialCompareId);

  const { data: filingsData } = useFilings(ticker);
  const { data: currentFiling } = useFiling(id);
  const { data: compareFiling } = useFiling(compareFilingId);

  const otherFilings = (filingsData?.filings || []).filter((filing) => filing.id !== id);
  const canCompare = Boolean(currentFiling && compareFiling);

  return (
    <div className="flex h-screen bg-gray-950">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <header className="sticky top-0 z-10 bg-gray-950/95 backdrop-blur-sm border-b border-gray-900">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-4">
              <Link href={'/companies/' + ticker} className="text-gray-400 hover:text-white">Back</Link>
              <div>
                <h1 className="text-2xl font-bold text-white">
                  {currentFiling?.filing_type ? `${currentFiling.filing_type} filing` : 'Filing'}
                </h1>
                <p className="text-gray-400 text-sm">
                  {currentFiling?.filing_date
                    ? `Filed ${new Date(currentFiling.filing_date).toLocaleDateString()}`
                    : `Filing ${id.slice(0, 12)}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowDiff(!showDiff)}>
                {showDiff ? 'Hide comparison' : 'Compare'}
              </Button>
            </div>
          </div>
        </header>

        <main className="p-6">
          {showDiff && compareFilingId ? (
            canCompare ? (
              <FilingDiffViewer
                filingA={{
                  id: compareFiling!.id,
                  filing_type: compareFiling!.filing_type,
                  filing_date: compareFiling!.filing_date,
                  sections: compareFiling!.sections || {},
                }}
                filingB={{
                  id: currentFiling!.id,
                  filing_type: currentFiling!.filing_type,
                  filing_date: currentFiling!.filing_date,
                  sections: currentFiling!.sections || {},
                }}
                onClose={() => {
                  setShowDiff(false);
                  setCompareFilingId(null);
                }}
              />
            ) : (
              <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6 text-gray-400 text-sm">
                Loading both filings to compare…
              </div>
            )
          ) : (
            <FilingViewer filingId={id} ticker={ticker} />
          )}

          {!showDiff && (
            <div className="mt-6">
              <h2 className="text-xl font-bold text-white mb-4">Compare with another filing</h2>
              <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
                {otherFilings.length > 0 ? (
                  <>
                    <p className="text-gray-400 mb-4">
                      Pick an earlier filing from {ticker}. The app will show the same sections side by side.
                    </p>
                    <div className="flex gap-4 flex-wrap items-end">
                      <div>
                        <label className="block text-xs text-gray-400 uppercase tracking-wider mb-1.5">
                          Filing to compare
                        </label>
                        <select
                          value={compareFilingId || ''}
                          onChange={(e) => setCompareFilingId(e.target.value || null)}
                          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm min-w-[240px]"
                        >
                          <option value="">Choose a filing…</option>
                          {otherFilings.map((filing) => (
                            <option key={filing.id} value={filing.id}>
                              {filing.filing_type} · {filing.filing_date ? new Date(filing.filing_date).toLocaleDateString() : 'date unknown'}
                            </option>
                          ))}
                        </select>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          if (compareFilingId) setShowDiff(true);
                        }}
                      >
                        Compare
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-gray-400 text-sm">
                    There are no other filings for {ticker} yet, so there is nothing to compare with.
                  </p>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
