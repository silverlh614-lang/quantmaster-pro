// @responsibility useAlertsFeed React hook
/**
 * useAlertsFeed — 서버측 Telegram 알림 피드를 UI 에 미러링 + 읽음 상태 유지.
 *
 * - localStorage 에 "lastReadId" 를 저장해 탭/재접속 간 공유.
 * - 30초 주기 폴링 (알림은 희귀 이벤트라 빈번할 필요 없음).
 * - markAllRead() 호출 시 최근 ID 를 lastRead 로 기록 → unread 0.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { alertsApi, type AlertFeedEntry, type AlertFeedResponse } from '../../api';

const STORAGE_KEY = 'qm-alerts-last-read-id';

function readLastReadId(): string | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function writeLastReadId(id: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch { /* noop */ }
}

export interface UseAlertsFeedReturn {
  entries: AlertFeedEntry[];
  unread: number;
  isLoading: boolean;
  markAllRead: () => void;
  refetch: () => void;
}

export function useAlertsFeed(): UseAlertsFeedReturn {
  const qc = useQueryClient();
  const [lastReadId, setLastReadId] = useState<string | null>(() => readLastReadId());

  const query = useQuery<AlertFeedResponse>({
    queryKey: ['alerts-feed', lastReadId],
    queryFn: () => alertsApi.getFeed({ sinceId: lastReadId ?? undefined, limit: 50 }),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  // 재초기 마운트 시 localStorage 이벤트 반영 (다른 탭에서 변경).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setLastReadId(e.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const markAllReadMut = useMutation({
    mutationFn: async () => {
      const top = query.data?.entries[0];
      if (top) {
        writeLastReadId(top.id);
        setLastReadId(top.id);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alerts-feed'] });
    },
  });

  const markAllRead = useCallback(() => {
    markAllReadMut.mutate();
  }, [markAllReadMut]);

  return {
    entries: query.data?.entries ?? [],
    unread: query.data?.unread ?? 0,
    isLoading: query.isLoading,
    markAllRead,
    refetch: () => { void query.refetch(); },
  };
}
