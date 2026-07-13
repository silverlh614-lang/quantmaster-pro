// @responsibility shadowTrading 서비스 모듈
/**
 * shadowTrading.ts — Shadow Trading 모드 (아이디어 5)
 *
 * 실제 주문 없이 신호를 2~4주간 축적 → 적중률/슬리피지 검증.
 * 충분한 데이터가 쌓이면 placeKISOrder()로 전환.
 */

import type { EvaluationResult, ShadowTrade } from '../../types/quant';
import { safePctChange } from '../../utils/safePctChange';

const SLIPPAGE = 0.003; // 0.3% 슬리피지 가정

/**
 * 실제 주문 없이 Shadow Trade 기록 생성
 *
 * 2~4주간 신호를 축적 → STRONG_BUY 적중률/슬리피지를 데이터로 검증.
 * 충분한 데이터가 쌓이면 placeKISOrder()로 전환.
 */
export function buildShadowTrade(
  signal: EvaluationResult,
  stockCode: string,
  stockName: string,
  currentPrice: number,
  totalAssets: number
): ShadowTrade {
  const kellyFraction = signal.positionSize / 100;
  const shadowEntryPrice = Math.round(currentPrice * (1 + SLIPPAGE));
  const quantity = Math.floor((totalAssets * kellyFraction) / shadowEntryPrice);

  // profile.stopLoss는 퍼센트값(-15 → -15%). 없으면 -8% 기본값 사용
  const stopLossPct = signal.profile?.stopLoss != null
    ? signal.profile.stopLoss / 100
    : -0.08;
  const stopLoss = Math.round(shadowEntryPrice * (1 + stopLossPct));
  // RRR 기반 목표가: 실제 손절폭 × RRR 만큼 수익 목표 설정
  const riskPct = Math.abs(stopLossPct);
  const targetPrice = Math.round(shadowEntryPrice * (1 + signal.rrr * riskPct));

  return {
    id: `shadow_${Date.now()}_${stockCode}`,
    signalTime: new Date().toISOString(),
    stockCode,
    stockName,
    signalPrice: currentPrice,
    shadowEntryPrice,
    quantity,
    kellyFraction,
    stopLoss,
    targetPrice,
    status: 'PENDING',
  };
}
