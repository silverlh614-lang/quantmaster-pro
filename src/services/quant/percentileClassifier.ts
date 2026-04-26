// @responsibility quant percentileClassifier 엔진 모듈
/**
 * percentileClassifier.ts — 퍼센타일 기반 종목 등급 분류기
 *
 * 문제: 고정 절대 점수 경계로 인한 등급 불안정 (Hold 과다, 비슷한 종목 다른 등급)
 * 해결: "연속 점수 → 구간(Zone) 분류" — 절대 점수 + 상대 퍼센타일 혼합
 *
 * 분류 기준 (하이브리드):
 *   normalizedScore ≥ 85 AND percentile < 0.10  → STRONG_BUY   (상위 10%)
 *   normalizedScore ≥ 75 AND percentile < 0.30  → BUY          (상위 30%)
 *   normalizedScore ≥ 60                         → HOLD
 *   normalizedScore ≥ 40                         → SELL
 *   else                                          → STRONG_SELL (하위 15%)
 *
 * Strong Buy 강화 조건 (6개 전부 만족 시에만 STRONG_BUY 발급):
 *   1. Gate 통과 (필수)
 *   2. RRR ≥ 2.0
 *   3. Confluence ≥ 3축 BULLISH
 *   4. Regime not R5/R6 (위기/폭락 레짐 제외)
 *   5. 최근 거래량 증가
 *   6. Drawdown 없음
 */

/** finalScore 정규화 기준값 (gateEngine 이론 최대치 근사) */
export const FINAL_SCORE_MAX = 270;

/** 퍼센타일 기반 종목 등급 */
export type PercentileZone = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';

/** 배치 퍼센타일 계산용 입력 */
export interface ScoredEntry {
  code: string;
  finalScore: number;
}

/** 퍼센타일 계산 결과 */
export interface ZonedEntry extends ScoredEntry {
  percentile: number;  // 0.0(최상위) ~ 1.0(최하위)
  normalizedScore: number;  // 0~100
  zone: PercentileZone;
}

/**
 * finalScore → 정규화 점수(0-100) 변환.
 * FINAL_SCORE_MAX를 기준으로 100점 척도로 변환하며 0~100으로 클램프.
 */
export function normalizeScore(finalScore: number): number {
  return Math.min(100, Math.max(0, (finalScore / FINAL_SCORE_MAX) * 100));
}

/**
 * 절대 점수 + 상대 퍼센타일 혼합 등급 분류.
 *
 * @param normalizedScore - 0~100 정규화 점수
 * @param percentile      - 0.0(최상위) ~ 1.0(최하위) 상대 순위
 */
export function computeHybridZone(normalizedScore: number, percentile: number): PercentileZone {
  if (normalizedScore >= 85 && percentile < 0.10) return 'STRONG_BUY';
  if (normalizedScore >= 75 && percentile < 0.30) return 'BUY';
  if (normalizedScore >= 60) return 'HOLD';
  if (normalizedScore >= 40) return 'SELL';
  return 'STRONG_SELL';
}

/**
 * 배치 종목 퍼센타일 등급 일괄 부여.
 * 모든 종목 점수 계산 후 rank / total 로 퍼센타일 산정 → computeHybridZone 적용.
 *
 * @param stocks - finalScore가 계산된 종목 배열
 * @returns 퍼센타일·정규화점수·등급이 추가된 배열 (원본 순서 유지)
 */
export function assignPercentileZones(stocks: ScoredEntry[]): ZonedEntry[] {
  if (stocks.length === 0) return [];

  const total = stocks.length;
  // 내림차순 정렬 인덱스 산출 (동점 처리: 같은 점수는 같은 rank)
  const sorted = [...stocks].sort((a, b) => b.finalScore - a.finalScore);

  return stocks.map((stock) => {
    const rank = sorted.findIndex((s) => s.code === stock.code && s.finalScore === stock.finalScore);
    const percentile = rank / total;
    const normalizedScore = normalizeScore(stock.finalScore);
    const zone = computeHybridZone(normalizedScore, percentile);
    return { ...stock, percentile, normalizedScore, zone };
  });
}

/** Strong Buy 6가지 필수 조건 입력 */
export interface StrongBuyQualificationCriteria {
  /** 1. Gate 1·2·3 전부 통과 */
  gatePassed: boolean;
  /** 2. 위험/보상 비율 ≥ 2.0 */
  rrr: number;
  /** 3. 4축 컨플루언스 중 BULLISH 축 수 */
  confluenceBullishAxes: number;
  /** 4. 레짐 코드 — R5(공황)/R6(붕괴) 제외 */
  regime: string;
  /** 5. 최근 거래량 증가 여부 (volumeTrend === 'INCREASING') */
  volumeIncreasing: boolean;
  /** 6. Drawdown 없음 (가격 > 최근 저점 대비 -5% 이상 하락 없음) */
  noDrawdown: boolean;
}

/**
 * Strong Buy 발급 자격 6개 조건 전부 충족 여부 검사.
 * 희귀해야 의미있는 STRONG_BUY — 6개 모두 통과해야만 true 반환.
 */
export function isStrongBuyQualified(criteria: StrongBuyQualificationCriteria): boolean {
  return (
    criteria.gatePassed &&
    criteria.rrr >= 2.0 &&
    criteria.confluenceBullishAxes >= 3 &&
    !['R5', 'R6'].includes(criteria.regime) &&
    criteria.volumeIncreasing &&
    criteria.noDrawdown
  );
}
