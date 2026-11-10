'use client';

import { SWRConfig } from 'swr';
import { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth';
import { AuthGuard } from '@/components/auth/AuthGuard';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <AuthGuard>
        <SWRConfig
          value={{
            revalidateOnFocus: false,
            revalidateOnReconnect: true,
            dedupingInterval: 5000,
            fallback: {},
          }}
        >
          {children}
        </SWRConfig>
      </AuthGuard>
    </AuthProvider>
  );
}
