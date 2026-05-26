// @responsibility Normalize Gate0 macro signal validity plus permission diagnostics.
import type {
  Gate0SourceHealth,
  MacroGateState,
  MacroSignalConfidence,
  ScanSummary,
} from './scanSummaryTypes.js';

export type Gate0ExecutionImpact = 'NONE' | 'LIVE_BUY_BLOCKED' | 'LIVE_EXIT_ONLY';

export interface MacroSnapshotFreshness {
  macroSnapshotAvailable: boolean;
  sourceHealth: Gate0SourceHealth;
  regimeSnapshotAgeSec?: number;
  regimeSnapshotTtlSec?: number;
}

export interface MacroSignalValidity {
  macroSignalConfidence: MacroSignalConfidence;
  macroMarketSignal: boolean;
  macroSignalReason: string;
  macroSignalUsableForLive: boolean;
  macroSignalUsableForShadow: boolean;
  macroSignalUsableForCounterfactual: boolean;
  macroSignalUsableForDiagnostic: boolean;
  providerIssueIsolated: boolean;
}

export interface Gate0ExecutionPermission {
  liveEntryAllowed: boolean;
  liveExitAllowed: boolean;
  brokerRouteAlive: boolean;
  brokerLiveOrderAllowed: boolean;
  paperOrderAllowed: boolean;
  liveBlockReason: string;
  liveBlockSubReason?: string;
  liveBlockSource: string;
  executionImpact: Gate0ExecutionImpact;
  diagnosticOnly: boolean;
}

export interface Gate0LearningPermission {
  shadowAllowed: boolean;
  counterfactualAllowed: boolean;
  diagnosticAllowed: boolean;
  shadowLearningAllowed: boolean;
}

