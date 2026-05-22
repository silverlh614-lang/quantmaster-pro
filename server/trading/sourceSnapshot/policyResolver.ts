// @responsibility Source Snapshot policy resolver. Decides permissions without mutating gate results.

import type { CommonGateResult } from './commonGateEvaluator.js';

export type PolicyStatus = 'LIVE_ALLOWED' | 'LIVE_BLOCKED_ONLY';
export type SessionOverlay = 'NONE' | 'AFTERMARKET_BUY_BLOCKED' | 'SELL_ONLY_BUY_BLOCKED';

export interface ResolvePolicyInput {
  snapshotId: string;
  commonGateResult: Pick<CommonGateResult, 'snapshotId'> & Partial<Pick<CommonGateResult, 'gateStatus'>> & {
    qualityDecision?: 'PASS' | 'FAIL' | 'TRADE_READY' | 'WATCH_READY' | 'DATA_INCOMPLETE' | 'ORDER_NOT_READY';
    reasons?: string[];
  };
  marketSession: string;
  displaySession?: string;
  effectiveRegime?: string;
  engineMode?: string;
  operationMode?: string;
}

export interface PolicyResult {
  snapshotId: string;
  policyStatus: PolicyStatus;
  marketSession: string;
  displaySession: string;
  entryBlockMode: string;
  sessionOverlay: SessionOverlay;
  liveBuyAllowed: boolean;
  liveSellAllowed: boolean;
  realOrderAllowed: boolean;
  diagnosticAllowed: boolean;
  shadowSignalAllowed: boolean;
  shadowAllowed: boolean;
  counterfactualAllowed: boolean;
  blockReasons: string[];
  legacyPolicyInputs: string[];
  legacyPolicyIgnored: true;
  legacyIgnoredReasons: string[];
  issue: string | null;
  action: 'NONE' | 'CHECK_GATE_QUALITY';
  executionImpact: 'NONE' | 'NEW_BUY_BLOCKED_ONLY';
  gateSnapshotId: string;
}

