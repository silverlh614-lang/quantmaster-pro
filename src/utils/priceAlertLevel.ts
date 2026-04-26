// @responsibility 손절·익절 4단계 알림 레벨 계산 순수 함수 (ADR-0020 PR-C)

import type { PriceAlertLevel } from '../types/ui';

export interface PriceAlertInput {
  currentPrice: number;
  stopLoss: number;
  targetPrice: number;
  /** 손절선 근접 임계 (기본 3 %). currentPrice 대비 stopLoss 거리 비율. */
  cautionPctToStop?: number;
}

const DEFAULT_CAUTION_PCT = 3;

function isPositive(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * 4단계 알림 레벨 계산. 우선순위: TAKE_PROFIT > DANGER > CAUTION > NORMAL.
 *
 * - currentPrice ≥ targetPrice → TAKE_PROFIT (익절 도달)
 * - currentPrice ≤ stopLoss → DANGER (손절 도달)
 * - (currentPrice - stopLoss) / currentPrice × 100 ≤ cautionPctToStop → CAUTION
 * - 그 외 → NORMAL
 *
 * 입력 가드:
 * - currentPrice ≤ 0 또는 NaN → 'NORMAL' (계산 불가)
 * - stopLoss/targetPrice 가 양수가 아니면 해당 분기 skip
 */
export function computePriceAlertLevel(input: PriceAlertInput): PriceAlertLevel {
  const { currentPrice, stopLoss, targetPrice } = input;
  if (!isPositive(currentPrice)) return 'NORMAL';

  // 1순위: 익절 도달
  if (isPositive(targetPrice) && currentPrice >= targetPrice) {
    return 'TAKE_PROFIT';
  }

  // 2순위: 손절 도달
  if (isPositive(stopLoss) && currentPrice <= stopLoss) {
    return 'DANGER';
  }

  // 3순위: 손절선 근접
  if (isPositive(stopLoss)) {
    const cautionPct = input.cautionPctToStop ?? DEFAULT_CAUTION_PCT;
    const distancePct = ((currentPrice - stopLoss) / currentPrice) * 100;
    if (distancePct <= cautionPct) {
      return 'CAUTION';
    }
  }

  return 'NORMAL';
}

/** 알림 레벨이 NORMAL 이 아닌 경우 (실제 알림 발송 대상). */
export function isActionableAlert(level: PriceAlertLevel): boolean {
  return level !== 'NORMAL';
}
