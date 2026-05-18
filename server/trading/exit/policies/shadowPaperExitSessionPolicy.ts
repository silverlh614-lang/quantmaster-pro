// @responsibility Session policy for Shadow paper exits.

import type { ServerShadowTrade } from '../../../persistence/shadowTradeRepo.js';
import { resolveExitSessionGuard } from '../exitSessionGuard.js';
import type { ExitMarketSessionState } from '../exitTypes.js';

export interface ShadowPaperExitSessionPolicyInput {
  trade: ServerShadowTrade;
  marketSessionState?: string;
  isKrxTradingOpen?: boolean;
  now?: Date;
}

export type ShadowPaperExitSessionDecision =
  | {
      kind: 'ALLOW';
      marketSessionState: ExitMarketSessionState;
      reason: 'LIVE_TRADE' | 'REGULAR_SESSION' | 'SELL_ONLY_SESSION';
    }
  | {
      kind: 'DEFER';
      marketSessionState: ExitMarketSessionState;
      reason: 'SHADOW_EXIT_DEFERRED_NON_TRADING';
      guardReason?: string;
      executionImpact: 'NONE';
    };

export function resolveShadowPaperExitSessionPolicy(
  input: ShadowPaperExitSessionPolicyInput,
): ShadowPaperExitSessionDecision {
  if (input.trade.mode === 'LIVE') {
    return {
      kind: 'ALLOW',
      marketSessionState: 'REGULAR',
      reason: 'LIVE_TRADE',
    };
  }

  const guard = resolveExitSessionGuard({
    marketSessionState: input.marketSessionState,
    isKrxTradingOpen: input.isKrxTradingOpen,
    now: input.now,
  });

  if (guard.marketSessionState === 'REGULAR' || guard.marketSessionState === 'OPEN') {
    return {
      kind: 'ALLOW',
      marketSessionState: guard.marketSessionState,
      reason: 'REGULAR_SESSION',
    };
  }

  if (guard.marketSessionState === 'SELL_ONLY' && guard.isKrxTradingOpen) {
    return {
      kind: 'ALLOW',
      marketSessionState: guard.marketSessionState,
      reason: 'SELL_ONLY_SESSION',
    };
  }

  return {
    kind: 'DEFER',
    marketSessionState: guard.marketSessionState,
    reason: 'SHADOW_EXIT_DEFERRED_NON_TRADING',
    guardReason: guard.reason,
    executionImpact: 'NONE',
  };
}
