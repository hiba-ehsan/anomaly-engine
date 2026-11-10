'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { useHealth } from '@/lib/hooks';

const navigation = [
  {
    name: 'Overview',
    href: '/',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13h4l2-5 4 9 2-4h6" />
      </svg>
    ),
  },
  {
    name: 'Companies',
    href: '/companies',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 21V5a2 2 0 012-2h8a2 2 0 012 2v16m-12 0h18m-14-8h4m-4-4h4" />
      </svg>
    ),
  },
  {
    name: 'Change flags',
    href: '/anomalies',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l9 9-9 9-9-9 9-9z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01" />
      </svg>
    ),
  },
  {
    name: 'Data pipeline',
    href: '/pipeline',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    name: 'Results test',
    href: '/backtest',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 17l6-6 4 4 6-8" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M14 15h6v-6" />
      </svg>
    ),
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { data: health } = useHealth();

  return (
    <aside className="sidebar">
      {/* Brand Header */}
      <div className="px-5 py-5 border-b border-line bg-ground-tint">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-8 h-8 bg-accent text-ground flex items-center justify-center font-bold font-mono text-sm group-hover:bg-accent-warm transition-colors">
            AE
          </div>
          <div>
            <span className="block font-bold text-ink uppercase tracking-tight text-sm leading-tight">
              Anomaly Engine
            </span>
            <span className="block text-[10px] font-mono text-ink-dim tracking-widest uppercase">
              SEC filing change detector
            </span>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-1">
        <div className="px-3 pb-2 text-[10px] font-mono text-ink-dim uppercase tracking-wider">
          Navigation
        </div>
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

      {/* User Session & Auth Section */}
      <div className="p-3 border-t border-line bg-panel">
        {user ? (
          <div className="p-2.5 bg-ground border border-line text-xs font-mono">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-accent uppercase font-bold tracking-wider">
                {user.role}
              </span>
              <button
                onClick={logout}
                title="Sign out"
                className="text-[10px] text-ink-dim hover:text-red-400 font-mono underline"
              >
                Sign Out
              </button>
            </div>
            <div className="text-white font-semibold truncate text-[11px]">{user.name}</div>
            <div className="text-[10px] text-ink-dim truncate">{user.email}</div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-[10px] font-mono text-ink-dim uppercase">Not signed in</div>
            <div className="grid grid-cols-2 gap-2">
              <Link href="/login" className="btn-secondary !text-[11px] !py-1.5 !px-2 text-center block">
                Sign in
              </Link>
              <Link href="/signup" className="btn-kinetic !text-[11px] !py-1.5 !px-2 text-center block">
                Create account
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* System status footer */}
      <div className="px-4 py-3 border-t border-line bg-ground">
        <div className="flex items-center justify-between text-[10px] font-mono text-ink-dim mb-1">
          <span className="tracking-widest uppercase">BACKEND:</span>
          <span className={`${health ? 'text-green-400' : 'text-red-400'} flex items-center gap-1 font-bold`}>
            <span className={`w-1.5 h-1.5 rounded-full inline-block ${health ? 'bg-green-400' : 'bg-red-400'}`} />
            {health ? 'Connected' : 'Not connected'}
          </span>
        </div>
        <p className="text-[10px] font-mono text-ink-dim">Local API · port 8000</p>
      </div>
    </aside>
  );
}
