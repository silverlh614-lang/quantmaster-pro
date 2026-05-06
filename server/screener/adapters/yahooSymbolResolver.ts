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
import { updateYahooFreshness } from '../../persistence/yahooFreshnessLedger.js';
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
 * ADR-0241: Yahoo quote 응답 sanity 검증 SSOT.
 *
 * 기존 nullish (`??`) 폴백 결함 — `.KS` 응답이 *non-null + STALE_BASE* 일 때
 * `.KQ` fallback 미작동. 사용자 5/6 보고 "코스닥 12종목 즉시 정상화" 패턴.
 *
 * sanity 기준: dataQuality !== 'STALE_BASE' (yahooQuoteAdapter ADR-0091/0235
 * 가 STALE_BASE marker 부착 — changePercent / return5d / return20d sanity
 * 위반 또는 closeTimestamps 7일+ stale).
 *
 * 향후 확장 가능 (price > 0 / volume > 0 / meta.symbol 일치 등).
 */
export function isQuoteSane(quote: YahooQuoteExtended): boolean {
  return quote.dataQuality !== 'STALE_BASE';
}

/**
 * code → Yahoo quote fetch 통합. 마스터 매칭 시 정확한 1회 fetch.
 * 마스터 부재 시 보수적 양쪽 시도 fallback (마이그레이션 그레이스).
 *
 * ADR-0241: sanity 검증 추가 — non-null 이지만 STALE_BASE 응답은 거부 + 다른
 * 시장 fallback (마스터 매칭 시) / 양쪽 sanity 검증 (마스터 부재 시).
 *
 * fetcher 는 호출자가 전달 — 순환 import 회피 (yahooQuoteAdapter ↔ yahooSymbolResolver).
 */
export async function fetchYahooQuoteWithMarketFallback(
  code: string,
  fetcher: (sym: string) => Promise<YahooQuoteExtended | null>,
): Promise<YahooQuoteExtended | null> {
  // ADR-0255: ledger 갱신은 *최종 결과* 시점 1회만 — 양 시장 fallback 시도 중간
  // 결과는 trail 안 함 (consecutiveStaleCount 폭주 방지).
  let finalSymbol = `${code}.UNKNOWN`;
  let finalQuote: YahooQuoteExtended | null = null;
  const recordResult = (): YahooQuoteExtended | null => {
    try {
      updateYahooFreshness(code, finalSymbol, finalQuote);
    } catch (e) {
      console.warn(`[yahooSymbolResolver] ADR-0255 ledger 갱신 실패 (code=${code}):`, e);
    }
    return finalQuote;
  };

  const resolved = resolveYahooSymbolForCode(code);
  if (resolved) {
    const quote = await fetcher(resolved).catch(() => null);
    if (quote && isQuoteSane(quote)) {
      finalSymbol = resolved;
      finalQuote = quote;
      return recordResult();
    }

    // ADR-0241: 마스터 매칭됐으나 null 또는 sanity 위반 → 다른 시장 fallback.
    // 사용자 5/6 보고: KOSPI 마스터 매칭 .KS 응답이 STALE_BASE → .KQ 시도.
    // KRX 시장 이전 종목 / 마스터 stale / Yahoo 측 매핑 결함 모두 자동 회복.
    const otherSym = resolved.endsWith('.KS') ? `${code}.KQ` : `${code}.KS`;
    const otherQuote = await fetcher(otherSym).catch(() => null);
    if (otherQuote && isQuoteSane(otherQuote)) {
      console.warn(
        `[yahooSymbolResolver] ${code} 마스터 매칭(${resolved}) sane 실패 → ` +
        `${otherSym} sane fallback (ADR-0241)`,
      );
      finalSymbol = otherSym;
      finalQuote = otherQuote;
      return recordResult();
    }

    // 양쪽 모두 실패 시 진단 로그.
    if (!quote && !otherQuote) {
      console.warn(
        `[yahooSymbolResolver] ${code} 양 시장 fetch 모두 실패 ` +
        `(resolved=${resolved}, otherSym=${otherSym}, ADR-0241).`,
      );
    } else if (quote && !isQuoteSane(quote) && !otherQuote) {
      console.warn(
        `[yahooSymbolResolver] ${code} 마스터(${resolved}) STALE_BASE + ` +
        `${otherSym} fetch 실패 — KIS fallback 트리거 (ADR-0241).`,
      );
    }
    finalSymbol = resolved;
    finalQuote = quote ?? otherQuote ?? null; // 더 sane 한 쪽 (둘 다 STALE 이면 quote)
    return recordResult();
  }

  // 마스터 부재 → 양쪽 시도 + sanity 검증 (ADR-0241).
  const ksQuote = await fetcher(`${code}.KS`).catch(() => null);
  if (ksQuote && isQuoteSane(ksQuote)) {
    finalSymbol = `${code}.KS`;
    finalQuote = ksQuote;
    return recordResult();
  }

  // ADR-0241 핵심: ksQuote 가 null 이 아니어도 STALE_BASE 면 .KQ 시도.
  const kqQuote = await fetcher(`${code}.KQ`).catch(() => null);
  if (kqQuote && isQuoteSane(kqQuote)) {
    finalSymbol = `${code}.KQ`;
    finalQuote = kqQuote;
    return recordResult();
  }

  finalSymbol = `${code}.KS`; // 실패 시 .KS 로 ledger 등록 (관용)
  finalQuote = ksQuote ?? kqQuote ?? null;
  recordResult();
  return null;
}

/**
 * Legacy alias — 기존 5 호출자 (ADR-0231 PR #624 wiring) 후방호환.
 * buyPipeline / trancheExecutor / buyListLoop / intradayScanner / dryRunScanner
 * 가 본 명칭으로 호출 중 — 재 wiring 회피.
 */
export const fetchYahooQuoteByCode = fetchYahooQuoteWithMarketFallback;

/**
 * ADR-0249: 마스터 미등록 종목 진단용 에러 — 호출자가 catch 후 ADR-0242
 * autoEnrichStockMaster() 트리거 가능. 일반 코드 경로는 tryGetYahooSymbol 사용 권장.
 */
export class MarketUnknownError extends Error {
  readonly code: string;
  constructor(code: string, hint: string) {
    super(`[MarketUnknownError] code=${code}: ${hint}`);
    this.name = 'MarketUnknownError';
    this.code = code;
  }
}

/**
 * ADR-0249: 글로벌 Yahoo 심볼 SSOT — 한국 종목 코드 → .KS / .KQ 변환 단일 진입점.
 *
 * 마스터 부재 시 throw → 호출자가 ADR-0242 autoEnrichStockMaster() 트리거 가능.
 * try/catch 회피 호출자는 tryGetYahooSymbol() 사용 권장.
 *
 * 모든 신규 코드는 본 함수 또는 tryGetYahooSymbol 사용 — `${code}.KS` / `.KQ`
 * 직접 조립 금지 (ADR-0231 정합).
 */
export function getYahooSymbol(code: string): string {
  const symbol = resolveYahooSymbolForCode(code);
  if (!symbol) {
    throw new MarketUnknownError(
      code,
      '마스터 미등록 — autoEnrichStockMaster() 호출 필요 (ADR-0242)',
    );
  }
  return symbol;
}

/**
 * ADR-0249: try-pattern — 마스터 부재 시 null 반환. resolveYahooSymbolForCode 별칭.
 * 신규 호출자는 본 함수 사용 권장 (예외 처리 부담 회피).
 */
export const tryGetYahooSymbol = resolveYahooSymbolForCode;