export interface Gate0Decision extends MacroSnapshotFreshness, MacroSignalValidity, Gate0ExecutionPermission, Gate0LearningPermission {
  gate: 'GATE0_MACRO_PERMISSION_GUARD';
  sourceSnapshotId: string;
  regimeSnapshotId?: string;
  regimeSnapshotAsOf?: string;
  rawRegime: string;
  effectiveRegime: string;
  displayRegime: string;
  riskOverride: string;
  engineMode: string;
  mhs: number | null;
  mhsBelow30: boolean;
  kospi20dReturn: number | null;
  kellyRegime: number | null;
  kellyFomc: number | null;
  kellyFinal: number | null;
  fomcPhase: string;
  vixGatingActive: boolean;
  bearDefenseMode: boolean;
  autoTradeEnabled: boolean;
  emergencyStop: boolean;
  sellOnlyMode: boolean;
  activeRiskFlags: string;
  providerIssue: boolean;
  note: string;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function finiteOrNull(value: unknown): number | null {
  return finiteNumber(value) ? value : null;
}

function upper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function text(value: unknown, fallback = 'UNKNOWN'): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizeSourceHealth(value: unknown): Gate0SourceHealth | null {
  const raw = upper(value);
  if (!raw) return null;
  if (raw === 'VERIFIED' || raw === 'FRESH' || raw === 'OK') return 'VERIFIED';
  if (raw.includes('STALE')) return 'STALE';
  if (raw === 'MISSING' || raw === 'NO_DATA' || raw === 'DATA_UNAVAILABLE') return 'MISSING';
  if (raw === 'DEGRADED' || raw === 'PARTIAL' || raw === 'UNKNOWN') return 'DEGRADED';
  return 'DEGRADED';
}

function parseAgeSec(asOf: unknown, now: Date): number | undefined {
  if (typeof asOf !== 'string' || asOf.trim().length === 0) return undefined;
  const ms = Date.parse(asOf);
  if (!Number.isFinite(ms)) return undefined;
  return Math.max(0, Math.floor((now.getTime() - ms) / 1000));
}

export function resolveMacroSnapshotFreshness(
  snapshot: Pick<MacroGateState, 'regimeSnapshotId' | 'regimeSnapshotAsOf' | 'regimeSnapshotTtlSec' | 'regimeSnapshotAgeSec' | 'sourceHealth'> | null | undefined,
  now = new Date(),
): MacroSnapshotFreshness {
  const explicitHealth = normalizeSourceHealth(snapshot?.sourceHealth);
  const ageSec = snapshot?.regimeSnapshotAgeSec ?? parseAgeSec(snapshot?.regimeSnapshotAsOf, now);
  const ttlSec = finiteNumber(snapshot?.regimeSnapshotTtlSec) ? snapshot.regimeSnapshotTtlSec : undefined;
  const hasSnapshotIdentity = text(snapshot?.regimeSnapshotId, '') !== '' || text(snapshot?.regimeSnapshotAsOf, '') !== '';
  const macroSnapshotAvailable = hasSnapshotIdentity || (explicitHealth !== null && explicitHealth !== 'MISSING');

  if (!macroSnapshotAvailable) {
    return { macroSnapshotAvailable: false, sourceHealth: 'MISSING', regimeSnapshotAgeSec: ageSec, regimeSnapshotTtlSec: ttlSec };
  }
  if (explicitHealth === 'MISSING') {
    return { macroSnapshotAvailable: true, sourceHealth: 'MISSING', regimeSnapshotAgeSec: ageSec, regimeSnapshotTtlSec: ttlSec };
  }
  if (explicitHealth === 'STALE' || (finiteNumber(ageSec) && finiteNumber(ttlSec) && ageSec > ttlSec)) {
    return { macroSnapshotAvailable: true, sourceHealth: 'STALE', regimeSnapshotAgeSec: ageSec, regimeSnapshotTtlSec: ttlSec };
  }
  return {
    macroSnapshotAvailable: true,
    sourceHealth: explicitHealth ?? 'VERIFIED',
    regimeSnapshotAgeSec: ageSec,
    regimeSnapshotTtlSec: ttlSec,
  };
}

function verifiedMacroMarketSignal(mg: MacroGateState): boolean {
  const mhs = finiteOrNull(mg.mhs);
  const kospi20dReturn = finiteOrNull(mg.kospi20dReturn);
  const riskOffSignal = mg.emergencyStop
    || mg.vixGatingActive
    || mg.bearDefenseMode
    || mg.mhsBelow30
    || mg.regime === 'R6_DEFENSE'
    || mg.macroRegimeEffective === 'R6_DEFENSE';
  const constructiveSignal = mhs !== null && kospi20dReturn !== null && mhs >= 60 && kospi20dReturn >= 0;
  return Boolean(riskOffSignal || constructiveSignal);
}

export function resolveMacroSignalValidity(
  snapshot: MacroGateState | null | undefined,
  freshness: MacroSnapshotFreshness,
): MacroSignalValidity {
  const providerIssueIsolated = snapshot?.providerIssue === true;
  const hasMhs = finiteNumber(snapshot?.mhs);
  const hasKospi20dReturn = finiteNumber(snapshot?.kospi20dReturn);

  if (!freshness.macroSnapshotAvailable || freshness.sourceHealth === 'MISSING') {
    return {
      macroSignalConfidence: 'MISSING',
      macroMarketSignal: false,
      macroSignalReason: 'MACRO_SNAPSHOT_MISSING',
      macroSignalUsableForLive: false,
      macroSignalUsableForShadow: true,
      macroSignalUsableForCounterfactual: true,
      macroSignalUsableForDiagnostic: true,
      providerIssueIsolated,
    };
  }

  if (!hasMhs || !hasKospi20dReturn) {
    return {
      macroSignalConfidence: 'MISSING_OR_PARTIAL',
      macroMarketSignal: false,
      macroSignalReason: 'MHS_OR_KOSPI20D_RETURN_MISSING',
      macroSignalUsableForLive: false,
      macroSignalUsableForShadow: true,
      macroSignalUsableForCounterfactual: true,
      macroSignalUsableForDiagnostic: true,
      providerIssueIsolated,
    };
  }

  if (freshness.sourceHealth === 'STALE') {
    return {
      macroSignalConfidence: 'STALE',
      macroMarketSignal: false,
      macroSignalReason: 'MACRO_SNAPSHOT_STALE',
      macroSignalUsableForLive: false,
      macroSignalUsableForShadow: true,
      macroSignalUsableForCounterfactual: true,
      macroSignalUsableForDiagnostic: true,
      providerIssueIsolated,
    };
  }

  if (freshness.sourceHealth === 'DEGRADED') {
    return {
      macroSignalConfidence: 'UNKNOWN',
      macroMarketSignal: false,
      macroSignalReason: 'MACRO_SOURCE_DEGRADED',
      macroSignalUsableForLive: false,
      macroSignalUsableForShadow: true,
      macroSignalUsableForCounterfactual: true,
      macroSignalUsableForDiagnostic: true,
      providerIssueIsolated,
    };
  }

  const macroMarketSignal = verifiedMacroMarketSignal(snapshot ?? ({} as MacroGateState));
  return {
    macroSignalConfidence: 'VERIFIED',
    macroMarketSignal,
    macroSignalReason: macroMarketSignal ? 'VERIFIED_MACRO_SIGNAL_AVAILABLE' : 'VERIFIED_MACRO_SIGNAL_NEUTRAL',
    macroSignalUsableForLive: true,
    macroSignalUsableForShadow: true,
    macroSignalUsableForCounterfactual: true,
    macroSignalUsableForDiagnostic: true,
    providerIssueIsolated,
  };
}

function isShadowOnly(mg: MacroGateState | null | undefined): boolean {
  return upper(mg?.engineMode) === 'SHADOW_ONLY'
    || upper(mg?.displayRegime) === 'SHADOW_ONLY'
    || upper(mg?.riskOverride) === 'SHADOW_ONLY';
}

function liveBlockSubReason(mg: MacroGateState | null | undefined): string | undefined {
  const direct = text(mg?.liveEntryBlockedReason, '');
  if (direct) return direct;
  const recovery = text(mg?.recoveryBlockedReason, '');
  return recovery || undefined;
}

export function resolveExecutionPermission(
  mg: MacroGateState | null | undefined,
  macroSignalValidity: Pick<MacroSignalValidity, 'macroSignalUsableForLive'>,
): Gate0ExecutionPermission {
  const shadowOnly = isShadowOnly(mg);
  const subReason = liveBlockSubReason(mg);
  const emergencyStop = mg?.emergencyStop === true;
  const sellOnlyMode = mg?.sellOnlyMode === true;
  const autoTradeDisabled = mg?.autoTradeEnabled === false;
  const paperOrderAllowed = emergencyStop ? false : mg?.paperOrderAllowed ?? true;

  let liveBlockReason = 'NONE';
  if (emergencyStop) liveBlockReason = 'EMERGENCY_STOP';
  else if (shadowOnly) liveBlockReason = 'SHADOW_ONLY_POLICY';
  else if (sellOnlyMode) liveBlockReason = 'SELL_ONLY_MODE';
  else if (autoTradeDisabled) liveBlockReason = 'AUTO_TRADE_DISABLED';
  else if (!macroSignalValidity.macroSignalUsableForLive) liveBlockReason = 'MACRO_SIGNAL_NOT_USABLE';
  else if (mg?.liveEntryAllowed === false) liveBlockReason = 'POLICY_BLOCK';

  const brokerRouteInput = mg?.brokerRouteAlive ?? mg?.brokerOrderAllowed ?? mg?.liveEntryAllowed ?? true;
  const brokerRouteAlive = liveBlockReason === 'NONE' && brokerRouteInput === true;
  const liveEntryAllowed = liveBlockReason === 'NONE' && brokerRouteAlive && macroSignalValidity.macroSignalUsableForLive;
  const brokerLiveOrderAllowed = liveEntryAllowed && (mg?.brokerLiveOrderAllowed ?? true) === true;

  return {
    liveEntryAllowed,
    liveExitAllowed: mg?.liveExitAllowed ?? true,
    brokerRouteAlive,
    brokerLiveOrderAllowed,
    paperOrderAllowed,
    liveBlockReason,
    ...(liveBlockReason !== 'NONE' && subReason ? { liveBlockSubReason: subReason } : {}),
    liveBlockSource: 'ExecutionPermissionResolver',
    executionImpact: 'NONE',
    diagnosticOnly: liveBlockReason !== 'NONE' || shadowOnly,
  };
}

export function resolveLearningPermission(mg: MacroGateState | null | undefined): Gate0LearningPermission {
  return {
    shadowAllowed: mg?.shadowAllowed ?? mg?.shadowBuyAllowed ?? true,
    counterfactualAllowed: mg?.counterfactualAllowed ?? true,
    diagnosticAllowed: mg?.diagnosticAllowed ?? true,
    shadowLearningAllowed: mg?.shadowLearningAllowed ?? true,
  };
}

function sourceSnapshotId(summary: ScanSummary | null | undefined): string {
  return text(summary?.snapshotId ?? summary?.scanEvaluation?.scanId ?? summary?.macroGateState?.regimeSnapshotId, 'NO_SCAN_SUMMARY');
}

function effectiveRegime(mg: MacroGateState | null | undefined): string {
  const rawRegime = mg?.macroRegimeRaw ?? mg?.regime ?? 'UNKNOWN';
  const displayRegime = mg?.displayRegime ?? mg?.regime ?? 'UNKNOWN';
  const legacyEffectiveRegime = mg?.macroRegimeEffective ?? mg?.regime ?? rawRegime;
  const staleLegacyR6Path =
    legacyEffectiveRegime === 'R6_DEFENSE'
    && displayRegime !== 'R6_DEFENSE'
    && mg?.regime !== 'R6_DEFENSE';
  return staleLegacyR6Path ? rawRegime : legacyEffectiveRegime;
}

function activeRiskFlags(mg: MacroGateState | null | undefined): string {
  return [
    mg?.emergencyStop ? 'emergencyStop' : null,
    mg?.autoTradeEnabled === false ? 'autoTradeDisabled' : null,
    mg?.sellOnlyMode ? 'sellOnly' : null,
    mg?.vixGatingActive ? 'vixGate' : null,
    mg?.bearDefenseMode ? 'bearDefense' : null,
    mg?.mhsBelow30 ? 'mhsBelow30' : null,
    mg?.watchlistEmpty ? 'watchlistEmpty' : null,
  ].filter(Boolean).join(',') || 'none';
}

export function buildGate0Decision(summary: ScanSummary | null | undefined, now = new Date()): Gate0Decision {
  const mg = summary?.macroGateState;
  const freshness = resolveMacroSnapshotFreshness(mg, now);
  const validity = resolveMacroSignalValidity(mg, freshness);
  const executionPermission = resolveExecutionPermission(mg, validity);
  const learningPermission = resolveLearningPermission(mg);
  const displayRegime = mg?.displayRegime ?? mg?.regime ?? 'UNKNOWN';
  const engineMode = mg?.engineMode ?? displayRegime;

  return {
    gate: 'GATE0_MACRO_PERMISSION_GUARD',
    sourceSnapshotId: sourceSnapshotId(summary),
    ...(mg?.regimeSnapshotId ? { regimeSnapshotId: mg.regimeSnapshotId } : {}),
    ...(mg?.regimeSnapshotAsOf ? { regimeSnapshotAsOf: mg.regimeSnapshotAsOf } : {}),
    ...freshness,
    ...validity,
    rawRegime: mg?.macroRegimeRaw ?? mg?.regime ?? 'UNKNOWN',
    effectiveRegime: effectiveRegime(mg),
    displayRegime,
    riskOverride: mg?.riskOverride ?? 'NONE',
    engineMode,
    mhs: finiteOrNull(mg?.mhs),
    mhsBelow30: mg?.mhsBelow30 === true,
    kospi20dReturn: finiteOrNull(mg?.kospi20dReturn),
    kellyRegime: finiteOrNull(mg?.kellyMultiplierFromRegime),
    kellyFomc: finiteOrNull(mg?.fomcKellyMultiplier),
    kellyFinal: finiteOrNull(mg?.finalKellyMultiplier),
    fomcPhase: mg?.fomcPhase ?? 'UNKNOWN',
    vixGatingActive: mg?.vixGatingActive === true,
    bearDefenseMode: mg?.bearDefenseMode === true,
    autoTradeEnabled: mg?.autoTradeEnabled === true,
    emergencyStop: mg?.emergencyStop === true,
    sellOnlyMode: mg?.sellOnlyMode === true,
    activeRiskFlags: activeRiskFlags(mg),
    ...executionPermission,
    ...learningPermission,
    providerIssue: mg?.providerIssue === true,
    note: 'Gate0 slice is read-only; stale macro snapshot is not used as live market signal. Shadow and counterfactual remain active.',
  };
}

function numberText(value: number | null | undefined): string {
  return finiteNumber(value) ? String(value) : 'null';
}

export function formatGate0Decision(decision: Gate0Decision, evaluated = true): string {
  if (!evaluated) {
    return [
      'Gate0 Macro / Permission Guard',
      'evaluated: 0/0',
      'reason=MACRO_GATE_STATE_NOT_CARRIED',
      `sourceSnapshotId=${decision.sourceSnapshotId}`,
      'providerIssue=false',
      'executionImpact=NONE',
      'diagnosticOnly=true',
    ].join('\n');
  }

  return [
    'Gate0 Macro / Permission Guard',
    'evaluated: 1/1',
    `sourceSnapshotId=${decision.sourceSnapshotId}`,
    `regimeSnapshotId=${decision.regimeSnapshotId ?? 'NONE'}`,
    `regimeSnapshotAsOf=${decision.regimeSnapshotAsOf ?? 'NONE'}`,
    `regimeSnapshotAgeSec=${numberText(decision.regimeSnapshotAgeSec)}`,
    `regimeSnapshotTtlSec=${numberText(decision.regimeSnapshotTtlSec)}`,
    `sourceHealth=${decision.sourceHealth}`,
    `macroSnapshotAvailable=${decision.macroSnapshotAvailable}`,
    `macroSignalConfidence=${decision.macroSignalConfidence}`,
    `macroMarketSignal=${decision.macroMarketSignal}`,
    `macroSignalReason=${decision.macroSignalReason}`,
    `macroSignalUsableForLive=${decision.macroSignalUsableForLive}`,
    `macroSignalUsableForShadow=${decision.macroSignalUsableForShadow}`,
    `macroSignalUsableForCounterfactual=${decision.macroSignalUsableForCounterfactual}`,
    `macroSignalUsableForDiagnostic=${decision.macroSignalUsableForDiagnostic}`,
    '',
    'Regime:',
    `raw=${decision.rawRegime}`,
    `effective=${decision.effectiveRegime}`,
    `display=${decision.displayRegime}`,
    `riskOverride=${decision.riskOverride}`,
    `engineMode=${decision.engineMode}`,
    `mhs=${numberText(decision.mhs)} mhsBelow30=${decision.mhsBelow30} kospi20dReturn=${numberText(decision.kospi20dReturn)}`,
    `kelly: regime=${numberText(decision.kellyRegime)} fomc=${numberText(decision.kellyFomc)} final=${numberText(decision.kellyFinal)}`,
    `fomcPhase=${decision.fomcPhase} vixGatingActive=${decision.vixGatingActive} bearDefenseMode=${decision.bearDefenseMode}`,
    `autoTradeEnabled=${decision.autoTradeEnabled} emergencyStop=${decision.emergencyStop} sellOnlyMode=${decision.sellOnlyMode}`,
    `activeRiskFlags=${decision.activeRiskFlags}`,
    '',
    'Permissions:',
    `liveEntryAllowed=${decision.liveEntryAllowed}`,
    `liveExitAllowed=${decision.liveExitAllowed}`,
    `liveBlockReason=${decision.liveBlockReason}`,
    `liveBlockSubReason=${decision.liveBlockSubReason ?? 'NONE'}`,
    `liveBlockSource=${decision.liveBlockSource}`,
    `brokerRouteAlive=${decision.brokerRouteAlive}`,
    `brokerLiveOrderAllowed=${decision.brokerLiveOrderAllowed}`,
    `paperOrderAllowed=${decision.paperOrderAllowed}`,
    `shadowAllowed=${decision.shadowAllowed}`,
    `shadowLearningAllowed=${decision.shadowLearningAllowed}`,
    `counterfactualAllowed=${decision.counterfactualAllowed}`,
    `diagnosticAllowed=${decision.diagnosticAllowed}`,
    '',
    'Execution:',
    `executionImpact=${decision.executionImpact}`,
    `diagnosticOnly=${decision.diagnosticOnly}`,
    `providerIssue=${decision.providerIssue}`,
    `providerIssueIsolated=${decision.providerIssueIsolated}`,
    `note=${decision.note}`,
  ].join('\n');
}
