// @responsibility Shadow exit evaluation with paper-only decisions.

import type { ServerShadowTrade } from '../../persistence/shadowTradeRepo.js';
import { resolveR6ShadowHoldPolicy } from './policies/r6ShadowHoldPolicy.js';
import type { ExitDecision } from './exitTypes.js';

export interface ShadowExitEngineInput {
  trade: ServerShadowTrade;
  currentRegime: string;
}

export function evaluateShadowExit(input: ShadowExitEngineInput): ExitDecision {
  if (input.currentRegime === 'R6_DEFENSE') {
    return resolveR6ShadowHoldPolicy({
      trade: input.trade,
      currentRegime: input.currentRegime,
    });
  }

  return {
    kind: 'NO_EXIT',
    reason: 'SHADOW_EXIT_EVALUATION_CONTINUES',
  };
}
