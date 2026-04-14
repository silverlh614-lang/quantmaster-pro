import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { ReactNode, useState } from 'react';
import { PERSIST_GC_TIME } from '../../utils/cacheConfig';

interface QueryProviderProps {
  children: ReactNode;
}

const persister = createSyncStoragePersister({
  storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  key: 'qm-query-cache',
});

export function QueryProvider({ children }: QueryProviderProps) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        gcTime: PERSIST_GC_TIME,
        refetchOnWindowFocus: false,
      },
    },
  }));

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: PERSIST_GC_TIME }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
