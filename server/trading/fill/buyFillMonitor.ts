/**
 * @responsibility 매수 체결 조회 결과로부터 체결·부분·만료·거부 모니터 액션을 결정한다.
 */

import type { FillQueryResult, NormalizedBuyFillState } from './fillTypes.js';

interface BuyFillMonitorOrder {
  ordNo: string;
  symbol: string;
  orderQty: number;
  pollCount: number;
}

export type BuyFillMonitorAction =
  | {
      action: 'MARK_FILLED';
      state: 'FILLED';
      filledQty: number;
      avgPrice: number;
      terminal: true;
    }
  | {
      action: 'MARK_PARTIAL';
      state: 'PARTIALLY_FILLED';
      filledQty: number;
      avgPrice?: number;
      terminal: false;
    }
  | {
      action: 'WAIT_FOR_FILL';
      state: 'UNFILLED';
      reason: string;
      retryable: boolean;
      terminal: false;
    }
  | {
      action: 'MARK_EXPIRED';
      state: 'UNFILLED';
      reason: string;
      terminal: true;
    }
  | {
      action: 'MARK_REJECTED';
      state: 'REJECTED';
      reason: string;
      terminal: true;
    };

export interface BuyFillMonitorDecisionInput {
  order: BuyFillMonitorOrder;
  queryResult: FillQueryResult;
  maxPollCount: number;
}

export function normalizeBuyFillState(result: FillQueryResult): NormalizedBuyFillState {
  switch (result.kind) {
    case 'FILLED':
      return 'FILLED';
    case 'PARTIALLY_FILLED':
      return 'PARTIALLY_FILLED';
    case 'REJECTED':
      return 'REJECTED';
    case 'UNFILLED':
    case 'EMPTY_RESPONSE':
    case 'QUERY_FAILED':
      return 'UNFILLED';
  }
}

export function decideBuyFillMonitorAction(input: BuyFillMonitorDecisionInput): BuyFillMonitorAction {
  const { order, queryResult, maxPollCount } = input;

  switch (queryResult.kind) {
    case 'FILLED':
      return {
        action: 'MARK_FILLED',
        state: 'FILLED',
        filledQty: queryResult.filledQty,
        avgPrice: queryResult.avgPrice,
        terminal: true,
      };
    case 'PARTIALLY_FILLED':
      return {
        action: 'MARK_PARTIAL',
        state: 'PARTIALLY_FILLED',
        filledQty: queryResult.filledQty,
        ...(queryResult.avgPrice !== undefined ? { avgPrice: queryResult.avgPrice } : {}),
        terminal: false,
      };
    case 'REJECTED':
      return {
        action: 'MARK_REJECTED',
        state: 'REJECTED',
        reason: queryResult.reason,
        terminal: true,
      };
    case 'UNFILLED':
      if (!queryResult.retryable || order.pollCount >= maxPollCount) {
        return {
          action: 'MARK_EXPIRED',
          state: 'UNFILLED',
          reason: queryResult.reason,
          terminal: true,
        };
      }
      return {
        action: 'WAIT_FOR_FILL',
        state: 'UNFILLED',
        reason: queryResult.reason,
        retryable: true,
        terminal: false,
      };
    case 'EMPTY_RESPONSE':
      return {
        action: 'WAIT_FOR_FILL',
        state: 'UNFILLED',
        reason: 'EMPTY_RESPONSE',
        retryable: queryResult.retryable,
        terminal: false,
      };
    case 'QUERY_FAILED':
      if (!queryResult.retryable && order.pollCount >= maxPollCount) {
        return {
          action: 'MARK_EXPIRED',
          state: 'UNFILLED',
          reason: queryResult.reason,
          terminal: true,
        };
      }
      return {
        action: 'WAIT_FOR_FILL',
        state: 'UNFILLED',
        reason: queryResult.reason,
        retryable: queryResult.retryable,
        terminal: false,
      };
  }
}
