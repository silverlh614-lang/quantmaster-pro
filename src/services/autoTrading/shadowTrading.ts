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
    // ADR-0028: stale shadowEntryPrice 시 0 fallback — Shadow trade 영속 학습 보호.
    const returnPct = parseFloat(
      (safePctChange(currentPrice, trade.shadowEntryPrice, {
        label: `shadowTrading:${trade.stockCode}`,
      }) ?? 0).toFixed(2)
    );
    return { status: 'HIT_TARGET', exitPrice: currentPrice, exitTime: new Date().toISOString(), returnPct };
  }
  if (currentPrice <= trade.stopLoss) {
    // 현재가로 체결 (갭다운 시 손절가보다 낮을 수 있음)
    // ADR-0028: stale shadowEntryPrice 시 0 fallback — Shadow trade 영속 학습 보호.
    const returnPct = parseFloat(
      (safePctChange(currentPrice, trade.shadowEntryPrice, {
        label: `shadowTrading:${trade.stockCode}`,
      }) ?? 0).toFixed(2)
    );
    return { status: 'HIT_STOP', exitPrice: currentPrice, exitTime: new Date().toISOString(), returnPct };
  }
  return {};
}
