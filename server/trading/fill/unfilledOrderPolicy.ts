/**
 * @responsibility 미체결 주문에 대해 시장 세션·리스크 모드 기반 대기·취소·재발주 액션을 결정한다.
 */

import type { FillSide } from './fillTypes.js';

export type MarketSessionState =
  | 'REGULAR'
  | 'PRE_MARKET'
  | 'AFTER_HOURS'
  | 'CLOSED'
  | 'HOLIDAY';

export type RiskModeState =
  | 'NORMAL'
  | 'SELL_ONLY'
  | 'R6_DEFENSE';

type UnfilledOrderAction =
  | 'WAIT'
  | 'REQUERY'
  | 'CANCEL'
  | 'REISSUE_MARKET'
  | 'DEFER_MONITOR';

export interface UnfilledOrderPolicyInput {
  side: FillSide;
  pollCount: number;
  maxPollCount: number;
  marketSession: MarketSessionState;
  riskMode: RiskModeState;
  retryable: boolean;
}

export interface UnfilledOrderPolicyDecision {
  action: UnfilledOrderAction;
  reason: string;
  canPlaceLiveOrder: boolean;
  executionImpact: 'LIVE_SELL_BLOCKED' | 'EXIT_MONITOR_DEGRADED' | 'NONE';
}

function isLiveTradingSession(session: MarketSessionState): boolean {
  return session === 'REGULAR';
}

export function decideUnfilledOrderPolicy(input: UnfilledOrderPolicyInput): UnfilledOrderPolicyDecision {
  if (!isLiveTradingSession(input.marketSession)) {
    return {
      action: 'DEFER_MONITOR',
      reason: `NON_TRADING_SESSION_${input.marketSession}`,
      canPlaceLiveOrder: false,
      executionImpact: input.side === 'SELL' ? 'EXIT_MONITOR_DEGRADED' : 'NONE',
    };
  }

  if (input.riskMode === 'R6_DEFENSE' || input.riskMode === 'SELL_ONLY') {
    if (input.side === 'BUY') {
      return {
        action: 'CANCEL',
        reason: `BUY_BLOCKED_BY_${input.riskMode}`,
        canPlaceLiveOrder: false,
        executionImpact: 'NONE',
      };
    }
  }

  if (input.retryable && input.pollCount < input.maxPollCount) {
    return {
      action: 'REQUERY',
      reason: 'RETRYABLE_UNFILLED_BEFORE_MAX_POLL',
      canPlaceLiveOrder: false,
      executionImpact: 'NONE',
    };
  }

  if (input.side === 'SELL') {
    return {
      action: 'REISSUE_MARKET',
      reason: 'SELL_UNFILLED_MAX_POLL_REISSUE_MARKET',
      canPlaceLiveOrder: true,
      executionImpact: 'NONE',
    };
  }

  return {
    action: 'CANCEL',
    reason: 'BUY_UNFILLED_MAX_POLL_CANCEL',
    canPlaceLiveOrder: false,
    executionImpact: 'NONE',
  };
}
