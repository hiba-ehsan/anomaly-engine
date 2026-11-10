'use client';

import { useState } from 'react';
import { useCompanies } from '@/lib/hooks';
import { Sidebar } from '@/components/ui/Sidebar';
import { KineticTickerRibbon } from '@/components/ui/KineticTickerRibbon';
import { AddCompanyModal } from '@/components/modals/AddCompanyModal';
import Link from 'next/link';

export default function CompaniesPage() {
  const { data: companiesData, isLoading, mutate } = useCompanies(100);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [search, setSearch] = useState('');

  const rawCompanies = companiesData?.companies ?? [];
  const filtered = rawCompanies.filter(
    (c) =>
      c.ticker.toLowerCase().includes(search.toLowerCase()) ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.sector && c.sector.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="flex h-screen bg-ground text-ink overflow-hidden">
      <div className="hidden lg:block shrink-0">
        <Sidebar />
      </div>

      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <KineticTickerRibbon />

        <header className="sticky top-0 z-10 bg-ground-tint/95 backdrop-blur border-b border-line">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <div>
                <span className="text-[10px] font-mono text-accent uppercase tracking-widest block">
                  Companies
                </span>
                <h1 className="text-2xl font-black uppercase tracking-tight text-white leading-none">
                  Companies being watched
                </h1>
              </div>
              <span className="badge badge-accent font-mono">
                {isLoading
                  ? 'Loading…'
                  : `${rawCompanies.length} ${rawCompanies.length === 1 ? 'company' : 'companies'}`}
              </span>
            </div>

            <button
              onClick={() => setIsAddModalOpen(true)}
              className="btn-kinetic !px-4 !py-2 text-xs flex items-center gap-1.5"
            >
              <span>+ Add company</span>
              <span className="font-mono">→</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6 space-y-6">
          <div className="card p-4 flex items-center justify-between gap-4">
            <div className="flex-1 max-w-md">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by ticker, name, or industry…"
                className="input-field font-mono text-xs"
              />
            </div>
            <div className="text-xs font-mono text-ink-dim">
              {isLoading ? (
                'Loading companies…'
              ) : (
                <>
                  Showing <span className="text-value font-bold">{filtered.length}</span> of{' '}
                  {rawCompanies.length}
                </>
              )}
            </div>
          </div>

          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Company name</th>
                    <th>Industry</th>
                    <th>Country</th>
                    <th>SEC ID</th>
                    <th>Added</th>
                    <th className="text-right">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-ink-dim font-mono text-xs">
                        <div className="flex items-center justify-center gap-3">
                          <span className="w-2 h-2 rounded-full bg-accent animate-ping" />
                          <span>Loading companies…</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filtered.map((company, cIdx) => (
                      <tr key={`${company.id ?? company.ticker}-${cIdx}`} className="hover:bg-ground-tint transition-colors">
                        <td className="font-mono font-bold text-value text-sm">{company.ticker}</td>
                        <td className="text-white font-medium">{company.name}</td>
                        <td className="text-ink-muted text-xs">{company.sector || '—'}</td>
                        <td>
                          <span className="badge badge-gray">{company.jurisdiction || '—'}</span>
                        </td>
                        <td className="font-mono text-ink-dim text-xs">{company.cik || '—'}</td>
                        <td className="text-ink-dim text-xs font-mono">
                          {company.created_at ? new Date(company.created_at).toLocaleDateString() : '—'}
                        </td>
                        <td className="text-right">
                          <Link
                            href={'/companies/' + company.ticker}
                            className="inline-flex items-center gap-1 text-xs font-mono font-bold text-accent hover:text-accent-warm"
                          >
                            <span>Open</span>
                            <span>→</span>
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                  {!isLoading && filtered.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-ink-dim font-mono text-xs">
                        {rawCompanies.length === 0
                          ? 'No companies yet. Add one to get started.'
                          : `No companies match “${search}”.`}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>

      <AddCompanyModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={() => mutate()}
      />
    </div>
  );
}
