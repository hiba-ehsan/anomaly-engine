'use client';

import React, { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

const PUBLIC_ROUTES = ['/login', '/signup'];

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const isPublic = PUBLIC_ROUTES.includes(pathname);

  useEffect(() => {
    if (isLoading) return;

    if (!user && !isPublic) {
      router.replace('/login');
    } else if (user && isPublic) {
      router.replace('/');
    }
  }, [user, isLoading, isPublic, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-ground flex flex-col items-center justify-center text-ink font-mono text-xs">
        <div className="flex items-center gap-3 p-4 border border-line bg-panel">
          <span className="w-2.5 h-2.5 rounded-full bg-accent animate-ping" />
          <span>Loading your session…</span>
        </div>
      </div>
    );
  }

  // If unauthenticated and on a protected page, render nothing while redirect fires
  if (!user && !isPublic) {
    return null;
  }

  return <>{children}</>;
}

