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
  mhs?: number;
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
  regimeSnapshotAgeSec?: number;
  displayRegime?: string;
  riskOverride?: string;
  engineMode?: string;
  sourceHealth?: string;
  sourceFreshness?: string;
  usableForLiveOrder?: boolean;
  usableForBrokerOrder?: boolean;
  snapshotFreshnessForLive?: string;
  snapshotFreshnessForShadow?: string;
  snapshotFreshnessForDiagnostic?: string;
  executionPermissionReason?: string;
  executionPermissionSource?: string;
  finalExecutionPolicy?: string;
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
  canonicalSession?: string;
  displaySession?: string;
  brokerRouteAlive?: boolean;
  brokerLiveOrderAllowed?: boolean;
  brokerExitOrderAllowed?: boolean;
  paperOrderAllowed?: boolean;
  shadowAllowed?: boolean;
  vkospi?: number;
  vkospiTrustState?: string;
  vkospiSanityReasons?: string[];
  providerIssue?: boolean;
}): MacroGateState {
  const engineMode = input.engineMode ?? input.displayRegime ?? input.regime;
  const shadowOnly = engineMode === 'SHADOW_ONLY' || input.displayRegime === 'SHADOW_ONLY' || input.riskOverride === 'SHADOW_ONLY';
  const brokerRouteAlive = input.brokerRouteAlive ?? input.brokerOrderAllowed ?? input.liveEntryAllowed ?? false;
  const brokerLiveOrderAllowed = input.brokerLiveOrderAllowed ?? (!shadowOnly && brokerRouteAlive && input.liveEntryAllowed === true);
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
    mhs: input.mhs,
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
    regimeSnapshotAgeSec: input.regimeSnapshotAgeSec,
    displayRegime: input.displayRegime,
    riskOverride: input.riskOverride,
    engineMode: input.engineMode,
    sourceHealth: input.sourceHealth,
    sourceFreshness: input.sourceFreshness,
    usableForLiveOrder: input.usableForLiveOrder,
    usableForBrokerOrder: input.usableForBrokerOrder,
    snapshotFreshnessForLive: input.snapshotFreshnessForLive,
    snapshotFreshnessForShadow: input.snapshotFreshnessForShadow,
    snapshotFreshnessForDiagnostic: input.snapshotFreshnessForDiagnostic,
    executionPermissionReason: input.executionPermissionReason,
    executionPermissionSource: input.executionPermissionSource,
    finalExecutionPolicy: input.finalExecutionPolicy,
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
    canonicalSession: input.canonicalSession,
    displaySession: input.displaySession,
    brokerRouteAlive,
    brokerLiveOrderAllowed,
    brokerExitOrderAllowed: input.brokerExitOrderAllowed ?? (!shadowOnly && brokerRouteAlive && input.liveExitAllowed !== false),
    paperOrderAllowed: input.paperOrderAllowed ?? true,
    shadowAllowed: input.shadowAllowed ?? true,
    vkospi: input.vkospi,
    vkospiTrustState: input.vkospiTrustState,
    vkospiSanityReasons: input.vkospiSanityReasons,
    providerIssue: input.providerIssue ?? false,
  };
}

export function scanDiagnosticNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function scanDiagnosticString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
