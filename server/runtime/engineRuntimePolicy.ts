// @responsibility Engine runtime mode/policy SSOT. Pure functions only; no broker/order imports.

import {
  resolveExecutionPermission,
  type ExecutionPermissionLiveBlockReason,
} from './executionPermissionResolver.js';

export type EngineMode =
  | 'NORMAL'
  | 'DEGRADED'
  | 'SELL_ONLY'
  | 'SHADOW_ONLY'
  | 'OBSERVE_ONLY';

export type ExecutionImpact =
  | 'NONE'
  | 'NEW_BUY_BLOCKED_ONLY'
  | 'LIVE_ORDER_ALLOWED'
  | 'LIVE_ORDER_BLOCKED';

export interface EngineRuntimePolicy {
  engineMode: EngineMode;
  gateEvaluationAllowed: boolean;
  diagnosticGateEvaluationAllowed: boolean;
  shadowEvaluationAllowed: boolean;
  paperFillAllowed: boolean;
  liveEntryAllowed: boolean;
  liveExitAllowed: boolean;
  liveBuyAllowed: boolean;
  liveSellAllowed: boolean;
  liveOrderAllowed: boolean;
  liveBlockReason: ExecutionPermissionLiveBlockReason;
  shadowBuyAllowed: boolean;
  shadowSellAllowed: boolean;
  shadowLearningAllowed: boolean;
  counterfactualAllowed: boolean;
  diagnosticAllowed: boolean;
  brokerOrderAllowed: boolean;
  shadowAllowed: boolean;
  learningAllowed: boolean;
  executionImpact: ExecutionImpact;
  confidenceAdjustments: string[];
  policyLabels: string[];
  learningLabels: string[];
  scorePenalty: number;
  sizingMultiplier: number;
  providerIssueIsolated: boolean;
  marketSignal: boolean;
  logTags: string[];
  reasonCodes: string[];
}

export interface EngineState {
  engineAlive: boolean;
  runtimePolicy: EngineRuntimePolicy;
  reasonCodes: string[];
}

export interface ResolveEngineRuntimePolicyInput {
  engineMode: EngineMode;
  macroRegime?: string;
  marketSessionState?: string;
  hardBlock?: boolean;
  positionFull?: boolean;
  riskLimitReached?: boolean;
  liveBuyGateAllowed?: boolean;
  liveSellGateAllowed?: boolean;
  brokerOrderAllowed?: boolean;
  operatorOrderAllowed?: boolean;
  realTradingEnabled?: boolean;
  providerIssue?: boolean;
  marketSignal?: boolean;
  kellyFraction?: number | null;
  kellySizingMultiplier?: number | null;
  reasonCodes?: string[];
}

const SHADOW_LEARNING_ALWAYS_ON = {
  shadowBuyAllowed: true,
  shadowSellAllowed: true,
  shadowLearningAllowed: true,
  counterfactualAllowed: true,
  diagnosticAllowed: true,
  shadowAllowed: true,
  learningAllowed: true,
} as const;

function uniqueReasons(reasons: string[] = []): string[] {
  return [...new Set(reasons.filter(Boolean))];
}

const NON_EXECUTION_REGIME_REASON_CODES = new Set([
  'R5_CAUTION',
  'R5_CRISIS',
  'R6_DEFENSE',
  'RISK_OFF',
  'BLACK_SWAN',
  'R6_DEFENSE_SELL_ONLY',
  'SELL_ONLY',
  'AFTERMARKET_SELL_ONLY',
]);

function stripNonExecutionRegimeReasons(reasons: string[] = []): string[] {
  return reasons.filter((reason) => !NON_EXECUTION_REGIME_REASON_CODES.has(reason));
}

export function isEngineMode(value: unknown): value is EngineMode {
  return value === 'NORMAL'
    || value === 'DEGRADED'
    || value === 'SELL_ONLY'
    || value === 'SHADOW_ONLY'
    || value === 'OBSERVE_ONLY';
}

export const EngineModeManager = Object.freeze({
  normalize(value: unknown): EngineMode {
    const raw = String(value ?? '').trim().toUpperCase();
    if (raw === 'SELL_ONLY') return 'NORMAL';
    return isEngineMode(raw) ? raw : 'OBSERVE_ONLY';
  },
});

