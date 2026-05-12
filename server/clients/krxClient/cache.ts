// @responsibility krxClient 10분 TTL 캐시 + investor-trading diagnostic SSOT
/**
 * krxClient/cache.ts — ADR-0502c 분해 SSOT.
 *
 * - 호출 결과 10분 TTL (CACHE_TTL_MS) in-memory map.
 * - 최근 investor-trading diagnostic (date 별) 외부 노출.
 *
 * NOTE: 전체 reset (cache + cooldown + http meta) 진입점은 *원본 krxClient.ts*
 *       또는 *index.ts barrel* 에서 다른 모듈의 reset 헬퍼들을 묶어 export.
 *       본 모듈은 자체 cleanup (`resetCacheState`) 만 제공.
 */

import { CACHE_TTL_MS } from './constants.js';
import { isValidYyyymmdd } from './dateUtils.js';
import type { KrxInvestorTradingDiagnostic } from './types.js';

interface CacheEntry<T> { data: T; expiresAt: number }
const _cache = new Map<string, CacheEntry<unknown>>();
const _lastInvestorTradingDiagnostics = new Map<string, KrxInvestorTradingDiagnostic>();

export function getCached<T>(key: string): T | null {
  const hit = _cache.get(key);
  if (!hit || hit.expiresAt <= Date.now()) return null;
  return hit.data as T;
}

export function setCached<T>(key: string, data: T): void {
  _cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function setInvestorTradingDiagnostic(tradeDate: string, diagnostic: KrxInvestorTradingDiagnostic): void {
  _lastInvestorTradingDiagnostics.set(tradeDate, diagnostic);
}

export function getLastKrxInvestorTradingDiagnostic(date?: string): KrxInvestorTradingDiagnostic | null {
  const tradeDate = date && isValidYyyymmdd(date) ? date : null;
  if (tradeDate) return _lastInvestorTradingDiagnostics.get(tradeDate) ?? null;
  return Array.from(_lastInvestorTradingDiagnostics.values()).at(-1) ?? null;
}

/** /api/system/krx-status 진단용 cache key 목록. */
export function listCacheKeys(): string[] {
  return Array.from(_cache.keys());
}

/** 자체 cleanup — 외부 `resetKrxCache` 진입점이 호출. */
export function resetCacheState(): void {
  _cache.clear();
  _lastInvestorTradingDiagnostics.clear();
}
