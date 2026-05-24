// @responsibility ADR-0525 Promotion Governance review layer. Approval-gated; never mutates CORE/runtime weights directly.

import type {
  FactorContributionScore,
  FactorDefinition,
  FactorGroup,
  FactorPerformanceStats,
  GovernanceReviewItem as FeedbackGovernanceReviewItem,
  PromotionStage,
  SuggestedWeightAction,
  WeightFeedbackReport,
} from './dynamicWeightFeedback.js';
import { DEFAULT_FACTOR_REGISTRY } from './dynamicWeightFeedback.js';
import type { OutcomeSeed } from './outcomeClosure.js';
import { isWeightFeedbackEligible } from './dynamicWeightFeedback.js';

export type GovernanceReviewStatus =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'SIMULATION_REQUIRED'
  | 'SIMULATION_RUNNING'
  | 'SIMULATION_PASSED'
  | 'SIMULATION_FAILED'
  | 'APPROVED'
  | 'REJECTED'
  | 'DEFERRED'
  | 'QUARANTINED'
  | 'APPLIED'
  | 'ROLLED_BACK';

export interface GovernanceEvidence {
  sampleCount: number;
  contributionScore: number | null;
  winRate: number | null;
  falsePositiveRate: number | null;
  missedWinRate: number | null;
  avoidedLossRate: number | null;
  avgReturn10D: number | null;
  avgMFE10D: number | null;
  avgMAE10D: number | null;
  dataConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT_SAMPLE';
  providerIssueSampleCount: number;
  dataInsufficientExcludedCount: number;
}

export interface GovernanceSimulationResult {
  simulationId: string;
  itemId: string;
  sampleCount: number;
  before: GovernanceSimulationSide;
  after: GovernanceSimulationSide;
  delta: {
    passCountDelta: number;
    entryReadyDelta: number;
    expectedReturnDelta: number | null;
    falsePositiveDelta: number;
    missedWinDelta: number;
    avoidedLossDelta: number;
  };
  verdict: 'PASS' | 'FAIL' | 'NEEDS_MORE_DATA' | 'RISK_TOO_HIGH';
  reason: string[];
}

export interface GovernanceSimulationSide {
  passCount: number;
  entryReadyCount: number;
  shadowAllowedCount: number;
  liveAllowedCount: number;
  expectedReturn10D: number | null;
  falsePositiveCount: number;
  missedWinCount: number;
  avoidedLossCount: number;
}

export interface GovernanceReviewItem {
  itemId: string;
  createdAt: string;
  createdBy: 'WEIGHT_FEEDBACK_ENGINE' | 'OPERATOR' | 'SYSTEM';
  factorName: string;
  factorGroup: FactorGroup;
  currentWeight: number;
  proposedWeight: number;
  currentStage: PromotionStage;
  proposedStage: PromotionStage;
  suggestedAction: Exclude<SuggestedWeightAction, 'INSUFFICIENT_SAMPLE'>;
  evidence: GovernanceEvidence;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';
  approvalRequired: true;
  autoApplyAllowed: false;
  status: GovernanceReviewStatus;
  simulationResult?: GovernanceSimulationResult;
  reviewerNote?: string;
  approvalReason?: string;
  rejectionReason?: string;
  deferredReason?: string;
  quarantineReason?: string;
  executionImpact: 'NONE';
  guardrailReasons: string[];
  rollbackMetadataRequired: boolean;
}

export interface RollbackPlan {
  rollbackPlanId: string;
  strategyVersion: string;
  previousWeights: Record<string, number>;
  previousStages: Record<string, PromotionStage>;
  rollbackTrigger: {
    falsePositiveRateIncrease: number;
    expectedReturnDrop: number;
    maxDrawdownIncrease: number;
    operatorManualRollback: boolean;
  };
  rollbackCommand: string;
}

export interface StrategyVersionDraft {
  draftId: string;
  baseVersion: string;
  proposedVersion: string;
  createdAt: string;
  approvedItems: GovernanceReviewItem[];
  weightChanges: Array<{ factorName: string; oldWeight: number; newWeight: number }>;
  stageChanges: Array<{ factorName: string; oldStage: PromotionStage; newStage: PromotionStage }>;
  simulationSummary: GovernanceSimulationResult[];
  rollbackPlanId: string;
  status: 'DRAFT' | 'READY_TO_APPLY' | 'APPLIED' | 'REJECTED' | 'ROLLED_BACK';
}

