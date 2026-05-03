/**
 * @responsibility 매수 승인 큐 집계 — LIVE/Shadow 병렬 발송 + 일괄 처리
 */

import type { LiveBuyTask } from '../buyPipeline.js';
import type { ApprovalAction } from '../../telegram/buyApproval.js';

export interface ApprovalQueueState {
  liveBuyQueue: LiveBuyTask[];
  reservedSlots: number;
  probingReservedSlots: number;
  reservedTiers: Array<'PROBING' | 'OTHER'>;
  reservedIsMomentum: boolean[];
  reservedBudgets: number[];
  reservedSectorValues: Array<{ sector: string; value: number }>;
  pendingSectorValue: Map<string, number>;
  currentSectorValue: Map<string, number>;
  orderableCash: number;
  watchlistMutated: boolean;
}

export function createApprovalQueueState(orderableCash: number): ApprovalQueueState {
  return {
    liveBuyQueue: [],
    reservedSlots: 0,
    probingReservedSlots: 0,
    reservedTiers: [],
    reservedIsMomentum: [],
    reservedBudgets: [],
    reservedSectorValues: [],
    pendingSectorValue: new Map<string, number>(),
    currentSectorValue: new Map<string, number>(),
    orderableCash,
    watchlistMutated: false,
  };
}

export async function flushApprovalQueue(state: ApprovalQueueState): Promise<LiveBuyTask[]> {
  if (state.liveBuyQueue.length === 0) return [];

  const approvals = await Promise.allSettled(state.liveBuyQueue.map((t) => t.approvalPromise));
  let approved = 0, rejected = 0;
  const approvedTasks: LiveBuyTask[] = [];

  for (let i = 0; i < state.liveBuyQueue.length; i++) {
    const result = approvals[i];
    const action: ApprovalAction = result.status === 'fulfilled' ? result.value : 'SKIP';
    const task = state.liveBuyQueue[i];
    await task.execute(action);

    if (action === 'APPROVE') {
      approved++;
      approvedTasks.push(task);
    } else {
      rejected++;
      if (!state.reservedIsMomentum[i]) {
        state.reservedSlots = Math.max(0, state.reservedSlots - 1);
        if (state.reservedTiers[i] === 'PROBING') {
          state.probingReservedSlots = Math.max(0, state.probingReservedSlots - 1);
        }
        const rel = state.reservedSectorValues[i];
        if (rel) {
          const cur = state.pendingSectorValue.get(rel.sector) ?? 0;
          const next = Math.max(0, cur - rel.value);
          if (next === 0) state.pendingSectorValue.delete(rel.sector);
          else state.pendingSectorValue.set(rel.sector, next);
        }
        const refund = state.reservedBudgets[i] ?? 0;
        if (refund > 0) {
          state.orderableCash += refund;
        }
      }
    }
  }

  if (rejected > 0) {
    console.log(
      `[AutoTrade] 승인 큐 플러시 — 승인 ${approved} / 거절·스킵 ${rejected} → 예약 롤백 완료 (잔여 reservedSlots=${state.reservedSlots})`,
    );
  }

  return approvedTasks;
}