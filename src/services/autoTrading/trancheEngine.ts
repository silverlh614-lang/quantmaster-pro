// @responsibility trancheEngine 서비스 모듈
/**
 * trancheEngine.ts — 분할매수 트랜치 플랜 자동 실행 (아이디어 11)
 *
 * - 1차: 즉시 시장가 매수
 * - 2차: 피보나치 38.2% 눌림목 대기
 * - 3차: 현재가 +3% 돌파 모멘텀 추격
 */

import type { EvaluationResult } from '../../types/quant';
import { debugLog, debugWarn } from '../../utils/debug';
import { placeKISOrder, convertSignalToOrder } from './orderExecution';

/**
 * 피보나치 38.2% 눌림목 지지선 계산
 * 고점(entryPrice)과 저점(stopLoss) 사이에서 38.2% 눌림목 위치 반환
 */
export function calculateFibSupport(entryPrice: number, stopLoss: number): number {
  return Math.round(entryPrice - (entryPrice - stopLoss) * 0.382);
}

interface ConditionalOrder {
  id: string;
  stockCode: string;
  stockName: string;
  type: 'SUPPORT' | 'BREAKOUT';  // 눌림목 vs 돌파
  triggerPrice: number;
  investAmount: number;           // 투자금액 (원)
  registeredAt: string;
  executed: boolean;
}

/** 세션 내 조건부 주문 큐 (메모리) */
const conditionalOrderQueue: ConditionalOrder[] = [];

export function getConditionalOrders(): ConditionalOrder[] {
  return conditionalOrderQueue.filter((o) => !o.executed);
}

/**
 * 현재가로 조건부 주문 트리거 확인 → 조건 충족 시 즉시 시장가 매수
 * App 레벨에서 가격 업데이트마다 호출
 */
export async function checkConditionalOrders(
  stockCode: string,
  currentPrice: number
): Promise<void> {
  const pending = conditionalOrderQueue.filter(
    (o) => o.stockCode === stockCode && !o.executed
  );

  for (const order of pending) {
    const triggered =
      (order.type === 'SUPPORT'   && currentPrice <= order.triggerPrice) ||
      (order.type === 'BREAKOUT'  && currentPrice >= order.triggerPrice);

    if (!triggered) continue;

    order.executed = true;
    const qty = Math.floor(order.investAmount / currentPrice);
    if (qty < 1) {
      debugWarn(`[트랜치] ${order.stockName} 수량 부족 (${qty}주) — 건너뜀`);
      continue;
    }

    const label = order.type === 'SUPPORT' ? '2차 눌림목' : '3차 브레이크아웃';
    debugLog(`[트랜치 ${label}] ${order.stockName} @${currentPrice.toLocaleString()}원 ${qty}주 시장가 매수`);

    await placeKISOrder({
      PDNO: stockCode.padStart(6, '0'),
      ORD_DVSN: '01',             // 시장가
      ORD_QTY: qty.toString(),
      ORD_UNPR: '0',
    }).catch((e) => console.error(`[트랜치] ${order.stockName} 주문 실패:`, e));
  }
}

/**
 * 트랜치 플랜 자동 실행
 *
 * - 1차 (tranche1.size %): 즉시 시장가 매수
 * - 2차 (tranche2.size %): 피보나치 38.2% 눌림목 대기 → checkConditionalOrders() 트리거
 * - 3차 (tranche3.size %): 현재가 +3% 돌파 모멘텀 → checkConditionalOrders() 트리거
 *
 * tranchePlan이 없으면 단일 주문으로 폴백
 */
export async function executeTranchePlan(
  signal: EvaluationResult,
  currentPrice: number,
  totalAssets: number,
  stockCode: string,
  stockName: string
): Promise<void> {
  if (!signal.tranchePlan) {
    // 트랜치 없음 → 단일 주문 (기존 방식)
    const params = convertSignalToOrder(signal, currentPrice, totalAssets, stockCode);
    await placeKISOrder(params);
    return;
  }

  const { tranche1, tranche2, tranche3 } = signal.tranchePlan;

  // 손절가 (절대가): stopLoss %가 있으면 변환, 없으면 -8% 기본
  const stopLossAbs = signal.profile?.stopLoss != null
    ? Math.round(currentPrice * (1 + signal.profile.stopLoss / 100))
    : Math.round(currentPrice * 0.92);

  // ── 1차: 즉시 매수 (tranche1.size %) ───────────────────────────────────────
  const t1Amount = totalAssets * (tranche1.size / 100);
  const t1Qty    = Math.floor(t1Amount / currentPrice);

  if (t1Qty >= 1) {
    debugLog(`[트랜치 1차] ${stockName} — ${t1Qty}주 즉시 매수 @${currentPrice.toLocaleString()}원 (${tranche1.size}% / ${t1Amount.toLocaleString()}원)`);
    await placeKISOrder({
      PDNO: stockCode.padStart(6, '0'),
      ORD_DVSN: '01',
      ORD_QTY: t1Qty.toString(),
      ORD_UNPR: '0',
    });
  }

  // ── 2차: 피보나치 38.2% 눌림목 대기 (tranche2.size %) ─────────────────────
  const fibSupport    = calculateFibSupport(currentPrice, stopLossAbs);
  const t2Amount      = totalAssets * (tranche2.size / 100);
  conditionalOrderQueue.push({
    id:           `t2_${Date.now()}_${stockCode}`,
    stockCode,
    stockName,
    type:         'SUPPORT',
    triggerPrice: fibSupport,
    investAmount: t2Amount,
    registeredAt: new Date().toISOString(),
    executed:     false,
  });
  debugLog(`[트랜치 2차] ${stockName} — Fib38.2% 눌림목 대기 @${fibSupport.toLocaleString()}원 (${tranche2.size}% / ${t2Amount.toLocaleString()}원)`);

  // ── 3차: +3% 돌파 모멘텀 추격 (tranche3.size %) ───────────────────────────
  const breakoutPrice = Math.round(currentPrice * 1.03);
  const t3Amount      = totalAssets * (tranche3.size / 100);
  conditionalOrderQueue.push({
    id:           `t3_${Date.now()}_${stockCode}`,
    stockCode,
    stockName,
    type:         'BREAKOUT',
    triggerPrice: breakoutPrice,
    investAmount: t3Amount,
    registeredAt: new Date().toISOString(),
    executed:     false,
  });
  debugLog(`[트랜치 3차] ${stockName} — +3% 브레이크아웃 대기 @${breakoutPrice.toLocaleString()}원 (${tranche3.size}% / ${t3Amount.toLocaleString()}원)`);

  debugLog(`[트랜치 플랜 완료] ${stockName} — 1차 즉시:${tranche1.size}% / 2차 Fib눌림목:${tranche2.size}% @${fibSupport.toLocaleString()} / 3차 브레이크:${tranche3.size}% @${breakoutPrice.toLocaleString()}`);
}
