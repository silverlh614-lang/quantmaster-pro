/**
 * @responsibility 27조건 귀인 분석 — Alpha Driver / Risk Protector / Noise / False Comfort 분류
 *
 * ADR-0026 (PR-I): 매매 결과에 대한 조건의 질적 역할 분류. PR-A~E 의 데이터 위에
 * 올라가는 읽기 전용 분석 레이어 — 학습 가중치 보정과 별개. raw 점수 분포만 봄.
 */
import type { TradeRecord } from '../../types/portfolio';
import type { ConditionId } from '../../types/core';

export type AttributionClass =
  | 'ALPHA_DRIVER'      // 수익 거래에서 반복 강함
  | 'RISK_PROTECTOR'    // 손실에서도 낮음 — 발동 안 해서 도움
  | 'NOISE_FACTOR'      // 수익/손실과 무관
  | 'FALSE_COMFORT';    // 손실 거래에서 높게 나옴 (후행 신호 의심)

export interface ConditionAttribution {
  conditionId: ConditionId;
  classification: AttributionClass;
  /** 승리 거래의 평균 조건 점수 (0~10) */
  winAvgScore: number;
  /** 손실 거래의 평균 조건 점수 (0~10) */
  lossAvgScore: number;
  /** winAvgScore - lossAvgScore */
  spread: number;
  winCount: number;
  lossCount: number;
  /** 양쪽 그룹 ≥ 5건 (신뢰 표본) */
  reliable: boolean;
}

/** 신뢰 표본 최소 거래 수 (각 그룹). */
export const ATTRIBUTION_MIN_GROUP = 5;
/** ALPHA_DRIVER / FALSE_COMFORT 경계 spread */
export const ATTRIBUTION_SPREAD_THRESHOLD = 2;
/** ALPHA_DRIVER / FALSE_COMFORT 절대값 임계 */
export const ATTRIBUTION_ABS_THRESHOLD = 5;
/** RISK_PROTECTOR 양쪽 점수 모두 < 임계 */
export const RISK_PROTECTOR_LOW_THRESHOLD = 3;

function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;
}

/**
 * 단일 조건의 귀인 분류.
 *
 * 우선순위:
 *  1. ALPHA_DRIVER  — spread ≥ +2 + winAvgScore ≥ 5
 *  2. FALSE_COMFORT — spread ≤ -2 + lossAvgScore ≥ 5
 *  3. RISK_PROTECTOR — winAvgScore < 3 AND lossAvgScore < 3
 *  4. NOISE_FACTOR  — 위 모두 미해당
 */
export function classifyConditionAttribution(
  conditionId: ConditionId,
  closedTrades: TradeRecord[],
): ConditionAttribution {
  const wins = closedTrades.filter(t => (t.returnPct ?? 0) > 0);
  const losses = closedTrades.filter(t => (t.returnPct ?? 0) < 0);

  const winScores = wins.map(t => t.conditionScores?.[conditionId] ?? 0);
  const lossScores = losses.map(t => t.conditionScores?.[conditionId] ?? 0);

  const winAvgScore = Number(mean(winScores).toFixed(2));
  const lossAvgScore = Number(mean(lossScores).toFixed(2));
  const spread = Number((winAvgScore - lossAvgScore).toFixed(2));

  const reliable = wins.length >= ATTRIBUTION_MIN_GROUP &&
                   losses.length >= ATTRIBUTION_MIN_GROUP;

  let classification: AttributionClass;
  if (spread >= ATTRIBUTION_SPREAD_THRESHOLD && winAvgScore >= ATTRIBUTION_ABS_THRESHOLD) {
    classification = 'ALPHA_DRIVER';
  } else if (spread <= -ATTRIBUTION_SPREAD_THRESHOLD && lossAvgScore >= ATTRIBUTION_ABS_THRESHOLD) {
    classification = 'FALSE_COMFORT';
  } else if (winAvgScore < RISK_PROTECTOR_LOW_THRESHOLD && lossAvgScore < RISK_PROTECTOR_LOW_THRESHOLD) {
    classification = 'RISK_PROTECTOR';
  } else {
    classification = 'NOISE_FACTOR';
  }

  return {
    conditionId,
    classification,
    winAvgScore,
    lossAvgScore,
    spread,
    winCount: wins.length,
    lossCount: losses.length,
    reliable,
  };
}

/**
 * 27조건 일괄 분류 — 분류별로 그룹핑.
 */
export function classifyAllConditions(
  closedTrades: TradeRecord[],
): {
  alphaDrivers: ConditionAttribution[];
  riskProtectors: ConditionAttribution[];
  noiseFactors: ConditionAttribution[];
  falseComforts: ConditionAttribution[];
  reliableCount: number;
} {
  const all: ConditionAttribution[] = [];
  for (let i = 1; i <= 27; i++) {
    all.push(classifyConditionAttribution(i as ConditionId, closedTrades));
  }
  return {
    alphaDrivers: all.filter(a => a.classification === 'ALPHA_DRIVER'),
    riskProtectors: all.filter(a => a.classification === 'RISK_PROTECTOR'),
    noiseFactors: all.filter(a => a.classification === 'NOISE_FACTOR'),
    falseComforts: all.filter(a => a.classification === 'FALSE_COMFORT'),
    reliableCount: all.filter(a => a.reliable).length,
  };
}
