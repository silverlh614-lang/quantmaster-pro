/**
 * @responsibility 프론트 관심종목 Zustand store와 서버 /api/user-watchlist 양방향 동기화
 *
 * - 마운트 시 서버 상태로 store 를 prime (server wins)
 * - store.watchlist 변경을 감지해 500ms debounce 로 PUT 서버 치환
 * - 서버 호출 실패는 silent (오프라인 모드 허용), 다음 성공 sync 에서 복구
 */

import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRecommendationStore } from '../stores';
import { userWatchlistApi, type UserWatchlistItem } from '../api/autoTradeClient';
import type { StockRecommendation } from '../services/stockService';

const QUERY_KEY = ['user-watchlist'] as const;
const SYNC_DEBOUNCE_MS = 500;

/** Zustand watchlist 항목 → 서버 직렬화 포맷. UI 표시에 필요한 최소 필드만 전송. */
function toUserWatchlistItem(s: StockRecommendation): UserWatchlistItem {
  const extra = s as unknown as Record<string, unknown>;
  return {
    code: s.code,
    name: s.name,
    watchedAt: typeof extra.watchedAt === 'string' ? (extra.watchedAt as string) : new Date().toISOString(),
    watchedPrice: typeof extra.watchedPrice === 'number' ? (extra.watchedPrice as number) : undefined,
    currentPrice: typeof s.currentPrice === 'number' ? s.currentPrice : undefined,
    signalType: s.type,
  };
}

/**
 * 서버 직렬화 포맷 → Zustand watchlist 항목.
 * StockRecommendation 타입은 수십 개 필수 필드를 요구하지만, 워치리스트는 UI 북마크
 * 용도이므로 비필수 필드는 빈값/기본값으로 채워 런타임 안전을 유지한다.
 *
 * PR-23: 서버에 watchedPrice 가 비어 있고 currentPrice 가 있으면 currentPrice 로
 * 백필 — 디바운스 sync 가 다음 PUT 에서 서버도 자연스럽게 갱신한다.
 * watchedAt 이 ISO 포맷이 아니면 현재 시각으로 보정(기존 locale 문자열 레거시 호환).
 */
function fromUserWatchlistItem(it: UserWatchlistItem): StockRecommendation {
  const serverWatchedPrice = typeof it.watchedPrice === 'number' && it.watchedPrice > 0
    ? it.watchedPrice
    : undefined;
  const serverCurrentPrice = typeof it.currentPrice === 'number' && it.currentPrice > 0
    ? it.currentPrice
    : 0;
  const backfilledWatchedPrice = serverWatchedPrice ?? (serverCurrentPrice > 0 ? serverCurrentPrice : undefined);
  const isIsoLike = typeof it.watchedAt === 'string' && !Number.isNaN(new Date(it.watchedAt).getTime());
  const restored = {
    code: it.code,
    name: it.name,
    currentPrice: serverCurrentPrice,
    watchedPrice: backfilledWatchedPrice,
    watchedAt: isIsoLike ? it.watchedAt : new Date().toISOString(),
    type: (it.signalType as StockRecommendation['type']) ?? 'BUY',
    reason: '',
    patterns: [],
    hotness: 0,
    roeType: '',
    isLeadingSector: false,
    momentumRank: 0,
    supplyQuality: { passive: false, active: false },
    peakPrice: 0,
    isPreviousLeader: false,
    ichimokuStatus: 'INSIDE_CLOUD',
    relatedSectors: [],
    valuation: { per: 0, pbr: 0, epsGrowth: 0, debtRatio: 0 },
    technicalSignals: {
      maAlignment: 'NEUTRAL',
      rsi: 50,
      macdStatus: 'NEUTRAL',
      bollingerStatus: 'NEUTRAL',
      stochasticStatus: 'NEUTRAL',
      volumeSurge: false,
      disparity20: 0,
      macdHistogram: 0,
      bbWidth: 0,
      stochRsi: 50,
    },
    economicMoat: { type: 'NONE', description: '' },
  };
  return restored as unknown as StockRecommendation;
}

/**
 * 앱 라이프타임 동안 한 번 마운트하는 동기화 훅.
 * 호출 위치: App.tsx 상단 1회.
 */
export function useWatchlistSync(): void {
  const watchlist = useRecommendationStore((s) => s.watchlist);
  const setWatchlist = useRecommendationStore((s) => s.setWatchlist);
  const qc = useQueryClient();
  const primedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 초기 prime: 서버 상태로 store 를 덮어쓴다 (다른 기기와의 일치 우선).
  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => (await userWatchlistApi.getAll()).items,
    staleTime: 60_000,
    retry: 1,
  });

  useEffect(() => {
    if (primedRef.current) return;
    if (!data) return;
    primedRef.current = true;
    // 서버가 비어있으면 로컬 유지 (신규 사용자 케이스).
    if (data.length === 0 && watchlist.length > 0) {
      // 로컬이 있고 서버가 비어있으면 이번 기회에 서버로 올린다.
      void userWatchlistApi.replaceAll(watchlist.map(toUserWatchlistItem)).catch(() => { /* silent */ });
      return;
    }
    setWatchlist(data.map(fromUserWatchlistItem));
  }, [data, setWatchlist, watchlist]);

  // 서버 치환 mutation (PUT).
  const replaceMutation = useMutation({
    mutationFn: (items: UserWatchlistItem[]) => userWatchlistApi.replaceAll(items),
    onSuccess: (res) => {
      qc.setQueryData(QUERY_KEY, res.items);
    },
    // 실패는 silent — 다음 변경 시 재시도되거나 새 prime 이 서버 상태로 덮어씀.
    retry: 1,
  });

  // 로컬 변경 감지 → debounce 후 서버 치환.
  useEffect(() => {
    if (!primedRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      replaceMutation.mutate(watchlist.map(toUserWatchlistItem));
    }, SYNC_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // replaceMutation 은 stable reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlist]);
}
