/**
 * @responsibility 매도 체결 조회 결과로부터 체결·재발주·이연·거부 모니터 액션을 결정한다.
 */

import type { FillQueryResult, NormalizedSellFillState } from './fillTypes.js';
import { emitOperationalWarn } from './fillOperationalWarn.js';
import {
  decideSellReissue,
  type SellReissueDecision,
  type SellReissueMode,
} from './sellReissuePolicy.js';
import {
  decideUnfilledOrderPolicy,
  type MarketSessionState,
  type RiskModeState,
} from './unfilledOrderPolicy.js';

type SellExecutionImpact = SellReissueDecision['executionImpact'];

interface SellFillMonitorOrder {
  ordNo: string;
  symbol: string;
  orderQty: number;
  pollCount: number;
  mode: SellReissueMode;
  reason: string;
}

export type SellFillMonitorAction =
  | {
      action: 'MARK_FILLED';
      state: 'SELL_FILLED';
      filledQty: number;
      avgPrice: number;
      terminal: true;
    }
  | {
      action: 'MARK_PARTIAL';
      state: 'PARTIALLY_FILLED';
      filledQty: number;
      remainingQty: number;
      avgPrice?: number;
      terminal: false;
    }
  | {
      action: 'WAIT_FOR_FILL';
      state: 'UNFILLED';
      reason: string;
      retryable: boolean;
      executionImpact: SellExecutionImpact;
      terminal: false;
    }
  | {
      action: 'REISSUE_MARKET';
      state: 'UNFILLED';
      remainingQty: number;
      dedupKey: string;
      executionImpact: SellExecutionImpact;
      terminal: false;
    }
  | {
      action: 'DEFER_MONITOR';
      state: 'UNFILLED';
      reason: string;
      executionImpact: SellExecutionImpact;
      terminal: false;
    }
  | {
      action: 'DUPLICATE_REISSUE_BLOCKED';
      state: 'UNFILLED';
      dedupKey: string;
      executionImpact: SellExecutionImpact;
      terminal: false;
    }
  | {
      action: 'MARK_REJECTED';
      state: 'REJECTED';
      reason: string;
      executionImpact: SellExecutionImpact;
      terminal: true;
    }
  | {
      action: 'MONITOR_DEGRADED';
      state: 'UNFILLED';
      reason: string;
      retryable: boolean;
      executionImpact: SellExecutionImpact;
      terminal: false;
    };

export interface SellFillMonitorDecisionInput {
  order: SellFillMonitorOrder;
  queryResult: FillQueryResult;
  maxPollCount: number;
  marketSession: MarketSessionState;
  riskMode: RiskModeState;
  marketOpen: boolean;
  liveSellAllowed: boolean;
  now?: Date;
}

