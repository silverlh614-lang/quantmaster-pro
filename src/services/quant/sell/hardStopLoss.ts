/**
 * sell/hardStopLoss.ts — L1 기계적 손절 (최우선, 인간 개입 금지)
 *
 * 발동 시 다른 레이어는 평가되지 않는다 (shortCircuit).
 */

import type { ActivePosition, SellSignal } from '../../../types/sell';
import type { RegimeLevel } from '../../../types/core';
import { REGIME_CONFIGS } from '../regimeEngine';
import { calcPositionReturn } from './util';

/**
 * 현재 수익률이 레짐·프로파일별 손절 기준에 도달했는지 확인.
 *
 * 반환값:
 *   HARD_STOP        — 전량 즉시 시장가 매도
 *   REVALIDATE_GATE1 — -7% 경보, Gate 1 재검증 요청 (ratio=0, 매도 아님)
 *   null             — 이상 없음
 *
 * R6 레짐: 블랙스완 → 기존 포지션 30% 즉시 청산 (REGIME_CONFIGS.emergencyExit)
 */
export function checkHardStopLoss(
  position: ActivePosition,
  regime: RegimeLevel,
): SellSignal | null {
  const currentReturn = calcPositionReturn(position);

  // R6 비상 청산 (30% 즉시 시장가)
  if (regime === 'R6_DEFENSE') {
    return {
      action: 'HARD_STOP',
      ratio: 0.30,
      orderType: 'MARKET',
      severity: 'CRITICAL',
      reason: `R6 DEFENSE 비상 청산 (30%). 현재 수익률 ${(currentReturn * 100).toFixed(1)}%`,
    };
  }

  // 프로파일별 손절 비율 조회
  const profileKey = `profile${position.profile}` as keyof typeof REGIME_CONFIGS[typeof regime]['stopLoss'];
  const stopRate = REGIME_CONFIGS[regime].stopLoss[profileKey];

  if (currentReturn <= stopRate) {
    return {
      action: 'HARD_STOP',
      ratio: 1.0,
      orderType: 'MARKET',
      severity: 'CRITICAL',
      reason: `손절 발동: ${(currentReturn * 100).toFixed(1)}% / 기준: ${(stopRate * 100).toFixed(1)}%`,
    };
  }

  // -7% 경보 → Gate 1 재검증 요청 (이미 재검증했으면 skip)
  if (currentReturn <= -0.07 && !position.revalidated) {
    return {
      action: 'REVALIDATE_GATE1',
      ratio: 0,
      orderType: 'MARKET',
      reason: `-7% 도달. Gate 1 재검증 실행 필요.`,
    };
  }

  return null;
}
