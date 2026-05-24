// @responsibility Gate evaluation result contracts + final decision resolver. No order/broker imports.

import type { DataConfidence } from '../../data/dataConfidenceRouter.js';
import type { EngineRuntimePolicy } from '../../runtime/engineRuntimePolicy.js';
import type { ConvictionLabel } from './simpleDecision.js';

export interface EvidenceItem {
  key: string;
  value: unknown;
  source?: string;
}

export interface GateResult {
  gateName: string;
  passed: boolean;
  score: number;
  maxScore: number;
  confidence: DataConfidence;
  blockers: string[];
  warnings: string[];
  evidence: EvidenceItem[];
  hardFail?: boolean;
  executionImpact?: 'NONE' | 'DATA_REQUIRED_MISSING' | 'ORDER_WAIT';
}

export type FinalDecision = 'BUY' | 'HOLD' | 'BLOCK' | 'SELL_ONLY_ALLOWED';

export interface FinalDecisionResolverInput {
  runtimePolicy: EngineRuntimePolicy;
  gateResults: GateResult[];
  requestedDecision: 'STRONG_BUY' | 'BUY' | 'HOLD';
  enemyWarningCount?: number;
}

export interface FinalDecisionResolverOutput {
  decision: FinalDecision;
  liveBuyAllowed: boolean;
  liveSellAllowed: boolean;
  shadowAllowed: boolean;
  learningAllowed: boolean;
  downgraded: boolean;
  blockers: string[];
  warnings: string[];
  reasonCodes: string[];
  convictionLabel: ConvictionLabel;
  strongBuyAsLabelOnly: true;
  ignoredLegacyStrongBuyBlockers: string[];
}

function getGate(input: FinalDecisionResolverInput, gateName: string): GateResult | undefined {
  return input.gateResults.find((gate) => gate.gateName === gateName);
}

function collect<T>(items: T[][]): T[] {
  return items.flat();
}

const ALLOWED_GATE_HARD_FAIL_REASONS = new Set([
  'PRICE_MISSING',
  'CURRENT_PRICE_MISSING',
  'PRICE_SNAPSHOT_MISSING',
  'TRADABLE_FALSE',
  'HALTED',
  'SUSPENDED',
  'MANAGEMENT_ISSUE',
  'ORDER_UNAVAILABLE',
  'VOLUME_MISSING',
  'LIQUIDITY_FAIL_NO_RELIABLE_QUOTE',
  'TRADE_PLAN_INVALID',
  'ENTRY_PRICE_INVALID',
  'STOP_LOSS_INVALID',
  'TARGET_INVALID',
  'RR_UNCALCULABLE',
  'SLOT_FULL',
]);

function isAllowedHardFailGate(gate: GateResult | undefined): boolean {
  if (!gate) return false;
  if (gate.hardFail === true) return true;
  return gate.blockers.some((blocker) => ALLOWED_GATE_HARD_FAIL_REASONS.has(blocker));
}

export type GateName =
  | 'Gate0Macro'
  | 'Gate1Survival'
  | 'Gate2Growth'
  | 'Gate3Timing'
  | 'EnemyChecklist';

export function asGateResult(gateName: GateName, result: GateResult): GateResult {
  return { ...result, gateName };
}

export const EnemyChecklistEvaluator = Object.freeze({
  warningCount(result: GateResult): number { return result.warnings.length; },
});

export const ConfluenceEvaluator = Object.freeze({
  passed(results: GateResult[]): boolean { return results.every((result) => result.passed); },
});

