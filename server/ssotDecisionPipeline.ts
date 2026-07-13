/**
 * @responsibility SSOT 결정 파이프라인 — 단일 스냅샷에서 게이트·정책·실행·학습 결정을 순차 도출한다.
 */

import type { CandidateSnapshot, FeatureSnapshot, MarketSession, UnifiedMarketSnapshot } from './ssotSnapshot.js';
import {
  resolveExecutionPermission,
  type ExecutionPermissionLiveBlockReason,
} from './runtime/executionPermissionResolver.js';

export interface CommonGateResult { snapshotId: string; symbol: string; gatePassed: boolean; technicalTrendMissing: boolean; qualityDecision: 'PASS' | 'FAIL'; }
export interface PolicyResult {
  snapshotId: string;
  marketSession: MarketSession;
  liveBuyAllowed: boolean;
  realOrderAllowed: boolean;
  gatePolicyLiveAllowed: boolean;
  macroLiveAllowed: boolean;
  engineMode: 'LIVE' | 'SHADOW_ONLY';
  brokerOrderAllowed: boolean;
  operatorOrderAllowed: boolean;
  actualLiveOrderAllowed: boolean;
  liveBlockReason: ExecutionPermissionLiveBlockReason;
  gateEvaluationAllowed: true;
  diagnosticGateEvaluationAllowed: true;
  shadowEvaluationAllowed: true;
  shadowOrderAllowed: true;
  paperFillAllowed: true;
  liveOrderAllowed: boolean;
  shadowAllowed: boolean;
  shadowLearningAllowed: boolean;
  shadowSignalAllowed: boolean;
  diagnosticAllowed: boolean;
  counterfactualAllowed: boolean;
  entryBlockMode: string;
  blockReasons: string[];
  legacyPolicyInputs: string[];
  legacyPolicyIgnored: true;
  legacyIgnoredReasons: string[];
  confidenceAdjustments: string[];
  policyLabels: string[];
  learningLabels: string[];
  scorePenalty: number;
  sizingMultiplier: number;
  providerIssueIsolated: boolean;
  marketSignal: boolean;
  executionPermissionLogTags: string[];
  policyStatus: 'LIVE_ALLOWED' | 'LIVE_BLOCKED_ONLY';
}
interface ExecutionResult { snapshotId: string; executionImpact: 'NONE' | 'NEW_BUY_BLOCKED_ONLY' | 'LIVE_ORDER_ALLOWED'; }
interface LearningResult { snapshotId: string; shadowLearning: boolean; counterfactual: boolean; }
export interface DecisionContext { snapshotId: string; candidateSnapshotId: string; featureSnapshotId: string; gateResult: CommonGateResult; policyResult: PolicyResult; executionResult: ExecutionResult; learningResult: LearningResult; }

function isFeaturePackComputed(feature: FeatureSnapshot): boolean {
  return feature.featurePack?.status === 'COMPUTED';
}

export function evaluateCommonGate(input: { snapshotId: string; candidate: CandidateSnapshot; feature: FeatureSnapshot }): CommonGateResult {
  const technicalTrendMissing = !(isFeaturePackComputed(input.feature) || input.feature.technicalIndicators.status === 'COMPUTED');
  const gatePassed = Boolean(input.feature.quote);
  return { snapshotId: input.snapshotId, symbol: input.candidate.symbol, gatePassed, technicalTrendMissing, qualityDecision: gatePassed ? 'PASS' : 'FAIL' };
}

