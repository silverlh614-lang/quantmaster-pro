// @responsibility quant trailing 엔진 모듈
/**
 * sell/trailing.ts — L3 트레일링 스톱
 *
 * 마지막 LIMIT 익절 완료 후 남은 잔여 수량에 대해 고점 추적 스톱 운영.
 * position.trailingHighWaterMark는 호출자가 updateTrailingHighWaterMark()로 매 사이클 갱신.
 */

import type { ActivePosition, SellSignal } from '../../../types/sell';
import type { RegimeLevel } from '../../../types/core';
import { PROFIT_TARGETS } from './partialProfit';

export function checkTrailingStop(position: ActivePosition): SellSignal | null {
  if (!position.trailingEnabled) return null;

  const trailDrop =
    (position.currentPrice - position.trailingHighWaterMark) /
    position.trailingHighWaterMark;

  if (trailDrop <= -position.trailPct) {
    return {
      action: 'TRAILING_STOP',
      ratio: position.trailingRemainingRatio,
      orderType: 'LIMIT',
      price: position.currentPrice,
      reason: `트레일링 발동: 고점(${position.trailingHighWaterMark.toLocaleString()}원) 대비 ${(trailDrop * 100).toFixed(1)}%`,
    };
  }

  return null;
}

/** 신고가 갱신 시 트레일링 고점 업데이트. */
export function updateTrailingHighWaterMark(position: ActivePosition): number {
  return Math.max(position.trailingHighWaterMark, position.currentPrice);
}

/**
 * PROFIT_TARGETS 중 TRAILING 타입 항목을 찾아 trailPct와 trailingRemainingRatio를 반환.
 * @returns 트레일링 설정 (없으면 null)
 */
export function resolveTrailingConfig(
  regime: RegimeLevel,
): { trailPct: number; ratio: number } | null {
  const trailing = PROFIT_TARGETS[regime].find(t => t.type === 'TRAILING');
  if (!trailing || trailing.trailPct === undefined) return null;
  return { trailPct: trailing.trailPct, ratio: trailing.ratio };
}