export const FinalDecisionResolver = Object.freeze({
  resolve(input: FinalDecisionResolverInput): FinalDecisionResolverOutput {
    const blockers = collect(input.gateResults.map((gate) => gate.blockers));
    const warnings = collect(input.gateResults.map((gate) => gate.warnings));
    const reasonCodes = [...new Set([...input.runtimePolicy.reasonCodes, ...blockers])];
    const gate1 = getGate(input, 'Gate1Survival');
    const requestedBuyDecision = input.requestedDecision === 'HOLD' ? 'HOLD' : 'BUY';
    const convictionLabel: ConvictionLabel =
      input.requestedDecision === 'STRONG_BUY' ? 'HIGH_CONVICTION'
      : input.requestedDecision === 'BUY' ? 'BUY'
      : 'WATCH';
    const ignoredLegacyStrongBuyBlockers =
      input.requestedDecision === 'STRONG_BUY' && (input.enemyWarningCount ?? 0) >= 2
        ? ['ENEMY_CHECKLIST_STRONG_BUY_DOWNGRADE']
        : [];

    if (!input.runtimePolicy.liveBuyAllowed) {
      return {
        decision: 'BLOCK',
        liveBuyAllowed: false,
        liveSellAllowed: input.runtimePolicy.liveSellAllowed,
        shadowAllowed: input.runtimePolicy.shadowAllowed,
        learningAllowed: input.runtimePolicy.learningAllowed,
        downgraded: input.requestedDecision !== 'HOLD',
        blockers,
        warnings,
        reasonCodes,
        convictionLabel,
        strongBuyAsLabelOnly: true,
        ignoredLegacyStrongBuyBlockers,
      };
    }

    if (gate1 && !gate1.passed && isAllowedHardFailGate(gate1)) {
      return {
        decision: 'HOLD',
        liveBuyAllowed: false,
        liveSellAllowed: input.runtimePolicy.liveSellAllowed,
        shadowAllowed: input.runtimePolicy.shadowAllowed,
        learningAllowed: input.runtimePolicy.learningAllowed,
        downgraded: input.requestedDecision === 'BUY' || input.requestedDecision === 'STRONG_BUY',
        blockers: [...blockers, 'GATE1_SURVIVAL_FAILED'],
        warnings,
        reasonCodes: [...new Set([...reasonCodes, 'GATE1_SURVIVAL_FAILED'])],
        convictionLabel,
        strongBuyAsLabelOnly: true,
        ignoredLegacyStrongBuyBlockers,
      };
    }

    return {
      decision: requestedBuyDecision,
      liveBuyAllowed: input.requestedDecision !== 'HOLD',
      liveSellAllowed: input.runtimePolicy.liveSellAllowed,
      shadowAllowed: input.runtimePolicy.shadowAllowed,
      learningAllowed: input.runtimePolicy.learningAllowed,
      downgraded: false,
      blockers,
      warnings,
      reasonCodes,
      convictionLabel,
      strongBuyAsLabelOnly: true,
      ignoredLegacyStrongBuyBlockers,
    };
  },
});

export function resolveFinalDecision(input: FinalDecisionResolverInput): FinalDecisionResolverOutput {
  return FinalDecisionResolver.resolve(input);
}

export type FinalDecisionEngineMode =
  | 'NORMAL'
  | 'DEGRADED'
  | 'SELL_ONLY'
  | 'SHADOW_ONLY'
  | 'OBSERVE_ONLY';

export type FinalDecisionMarketSession =
  | 'REGULAR'
  | 'PRE_MARKET'
  | 'POST_MARKET'
  | 'HOLIDAY'
  | 'LUNCH'
  | 'UNKNOWN';

export type FinalDecisionEffectiveRegime =
  | 'GREEN'
  | 'YELLOW'
  | 'RED'
  | 'R6_DEFENSE'
  | 'R5_STABILIZING'
  | 'UNKNOWN';

export type FinalDecisionEntryTimingSignal =
  | 'ENTRY_READY'
  | 'WAIT_TRIGGER'
  | 'WATCH_SETUP'
  | 'DO_NOT_ENTER'
  | 'DATA_INCOMPLETE';

export type FinalDecisionProviderHealthStatus = 'VERIFIED' | 'DEGRADED' | 'STALE' | 'MISSING';
export type FinalDecisionDataConfidenceCeiling = 'HIGH' | 'MEDIUM' | 'LOW';
export type FinalDecisionShadowMode = 'NORMAL' | 'SHADOW_ONLY' | 'OBSERVE_ONLY';
export type FinalDecisionRequestedSide = 'BUY' | 'SELL' | 'NONE';

