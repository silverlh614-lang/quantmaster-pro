// @responsibility 기술지표 quote 출처 라우터 — KIS-first 시 KIS 일봉 1차 Yahoo chart fallback. 신규 계산 없이 기존 빌더 재사용.
/**
 * adapters/technicalQuoteRouter.ts — 기술지표 OHLCV quote 출처 라우터 (ADR-0547).
 *
 * **default KIS-first**(ENV KIS_OHLCV_PRIMARY_ENABLED!=='false' 또는 opts.kisFirst): KIS 일봉(L1)
 * 기술지표를 1차로 산출(fetchKisQuoteFallback 재사용)하고, 실패/봉수부족 시 Yahoo chart(L3)로
 * fallback 한다. `KIS_OHLCV_PRIMARY_ENABLED=false` 로 기존 Yahoo-first 순서 롤백(ADR-0561 KIS-primary).
 *
 * 신규 지표 계산 없음 — fetchKisQuoteFallback/buildExtendedFromKisDaily/enrichQuoteWithKisMTAS
 * 를 재사용. 현재가(quote) fallback 라우터 SSOT(docs/ai/05) 와 직교(시계열 endpoint 별개).
 *
 * 일봉 6h 캐시 + 휴장 인지 TTL 연장으로 풀스캔 외 경로의 KIS quota 신규 소비를 최소화한다
 * (휴장/주말엔 마지막 거래일 일봉이 불변 → 0콜 재사용). 휴장 판정은 기존 marketClock 만 사용
 * (chk-holiday 신규 배선은 ADR-0548 별도).
 */

import { fetchYahooQuote, type YahooQuoteExtended } from './yahooQuoteAdapter.js';
import { fetchKisQuoteFallback, enrichQuoteWithKisMTAS } from './kisQuoteAdapter.js';
import { fetchYahooQuoteByCode } from './yahooSymbolResolver.js';
import { isKstWeekend, classifyMarketDataMode } from '../../utils/marketClock.js';

/** 진단용 로컬 출처 태그(서버 전용; src/types 승격 금지 — ADR-0547 Decision §4). */
type TechnicalQuoteSource = 'KIS_DAILY' | 'YAHOO_CHART' | 'CACHE';

export interface FetchTechnicalQuoteOptions {
  /** true(또는 ENV KIS_OHLCV_PRIMARY_ENABLED='true') 시 KIS 일봉을 1차 출처로 사용. */
  kisFirst?: boolean;
}

/**
 * ENV 글로벌 토글 — **default ON(KIS-first)**. ADR-0157 정확 비교: 'false' 일 때만 비활성(Yahoo-first 롤백).
 * 2026-06-06: 코드 default 를 KIS-first 로 전환 — 외부 ENV 미설정에도 KIS 1차(Yahoo 의존 축소, ADR-0561
 * KIS-primary). 롤백은 `KIS_OHLCV_PRIMARY_ENABLED=false` 1줄. KIS 실패/봉수부족 시 Yahoo fallback 보존.
 */
function isKisPrimaryEnvEnabled(): boolean {
  return process.env.KIS_OHLCV_PRIMARY_ENABLED !== 'false';
}

// ── 일봉 6h 캐시 + 휴장 인지 TTL 연장 (ADR-0547 Decision §6) ────────────────────
// KIS FHKST03010100 일봉은 휴장·주말에 "마지막 거래일 OHLCV"가 불변이므로, 휴장 구간에서는
// TTL 을 길게 잡아 신규 호출 0콜이 되게 한다. (kisChartDataFetcher 의 MTAS 6h 캐시 패턴 복제.)
const KIS_DAILY_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6시간 (장중 기본)
const KIS_DAILY_CACHE_TTL_CLOSED_MS = 18 * 60 * 60 * 1000; // 휴장/주말: 익일 장개시까지 연장
const KIS_DAILY_CACHE_MAX = 500;

interface KisDailyCacheEntry {
  ts: number;
  quote: YahooQuoteExtended;
}
const _kisDailyQuoteCache = new Map<string, KisDailyCacheEntry>();

/**
 * 현재 KST 가 휴장(주말 또는 장 미개장)인지 추정 — 휴장이면 일봉 캐시 TTL 을 연장한다.
 * classifyMarketDataMode 가 'LIVE_TRADING_DAY' 이외(WEEKEND_CACHE/AFTER_MARKET)면 일봉 불변.
 */
