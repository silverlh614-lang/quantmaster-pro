// @responsibility ADR-0526 Strategy Versioning and Rollback. Version artifacts only; no direct runtime config mutation.

import { createHash } from 'crypto';
import {
  DEFAULT_FACTOR_REGISTRY,
  type FactorDefinition,
  type FactorGroup,
  type PromotionStage,
} from './dynamicWeightFeedback.js';
import type {
  GovernanceReviewItem,
  GovernanceSimulationResult,
  RollbackPlan,
  StrategyVersionDraft as GovernanceStrategyVersionDraft,
} from './promotionGovernance.js';
import type { OutcomeSeed } from './outcomeClosure.js';

export type StrategyVersionStatus =
  | 'DRAFT'
  | 'READY_FOR_SHADOW'
  | 'SHADOW_ACTIVE'
  | 'READY_FOR_CANARY'
  | 'CANARY_ACTIVE'
  | 'READY_FOR_LIVE'
  | 'LIVE_ACTIVE'
  | 'PAUSED'
  | 'ROLLED_BACK'
  | 'REJECTED'
  | 'EXPIRED';

export type RolloutStage = 'SHADOW' | 'CANARY' | 'LIVE';

export interface StrategyConfigSnapshot {
  gate1Weights: Record<string, number>;
  gate2Weights: Record<string, number>;
  gate3Weights: Record<string, number>;
  factorPromotionStages: Record<string, PromotionStage>;
  gateThresholds: {
    gate1RequiredAvg: number;
    gate2PassStrong: number;
    gate2PassWeak: number;
    gate3Ready: number;
    gate3TriggerWait: number;
  };
  policySettings: {
    sellOnlyPolicy: object;
    r6Policy: object;
    observeOnlyPolicy: object;
    shadowOnlyPolicy: object;
    providerIssuePolicy: object;
  };
  confidenceRules: {
    aiEstimatedMaxStage: PromotionStage;
    providerMissingBehavior: 'NEUTRAL' | 'MISSING' | 'EXCLUDE';
    dataConfidenceCeilingRules: object;
  };
  riskGuards: {
    maxSingleFactorWeight: number;
    maxGateWeightDeltaPerVersion: number;
    maxCoreWeightDeltaPerVersion: number;
    falsePositiveRollbackThreshold: number;
    expectedReturnRollbackThreshold: number;
  };
  metadata: {
    createdFromReportId?: string;
    governanceBatchId?: string;
    notes?: string;
  };
}

export interface StrategyVersionDiff {
  weightChanges: Array<{
    factorName: string;
    group: FactorGroup;
    oldWeight: number;
    newWeight: number;
    delta: number;
  }>;
  stageChanges: Array<{
    factorName: string;
    oldStage: PromotionStage;
    newStage: PromotionStage;
  }>;
  thresholdChanges: Array<{
    thresholdName: string;
    oldValue: number;
    newValue: number;
    delta: number;
  }>;
  policyChanges: Array<{
    policyName: string;
    changeType: 'ADD' | 'REMOVE' | 'MODIFY';
    summary: string;
  }>;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';
}

export interface StrategyValidationResult {
  passed: boolean;
  failedReasons: string[];
  warningReasons: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';
  requiredApprovals: string[];
  validationTimestamp: string;
}

export interface RolloutPolicy {
  allowedStages: RolloutStage[];
  currentStage: RolloutStage | null;
  shadowDurationDays: number;
  canaryDurationDays: number;
  canaryScope: {
    maxSymbols: number;
    maxCapitalPct: number;
    allowedModes: Array<'SHADOW_ONLY' | 'DEGRADED' | 'NORMAL'>;
  };
  promotionCriteria: {
    minSamples: number;
    maxFalsePositiveRate: number;
    minExpectedReturn10D: number;
    maxMissedWinIncrease: number;
    maxDrawdownProxy: number;
  };
  autoPromoteAllowed: false;
}

export interface ActiveStrategyRegistry {
  liveVersionId: string;
  shadowVersionId: string;
  canaryVersionId?: string;
  activeSince: string;
  previousLiveVersionId?: string;
  previousShadowVersionId?: string;
  pendingDraftVersionIds: string[];
  lastRollbackAt?: string;
}