export interface FinalDecisionResolverRuntimeInput {
  sourceSnapshotId: string;
  symbol: string;
  asOf?: string;
  gate1Status: string;
  gate2Status: string;
  gate3Readiness: string;
  entryTimingSignal: FinalDecisionEntryTimingSignal;
  engineMode: FinalDecisionEngineMode;
  marketSession: FinalDecisionMarketSession;
  effectiveRegime: FinalDecisionEffectiveRegime;
  riskOverride?: 'R6_DEFENSE' | 'BLACK_SWAN' | 'NONE';
  providerHealth: {
    quote: FinalDecisionProviderHealthStatus;
    supply: FinalDecisionProviderHealthStatus;
    dart: FinalDecisionProviderHealthStatus;
    macro: FinalDecisionProviderHealthStatus;
  };
  dataConfidenceCeiling: FinalDecisionDataConfidenceCeiling;
  marketSignal: boolean;
  providerIssue: boolean;
  shadowMode: FinalDecisionShadowMode;
  requestedSide: FinalDecisionRequestedSide;
  currentPositionState?: 'NONE' | 'OPEN' | 'PENDING' | 'CLOSED';
  isDiagnosticOnly: boolean;
}

export type ExecutionPermissionFinalAction =
  | 'LIVE_BUY_ALLOWED'
  | 'LIVE_SELL_ALLOWED'
  | 'SHADOW_BUY_ALLOWED'
  | 'SHADOW_SELL_ALLOWED'
  | 'OBSERVE_ONLY'
  | 'WAIT'
  | 'BLOCKED'
  | 'NO_ACTION';

export type FinalDecisionExecutionImpact =
  | 'NONE'
  | 'LIVE_BUY_BLOCKED'
  | 'LIVE_SELL_BLOCKED'
  | 'LIVE_ALL_BLOCKED'
  | 'ORDER_BLOCKED_DIAGNOSTIC_ONLY';

export type FinalDecisionConfidenceAdjustment =
  | 'NONE'
  | 'DOWNGRADE_LOW'
  | 'DOWNGRADE_MEDIUM'
  | 'POLICY_BLOCK_ONLY';

export type BlockedDecisionLearningTag =
  | 'CASE_ENTRY_READY_LIVE_BLOCKED_SELL_ONLY'
  | 'CASE_ENTRY_READY_LIVE_BLOCKED_R6'
  | 'CASE_ENTRY_READY_OBSERVE_ONLY'
  | 'CASE_DATA_INCOMPLETE_BLOCKED'
  | 'CASE_PROVIDER_DEGRADED_CONFIDENCE_DOWNGRADE'
  | 'CASE_DIAGNOSTIC_ONLY_ORDER_BLOCKED';

export interface BlockedDecisionLearningCase {
  timestamp: string;
  sourceSnapshotId: string;
  symbol: string;
  gate1Status: string;
  gate2Status: string;
  gate3Readiness: string;
  entryTimingSignal: string;
  engineMode: string;
  marketSession: string;
  effectiveRegime: string;
  requestedSide: string;
  blockReasons: string[];
  finalAction: string;
  executionImpact: string;
  expectedDecision: string;
  actualDecision: string;
  learningTag: BlockedDecisionLearningTag;
}

export interface ExecutionPermissionDecision {
  sourceSnapshotId: string;
  symbol: string;
  correlationId: string;
  finalAction: ExecutionPermissionFinalAction;
  liveBuyAllowed: boolean;
  liveSellAllowed: boolean;
  shadowBuyAllowed: boolean;
  shadowSellAllowed: boolean;
  observeOnly: boolean;
  orderAllowed: boolean;
  brokerOrderAllowed: boolean;
  paperOrderAllowed: boolean;
  executionImpact: FinalDecisionExecutionImpact;
  blockReasons: string[];
  advisoryReasons: string[];
  confidenceAdjustment: FinalDecisionConfidenceAdjustment;
  learningAllowed: true;
  shadowLearning: true;
  counterfactualAllowed: true;
  counterfactualRecorded: boolean;
  decisionTrace: {
    gateDecision: string;
    policyDecision: string;
    sessionDecision: string;
    providerDecision: string;
    finalDecision: string;
    runtimeTrace: string[];
  };
  livePermissionNotEvaluatedInGate3: true;
  marketSignal: false;
  providerIssueSeparated: boolean;
  blockedLearningCase: BlockedDecisionLearningCase | null;
}

