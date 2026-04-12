/**
 * fxRateCycleEngine.ts — 환율·금리 사이클 조정 엔진
 *
 * FX 레짐에 따른 수출/내수주 비대칭 조정 팩터와
 * 금리 사이클별 Gate 파라미터 반환을 담당.
 */

import type { FXRegime, RateCycle } from '../../types/quant';

// ─── 환율 반응 함수 (FX Impact Module) ──────────────────────────────────────

/**
 * 종목의 수출 비중(0-100)과 FX 레짐에 따라 ±3점 조정 팩터를 반환.
 * exportRatio=100: 순수 수출주 / exportRatio=0: 순수 내수주
 */
export function getFXAdjustmentFactor(fxRegime: FXRegime, exportRatio: number): number {
  if (fxRegime === 'NEUTRAL') return 0;
  // -1~+1 정규화: (수출비중 - 내수비중) / 100
  const bias = (exportRatio - (100 - exportRatio)) / 100; // -1 to +1
  const direction = fxRegime === 'DOLLAR_STRONG' ? 1 : -1;
  return parseFloat((bias * direction * 3).toFixed(2)); // -3 ~ +3
}

// ─── 금리 사이클 역가중치 시스템 (Rate Cycle Inverter) ───────────────────────

/** 금리 사이클에 따른 Gate 조건 파라미터 반환 */
export function getRateCycleAdjustment(rateCycle: RateCycle): {
  gate1IcrMinScore: number;      // 재무방어력 ICR(조건23) 최소 통과 점수
  gate2GrowthWeightBoost: number; // Gate2 성장성 조건 가중치 부스트 배율
} {
  switch (rateCycle) {
    case 'TIGHTENING':
      return {
        gate1IcrMinScore: 7,       // ICR 조건 강화: 5 → 7
        gate2GrowthWeightBoost: 1.0,
      };
    case 'EASING':
      return {
        gate1IcrMinScore: 5,       // 기본값 유지
        gate2GrowthWeightBoost: 1.2, // 성장성 조건 20% 상향
      };
    case 'PAUSE':
    default:
      return {
        gate1IcrMinScore: 5,
        gate2GrowthWeightBoost: 1.0,
      };
  }
}
