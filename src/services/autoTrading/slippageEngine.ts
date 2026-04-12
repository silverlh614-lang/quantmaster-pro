/**
 * slippageEngine.ts — 슬리피지 측정 & 보정 Kelly (아이디어 8)
 *
 * 신호가와 실제 체결가를 비교해 슬리피지를 측정하고,
 * 슬리피지를 반영한 실효 Kelly 분수를 계산합니다.
 */

import type { SlippageRecord } from '../../types/quant';

/**
 * 신호가와 실제 체결가를 비교해 SlippageRecord 생성
 * → useSlippageStore.addRecord()에 전달해 영속
 */
export function measureSlippage(
  stockCode: string,
  theoreticalPrice: number,
  executedPrice: number,
  orderType: 'MARKET' | 'LIMIT',
  volume: number
): SlippageRecord {
  const slippagePct = (executedPrice - theoreticalPrice) / theoreticalPrice;
  return {
    id: `slip_${Date.now()}_${stockCode}`,
    stockCode,
    signalTime: new Date().toISOString(),
    theoreticalPrice,
    executedPrice,
    slippagePct,
    orderType,
    volume,
  };
}

export function calculateAverageSlippage(records: SlippageRecord[]): number {
  if (records.length === 0) return 0;
  return records.reduce((sum, r) => sum + r.slippagePct, 0) / records.length;
}

/**
 * 슬리피지를 반영한 실효 Kelly 분수
 * @param winRate  과거 승률 (0~1)
 * @param rrr      Risk-Reward Ratio
 * @param avgSlippage  평균 슬리피지 (calculateAverageSlippage 반환값)
 */
export function adjustedKelly(
  winRate: number,
  rrr: number,
  avgSlippage: number
): number {
  const effectiveWinRate = winRate * (1 - Math.abs(avgSlippage));
  return Math.max(0, (effectiveWinRate * rrr - (1 - effectiveWinRate)) / rrr);
}