export interface GovernanceAuditLog {
  auditId: string;
  timestamp: string;
  actor: string;
  action:
    | 'CREATE_REVIEW_ITEM'
    | 'RUN_SIMULATION'
    | 'APPROVE'
    | 'REJECT'
    | 'DEFER'
    | 'QUARANTINE'
    | 'CREATE_DRAFT'
    | 'APPLY_DRAFT'
    | 'ROLLBACK';
  itemId?: string;
  draftId?: string;
  reason: string;
  beforeState: object;
  afterState: object;
  executionImpact: 'NONE';
}

const STAGE_ORDER: PromotionStage[] = ['OBSERVE', 'SHADOW_SCORE', 'ADVISORY', 'WEIGHTED', 'GATED', 'CORE'];
const APPROVAL_ALLOWED_FROM = new Set<GovernanceReviewStatus>(['SIMULATION_PASSED', 'PENDING_REVIEW']);

function nowIso(): string {
  return new Date().toISOString();
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function stageIndex(stage: PromotionStage): number {
  return STAGE_ORDER.indexOf(stage);
}

export function nextPromotionStage(stage: PromotionStage): PromotionStage {
  return STAGE_ORDER[Math.min(STAGE_ORDER.length - 1, stageIndex(stage) + 1)] ?? stage;
}

export function isSequentialPromotion(current: PromotionStage, proposed: PromotionStage): boolean {
  if (current === proposed) return true;
  return stageIndex(proposed) - stageIndex(current) === 1;
}

export function requiresGovernanceSimulation(item: GovernanceReviewItem): boolean {
  return stageIndex(item.proposedStage) >= stageIndex('WEIGHTED')
    || Math.abs(item.proposedWeight - item.currentWeight) >= 3
    || item.currentStage === 'CORE'
    || item.proposedStage === 'CORE'
    || item.currentStage === 'GATED'
    || item.proposedStage === 'GATED'
    || item.factorGroup === 'POLICY'
    || item.factorGroup === 'CONFIDENCE';
}

function defaultEvidence(): GovernanceEvidence {
  return {
    sampleCount: 0,
    contributionScore: null,
    winRate: null,
    falsePositiveRate: null,
    missedWinRate: null,
    avoidedLossRate: null,
    avgReturn10D: null,
    avgMFE10D: null,
    avgMAE10D: null,
    dataConfidence: 'INSUFFICIENT_SAMPLE',
    providerIssueSampleCount: 0,
    dataInsufficientExcludedCount: 0,
  };
}

function evidenceFor(
  factorName: string,
  stats: readonly FactorPerformanceStats[],
  scores: readonly FactorContributionScore[],
): GovernanceEvidence {
  const stat = stats.find(s => s.factorName === factorName);
  const score = scores.find(s => s.factorName === factorName);
  if (!stat && !score) return defaultEvidence();
  return {
    sampleCount: stat?.sampleCount ?? 0,
    contributionScore: score?.contributionScore ?? null,
    winRate: stat?.winRate ?? null,
    falsePositiveRate: stat?.falsePositiveRate ?? null,
    missedWinRate: stat?.missedWinRate ?? null,
    avoidedLossRate: stat?.avoidedLossRate ?? null,
    avgReturn10D: stat?.avgReturn10D ?? null,
    avgMFE10D: stat?.avgMFE10D ?? null,
    avgMAE10D: stat?.avgMAE10D ?? null,
    dataConfidence: score?.confidence ?? 'INSUFFICIENT_SAMPLE',
    providerIssueSampleCount: stat?.providerIssueSampleCount ?? 0,
    dataInsufficientExcludedCount: stat?.dataInsufficientExcludedCount ?? 0,
  };
}

function factorByName(registry: readonly FactorDefinition[], factorName: string): FactorDefinition | undefined {
  return registry.find(def => def.factorName === factorName);
}

function actionToProposedStage(action: FeedbackGovernanceReviewItem, definition: FactorDefinition): PromotionStage {
  if (action.proposedStage && STAGE_ORDER.includes(action.proposedStage as PromotionStage)) {
    return action.proposedStage as PromotionStage;
  }
  if (action.suggestedAction === 'PROMOTE_STAGE') return nextPromotionStage(definition.promotionStage);
  if (action.suggestedAction === 'DEMOTE_STAGE') return STAGE_ORDER[Math.max(0, stageIndex(definition.promotionStage) - 1)] ?? definition.promotionStage;
  return definition.promotionStage;
}

function clampWeightDelta(item: Pick<GovernanceReviewItem, 'currentWeight' | 'proposedWeight' | 'riskLevel' | 'currentStage'>): { proposedWeight: number; reason?: string } {
  const delta = item.proposedWeight - item.currentWeight;
  const abs = Math.abs(delta);
  const maxDelta = item.currentStage === 'CORE' ? 2 : item.riskLevel === 'LOW' ? 5 : item.riskLevel === 'MEDIUM' ? 3 : 1;
  if (abs <= maxDelta) return { proposedWeight: item.proposedWeight };
  const capped = item.currentWeight + Math.sign(delta) * maxDelta;
  return { proposedWeight: round2(capped), reason: `WEIGHT_DELTA_CAPPED_${abs}_TO_${maxDelta}` };
}

function classifyRisk(input: {
  action: FeedbackGovernanceReviewItem;
  definition: FactorDefinition;
  evidence: GovernanceEvidence;
  proposedStage: PromotionStage;
}): GovernanceReviewItem['riskLevel'] {
  if (input.evidence.sampleCount < 30 || input.evidence.contributionScore === null) return 'BLOCKED';
  if (input.definition.dataSource === 'AI_ESTIMATED' && stageIndex(input.proposedStage) > stageIndex('ADVISORY')) return 'BLOCKED';
  const providerRatio = input.evidence.providerIssueSampleCount / Math.max(1, input.evidence.sampleCount);
  if (providerRatio >= 0.3 || input.evidence.dataConfidence === 'INSUFFICIENT_SAMPLE') return 'BLOCKED';
  if (input.action.risk === 'HIGH' || input.proposedStage === 'CORE' || input.proposedStage === 'GATED' || input.definition.isCoreProtected) return 'HIGH';
  if (input.action.risk === 'MEDIUM' || Math.abs(input.action.proposedWeight - input.action.currentWeight) >= 3) return 'MEDIUM';
  return 'LOW';
}

export function validateGovernanceItem(item: GovernanceReviewItem, definition?: FactorDefinition): string[] {
  const reasons: string[] = [];
  const source = definition?.dataSource;
  if (item.evidence.sampleCount < 30) reasons.push('SAMPLE_COUNT_BELOW_30');
  if (item.evidence.contributionScore === null) reasons.push('CONTRIBUTION_SCORE_MISSING');
  if (!isSequentialPromotion(item.currentStage, item.proposedStage)) reasons.push('PROMOTION_STAGE_SKIP_FORBIDDEN');
  if (source === 'AI_ESTIMATED' && stageIndex(item.proposedStage) > stageIndex('ADVISORY')) reasons.push('AI_ESTIMATED_MAX_STAGE_ADVISORY');
  const providerRatio = item.evidence.providerIssueSampleCount / Math.max(1, item.evidence.sampleCount);
  if (providerRatio >= 0.3) reasons.push('PROVIDER_ISSUE_RATIO_HIGH');
  if (item.evidence.dataInsufficientExcludedCount > item.evidence.sampleCount) reasons.push('DATA_INSUFFICIENT_RATIO_HIGH');
  if (stageIndex(item.proposedStage) >= stageIndex('GATED') && item.evidence.sampleCount < 150) reasons.push('GATED_REQUIRES_150_SAMPLES');
  if (item.proposedStage === 'CORE') {
    if (item.evidence.sampleCount < 300) reasons.push('CORE_REQUIRES_300_SAMPLES');
    if ((item.evidence.contributionScore ?? 0) < 85) reasons.push('CORE_REQUIRES_SCORE_85');
    if (source === 'AI_ESTIMATED') reasons.push('CORE_FORBIDS_AI_ESTIMATED');
    if (!item.rollbackMetadataRequired) reasons.push('CORE_REQUIRES_ROLLBACK_METADATA');
  }
  if (definition?.factorGroup === 'POLICY' && item.factorName.includes('R6') && item.proposedWeight < item.currentWeight) {
    reasons.push('R6_LIVE_BLOCK_RELAXATION_FORBIDDEN_BY_FEEDBACK');
  }
  return reasons;
}

export function buildGovernanceReviewItemsFromFeedback(
  report: WeightFeedbackReport,
  registry: readonly FactorDefinition[] = DEFAULT_FACTOR_REGISTRY,
  createdAt = nowIso(),
): GovernanceReviewItem[] {
  return report.governanceItems.map((action) => {
    const definition = factorByName(registry, action.factorName) ?? {
      factorName: action.factorName,
      factorGroup: 'GATE2' as const,
      currentWeight: action.currentWeight,
      minWeight: 0,
      maxWeight: 30,
      promotionStage: (action.currentStage as PromotionStage) || 'OBSERVE',
      dataSource: 'INTERNAL' as const,
      isCoreProtected: false,
      canAutoSuggest: true,
    };
    const evidence = evidenceFor(action.factorName, report.factorStats, report.contributionScores);
    const proposedStage = actionToProposedStage(action, definition);
    const riskLevel = classifyRisk({ action, definition, evidence, proposedStage });
    const baseItem: GovernanceReviewItem = {
      itemId: `gov-${action.factorName}-${action.suggestedAction}-${createdAt.slice(0, 10)}`,
      createdAt,
      createdBy: 'WEIGHT_FEEDBACK_ENGINE',
      factorName: action.factorName,
      factorGroup: definition.factorGroup,
      currentWeight: action.currentWeight,
      proposedWeight: action.proposedWeight,
      currentStage: definition.promotionStage,
      proposedStage,
      suggestedAction: action.suggestedAction as Exclude<SuggestedWeightAction, 'INSUFFICIENT_SAMPLE'>,
      evidence,
      riskLevel,
      approvalRequired: true,
      autoApplyAllowed: false,
      status: 'PENDING_REVIEW',
      executionImpact: 'NONE',
      guardrailReasons: [],
      rollbackMetadataRequired: stageIndex(proposedStage) >= stageIndex('WEIGHTED'),
    };
    const capped = clampWeightDelta(baseItem);
    const item = { ...baseItem, proposedWeight: capped.proposedWeight };
    item.guardrailReasons = [
      ...validateGovernanceItem(item, definition),
      ...(capped.reason ? [capped.reason] : []),
    ];
    item.status = requiresGovernanceSimulation(item) ? 'SIMULATION_REQUIRED' : 'PENDING_REVIEW';
    if (item.guardrailReasons.length > 0 || item.riskLevel === 'BLOCKED') item.riskLevel = 'BLOCKED';
    return item;
  });
}

function seedReturn(seed: OutcomeSeed): number | null {
  return seed.forwardReturns?.['10D']?.returnPct ?? seed.forwardReturns?.['5D']?.returnPct ?? null;
}

function simulationSide(seeds: readonly OutcomeSeed[], sensitivity: number): GovernanceSimulationSide {
  const valid = seeds.filter(isWeightFeedbackEligible);
  const expectedReturn10D = valid.length
    ? round2(valid.reduce((sum, seed) => sum + (seedReturn(seed) ?? 0), 0) / valid.length + sensitivity)
    : null;
  return {
    passCount: Math.max(0, Math.round(valid.length * (0.45 + sensitivity / 20))),
    entryReadyCount: Math.max(0, Math.round(valid.length * (0.2 + sensitivity / 30))),
    shadowAllowedCount: Math.max(0, Math.round(valid.length * (0.3 + sensitivity / 35))),
    liveAllowedCount: Math.max(0, Math.round(valid.length * (0.1 + sensitivity / 50))),
    expectedReturn10D,
    falsePositiveCount: valid.filter(seed => seed.finalLearningLabel === 'FALSE_POSITIVE' || seed.finalLearningLabel === 'LOSS').length + Math.max(0, Math.round(-sensitivity)),
    missedWinCount: valid.filter(seed => seed.finalLearningLabel === 'MISSED_WIN').length + Math.max(0, Math.round(-sensitivity)),
    avoidedLossCount: valid.filter(seed => seed.finalLearningLabel === 'AVOIDED_LOSS').length + Math.max(0, Math.round(sensitivity)),
  };
}

export function runGovernanceSimulation(
  item: GovernanceReviewItem,
  seeds: readonly OutcomeSeed[],
  runAt = nowIso(),
): GovernanceSimulationResult {
  const sampleCount = seeds.filter(isWeightFeedbackEligible).length;
  const before = simulationSide(seeds, 0);
  const intendedDelta = item.proposedWeight - item.currentWeight;
  const stageBoost = stageIndex(item.proposedStage) - stageIndex(item.currentStage);
  const sensitivity = item.suggestedAction === 'DECREASE' || item.suggestedAction === 'DEMOTE_STAGE'
    ? -Math.abs(intendedDelta || stageBoost)
    : Math.abs(intendedDelta || stageBoost);
  const after = simulationSide(seeds, sensitivity / 2);
  const expectedReturnDelta = before.expectedReturn10D == null || after.expectedReturn10D == null
    ? null
    : round2(after.expectedReturn10D - before.expectedReturn10D);
  const delta = {
    passCountDelta: after.passCount - before.passCount,
    entryReadyDelta: after.entryReadyCount - before.entryReadyCount,
    expectedReturnDelta,
    falsePositiveDelta: after.falsePositiveCount - before.falsePositiveCount,
    missedWinDelta: after.missedWinCount - before.missedWinCount,
    avoidedLossDelta: after.avoidedLossCount - before.avoidedLossCount,
  };
  const reason: string[] = [];
  let verdict: GovernanceSimulationResult['verdict'] = 'PASS';
  if (sampleCount < 30) {
    verdict = 'NEEDS_MORE_DATA';
    reason.push('SIMULATION_SAMPLE_BELOW_30');
  }
  if (item.riskLevel === 'BLOCKED' || item.guardrailReasons.length > 0) {
    verdict = 'FAIL';
    reason.push(...item.guardrailReasons);
  }
  if (delta.falsePositiveDelta > 5 || (delta.expectedReturnDelta != null && delta.expectedReturnDelta < -1)) {
    verdict = 'RISK_TOO_HIGH';
    reason.push('SIMULATION_RISK_DELTA_TOO_HIGH');
  }
  if (reason.length === 0) reason.push('SIMULATION_PASSED_REPORT_ONLY');
  return {
    simulationId: `sim-${item.itemId}-${runAt.slice(0, 10)}`,
    itemId: item.itemId,
    sampleCount,
    before,
    after,
    delta,
    verdict,
    reason,
  };
}

function assertTransitionAllowed(from: GovernanceReviewStatus, to: GovernanceReviewStatus): void {
  const allowed: Record<GovernanceReviewStatus, GovernanceReviewStatus[]> = {
    DRAFT: ['PENDING_REVIEW', 'DEFERRED'],
    PENDING_REVIEW: ['SIMULATION_REQUIRED', 'APPROVED', 'REJECTED', 'DEFERRED', 'QUARANTINED'],
    SIMULATION_REQUIRED: ['SIMULATION_RUNNING', 'DEFERRED', 'REJECTED', 'QUARANTINED'],
    SIMULATION_RUNNING: ['SIMULATION_PASSED', 'SIMULATION_FAILED'],
    SIMULATION_PASSED: ['APPROVED', 'REJECTED', 'DEFERRED', 'QUARANTINED'],
    SIMULATION_FAILED: ['REJECTED', 'DEFERRED', 'QUARANTINED'],
    APPROVED: ['APPLIED'],
    REJECTED: [],
    DEFERRED: ['PENDING_REVIEW', 'REJECTED', 'QUARANTINED'],
    QUARANTINED: [],
    APPLIED: ['ROLLED_BACK'],
    ROLLED_BACK: [],
  };
  if (!allowed[from].includes(to)) {
    throw new Error(`INVALID_GOVERNANCE_TRANSITION:${from}->${to}`);
  }
}

export function transitionGovernanceStatus(item: GovernanceReviewItem, status: GovernanceReviewStatus): GovernanceReviewItem {
  assertTransitionAllowed(item.status, status);
  return { ...item, status };
}

export function approveGovernanceItem(item: GovernanceReviewItem, reason: string): GovernanceReviewItem {
  if (!APPROVAL_ALLOWED_FROM.has(item.status)) throw new Error(`APPROVAL_REQUIRES_SIMULATION_PASSED_OR_PENDING_REVIEW:${item.status}`);
  if (item.status === 'SIMULATION_PASSED' && item.simulationResult?.verdict !== 'PASS') throw new Error('APPROVAL_REQUIRES_PASSING_SIMULATION');
  if (item.riskLevel === 'BLOCKED' || item.guardrailReasons.length > 0) throw new Error('APPROVAL_BLOCKED_BY_GUARDRAIL');
  if (!reason.trim()) throw new Error('APPROVAL_REASON_REQUIRED');
  return { ...item, status: 'APPROVED', approvalReason: reason, reviewerNote: reason };
}

export function rejectGovernanceItem(item: GovernanceReviewItem, reason: string): GovernanceReviewItem {
  if (!reason.trim()) throw new Error('REJECTION_REASON_REQUIRED');
  return { ...item, status: 'REJECTED', rejectionReason: reason, reviewerNote: reason };
}

export function deferGovernanceItem(item: GovernanceReviewItem, reason: string): GovernanceReviewItem {
  if (!reason.trim()) throw new Error('DEFER_REASON_REQUIRED');
  return { ...item, status: 'DEFERRED', deferredReason: reason, reviewerNote: reason };
}

export function quarantineGovernanceItem(item: GovernanceReviewItem, reason: string): GovernanceReviewItem {
  if (!reason.trim()) throw new Error('QUARANTINE_REASON_REQUIRED');
  return { ...item, status: 'QUARANTINED', quarantineReason: reason, reviewerNote: reason };
}

export function createRollbackPlan(input: {
  approvedItems: readonly GovernanceReviewItem[];
  strategyVersion: string;
}): RollbackPlan {
  const previousWeights: Record<string, number> = {};
  const previousStages: Record<string, PromotionStage> = {};
  for (const item of input.approvedItems) {
    previousWeights[item.factorName] = item.currentWeight;
    previousStages[item.factorName] = item.currentStage;
  }
  return {
    rollbackPlanId: `rollback-${input.strategyVersion}`,
    strategyVersion: input.strategyVersion,
    previousWeights,
    previousStages,
    rollbackTrigger: {
      falsePositiveRateIncrease: 0.05,
      expectedReturnDrop: 1,
      maxDrawdownIncrease: 2,
      operatorManualRollback: true,
    },
    rollbackCommand: `/strategy_rollback ${input.strategyVersion}`,
  };
}

export function createStrategyVersionDraft(input: {
  approvedItems: readonly GovernanceReviewItem[];
  baseVersion?: string;
  proposedVersion?: string;
  createdAt?: string;
}): { draft: StrategyVersionDraft; rollbackPlan: RollbackPlan } {
  const approvedItems = input.approvedItems.filter(item => item.status === 'APPROVED');
  if (approvedItems.length === 0) throw new Error('NO_APPROVED_GOVERNANCE_ITEMS_FOR_DRAFT');
  for (const item of approvedItems) {
    if (stageIndex(item.proposedStage) >= stageIndex('WEIGHTED') && !item.simulationResult) {
      throw new Error('STRATEGY_DRAFT_REQUIRES_SIMULATION_FOR_WEIGHTED_OR_ABOVE');
    }
  }
  const createdAt = input.createdAt ?? nowIso();
  const proposedVersion = input.proposedVersion ?? `strategy-${createdAt.slice(0, 10)}-adr0525`;
  const rollbackPlan = createRollbackPlan({ approvedItems, strategyVersion: proposedVersion });
  const draft: StrategyVersionDraft = {
    draftId: `draft-${proposedVersion}`,
    baseVersion: input.baseVersion ?? 'strategy-current',
    proposedVersion,
    createdAt,
    approvedItems: [...approvedItems],
    weightChanges: approvedItems
      .filter(item => item.currentWeight !== item.proposedWeight)
      .map(item => ({ factorName: item.factorName, oldWeight: item.currentWeight, newWeight: item.proposedWeight })),
    stageChanges: approvedItems
      .filter(item => item.currentStage !== item.proposedStage)
      .map(item => ({ factorName: item.factorName, oldStage: item.currentStage, newStage: item.proposedStage })),
    simulationSummary: approvedItems.map(item => item.simulationResult).filter((result): result is GovernanceSimulationResult => !!result),
    rollbackPlanId: rollbackPlan.rollbackPlanId,
    status: 'READY_TO_APPLY',
  };
  return { draft, rollbackPlan };
}

export class PromotionGovernanceMemoryRepo {
  private readonly items = new Map<string, GovernanceReviewItem>();
  private readonly drafts = new Map<string, StrategyVersionDraft>();
  private readonly rollbackPlans = new Map<string, RollbackPlan>();
  private readonly auditLogs: GovernanceAuditLog[] = [];

  upsertReviewItem(item: GovernanceReviewItem, actor = 'system'): GovernanceReviewItem {
    const before = this.items.get(item.itemId);
    this.items.set(item.itemId, item);
    this.audit(actor, 'CREATE_REVIEW_ITEM', 'review item upserted', before ?? {}, item, item.itemId);
    return item;
  }

  loadFromFeedbackReport(report: WeightFeedbackReport, registry: readonly FactorDefinition[] = DEFAULT_FACTOR_REGISTRY, actor = 'system'): GovernanceReviewItem[] {
    const items = buildGovernanceReviewItemsFromFeedback(report, registry);
    for (const item of items) this.upsertReviewItem(item, actor);
    return items;
  }

  listItems(): GovernanceReviewItem[] {
    return [...this.items.values()];
  }

  getItem(itemId: string): GovernanceReviewItem | undefined {
    return this.items.get(itemId);
  }

  runSimulation(itemId: string, seeds: readonly OutcomeSeed[], actor = 'system'): GovernanceReviewItem {
    const item = this.requireItem(itemId);
    if (item.status !== 'SIMULATION_REQUIRED' && item.status !== 'PENDING_REVIEW') {
      throw new Error(`SIMULATION_NOT_ALLOWED_FROM:${item.status}`);
    }
    const running = { ...item, status: 'SIMULATION_RUNNING' as const };
    const result = runGovernanceSimulation(running, seeds);
    const nextStatus: GovernanceReviewStatus = result.verdict === 'PASS' ? 'SIMULATION_PASSED' : 'SIMULATION_FAILED';
    const updated: GovernanceReviewItem = { ...running, status: nextStatus, simulationResult: result };
    this.items.set(itemId, updated);
    this.audit(actor, 'RUN_SIMULATION', result.verdict, item, updated, itemId);
    return updated;
  }

  approve(itemId: string, reason: string, actor = 'operator'): GovernanceReviewItem {
    const before = this.requireItem(itemId);
    const after = approveGovernanceItem(before, reason);
    this.items.set(itemId, after);
    this.audit(actor, 'APPROVE', reason, before, after, itemId);
    return after;
  }

  reject(itemId: string, reason: string, actor = 'operator'): GovernanceReviewItem {
    const before = this.requireItem(itemId);
    const after = rejectGovernanceItem(before, reason);
    this.items.set(itemId, after);
    this.audit(actor, 'REJECT', reason, before, after, itemId);
    return after;
  }

  defer(itemId: string, reason: string, actor = 'operator'): GovernanceReviewItem {
    const before = this.requireItem(itemId);
    const after = deferGovernanceItem(before, reason);
    this.items.set(itemId, after);
    this.audit(actor, 'DEFER', reason, before, after, itemId);
    return after;
  }

  quarantine(itemId: string, reason: string, actor = 'operator'): GovernanceReviewItem {
    const before = this.requireItem(itemId);
    const after = quarantineGovernanceItem(before, reason);
    this.items.set(itemId, after);
    this.audit(actor, 'QUARANTINE', reason, before, after, itemId);
    return after;
  }

  createDraftFromApproved(input: { baseVersion?: string; proposedVersion?: string; actor?: string } = {}): StrategyVersionDraft {
    const { draft, rollbackPlan } = createStrategyVersionDraft({
      approvedItems: this.listItems().filter(item => item.status === 'APPROVED'),
      baseVersion: input.baseVersion,
      proposedVersion: input.proposedVersion,
    });
    this.drafts.set(draft.draftId, draft);
    this.rollbackPlans.set(rollbackPlan.rollbackPlanId, rollbackPlan);
    this.audit(input.actor ?? 'operator', 'CREATE_DRAFT', 'strategy draft created', {}, draft, undefined, draft.draftId);
    return draft;
  }

  applyDraft(draftId: string, actor = 'admin'): StrategyVersionDraft {
    const before = this.requireDraft(draftId);
    if (before.status !== 'READY_TO_APPLY') throw new Error(`DRAFT_NOT_READY_TO_APPLY:${before.status}`);
    const after = { ...before, status: 'APPLIED' as const };
    this.drafts.set(draftId, after);
    for (const item of after.approvedItems) {
      this.items.set(item.itemId, { ...item, status: 'APPLIED' });
    }
    this.audit(actor, 'APPLY_DRAFT', 'draft applied to strategy version state only', before, after, undefined, draftId);
    return after;
  }

  rollback(versionId: string, actor = 'admin'): StrategyVersionDraft {
    const draft = [...this.drafts.values()].find(d => d.proposedVersion === versionId || d.draftId === versionId);
    if (!draft) throw new Error(`STRATEGY_DRAFT_NOT_FOUND:${versionId}`);
    const after = { ...draft, status: 'ROLLED_BACK' as const };
    this.drafts.set(draft.draftId, after);
    for (const item of draft.approvedItems) this.items.set(item.itemId, { ...item, status: 'ROLLED_BACK' });
    this.audit(actor, 'ROLLBACK', 'strategy version rollback metadata applied', draft, after, undefined, draft.draftId);
    return after;
  }

  listDrafts(): StrategyVersionDraft[] {
    return [...this.drafts.values()];
  }

  listRollbackPlans(): RollbackPlan[] {
    return [...this.rollbackPlans.values()];
  }

  listAuditLogs(): GovernanceAuditLog[] {
    return [...this.auditLogs];
  }

  reset(): void {
    this.items.clear();
    this.drafts.clear();
    this.rollbackPlans.clear();
    this.auditLogs.length = 0;
  }

  private requireItem(itemId: string): GovernanceReviewItem {
    const item = this.items.get(itemId);
    if (!item) throw new Error(`GOVERNANCE_ITEM_NOT_FOUND:${itemId}`);
    return item;
  }

  private requireDraft(draftId: string): StrategyVersionDraft {
    const draft = this.drafts.get(draftId);
    if (!draft) throw new Error(`STRATEGY_DRAFT_NOT_FOUND:${draftId}`);
    return draft;
  }

  private audit(
    actor: string,
    action: GovernanceAuditLog['action'],
    reason: string,
    beforeState: object,
    afterState: object,
    itemId?: string,
    draftId?: string,
  ): void {
    this.auditLogs.push({
      auditId: `audit-${this.auditLogs.length + 1}`,
      timestamp: nowIso(),
      actor,
      action,
      ...(itemId ? { itemId } : {}),
      ...(draftId ? { draftId } : {}),
      reason,
      beforeState,
      afterState,
      executionImpact: 'NONE',
    });
  }
}

export function summarizeGovernance(items: readonly GovernanceReviewItem[]): {
  pending: number;
  simulationRequired: number;
  approved: number;
  rejected: number;
  quarantined: number;
  topProposal: string;
  risk: GovernanceReviewItem['riskLevel'] | 'NONE';
  autoApply: false;
  impact: 'NONE';
} {
  const top = items.find(item => ['SIMULATION_REQUIRED', 'PENDING_REVIEW', 'SIMULATION_PASSED'].includes(item.status)) ?? items[0];
  return {
    pending: items.filter(item => item.status === 'PENDING_REVIEW').length,
    simulationRequired: items.filter(item => item.status === 'SIMULATION_REQUIRED').length,
    approved: items.filter(item => item.status === 'APPROVED').length,
    rejected: items.filter(item => item.status === 'REJECTED').length,
    quarantined: items.filter(item => item.status === 'QUARANTINED').length,
    topProposal: top ? `${top.suggestedAction} ${top.factorName} ${top.currentStage}->${top.proposedStage}` : 'none',
    risk: top?.riskLevel ?? 'NONE',
    autoApply: false,
    impact: 'NONE',
  };
}

export function formatGovernanceCompact(items: readonly GovernanceReviewItem[]): string {
  const s = summarizeGovernance(items);
  return [
    '[Governance]',
    `pending: ${s.pending}`,
    `simulationRequired: ${s.simulationRequired}`,
    `approved: ${s.approved}`,
    `rejected: ${s.rejected}`,
    `quarantined: ${s.quarantined}`,
    `topProposal: ${s.topProposal}`,
    `risk: ${s.risk}`,
    `autoApply: ${s.autoApply}`,
    `impact: ${s.impact}`,
  ].join('\n');
}

export function formatGovernanceDetail(items: readonly GovernanceReviewItem[]): string {
  return [
    formatGovernanceCompact(items),
    '',
    'Items:',
    ...items.slice(0, 20).map(item =>
      `- ${item.itemId} ${item.factorName} ${item.suggestedAction} weight=${item.currentWeight}->${item.proposedWeight} stage=${item.currentStage}->${item.proposedStage} samples=${item.evidence.sampleCount} score=${item.evidence.contributionScore ?? 'N/A'} risk=${item.riskLevel} status=${item.status}`,
    ),
  ].join('\n');
}

export function formatGovernanceItem(item: GovernanceReviewItem): string {
  return [
    '[Governance Review]',
    `Factor: ${item.factorName}`,
    `Action: ${item.suggestedAction}`,
    `Stage: ${item.currentStage} -> ${item.proposedStage}`,
    `Weight: ${item.currentWeight} -> ${item.proposedWeight}`,
    `Samples: ${item.evidence.sampleCount}`,
    `Contribution: ${item.evidence.contributionScore ?? 'N/A'}`,
    `Risk: ${item.riskLevel}`,
    `Status: ${item.status}`,
    `Simulation: ${item.simulationResult?.verdict ?? 'N/A'}`,
    `AutoApply: ${item.autoApplyAllowed}`,
    `Guardrails: ${item.guardrailReasons.join(',') || 'none'}`,
    'Buttons: [Approve] [Reject] [Defer] [Quarantine] [Detail]',
  ].join('\n');
}

export const promotionGovernanceRepo = new PromotionGovernanceMemoryRepo();