export interface FinalDecisionRuntimeAuditSummary {
  sourceSnapshotId: string;
  evaluated: number;
  entryReady: number;
  liveBuyAllowed: number;
  liveBuyBlocked: number;
  shadowBuyAllowed: number;
  observeOnly: number;
  wait: number;
  blocked: number;
  providerIssueSeparated: number;
  providerIssueConvertedToMarketSignalCount: 0;
  diagnosticOnlyBlocked: number;
  shadowLearningSuppressedCount: 0;
  counterfactualRecorded: number;
  entryReadyButLiveBlockedCount: number;
  entryReadyShadowAllowedCount: number;
  entryReadyObserveOnlyCount: number;
  gate3LivePermissionLeakDetected: number;
  lastTriggerDirectOrderLeakDetected: number;
  diagnosticOnlyBrokerOrderLeakDetected: number;
  blockedBuyRecordedAsLearningCaseCount: number;
  executionImpactDistribution: Record<string, number>;
  blockReasonDistribution: Record<string, number>;
  policyMatrixDistribution: Record<string, number>;
  gate3TransitionDistribution: Record<string, number>;
  decisions: ExecutionPermissionDecision[];
  shadowLearning: 'ON';
}

function isR6Runtime(input: FinalDecisionResolverRuntimeInput): boolean {
  return input.riskOverride === 'R6_DEFENSE' || input.effectiveRegime === 'R6_DEFENSE';
}

function isHolidaySession(input: FinalDecisionResolverRuntimeInput): boolean {
  return input.marketSession === 'HOLIDAY';
}

function providerHealthDegraded(input: FinalDecisionResolverRuntimeInput): boolean {
  return input.providerIssue
    || Object.values(input.providerHealth).some((status) => status !== 'VERIFIED');
}

function confidenceAdjustmentFor(input: FinalDecisionResolverRuntimeInput, policyBlocked: boolean): FinalDecisionConfidenceAdjustment {
  if (policyBlocked && !providerHealthDegraded(input)) return 'POLICY_BLOCK_ONLY';
  if (!providerHealthDegraded(input)) return 'NONE';
  return input.dataConfidenceCeiling === 'LOW' ? 'DOWNGRADE_LOW' : 'DOWNGRADE_MEDIUM';
}

function runtimeTrace(): string[] {
  return [
    'FINAL_DECISION_INPUT',
    'GATE_SIGNAL_RECEIVED',
    'POLICY_CONTEXT_RESOLVED',
    'SESSION_POLICY_APPLIED',
    'PROVIDER_CONFIDENCE_APPLIED',
    'SHADOW_PERMISSION_RESOLVED',
    'LIVE_PERMISSION_RESOLVED',
    'FINAL_DECISION_EMITTED',
    'LEARNING_CASE_RECORDED',
  ];
}

function learningTagFor(input: FinalDecisionResolverRuntimeInput, blockReasons: readonly string[]): BlockedDecisionLearningTag {
  if (blockReasons.includes('DIAGNOSTIC_ONLY_ORDER_BLOCKED')) return 'CASE_DIAGNOSTIC_ONLY_ORDER_BLOCKED';
  if (blockReasons.includes('SELL_ONLY_LIVE_BUY_BLOCKED')) return 'CASE_ENTRY_READY_LIVE_BLOCKED_SELL_ONLY';
  if (blockReasons.includes('R6_DEFENSE_LIVE_BUY_BLOCKED')) return 'CASE_ENTRY_READY_LIVE_BLOCKED_R6';
  if (blockReasons.includes('OBSERVE_ONLY_ORDER_BLOCKED') || blockReasons.includes('HOLIDAY_ORDER_BLOCKED')) return 'CASE_ENTRY_READY_OBSERVE_ONLY';
  if (providerHealthDegraded(input)) return 'CASE_PROVIDER_DEGRADED_CONFIDENCE_DOWNGRADE';
  return 'CASE_DATA_INCOMPLETE_BLOCKED';
}

