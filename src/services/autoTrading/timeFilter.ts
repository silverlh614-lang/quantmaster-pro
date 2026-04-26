// @responsibility timeFilter 서비스 모듈
/**
 * timeFilter.ts — 장중 타임 필터 + 주문 큐 (아이디어 7)
 *
 * 한국 장 최적 매수 시간대(10:00~11:30, 13:00~14:00)를 확인하고,
 * 비유효 시간대에는 주문을 큐에 보관했다가 유효 시간대에 일괄 처리합니다.
 */

import type { KISOrderParams, PendingOrder } from '../../types/quant';
import { debugLog } from '../../utils/debug';
import { placeKISOrder } from './orderExecution';

/** 한국 장 최적 매수 시간대 여부 확인 (KST 10:00~11:30, 13:00~14:00) */
export function isValidTradingWindow(): boolean {
  const now = new Date();
  const kstHour   = (now.getUTCHours() + 9) % 24;
  const kstMinute = now.getUTCMinutes();
  const kstTime   = kstHour * 100 + kstMinute;

  return (kstTime >= 1000 && kstTime <= 1130) ||
         (kstTime >= 1300 && kstTime <= 1400);
}

/** 세션 내 미실행 주문 큐 (메모리, 앱 새로고침 시 초기화) */
const pendingOrderQueue: PendingOrder[] = [];

export function getPendingOrders(): PendingOrder[] {
  return [...pendingOrderQueue];
}

export function removePendingOrder(id: string): void {
  const idx = pendingOrderQueue.findIndex((o) => o.id === id);
  if (idx !== -1) pendingOrderQueue.splice(idx, 1);
}

/**
 * 타임 필터 적용 매수 주문
 * - 유효 시간대면 즉시 실행
 * - 비유효 시간대면 큐에 보관 → { status: 'QUEUED' } 반환
 */
export async function placeKISOrderWithFilter(
  params: KISOrderParams,
  stockName: string
): Promise<{ status: 'EXECUTED' | 'QUEUED'; data?: Record<string, unknown>; reason?: string }> {
  if (!isValidTradingWindow()) {
    const pending: PendingOrder = {
      id: `pending_${Date.now()}_${params.PDNO}`,
      params,
      stockName,
      queuedAt: new Date().toISOString(),
      reason: '장중 타임 필터 - 유효 시간대(10:00~11:30, 13:00~14:00) 대기 중',
    };
    pendingOrderQueue.push(pending);
    console.warn(`[타임 필터] ${stockName} 주문 큐 등록 (${pending.reason})`);
    return { status: 'QUEUED', reason: pending.reason };
  }

  const data = await placeKISOrder(params);
  return { status: 'EXECUTED', data };
}

/**
 * 큐에 대기 중인 주문을 현재 타임 필터 상태로 일괄 처리
 * 호출 위치: 앱 포커스 복귀 or 주기적 폴링
 */
export async function flushPendingOrders(): Promise<void> {
  if (!isValidTradingWindow() || pendingOrderQueue.length === 0) return;

  const toProcess = [...pendingOrderQueue];
  pendingOrderQueue.length = 0;

  for (const order of toProcess) {
    try {
      await placeKISOrder(order.params);
      debugLog(`[큐 처리 완료] ${order.stockName}`);
    } catch (e: unknown) {
      console.error(`[큐 처리 실패] ${order.stockName}:`, e instanceof Error ? e.message : e);
      pendingOrderQueue.push(order); // 실패 시 재큐
    }
  }
}
