'use client';

import { SWRConfig } from 'swr';
import { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  return (
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
  );
}