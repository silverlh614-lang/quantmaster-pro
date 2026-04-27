// @responsibility quant partialProfit 엔진 모듈
/**
 * sell/partialProfit.ts — L3 분할 익절
 *
 * 레짐별 분할 익절 타겟 맵 + 타겟 도달 검사.
 * REGIME_CONFIGS.takeProfitPartial과 일관성 유지, 배열 형식으로 재정의.
 */

import type {
  ActivePosition,
  SellSignal,
  TakeProfitTarget,
} from '../../../types/sell';
import type { RegimeLevel } from '../../../types/core';
import { calcPositionReturn } from './util';

/**
 * 레짐별 분할 익절 타겟 배열.
 * trigger=null → 트레일링 스톱 트랜치 (partialProfit 검사 시 skip).
 */
export const PROFIT_TARGETS: Record<RegimeLevel, TakeProfitTarget[]> = {
  R1_TURBO: [
    { trigger: 0.15, ratio: 0.30, type: 'LIMIT' },
    { trigger: 0.25, ratio: 0.30, type: 'LIMIT' },
    { trigger: null, ratio: 0.40, type: 'TRAILING', trailPct: 0.10 },
  ],
  R2_BULL: [
    { trigger: 0.12, ratio: 0.30, type: 'LIMIT' },
    { trigger: 0.20, ratio: 0.30, type: 'LIMIT' },
    { trigger: null, ratio: 0.40, type: 'TRAILING', trailPct: 0.08 },
  ],
  R3_EARLY: [
    { trigger: 0.10, ratio: 0.25, type: 'LIMIT' },
    { trigger: 0.18, ratio: 0.35, type: 'LIMIT' },
    { trigger: null, ratio: 0.40, type: 'TRAILING', trailPct: 0.07 },
  ],
  R4_NEUTRAL: [
    { trigger: 0.08, ratio: 0.40, type: 'LIMIT' },
    { trigger: 0.12, ratio: 0.40, type: 'LIMIT' },
    { trigger: 0.18, ratio: 0.20, type: 'LIMIT' },
  ],
  R5_CAUTION: [
    { trigger: 0.06, ratio: 0.50, type: 'LIMIT' },
    { trigger: 0.10, ratio: 0.50, type: 'LIMIT' },
  ],
  R6_DEFENSE: [],
};

/**
 * 현재 수익률이 미달성 익절 타겟에 도달했는지 확인.
 * 이미 실현된 타겟(position.takenProfit)은 건너뜀.
 */
export function checkProfitTargets(
  position: ActivePosition,
  regime: RegimeLevel,
): SellSignal[] {
  const signals: SellSignal[] = [];
  const targets = PROFIT_TARGETS[regime];
  const currentReturn = calcPositionReturn(position);

  for (const target of targets) {
    if (target.type !== 'LIMIT' || target.trigger === null) continue;
    if (position.takenProfit.includes(target.trigger)) continue;
    if (currentReturn < target.trigger) continue;

    signals.push({
      action: 'PROFIT_TAKE',
      ratio: target.ratio,
      orderType: 'LIMIT',
      price: position.currentPrice,
      reason: `익절 달성: +${(target.trigger * 100).toFixed(0)}%, ${(target.ratio * 100).toFixed(0)}% 매도`,
    });
  }

  return signals;
}
