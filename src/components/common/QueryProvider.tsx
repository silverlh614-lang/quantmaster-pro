// @responsibility common 영역 QueryProvider 컴포넌트
import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { PERSIST_GC_TIME } from '../../utils/cacheConfig';

interface QueryProviderProps {
  children: ReactNode;
}

const persister = createSyncStoragePersister({
  storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  key: 'qm-query-cache',
});

// PR-2 #2: API 호출 실패가 페이지 전체 렌더링을 막지 않도록 기본 재시도·경고 정책을
// 중앙에서 설정한다. 네트워크 일시 장애는 exponential backoff 로 흡수하고,
// 최종 실패는 toast 로 사용자에게 알리되 store 는 이전 캐시/fallback 을 유지한다.
function shouldRetry(failureCount: number, error: unknown): boolean {
  // 4xx 는 재시도해도 같은 결과이므로 즉시 포기.
  const status = (error as { status?: number } | undefined)?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) return false;
  return failureCount < 2;
}

function retryDelay(attempt: number): number {
  // 1s → 2s → 4s (최대 8s).
  return Math.min(1000 * 2 ** attempt, 8000);
}

export function QueryProvider({ children }: QueryProviderProps) {
  const [queryClient] = useState(() => new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        // 백그라운드 refetch 실패는 조용히 처리 (캐시된 데이터가 유지됨).
        if (query.state.data !== undefined) return;
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[Query]', query.queryKey, '실패:', msg);
        toast.error('데이터 로딩 실패', {
          description: msg.length > 120 ? `${msg.slice(0, 117)}...` : msg,
        });
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[Mutation] 실패:', msg);
        toast.error('요청 실패', {
          description: msg.length > 120 ? `${msg.slice(0, 117)}...` : msg,
        });
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        gcTime: PERSIST_GC_TIME,
        refetchOnWindowFocus: false,
        retry: shouldRetry,
        retryDelay,
      },
      mutations: {
        retry: 1,
        retryDelay,
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
