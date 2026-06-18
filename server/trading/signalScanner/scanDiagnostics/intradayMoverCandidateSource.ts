// @responsibility 신선 screener.json 당일 상위를 INTRADAY_MOVER candidate pool 입력으로 매핑(캐시 read·flag-gated).
// ADR-0629 — 신선 screener 당일 상위 → 메인 발굴 candidate pool 배선. flag default OFF byte-identical.

import { getScreenerCache, type ScreenedStock } from '../../../screener/stockScreener.js';
import type { CandidatePoolInputCandidate } from '../../candidatePoolBuilder.js';

/** ADR-0629 — 주입 kill-switch. default OFF → candidate pool byte-identical. */
export function isIntradayMoverCandidateSourceEnabled(): boolean {
  return process.env.INTRADAY_MOVER_CANDIDATE_SOURCE_ENABLED === 'true';
}

/** 당일 상위 주입 상한 (기본 20, 하한 0/NaN→20, 상한 50 clamp). */
export function getIntradayMoverMaxInject(): number {
  const raw = Number(process.env.INTRADAY_MOVER_MAX_INJECT);
  const n = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 20;
  return Math.min(50, n);                          // 상한 clamp (과열 폭주 방지)
}

/**
 * ScreenedStock → CandidatePoolInputCandidate 최소 hydration 매핑.
 * 식별(code/symbol)·가격(currentPrice/price)·거래량만 캐리. featureScores/penalties 미매핑 —
 * buildCandidatePool 의 minimal validity 필터·feature missing 채점(MISSING_FEATURE_SCORED)에 위임.
 * source 는 addCandidates 가 'INTRADAY_MOVER' 로 자동 태깅하므로 미설정.
 * 식별 불가(code 부재) 종목은 null → 호출부에서 skip.
 */
function mapScreenedToCandidate(stock: ScreenedStock): CandidatePoolInputCandidate | null {
  const code = typeof stock?.code === 'string' ? stock.code.trim() : '';
  if (!code) return null;                          // 식별 불가 → skip (throw 0)
  return {
    code,
    symbol: code,
    name: stock.name,
    currentPrice: stock.currentPrice,
    price: stock.currentPrice,
    volume: stock.volume,
    // dayChangeRate — 정렬·진단용 런타임 필드. 채점 입력 아님(유니버스 신선화).
    dayChangeRate: stock.changeRate,
  };
}

/**
 * 신선 screener.json 당일 상위 → INTRADAY_MOVER candidate pool 입력 매핑.
 * flag OFF → []  (getScreenerCache 미호출, candidate pool byte-identical).
 * flag ON  → getScreenerCache() changeRate 내림차순 상위 N(getIntradayMoverMaxInject) 매핑.
 * 신규 KIS fetch 0 — 캐시 read 만(ADR-0561). 실패/빈 캐시 → [] (조용히, 불변식 #1·#6).
 */
export function collectIntradayMoverCandidates(): CandidatePoolInputCandidate[] {
  if (!isIntradayMoverCandidateSourceEnabled()) return [];   // dead path, byte-identical

  try {
    const cache = getScreenerCache();
    if (!Array.isArray(cache) || cache.length === 0) return [];  // stale≠bearish (불변식 #6)

    const maxInject = getIntradayMoverMaxInject();
    return [...cache]
      .sort((a, b) => (Number(b?.changeRate) || 0) - (Number(a?.changeRate) || 0))
      .slice(0, maxInject)
      .map(mapScreenedToCandidate)
      .filter((c): c is CandidatePoolInputCandidate => c !== null);
  } catch (e) {
    /* SDS-ignore: 빈/실패 캐시는 발굴 스킵, 엔진 비차단 (불변식 #1·#6, stale≠bearish) */
    console.warn('[IntradayMoverCandidateSource] screener cache read/map 실패 — 주입 스킵', e);
    return [];
  }
}
