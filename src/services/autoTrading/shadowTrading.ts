/**
 * shadowTrading.ts — Shadow Trading 모드 (아이디어 5)
 *
 * 실제 주문 없이 신호를 2~4주간 축적 → 적중률/슬리피지 검증.
 * 충분한 데이터가 쌓이면 placeKISOrder()로 전환.
 */

import type { EvaluationResult, ShadowTrade } from '../../types/quant';

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

  return {
    id: `shadow_${Date.now()}_${stockCode}`,
    signalTime: new Date().toISOString(),
    stockCode,
    stockName,
    signalPrice: currentPrice,
    shadowEntryPrice,
    quantity,
    kellyFraction,
    // profile.stopLoss는 퍼센트값(-15 → -15%). 없으면 -8% 기본값 사용
    stopLoss: signal.profile?.stopLoss != null
      ? Math.round(shadowEntryPrice * (1 + signal.profile.stopLoss / 100))
      : Math.round(shadowEntryPrice * 0.92),
    // profile에 targetPrice 없음 → RRR 기반 계산
    targetPrice: Math.round(shadowEntryPrice * (1 + signal.rrr * 0.08)),
    status: 'PENDING',
  };
}

/**
 * 현재가로 ACTIVE 상태인 Shadow Trade의 결과를 갱신
 * useShadowTradeStore.updateShadowTrade()와 함께 사용
 */
export function resolveShadowTrade(
  trade: ShadowTrade,
  currentPrice: number
): Partial<ShadowTrade> {
  // PENDING → ACTIVE: 최소 1사이클(4분) 유예 후 전환
  if (trade.status === 'PENDING') {
    const ageMs = Date.now() - new Date(trade.signalTime).getTime();
    if (ageMs < 4 * 60 * 1000) return {};
    return { status: 'ACTIVE' };
  }
  if (trade.status !== 'ACTIVE') return {};

  if (currentPrice >= trade.targetPrice) {
    // 현재가로 체결 (목표가보다 높을 수 있음)
    const returnPct = parseFloat(
      (((currentPrice - trade.shadowEntryPrice) / trade.shadowEntryPrice) * 100).toFixed(2)
    );
    return { status: 'HIT_TARGET', exitPrice: currentPrice, exitTime: new Date().toISOString(), returnPct };
  }
  if (currentPrice <= trade.stopLoss) {
    // 현재가로 체결 (갭다운 시 손절가보다 낮을 수 있음)
    const returnPct = parseFloat(
      (((currentPrice - trade.shadowEntryPrice) / trade.shadowEntryPrice) * 100).toFixed(2)
    );
    return { status: 'HIT_STOP', exitPrice: currentPrice, exitTime: new Date().toISOString(), returnPct };
  }
  return {};
}
