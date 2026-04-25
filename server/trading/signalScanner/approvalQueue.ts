/**
 * @responsibility 매수 승인 큐 집계 — LIVE/Shadow 병렬 발송 + 일괄 처리
 *
 * ADR-0001 (개정 2026-04-25) 의 7모듈 중 승인 큐 단계. 책임은 큐 자체의
 * 라이프사이클 관리에 한정되며, 실 KIS 주문 발송 (멱등성, channelBuySignalEmitted)
 * 은 `orderDispatch.ts` 가 담당한다.
 *
 * 본 모듈 책임:
 *   - LiveBuyTask 빌드 (createBuyTask 호출 + onApproved 콜백 주입)
 *   - liveBuyQueue / intradayLiveBuyQueue 관리
 *   - Promise.allSettled 병렬 승인 요청 플러시
 *   - APPROVE/REJECT/SKIP 분류 + 통계
 *   - reservedSlots / reservedBudgets / pendingSectorValue 롤백
 *
 * 본 모듈이 하지 않는 것:
 *   - 실 KIS POST (orderDispatch)
 *   - operation_id 멱등성 키 발급 (orderDispatch)
 *   - channelBuySignalEmitted 송출 (orderDispatch)
 *   - tranche 스케줄링 (orderDispatch)
 */

import type { ApprovalAction } from '../../telegram/buyApproval.js';

export interface ApprovalQueueFlushResult {
  approved: number;
  rejected: number;
  skipped: number;
}

export interface ApprovalQueueInput {
  /** Phase 3 에서 LiveBuyTask[] 로 교체. */
  tasks: ReadonlyArray<unknown>;
}

/**
 * 큐를 병렬로 플러시한다. 각 task 의 onApproved 는 orderDispatch 가 주입한 콜백이며,
 * 본 함수는 단지 Promise.allSettled → action 결정 → task.execute(action) 을 반복한다.
 */
export async function flushApprovalQueue(
  _input: ApprovalQueueInput,
): Promise<ApprovalQueueFlushResult> {
  throw new Error(
    'TODO: migrate from signalScanner.ts (ADR-0001 Phase 3 — approvalQueue)',
  );
}

/** ApprovalAction 재export — barrel 호환. */
export type { ApprovalAction };