export interface StrategyVersionPerformance {
  versionId: string;
  stage: RolloutStage;
  sampleCount: number;
  seedCount: number;
  labeledCount: number;
  gate1PassRate: number | null;
  gate2PassRate: number | null;
  gate3ReadyRate: number | null;
  winRate: number | null;
  falsePositiveRate: number | null;
  missedWinRate: number | null;
  avoidedLossRate: number | null;
  avgReturn5D: number | null;
  avgReturn10D: number | null;
  avgMFE10D: number | null;
  avgMAE10D: number | null;
  expectedReturnR: number | null;
  providerIssueRate: number | null;
  dataIncompleteRate: number | null;
  rollbackRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'TRIGGERED';
}

export interface StrategyVersion {
  versionId: string;
  versionName: string;
  createdAt: string;
  createdBy: 'GOVERNANCE' | 'OPERATOR' | 'SYSTEM';
  baseVersionId: string | null;
  status: StrategyVersionStatus;
  sourceGovernanceItems: string[];
  configSnapshot: StrategyConfigSnapshot;
  diffFromBase: StrategyVersionDiff;
  rolloutPolicy: RolloutPolicy;
  rollbackPlan: RollbackPlan;
  validation: StrategyValidationResult;
  performance?: StrategyVersionPerformance;
  auditTrailIds: string[];
  configHash: string;
  executionImpact: 'NONE';
}

export interface StrategyAuditLog {
  auditId: string;
  timestamp: string;
  actor: string;
  action:
    | 'CREATE_VERSION'
    | 'VALIDATE_VERSION'
    | 'APPLY_SHADOW'
    | 'APPLY_CANARY'
    | 'APPLY_LIVE'
    | 'ROLLBACK'
    | 'PAUSE_VERSION'
    | 'REJECT_VERSION';
  versionId: string;
  targetStage?: string;
  reason: string;
  beforeRegistry: object;
  afterRegistry: object;
  configHash: string;
  executionImpact: 'NONE';
}

const STAGE_ORDER: PromotionStage[] = ['OBSERVE', 'SHADOW_SCORE', 'ADVISORY', 'WEIGHTED', 'GATED', 'CORE'];

function nowIso(): string {
  return new Date().toISOString();
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function stageIndex(stage: PromotionStage): number {
  return STAGE_ORDER.indexOf(stage);
}

function rate(n: number, d: number): number | null {
  return d > 0 ? round4(n / d) : null;
}

function avg(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!nums.length) return null;
  return round4(nums.reduce((sum, value) => sum + value, 0) / nums.length);
}

function registryWeightGroups(registry: readonly FactorDefinition[]): Pick<StrategyConfigSnapshot, 'gate1Weights' | 'gate2Weights' | 'gate3Weights' | 'factorPromotionStages'> {
  const gate1Weights: Record<string, number> = {};
  const gate2Weights: Record<string, number> = {};
  const gate3Weights: Record<string, number> = {};
  const factorPromotionStages: Record<string, PromotionStage> = {};
  for (const def of registry) {
    if (def.factorGroup === 'GATE1') gate1Weights[def.factorName] = def.currentWeight;
    if (def.factorGroup === 'GATE2') gate2Weights[def.factorName] = def.currentWeight;
    if (def.factorGroup === 'GATE3') gate3Weights[def.factorName] = def.currentWeight;
    factorPromotionStages[def.factorName] = def.promotionStage;
  }
  return { gate1Weights, gate2Weights, gate3Weights, factorPromotionStages };
}