function resolvePolicy(input: { snapshotId: string; commonGateResult: CommonGateResult; marketSession: MarketSession; entryBlockMode: string; engineMode?: 'LIVE' | 'SHADOW_ONLY'; brokerOrderAllowed?: boolean; operatorOrderAllowed?: boolean; macroLiveAllowed?: boolean; providerIssue?: boolean; marketSignal?: boolean; kellyFraction?: number | null; kellySizingMultiplier?: number | null }): PolicyResult {
  const legacyPolicyInputs: string[] = [];
  const liveBuyAllowed = input.commonGateResult.qualityDecision === 'PASS';
  const gatePolicyLiveAllowed = liveBuyAllowed;
  const engineMode = input.engineMode ?? 'LIVE';
  const macroLiveAllowed = input.macroLiveAllowed ?? true;
  const brokerOrderAllowed = input.brokerOrderAllowed ?? true;
  const operatorOrderAllowed = input.operatorOrderAllowed ?? true;
  const executionPermission = resolveExecutionPermission({
    sourceSnapshotId: input.snapshotId,
    engineMode,
    operationMode: input.entryBlockMode,
    gateQualityPassed: gatePolicyLiveAllowed && macroLiveAllowed,
    brokerOrderAllowed,
    operatorOrderAllowed,
    providerIssue: input.providerIssue,
    marketSignal: input.marketSignal,
    kellyFraction: input.kellyFraction,
    kellySizingMultiplier: input.kellySizingMultiplier,
  });
  const actualLiveOrderAllowed = gatePolicyLiveAllowed
    && macroLiveAllowed
    && engineMode !== 'SHADOW_ONLY'
    && brokerOrderAllowed
    && operatorOrderAllowed
    && executionPermission.liveOrderAllowed;
  const liveBlockReason: PolicyResult['liveBlockReason'] = actualLiveOrderAllowed
    ? 'NONE'
    : executionPermission.liveBlockReason === 'NONE'
      ? 'POLICY_BLOCK'
      : executionPermission.liveBlockReason;
  const uniqueLegacyPolicyInputs = Array.from(new Set(legacyPolicyInputs));
  return {
    snapshotId: input.snapshotId,
    marketSession: input.marketSession,
    liveBuyAllowed,
    realOrderAllowed: actualLiveOrderAllowed,
    gatePolicyLiveAllowed,
    macroLiveAllowed,
    engineMode,
    brokerOrderAllowed,
    operatorOrderAllowed,
    actualLiveOrderAllowed,
    liveBlockReason,
    gateEvaluationAllowed: executionPermission.gateEvaluationAllowed,
    diagnosticGateEvaluationAllowed: executionPermission.diagnosticGateEvaluationAllowed,
    shadowEvaluationAllowed: executionPermission.shadowEvaluationAllowed,
    shadowOrderAllowed: executionPermission.shadowOrderAllowed,
    paperFillAllowed: executionPermission.paperFillAllowed,
    liveOrderAllowed: actualLiveOrderAllowed,
    shadowAllowed: true,
    shadowLearningAllowed: true,
    shadowSignalAllowed: true,
    diagnosticAllowed: true,
    counterfactualAllowed: true,
    entryBlockMode: 'NORMAL',
    blockReasons: liveBuyAllowed ? [] : ['COMMON_GATE_QUALITY_FAIL'],
    legacyPolicyInputs: uniqueLegacyPolicyInputs,
    legacyPolicyIgnored: true,
    legacyIgnoredReasons: uniqueLegacyPolicyInputs,
    confidenceAdjustments: executionPermission.confidenceAdjustments,
    policyLabels: executionPermission.policyLabels,
    learningLabels: executionPermission.learningLabels,
    scorePenalty: executionPermission.scorePenalty,
    sizingMultiplier: executionPermission.sizingMultiplier,
    providerIssueIsolated: executionPermission.providerIssueIsolated,
    marketSignal: executionPermission.marketSignal,
    executionPermissionLogTags: executionPermission.logTags,
    policyStatus: liveBuyAllowed ? 'LIVE_ALLOWED' : 'LIVE_BLOCKED_ONLY',
  };
}

function routeExecution(input: { snapshotId: string; gateResult: CommonGateResult; policyResult: PolicyResult }): ExecutionResult {
  if (!input.policyResult.liveBuyAllowed) return { snapshotId: input.snapshotId, executionImpact: 'NEW_BUY_BLOCKED_ONLY' };
  if (!input.policyResult.actualLiveOrderAllowed) return { snapshotId: input.snapshotId, executionImpact: 'NEW_BUY_BLOCKED_ONLY' };
  return { snapshotId: input.snapshotId, executionImpact: input.gateResult.gatePassed ? 'LIVE_ORDER_ALLOWED' : 'NONE' };
}

export function buildDecisionContext(snapshot: UnifiedMarketSnapshot, candidate: CandidateSnapshot, feature: FeatureSnapshot, marketSession: MarketSession, entryBlockMode: string, runtime?: { engineMode?: 'LIVE' | 'SHADOW_ONLY'; brokerOrderAllowed?: boolean; operatorOrderAllowed?: boolean; macroLiveAllowed?: boolean }): DecisionContext {
  const gateResult = evaluateCommonGate({ snapshotId: snapshot.snapshotId, candidate, feature });
  const policyResult = resolvePolicy({ snapshotId: snapshot.snapshotId, commonGateResult: gateResult, marketSession, entryBlockMode, ...runtime });
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
  if ((input.feature?.technicalIndicators.status === 'COMPUTED' || input.feature?.featurePack?.status === 'COMPUTED') && input.gateResult.technicalTrendMissing) {
    alerts.push('FEATURE_SNAPSHOT_PRESENT_BUT_GATE_MAPPING_DROPPED');
  }
  return alerts;
}
