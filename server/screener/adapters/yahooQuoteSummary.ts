// @responsibility Yahoo quoteSummary 펀더멘털(PER/PBR/EPS) opportunistic enrichment (ADR-0536 C18 Phase 1)
/**
 * yahooQuoteSummary.ts — Yahoo quoteSummary 단일 책임 어댑터.
 *
 * ADR-0536 §"후속" Phase 1 wiring. `yahooQuoteAdapter.ts`(OHLCV 1y chart) 와는 다른
 * 엔드포인트(`/v10/finance/quoteSummary`) + 다른 응답 스키마라 단일 책임으로 분리.
 *
 * 정책 (ADR-0536):
 * - ENV `YAHOO_QUOTE_SUMMARY_PER_ENABLED=true` 명시 활성화. OFF default — OFF 시 즉시 null
 *   반환(외부 호출 0, byte-equivalent).
 * - Positive cache 5분 + Negative cache 30분 — rate-limit/부재 코드 재호출 억제.
 * - guardedFetch + IntentTag 'HISTORICAL' (ADR-0058) — egressGuard + outage budget 동일 정책.
 * - KRX 6자리 → Yahoo 심볼은 `.KS`(KOSPI) 우선, 실패 시 `.KQ`(KOSDAQ) 폴백. 마스터 결합은
 *   Phase 2(symbol resolver 결합) — Phase 1 은 단순 2단 시도 후 부재 코드는 negative cache.
 * - 응답 매핑 우선순위: trailingPE(summaryDetail) > trailingPE(defaultKeyStatistics) >
 *   forwardPE(defaultKeyStatistics). PBR 은 priceToBook(keyStats) > priceToBook(summaryDetail).
 *
 * 실패-soft: 모든 실패는 null 반환 (fetch throw / non-OK / 스키마 부재 / 모든 필드 0·null).
 * 호출자(/api/ai-universe/snapshot 핸들러)는 null 시 Naver 값을 그대로 사용한다.
 *
 * 데이터 신뢰 (ADR-0536 §"데이터 신뢰 등급"): Yahoo = L3. Naver(L3) 와 동일 등급 — 표시·
 * Gate2 보조 입력에만 사용. LIVE 매매 결정 경로(autoTradeEngine/kisClient) 무영향.
 */

import { guardedFetch } from '../../utils/egressGuard.js';

const POSITIVE_TTL_MS = 5 * 60 * 1000;     // 5 분 — fundamentals 갱신 주기 대비 충분
const NEGATIVE_TTL_MS = 30 * 60 * 1000;    // 30 분 — 부재/실패 코드 반복 호출 차단

export interface YahooQuoteSummaryFundamentals {
  /** trailingPE (1순위) → forwardPE 폴백. > 0 만 채택. */
  per: number | null;
  /** priceToBook. > 0 만 채택. */
  pbr: number | null;
  /** trailingEps / epsTrailingTwelveMonths. > 0 만 채택. PER 산출 검증·표시 보조용. */
  eps: number | null;
  /** 출처 표기 — ADR-0536 §"출처 명시(provenance)" 4값 중 2값을 본 어댑터가 사용. */
  source: 'YAHOO_QUOTE_SUMMARY' | 'UNAVAILABLE';
}

interface CacheEntry {
  value: YahooQuoteSummaryFundamentals | null;
  expiresAt: number;
}

const _cache = new Map<string, CacheEntry>();

/** 테스트 전용 — 캐시 리셋. */
export function __resetYahooQuoteSummaryCacheForTest(): void {
  _cache.clear();
}

/**
 * ENV gate. 'true' 정확 비교 — 빈/누락/기타 문자열은 모두 OFF(default). 운영자가 staging
 * 검증 후 명시 활성화하는 안전 모델 (ADR-0536 §"ENV gate (기본 OFF)").
 */
function isEnabled(): boolean {
  return process.env.YAHOO_QUOTE_SUMMARY_PER_ENABLED === 'true';
}

/** 후보 중 양의 유한수 1순위 채택. 그 외(0/NaN/Infinity/음수/null/undefined/non-numeric)는 건너뜀. */
function pickPositiveNumber(...candidates: unknown[]): number | null {
  for (const c of candidates) {
    const n = typeof c === 'number' ? c : Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** Yahoo 응답에서 PER/PBR/EPS 추출. result 가 빈 객체면 null 반환. */
function extractFundamentals(result: unknown): YahooQuoteSummaryFundamentals | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, any>;
  const summaryDetail = r.summaryDetail;
  const keyStats = r.defaultKeyStatistics;

  const per = pickPositiveNumber(
    summaryDetail?.trailingPE?.raw,
    keyStats?.trailingPE?.raw,
    keyStats?.forwardPE?.raw,
  );
  const pbr = pickPositiveNumber(
    keyStats?.priceToBook?.raw,
    summaryDetail?.priceToBook?.raw,
  );
  const eps = pickPositiveNumber(
    keyStats?.trailingEps?.raw,
    keyStats?.epsTrailingTwelveMonths?.raw,
    keyStats?.epsTrailingTwelveMonths,
  );

  if (per === null && pbr === null && eps === null) return null;
  return { per, pbr, eps, source: 'YAHOO_QUOTE_SUMMARY' };
}

/**
 * 단일 suffix 로 Yahoo quoteSummary 요청. 실패·non-OK·스키마 부재는 null.
 */
async function tryFetchOnce(code: string, suffix: '.KS' | '.KQ'): Promise<YahooQuoteSummaryFundamentals | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${code}${suffix}?modules=summaryDetail,defaultKeyStatistics`;
    const res = await guardedFetch(url, { method: 'GET' }, 'HISTORICAL');
    if (!res.ok) return null;
    const json = await res.json() as any;
    const result = json?.quoteSummary?.result?.[0];
    return extractFundamentals(result);
  } catch {
    return null;
  }
}

/**
 * 6자리 KRX 종목코드 → Yahoo quoteSummary 펀더멘털.
 *
 * 반환 의미:
 * - `null` — ENV OFF / 형식 위반 / 모든 suffix 실패 / 모든 필드 부재. 호출자는 Naver 값
 *   그대로 사용 (옵셔널 보강이므로 강제 차단 금지).
 * - `{ per, pbr, eps, source: 'YAHOO_QUOTE_SUMMARY' }` — 최소 1개 양의 값 확보.
 *
 * ENV OFF 시 외부 호출 0건 (byte-equivalent). 캐시도 사용하지 않음 (활성화 후 신선한 첫
 * 호출 보장).
 */
export async function fetchYahooQuoteSummary(code: string): Promise<YahooQuoteSummaryFundamentals | null> {
  if (!isEnabled()) return null;
  if (!/^\d{6}$/.test(code)) return null;

  const now = Date.now();
  const cached = _cache.get(code);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  // .KS 우선 → 실패 시 .KQ 폴백. Phase 2 에서 SymbolMarketRegistry 결합으로 1발 정확화.
  let value = await tryFetchOnce(code, '.KS');
  if (!value) value = await tryFetchOnce(code, '.KQ');

  const expiresAt = now + (value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS);
  _cache.set(code, { value, expiresAt });
  return value;
}