function normalized(value: string | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

function isR6(value: string | undefined): boolean {
  return normalized(value) === 'R6_DEFENSE' || normalized(value).includes('R6_DEFENSE');
}

function isSellOnly(value: string | undefined): boolean {
  const raw = normalized(value);
  return raw === 'SELL_ONLY' || raw.includes('SELL_ONLY');
}

function isAftermarket(value: string | undefined): boolean {
  const raw = normalized(value);
  return raw === 'AFTERMARKET' || raw === 'AFTER_MARKET' || raw.includes('AFTERMARKET') || raw.includes('AFTER_MARKET');
}

function buildLegacyPolicyInputs(input: {
  displaySession: string;
  effectiveRegime: string;
  engineMode: string;
  operationMode: string;
}): string[] {
  const legacyPolicyInputs = [
    input.displaySession.includes('AFTERMARKET_SELL_ONLY')
      ? 'AFTERMARKET_SELL_ONLY_REMOVED'
      : null,
    input.operationMode === 'SELL_ONLY' || isSellOnly(input.engineMode)
      ? 'SELL_ONLY_REMOVED'
      : null,
    input.operationMode === 'R6_DEFENSE_SELL_ONLY'
      ? 'R6_DEFENSE_SELL_ONLY_REMOVED'
      : null,
    isR6(input.effectiveRegime) || isR6(input.engineMode)
      ? 'R6_DEFENSE_REMOVED'
      : null,
  ].filter((reason): reason is string => reason != null);
  return Array.from(new Set(legacyPolicyInputs));
}

function formatPolicyInputsForDiagnostic(legacyPolicyInputs: string[]): string {
  return legacyPolicyInputs.length > 0 ? 'LEGACY_DEFENSE_POLICY_REMOVED' : 'NONE';
}

function formatRemovedPoliciesForLog(legacyPolicyInputs: string[]): string {
  const labels = legacyPolicyInputs.map((input) => {
    if (input === 'AFTERMARKET_SELL_ONLY_REMOVED') return 'AFTERMARKET_SELL_ONLY';
    if (input === 'SELL_ONLY_REMOVED') return 'SELL_ONLY';
    if (input === 'R6_DEFENSE_SELL_ONLY_REMOVED') return 'R6_DEFENSE_SELL_ONLY';
    if (input === 'R6_DEFENSE_REMOVED') return 'R6_DEFENSE';
    return input;
  });
  return labels.join(',') || 'none';
}

export function resolvePolicy(input: ResolvePolicyInput): PolicyResult {
  const marketSession = normalized(input.marketSession) || 'UNKNOWN';
  const effectiveRegime = normalized(input.effectiveRegime);
  const engineMode = normalized(input.engineMode);
  const operationMode = normalized(input.operationMode);
  const inputDisplaySession = input.displaySession ? normalized(input.displaySession) : marketSession;
  const legacyPolicyInputs = buildLegacyPolicyInputs({
    displaySession: inputDisplaySession,
    effectiveRegime,
    engineMode,
    operationMode,
  });

  const qualityPass = input.commonGateResult.qualityDecision
    ? input.commonGateResult.qualityDecision === 'PASS' ||
      input.commonGateResult.qualityDecision === 'TRADE_READY' ||
      input.commonGateResult.qualityDecision === 'WATCH_READY'
    : input.commonGateResult.gateStatus
      ? input.commonGateResult.gateStatus === 'OK' || input.commonGateResult.gateStatus === 'WARN'
      : true;
  const liveBuyAllowed = qualityPass;
  const blockReasons = liveBuyAllowed ? [] : ['COMMON_GATE_QUALITY_FAIL'];

  const result: PolicyResult = {
    snapshotId: input.snapshotId,
    gateSnapshotId: input.commonGateResult.snapshotId,
    policyStatus: liveBuyAllowed ? 'LIVE_ALLOWED' : 'LIVE_BLOCKED_ONLY',
    marketSession,
    displaySession: 'REGULAR',
    entryBlockMode: 'NORMAL',
    sessionOverlay: 'NONE',
    liveBuyAllowed,
    liveSellAllowed: true,
    realOrderAllowed: liveBuyAllowed,
    diagnosticAllowed: true,
    shadowSignalAllowed: true,
    shadowAllowed: true,
    counterfactualAllowed: true,
    blockReasons,
    legacyPolicyInputs,
    legacyPolicyIgnored: true,
    legacyIgnoredReasons: legacyPolicyInputs,
    issue: liveBuyAllowed ? null : 'GATE_OR_DATA_QUALITY_BLOCKED',
    action: liveBuyAllowed ? 'NONE' : 'CHECK_GATE_QUALITY',
    executionImpact: liveBuyAllowed ? 'NONE' : 'NEW_BUY_BLOCKED_ONLY',
  };
  if (result.legacyPolicyInputs.length > 0) {
    console.info(formatRemovedPolicyInputIgnoredLog(result, {
      inputDisplaySession,
      inputEntryBlockMode: operationMode || 'NORMAL',
    }));
  }
  return result;
}

export function formatRemovedPolicyInputIgnoredLog(
  policy: Pick<PolicyResult, 'snapshotId' | 'marketSession' | 'legacyPolicyInputs' | 'liveBuyAllowed' | 'realOrderAllowed' | 'shadowSignalAllowed' | 'diagnosticAllowed' | 'counterfactualAllowed'>,
  input: { inputDisplaySession: string; inputEntryBlockMode: string },
): string {
  return [
    '[REMOVED_POLICY_INPUT_IGNORED]',
    `snapshotId=${policy.snapshotId}`,
    `marketSession=${policy.marketSession}`,
    `inputDisplaySession=${input.inputDisplaySession}`,
    `inputEntryBlockMode=${input.inputEntryBlockMode}`,
    `removedPolicies=${formatRemovedPoliciesForLog(policy.legacyPolicyInputs)}`,
    `liveBuyAllowed=${policy.liveBuyAllowed}`,
    `realOrderAllowed=${policy.realOrderAllowed}`,
    `shadowSignalAllowed=${policy.shadowSignalAllowed}`,
    `diagnosticAllowed=${policy.diagnosticAllowed}`,
    `counterfactualAllowed=${policy.counterfactualAllowed}`,
    "executionImpact='NONE'",
    "rollback='SELL_ONLY_AND_R6_EXECUTION_DISABLED'",
  ].join(' ');
}

export const formatLegacyR6SellOnlyIgnoredLog = formatRemovedPolicyInputIgnoredLog;

export function formatPolicyDiag(policy: PolicyResult): string {
  return [
    policy.policyStatus,
    `marketSession=${policy.marketSession}`,
    `displaySession=${policy.displaySession}`,
    `entryBlockMode=${policy.entryBlockMode}`,
    `sessionOverlay=${policy.sessionOverlay}`,
    `liveBuyAllowed=${policy.liveBuyAllowed}`,
    `realOrderAllowed=${policy.realOrderAllowed}`,
    `diagnosticAllowed=${policy.diagnosticAllowed}`,
    `shadowSignalAllowed=${policy.shadowSignalAllowed}`,
    `shadowAllowed=${policy.shadowAllowed}`,
    `counterfactualAllowed=${policy.counterfactualAllowed}`,
    `reason=[${policy.blockReasons.join(',') || 'NONE'}]`,
    `legacyPolicyIgnored=${policy.legacyPolicyIgnored}`,
    `legacyPolicyInputs=[${formatPolicyInputsForDiagnostic(policy.legacyPolicyInputs)}]`,
    ...(policy.issue ? [`issue=${policy.issue}`] : []),
    `action=${policy.action}`,
  ].join(' | ');
}
