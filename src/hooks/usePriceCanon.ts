// @responsibility 가격 표시 정본(SSOT) hook — Naver 모바일 snapshot 단일 통로 조회
/**
 * 가격 표시 정본(Canonical Price Source) hook.
 *
 * 모든 dashboard 가격 표시 컴포넌트가 stock.currentPrice 직접 의존을 끊고 이 hook
 * 으로 단일 통로 통합한다. 이슈 발생 시 수정 지점이 산재되지 않음 (L4 LLM 환각·
 * Yahoo 잔재·snapshot stale 차단을 이 한 곳에서).
 *
 * 우선순위:
 *   1. NAVER (모바일 snapshot.closePrice, L3 KRX 직접 시세)
 *   2. fallback (호출자가 가진 이전 KIS REALTIME 값 — props 로 전달)
 *   3. null → UI 가 "갱신 중..." placeholder 노출
 *
 * React Query 가 자동으로 dedup/캐시/refetch 제공 — Naver 일일 예산 보호.
 * staleTime 5분: 같은 종목 5분 이내 재호출 시 outbound 0.
 *
 * 자동매매(kisClient·autoTradeEngine) 경로와 무관 — 본 hook 은 dashboard 표시 전용.
 * 불변식 #7 정합: L4 AI_ESTIMATED 값은 hook 결과에 절대 포함되지 않음.
 */
import { useQuery } from '@tanstack/react-query';
import { fetchAiUniverseSnapshot } from '../api/aiUniverseClient';

const STALE_TIME_MS = 5 * 60 * 1000; // 5분 — Naver 예산 보호
const REFETCH_INTERVAL_MS = 5 * 60 * 1000; // 5분 백그라운드 refresh

export type PriceCanonSource = 'NAVER' | 'REALTIME' | 'NONE';

export interface PriceCanonResult {
  /** 정본 가격 (KRW). null = 신뢰 가능한 소스 없음. */
  price: number | null;
  /** 정본 소스 — NAVER(L3 KRX 시세) / REALTIME(props 전달 KIS) / NONE(미확보). */
  source: PriceCanonSource;
  /** 정본 갱신 시각 (Date) — refetch 시점. */
  updatedAt: Date | null;
  /** stale 여부 — staleTime 초과 시 true (UI 가 "갱신 중" 톤 다운 가능). */
  isStale: boolean;
  /** 현재 outbound fetch 진행 중 여부. */
  isFetching: boolean;
  /** 수동 refetch trigger (사용자 새로고침 등). */
  refetch: () => Promise<unknown>;
}

interface UsePriceCanonOptions {
  /**
   * fallback 가격 — Naver fetch 실패 시 사용. 호출자가 KIS REALTIME 동기화
   * 결과를 props 로 갖고 있을 때만 전달 (e.g., `stock.dataSourceType==='REALTIME'`
   * 인 stock.currentPrice). LLM 환각·Yahoo 잔재값 전달 금지.
   */
  fallbackPrice?: number | null;
  /** fallback 의 소스 라벨 — 보통 'REALTIME'. */
  fallbackSource?: 'REALTIME';
  /** 비활성화 (선택적 조회) — code 가 아직 결정 안 됐을 때. */
  enabled?: boolean;
}

/**
 * 가격 정본 hook — KRX 6자리 코드만 받아 Naver 모바일 snapshot 조회.
 *
 * @example
 * const { price, source, isFetching } = usePriceCanon('000660');
 * if (price === null) return <span>갱신 중...</span>;
 * return <span>₩{price.toLocaleString()}</span>;
 */
export function usePriceCanon(
  code: string | null | undefined,
  options: UsePriceCanonOptions = {},
): PriceCanonResult {
  const { fallbackPrice, fallbackSource, enabled = true } = options;
  const baseCode = code ? String(code).split('.')[0] : '';
  const isValidCode = /^\d{6}$/.test(baseCode);

  const query = useQuery({
    queryKey: ['price-canon', baseCode],
    queryFn: async () => {
      const snap = await fetchAiUniverseSnapshot(baseCode);
      const closePrice = snap?.closePrice;
      if (typeof closePrice === 'number' && closePrice > 0) {
        return { price: closePrice, source: 'NAVER' as const };
      }
      return { price: null, source: 'NONE' as const };
    },
    enabled: enabled && isValidCode,
    staleTime: STALE_TIME_MS,
    refetchInterval: REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const naverResult = query.data;
  const isStale = !query.isFetching && Boolean(query.dataUpdatedAt)
    && (Date.now() - query.dataUpdatedAt) > STALE_TIME_MS;

  // 우선순위: NAVER > fallback (KIS REALTIME) > NONE
  let price: number | null;
  let source: PriceCanonSource;
  if (naverResult?.price && naverResult.price > 0) {
    price = naverResult.price;
    source = 'NAVER';
  } else if (fallbackSource === 'REALTIME' && fallbackPrice && fallbackPrice > 0) {
    price = fallbackPrice;
    source = 'REALTIME';
  } else {
    price = null;
    source = 'NONE';
  }

  return {
    price,
    source,
    updatedAt: query.dataUpdatedAt ? new Date(query.dataUpdatedAt) : null,
    isStale,
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}
