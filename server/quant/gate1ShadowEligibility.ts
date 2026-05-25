// @responsibility Gate1 Always-On shadow eligibility diagnostics only.

import { EngineModeManager, type EngineMode } from '../runtime/engineRuntimePolicy.js';

export type Gate1ShadowEligibilityMode =
  | 'NORMAL_SHADOW'
  | 'DEGRADED_SHADOW'
  | 'COUNTERFACTUAL_ONLY'
  | 'OBSERVE_ONLY'
  | 'DISABLED_UNEXPECTED';

export type Gate1ShadowEligibilitySource =
  | 'ALWAYS_ON_KERNEL'
  | 'ENGINE_MODE'
  | 'MARKET_SESSION'
  | 'QMP_POLICY'
  | 'UNKNOWN';

export type Gate1ShadowEligibilitySourceStatus =
  | 'VERIFIED'
  | 'STALE'
  | 'MISSING'
  | 'DEGRADED'
  | 'UNKNOWN';

export type Gate1LiveExecutionImpact =
  | 'NONE'
  | 'LIVE_BUY_BLOCKED_ONLY'
  | 'LIVE_EXECUTION_BLOCKED';

export interface Gate1ShadowEligibilityDiagnostic {
  allowed: boolean;
  mode: Gate1ShadowEligibilityMode;
  shadowScanAllowed: boolean;
  shadowSignalAllowed: boolean;
  paperOrderAllowed: boolean;
  virtualFillAllowed: boolean;
  positionLifecycleAllowed: boolean;
  counterfactualLearningAllowed: boolean;
  caseRecordingAllowed: boolean;
  reason: string | null;
  blockers: string[];
  degradedReasons: string[];
  source: Gate1ShadowEligibilitySource;
  sourceStatus: Gate1ShadowEligibilitySourceStatus;
  liveExecutionImpact: Gate1LiveExecutionImpact;
  shadowExecutionImpact: 'NONE';
  executionImpact: 'NONE';
  providerIssue: boolean;
  marketSignal: false;
}