function buildLearningCase(input: FinalDecisionResolverRuntimeInput, decision: {
  timestamp: string;
  finalAction: ExecutionPermissionFinalAction;
  executionImpact: FinalDecisionExecutionImpact;
  blockReasons: string[];
}): BlockedDecisionLearningCase | null {
  const buyBlocked = input.requestedSide === 'BUY' && decision.finalAction !== 'LIVE_BUY_ALLOWED';
  const sellBlocked = input.requestedSide === 'SELL' && decision.finalAction !== 'LIVE_SELL_ALLOWED';
  const diagnosticBlocked = input.isDiagnosticOnly || decision.blockReasons.length > 0;
  if (!buyBlocked && !sellBlocked && !diagnosticBlocked && !providerHealthDegraded(input)) return null;
  return {
    timestamp: decision.timestamp,
    sourceSnapshotId: input.sourceSnapshotId,
    symbol: input.symbol,
    gate1Status: input.gate1Status,
    gate2Status: input.gate2Status,
    gate3Readiness: input.gate3Readiness,
    entryTimingSignal: input.entryTimingSignal,
    engineMode: input.engineMode,
    marketSession: input.marketSession,
    effectiveRegime: input.effectiveRegime,
    requestedSide: input.requestedSide,
    blockReasons: decision.blockReasons,
    finalAction: decision.finalAction,
    executionImpact: decision.executionImpact,
    expectedDecision: input.entryTimingSignal,
    actualDecision: decision.finalAction,
    learningTag: learningTagFor(input, decision.blockReasons),
  };
}

