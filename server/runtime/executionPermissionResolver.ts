// @responsibility P0 execution permission SSOT. Keeps evaluation/learning alive while isolating live-order permission.

export type ExecutionPermissionLiveBlockReason =
  | 'NONE'
  | 'SELL_ONLY_MODE'
  | 'SHADOW_ONLY_MODE'
  | 'OBSERVE_ONLY_MODE'
  | 'BROKER_PERMISSION_BLOCK'
  | 'OPERATOR_BLOCK'
  | 'REAL_TRADING_DISABLED'
  | 'MARKET_SESSION_BLOCK'
  | 'POLICY_BLOCK';

export type ExecutionPermissionImpact =
  | 'NONE'
  | 'LIVE_ORDER_ALLOWED'
  | 'NEW_BUY_BLOCKED_ONLY';

export interface ResolveExecutionPermissionInput {
  sourceSnapshotId: string;
  asOf?: string;
  ttlSec?: number;
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
  return upper(input.engineMode) === 'SHADOW_ONLY' || upper(input.operationMode) === 'SHADOW_ONLY';
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

function resolveLiveBlockReason(input: ResolveExecutionPermissionInput): ExecutionPermissionLiveBlockReason {
  if (input.gateQualityPassed === false) return 'POLICY_BLOCK';
  if (isShadowOnly(input)) return 'SHADOW_ONLY_MODE';
  if (isObserveOnly(input)) return 'OBSERVE_ONLY_MODE';
  if (input.realTradingEnabled === false) return 'REAL_TRADING_DISABLED';
  if (input.brokerOrderAllowed === false) return 'BROKER_PERMISSION_BLOCK';
  if (input.operatorOrderAllowed === false) return 'OPERATOR_BLOCK';
  if (isMarketSessionLiveBlocked(input.marketSessionState)) return 'MARKET_SESSION_BLOCK';
  return 'NONE';
}

function resolveSizingMultiplier(input: ResolveExecutionPermissionInput): number {
  const multipliers: number[] = [1];
  if (finiteNumber(input.kellySizingMultiplier)) multipliers.push(Math.max(0, input.kellySizingMultiplier));
  if (finiteNumber(input.kellyFraction)) multipliers.push(Math.max(0, input.kellyFraction));
  return Math.max(0, Math.min(...multipliers));
}

export function resolveExecutionPermission(input: ResolveExecutionPermissionInput): ExecutionPermissionResolution {
  const liveBlockReason = resolveLiveBlockReason(input);
  const providerIssueIsolated = input.providerIssue === true;
  const kellyAdvisory = finiteNumber(input.kellyFraction) || finiteNumber(input.kellySizingMultiplier);
  const marketSignal = providerIssueIsolated ? false : input.marketSignal === true;
  const liveOrderAllowed = liveBlockReason === 'NONE';
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

export function formatExecutionPermissionLog(permission: ExecutionPermissionResolution): string {
  return [
    ...permission.logTags,
    `sourceSnapshotId=${permission.sourceSnapshotId}`,
    `asOf=${permission.asOf}`,
    `ttlSec=${permission.ttlSec}`,
    `gateEvaluationAllowed=${permission.gateEvaluationAllowed}`,
    `diagnosticGateEvaluationAllowed=${permission.diagnosticGateEvaluationAllowed}`,
    `shadowEvaluationAllowed=${permission.shadowEvaluationAllowed}`,
    `counterfactualAllowed=${permission.counterfactualAllowed}`,
    `paperFillAllowed=${permission.paperFillAllowed}`,
    `liveOrderAllowed=${permission.liveOrderAllowed}`,
    `liveBlockReason=${permission.liveBlockReason}`,
    `scorePenalty=${permission.scorePenalty}`,
    `sizingMultiplier=${permission.sizingMultiplier.toFixed(4)}`,
    `providerIssueIsolated=${permission.providerIssueIsolated}`,
    `marketSignal=${permission.marketSignal}`,
    `executionImpact=${permission.executionImpact}`,
  ].join(' ');
}