export function buildStrategyConfigSnapshot(input: {
  registry?: readonly FactorDefinition[];
  metadata?: StrategyConfigSnapshot['metadata'];
} = {}): StrategyConfigSnapshot {
  const weights = registryWeightGroups(input.registry ?? DEFAULT_FACTOR_REGISTRY);
  return {
    ...weights,
    gateThresholds: {
      gate1RequiredAvg: 70,
      gate2PassStrong: 80,
      gate2PassWeak: 65,
      gate3Ready: 85,
      gate3TriggerWait: 70,
    },
    policySettings: {
      sellOnlyPolicy: { liveBuyAllowed: false, liveSellAllowed: true },
      r6Policy: { liveBuyAllowed: false, shadowLearning: true },
      observeOnlyPolicy: { brokerOrderAllowed: false, counterfactualAllowed: true },
      shadowOnlyPolicy: { liveAllowed: false, paperOrderAllowed: true },
      providerIssuePolicy: { marketSignal: false, confidenceDowngradeOnly: true },
    },
    confidenceRules: {
      aiEstimatedMaxStage: 'ADVISORY',
      providerMissingBehavior: 'MISSING',
      dataConfidenceCeilingRules: { lowBlocksLive: true, shadowLearning: true },
    },
    riskGuards: {
      maxSingleFactorWeight: 40,
      maxGateWeightDeltaPerVersion: 10,
      maxCoreWeightDeltaPerVersion: 2,
      falsePositiveRollbackThreshold: 0.05,
      expectedReturnRollbackThreshold: 1,
    },
    metadata: input.metadata ?? {},
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `${JSON.stringify(key)}:${stableJson(val)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function strategyConfigHash(snapshot: StrategyConfigSnapshot): string {
  return createHash('sha256').update(stableJson(snapshot)).digest('hex');
}

function factorGroupFor(base: StrategyConfigSnapshot, factorName: string): FactorGroup {
  if (factorName in base.gate1Weights) return 'GATE1';
  if (factorName in base.gate2Weights) return 'GATE2';
  if (factorName in base.gate3Weights) return 'GATE3';
  if (factorName.includes('POLICY') || factorName.includes('BLOCK')) return 'POLICY';
  return 'CONFIDENCE';
}

function weightFor(snapshot: StrategyConfigSnapshot, factorName: string): number {
  return snapshot.gate1Weights[factorName]
    ?? snapshot.gate2Weights[factorName]
    ?? snapshot.gate3Weights[factorName]
    ?? 0;
}

function setWeight(snapshot: StrategyConfigSnapshot, group: FactorGroup, factorName: string, value: number): void {
  if (group === 'GATE1') snapshot.gate1Weights[factorName] = value;
  if (group === 'GATE2') snapshot.gate2Weights[factorName] = value;
  if (group === 'GATE3') snapshot.gate3Weights[factorName] = value;
}

export function buildStrategyVersionDiff(base: StrategyConfigSnapshot, next: StrategyConfigSnapshot): StrategyVersionDiff {
  const factorNames = new Set([
    ...Object.keys(base.gate1Weights),
    ...Object.keys(base.gate2Weights),
    ...Object.keys(base.gate3Weights),
    ...Object.keys(next.gate1Weights),
    ...Object.keys(next.gate2Weights),
    ...Object.keys(next.gate3Weights),
  ]);
  const weightChanges = [...factorNames]
    .map((factorName) => {
      const oldWeight = weightFor(base, factorName);
      const newWeight = weightFor(next, factorName);
      return {
        factorName,
        group: factorGroupFor(base, factorName),
        oldWeight,
        newWeight,
        delta: round4(newWeight - oldWeight),
      };
    })
    .filter(change => change.delta !== 0);
  const stageNames = new Set([...Object.keys(base.factorPromotionStages), ...Object.keys(next.factorPromotionStages)]);
  const stageChanges = [...stageNames]
    .map(factorName => ({
      factorName,
      oldStage: base.factorPromotionStages[factorName] ?? 'OBSERVE',
      newStage: next.factorPromotionStages[factorName] ?? 'OBSERVE',
    }))
    .filter(change => change.oldStage !== change.newStage);
  const thresholdChanges = Object.entries(next.gateThresholds)
    .map(([thresholdName, newValue]) => {
      const oldValue = base.gateThresholds[thresholdName as keyof StrategyConfigSnapshot['gateThresholds']];
      return { thresholdName, oldValue, newValue, delta: round4(newValue - oldValue) };
    })
    .filter(change => change.delta !== 0);
  const highRisk = stageChanges.some(change => change.newStage === 'CORE' || change.newStage === 'GATED')
    || weightChanges.some(change => Math.abs(change.delta) > 5);
  return {
    weightChanges,
    stageChanges,
    thresholdChanges,
    policyChanges: [],
    riskLevel: highRisk ? 'HIGH' : weightChanges.length + stageChanges.length > 0 ? 'MEDIUM' : 'LOW',
  };
}

export function applyGovernanceDraftToConfig(
  base: StrategyConfigSnapshot,
  draft: GovernanceStrategyVersionDraft,
): StrategyConfigSnapshot {
  const next: StrategyConfigSnapshot = JSON.parse(JSON.stringify(base)) as StrategyConfigSnapshot;
  for (const change of draft.weightChanges) {
    const group = factorGroupFor(base, change.factorName);
    setWeight(next, group, change.factorName, change.newWeight);
  }
  for (const change of draft.stageChanges) {
    next.factorPromotionStages[change.factorName] = change.newStage;
  }
  next.metadata = {
    ...next.metadata,
    governanceBatchId: draft.draftId,
    notes: 'ADR-0526 generated from approved governance draft',
  };
  return next;
}

export function defaultRolloutPolicy(): RolloutPolicy {
  return {
    allowedStages: ['SHADOW', 'CANARY', 'LIVE'],
    currentStage: null,
    shadowDurationDays: 5,
    canaryDurationDays: 5,
    canaryScope: {
      maxSymbols: 5,
      maxCapitalPct: 5,
      allowedModes: ['SHADOW_ONLY', 'DEGRADED', 'NORMAL'],
    },
    promotionCriteria: {
      minSamples: 30,
      maxFalsePositiveRate: 0.15,
      minExpectedReturn10D: 1,
      maxMissedWinIncrease: 0.05,
      maxDrawdownProxy: 5,
    },
    autoPromoteAllowed: false,
  };
}

function validateStageSequential(item: GovernanceReviewItem): boolean {
  if (item.currentStage === item.proposedStage) return true;
  return stageIndex(item.proposedStage) - stageIndex(item.currentStage) === 1;
}

export function validateStrategyVersion(
  version: Pick<StrategyVersion, 'diffFromBase' | 'rollbackPlan' | 'sourceGovernanceItems'> & {
    governanceItems?: readonly GovernanceReviewItem[];
    createdAt?: string;
  },
): StrategyValidationResult {
  const failedReasons: string[] = [];
  const warningReasons: string[] = [];
  const requiredApprovals = [...version.sourceGovernanceItems];
  if (!version.rollbackPlan?.rollbackPlanId) failedReasons.push('ROLLBACK_PLAN_MISSING');
  for (const change of version.diffFromBase.weightChanges) {
    if (change.newWeight < 0) failedReasons.push(`NEGATIVE_WEIGHT:${change.factorName}`);
    if (change.newWeight > 40) failedReasons.push(`MAX_SINGLE_FACTOR_WEIGHT_EXCEEDED:${change.factorName}`);
  }
  const gateDelta = version.diffFromBase.weightChanges.reduce((sum, change) => sum + Math.abs(change.delta), 0);
  if (gateDelta > 10) failedReasons.push('MAX_GATE_WEIGHT_DELTA_PER_VERSION_EXCEEDED');
  for (const item of version.governanceItems ?? []) {
    if (item.status !== 'APPROVED') failedReasons.push(`GOVERNANCE_APPROVAL_MISSING:${item.itemId}`);
    if (!validateStageSequential(item)) failedReasons.push(`PROMOTION_STAGE_SKIP:${item.factorName}`);
    if (item.proposedStage === 'CORE' && item.evidence.sampleCount < 300) failedReasons.push(`CORE_SAMPLE_REQUIREMENT:${item.factorName}`);
    if (item.proposedStage === 'CORE' && item.factorName.includes('AI_ESTIMATED')) failedReasons.push(`AI_ESTIMATED_CORE_FORBIDDEN:${item.factorName}`);
    if (stageIndex(item.proposedStage) >= stageIndex('WEIGHTED') && item.simulationResult?.verdict !== 'PASS') {
      failedReasons.push(`SIMULATION_PASS_REQUIRED:${item.factorName}`);
    }
  }
  if (version.diffFromBase.weightChanges.length === 0 && version.diffFromBase.stageChanges.length === 0) {
    warningReasons.push('NO_CONFIG_DIFF');
  }
  const riskLevel = failedReasons.length > 0 ? 'BLOCKED' : version.diffFromBase.riskLevel;
  return {
    passed: failedReasons.length === 0,
    failedReasons,
    warningReasons,
    riskLevel,
    requiredApprovals,
    validationTimestamp: version.createdAt ?? nowIso(),
  };
}

export function createStrategyVersionFromGovernanceDraft(input: {
  draft: GovernanceStrategyVersionDraft;
  rollbackPlan: RollbackPlan;
  baseConfig?: StrategyConfigSnapshot;
  baseVersionId?: string | null;
  createdAt?: string;
}): StrategyVersion {
  const createdAt = input.createdAt ?? nowIso();
  const baseConfig = input.baseConfig ?? buildStrategyConfigSnapshot();
  const configSnapshot = applyGovernanceDraftToConfig(baseConfig, input.draft);
  const diffFromBase = buildStrategyVersionDiff(baseConfig, configSnapshot);
  const versionId = input.draft.proposedVersion;
  const partial = {
    diffFromBase,
    rollbackPlan: input.rollbackPlan,
    sourceGovernanceItems: input.draft.approvedItems.map(item => item.itemId),
    governanceItems: input.draft.approvedItems,
    createdAt,
  };
  const validation = validateStrategyVersion(partial);
  return {
    versionId,
    versionName: versionId,
    createdAt,
    createdBy: 'GOVERNANCE',
    baseVersionId: input.baseVersionId ?? input.draft.baseVersion,
    status: validation.passed ? 'READY_FOR_SHADOW' : 'DRAFT',
    sourceGovernanceItems: partial.sourceGovernanceItems,
    configSnapshot,
    diffFromBase,
    rolloutPolicy: defaultRolloutPolicy(),
    rollbackPlan: input.rollbackPlan,
    validation,
    auditTrailIds: [],
    configHash: strategyConfigHash(configSnapshot),
    executionImpact: 'NONE',
  };
}

export function buildStrategyVersionPerformance(input: {
  versionId: string;
  stage: RolloutStage;
  seeds: readonly OutcomeSeed[];
}): StrategyVersionPerformance {
  const matching = input.seeds.filter(seed =>
    seed.liveStrategyVersionId === input.versionId
    || seed.shadowStrategyVersionId === input.versionId
    || seed.canaryStrategyVersionId === input.versionId,
  );
  const labeled = matching.filter(seed => seed.outcomeStatus === 'LABELED');
  const label = (name: string) => labeled.filter(seed => seed.finalLearningLabel === name || seed.outcomeLabel === name).length;
  const returns5 = labeled.map(seed => seed.forwardReturns?.['5D']?.returnPct ?? null);
  const returns10 = labeled.map(seed => seed.forwardReturns?.['10D']?.returnPct ?? null);
  const falsePositiveRate = rate(label('FALSE_POSITIVE') + label('LOSS'), labeled.length);
  const avgReturn10D = avg(returns10);
  const rollbackRisk: StrategyVersionPerformance['rollbackRisk'] =
    (falsePositiveRate ?? 0) >= 0.25 || (avgReturn10D ?? 0) < -1 ? 'TRIGGERED'
      : (falsePositiveRate ?? 0) >= 0.15 ? 'HIGH'
        : (falsePositiveRate ?? 0) >= 0.1 ? 'MEDIUM' : 'LOW';
  return {
    versionId: input.versionId,
    stage: input.stage,
    sampleCount: matching.length,
    seedCount: matching.length,
    labeledCount: labeled.length,
    gate1PassRate: rate(matching.filter(seed => seed.gate1Status.includes('PASS')).length, matching.length),
    gate2PassRate: rate(matching.filter(seed => seed.gate2Status.includes('PASS')).length, matching.length),
    gate3ReadyRate: rate(matching.filter(seed => seed.gate3Readiness.includes('READY')).length, matching.length),
    winRate: rate(label('WIN') + label('PARTIAL_WIN'), labeled.length),
    falsePositiveRate,
    missedWinRate: rate(label('MISSED_WIN'), labeled.length),
    avoidedLossRate: rate(label('AVOIDED_LOSS'), labeled.length),
    avgReturn5D: avg(returns5),
    avgReturn10D,
    avgMFE10D: avg(labeled.map(seed => seed.forwardReturns?.['10D']?.mfePct ?? null)),
    avgMAE10D: avg(labeled.map(seed => seed.forwardReturns?.['10D']?.maePct ?? null)),
    expectedReturnR: avgReturn10D == null ? null : round4(avgReturn10D / 5),
    providerIssueRate: rate(matching.filter(seed => seed.providerIssue).length, matching.length),
    dataIncompleteRate: rate(matching.filter(seed => seed.gate3Readiness === 'DATA_INCOMPLETE').length, matching.length),
    rollbackRisk,
  };
}

export class StrategyVersionMemoryRepo {
  private readonly versions = new Map<string, StrategyVersion>();
  private registry: ActiveStrategyRegistry = {
    liveVersionId: 'strategy-base-live',
    shadowVersionId: 'strategy-base-shadow',
    activeSince: '1970-01-01T00:00:00.000Z',
    pendingDraftVersionIds: [],
  };
  private readonly auditLogs: StrategyAuditLog[] = [];

  createVersion(version: StrategyVersion, actor = 'governance'): StrategyVersion {
    if (this.versions.has(version.versionId)) throw new Error(`STRATEGY_VERSION_ALREADY_EXISTS:${version.versionId}`);
    this.versions.set(version.versionId, version);
    this.registry = {
      ...this.registry,
      pendingDraftVersionIds: [...new Set([...this.registry.pendingDraftVersionIds, version.versionId])],
    };
    this.audit(actor, 'CREATE_VERSION', version.versionId, 'strategy version created', this.registry, this.registry, version.configHash);
    return version;
  }

  createVersionFromGovernanceDraft(input: {
    draft: GovernanceStrategyVersionDraft;
    rollbackPlan: RollbackPlan;
    baseConfig?: StrategyConfigSnapshot;
    actor?: string;
  }): StrategyVersion {
    return this.createVersion(createStrategyVersionFromGovernanceDraft({
      draft: input.draft,
      rollbackPlan: input.rollbackPlan,
      baseConfig: input.baseConfig,
    }), input.actor ?? 'governance');
  }

  getVersion(versionId: string): StrategyVersion | undefined {
    return this.versions.get(versionId);
  }

  listVersions(): StrategyVersion[] {
    return [...this.versions.values()];
  }

  getRegistry(): ActiveStrategyRegistry {
    return { ...this.registry, pendingDraftVersionIds: [...this.registry.pendingDraftVersionIds] };
  }

  applyStrategyVersion(versionId: string, targetStage: RolloutStage, actor = 'operator'): StrategyVersion {
    const version = this.requireVersion(versionId);
    if (!version.validation.passed) throw new Error(`STRATEGY_VERSION_VALIDATION_FAILED:${version.validation.failedReasons.join(',')}`);
    if (!version.rollbackPlan?.rollbackPlanId) throw new Error('ROLLBACK_PLAN_REQUIRED');
    if (targetStage === 'LIVE' && version.status !== 'READY_FOR_LIVE') throw new Error(`LIVE_APPLY_REQUIRES_READY_FOR_LIVE:${version.status}`);
    if (targetStage === 'CANARY' && version.status !== 'READY_FOR_CANARY') throw new Error(`CANARY_APPLY_REQUIRES_READY_FOR_CANARY:${version.status}`);
    if (targetStage === 'SHADOW' && !['READY_FOR_SHADOW', 'DRAFT'].includes(version.status)) throw new Error(`SHADOW_APPLY_NOT_ALLOWED:${version.status}`);
    const before = this.getRegistry();
    const afterRegistry: ActiveStrategyRegistry = {
      ...before,
      activeSince: nowIso(),
      pendingDraftVersionIds: before.pendingDraftVersionIds.filter(id => id !== versionId),
    };
    let nextStatus: StrategyVersionStatus;
    let action: StrategyAuditLog['action'];
    if (targetStage === 'SHADOW') {
      afterRegistry.previousShadowVersionId = before.shadowVersionId;
      afterRegistry.shadowVersionId = versionId;
      nextStatus = 'SHADOW_ACTIVE';
      action = 'APPLY_SHADOW';
    } else if (targetStage === 'CANARY') {
      afterRegistry.canaryVersionId = versionId;
      nextStatus = 'CANARY_ACTIVE';
      action = 'APPLY_CANARY';
    } else {
      afterRegistry.previousLiveVersionId = before.liveVersionId;
      afterRegistry.liveVersionId = versionId;
      nextStatus = 'LIVE_ACTIVE';
      action = 'APPLY_LIVE';
    }
    this.registry = afterRegistry;
    const updated = {
      ...version,
      status: nextStatus,
      rolloutPolicy: { ...version.rolloutPolicy, currentStage: targetStage },
    };
    this.versions.set(versionId, updated);
    this.audit(actor, action, versionId, `${targetStage} apply`, before, afterRegistry, version.configHash, targetStage);
    return updated;
  }

  markReady(versionId: string, status: Extract<StrategyVersionStatus, 'READY_FOR_CANARY' | 'READY_FOR_LIVE'>): StrategyVersion {
    const version = this.requireVersion(versionId);
    const updated = { ...version, status };
    this.versions.set(versionId, updated);
    return updated;
  }

  rollbackStrategyVersion(target: RolloutStage, reason: string, actor = 'operator'): ActiveStrategyRegistry {
    const before = this.getRegistry();
    const after: ActiveStrategyRegistry = { ...before, lastRollbackAt: nowIso() };
    const currentId = target === 'LIVE' ? before.liveVersionId : target === 'SHADOW' ? before.shadowVersionId : before.canaryVersionId;
    if (!currentId) throw new Error(`NO_ACTIVE_${target}_VERSION`);
    if (target === 'LIVE') {
      after.liveVersionId = before.previousLiveVersionId ?? before.liveVersionId;
    } else if (target === 'SHADOW') {
      after.shadowVersionId = before.previousShadowVersionId ?? before.shadowVersionId;
    } else {
      delete after.canaryVersionId;
    }
    this.registry = after;
    const current = this.versions.get(currentId);
    if (current) this.versions.set(currentId, { ...current, status: 'ROLLED_BACK' });
    this.audit(actor, 'ROLLBACK', currentId, reason || 'manual rollback', before, after, current?.configHash ?? 'unknown', target);
    return after;
  }

  detectConfigDrift(versionId: string, actualConfig: StrategyConfigSnapshot): {
    configDriftDetected: boolean;
    activeConfigHash: string;
    expectedConfigHash: string;
  } {
    const version = this.requireVersion(versionId);
    const activeConfigHash = strategyConfigHash(actualConfig);
    return {
      configDriftDetected: activeConfigHash !== version.configHash,
      activeConfigHash,
      expectedConfigHash: version.configHash,
    };
  }

  safeApplyStrategyVersion(versionId: string, targetStage: RolloutStage, actor = 'operator'): {
    ok: boolean;
    registry: ActiveStrategyRegistry;
    safeMode: 'NONE' | 'DEGRADED' | 'SHADOW_ONLY';
    reason?: string;
    executionImpact: 'NONE';
    shadowLearning: true;
  } {
    try {
      this.applyStrategyVersion(versionId, targetStage, actor);
      return { ok: true, registry: this.getRegistry(), safeMode: 'NONE', executionImpact: 'NONE', shadowLearning: true };
    } catch (error) {
      this.audit(actor, 'PAUSE_VERSION', versionId, `CASE_STRATEGY_VERSION_APPLY_FAILED:${error instanceof Error ? error.message : String(error)}`, this.registry, this.registry, 'unknown', targetStage);
      return {
        ok: false,
        registry: this.getRegistry(),
        safeMode: targetStage === 'LIVE' ? 'SHADOW_ONLY' : 'DEGRADED',
        reason: error instanceof Error ? error.message : String(error),
        executionImpact: 'NONE',
        shadowLearning: true,
      };
    }
  }

  listAuditLogs(): StrategyAuditLog[] {
    return [...this.auditLogs];
  }

  reset(): void {
    this.versions.clear();
    this.registry = {
      liveVersionId: 'strategy-base-live',
      shadowVersionId: 'strategy-base-shadow',
      activeSince: '1970-01-01T00:00:00.000Z',
      pendingDraftVersionIds: [],
    };
    this.auditLogs.length = 0;
  }

  private requireVersion(versionId: string): StrategyVersion {
    const version = this.versions.get(versionId);
    if (!version) throw new Error(`STRATEGY_VERSION_NOT_FOUND:${versionId}`);
    return version;
  }

  private audit(
    actor: string,
    action: StrategyAuditLog['action'],
    versionId: string,
    reason: string,
    beforeRegistry: object,
    afterRegistry: object,
    configHash: string,
    targetStage?: string,
  ): void {
    this.auditLogs.push({
      auditId: `strategy-audit-${this.auditLogs.length + 1}`,
      timestamp: nowIso(),
      actor,
      action,
      versionId,
      ...(targetStage ? { targetStage } : {}),
      reason,
      beforeRegistry,
      afterRegistry,
      configHash,
      executionImpact: 'NONE',
    });
  }
}

export function formatStrategyCompact(repo: StrategyVersionMemoryRepo): string {
  const registry = repo.getRegistry();
  const latestApply = repo.listAuditLogs().filter(log => log.action.startsWith('APPLY')).at(-1);
  return [
    '[Strategy]',
    `live: ${registry.liveVersionId}`,
    `shadow: ${registry.shadowVersionId}`,
    `canary: ${registry.canaryVersionId ?? 'none'}`,
    `pending: ${registry.pendingDraftVersionIds.length}`,
    `lastApply: ${latestApply?.timestamp ?? 'N/A'}`,
    `rollbackReady: ${registry.previousLiveVersionId || registry.previousShadowVersionId ? 'yes' : 'no'}`,
    'drift: no',
    'impact: NONE',
  ].join('\n');
}

export function formatStrategyDetail(repo: StrategyVersionMemoryRepo): string {
  return [
    formatStrategyCompact(repo),
    '',
    'Versions:',
    ...repo.listVersions().slice(0, 20).map(version =>
      `- ${version.versionId} status=${version.status} risk=${version.validation.riskLevel} changes=${version.diffFromBase.weightChanges.length + version.diffFromBase.stageChanges.length} hash=${version.configHash.slice(0, 12)}`,
    ),
  ].join('\n');
}

export function formatStrategyVersion(version: StrategyVersion): string {
  return [
    '[Strategy Version]',
    `id: ${version.versionId}`,
    `status: ${version.status}`,
    `base: ${version.baseVersionId ?? 'none'}`,
    `hash: ${version.configHash}`,
    `validation: ${version.validation.passed ? 'PASS' : 'FAIL'}`,
    `risk: ${version.validation.riskLevel}`,
    `weights: ${version.diffFromBase.weightChanges.length}`,
    `stages: ${version.diffFromBase.stageChanges.length}`,
    `rollback: ${version.rollbackPlan.rollbackPlanId}`,
    `autoPromote: ${version.rolloutPolicy.autoPromoteAllowed}`,
    'impact: NONE',
  ].join('\n');
}

export function formatStrategyDiff(version: StrategyVersion): string {
  return [
    '[Strategy Diff]',
    `version: ${version.versionId}`,
    'Weight Changes:',
    ...version.diffFromBase.weightChanges.map(change => `- ${change.factorName} ${change.oldWeight}->${change.newWeight} delta=${change.delta}`),
    'Stage Changes:',
    ...version.diffFromBase.stageChanges.map(change => `- ${change.factorName} ${change.oldStage}->${change.newStage}`),
    `risk: ${version.diffFromBase.riskLevel}`,
    'impact: NONE',
  ].join('\n');
}

export const strategyVersionRepo = new StrategyVersionMemoryRepo();
