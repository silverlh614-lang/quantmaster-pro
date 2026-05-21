import type { CandidateSnapshot, FeatureSnapshot, MarketSession, UnifiedMarketSnapshot } from './ssotSnapshot.js';

export interface CommonGateResult { snapshotId: string; symbol: string; gatePassed: boolean; technicalTrendMissing: boolean; }
export interface PolicyResult { snapshotId: string; marketSession: MarketSession; liveBuyAllowed: boolean; realOrderAllowed: boolean; shadowLearningAllowed: boolean; counterfactualAllowed: boolean; entryBlockMode: string; }
export interface ExecutionResult { snapshotId: string; executionImpact: 'NONE' | 'NEW_BUY_BLOCKED_ONLY' | 'LIVE_ORDER_ALLOWED'; }
export interface LearningResult { snapshotId: string; shadowLearning: boolean; counterfactual: boolean; }
export interface DecisionContext { snapshotId: string; candidateSnapshotId: string; featureSnapshotId: string; gateResult: CommonGateResult; policyResult: PolicyResult; executionResult: ExecutionResult; learningResult: LearningResult; }

export function evaluateCommonGate(input: { snapshotId: string; candidate: CandidateSnapshot; feature: FeatureSnapshot }): CommonGateResult {
  const technicalTrendMissing = input.feature.technicalIndicators.status !== 'COMPUTED';
  return { snapshotId: input.snapshotId, symbol: input.candidate.symbol, gatePassed: Boolean(input.feature.quote), technicalTrendMissing };
}

export function resolvePolicy(input: { snapshotId: string; marketSession: MarketSession; entryBlockMode: string }): PolicyResult {
  const liveBuyAllowed = input.entryBlockMode === 'NORMAL' && input.marketSession === 'REGULAR';
  return { snapshotId: input.snapshotId, marketSession: input.marketSession, liveBuyAllowed, realOrderAllowed: liveBuyAllowed, shadowLearningAllowed: true, counterfactualAllowed: true, entryBlockMode: input.entryBlockMode };
}

export function routeExecution(input: { snapshotId: string; gateResult: CommonGateResult; policyResult: PolicyResult }): ExecutionResult {
  if (!input.policyResult.liveBuyAllowed) return { snapshotId: input.snapshotId, executionImpact: 'NEW_BUY_BLOCKED_ONLY' };
  return { snapshotId: input.snapshotId, executionImpact: input.gateResult.gatePassed ? 'LIVE_ORDER_ALLOWED' : 'NONE' };
}

export function buildDecisionContext(snapshot: UnifiedMarketSnapshot, candidate: CandidateSnapshot, feature: FeatureSnapshot, marketSession: MarketSession, entryBlockMode: string): DecisionContext {
  const gateResult = evaluateCommonGate({ snapshotId: snapshot.snapshotId, candidate, feature });
  const policyResult = resolvePolicy({ snapshotId: snapshot.snapshotId, marketSession, entryBlockMode });
  const executionResult = routeExecution({ snapshotId: snapshot.snapshotId, gateResult, policyResult });
  const learningResult = { snapshotId: snapshot.snapshotId, shadowLearning: policyResult.shadowLearningAllowed, counterfactual: policyResult.counterfactualAllowed };
  return {
    snapshotId: snapshot.snapshotId,
    candidateSnapshotId: candidate.snapshotId,
    featureSnapshotId: feature.snapshotId,
    gateResult,
    policyResult,
    executionResult,
    learningResult,
  };
}

export function detectSnapshotMismatch(input: { gateResult: CommonGateResult; policyResult: PolicyResult; telegramSnapshotId?: string; feature?: FeatureSnapshot }): string[] {
  const alerts: string[] = [];
  if (input.gateResult.snapshotId !== input.policyResult.snapshotId) alerts.push('SNAPSHOT_MISMATCH_GATE_POLICY');
  if (input.telegramSnapshotId && input.telegramSnapshotId !== input.gateResult.snapshotId) alerts.push('SNAPSHOT_MISMATCH_GATE_TELEGRAM');
  if (input.feature?.technicalIndicators.status === 'COMPUTED' && input.gateResult.technicalTrendMissing) alerts.push('FEATURE_COMPUTED_BUT_GATE_MAPPING_DROPPED');
  return alerts;
}