export function normalizeSellFillState(result: FillQueryResult): NormalizedSellFillState {
  switch (result.kind) {
    case 'FILLED':
      return 'SELL_FILLED';
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

function mapReissueDecision(
  decision: SellReissueDecision,
  remainingQty: number,
): Extract<
  SellFillMonitorAction,
  { action: 'REISSUE_MARKET' | 'DEFER_MONITOR' | 'DUPLICATE_REISSUE_BLOCKED' | 'MARK_REJECTED' }
> {
  switch (decision.kind) {
    case 'ALLOW_REISSUE':
      return {
        action: 'REISSUE_MARKET',
        state: 'UNFILLED',
        remainingQty,
        dedupKey: decision.dedupKey,
        executionImpact: decision.executionImpact,
        terminal: false,
      };
    case 'DUPLICATE_BLOCKED':
      return {
        action: 'DUPLICATE_REISSUE_BLOCKED',
        state: 'UNFILLED',
        dedupKey: decision.dedupKey,
        executionImpact: decision.executionImpact,
        terminal: false,
      };
    case 'DEFERRED_MONITOR':
      return {
        action: 'DEFER_MONITOR',
        state: 'UNFILLED',
        reason: decision.reason,
        executionImpact: decision.executionImpact,
        terminal: false,
      };
    case 'REJECTED':
      return {
        action: 'MARK_REJECTED',
        state: 'REJECTED',
        reason: decision.reason,
        executionImpact: decision.executionImpact,
        terminal: true,
      };
  }
}

function decideReissue(input: SellFillMonitorDecisionInput, remainingQty: number): SellFillMonitorAction {
  const decision = decideSellReissue({
    mode: input.order.mode,
    symbol: input.order.symbol,
    originalOrdNo: input.order.ordNo,
    reason: input.order.reason,
    marketOpen: input.marketOpen,
    liveSellAllowed: input.liveSellAllowed,
    remainingQty,
    ...(input.now ? { now: input.now } : {}),
  });
  return mapReissueDecision(decision, remainingQty);
}

export function decideSellFillMonitorAction(input: SellFillMonitorDecisionInput): SellFillMonitorAction {
  const { order, queryResult, maxPollCount } = input;

  switch (queryResult.kind) {
    case 'FILLED':
      return {
        action: 'MARK_FILLED',
        state: 'SELL_FILLED',
        filledQty: queryResult.filledQty,
        avgPrice: queryResult.avgPrice,
        terminal: true,
      };
    case 'PARTIALLY_FILLED':
      if (order.pollCount >= maxPollCount) {
        return decideReissue(input, queryResult.remainingQty);
      }
      return {
        action: 'MARK_PARTIAL',
        state: 'PARTIALLY_FILLED',
        filledQty: queryResult.filledQty,
        remainingQty: queryResult.remainingQty,
        ...(queryResult.avgPrice !== undefined ? { avgPrice: queryResult.avgPrice } : {}),
        terminal: false,
      };
    case 'REJECTED':
      return {
        action: 'MARK_REJECTED',
        state: 'REJECTED',
        reason: queryResult.reason,
        executionImpact: 'LIVE_SELL_BLOCKED',
        terminal: true,
      };
    case 'QUERY_FAILED':
      emitOperationalWarn({
        code: 'P0_SELL_FILL_MONITOR_DEGRADED',
        message: 'Sell fill monitor query failed',
        context: {
          symbol: order.symbol,
          ordNo: order.ordNo,
          reason: queryResult.reason,
          retryable: queryResult.retryable,
          executionImpact: 'EXIT_MONITOR_DEGRADED',
        },
        cause: queryResult.raw,
      });
      return {
        action: 'MONITOR_DEGRADED',
        state: 'UNFILLED',
        reason: queryResult.reason,
        retryable: queryResult.retryable,
        executionImpact: 'EXIT_MONITOR_DEGRADED',
        terminal: false,
      };
    case 'EMPTY_RESPONSE':
    case 'UNFILLED': {
      const reason = queryResult.kind === 'EMPTY_RESPONSE' ? 'EMPTY_RESPONSE' : queryResult.reason;
      const retryable = queryResult.kind === 'EMPTY_RESPONSE' ? queryResult.retryable : queryResult.retryable;
      const unfilledDecision = decideUnfilledOrderPolicy({
        side: 'SELL',
        pollCount: order.pollCount,
        maxPollCount,
        retryable,
        marketSession: input.marketSession,
        riskMode: input.riskMode,
      });

      if (unfilledDecision.action === 'REISSUE_MARKET') {
        return decideReissue(input, order.orderQty);
      }

      if (unfilledDecision.action === 'DEFER_MONITOR') {
        return {
          action: 'DEFER_MONITOR',
          state: 'UNFILLED',
          reason: unfilledDecision.reason,
          executionImpact: unfilledDecision.executionImpact,
          terminal: false,
        };
      }

      return {
        action: 'WAIT_FOR_FILL',
        state: 'UNFILLED',
        reason: unfilledDecision.reason,
        retryable,
        executionImpact: 'NONE',
        terminal: false,
      };
    }
  }
}