export interface NormalizeShadowEligibilityInput {
  engineMode?: EngineMode | string | null;
  marketSessionCompatibility?: {
    session?: string | null;
    liveBuyAllowed?: boolean | null;
    shadowAllowed?: boolean | null;
  } | null;
  quoteCoverage?: {
    confidence?: string | null;
    providerIssue?: boolean | null;
    marketSignal?: boolean | null;
  } | null;
  quoteFreshness?: {
    status?: string | null;
    providerIssue?: boolean | null;
  } | null;
  tradability?: {
    status?: string | null;
    providerIssue?: boolean | null;
  } | null;
  liquidityFloor?: {
    status?: string | null;
    providerIssue?: boolean | null;
  } | null;
  alwaysOnKernelEnabled?: boolean | null;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function upper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function normalizeEngineMode(input: NormalizeShadowEligibilityInput): EngineMode {
  if (EngineModeManager.normalize(input.engineMode) !== 'OBSERVE_ONLY' || upper(input.engineMode) === 'OBSERVE_ONLY') {
    return EngineModeManager.normalize(input.engineMode);
  }
  const session = upper(input.marketSessionCompatibility?.session);
  if (session === 'SELL_ONLY') return 'NORMAL';
  if (session === 'CLOSED' || session === 'HOLIDAY' || session === 'NON_TRADING_DAY') return 'OBSERVE_ONLY';
  return 'NORMAL';
}

function hasMissingQuote(input: NormalizeShadowEligibilityInput): boolean {
  return upper(input.quoteCoverage?.confidence) === 'MISSING'
    || upper(input.quoteFreshness?.status) === 'MISSING';
}

function quoteDegraded(input: NormalizeShadowEligibilityInput): boolean {
  return upper(input.quoteCoverage?.confidence) === 'DEGRADED'
    || upper(input.quoteCoverage?.confidence) === 'STALE'
    || upper(input.quoteFreshness?.status) === 'STALE';
}

function tradabilityHardBlock(status: string): boolean {
  return status === 'HALTED'
    || status === 'SUSPENDED'
    || status === 'DELISTING'
    || status === 'LIQUIDATION';
}

function liveImpactFor(input: NormalizeShadowEligibilityInput, engineMode: EngineMode, blockers: string[]): Gate1LiveExecutionImpact {
  if (blockers.some(blocker => blocker.startsWith('TRADABILITY_'))) return 'LIVE_EXECUTION_BLOCKED';
  if (engineMode === 'SHADOW_ONLY' || engineMode === 'OBSERVE_ONLY') return 'LIVE_EXECUTION_BLOCKED';
  if (hasMissingQuote(input)) return 'LIVE_BUY_BLOCKED_ONLY';
  if (input.marketSessionCompatibility?.liveBuyAllowed === false) return 'LIVE_BUY_BLOCKED_ONLY';
  return 'NONE';
}

function sourceStatusFor(input: NormalizeShadowEligibilityInput, degradedReasons: string[]): Gate1ShadowEligibilitySourceStatus {
  if (input.alwaysOnKernelEnabled === false) return 'DEGRADED';
  if (degradedReasons.length > 0) return 'DEGRADED';
  if (upper(input.quoteCoverage?.confidence) === 'STALE' || upper(input.quoteFreshness?.status) === 'STALE') return 'STALE';
  return 'VERIFIED';
}

export function normalizeShadowEligibilityForGate1(
  input: NormalizeShadowEligibilityInput,
): Gate1ShadowEligibilityDiagnostic {
  if (input.alwaysOnKernelEnabled === false) {
    return {
      allowed: false,
      mode: 'DISABLED_UNEXPECTED',
      shadowScanAllowed: false,
      shadowSignalAllowed: false,
      paperOrderAllowed: false,
      virtualFillAllowed: false,
      positionLifecycleAllowed: false,
      counterfactualLearningAllowed: false,
      caseRecordingAllowed: false,
      reason: 'ALWAYS_ON_KERNEL_DISABLED_UNEXPECTED',
      blockers: ['ALWAYS_ON_KERNEL_DISABLED'],
      degradedReasons: ['ALWAYS_ON_KERNEL_DISABLED'],
      source: 'QMP_POLICY',
      sourceStatus: 'DEGRADED',
      liveExecutionImpact: 'LIVE_EXECUTION_BLOCKED',
      shadowExecutionImpact: 'NONE',
      executionImpact: 'NONE',
      providerIssue: true,
      marketSignal: false,
    };
  }

  const engineMode = normalizeEngineMode(input);
  const session = upper(input.marketSessionCompatibility?.session);
  const tradabilityStatus = upper(input.tradability?.status);
  const blockers: string[] = [];
  const degradedReasons: string[] = [];

  if (hasMissingQuote(input)) {
    blockers.push('QUOTE_MISSING');
    degradedReasons.push('QUOTE_COVERAGE_MISSING');
  } else if (quoteDegraded(input)) {
    degradedReasons.push('QUOTE_COVERAGE_DEGRADED');
  }

  if (tradabilityHardBlock(tradabilityStatus)) blockers.push(`TRADABILITY_${tradabilityStatus}`);
  if (input.liquidityFloor?.providerIssue === true) degradedReasons.push('LIQUIDITY_DIAGNOSTIC_DEGRADED');

  let mode: Gate1ShadowEligibilityMode = 'NORMAL_SHADOW';
  let shadowScanAllowed = true;
  let shadowSignalAllowed = true;
  let paperOrderAllowed = true;
  let virtualFillAllowed = true;
  let positionLifecycleAllowed = true;
  let reason: string | null = null;

  if (tradabilityHardBlock(tradabilityStatus)) {
    mode = 'OBSERVE_ONLY';
    shadowSignalAllowed = false;
    paperOrderAllowed = false;
    virtualFillAllowed = false;
    positionLifecycleAllowed = false;
    reason = `TRADABILITY_${tradabilityStatus}_OBSERVE_ONLY`;
  } else if (hasMissingQuote(input)) {
    mode = 'COUNTERFACTUAL_ONLY';
    shadowSignalAllowed = false;
    paperOrderAllowed = false;
    virtualFillAllowed = false;
    positionLifecycleAllowed = false;
    reason = 'QUOTE_MISSING_COUNTERFACTUAL_ONLY';
  } else if (engineMode === 'OBSERVE_ONLY' || session === 'CLOSED' || session === 'HOLIDAY') {
    mode = 'OBSERVE_ONLY';
    paperOrderAllowed = false;
    virtualFillAllowed = false;
    positionLifecycleAllowed = false;
    reason = session === 'CLOSED' || session === 'HOLIDAY'
      ? 'MARKET_CLOSED_OBSERVE_ONLY_CASE_RECORDING_ALLOWED'
      : 'ENGINE_OBSERVE_ONLY_CASE_RECORDING_ALLOWED';
  } else if (engineMode === 'SHADOW_ONLY') {
    mode = degradedReasons.length > 0 ? 'DEGRADED_SHADOW' : 'NORMAL_SHADOW';
    reason = 'LIVE_EXECUTION_BLOCKED_BY_SHADOW_ONLY_BUT_SHADOW_ALLOWED';
  } else if (engineMode === 'DEGRADED' || degradedReasons.length > 0) {
    mode = 'DEGRADED_SHADOW';
    reason = degradedReasons.length > 0 ? 'PROVIDER_OR_DATA_DEGRADED_SHADOW_ALLOWED' : 'ENGINE_DEGRADED_SHADOW_ALLOWED';
  }

  if (engineMode === 'OBSERVE_ONLY') shadowScanAllowed = true;

  const uniqueBlockers = unique(blockers);
  const uniqueDegradedReasons = unique(degradedReasons);
  const liveExecutionImpact = liveImpactFor(input, engineMode, uniqueBlockers);
  const providerIssue = input.quoteCoverage?.providerIssue === true
    || input.quoteFreshness?.providerIssue === true
    || input.tradability?.providerIssue === true
    || input.liquidityFloor?.providerIssue === true
    || uniqueDegradedReasons.length > 0;

  return {
    allowed: true,
    mode,
    shadowScanAllowed,
    shadowSignalAllowed,
    paperOrderAllowed,
    virtualFillAllowed,
    positionLifecycleAllowed,
    counterfactualLearningAllowed: true,
    caseRecordingAllowed: true,
    reason,
    blockers: uniqueBlockers,
    degradedReasons: uniqueDegradedReasons,
    source: 'ALWAYS_ON_KERNEL',
    sourceStatus: sourceStatusFor(input, uniqueDegradedReasons),
    liveExecutionImpact,
    shadowExecutionImpact: 'NONE',
    executionImpact: 'NONE',
    providerIssue,
    marketSignal: false,
  };
}
