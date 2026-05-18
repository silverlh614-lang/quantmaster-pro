// @responsibility R6_DEFENSE policy for Shadow positions: hold, keep learning, never force-exit.

import type { ServerShadowTrade } from '../../../persistence/shadowTradeRepo.js';
import { emitExitOperationalWarn } from '../exitOperationalWarn.js';
import type { ExitDecision } from '../exitTypes.js';

export interface R6ShadowHoldPolicyInput {
  trade: ServerShadowTrade;
  currentRegime: string;
  reason?: string;
}

export function resolveR6ShadowHoldPolicy(input: R6ShadowHoldPolicyInput): ExitDecision {
  if (input.currentRegime !== 'R6_DEFENSE') {
    return { kind: 'NO_EXIT', reason: 'NOT_R6_DEFENSE' };
  }

  if (input.trade.mode === 'LIVE') {
    return { kind: 'NO_EXIT', reason: 'LIVE_POSITION_USES_R6_LIVE_POLICY' };
  }

  const candidate = input.trade as ServerShadowTrade & {
    shadowDecision?: string;
    postOutcome?: string;
    learningTag?: string;
    liveOrderSent?: boolean;
    executionImpact?: string;
  };

  candidate.shadowDecision = 'HOLD_R6_DEFENSE';
  candidate.postOutcome = 'R6_SHADOW_HOLD';
  candidate.learningTag = candidate.learningTag ?? 'R6_SHADOW_HOLD';
  candidate.liveOrderSent = false;
  candidate.executionImpact = 'NONE';

  emitExitOperationalWarn({
    code: 'P0_R6_SHADOW_FORCE_EXIT_BLOCKED',
    message: 'R6 Shadow force-exit blocked; Shadow learning continues',
    context: {
      tradeId: input.trade.id,
      stockCode: input.trade.stockCode,
      mode: input.trade.mode ?? 'SHADOW',
      executionImpact: 'NONE',
      reason: input.reason ?? 'SHADOW_EXCLUDED_FROM_R6_FORCED_EXIT',
    },
  });

  return {
    kind: 'SHADOW_HOLD_R6_DEFENSE',
    reason: input.reason ?? 'SHADOW_EXCLUDED_FROM_R6_FORCED_EXIT',
    executionImpact: 'NONE',
  };
}