export function resolveFinalExecutionDecision(
  input: FinalDecisionResolverRuntimeInput,
  now: Date = new Date(0),
): ExecutionPermissionDecision {
  const timestamp = input.asOf ?? now.toISOString();
  const correlationId = `decision-${input.sourceSnapshotId}-${input.symbol}-${timestamp}`;
  const blockReasons: string[] = [];
  const advisoryReasons: string[] = [];
  const providerIssueSeparated = input.providerIssue || providerHealthDegraded(input);
  if (providerIssueSeparated) advisoryReasons.push('PROVIDER_ISSUE_ISOLATED');
  if (input.marketSignal && input.providerIssue) advisoryReasons.push('PROVIDER_MARKET_SIGNAL_SUPPRESSED');

  const entryReady = input.entryTimingSignal === 'ENTRY_READY';
  const requestedBuy = input.requestedSide === 'BUY';
  const requestedSell = input.requestedSide === 'SELL';
  const r6Active = isR6Runtime(input);
  const observePolicy = input.engineMode === 'OBSERVE_ONLY' || input.shadowMode === 'OBSERVE_ONLY';
  const holiday = isHolidaySession(input);
  const shadowOnly = input.engineMode === 'SHADOW_ONLY' || input.shadowMode === 'SHADOW_ONLY';
  const sellOnly = input.engineMode === 'SELL_ONLY';
  const diagnosticOnly = input.isDiagnosticOnly;
  const regularLiveSession = input.marketSession === 'REGULAR';
  const liveSessionBlocked = holiday || (!regularLiveSession && requestedBuy);

  let liveBuyAllowed = false;
  let liveSellAllowed = false;
  let shadowBuyAllowed = false;
  let shadowSellAllowed = false;
  let observeOnly = false;
  let finalAction: ExecutionPermissionFinalAction = 'NO_ACTION';
  let executionImpact: FinalDecisionExecutionImpact = 'NONE';

  if (diagnosticOnly) blockReasons.push('DIAGNOSTIC_ONLY_ORDER_BLOCKED');
  if (observePolicy) blockReasons.push('OBSERVE_ONLY_ORDER_BLOCKED');
  if (holiday) blockReasons.push('HOLIDAY_ORDER_BLOCKED');

  if (input.entryTimingSignal === 'WAIT_TRIGGER') {
    observeOnly = true;
    finalAction = 'WAIT';
  } else if (input.entryTimingSignal === 'WATCH_SETUP') {
    observeOnly = true;
    finalAction = 'NO_ACTION';
  } else if (input.entryTimingSignal === 'DO_NOT_ENTER') {
    blockReasons.push('GATE3_DO_NOT_ENTER');
    finalAction = 'BLOCKED';
  } else if (input.entryTimingSignal === 'DATA_INCOMPLETE') {
    blockReasons.push('GATE3_DATA_INCOMPLETE');
    observeOnly = true;
    finalAction = 'BLOCKED';
  } else if (requestedSell) {
    if (!diagnosticOnly && !observePolicy && !holiday && !shadowOnly) {
      liveSellAllowed = true;
      finalAction = 'LIVE_SELL_ALLOWED';
    } else if (shadowOnly && !observePolicy && !holiday) {
      shadowSellAllowed = true;
      finalAction = 'SHADOW_SELL_ALLOWED';
      executionImpact = 'LIVE_ALL_BLOCKED';
    } else {
      observeOnly = true;
      finalAction = 'OBSERVE_ONLY';
      executionImpact = 'ORDER_BLOCKED_DIAGNOSTIC_ONLY';
    }
  } else if (!requestedBuy || !entryReady) {
    observeOnly = true;
    finalAction = 'NO_ACTION';
  } else if (diagnosticOnly || observePolicy || holiday) {
    observeOnly = true;
    finalAction = 'OBSERVE_ONLY';
    executionImpact = 'ORDER_BLOCKED_DIAGNOSTIC_ONLY';
  } else {
    shadowBuyAllowed = true;
    if (sellOnly) blockReasons.push('SELL_ONLY_LIVE_BUY_BLOCKED');
    if (r6Active) blockReasons.push('R6_DEFENSE_LIVE_BUY_BLOCKED');
    if (shadowOnly) blockReasons.push('SHADOW_ONLY_LIVE_BLOCKED');
    if (liveSessionBlocked) blockReasons.push('MARKET_SESSION_LIVE_BUY_BLOCKED');
    const degradedLiveBlocked = input.engineMode === 'DEGRADED' && input.dataConfidenceCeiling === 'LOW';
    if (degradedLiveBlocked) blockReasons.push('DEGRADED_LOW_CONFIDENCE_LIVE_BUY_BLOCKED');

    liveBuyAllowed = blockReasons.length === 0;
    finalAction = liveBuyAllowed ? 'LIVE_BUY_ALLOWED' : 'SHADOW_BUY_ALLOWED';
    executionImpact = liveBuyAllowed
      ? 'NONE'
      : shadowOnly
        ? 'LIVE_ALL_BLOCKED'
        : 'LIVE_BUY_BLOCKED';
  }

  if (requestedBuy && entryReady && !observePolicy && !holiday && !diagnosticOnly) {
    shadowBuyAllowed = shadowBuyAllowed || !liveBuyAllowed;
  }
  if (sellOnly || r6Active || input.engineMode === 'NORMAL' || input.engineMode === 'DEGRADED') {
    liveSellAllowed = liveSellAllowed || (!diagnosticOnly && !observePolicy && !holiday && !shadowOnly);
  }
  if (executionImpact === 'NONE' && (diagnosticOnly || observePolicy || holiday) && (requestedBuy || requestedSell)) {
    executionImpact = 'ORDER_BLOCKED_DIAGNOSTIC_ONLY';
  }

  const paperOrderAllowed = (shadowBuyAllowed || shadowSellAllowed) && !observeOnly && !diagnosticOnly;
  const brokerOrderAllowed = liveBuyAllowed || liveSellAllowed;
  const orderAllowed = brokerOrderAllowed || paperOrderAllowed;
  const policyBlocked = blockReasons.length > 0 || !liveBuyAllowed && requestedBuy && entryReady;
  const confidenceAdjustment = confidenceAdjustmentFor(input, policyBlocked);

  const decisionSeed = { timestamp, finalAction, executionImpact, blockReasons };
  const blockedLearningCase = buildLearningCase(input, decisionSeed);

  return {
    sourceSnapshotId: input.sourceSnapshotId,
    symbol: input.symbol,
    correlationId,
    finalAction,
    liveBuyAllowed,
    liveSellAllowed,
    shadowBuyAllowed,
    shadowSellAllowed,
    observeOnly,
    orderAllowed,
    brokerOrderAllowed,
    paperOrderAllowed,
    executionImpact,
    blockReasons: [...new Set(blockReasons)],
    advisoryReasons: [...new Set(advisoryReasons)],
    confidenceAdjustment,
    learningAllowed: true,
    shadowLearning: true,
    counterfactualAllowed: true,
    counterfactualRecorded: true,
    decisionTrace: {
      gateDecision: input.entryTimingSignal,
      policyDecision: blockReasons.length > 0 ? blockReasons.join('|') : 'POLICY_ALLOWED',
      sessionDecision: holiday ? 'HOLIDAY_ORDER_BLOCKED' : input.marketSession,
      providerDecision: providerIssueSeparated ? 'PROVIDER_ISSUE_ISOLATED' : 'PROVIDER_OK',
      finalDecision: finalAction,
      runtimeTrace: runtimeTrace(),
    },
    livePermissionNotEvaluatedInGate3: true,
    marketSignal: false,
    providerIssueSeparated,
    blockedLearningCase,
  };
}