export const LearningPolicy = Object.freeze({
  resolve(): Pick<EngineRuntimePolicy, 'shadowBuyAllowed' | 'shadowSellAllowed' | 'shadowLearningAllowed' | 'counterfactualAllowed' | 'diagnosticAllowed' | 'shadowAllowed' | 'learningAllowed'> {
    return SHADOW_LEARNING_ALWAYS_ON;
  },
});

function liveEntryPolicyBlocked(input: ResolveEngineRuntimePolicyInput, engineMode: EngineMode): boolean {
  return engineMode === 'SHADOW_ONLY'
    || engineMode === 'OBSERVE_ONLY'
    || input.engineMode === 'SELL_ONLY'
    || input.marketSessionState === 'NON_TRADING_DAY'
    || input.marketSessionState === 'CLOSED'
    || input.hardBlock === true
    || input.positionFull === true
    || input.riskLimitReached === true
    || input.brokerOrderAllowed === false
    || input.operatorOrderAllowed === false
    || input.realTradingEnabled === false;
}

function liveEntryPolicyReasons(input: ResolveEngineRuntimePolicyInput, engineMode: EngineMode): string[] {
  const reasons: string[] = [];
  if (input.engineMode === 'SELL_ONLY') reasons.push('SELL_ONLY_MODE');
  if (engineMode === 'SHADOW_ONLY') reasons.push('SHADOW_ONLY');
  if (engineMode === 'OBSERVE_ONLY') reasons.push('OBSERVE_ONLY');
  if (input.marketSessionState === 'NON_TRADING_DAY') reasons.push('KRX_NON_TRADING_DAY');
  if (input.marketSessionState === 'CLOSED') reasons.push('MARKET_CLOSED');
  if (input.hardBlock === true) reasons.push('HARD_BLOCK');
  if (input.positionFull === true) reasons.push('POSITION_FULL');
  if (input.riskLimitReached === true) reasons.push('RISK_LIMIT');
  if (input.brokerOrderAllowed === false) reasons.push('BROKER_PERMISSION_BLOCK');
  if (input.operatorOrderAllowed === false) reasons.push('OPERATOR_BLOCK');
  if (input.realTradingEnabled === false) reasons.push('REAL_TRADING_DISABLED');
  return reasons;
}

function buildPolicy(input: {
  engineMode: EngineMode;
  liveEntryAllowed: boolean;
  liveExitAllowed: boolean;
  executionImpact: ExecutionImpact;
  reasonCodes: string[];
  permission: ReturnType<typeof resolveExecutionPermission>;
}): EngineRuntimePolicy {
  return {
    engineMode: input.engineMode,
    gateEvaluationAllowed: input.permission.gateEvaluationAllowed,
    diagnosticGateEvaluationAllowed: input.permission.diagnosticGateEvaluationAllowed,
    shadowEvaluationAllowed: input.permission.shadowEvaluationAllowed,
    paperFillAllowed: input.permission.paperFillAllowed,
    liveEntryAllowed: input.liveEntryAllowed,
    liveExitAllowed: input.liveExitAllowed,
    liveBuyAllowed: input.liveEntryAllowed,
    liveSellAllowed: input.liveExitAllowed,
    liveOrderAllowed: input.liveEntryAllowed,
    liveBlockReason: input.liveEntryAllowed
      ? 'NONE'
      : input.permission.liveBlockReason === 'NONE'
        ? 'POLICY_BLOCK'
        : input.permission.liveBlockReason,
    ...LearningPolicy.resolve(),
    brokerOrderAllowed: input.liveEntryAllowed,
    executionImpact: input.executionImpact,
    confidenceAdjustments: input.permission.confidenceAdjustments,
    policyLabels: input.permission.policyLabels,
    learningLabels: input.permission.learningLabels,
    scorePenalty: input.permission.scorePenalty,
    sizingMultiplier: input.permission.sizingMultiplier,
    providerIssueIsolated: input.permission.providerIssueIsolated,
    marketSignal: input.permission.marketSignal,
    logTags: input.permission.logTags,
    reasonCodes: uniqueReasons(input.reasonCodes),
  };
}

