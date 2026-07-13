// @responsibility P0 execution permission SSOT. Keeps evaluation/learning alive while isolating live-order permission.

export type ExecutionPermissionLiveBlockReason =
  | 'NONE'
  | 'SELL_ONLY_MODE'
  | 'SHADOW_ONLY_POLICY'
  | 'SHADOW_ONLY_MODE'
  | 'OBSERVE_ONLY_MODE'
  | 'EOD_SNAPSHOT_NOT_LIVE_TRADABLE'
  | 'SNAPSHOT_STALE_NOT_LIVE_TRADABLE'
  | 'SNAPSHOT_MISSING_NOT_LIVE_TRADABLE'
  | 'SNAPSHOT_DEGRADED_NOT_LIVE_TRADABLE'
  | 'BROKER_PERMISSION_BLOCK'
  | 'OPERATOR_BLOCK'
  | 'REAL_TRADING_DISABLED'
  | 'MARKET_SESSION_BLOCK'
  | 'POLICY_BLOCK';

type ExecutionPermissionImpact =
  | 'NONE'
  | 'LIVE_ORDER_ALLOWED'
  | 'NEW_BUY_BLOCKED_ONLY';

export interface ResolveExecutionPermissionInput {
  sourceSnapshotId: string;
  asOf?: string;
  ttlSec?: number;
  sourceFreshness?: string | null;
  snapshotAgeSec?: number | null;
  snapshotUsableForLiveOrder?: boolean;
  macroPolicy?: string | null;
  riskOverride?: string | null;
  gateQualityPassed?: boolean;
  engineMode?: string | null;
  operationMode?: string | null;
  effectiveRegime?: string | null;
  marketSessionState?: string | null;
  brokerOrderAllowed?: boolean;
  operatorOrderAllowed?: boolean;
  realTradingEnabled?: boolean;
  providerIssue?: boolean;
  marketSignal?: boolean;
  kellyFraction?: number | null;
  kellySizingMultiplier?: number | null;
  r6ScorePenalty?: number;
  r6SizingMultiplier?: number;
}

export interface ExecutionPermissionResolution {
  sourceSnapshotId: string;
  asOf: string;
  ttlSec: number;
  gateEvaluationAllowed: true;
  diagnosticGateEvaluationAllowed: true;
  shadowEvaluationAllowed: true;
  counterfactualAllowed: true;
  shadowOrderAllowed: true;
  paperFillAllowed: true;
  liveOrderAllowed: boolean;
  liveBlockReason: ExecutionPermissionLiveBlockReason;
  snapshotFreshnessForLive: string;
  snapshotFreshnessForShadow: string;
  snapshotFreshnessForDiagnostic: string;
  usableForLiveOrder: boolean;
  usableForBrokerOrder: boolean;
  usableForShadow: true;
  usableForCounterfactual: true;
  usableForDiagnostic: true;
  executionPermissionReason: ExecutionPermissionLiveBlockReason;
  executionPermissionSource: string;
  finalExecutionPolicy: 'LIVE_ORDER_ALLOWED' | 'SHADOW_AND_DIAGNOSTIC_ONLY';
  confidenceAdjustments: string[];
  policyLabels: string[];
  learningLabels: string[];
  executionImpact: ExecutionPermissionImpact;
  scorePenalty: number;
  sizingMultiplier: number;
  providerIssueIsolated: boolean;
  marketSignal: boolean;
  logTags: string[];
}

