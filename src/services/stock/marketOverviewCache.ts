/**
 * @responsibility marketOverview AI 응답 SWR 캐시 SSOT (ADR-0066 PR-β)
 *
 * `getMarketOverview` 가 사용하던 6시간 버킷 캐시 키 (`market-overview-${date}-${hour/6}`)
 * 가 윈도우 boundary 에서 새 hallucinated 값으로 점프하던 회귀 차단. SWR (stale-while-
 * revalidate) 패턴으로 fresh 60초 / stale 5분 / hard expiry 30분 정책 도입.
 *
 * 캐시 대상: AI raw 응답만. prefill 결과 (Yahoo 가격성 데이터) 는 normalize 단계에서
 * 매번 새로 적용 — `/api/historical-data` 의 LRU + coalescing (ADR-0009/0010) 이 자동
 * 보호하므로 별도 캐시 불필요.
 *
 * 정책 (ADR-0066 §2.2):
 * - 캐시 부재 → 강제 fetch (await), 결과를 캐시에 set
 * - age < FRESH_TTL → 캐시 그대로 반환 (fetch 안 함)
 * - age < STALE_TTL → 캐시 즉시 반환 + 백그라운드 refresh fire-and-forget
 * - age >= STALE_TTL → hard expiry, 강제 fetch (await)
 *
 * Inflight coalescing: 동시 호출이 진행 중인 fetch 에 편승 — Gemini API 중복 호출 차단.
 */

import { clientWarn } from '../../utils/clientWarn';

/** 60초 fresh — 같은 화면 내 빠른 재로드 시 fetch 회피. */
export const FRESH_TTL_MS = 60_000;

/** 5분 stale 허용 — 사용자가 페이지 다시 볼 때 stale 즉시 반환 + 백그라운드 갱신. */
export const STALE_TTL_MS = 5 * 60_000;

/** 30분 hard expiry — 그 이상 오래된 캐시는 stale 도 사용 안 함, 강제 fetch (await). */
export const HARD_EXPIRY_MS = 30 * 60_000;

/** AI raw 응답 캐시 entry — normalize 적용 전 객체 + 캐시 시각. */
export interface AiCacheEntry {
  raw: Record<string, unknown>;
  cachedAt: number;
}

/** SWR 분기 결과. isStale=true 면 백그라운드 refresh 가 진행 중이거나 시작됨. */
export interface SwrResolution {
  raw: Record<string, unknown>;
  isStale: boolean;
}

/**
 * 단일 슬롯 SWR 캐시 — marketOverview 외 호출자 없는 모듈 전역 슬롯.
 * 메모리 only — localStorage / 서버 Volume 영속 X (단순화 우선).
 */
let _entry: AiCacheEntry | null = null;
let _refreshInflight: Promise<Record<string, unknown>> | null = null;

/**
 * SWR 진입점. 캐시 fresh 면 즉시 반환, stale 이면 백그라운드 refresh + stale 반환,
 * hard expiry 또는 캐시 부재 면 강제 fetch (await).
 *
 * @param fetchFn AI raw 응답을 새로 fetch 하는 함수 (호출자가 prompt 등 캡처).
 * @param now 시각 — 테스트 가능성 위해 옵셔널 인자 (기본 Date.now).
 */
export async function getOrFetchAiResponse(
  fetchFn: () => Promise<Record<string, unknown>>,
  now: number = Date.now(),
): Promise<SwrResolution> {
  if (_entry) {
    const age = now - _entry.cachedAt;
    if (age < FRESH_TTL_MS) {
      return { raw: _entry.raw, isStale: false };
    }
    if (age < STALE_TTL_MS) {
      // stale 즉시 반환 + 백그라운드 refresh (fire-and-forget)
      ensureBackgroundRefresh(fetchFn, now);
      return { raw: _entry.raw, isStale: true };
    }
    // hard expiry — fall through to await fetch
  }
  // 캐시 부재 또는 hard expiry — coalescing 적용 후 강제 fetch
  return await awaitFreshFetch(fetchFn, now);
}

/**
 * 백그라운드 refresh — 이미 진행 중이면 편승, 아니면 새로 시작. 캐시 set 만 부수효과.
 * setAt: 캐시 entry 의 cachedAt 으로 박제할 시각. 호출자(getOrFetchAiResponse) 의 now
 * 를 그대로 사용해 시간축 일관성 유지 (테스트 가능성).
 */
function ensureBackgroundRefresh(
  fetchFn: () => Promise<Record<string, unknown>>,
  setAt: number,
): void {
  if (_refreshInflight) return;
  _refreshInflight = fetchFn()
    .then(raw => {
      _entry = { raw, cachedAt: setAt };
      return raw;
    })
    .catch(e => {
      clientWarn({
        domain: 'MARKET_OVERVIEW_CACHE',
        code: 'P4_MARKET_OVERVIEW_CACHE_DEGRADED',
        message: '[marketOverviewCache] 브라우저 SWR refresh 실패 — stale 화면 캐시 유지',
        dedupKey: 'marketOverviewCache:swrRefresh',
        details: { error: e instanceof Error ? e.message : String(e) },
      });
      // stale 그대로 살려둠 — 다음 호출에서 재시도
      throw e;
    })
    .finally(() => { _refreshInflight = null; });
  // unhandled rejection 방지 — fire-and-forget 이지만 swallow
  _refreshInflight.catch(() => { /* swallowed above */ });
}

/** 강제 fetch (await). inflight 가 이미 있으면 편승 (coalescing). */
async function awaitFreshFetch(
  fetchFn: () => Promise<Record<string, unknown>>,
  setAt: number,
): Promise<SwrResolution> {
  if (_refreshInflight) {
    const raw = await _refreshInflight;
    return { raw, isStale: false };
  }
  _refreshInflight = fetchFn()
    .then(raw => {
      _entry = { raw, cachedAt: setAt };
      return raw;
    })
    .finally(() => { _refreshInflight = null; });
  const raw = await _refreshInflight;
  return { raw, isStale: false };
}

/** 테스트 / HMR 용 — 캐시 강제 초기화. */
export function __resetForTests(): void {
  _entry = null;
  _refreshInflight = null;
}

/** 진단 / 테스트용 — 현재 캐시 상태 read-only 노출. */
export function getCacheState(now: number = Date.now()): {
  hasEntry: boolean;
  ageMs: number | null;
  classification: 'EMPTY' | 'FRESH' | 'STALE' | 'EXPIRED';
  inflight: boolean;
} {
  if (!_entry) {
    return { hasEntry: false, ageMs: null, classification: 'EMPTY', inflight: !!_refreshInflight };
  }
  const age = now - _entry.cachedAt;
  let classification: 'EMPTY' | 'FRESH' | 'STALE' | 'EXPIRED';
  if (age < FRESH_TTL_MS) classification = 'FRESH';
  else if (age < STALE_TTL_MS) classification = 'STALE';
  else classification = 'EXPIRED';
  return { hasEntry: true, ageMs: age, classification, inflight: !!_refreshInflight };
}
