'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const navigation = [
  {
    name: 'Dashboard',
    href: '/',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13h4l2-5 4 9 2-4h6" />
      </svg>
    ),
  },
  {
    name: 'Companies',
    href: '/companies',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 21V5a2 2 0 012-2h8a2 2 0 012 2v16m-12 0h18m-14-8h4m-4-4h4" />
      </svg>
    ),
  },
  {
    name: 'Anomalies',
    href: '/anomalies',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l9 9-9 9-9-9 9-9z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01" />
      </svg>
    ),
  },
  {
    name: 'Spark ETL',
    href: '/pipeline',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    name: 'Backtest',
    href: '/backtest',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 17l6-6 4 4 6-8" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M14 15h6v-6" />
      </svg>
    ),
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="px-6 py-5 border-b border-navy-800">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-yellow-500 flex items-center justify-center">
            <svg className="w-5 h-5 text-navy-950" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 3l9 9-9 9-9-9 9-9z" />
            </svg>
          </div>
          <div>
            <span className="block font-bold text-white leading-tight">Anomaly Engine</span>
            <span className="block text-[11px] text-navy-400 tracking-widest uppercase">SEC Contradiction AI</span>
          </div>
        </Link>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {navigation.map((item) => (
          <Link
            key={item.name}
            href={item.href}
            className={cn(
              'sidebar-link',
              pathname === item.href && 'sidebar-link-active'
            )}
          >
            {item.icon}
            <span>{item.name}</span>
          </Link>
        ))}
      </nav>

      <div className="px-4 py-4 border-t border-navy-800">
        <p className="text-[11px] font-semibold text-navy-400 tracking-widest uppercase mb-2">
          System Status
        </p>
        <div className="flex items-center gap-2 text-sm text-green-400">
          <span className="relative flex w-2 h-2">
            <span className="absolute inline-flex w-full h-full rounded-full bg-green-400 opacity-60 animate-ping"></span>
            <span className="relative inline-flex w-2 h-2 rounded-full bg-green-400"></span>
          </span>
          <span className="font-medium">Operational</span>
        </div>
        <p className="mt-3 text-[11px] text-navy-500">API Gateway v0.1 · 4 services</p>
      </div>
    </aside>
  );
}