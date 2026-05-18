// @responsibility Persist live exit intents that cannot be submitted outside regular trading.

import { appendPendingEmergencyExit } from '../../persistence/pendingEmergencyExitQueueRepo.js';
import type { PendingEmergencyExit } from '../../persistence/pendingEmergencyExitQueueRepo.js';
import { emitExitOperationalWarn } from './exitOperationalWarn.js';
import type { ExitDecision, ExitMarketSessionState } from './exitTypes.js';

export interface PendingExitIntentInput {
  tradeId: string;
  stockCode: string;
  stockName: string;
  qty: number;
  currentPrice: number;
  returnPct: number;
  regime: string;
  reason: string;
  guardReason: string;
  marketSessionState: ExitMarketSessionState | string;
  isKrxTradingOpen: boolean;
  kisOrderAllowed: boolean;
  liveOrderAllowed: boolean;
  createdAt?: string;
}

export interface PendingExitIntentQueueDeps {
  appendPendingEmergencyExit?: typeof appendPendingEmergencyExit;
}

export function recordPendingExitIntent(
  input: PendingExitIntentInput,
  deps: PendingExitIntentQueueDeps = {},
): ExitDecision {
  const appendIntent = deps.appendPendingEmergencyExit ?? appendPendingEmergencyExit;

  try {
    const row: PendingEmergencyExit = appendIntent({
      tradeId: input.tradeId,
      stockCode: input.stockCode,
      stockName: input.stockName,
      qty: input.qty,
      currentPrice: input.currentPrice,
      returnPct: input.returnPct,
      regime: input.regime,
      reason: 'SESSION_GUARDED_R6_EMERGENCY_EXIT',
      guardReason: input.guardReason,
      marketSessionState: String(input.marketSessionState),
      isKrxTradingOpen: input.isKrxTradingOpen,
      kisOrderAllowed: input.kisOrderAllowed,
      liveOrderAllowed: input.liveOrderAllowed,
      createdAt: input.createdAt,
    });

    emitExitOperationalWarn({
      code: 'P0_LIVE_EXIT_DEFERRED_NON_TRADING',
      message: 'Live exit intent deferred outside regular trading session',
      context: {
        pendingIntentId: row.id,
        tradeId: input.tradeId,
        stockCode: input.stockCode,
        qty: input.qty,
        reason: input.reason,
        marketSessionState: input.marketSessionState,
      },
    });

    return {
      kind: 'LIVE_SELL_DEFERRED',
      reason: input.reason,
      pendingIntentId: row.id,
    };
  } catch (error) {
    emitExitOperationalWarn({
      code: 'P0_PENDING_EXIT_INTENT_FAILED',
      message: 'Failed to persist pending live exit intent',
      context: {
        tradeId: input.tradeId,
        stockCode: input.stockCode,
        qty: input.qty,
        reason: input.reason,
      },
      cause: error,
    });
    return {
      kind: 'EXIT_FAILED',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
