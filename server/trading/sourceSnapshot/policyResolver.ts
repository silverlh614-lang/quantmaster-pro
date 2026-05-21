// @responsibility Source Snapshot policy resolver. Decides permissions without mutating gate results.

import type { CommonGateResult } from './commonGateEvaluator.js';

export type PolicyStatus = 'LIVE_ALLOWED' | 'LIVE_BLOCKED_ONLY';
export type SessionOverlay = 'NONE' | 'AFTERMARKET_BUY_BLOCKED' | 'SELL_ONLY_BUY_BLOCKED';

export interface ResolvePolicyInput {
  snapshotId: string;
  commonGateResult: Pick<CommonGateResult, 'snapshotId'>;
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
  shadowAllowed: boolean;
  counterfactualAllowed: boolean;
  blockReasons: string[];
  issue: string | null;
  action: 'NONE' | 'CHECK_SESSION_POLICY';
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
  const r6Blocked = isR6(effectiveRegime);
  const aftermarketBlocked = isAftermarket(marketSession) || isAftermarket(input.displaySession);
  const sellOnlyBlocked = isSellOnly(marketSession) || isSellOnly(input.displaySession) || isSellOnly(engineMode) || isSellOnly(operationMode);
  const displaySession = input.displaySession
    ? normalized(input.displaySession)
    : aftermarketBlocked
      ? 'AFTERMARKET_SELL_ONLY'
      : sellOnlyBlocked
        ? 'SELL_ONLY_POLICY'
        : marketSession;

  const blockReasons = [
    r6Blocked ? 'R6_DEFENSE_SELL_ONLY' : null,
    aftermarketBlocked ? 'AFTERMARKET_BUY_BLOCKED' : null,
    !aftermarketBlocked && sellOnlyBlocked ? 'SELL_ONLY_BUY_BLOCKED' : null,
  ].filter((reason): reason is string => reason != null);

  const liveBuyAllowed = blockReasons.length === 0;
  const sessionOverlay: SessionOverlay = aftermarketBlocked
    ? 'AFTERMARKET_BUY_BLOCKED'
    : sellOnlyBlocked
      ? 'SELL_ONLY_BUY_BLOCKED'
      : 'NONE';

  return {
    snapshotId: input.snapshotId,
    gateSnapshotId: input.commonGateResult.snapshotId,
    policyStatus: liveBuyAllowed ? 'LIVE_ALLOWED' : 'LIVE_BLOCKED_ONLY',
    marketSession,
    displaySession,
    entryBlockMode: r6Blocked && (aftermarketBlocked || sellOnlyBlocked)
      ? 'R6_DEFENSE_SELL_ONLY'
      : r6Blocked
        ? 'R6_DEFENSE'
        : aftermarketBlocked || sellOnlyBlocked
          ? 'SELL_ONLY_OR_AFTERMARKET'
          : 'NONE',
    sessionOverlay,
    liveBuyAllowed,
    liveSellAllowed: true,
    realOrderAllowed: liveBuyAllowed,
    diagnosticAllowed: true,
    shadowAllowed: true,
    counterfactualAllowed: true,
    blockReasons,
    issue: liveBuyAllowed ? null : 'LIVE_BUY_BLOCKED_BUT_SHADOW_ALLOWED',
    action: liveBuyAllowed ? 'NONE' : 'CHECK_SESSION_POLICY',
    executionImpact: liveBuyAllowed ? 'NONE' : 'NEW_BUY_BLOCKED_ONLY',
  };
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
    `shadowAllowed=${policy.shadowAllowed}`,
    `counterfactualAllowed=${policy.counterfactualAllowed}`,
    `reason=[${policy.blockReasons.join(',') || 'NONE'}]`,
    ...(policy.issue ? [`issue=${policy.issue}`] : []),
    `action=${policy.action}`,
  ].join(' | ');
}