function isMarketClosedNow(): boolean {
  try {
    if (isKstWeekend()) return true;
    return classifyMarketDataMode() !== 'LIVE_TRADING_DAY';
  } catch {
    // marketClock 판정 실패 시 보수적으로 비-휴장(짧은 TTL)으로 취급(과다 캐시 방지).
    return false;
  }
}

function getActiveDailyCacheTtlMs(): number {
  return isMarketClosedNow() ? KIS_DAILY_CACHE_TTL_CLOSED_MS : KIS_DAILY_CACHE_TTL_MS;
}

function getKisDailyCached(code: string): YahooQuoteExtended | null {
  const e = _kisDailyQuoteCache.get(code);
  if (!e) return null;
  if (Date.now() - e.ts > getActiveDailyCacheTtlMs()) {
    _kisDailyQuoteCache.delete(code);
    return null;
  }
  return e.quote;
}

function setKisDailyCached(code: string, quote: YahooQuoteExtended): void {
  if (_kisDailyQuoteCache.size >= KIS_DAILY_CACHE_MAX) {
    const oldest = _kisDailyQuoteCache.keys().next().value;
    if (oldest) _kisDailyQuoteCache.delete(oldest);
  }
  _kisDailyQuoteCache.set(code, { ts: Date.now(), quote });
}

/** 테스트/운영 진단용 캐시 클리어(서버 전용). */
export function _clearKisDailyQuoteCache(): void {
  _kisDailyQuoteCache.clear();
}

/**
 * KIS-first 정상흐름 marker 부착 — 필드명/리터럴은 기존 SSOT 그대로(ADR-0547 Decision §3).
 * stockScreener 강등 분기(KIS_PRIMARY_YAHOO_STALE_DETECTED)로 새지 않도록 'KIS_PRIMARY' 만 부여.
 */
function withKisPrimaryMarker(quote: YahooQuoteExtended): YahooQuoteExtended {
  return { ...quote, dataQuality: 'KIS_PRIMARY', priceProvider: 'KIS_PRICE' };
}

/**
 * 기술지표 quote 출처 라우터.
 *
 * - 기본 KIS-first(opts.kisFirst 또는 ENV≠'false'): 6h/휴장 TTL 캐시 히트 우선 → `fetchKisQuoteFallback(code)`
 *   1차 → 성공 시 BB폭/MTAS 보강(enrichQuoteWithKisMTAS) + KIS_PRIMARY marker → 캐시 저장.
 *   실패/null/봉수부족 시 `fetchYahooQuote(symbol)` fallback.
 * - 롤백(ENV='false'): 기존대로 `fetchYahooQuote(symbol)` 먼저(Yahoo-first).
 *
 * 출력은 기존 `YahooQuoteExtended`(SSOT) 그대로 — 소비부 무변경.
 */
export async function fetchTechnicalQuote(
  code: string,
  symbol: string,
  opts?: FetchTechnicalQuoteOptions,
): Promise<YahooQuoteExtended | null> {
  const kisFirst = opts?.kisFirst === true || isKisPrimaryEnvEnabled();

  if (!kisFirst) {
    // 기본 경로 — 기존 Yahoo-first 동작 보존(회귀 0).
    return fetchYahooQuote(symbol);
  }

  // KIS-first 경로 — 6h/휴장 TTL 캐시 히트 우선(신규 KIS 호출 0콜).
  let source: TechnicalQuoteSource = 'CACHE';
  const cached = getKisDailyCached(code);
  if (cached) {
    void source;
    return cached;
  }

  let kisQuote: YahooQuoteExtended | null = null;
  try {
    kisQuote = await fetchKisQuoteFallback(code);
  } catch (e) {
    // KIS 일봉 조회 실패는 약세 신호가 아니다(불변식 #6) → Yahoo fallback 으로 graceful 강등.
    console.warn(`[technicalQuoteRouter] ${code} KIS-first 실패 → Yahoo fallback:`, e instanceof Error ? e.message : e);
    kisQuote = null;
  }

  if (kisQuote) {
    source = 'KIS_DAILY';
    // BB폭/MTAS 정밀값 결손 보강(기존 함수 재사용). 보강 실패는 비치명 — KIS 일봉 결과 유지.
    let enriched: YahooQuoteExtended = kisQuote;
    try {
      enriched = await enrichQuoteWithKisMTAS(kisQuote, code);
    } catch (e) {
      console.warn(`[technicalQuoteRouter] ${code} MTAS 보강 실패(KIS 일봉 유지):`, e instanceof Error ? e.message : e);
      enriched = kisQuote;
    }
    const marked = withKisPrimaryMarker(enriched);
    setKisDailyCached(code, marked);
    void source; // 진단 태그(현재 로깅 미사용; 향후 텔레메트리 hook 지점).
    return marked;
  }

  // KIS 실패/봉수부족 → Yahoo fallback(회귀 0).
  source = 'YAHOO_CHART';
  void source;
  return fetchYahooQuote(symbol);
}

