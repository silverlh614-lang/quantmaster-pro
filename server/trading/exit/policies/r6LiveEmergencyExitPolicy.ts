// @responsibility R6_DEFENSE live emergency exit policy and session deferral.

import type { ServerShadowTrade } from '../../../persistence/shadowTradeRepo.js';
import { emitExitOperationalWarn } from '../exitOperationalWarn.js';
import { resolveExitSessionGuard } from '../exitSessionGuard.js';
import { recordPendingExitIntent } from '../pendingExitIntentQueue.js';
import type { ExitDecision } from '../exitTypes.js';

export interface R6LiveEmergencyExitPolicyInput {
  trade: ServerShadowTrade;
  currentRegime: string;
  currentPrice: number;
  returnPct: number;
  marketSessionState?: string;
  isKrxTradingOpen?: boolean;
  kisOrderAllowed?: boolean;
  liveOrderAllowed?: boolean;
  now?: Date;
}

export interface R6LiveEmergencyExitPolicyDeps {
  recordPendingExitIntent?: typeof recordPendingExitIntent;
}

export function resolveR6LiveEmergencyExitPolicy(
  input: R6LiveEmergencyExitPolicyInput,
  deps: R6LiveEmergencyExitPolicyDeps = {},
): ExitDecision {
  try {
    const recordIntent = deps.recordPendingExitIntent ?? recordPendingExitIntent;
    const { trade, currentRegime } = input;
    if (currentRegime !== 'R6_DEFENSE') {
      return { kind: 'NO_EXIT', reason: 'NOT_R6_DEFENSE' };
    }
    if (trade.mode !== 'LIVE') {
      return { kind: 'NO_EXIT', reason: 'NON_LIVE_POSITION_USES_SHADOW_POLICY' };
    }
    if (trade.r6EmergencySold) {
      return { kind: 'NO_EXIT', reason: 'R6_EMERGENCY_ALREADY_SOLD' };
    }
    if (trade.quantity <= 0) {
      return { kind: 'NO_EXIT', reason: 'NO_REMAINING_QTY' };
    }

    const qty = Math.max(1, Math.floor(trade.quantity * 0.30));
    const session = resolveExitSessionGuard({
      marketSessionState: input.marketSessionState,
      isKrxTradingOpen: input.isKrxTradingOpen,
      kisOrderAllowed: input.kisOrderAllowed,
      liveOrderAllowed: input.liveOrderAllowed,
      now: input.now,
    });

    if (!session.liveSellOrderAllowed) {
      return recordIntent({
        tradeId: trade.id,
        stockCode: trade.stockCode,
        stockName: trade.stockName,
        qty,
        currentPrice: input.currentPrice,
        returnPct: input.returnPct,
        regime: currentRegime,
        reason: 'SESSION_GUARDED_R6_EMERGENCY_EXIT',
        guardReason: session.reason ?? 'SESSION_NOT_OPEN',
        marketSessionState: session.marketSessionState,
        isKrxTradingOpen: session.isKrxTradingOpen,
        kisOrderAllowed: session.kisOrderAllowed,
        liveOrderAllowed: session.liveOrderAllowed,
        createdAt: (input.now ?? new Date()).toISOString(),
      });
    }

    return {
      kind: 'LIVE_SELL_INTENT',
      reason: 'R6_LIVE_EMERGENCY_EXIT',
      qty,
    };
  } catch (error) {
    emitExitOperationalWarn({
      code: 'P0_R6_LIVE_EXIT_POLICY_FAILED',
      message: 'R6 live emergency exit policy failed',
      context: {
        tradeId: input.trade.id,
        stockCode: input.trade.stockCode,
        currentRegime: input.currentRegime,
      },
      cause: error,
    });
    return {
      kind: 'EXIT_FAILED',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
