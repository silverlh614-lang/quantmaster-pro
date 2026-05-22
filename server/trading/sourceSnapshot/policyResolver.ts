// @responsibility Source Snapshot policy resolver. Decides permissions without mutating gate results.

import type { CommonGateResult } from './commonGateEvaluator.js';

export type PolicyStatus = 'LIVE_ALLOWED' | 'LIVE_BLOCKED_ONLY';
export type SessionOverlay = 'NONE' | 'AFTERMARKET_BUY_BLOCKED' | 'SELL_ONLY_BUY_BLOCKED';

export interface ResolvePolicyInput {
  snapshotId: string;
  commonGateResult: Pick<CommonGateResult, 'snapshotId'> & Partial<Pick<CommonGateResult, 'gateStatus'>> & {
    qualityDecision?: 'PASS' | 'FAIL';
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

export function resolvePolicy(input: ResolvePolicyInput): PolicyResult {
  const marketSession = normalized(input.marketSession) || 'UNKNOWN';
  const effectiveRegime = normalized(input.effectiveRegime);
  const engineMode = normalized(input.engineMode);
  const operationMode = normalized(input.operationMode);
  const displaySession = input.displaySession ? normalized(input.displaySession) : marketSession;

  const legacyIgnoredReasons = [
    isAftermarket(marketSession) || isAftermarket(displaySession)
      ? 'AFTERMARKET_BUY_BLOCK_IGNORED_BY_ROLLBACK'
      : null,
    displaySession.includes('AFTERMARKET_SELL_ONLY')
      ? 'AFTERMARKET_SELL_ONLY_IGNORED_BY_ROLLBACK'
      : null,
    isR6(effectiveRegime) || isR6(engineMode)
      ? 'R6_DEFENSE_IGNORED_BY_ROLLBACK'
      : null,
    operationMode === 'R6_DEFENSE_SELL_ONLY' || operationMode === 'SELL_ONLY'
      ? `${operationMode}_IGNORED_BY_ROLLBACK`
      : null,
    !['R6_DEFENSE_SELL_ONLY', 'SELL_ONLY'].includes(operationMode) && (isSellOnly(marketSession) || isSellOnly(displaySession) || isSellOnly(engineMode))
      ? 'SELL_ONLY_IGNORED_BY_ROLLBACK'
      : null,
  ].filter((reason): reason is string => reason != null);
  const uniqueLegacyIgnoredReasons = Array.from(new Set(legacyIgnoredReasons));

  const qualityPass = input.commonGateResult.qualityDecision
    ? input.commonGateResult.qualityDecision === 'PASS'
    : input.commonGateResult.gateStatus
      ? input.commonGateResult.gateStatus === 'OK'
      : true;
  const liveBuyAllowed = qualityPass;
  const blockReasons = liveBuyAllowed ? [] : (input.commonGateResult.reasons?.length
    ? input.commonGateResult.reasons
    : ['QUALITY_DECISION_FAIL']);

  const result: PolicyResult = {
    snapshotId: input.snapshotId,
    gateSnapshotId: input.commonGateResult.snapshotId,
    policyStatus: liveBuyAllowed ? 'LIVE_ALLOWED' : 'LIVE_BLOCKED_ONLY',
    marketSession,
    displaySession,
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
    legacyIgnoredReasons: uniqueLegacyIgnoredReasons,
    issue: liveBuyAllowed ? null : 'GATE_OR_DATA_QUALITY_BLOCKED',
    action: liveBuyAllowed ? 'NONE' : 'CHECK_GATE_QUALITY',
    executionImpact: liveBuyAllowed ? 'NONE' : 'NEW_BUY_BLOCKED_ONLY',
  };
  if (result.legacyIgnoredReasons.length > 0) {
    console.info(formatLegacyR6SellOnlyIgnoredLog(result, {
      inputEntryBlockMode: operationMode || 'NORMAL',
    }));
  }
  return result;
}

export function formatLegacyR6SellOnlyIgnoredLog(
  policy: Pick<PolicyResult, 'snapshotId' | 'marketSession' | 'displaySession' | 'legacyIgnoredReasons' | 'liveBuyAllowed' | 'realOrderAllowed' | 'shadowSignalAllowed' | 'diagnosticAllowed' | 'counterfactualAllowed'>,
  input: { inputEntryBlockMode: string },
): string {
  return [
    '[LEGACY_R6_SELLONLY_IGNORED]',
    `snapshotId=${policy.snapshotId}`,
    `marketSession=${policy.marketSession}`,
    `displaySession=${policy.displaySession}`,
    `inputEntryBlockMode=${input.inputEntryBlockMode}`,
    `ignoredReasons=${policy.legacyIgnoredReasons.join(',') || 'none'}`,
    `liveBuyAllowed=${policy.liveBuyAllowed}`,
    `realOrderAllowed=${policy.realOrderAllowed}`,
    `shadowSignalAllowed=${policy.shadowSignalAllowed}`,
    `diagnosticAllowed=${policy.diagnosticAllowed}`,
    `counterfactualAllowed=${policy.counterfactualAllowed}`,
    "executionImpact='NONE'",
    "rollback='R6_SELLONLY_DISABLED'",
  ].join(' ');
}

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
    `legacyIgnoredReasons=[${policy.legacyIgnoredReasons.join(',') || 'NONE'}]`,
    ...(policy.issue ? [`issue=${policy.issue}`] : []),
    `action=${policy.action}`,
  ].join(' | ');
}