function upper(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

function isShadowOnly(input: ResolveExecutionPermissionInput): boolean {
  return upper(input.engineMode) === 'SHADOW_ONLY'
    || upper(input.operationMode) === 'SHADOW_ONLY'
    || upper(input.macroPolicy) === 'SHADOW_ONLY'
    || upper(input.riskOverride) === 'SHADOW_ONLY';
}

function isObserveOnly(input: ResolveExecutionPermissionInput): boolean {
  return upper(input.engineMode) === 'OBSERVE_ONLY' || upper(input.operationMode) === 'OBSERVE_ONLY';
}

function isMarketSessionLiveBlocked(value: string | null | undefined): boolean {
  const session = upper(value);
  return session === 'CLOSED'
    || session === 'NON_TRADING_DAY'
    || session === 'AFTERMARKET'
    || session === 'AFTER_MARKET'
    || session === 'POST_CLOSE'
    || session === 'PRE_MARKET';
}

function finiteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

interface SnapshotUsageValidity {
  usableForLiveOrder: boolean;
  usableForBrokerOrder: boolean;
  snapshotFreshnessForLive: string;
  snapshotFreshnessForShadow: string;
  snapshotFreshnessForDiagnostic: string;
  reason: ExecutionPermissionLiveBlockReason | 'NONE';
}

function resolveSnapshotUsageValidity(input: ResolveExecutionPermissionInput): SnapshotUsageValidity {
  const sourceFreshness = upper(input.sourceFreshness);
  const ttlExpired = finiteNumber(input.snapshotAgeSec) && finiteNumber(input.ttlSec) && input.snapshotAgeSec > input.ttlSec;
  const eodValid = sourceFreshness === 'EOD_SNAPSHOT_VALID' || sourceFreshness === 'POST_CLOSE_VALID';
  if (input.snapshotUsableForLiveOrder === false) {
    return {
      usableForLiveOrder: false,
      usableForBrokerOrder: false,
      snapshotFreshnessForLive: eodValid ? 'STALE' : 'BLOCKED',
      snapshotFreshnessForShadow: eodValid ? 'EOD_VALID' : 'REFERENCE_ONLY',
      snapshotFreshnessForDiagnostic: eodValid ? 'EOD_VALID' : 'REFERENCE_ONLY',
      reason: eodValid ? 'EOD_SNAPSHOT_NOT_LIVE_TRADABLE' : 'SNAPSHOT_STALE_NOT_LIVE_TRADABLE',
    };
  }
  if (eodValid) {
    return {
      usableForLiveOrder: false,
      usableForBrokerOrder: false,
      snapshotFreshnessForLive: 'STALE',
      snapshotFreshnessForShadow: 'EOD_VALID',
      snapshotFreshnessForDiagnostic: 'EOD_VALID',
      reason: 'EOD_SNAPSHOT_NOT_LIVE_TRADABLE',
    };
  }
  if (ttlExpired || sourceFreshness === 'SOFT_STALE' || sourceFreshness === 'HARD_STALE' || sourceFreshness === 'STALE') {
    return {
      usableForLiveOrder: false,
      usableForBrokerOrder: false,
      snapshotFreshnessForLive: 'STALE',
      snapshotFreshnessForShadow: 'STALE_REFERENCE',
      snapshotFreshnessForDiagnostic: 'STALE_REFERENCE',
      reason: 'SNAPSHOT_STALE_NOT_LIVE_TRADABLE',
    };
  }
  if (sourceFreshness === 'MISSING') {
    return {
      usableForLiveOrder: false,
      usableForBrokerOrder: false,
      snapshotFreshnessForLive: 'MISSING',
      snapshotFreshnessForShadow: 'MISSING_REFERENCE',
      snapshotFreshnessForDiagnostic: 'MISSING_REFERENCE',
      reason: 'SNAPSHOT_MISSING_NOT_LIVE_TRADABLE',
    };
  }
  if (sourceFreshness === 'DEGRADED') {
    return {
      usableForLiveOrder: false,
      usableForBrokerOrder: false,
      snapshotFreshnessForLive: 'DEGRADED',
      snapshotFreshnessForShadow: 'DEGRADED_REFERENCE',
      snapshotFreshnessForDiagnostic: 'DEGRADED_REFERENCE',
      reason: 'SNAPSHOT_DEGRADED_NOT_LIVE_TRADABLE',
    };
  }
  return {
    usableForLiveOrder: true,
    usableForBrokerOrder: true,
    snapshotFreshnessForLive: 'FRESH',
    snapshotFreshnessForShadow: 'FRESH',
    snapshotFreshnessForDiagnostic: 'FRESH',
    reason: 'NONE',
  };
}

function resolveLiveBlockReason(input: ResolveExecutionPermissionInput): ExecutionPermissionLiveBlockReason {
  const snapshotUsage = resolveSnapshotUsageValidity(input);
  if (isMarketSessionLiveBlocked(input.marketSessionState)) return 'MARKET_SESSION_BLOCK';
  if (!snapshotUsage.usableForLiveOrder) return snapshotUsage.reason === 'NONE' ? 'SNAPSHOT_STALE_NOT_LIVE_TRADABLE' : snapshotUsage.reason;
  if (isShadowOnly(input)) return 'SHADOW_ONLY_POLICY';
  if (isObserveOnly(input)) return 'OBSERVE_ONLY_MODE';
  if (input.gateQualityPassed === false) return 'POLICY_BLOCK';
  if (input.realTradingEnabled === false) return 'REAL_TRADING_DISABLED';
  if (input.brokerOrderAllowed === false) return 'BROKER_PERMISSION_BLOCK';
  if (input.operatorOrderAllowed === false) return 'OPERATOR_BLOCK';
  return 'NONE';
}

function resolveSizingMultiplier(input: ResolveExecutionPermissionInput): number {
  const multipliers: number[] = [1];
  if (finiteNumber(input.kellySizingMultiplier)) multipliers.push(Math.max(0, input.kellySizingMultiplier));
  if (finiteNumber(input.kellyFraction)) multipliers.push(Math.max(0, input.kellyFraction));
  return Math.max(0, Math.min(...multipliers));
}

export function resolveExecutionPermission(input: ResolveExecutionPermissionInput): ExecutionPermissionResolution {
  const snapshotUsage = resolveSnapshotUsageValidity(input);
  const liveBlockReason = resolveLiveBlockReason(input);
  const providerIssueIsolated = input.providerIssue === true;
  const kellyAdvisory = finiteNumber(input.kellyFraction) || finiteNumber(input.kellySizingMultiplier);
  const marketSignal = providerIssueIsolated ? false : input.marketSignal === true;
  const liveOrderAllowed = liveBlockReason === 'NONE';
  const finalExecutionPolicy = liveOrderAllowed ? 'LIVE_ORDER_ALLOWED' : 'SHADOW_AND_DIAGNOSTIC_ONLY';
  const confidenceAdjustments: string[] = [];
  const policyLabels = ['SOURCE_SNAPSHOT_SSOT_CONFIRMED'];
  const learningLabels = ['SHADOW_LEARNING_ALWAYS_ON', 'COUNTERFACTUAL_ALWAYS_ON'];
  const logTags = ['[SOURCE_SNAPSHOT_SSOT_CONFIRMED]'];

  if (kellyAdvisory) {
    policyLabels.push('KELLY_ADVISORY_ONLY');
    logTags.push('[KELLY_ADVISORY_ONLY]');
  }
  if (providerIssueIsolated) {
    policyLabels.push('PROVIDER_ISSUE_ISOLATED');
    confidenceAdjustments.push('PROVIDER_ISSUE_CONFIDENCE_DOWNGRADE_ONLY');
    learningLabels.push('PROVIDER_ISSUE_OBSERVED');
    logTags.push('[PROVIDER_ISSUE_ISOLATED]', '[PROVIDER_HEALTH_SEPARATED_FROM_MARKET_SIGNAL]');
  }

  return {
    sourceSnapshotId: input.sourceSnapshotId,
    asOf: input.asOf ?? new Date(0).toISOString(),
    ttlSec: input.ttlSec ?? 0,
    gateEvaluationAllowed: true,
    diagnosticGateEvaluationAllowed: true,
    shadowEvaluationAllowed: true,
    counterfactualAllowed: true,
    shadowOrderAllowed: true,
    paperFillAllowed: true,
    liveOrderAllowed,
    liveBlockReason,
    snapshotFreshnessForLive: snapshotUsage.snapshotFreshnessForLive,
    snapshotFreshnessForShadow: snapshotUsage.snapshotFreshnessForShadow,
    snapshotFreshnessForDiagnostic: snapshotUsage.snapshotFreshnessForDiagnostic,
    usableForLiveOrder: snapshotUsage.usableForLiveOrder,
    usableForBrokerOrder: snapshotUsage.usableForBrokerOrder,
    usableForShadow: true,
    usableForCounterfactual: true,
    usableForDiagnostic: true,
    executionPermissionReason: liveBlockReason,
    executionPermissionSource: 'ExecutionPermissionResolver',
    finalExecutionPolicy,
    confidenceAdjustments,
    policyLabels,
    learningLabels,
    executionImpact: liveOrderAllowed ? 'LIVE_ORDER_ALLOWED' : 'NONE',
    scorePenalty: 0,
    sizingMultiplier: resolveSizingMultiplier(input),
    providerIssueIsolated,
    marketSignal,
    logTags: Array.from(new Set(logTags)),
  };
}

export function formatExecutionPermissionLog(
  permission: ExecutionPermissionResolution,
  // ADR-0528 a3: per-symbol 호출 시 symbol + finalVerdict(②) carry(log-only enrichment).
  correlation?: { symbol?: string; finalVerdict?: string },
): string {
  return [
    ...permission.logTags,
    // ADR-0528 a3: decisionStage + symbol + finalVerdict 부착(상관 강제). 값은 정본 read-carry.
    `decisionStage=EXECUTION_PERMISSION`,
    `sourceSnapshotId=${permission.sourceSnapshotId}`,
    `symbol=${correlation?.symbol ?? 'NA'}`,
    ...(correlation?.finalVerdict !== undefined ? [`finalVerdict=${correlation.finalVerdict}`] : []),
    `shadowOrderAllowed=${permission.shadowOrderAllowed}`,
    `asOf=${permission.asOf}`,
    `ttlSec=${permission.ttlSec}`,
    `gateEvaluationAllowed=${permission.gateEvaluationAllowed}`,
    `diagnosticGateEvaluationAllowed=${permission.diagnosticGateEvaluationAllowed}`,
    `shadowEvaluationAllowed=${permission.shadowEvaluationAllowed}`,
    `counterfactualAllowed=${permission.counterfactualAllowed}`,
    `paperFillAllowed=${permission.paperFillAllowed}`,
    `liveOrderAllowed=${permission.liveOrderAllowed}`,
    `liveBlockReason=${permission.liveBlockReason}`,
    `snapshotFreshnessForLive=${permission.snapshotFreshnessForLive}`,
    `snapshotFreshnessForShadow=${permission.snapshotFreshnessForShadow}`,
    `usableForLiveOrder=${permission.usableForLiveOrder}`,
    `usableForBrokerOrder=${permission.usableForBrokerOrder}`,
    `finalExecutionPolicy=${permission.finalExecutionPolicy}`,
    `scorePenalty=${permission.scorePenalty}`,
    `sizingMultiplier=${permission.sizingMultiplier.toFixed(4)}`,
    `providerIssueIsolated=${permission.providerIssueIsolated}`,
    `marketSignal=${permission.marketSignal}`,
    `executionImpact=${permission.executionImpact}`,
  ].join(' ');
}