export const ExecutionPolicy = Object.freeze({
  resolve(input: ResolveEngineRuntimePolicyInput): EngineRuntimePolicy {
    const engineMode = EngineModeManager.normalize(input.engineMode);
    const permission = resolveExecutionPermission({
      sourceSnapshotId: 'runtime-policy',
      engineMode: input.engineMode,
      operationMode: input.engineMode,
      effectiveRegime: input.macroRegime,
      marketSessionState: input.marketSessionState,
      brokerOrderAllowed: input.brokerOrderAllowed,
      operatorOrderAllowed: input.operatorOrderAllowed,
      realTradingEnabled: input.realTradingEnabled,
      providerIssue: input.providerIssue,
      marketSignal: input.marketSignal,
      kellyFraction: input.kellyFraction,
      kellySizingMultiplier: input.kellySizingMultiplier,
      gateQualityPassed: input.liveBuyGateAllowed !== false,
    });
    const policyReasons = liveEntryPolicyReasons(input, engineMode);
    const reasonCodes = uniqueReasons([
      ...stripNonExecutionRegimeReasons(input.reasonCodes ?? []),
      ...policyReasons,
    ]);
    const blockedByPolicy = liveEntryPolicyBlocked(input, engineMode);

    if (engineMode === 'SHADOW_ONLY') {
      return buildPolicy({
        engineMode,
        liveEntryAllowed: false,
        liveExitAllowed: true,
        executionImpact: 'NONE',
        reasonCodes,
        permission,
      });
    }

    if (engineMode === 'OBSERVE_ONLY') {
      return buildPolicy({
        engineMode,
        liveEntryAllowed: false,
        liveExitAllowed: true,
        executionImpact: 'NONE',
        reasonCodes,
        permission,
      });
    }

    const liveBuyAllowed = input.liveBuyGateAllowed === true && !blockedByPolicy && permission.liveOrderAllowed;
    const liveSellAllowed = input.liveSellGateAllowed !== false;
    return buildPolicy({
      engineMode,
      liveEntryAllowed: liveBuyAllowed,
      liveExitAllowed: liveSellAllowed,
      executionImpact: blockedByPolicy ? 'NEW_BUY_BLOCKED_ONLY' : liveBuyAllowed || liveSellAllowed ? 'LIVE_ORDER_ALLOWED' : 'LIVE_ORDER_BLOCKED',
      reasonCodes,
      permission,
    });
  },
});

export function resolveEngineRuntimePolicy(input: ResolveEngineRuntimePolicyInput): EngineRuntimePolicy {
  return ExecutionPolicy.resolve(input);
}

export function buildEngineState(input: ResolveEngineRuntimePolicyInput & { engineAlive?: boolean }): EngineState {
  const runtimePolicy = resolveEngineRuntimePolicy(input);
  return {
    engineAlive: input.engineAlive ?? true,
    runtimePolicy,
    reasonCodes: runtimePolicy.reasonCodes,
  };
}

export function applyProviderSignalToEngineState(input: {
  current: EngineState;
  providerIssue: boolean;
  reasonCode?: string;
}): EngineState {
  if (!input.providerIssue) return input.current;
  return {
    ...input.current,
    engineAlive: true,
    reasonCodes: uniqueReasons([...input.current.reasonCodes, input.reasonCode ?? 'PROVIDER_ISSUE_ISOLATED']),
  };
}

export function formatEngineRuntimePolicy(policy: EngineRuntimePolicy): string {
  return [
    'Execution Policy:',
    `liveEntryAllowed=${policy.liveEntryAllowed}`,
    `liveExitAllowed=${policy.liveExitAllowed}`,
    `gateEvaluationAllowed=${policy.gateEvaluationAllowed}`,
    `diagnosticGateEvaluationAllowed=${policy.diagnosticGateEvaluationAllowed}`,
    `shadowEvaluationAllowed=${policy.shadowEvaluationAllowed}`,
    `shadowBuyAllowed=${policy.shadowBuyAllowed}`,
    `shadowSellAllowed=${policy.shadowSellAllowed}`,
    `shadowLearningAllowed=${policy.shadowLearningAllowed}`,
    `counterfactualAllowed=${policy.counterfactualAllowed}`,
    `diagnosticAllowed=${policy.diagnosticAllowed}`,
    `brokerOrderAllowed=${policy.brokerOrderAllowed}`,
    `liveBlockReason=${policy.liveBlockReason}`,
    `scorePenalty=${policy.scorePenalty}`,
    `sizingMultiplier=${policy.sizingMultiplier.toFixed(4)}`,
    `providerIssueIsolated=${policy.providerIssueIsolated}`,
    `marketSignal=${policy.marketSignal}`,
    `tags=${policy.logTags.join(',')}`,
    `executionImpact=${policy.executionImpact}`,
    'shadow.executionImpact=NONE',
    'counterfactual.executionImpact=NONE',
  ].join('\n');
}
