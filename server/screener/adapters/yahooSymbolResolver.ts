// @responsibility WatchlistEntry/code → Yahoo symbol 변환 단일 SSOT (ADR-0231)
/**
 * adapters/yahooSymbolResolver.ts — Yahoo 심볼 변환 + fetch 폴백 SSOT.
 *
 * ADR-0231: 5+ 운영 경로 (buyPipeline / trancheExecutor / buyListLoop /
 * intradayScanner / dryRunScanner) 가 각자 `${code}.KS ?? ${code}.KQ`
 * brute-force fetch 패턴을 중복 보유하던 결함 차단. KRX 마스터 (krxStockMasterRepo)
 * 의 market 필드를 1차 매칭 → 정확한 1회 fetch. 마스터 부재 시 보수적 양쪽 시도
 * fallback (마이그레이션 그레이스 기간).
 *
 * 호출자는 fetcher 함수를 파라미터로 전달 — yahooQuoteAdapter 와 순환 import
 * 회피 (type-only import 만 사용).
 */

import { getStockByCode } from '../../persistence/krxStockMasterRepo.js';
import type { YahooQuoteExtended } from './yahooQuoteAdapter.js';

/**
 * code → Yahoo symbol 매핑.
 * - KOSPI → `${code}.KS`
 * - KOSDAQ → `${code}.KQ`
 * - 마스터 미커버 (KONEX/OTHER/부재) → null
 */
export function resolveYahooSymbolForCode(code: string): string | null {
  const entry = getStockByCode(code);
  if (!entry) return null;
  if (entry.market === 'KOSPI') return `${code}.KS`;
  if (entry.market === 'KOSDAQ') return `${code}.KQ`;
  return null;
}

/**
 * code → Yahoo quote fetch 통합. 마스터 매칭 시 정확한 1회 fetch.
 * 마스터 부재 시 보수적 양쪽 시도 fallback (마이그레이션 그레이스).
 *
 * fetcher 는 호출자가 전달 — 순환 import 회피 (yahooQuoteAdapter ↔ yahooSymbolResolver).
 */
export async function fetchYahooQuoteByCode(
  code: string,
  fetcher: (sym: string) => Promise<YahooQuoteExtended | null>,
): Promise<YahooQuoteExtended | null> {
  const resolved = resolveYahooSymbolForCode(code);
  if (resolved) {
    const quote = await fetcher(resolved).catch(() => null);
    if (quote) return quote;
    // 마스터가 정확한데 조회 실패 → 시장 분류 갱신 필요 의심, 양쪽 시도하지 않음.
    console.warn(
      `[yahooSymbolResolver] ${code} 마스터 매칭 실패 ` +
      `(resolved=${resolved}, market mismatch?, ADR-0231)`,
    );
    return null;
  }
  // 마스터 부재 → 보수적 양쪽 시도 fallback.
  return (await fetcher(`${code}.KS`).catch(() => null))
      ?? (await fetcher(`${code}.KQ`).catch(() => null));
}
