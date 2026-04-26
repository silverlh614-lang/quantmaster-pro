/**
 * @responsibility 학습 알고리즘 Shadow Model — LIVE 미반영 비교 검증 (ADR-0027)
 *
 * PR-A~I 가 학습 알고리즘을 점진적으로 강화. 향후 큰 알고리즘 변경(예: Edge
 * Score 기반 가중치, 새 multiplier) 도입 시 LIVE 가중치를 망치지 않고 30~100건
 * 그림자 검증 후 승격 가능한 구조 마련.
 */
import type { TradeRecord, FeedbackLoopResult, ConditionCalibration } from '../../types/portfolio';
import type { ConditionId } from '../../types/core';
import { evaluateFeedbackLoop, type FeedbackLoopOptions } from './feedbackLoopEngine';

export interface ConditionDivergence {
  conditionId: ConditionId;
  liveWeight: number;
  shadowWeight: number;
  /** shadowWeight - liveWeight (양수=섀도가 더 강한 상향 조정) */
  delta: number;
  liveDirection: ConditionCalibration['direction'];
  shadowDirection: ConditionCalibration['direction'];
  /** direction 일치 여부 */
  agreement: 'AGREE' | 'DISAGREE';
}

export interface ShadowComparisonResult {
  live: FeedbackLoopResult;
  shadow: FeedbackLoopResult;
  divergence: ConditionDivergence[];
  /** 분류된 27조건 중 동일 direction 비율 (0~1) — 1=섀도가 라이브와 완전 일치 */
  shadowConfidence: number;
  /** 평균 |delta| (가중치 차이 평균) */
  avgWeightDelta: number;
}

/**
 * 동일 거래 데이터에 대해 LIVE 옵션 (기본) + Shadow 옵션 (override) 두 번 실행 후 비교.
 *
 * shadow 결과는 항상 `shadow=true` 로 강제되어 LIVE 가중치 영향 없음.
 *
 * @param closedTrades 종료 거래
 * @param currentWeights 현재 가중치 (LIVE/Shadow 동일 입력)
 * @param shadowOptions 섀도용 알고리즘 override (weightStep / threshold 등)
 */
export function compareShadowVsLive(
  closedTrades: TradeRecord[],
  currentWeights: Record<number, number> = {},
  shadowOptions: Omit<FeedbackLoopOptions, 'shadow'> = {},
): ShadowComparisonResult {
  // LIVE 평가 — shadow=false 기본 동작 + 호출자 책임 (이미 LIVE 학습 사이클에서 실행됨)
  // 본 비교 호출은 read-only 의도이므로 LIVE 도 shadow=true 로 강제해 부작용 차단.
  // 실제 LIVE 학습은 별도 호출 (useTradeOps useEffect 등) 에서 수행됨.
  const live = evaluateFeedbackLoop(closedTrades, currentWeights, { shadow: true });
  const shadow = evaluateFeedbackLoop(closedTrades, currentWeights, {
    ...shadowOptions,
    shadow: true,
  });

  const divergence: ConditionDivergence[] = [];
  const liveCalsById = new Map(live.calibrations.map(c => [c.conditionId, c]));
  const shadowCalsById = new Map(shadow.calibrations.map(c => [c.conditionId, c]));

  // 두 결과 모두 등장한 조건만 비교 (한쪽만 있으면 표본 부족 → 비교 무의미)
  for (const id of liveCalsById.keys()) {
    const liveCal = liveCalsById.get(id);
    const shadowCal = shadowCalsById.get(id);
    if (!liveCal || !shadowCal) continue;
    const delta = parseFloat((shadowCal.newWeight - liveCal.newWeight).toFixed(2));
    divergence.push({
      conditionId: id,
      liveWeight: liveCal.newWeight,
      shadowWeight: shadowCal.newWeight,
      delta,
      liveDirection: liveCal.direction,
      shadowDirection: shadowCal.direction,
      agreement: liveCal.direction === shadowCal.direction ? 'AGREE' : 'DISAGREE',
    });
  }

  const agreeCount = divergence.filter(d => d.agreement === 'AGREE').length;
  const shadowConfidence = divergence.length > 0
    ? Number((agreeCount / divergence.length).toFixed(4))
    : 0;
  const avgWeightDelta = divergence.length > 0
    ? Number((divergence.reduce((s, d) => s + Math.abs(d.delta), 0) / divergence.length).toFixed(3))
    : 0;

  return { live, shadow, divergence, shadowConfidence, avgWeightDelta };
}

/**
 * Shadow 결과가 promotion candidate 인지 판정.
 *
 * 기준 (사용자 분석 보완점 6 — 보수적 적용):
 *  - shadowConfidence ≥ 0.8 (80% 이상 일치) AND
 *  - avgWeightDelta ≤ 0.05 (평균 가중치 차이 5% 이하) AND
 *  - 비교 가능 조건 ≥ 5
 *
 * 충족 시 운영자가 검토 후 옵션 변경을 LIVE 적용 가능. 미충족 시 추가 데이터 수집.
 */
export function isPromotable(comparison: ShadowComparisonResult): boolean {
  return comparison.divergence.length >= 5 &&
         comparison.shadowConfidence >= 0.8 &&
         comparison.avgWeightDelta <= 0.05;
}
