// @responsibility Gate0Result + bearRegimeResult → 6단계 RegimeLevel SSOT 매핑 (ADR-0028)

import type { RegimeLevel, Gate0Result } from '../types/core';
import type { BearRegimeResult } from '../types/quant';

type Gate0Subset = Pick<Gate0Result, 'tradeRegime' | 'macroHealthScore'>;
type BearRegimeSubset = Pick<BearRegimeResult, 'regime'>;

/**
 * 클라이언트 6단계 RegimeLevel 매핑 SSOT.
 *
 * 우선순위 (위에서 아래로):
 *   1. bearRegime='BEAR'        → R6_DEFENSE
 *   2. bearRegime='TRANSITION'  → R5_CAUTION
 *   3. gate0.tradeRegime='DEFENSE' → R6_DEFENSE
 *   4. gate0.tradeRegime='BULL_AGGRESSIVE' → R1_TURBO
 *   5. gate0.tradeRegime='BULL_NORMAL':
 *        MHS ≥ 60 → R2_BULL
 *        MHS < 60 → R3_EARLY (선행 신호 구간)
 *   6. gate0.tradeRegime='NEUTRAL' → R4_NEUTRAL
 *   7. VKOSPI ≥ 30 → R5_CAUTION
 *   8. VKOSPI ≥ 25 → R4_NEUTRAL
 *   9. 기본값 → R4_NEUTRAL
 */
export function deriveRegimeLevel(
  gate0?: Gate0Subset | null,
  bearRegime?: BearRegimeSubset | null,
  vkospi?: number,
): RegimeLevel {
  if (bearRegime?.regime === 'BEAR') return 'R6_DEFENSE';
  if (bearRegime?.regime === 'TRANSITION') return 'R5_CAUTION';

  if (gate0) {
    const { tradeRegime, macroHealthScore } = gate0;
    if (tradeRegime === 'DEFENSE') return 'R6_DEFENSE';
    if (tradeRegime === 'BULL_AGGRESSIVE') return 'R1_TURBO';
    if (tradeRegime === 'BULL_NORMAL') {
      return macroHealthScore >= 60 ? 'R2_BULL' : 'R3_EARLY';
    }
    if (tradeRegime === 'NEUTRAL') return 'R4_NEUTRAL';
  }

  if (typeof vkospi === 'number' && Number.isFinite(vkospi)) {
    if (vkospi >= 30) return 'R5_CAUTION';
  }

  return 'R4_NEUTRAL';
}