function incrementRuntime(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

export function buildFinalDecisionRuntimeAuditSummary(input: {
  sourceSnapshotId: string;
  decisions: readonly ExecutionPermissionDecision[];
  inputs?: readonly FinalDecisionResolverRuntimeInput[];
}): FinalDecisionRuntimeAuditSummary {
  const executionImpactDistribution: Record<string, number> = {};
  const blockReasonDistribution: Record<string, number> = {};
  const policyMatrixDistribution: Record<string, number> = {};
  const gate3TransitionDistribution: Record<string, number> = {};
  let gate3LivePermissionLeakDetected = 0;
  let lastTriggerDirectOrderLeakDetected = 0;

  for (const decision of input.decisions) {
    incrementRuntime(executionImpactDistribution, decision.executionImpact);
    incrementRuntime(policyMatrixDistribution, decision.finalAction);
    incrementRuntime(gate3TransitionDistribution, decision.decisionTrace.gateDecision);
    for (const reason of decision.blockReasons) incrementRuntime(blockReasonDistribution, reason);
  }

  for (const raw of input.inputs ?? []) {
    const probe = raw as unknown as Record<string, unknown>;
    if (probe.gate3LiveBuyAllowed === true || probe.lastTriggerLiveBuyAllowed === true) gate3LivePermissionLeakDetected += 1;
    if (probe.brokerOrderCreated === true || probe.liveOrderCreated === true || probe.kisOrderCreated === true) lastTriggerDirectOrderLeakDetected += 1;
  }

  return {
    sourceSnapshotId: input.sourceSnapshotId,
    evaluated: input.decisions.length,
    entryReady: input.decisions.filter((decision) => decision.decisionTrace.gateDecision === 'ENTRY_READY').length,
    liveBuyAllowed: input.decisions.filter((decision) => decision.liveBuyAllowed).length,
    liveBuyBlocked: input.decisions.filter((decision) => decision.decisionTrace.gateDecision === 'ENTRY_READY' && !decision.liveBuyAllowed).length,
    shadowBuyAllowed: input.decisions.filter((decision) => decision.shadowBuyAllowed).length,
    observeOnly: input.decisions.filter((decision) => decision.observeOnly).length,
    wait: input.decisions.filter((decision) => decision.finalAction === 'WAIT').length,
    blocked: input.decisions.filter((decision) => decision.finalAction === 'BLOCKED').length,
    providerIssueSeparated: input.decisions.filter((decision) => decision.providerIssueSeparated).length,
    providerIssueConvertedToMarketSignalCount: 0,
    diagnosticOnlyBlocked: input.decisions.filter((decision) => decision.blockReasons.includes('DIAGNOSTIC_ONLY_ORDER_BLOCKED')).length,
    shadowLearningSuppressedCount: 0,
    counterfactualRecorded: input.decisions.filter((decision) => decision.counterfactualRecorded).length,
    entryReadyButLiveBlockedCount: input.decisions.filter((decision) => decision.decisionTrace.gateDecision === 'ENTRY_READY' && !decision.liveBuyAllowed).length,
    entryReadyShadowAllowedCount: input.decisions.filter((decision) => decision.decisionTrace.gateDecision === 'ENTRY_READY' && decision.shadowBuyAllowed).length,
    entryReadyObserveOnlyCount: input.decisions.filter((decision) => decision.decisionTrace.gateDecision === 'ENTRY_READY' && decision.observeOnly).length,
    gate3LivePermissionLeakDetected,
    lastTriggerDirectOrderLeakDetected,
    diagnosticOnlyBrokerOrderLeakDetected: input.decisions.filter((decision) => decision.blockReasons.includes('DIAGNOSTIC_ONLY_ORDER_BLOCKED') && decision.brokerOrderAllowed).length,
    blockedBuyRecordedAsLearningCaseCount: input.decisions.filter((decision) => decision.blockedLearningCase != null).length,
    executionImpactDistribution,
    blockReasonDistribution,
    policyMatrixDistribution,
    gate3TransitionDistribution,
    decisions: [...input.decisions],
    shadowLearning: 'ON',
  };
}

function countsText(counts: Record<string, number>): string {
  const entries = Object.entries(counts)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);
  return entries.length > 0 ? entries.map(([key, value]) => `${key}:${value}`).join(',') : 'none';
}

