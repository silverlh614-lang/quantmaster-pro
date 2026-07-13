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
