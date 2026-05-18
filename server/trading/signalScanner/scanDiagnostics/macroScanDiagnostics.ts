// @responsibility Macro scan diagnostic mapping.

import type { MacroGateState } from './scanSummaryTypes.js';

export function buildMacroGateState(input: {
  emergencyStop: boolean;
  autoTradeEnabled: boolean;
  regime: string;
  regimeKelly: number;
  fomcPhase: string;
  fomcKelly: number;
  finalKelly: number;
  vixGatingActive: boolean;
  bearDefenseMode: boolean;
  mhsBelow30: boolean;
  watchlistEmpty: boolean;
  sellOnlyMode: boolean;
  kospi20dReturn?: number;
  macroEntryOverrideActive?: boolean;
  macroEntryOverrideTargets?: string[];
  diagnosticLiveEntryBlocked?: boolean;
  liveEntryBlockedReason?: string;
  macroRegimeRaw?: string;
  macroRegimeEffective?: string;
  regimeSnapshotId?: string;
  regimeSnapshotAsOf?: string;
  regimeSnapshotTtlSec?: number;
  displayRegime?: string;
  riskOverride?: string;
  engineMode?: string;
  sourceHealth?: string;
  regimeConflicts?: string[];
  r6RecoveryStatus?: string;
  activeR6Triggers?: string[];
  r6ShockLatch?: boolean;
  recoveryBlockedReason?: string;
  liveEntryAllowed?: boolean;
  liveExitAllowed?: boolean;
  shadowBuyAllowed?: boolean;
  shadowSellAllowed?: boolean;
  shadowLearningAllowed?: boolean;
  counterfactualAllowed?: boolean;
  diagnosticAllowed?: boolean;
  brokerOrderAllowed?: boolean;
}): MacroGateState {
  return {
    emergencyStop: input.emergencyStop,
    autoTradeEnabled: input.autoTradeEnabled,
    regime: input.regime,
    kellyMultiplierFromRegime: input.regimeKelly,
    fomcPhase: input.fomcPhase,
    fomcKellyMultiplier: input.fomcKelly,
    finalKellyMultiplier: input.finalKelly,
    vixGatingActive: input.vixGatingActive,
    bearDefenseMode: input.bearDefenseMode,
    mhsBelow30: input.mhsBelow30,
    watchlistEmpty: input.watchlistEmpty,
    sellOnlyMode: input.sellOnlyMode,
    kospi20dReturn: input.kospi20dReturn,
    macroEntryOverrideActive: input.macroEntryOverrideActive,
    macroEntryOverrideTargets: input.macroEntryOverrideTargets,
    diagnosticLiveEntryBlocked: input.diagnosticLiveEntryBlocked,
    liveEntryBlockedReason: input.liveEntryBlockedReason,
    macroRegimeRaw: input.macroRegimeRaw,
    macroRegimeEffective: input.macroRegimeEffective,
    regimeSnapshotId: input.regimeSnapshotId,
    regimeSnapshotAsOf: input.regimeSnapshotAsOf,
    regimeSnapshotTtlSec: input.regimeSnapshotTtlSec,
    displayRegime: input.displayRegime,
    riskOverride: input.riskOverride,
    engineMode: input.engineMode,
    sourceHealth: input.sourceHealth,
    regimeConflicts: input.regimeConflicts,
    r6RecoveryStatus: input.r6RecoveryStatus,
    activeR6Triggers: input.activeR6Triggers,
    r6ShockLatch: input.r6ShockLatch,
    recoveryBlockedReason: input.recoveryBlockedReason,
    liveEntryAllowed: input.liveEntryAllowed,
    liveExitAllowed: input.liveExitAllowed ?? true,
    shadowBuyAllowed: input.shadowBuyAllowed ?? true,
    shadowSellAllowed: input.shadowSellAllowed ?? true,
    shadowLearningAllowed: input.shadowLearningAllowed,
    counterfactualAllowed: input.counterfactualAllowed ?? true,
    diagnosticAllowed: input.diagnosticAllowed ?? true,
    brokerOrderAllowed: input.brokerOrderAllowed ?? input.liveEntryAllowed ?? false,
  };
}

export function scanDiagnosticNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function scanDiagnosticString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
