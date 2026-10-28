'use client';

import { useFilings, useCompany } from '@/lib/hooks';
import { Sidebar } from '@/components/ui/Sidebar';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

export default function CompanyFilingsPage() {
  const params = useParams();
  const ticker = params.ticker as string;
  const [filingType, setFilingType] = useState('');

  const { data: companyData } = useCompany(ticker);
  const { data: filingsData, isLoading } = useFilings(ticker, filingType || undefined);

  const company = companyData || null;
  const filings = filingsData && filingsData.filings ? filingsData.filings : [];
  const total = filingsData && filingsData.total ? filingsData.total : 0;

  return (
    <div className="flex h-screen bg-gray-950">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <header className="sticky top-0 z-10 bg-gray-950/95 backdrop-blur-sm border-b border-gray-900">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-4">
              <Link href={'/companies/' + ticker} className="text-gray-400 hover:text-white">Back</Link>
              <h1 className="text-2xl font-bold text-white">
                {company ? company.name : ticker} - Filings
              </h1>
            </div>
            <select
              value={filingType}
              onChange={(e) => setFilingType(e.target.value)}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
            >
              <option value="">All Types</option>
              <option value="10-K">10-K</option>
              <option value="10-Q">10-Q</option>
              <option value="8-K">8-K</option>
              <option value="DEF 14A">DEF 14A</option>
            </select>
          </div>
        </header>

        <main className="p-6">
          <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h3 className="text-lg font-bold text-white mb-4">All Filings ({total})</h3>

            {isLoading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-4 border-blue-600 border-t-transparent"></div>
              </div>
            ) : filings.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="px-4 py-3 font-medium text-gray-400">Type</th>
                      <th className="px-4 py-3 font-medium text-gray-400">Filing Date</th>
                      <th className="px-4 py-3 font-medium text-gray-400">Period</th>
                      <th className="px-4 py-3 font-medium text-gray-400">Accession</th>
                      <th className="px-4 py-3 font-medium text-gray-400">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filings.map((filing) => (
                      <tr key={filing.id} className="border-b border-gray-800 hover:bg-gray-800/30">
                        <td className="px-4 py-3">
                          <span className="px-2 py-1 text-xs bg-blue-900/30 text-blue-400 border border-blue-800 rounded-full">
                            {filing.filing_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-300">{new Date(filing.filing_date).toLocaleDateString()}</td>
                        <td className="px-4 py-3 text-gray-400">
                          {filing.period_of_report ? new Date(filing.period_of_report).toLocaleDateString() : 'N/A'}
                        </td>
                        <td className="px-4 py-3 font-mono text-gray-400 text-sm">{filing.accession_number || 'N/A'}</td>
                        <td className="px-4 py-3">
                          <Link href={'/companies/' + ticker + '/filings/' + filing.id}>
                            <button className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg">
                              View
                            </button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-gray-500 text-center py-8">No filings found</p>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}