export function formatFinalDecisionRuntimeAuditCompact(summary: FinalDecisionRuntimeAuditSummary): string {
  return [
    '[scan_blockers_execution] Final Decision / Execution Permission',
    `sourceSnapshotId=${summary.sourceSnapshotId}`,
    `evaluated: ${summary.evaluated}/${summary.evaluated}`,
    `entryReady: ${summary.entryReady}`,
    `liveBuyAllowed: ${summary.liveBuyAllowed}`,
    `liveBuyBlocked: ${summary.liveBuyBlocked}`,
    `shadowBuyAllowed: ${summary.shadowBuyAllowed}`,
    `observeOnly: ${summary.observeOnly}`,
    `wait: ${summary.wait}`,
    `blocked: ${summary.blocked}`,
    `topBlockReason: ${countsText(summary.blockReasonDistribution).split(',')[0] ?? 'none'}`,
    `providerIssueSeparated: ${summary.providerIssueSeparated}`,
    `providerIssueConvertedToMarketSignal: ${summary.providerIssueConvertedToMarketSignalCount}`,
    `diagnosticOnlyBlocked: ${summary.diagnosticOnlyBlocked}`,
    `shadowLearning: ${summary.shadowLearning}`,
    `counterfactualRecorded: ${summary.counterfactualRecorded}`,
    `executionImpact: ${countsText(summary.executionImpactDistribution)}`,
  ].join('\n');
}

export function formatFinalDecisionRuntimeAuditFull(summary: FinalDecisionRuntimeAuditSummary): string {
  return [
    'Final Decision Runtime Wiring Audit',
    `policyMatrix: ${countsText(summary.policyMatrixDistribution)}`,
    `blockReasons: ${countsText(summary.blockReasonDistribution)}`,
    `gate3Transition: ${countsText(summary.gate3TransitionDistribution)}`,
    `entryReadyButLiveBlocked: ${summary.entryReadyButLiveBlockedCount}`,
    `entryReadyShadowAllowed: ${summary.entryReadyShadowAllowedCount}`,
    `entryReadyObserveOnly: ${summary.entryReadyObserveOnlyCount}`,
    `gate3LivePermissionLeakDetected: ${summary.gate3LivePermissionLeakDetected}`,
    `lastTriggerDirectOrderLeakDetected: ${summary.lastTriggerDirectOrderLeakDetected}`,
    `diagnosticOnlyBrokerOrderLeakDetected: ${summary.diagnosticOnlyBrokerOrderLeakDetected}`,
    `shadowLearningSuppressed: ${summary.shadowLearningSuppressedCount}`,
    `blockedBuyRecordedAsLearningCase: ${summary.blockedBuyRecordedAsLearningCaseCount}`,
    'SampleDecisions:',
    ...summary.decisions.slice(0, 8).map((decision) =>
      `- ${decision.symbol} gate=${decision.decisionTrace.gateDecision} final=${decision.finalAction} liveBuy=${decision.liveBuyAllowed} shadowBuy=${decision.shadowBuyAllowed} impact=${decision.executionImpact} reasons=${decision.blockReasons.join('|') || 'none'} trace=${decision.correlationId}`,
    ),
  ].join('\n');
}
