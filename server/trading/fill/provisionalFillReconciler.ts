/**
 * @responsibility 잠정 체결을 조회 결과와 대조해 확정·롤백 상태로 정합화하는 정산기를 제공한다.
 */

import type { PositionFill, ServerShadowTrade } from '../../persistence/shadowTradeRepo.js';
import { emitOperationalWarn } from './fillOperationalWarn.js';
import type { FillQueryResult } from './fillTypes.js';

export type ProvisionalFillReconcileOutcome =
  | 'CONFIRMED'
  | 'PARTIAL_CONFIRMED'
  | 'ROLLBACK_REQUIRED'
  | 'PENDING'
  | 'FAILED';

export interface ProvisionalFillReconcileInput {
  trade: ServerShadowTrade;
  ordNo: string;
  queryResult: FillQueryResult;
  now?: Date;
}

export interface ProvisionalFillReconcileResult {
  outcome: ProvisionalFillReconcileOutcome;
  reason: string;
  fill?: PositionFill;
}

function findProvisionalFill(trade: ServerShadowTrade, ordNo: string): PositionFill | null {
  return (trade.fills ?? []).find((fill) => fill.ordNo === ordNo && fill.status === 'PROVISIONAL') ?? null;
}

export function reconcileProvisionalFill(
  input: ProvisionalFillReconcileInput,
): ProvisionalFillReconcileResult {
  const fill = findProvisionalFill(input.trade, input.ordNo);
  if (!fill) {
    return {
      outcome: 'PENDING',
      reason: 'NO_PROVISIONAL_FILL_FOUND',
    };
  }

  try {
    if (input.queryResult.kind === 'FILLED') {
      fill.qty = input.queryResult.filledQty;
      fill.price = input.queryResult.avgPrice || fill.price;
      fill.status = 'CONFIRMED';
      fill.confirmedAt = (input.now ?? new Date()).toISOString();
      return { outcome: 'CONFIRMED', reason: 'KIS_FILL_CONFIRMED', fill };
    }

    if (input.queryResult.kind === 'PARTIALLY_FILLED') {
      fill.qty = input.queryResult.filledQty;
      if (input.queryResult.avgPrice && input.queryResult.avgPrice > 0) {
        fill.price = input.queryResult.avgPrice;
      }
      fill.status = 'CONFIRMED';
      fill.confirmedAt = (input.now ?? new Date()).toISOString();
      return { outcome: 'PARTIAL_CONFIRMED', reason: 'KIS_PARTIAL_FILL_CONFIRMED', fill };
    }

    if (input.queryResult.kind === 'UNFILLED' || input.queryResult.kind === 'EMPTY_RESPONSE') {
      if (input.queryResult.retryable) {
        return { outcome: 'PENDING', reason: `${input.queryResult.kind}_RETRYABLE`, fill };
      }
      fill.status = 'REVERTED';
      fill.revertedAt = (input.now ?? new Date()).toISOString();
      fill.revertReason = input.queryResult.kind;
      return { outcome: 'ROLLBACK_REQUIRED', reason: `${input.queryResult.kind}_NOT_RETRYABLE`, fill };
    }

    fill.status = 'REVERTED';
    fill.revertedAt = (input.now ?? new Date()).toISOString();
    fill.revertReason = input.queryResult.kind;
    return { outcome: 'ROLLBACK_REQUIRED', reason: input.queryResult.kind, fill };
  } catch (error) {
    emitOperationalWarn({
      code: 'P0_PROVISIONAL_FILL_RECONCILE_FAILED',
      message: 'Provisional fill reconciliation failed',
      context: {
        tradeId: input.trade.id,
        stockCode: input.trade.stockCode,
        ordNo: input.ordNo,
        queryKind: input.queryResult.kind,
      },
      cause: error,
    });
    return {
      outcome: 'FAILED',
      reason: error instanceof Error ? error.message : String(error),
      fill,
    };
  }
}
