/**
 * @responsibility KIS TR result cache SSOT (Patch-005 직속, 5s TTL by trId+symbol+params)
 *
 * Patch ID: KIS-CIRCUIT-OPEN-ENFORCEMENT-AND-DATA-EVAL-STATE-001
 *
 * 사용자 5/14 §"긴급 수정 목표" §10 직접 인용:
 *   *"same trId+symbol+params는 5초 TTL result cache를 강제한다."*
 *
 * Patch-004 의 TTL dedup 은 *defer 결정* layer 였고, 본 Patch-005 는 *result cache* layer.
 * 동일 trId+symbol+params 가 5초 내 재호출 시 cached result 반환 (네트워크 호출 0건).
 *
 * Safety invariants (절대 변경 금지):
 *   - P0_POSITION_EXIT 는 result cache 적용 금지 (보유 매도 최신 데이터 의무)
 *   - cache key 는 trId + symbol + stable param hash
 *   - 5s TTL (사용자 명시, 절대 변경 금지)
 *   - LIVE 매매 본체 0줄 변경
 *   - KIS 주문 함수 5종 import 0건
 *   - ENV `=== 'true'` 정확 비교 (ADR-0157)
 */

import type { KisCallPriorityV2 } from './kisPriorityBudgetPatch004.js';

export const RESULT_CACHE_TTL_MS = 5_000;

export interface KisTrResultCacheEntry<T = unknown> {
  readonly key: string;          // composite: `${trId}:${symbol}:${paramsHash}`
  readonly result: T;
  readonly cachedAtMs: number;
}

export interface KisTrResultCacheLookupResult<T = unknown> {
  readonly hit: boolean;
  readonly result?: T;
  readonly ageMs?: number;
  readonly key: string;
  readonly skipReason?: 'ENV_DISABLED' | 'P0_EXCLUSION' | 'CACHE_MISS' | 'CACHE_EXPIRED';
}

const _resultCache = new Map<string, KisTrResultCacheEntry>();

export function isKisResultCacheDisabled(): boolean {
  return process.env.KIS_RESULT_CACHE_PATCH_005_DISABLED === 'true';
}

/**
 * Stable param hash — sorted keys, primitives only.
 * Object/array params → JSON.stringify with sorted keys.
 * Null/undefined → 'null'/'undefined' string.
 */
export function buildParamsHash(params: Record<string, unknown>): string {
  if (!params || typeof params !== 'object') return 'NO_PARAMS';
  const sortedKeys = Object.keys(params).sort();
  if (sortedKeys.length === 0) return 'NO_PARAMS';
  const parts: string[] = [];
  for (const k of sortedKeys) {
    const v = params[k];
    if (v === null) parts.push(`${k}=null`);
    else if (v === undefined) parts.push(`${k}=undef`);
    else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') parts.push(`${k}=${v}`);
    else parts.push(`${k}=${JSON.stringify(v)}`);
  }
  return parts.join('|');
}

export function buildResultCacheKey(trId: string, symbol: string, params: Record<string, unknown>): string {
  return `${trId}:${symbol}:${buildParamsHash(params)}`;
}

/**
 * Cache lookup SSOT — 결정 트리 우선순위:
 *   1. ENV DISABLED → skipReason='ENV_DISABLED' (cache miss)
 *   2. P0_POSITION_EXIT → skipReason='P0_EXCLUSION' (보유 매도 절대 최신 데이터)
 *   3. cache hit + age ≤ TTL → hit=true + result
 *   4. cache hit + age > TTL → skipReason='CACHE_EXPIRED' + entry 제거
 *   5. cache miss → skipReason='CACHE_MISS'
 */
export function lookupKisTrResultCache<T = unknown>(
  trId: string,
  symbol: string,
  priority: KisCallPriorityV2,
  params: Record<string, unknown>,
  nowMs: number = Date.now(),
): KisTrResultCacheLookupResult<T> {
  const key = buildResultCacheKey(trId, symbol, params);

  // 1. ENV DISABLED
  if (isKisResultCacheDisabled()) {
    return { hit: false, key, skipReason: 'ENV_DISABLED' };
  }

  // 2. P0_POSITION_EXIT 절대 보호 (보유 매도 최신 데이터 의무)
  if (priority === 'P0_POSITION_EXIT') {
    return { hit: false, key, skipReason: 'P0_EXCLUSION' };
  }

  const entry = _resultCache.get(key);
  if (!entry) {
    return { hit: false, key, skipReason: 'CACHE_MISS' };
  }
  const ageMs = nowMs - entry.cachedAtMs;
  if (ageMs > RESULT_CACHE_TTL_MS) {
    _resultCache.delete(key);
    return { hit: false, key, skipReason: 'CACHE_EXPIRED' };
  }
  return { hit: true, result: entry.result as T, ageMs, key };
}

/**
 * Cache store SSOT — P0_POSITION_EXIT 저장 금지 (절대 불변식).
 *
 * 결정 트리:
 *   1. ENV DISABLED → no-op
 *   2. P0_POSITION_EXIT → no-op
 *   3. result === null → no-op (실패 응답 cache 금지)
 *   4. 정상 응답 → store + light prune
 */
export function storeKisTrResultCache<T>(
  trId: string,
  symbol: string,
  priority: KisCallPriorityV2,
  params: Record<string, unknown>,
  result: T,
  nowMs: number = Date.now(),
): void {
  if (isKisResultCacheDisabled()) return;
  if (priority === 'P0_POSITION_EXIT') return;
  if (result === null || result === undefined) return;

  const key = buildResultCacheKey(trId, symbol, params);
  _resultCache.set(key, { key, result, cachedAtMs: nowMs });

  // Light prune — 100건 초과 시 만료 entry 정리
  if (_resultCache.size > 100) {
    const cutoff = nowMs - RESULT_CACHE_TTL_MS;
    for (const [k, e] of _resultCache) {
      if (e.cachedAtMs < cutoff) _resultCache.delete(k);
    }
  }
}

/**
 * `[KIS_TR_TTL_CACHE_HIT]` 진단 로그 SSOT (사용자 §"기대 로그" 정확 형식).
 *
 * cache hit 시 호출자가 emit. miss/skip 은 noise 차단 위해 로그 0건.
 */
export function formatKisTrTtlCacheHitLog(
  trId: string,
  symbol: string,
  ageMs: number,
): string {
  return [
    `[KIS_TR_TTL_CACHE_HIT]`,
    `trId=${trId}`,
    `symbol=${symbol}`,
    `ttlMs=${RESULT_CACHE_TTL_MS}`,
    `ageMs=${ageMs}`,
    `newNetworkCall=false`,
  ].join(' ');
}

// 테스트 격리 헬퍼
export function __resetKisTrResultCacheForTests(): void {
  _resultCache.clear();
}

export function getResultCacheSize(): number {
  return _resultCache.size;
}
