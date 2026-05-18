// @responsibility Exit orchestration facade for Live/Shadow engines.

import type { ServerShadowTrade } from '../../persistence/shadowTradeRepo.js';
import { evaluateLiveExit, type LiveExitEngineInput } from './liveExitEngine.js';
import { evaluateShadowExit } from './shadowExitEngine.js';
import type { ExitDecision } from './exitTypes.js';

export interface ExitEngineInput extends Omit<LiveExitEngineInput, 'trade'> {
  trade: ServerShadowTrade;
}

export async function evaluateExit(input: ExitEngineInput): Promise<ExitDecision> {
  if (input.trade.mode === 'LIVE') {
    return evaluateLiveExit(input);
  }
  return evaluateShadowExit({
    trade: input.trade,
    currentRegime: input.currentRegime,
  });
}
