/**
 * sell/euphoria.ts — L4 과열 탐지 (탐욕 차단)
 *
 * 4가지 과열 신호 중 3개 이상 동시 발동 시 50% 익절 신호 반환.
 * 하루 1회 호출 권장 (1일 1회 과열 체크).
 *
 * RSI_OVERBOUGHT    — RSI(14) > 80
 * VOLUME_EXPLOSION  — 거래량 20일 평균 대비 ×3.0 이상
 * RETAIL_DOMINANCE  — 개인 매수 비율 60% 초과
 * ANALYST_FRENZY    — 30일 내 증권사 목표가 상향 5건 이상
 */

import type {
  ActivePosition,
  EuphoriaData,
  SellSignal,
} from '../../../types/sell';

export function evaluateEuphoria(
  position: ActivePosition,
  data: EuphoriaData,
): SellSignal | null {
  const signals: string[] = [];

  if (data.rsi14                  > 80)  signals.push('RSI_OVERBOUGHT');
  if (data.volumeRatio            > 3.0) signals.push('VOLUME_EXPLOSION');
  if (data.retailRatio            > 0.60) signals.push('RETAIL_DOMINANCE');
  if (data.analystUpgradeCount30d >= 5)  signals.push('ANALYST_FRENZY');

  if (signals.length < 3) return null;

  return {
    action: 'EUPHORIA_SELL',
    ratio: 0.50,
    orderType: 'LIMIT',
    price: position.currentPrice,
    severity: 'HIGH',
    reason: `과열 탐지 (${signals.length}/4개): ${signals.join(', ')}. 50% 익절.`,
  };
}
