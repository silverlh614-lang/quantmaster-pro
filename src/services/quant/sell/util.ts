/**
 * sell/util.ts — 매도 레이어 공용 순수 함수
 */

import type { ActivePosition } from '../../../types/sell';

/** 포지션의 현재 수익률 (소수점, e.g., 0.15 = +15%) */
export function calcPositionReturn(position: ActivePosition): number {
  return (position.currentPrice - position.entryPrice) / position.entryPrice;
}

/** 포지션 고점 대비 현재가 낙폭 (음수, e.g., -0.33 = 고점 대비 -33%) */
export function calcDrawdown(position: ActivePosition): number {
  if (position.highSinceEntry <= 0) return 0;
  return (position.currentPrice - position.highSinceEntry) / position.highSinceEntry;
}
