'use client';

import { useCompanies } from '@/lib/hooks';
import { Sidebar } from '@/components/ui/Sidebar';
import Link from 'next/link';

export default function CompaniesPage() {
  const { data: companiesData, isLoading } = useCompanies(100);

  const companies = companiesData && companiesData.companies ? companiesData.companies : [];

  return (
    <div className="flex h-screen bg-navy-950">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <header className="sticky top-0 z-10 bg-navy-950/90 backdrop-blur border-b border-navy-800">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white">Companies</h1>
              <span className="badge badge-yellow">{companies.length} tracked</span>
            </div>
            <Link href="#add-company" className="btn-primary !px-4 !py-2 !text-xs">
              Add Company
            </Link>
          </div>
        </header>

        <main className="p-6">
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Name</th>
                    <th>Sector</th>
                    <th>Jurisdiction</th>
                    <th>CIK</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-navy-400">
                        <div className="flex items-center justify-center gap-3">
                          <div className="w-5 h-5 rounded-full border-2 border-yellow-500 border-t-transparent animate-spin"></div>
                          Loading companies...
                        </div>
                      </td>
                    </tr>
                  ) : (
                    companies.map((company) => (
                      <tr key={company.id} className="cursor-pointer hover:bg-navy-800/50">
                        <td className="font-mono font-bold text-yellow-400">{company.ticker}</td>
                        <td className="text-navy-100">{company.name}</td>
                        <td className="text-navy-400">{company.sector || 'N/A'}</td>
                        <td>
                          <span className="badge badge-blue">{company.jurisdiction}</span>
                        </td>
                        <td className="font-mono text-navy-400">{company.cik || 'N/A'}</td>
                        <td className="text-navy-400 text-sm">
                          {new Date(company.created_at).toLocaleDateString()}
                        </td>
                        <td>
                          <Link
                            href={'/companies/' + company.ticker}
                            className="inline-flex items-center gap-1 text-sm font-medium text-yellow-400 hover:text-yellow-300"
                          >
                            View
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                  {!isLoading && companies.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-navy-400">
                        No companies tracked yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}