/**
 * 기술지표 quote 출처 라우터 — code-진입 변형 (ADR-0547 R1 Extension / ADR-0561 grandfather burn-down).
 *
 * symbol 을 호출처가 resolve 하지 않아도 되는 code-진입 계약. grandfather callsite
 * `fetchYahooQuoteByCode(code, fetchYahooQuote)` 를 byte-equivalent 하게 치환할 수 있게 한다.
 *
 * - 롤백(`opts?.kisFirst !== true && KIS_OHLCV_PRIMARY_ENABLED === 'false'`):
 *   `fetchYahooQuoteByCode(code, fetchYahooQuote)` funnel 을 **그대로 위임·반환** → byte-equal(Yahoo-first).
 *   보장 6항(ADR-0547 R1 RX-B): (1) 호출 수 동일(funnel 1회) (2) 반환 타입 YahooQuoteExtended 동일
 *   (3) yahooFreshnessLedger 부수효과(ADR-0255) 동일 (4) dataQuality/priceMetadata marker 동일
 *   (5) .KS↔.KQ sanity fallback(ADR-0241) 동일 (6) funnel ① KIS-first 부분동작 동일.
 * - 기본 KIS-first(ENV≠'false'): 6h/휴장 TTL 캐시 → `fetchKisQuoteFallback(code)` → enrich → KIS_PRIMARY marker → 캐시.
 *   KIS 불가(null/throw/봉수부족) 시 `fetchYahooQuoteByCode(code, fetchYahooQuote)` funnel 로 fallback
 *   (symbol resolve 책임을 호출처에 전가하지 않음 — code-진입 일관성, ADR-0561).
 *
 * 출력은 기존 `YahooQuoteExtended`(SSOT) 그대로 — 소비부 무변경, 신규 타입 0.
 */
export async function fetchTechnicalQuoteByCode(
  code: string,
  opts?: FetchTechnicalQuoteOptions,
): Promise<YahooQuoteExtended | null> {
  const kisFirst = opts?.kisFirst === true || isKisPrimaryEnvEnabled();

  if (!kisFirst) {
    // flag OFF — funnel 그대로 위임(byte-equal: 호출수·타입·ledger·marker·sanity·KIS-first 부분동작 동일).
    return fetchYahooQuoteByCode(code, fetchYahooQuote);
  }

  // KIS-first 경로 — 6h/휴장 TTL 캐시 히트 우선(신규 KIS 호출 0콜).
  let source: TechnicalQuoteSource = 'CACHE';
  const cached = getKisDailyCached(code);
  if (cached) {
    void source;
    return cached;
  }

  let kisQuote: YahooQuoteExtended | null = null;
  try {
    kisQuote = await fetchKisQuoteFallback(code);
  } catch (e) {
    // KIS 일봉 조회 실패는 약세 신호가 아니다(불변식 #6) → Yahoo funnel fallback 으로 graceful 강등.
    console.warn(`[technicalQuoteRouter] ${code} KIS-first(byCode) 실패 → Yahoo fallback:`, e instanceof Error ? e.message : e);
    kisQuote = null;
  }

  if (kisQuote) {
    source = 'KIS_DAILY';
    let enriched: YahooQuoteExtended = kisQuote;
    try {
      enriched = await enrichQuoteWithKisMTAS(kisQuote, code);
    } catch (e) {
      console.warn(`[technicalQuoteRouter] ${code} MTAS 보강 실패(KIS 일봉 유지):`, e instanceof Error ? e.message : e);
      enriched = kisQuote;
    }
    const marked = withKisPrimaryMarker(enriched);
    setKisDailyCached(code, marked);
    void source;
    return marked;
  }

  // KIS 실패/봉수부족 → Yahoo funnel fallback(code-진입 일관성: symbol resolve 전가 0).
  source = 'YAHOO_CHART';
  void source;
  return fetchYahooQuoteByCode(code, fetchYahooQuote);
}
