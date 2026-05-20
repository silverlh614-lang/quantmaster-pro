// @responsibility Normal supply preview engine mode resolver.

import type { NormalSupplyPreviewEngineMode } from './types.js';

export function deriveNormalSupplyPreviewEngineMode(input: {
  sellOnly?: boolean;
  blockedBy?: string;
  preflightDecision?: string;
  macroGateState?: {
    regime?: string;
    sellOnlyMode?: boolean;
    diagnosticLiveEntryBlocked?: boolean;
    liveEntryBlockedReason?: string;
    bearDefenseMode?: boolean;
    vixGatingActive?: boolean;
    fomcPhase?: string;
  } | null;
  liveEntryBlockedReason?: string;
}): NormalSupplyPreviewEngineMode {
  const decision = `${input.preflightDecision ?? ''} ${input.blockedBy ?? ''}`.toUpperCase();
  const liveBlockReason = `${input.liveEntryBlockedReason ?? input.macroGateState?.liveEntryBlockedReason ?? ''}`.toUpperCase();
  const macroRegime = `${input.macroGateState?.regime ?? ''}`.toUpperCase();
  const regimeDiagnosticLiveBlocked =
    input.macroGateState?.diagnosticLiveEntryBlocked === true &&
    (macroRegime === 'R4_NEUTRAL' || macroRegime === 'R5_CAUTION');
  if (input.sellOnly || input.macroGateState?.sellOnlyMode || decision.includes('SELL_ONLY')) return 'SELL_ONLY';
  if (decision.includes('POSITION_FULL') || liveBlockReason.includes('POSITION_FULL')) return 'POSITION_FULL';
  if (
    liveBlockReason.includes('R4_NEUTRAL') ||
    liveBlockReason.includes('R5_CAUTION') ||
    liveBlockReason.includes('R6_DEFENSE') ||
    liveBlockReason.includes('VIX_BLOCK') ||
    liveBlockReason.includes('FOMC_BLOCK') ||
    regimeDiagnosticLiveBlocked ||
    input.macroGateState?.bearDefenseMode ||
    input.macroGateState?.vixGatingActive ||
    input.macroGateState?.fomcPhase === 'DAY'
  ) {
    return 'MACRO_LIVE_BLOCK';
  }
  if (decision.includes('HARD_BLOCK')) return 'HARD_BLOCK';
  if (decision.trim().length > 0) return 'PRE_FLIGHT_BLOCK';
  return 'NORMAL';
}
