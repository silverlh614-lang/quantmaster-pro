// @responsibility ADR-0524 Dynamic Weight Feedback report engine. Suggest-only; never mutates CORE weights.

import {
  buildGateAttribution,
  type ForwardReturnSnapshot,
  type GateAttribution,
  type OutcomeLabel,
  type OutcomeSeed,
} from './outcomeClosure.js';

export type FactorGroup = 'GATE1' | 'GATE2' | 'GATE3' | 'POLICY' | 'CONFIDENCE';
export type PromotionStage = 'OBSERVE' | 'SHADOW_SCORE' | 'ADVISORY' | 'WEIGHTED' | 'GATED' | 'CORE';
type FactorDataSource = 'KIS' | 'DART' | 'YAHOO' | 'KRX' | 'INTERNAL' | 'AI_ESTIMATED' | 'MIXED';
type FactorConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT_SAMPLE';
type FactorDirection = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'UNSTABLE' | 'INSUFFICIENT';
export type SuggestedWeightAction =
  | 'INCREASE'
  | 'DECREASE'
  | 'KEEP'
  | 'QUARANTINE'
  | 'PROMOTE_STAGE'
  | 'DEMOTE_STAGE'
  | 'INSUFFICIENT_SAMPLE'
  | 'NEEDS_REVIEW';

export interface FactorDefinition {
  factorName: string;
  factorGroup: FactorGroup;
  currentWeight: number;
  minWeight: number;
  maxWeight: number;
  promotionStage: PromotionStage;
  dataSource: FactorDataSource;
  isCoreProtected: boolean;
  canAutoSuggest: boolean;
}

export interface FactorPerformanceStats {
  factorName: string;
  factorGroup: FactorGroup;
  sampleCount: number;
  liveSampleCount: number;
  shadowSampleCount: number;
  counterfactualSampleCount: number;
  winCount: number;
  lossCount: number;
  missedWinCount: number;
  avoidedLossCount: number;
  falsePositiveCount: number;
  trueNegativeCount: number;
  winRate: number | null;
  lossRate: number | null;
  missedWinRate: number | null;
  avoidedLossRate: number | null;
  falsePositiveRate: number | null;
  avgReturn5D: number | null;
  avgReturn10D: number | null;
  avgMFE10D: number | null;
  avgMAE10D: number | null;
  profitFactorProxy: number | null;
  expectancyR: number | null;
  providerIssueSampleCount: number;
  dataInsufficientExcludedCount: number;
}

export interface FactorContributionScore {
  factorName: string;
  factorGroup: FactorGroup;
  contributionScore: number | null;
  confidence: FactorConfidence;
  direction: FactorDirection;
  reason: string[];
}

export interface SuggestedWeightActionRecord {
  factorName: string;
  factorGroup: FactorGroup;
  currentWeight: number;
  proposedWeight: number;
  suggestedAction: SuggestedWeightAction;
  suggestedWeightDelta: number;
  suggestedStageChange?: PromotionStage;
  reason: string[];
  confidence: FactorConfidence;
  contributionScore: number | null;
  sampleCount: number;
  approvalRequired: true;
}

export interface OverBlockStats {
  blockReason: string;
  blockedCount: number;
  missedWinCount: number;
  avoidedLossCount: number;
  neutralCount: number;
  missedWinRate: number;
  avoidedLossRate: number;
  suggestedPolicyAction: 'KEEP_BLOCK' | 'RELAX_BLOCK' | 'TIGHTEN_BLOCK' | 'SPLIT_BY_CONTEXT' | 'INSUFFICIENT_SAMPLE';
}

export interface GovernanceReviewItem {
  itemId: string;
  factorName: string;
  suggestedAction: SuggestedWeightAction;
  currentWeight: number;
  proposedWeight: number;
  currentStage: string;
  proposedStage?: string;
  evidenceSampleCount: number;
  contributionScore: number | null;
  confidence: string;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  approvalRequired: true;
  autoApplyAllowed: false;
}

export interface WeightFeedbackReport {
  reportId: string;
  createdAt: string;
  sampleWindow: {
    start: string;
    end: string;
  };
  totalValidSamples: number;
  excludedSamples: number;
  insufficientSampleFactors: number;
  factorStats: FactorPerformanceStats[];
  contributionScores: FactorContributionScore[];
  suggestedActions: SuggestedWeightActionRecord[];
  overBlockStats: OverBlockStats[];
  falsePositiveFactors: string[];
  missedWinFactors: string[];
  governanceItems: GovernanceReviewItem[];
  governanceStatus: 'REPORT_ONLY' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
  executionImpact: 'NONE';
}

interface FactorEvidenceSample {
  seed: OutcomeSeed;
  factorName: string;
  factorGroup: FactorGroup;
  factorValue: number | string | boolean | null;
}

const VALID_LABELS = new Set<OutcomeLabel>([
  'WIN',
  'LOSS',
  'PARTIAL_WIN',
  'BREAKEVEN',
  'MISSED_WIN',
  'AVOIDED_LOSS',
  'FALSE_POSITIVE',
  'TRUE_NEGATIVE',
]);

export const DEFAULT_FACTOR_REGISTRY: FactorDefinition[] = [
  { factorName: 'liquidityFloor', factorGroup: 'GATE1', currentWeight: 10, minWeight: 0, maxWeight: 25, promotionStage: 'GATED', dataSource: 'INTERNAL', isCoreProtected: true, canAutoSuggest: true },
  { factorName: 'quoteFreshness', factorGroup: 'GATE1', currentWeight: 10, minWeight: 0, maxWeight: 25, promotionStage: 'GATED', dataSource: 'KIS', isCoreProtected: true, canAutoSuggest: true },
  { factorName: 'watchlistScore', factorGroup: 'GATE1', currentWeight: 15, minWeight: 0, maxWeight: 30, promotionStage: 'WEIGHTED', dataSource: 'INTERNAL', isCoreProtected: false, canAutoSuggest: true },
  { factorName: 'maAlignmentDampener', factorGroup: 'GATE1', currentWeight: 8, minWeight: 0, maxWeight: 20, promotionStage: 'ADVISORY', dataSource: 'YAHOO', isCoreProtected: false, canAutoSuggest: true },
  { factorName: 'rsScore', factorGroup: 'GATE1', currentWeight: 15, minWeight: 0, maxWeight: 30, promotionStage: 'WEIGHTED', dataSource: 'KRX', isCoreProtected: false, canAutoSuggest: true },
  { factorName: 'technicalTrendDeath', factorGroup: 'GATE1', currentWeight: 20, minWeight: 0, maxWeight: 30, promotionStage: 'GATED', dataSource: 'YAHOO', isCoreProtected: true, canAutoSuggest: true },
  { factorName: 'RS_RELATIVE_STRENGTH', factorGroup: 'GATE2', currentWeight: 25, minWeight: 0, maxWeight: 35, promotionStage: 'WEIGHTED', dataSource: 'KRX', isCoreProtected: false, canAutoSuggest: true },
  { factorName: 'SUPPLY_CONFLUENCE', factorGroup: 'GATE2', currentWeight: 25, minWeight: 0, maxWeight: 35, promotionStage: 'WEIGHTED', dataSource: 'KIS', isCoreProtected: false, canAutoSuggest: true },
  { factorName: 'SECTOR_LEADERSHIP', factorGroup: 'GATE2', currentWeight: 20, minWeight: 0, maxWeight: 30, promotionStage: 'ADVISORY', dataSource: 'KRX', isCoreProtected: false, canAutoSuggest: true },
  { factorName: 'TECHNICAL_TREND', factorGroup: 'GATE2', currentWeight: 15, minWeight: 0, maxWeight: 25, promotionStage: 'WEIGHTED', dataSource: 'YAHOO', isCoreProtected: false, canAutoSuggest: true },
  { factorName: 'FUNDAMENTAL_QUALITY', factorGroup: 'GATE2', currentWeight: 15, minWeight: 0, maxWeight: 25, promotionStage: 'WEIGHTED', dataSource: 'DART', isCoreProtected: false, canAutoSuggest: true },
  { factorName: 'AI_ESTIMATED_FUNDAMENTAL', factorGroup: 'GATE2', currentWeight: 0, minWeight: 0, maxWeight: 10, promotionStage: 'OBSERVE', dataSource: 'AI_ESTIMATED', isCoreProtected: false, canAutoSuggest: false },
  { factorName: 'RRR_PROFILE', factorGroup: 'GATE3', currentWeight: 30, minWeight: 0, maxWeight: 40, promotionStage: 'WEIGHTED', dataSource: 'INTERNAL', isCoreProtected: false, canAutoSuggest: true },
  { factorName: 'LAST_TRIGGER', factorGroup: 'GATE3', currentWeight: 25, minWeight: 0, maxWeight: 35, promotionStage: 'GATED', dataSource: 'INTERNAL', isCoreProtected: true, canAutoSuggest: true },
  { factorName: 'PRICE_CONFIRMATION', factorGroup: 'GATE3', currentWeight: 15, minWeight: 0, maxWeight: 25, promotionStage: 'WEIGHTED', dataSource: 'KIS', isCoreProtected: false, canAutoSuggest: true },
  { factorName: 'VOLUME_CONFIRMATION', factorGroup: 'GATE3', currentWeight: 15, minWeight: 0, maxWeight: 25, promotionStage: 'WEIGHTED', dataSource: 'KIS', isCoreProtected: false, canAutoSuggest: true },
  { factorName: 'FALSE_BREAKOUT_GUARD', factorGroup: 'GATE3', currentWeight: 10, minWeight: 0, maxWeight: 20, promotionStage: 'ADVISORY', dataSource: 'INTERNAL', isCoreProtected: false, canAutoSuggest: true },
  { factorName: 'DATA_FRESHNESS', factorGroup: 'GATE3', currentWeight: 5, minWeight: 0, maxWeight: 15, promotionStage: 'GATED', dataSource: 'KIS', isCoreProtected: true, canAutoSuggest: true },
  { factorName: 'SELL_ONLY_BLOCK', factorGroup: 'POLICY', currentWeight: 0, minWeight: 0, maxWeight: 0, promotionStage: 'CORE', dataSource: 'INTERNAL', isCoreProtected: true, canAutoSuggest: true },
  { factorName: 'R6_DEFENSE_BLOCK', factorGroup: 'POLICY', currentWeight: 0, minWeight: 0, maxWeight: 0, promotionStage: 'CORE', dataSource: 'INTERNAL', isCoreProtected: true, canAutoSuggest: true },
  { factorName: 'OBSERVE_ONLY_BLOCK', factorGroup: 'POLICY', currentWeight: 0, minWeight: 0, maxWeight: 0, promotionStage: 'CORE', dataSource: 'INTERNAL', isCoreProtected: true, canAutoSuggest: true },
  { factorName: 'DIAGNOSTIC_ONLY_BLOCK', factorGroup: 'POLICY', currentWeight: 0, minWeight: 0, maxWeight: 0, promotionStage: 'CORE', dataSource: 'INTERNAL', isCoreProtected: true, canAutoSuggest: true },
  { factorName: 'providerIssueDowngrade', factorGroup: 'CONFIDENCE', currentWeight: 0, minWeight: 0, maxWeight: 0, promotionStage: 'ADVISORY', dataSource: 'MIXED', isCoreProtected: false, canAutoSuggest: true },
  { factorName: 'dataConfidenceCeiling', factorGroup: 'CONFIDENCE', currentWeight: 0, minWeight: 0, maxWeight: 0, promotionStage: 'ADVISORY', dataSource: 'INTERNAL', isCoreProtected: false, canAutoSuggest: true },
  { factorName: 'AI_ESTIMATED_EXCLUDED', factorGroup: 'CONFIDENCE', currentWeight: 0, minWeight: 0, maxWeight: 0, promotionStage: 'OBSERVE', dataSource: 'AI_ESTIMATED', isCoreProtected: false, canAutoSuggest: false },
  { factorName: 'DATA_INCOMPLETE', factorGroup: 'CONFIDENCE', currentWeight: 0, minWeight: 0, maxWeight: 0, promotionStage: 'OBSERVE', dataSource: 'INTERNAL', isCoreProtected: false, canAutoSuggest: true },
];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? round2(numerator / denominator) : null;
}

function avg(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (nums.length === 0) return null;
  return round2(nums.reduce((sum, value) => sum + value, 0) / nums.length);
}

function sum(values: Array<number | null | undefined>): number {
  return values.reduce<number>((total, value) => total + (typeof value === 'number' && Number.isFinite(value) ? value : 0), 0);
}

function horizon(seed: OutcomeSeed, key: '5D' | '10D'): ForwardReturnSnapshot | undefined {
  return seed.forwardReturns?.[key];
}

function hasRequiredForwardEvidence(seed: OutcomeSeed): boolean {
  if (seed.forwardReturns?.['5D']?.labelReady || seed.forwardReturns?.['10D']?.labelReady || seed.forwardReturns?.['20D']?.labelReady) return true;
  return Object.values(seed.forwardReturns ?? {}).some(snapshot => snapshot?.targetHit || snapshot?.stopHit);
}

export function isWeightFeedbackEligible(seed: OutcomeSeed): boolean {
  const label = seed.finalLearningLabel ?? seed.outcomeLabel;
  if (seed.outcomeStatus !== 'LABELED') return false;
  if (!label || !VALID_LABELS.has(label)) return false;
  if (seed.entryPrice == null || seed.entryPrice <= 0) return false;
  if (!hasRequiredForwardEvidence(seed)) return false;
  if (Object.values(seed.forwardReturns ?? {}).some(snapshot => snapshot?.priceDataHealth === 'STALE' || snapshot?.priceDataHealth === 'DEGRADED')) return false;
  return true;
}

function normalizePolicyFactor(reason: string): string {
  if (reason.includes('SELL_ONLY')) return 'SELL_ONLY_BLOCK';
  if (reason.includes('R6_DEFENSE')) return 'R6_DEFENSE_BLOCK';
  if (reason.includes('OBSERVE_ONLY') || reason.includes('HOLIDAY')) return 'OBSERVE_ONLY_BLOCK';
  if (reason.includes('DIAGNOSTIC_ONLY')) return 'DIAGNOSTIC_ONLY_BLOCK';
  if (reason.includes('DATA_INCOMPLETE')) return 'DATA_INCOMPLETE';
  if (reason.includes('PROVIDER')) return 'providerIssueDowngrade';
  return reason;
}

function gate3FactorName(key: string): string {
  if (key === 'rrrProfile') return 'RRR_PROFILE';
  if (key === 'lastTrigger') return 'LAST_TRIGGER';
  if (key === 'priceConfirmation') return 'PRICE_CONFIRMATION';
  if (key === 'volumeConfirmation') return 'VOLUME_CONFIRMATION';
  if (key === 'falseBreakoutGuard') return 'FALSE_BREAKOUT_GUARD';
  if (key === 'dataFreshness') return 'DATA_FRESHNESS';
  return key;
}

function factorGroupFor(name: string, registry: readonly FactorDefinition[]): FactorGroup {
  return registry.find(def => def.factorName === name)?.factorGroup ?? 'POLICY';
}

function buildFactorEvidenceSamples(
  seeds: readonly OutcomeSeed[],
  registry: readonly FactorDefinition[] = DEFAULT_FACTOR_REGISTRY,
): FactorEvidenceSample[] {
  const samples: FactorEvidenceSample[] = [];
  for (const seed of seeds.filter(isWeightFeedbackEligible)) {
    if (seed.gate1Score != null) {
      samples.push({ seed, factorName: 'watchlistScore', factorGroup: 'GATE1', factorValue: seed.gate1Score });
    }
    for (const [axis, score] of Object.entries(seed.gate2AxisScores ?? {})) {
      if (score != null) samples.push({ seed, factorName: axis, factorGroup: 'GATE2', factorValue: score });
    }
    for (const [key, score] of Object.entries(seed.gate3ComponentScores ?? {})) {
      if (score != null) samples.push({ seed, factorName: gate3FactorName(key), factorGroup: 'GATE3', factorValue: score });
    }
    for (const reason of seed.blockReasons) {
      const factorName = normalizePolicyFactor(reason);
      samples.push({ seed, factorName, factorGroup: factorGroupFor(factorName, registry), factorValue: reason });
    }
    if (seed.providerIssue) {
      samples.push({ seed, factorName: 'providerIssueDowngrade', factorGroup: 'CONFIDENCE', factorValue: true });
    }
    if (seed.dataConfidenceCeiling !== 'HIGH') {
      samples.push({ seed, factorName: 'dataConfidenceCeiling', factorGroup: 'CONFIDENCE', factorValue: seed.dataConfidenceCeiling });
    }
    if (seed.gate3Readiness === 'DATA_INCOMPLETE' || seed.entryTimingSignal === 'DATA_INCOMPLETE') {
      samples.push({ seed, factorName: 'DATA_INCOMPLETE', factorGroup: 'CONFIDENCE', factorValue: true });
    }
  }
  return samples;
}

function labelOf(seed: OutcomeSeed): OutcomeLabel | null {
  return seed.finalLearningLabel ?? seed.outcomeLabel ?? null;
}

function realizedR(seed: OutcomeSeed): number | null {
  const ret = horizon(seed, '10D')?.returnPct ?? horizon(seed, '5D')?.returnPct ?? null;
  if (ret == null || seed.entryPrice == null || seed.stopLossPrice == null || seed.stopLossPrice >= seed.entryPrice) return null;
  const riskPct = ((seed.entryPrice - seed.stopLossPrice) / seed.entryPrice) * 100;
  return riskPct > 0 ? round2(ret / riskPct) : null;
}

export function buildFactorPerformanceStats(input: {
  seeds: readonly OutcomeSeed[];
  registry?: readonly FactorDefinition[];
}): FactorPerformanceStats[] {
  const registry = input.registry ?? DEFAULT_FACTOR_REGISTRY;
  const evidence = buildFactorEvidenceSamples(input.seeds, registry);
  const excluded = input.seeds.length - input.seeds.filter(isWeightFeedbackEligible).length;
  const factors = new Map<string, { definition: FactorDefinition; samples: FactorEvidenceSample[] }>();
  for (const definition of registry) factors.set(definition.factorName, { definition, samples: [] });
  for (const sample of evidence) {
    const existing = factors.get(sample.factorName);
    if (existing) existing.samples.push(sample);
    else factors.set(sample.factorName, {
      definition: {
        factorName: sample.factorName,
        factorGroup: sample.factorGroup,
        currentWeight: 0,
        minWeight: 0,
        maxWeight: 20,
        promotionStage: 'OBSERVE',
        dataSource: 'INTERNAL',
        isCoreProtected: false,
        canAutoSuggest: true,
      },
      samples: [sample],
    });
  }
  return [...factors.values()].map(({ definition, samples }) => {
    const labels = samples.map(sample => labelOf(sample.seed));
    const returns5 = samples.map(sample => horizon(sample.seed, '5D')?.returnPct ?? null);
    const returns10 = samples.map(sample => horizon(sample.seed, '10D')?.returnPct ?? null);
    const positives = returns10.filter(value => typeof value === 'number' && value > 0);
    const negatives = returns10.filter(value => typeof value === 'number' && value < 0);
    const sampleCount = samples.length;
    const winCount = labels.filter(label => label === 'WIN' || label === 'PARTIAL_WIN').length;
    const lossCount = labels.filter(label => label === 'LOSS').length;
    const missedWinCount = labels.filter(label => label === 'MISSED_WIN').length;
    const avoidedLossCount = labels.filter(label => label === 'AVOIDED_LOSS').length;
    const falsePositiveCount = labels.filter(label => label === 'FALSE_POSITIVE').length;
    const trueNegativeCount = labels.filter(label => label === 'TRUE_NEGATIVE').length;
    const directional = winCount + lossCount + missedWinCount + avoidedLossCount + falsePositiveCount + trueNegativeCount;
    const negativeSum = Math.abs(sum(negatives));
    return {
      factorName: definition.factorName,
      factorGroup: definition.factorGroup,
      sampleCount,
      liveSampleCount: samples.filter(sample => sample.seed.decisionType === 'LIVE_EXECUTED').length,
      shadowSampleCount: samples.filter(sample => sample.seed.decisionType === 'SHADOW_EXECUTED').length,
      counterfactualSampleCount: samples.filter(sample => ['LIVE_BLOCKED', 'SHADOW_BLOCKED', 'OBSERVE_ONLY', 'COUNTERFACTUAL_ONLY'].includes(sample.seed.decisionType)).length,
      winCount,
      lossCount,
      missedWinCount,
      avoidedLossCount,
      falsePositiveCount,
      trueNegativeCount,
      winRate: rate(winCount, directional),
      lossRate: rate(lossCount, directional),
      missedWinRate: rate(missedWinCount, directional),
      avoidedLossRate: rate(avoidedLossCount, directional),
      falsePositiveRate: rate(falsePositiveCount, directional),
      avgReturn5D: avg(returns5),
      avgReturn10D: avg(returns10),
      avgMFE10D: avg(samples.map(sample => horizon(sample.seed, '10D')?.mfePct ?? null)),
      avgMAE10D: avg(samples.map(sample => horizon(sample.seed, '10D')?.maePct ?? null)),
      profitFactorProxy: negativeSum > 0 ? round2(sum(positives) / negativeSum) : positives.length > 0 ? round2(sum(positives)) : null,
      expectancyR: avg(samples.map(sample => realizedR(sample.seed))),
      providerIssueSampleCount: samples.filter(sample => sample.seed.providerIssue).length,
      dataInsufficientExcludedCount: excluded,
    };
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function buildFactorContributionScores(
  stats: readonly FactorPerformanceStats[],
): FactorContributionScore[] {
  return stats.map(stat => {
    if (stat.sampleCount < 30) {
      return {
        factorName: stat.factorName,
        factorGroup: stat.factorGroup,
        contributionScore: null,
        confidence: 'INSUFFICIENT_SAMPLE',
        direction: 'INSUFFICIENT',
        reason: ['SAMPLE_COUNT_BELOW_30'],
      };
    }
    const alignedCount = stat.winCount + stat.avoidedLossCount + stat.trueNegativeCount;
    const negativeCount = stat.lossCount + stat.falsePositiveCount + stat.missedWinCount;
    const directional = alignedCount + negativeCount;
    const alignmentRate = directional > 0 ? alignedCount / directional : 0.5;
    const outcomeAlignmentScore = alignmentRate * 40;
    const expectancy = stat.expectancyR ?? ((stat.avgReturn10D ?? 0) / 5);
    const expectancyScore = clamp(((expectancy + 1) / 2) * 25, 0, 25);
    const falsePositivePenalty = (1 - (stat.falsePositiveRate ?? 0)) * 15;
    const sampleReliabilityScore = stat.sampleCount >= 100 ? 10 : stat.sampleCount >= 50 ? 7 : 5;
    const providerIssueRate = stat.sampleCount > 0 ? stat.providerIssueSampleCount / stat.sampleCount : 0;
    const dataConfidenceScore = (1 - providerIssueRate) * 10;
    const contributionScore = round2(outcomeAlignmentScore + expectancyScore + falsePositivePenalty + sampleReliabilityScore + dataConfidenceScore);
    const confidence: FactorConfidence = stat.sampleCount >= 100 && providerIssueRate < 0.2 ? 'HIGH'
      : stat.sampleCount >= 50 ? 'MEDIUM'
        : 'LOW';
    const unstable = (stat.missedWinRate ?? 0) >= 0.25 && (stat.avoidedLossRate ?? 0) >= 0.25;
    const direction: FactorDirection = unstable ? 'UNSTABLE'
      : contributionScore >= 75 ? 'POSITIVE'
        : contributionScore >= 55 ? 'NEUTRAL'
          : contributionScore >= 40 ? 'NEGATIVE'
            : 'NEGATIVE';
    const reason = [
      `alignment=${round2(alignmentRate)}`,
      `expectancyR=${stat.expectancyR ?? 'N/A'}`,
      `falsePositiveRate=${stat.falsePositiveRate ?? 'N/A'}`,
      `providerIssueSamples=${stat.providerIssueSampleCount}`,
    ];
    if (unstable) reason.push('CONFLICTING_MISSED_WIN_AND_AVOIDED_LOSS');
    return {
      factorName: stat.factorName,
      factorGroup: stat.factorGroup,
      contributionScore,
      confidence,
      direction,
      reason,
    };
  });
}

function nextStage(stage: PromotionStage): PromotionStage {
  if (stage === 'OBSERVE') return 'SHADOW_SCORE';
  if (stage === 'SHADOW_SCORE') return 'ADVISORY';
  if (stage === 'ADVISORY') return 'WEIGHTED';
  if (stage === 'WEIGHTED') return 'GATED';
  return stage;
}

function proposedWeight(definition: FactorDefinition, delta: number): number {
  return round2(clamp(definition.currentWeight + delta, definition.minWeight, definition.maxWeight));
}

export function buildSuggestedWeightActions(input: {
  registry?: readonly FactorDefinition[];
  stats: readonly FactorPerformanceStats[];
  scores: readonly FactorContributionScore[];
}): SuggestedWeightActionRecord[] {
  const registry = input.registry ?? DEFAULT_FACTOR_REGISTRY;
  const defByName = new Map(registry.map(def => [def.factorName, def]));
  const statByName = new Map(input.stats.map(stat => [stat.factorName, stat]));
  return input.scores.map(score => {
    const definition = defByName.get(score.factorName) ?? {
      factorName: score.factorName,
      factorGroup: score.factorGroup,
      currentWeight: 0,
      minWeight: 0,
      maxWeight: 20,
      promotionStage: 'OBSERVE' as const,
      dataSource: 'INTERNAL' as const,
      isCoreProtected: false,
      canAutoSuggest: true,
    };
    const stat = statByName.get(score.factorName);
    let action: SuggestedWeightAction = 'KEEP';
    let delta = 0;
    let stageChange: PromotionStage | undefined;
    const reason = [...score.reason];
    if (score.confidence === 'INSUFFICIENT_SAMPLE' || (stat?.sampleCount ?? 0) < 30) {
      action = 'INSUFFICIENT_SAMPLE';
      reason.push('NO_WEIGHT_CHANGE_SAMPLE_TOO_SMALL');
    } else if (score.direction === 'UNSTABLE') {
      action = 'NEEDS_REVIEW';
      reason.push('CONFLICTING_METRICS_REQUIRE_OPERATOR_REVIEW');
    } else if (definition.dataSource === 'AI_ESTIMATED' && (score.contributionScore ?? 0) >= 75) {
      action = 'NEEDS_REVIEW';
      reason.push('AI_ESTIMATED_FACTOR_CANNOT_PROMOTE_STAGE');
    } else if ((score.contributionScore ?? 0) >= 80
      && (stat?.sampleCount ?? 0) >= 100
      && ['OBSERVE', 'SHADOW_SCORE'].includes(definition.promotionStage)
      && definition.dataSource !== 'AI_ESTIMATED') {
      action = 'PROMOTE_STAGE';
      stageChange = nextStage(definition.promotionStage);
      reason.push('PROMOTION_CANDIDATE_SUGGEST_ONLY');
    } else if ((score.contributionScore ?? 0) >= 75 && (stat?.sampleCount ?? 0) >= 100 && definition.dataSource !== 'AI_ESTIMATED') {
      action = 'INCREASE';
      delta = 5;
      reason.push('HIGH_CONTRIBUTION_SCORE');
    } else if ((score.contributionScore ?? 0) >= 75 && (stat?.sampleCount ?? 0) < 100) {
      action = 'NEEDS_REVIEW';
      reason.push('HIGH_SCORE_BUT_SAMPLE_LT_100');
    } else if ((score.contributionScore ?? 0) < 40 && (stat?.sampleCount ?? 0) >= 100) {
      if ((stat?.falsePositiveRate ?? 0) >= 0.4 || (stat?.providerIssueSampleCount ?? 0) / Math.max(1, stat?.sampleCount ?? 1) >= 0.4) {
        action = 'QUARANTINE';
        reason.push('HIGH_FALSE_POSITIVE_OR_PROVIDER_CONTAMINATION');
      } else {
        action = definition.promotionStage === 'WEIGHTED' || definition.promotionStage === 'GATED' ? 'DEMOTE_STAGE' : 'DECREASE';
        delta = -3;
        reason.push('LOW_CONTRIBUTION_SCORE');
      }
    } else if ((score.contributionScore ?? 0) >= 55) {
      action = 'KEEP';
      reason.push('STABLE_KEEP');
    } else {
      action = 'NEEDS_REVIEW';
      reason.push('WEAK_SIGNAL_REVIEW');
    }
    return {
      factorName: definition.factorName,
      factorGroup: definition.factorGroup,
      currentWeight: definition.currentWeight,
      proposedWeight: proposedWeight(definition, delta),
      suggestedAction: action,
      suggestedWeightDelta: delta,
      ...(stageChange ? { suggestedStageChange: stageChange } : {}),
      reason,
      confidence: score.confidence,
      contributionScore: score.contributionScore,
      sampleCount: stat?.sampleCount ?? 0,
      approvalRequired: true,
    };
  });
}

export function buildOverBlockStats(seeds: readonly OutcomeSeed[]): OverBlockStats[] {
  const validSeeds = seeds.filter(isWeightFeedbackEligible);
  const grouped = new Map<string, OutcomeSeed[]>();
  for (const seed of validSeeds) {
    for (const reason of seed.blockReasons) {
      const key = normalizePolicyFactor(reason);
      grouped.set(key, [...(grouped.get(key) ?? []), seed]);
    }
  }
  return [...grouped.entries()].map(([blockReason, rows]) => {
    const missedWinCount = rows.filter(seed => labelOf(seed) === 'MISSED_WIN').length;
    const avoidedLossCount = rows.filter(seed => labelOf(seed) === 'AVOIDED_LOSS').length;
    const neutralCount = rows.filter(seed => ['TRUE_NEGATIVE', 'BREAKEVEN'].includes(labelOf(seed) ?? '')).length;
    const missedWinRate = round2(missedWinCount / Math.max(1, rows.length));
    const avoidedLossRate = round2(avoidedLossCount / Math.max(1, rows.length));
    const suggestedPolicyAction: OverBlockStats['suggestedPolicyAction'] =
      rows.length < 30 ? 'INSUFFICIENT_SAMPLE'
        : missedWinRate >= 0.4 && avoidedLossRate >= 0.4 ? 'SPLIT_BY_CONTEXT'
          : missedWinRate >= 0.4 && blockReason === 'R6_DEFENSE_BLOCK' ? 'SPLIT_BY_CONTEXT'
            : missedWinRate >= 0.4 ? 'RELAX_BLOCK'
              : avoidedLossRate >= 0.4 ? 'KEEP_BLOCK'
                : 'KEEP_BLOCK';
    return {
      blockReason,
      blockedCount: rows.length,
      missedWinCount,
      avoidedLossCount,
      neutralCount,
      missedWinRate,
      avoidedLossRate,
      suggestedPolicyAction,
    };
  }).sort((a, b) => b.blockedCount - a.blockedCount);
}

function countBy<T>(items: readonly T[], key: (item: T) => string | undefined): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    if (!k) continue;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

function topKeys(counts: Record<string, number>, limit = 5): string[] {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key]) => key);
}

export function buildFalsePositiveFactors(stats: readonly FactorPerformanceStats[]): string[] {
  return stats
    .filter(stat => stat.falsePositiveCount + stat.lossCount > 0)
    .sort((a, b) => {
      const aNeg = a.falsePositiveCount + a.lossCount;
      const bNeg = b.falsePositiveCount + b.lossCount;
      const aRate = aNeg / Math.max(1, a.sampleCount);
      const bRate = bNeg / Math.max(1, b.sampleCount);
      return bRate - aRate || bNeg - aNeg;
    })
    .slice(0, 5)
    .map(stat => stat.factorName);
}

export function buildMissedWinFactors(seeds: readonly OutcomeSeed[]): string[] {
  const evidence = buildFactorEvidenceSamples(seeds);
  return topKeys(countBy(evidence.filter(sample => labelOf(sample.seed) === 'MISSED_WIN'), sample => sample.factorName));
}

export function buildGovernanceReviewItems(
  actions: readonly SuggestedWeightActionRecord[],
  registry: readonly FactorDefinition[] = DEFAULT_FACTOR_REGISTRY,
): GovernanceReviewItem[] {
  const defByName = new Map(registry.map(def => [def.factorName, def]));
  return actions
    .filter(action => action.suggestedAction !== 'INSUFFICIENT_SAMPLE' && action.suggestedAction !== 'KEEP')
    .map((action) => {
      const definition = defByName.get(action.factorName);
      const risk: GovernanceReviewItem['risk'] =
        definition?.isCoreProtected || action.suggestedAction === 'QUARANTINE' || action.suggestedAction === 'DEMOTE_STAGE'
          ? 'HIGH'
          : action.suggestedAction === 'DECREASE' ? 'MEDIUM' : 'LOW';
      return {
        itemId: `wf-${action.factorName}-${action.suggestedAction}`,
        factorName: action.factorName,
        suggestedAction: action.suggestedAction,
        currentWeight: action.currentWeight,
        proposedWeight: action.proposedWeight,
        currentStage: definition?.promotionStage ?? 'OBSERVE',
        ...(action.suggestedStageChange ? { proposedStage: action.suggestedStageChange } : {}),
        evidenceSampleCount: action.sampleCount,
        contributionScore: action.contributionScore,
        confidence: action.confidence,
        risk,
        approvalRequired: true,
        autoApplyAllowed: false,
      };
    });
}

function sampleWindow(seeds: readonly OutcomeSeed[]): { start: string; end: string } {
  const dates = seeds.map(seed => seed.tradeDate).filter(Boolean).sort();
  return {
    start: dates[0] ?? 'N/A',
    end: dates[dates.length - 1] ?? 'N/A',
  };
}

export function buildWeightFeedbackReport(input: {
  seeds: readonly OutcomeSeed[];
  registry?: readonly FactorDefinition[];
  createdAt?: string;
}): WeightFeedbackReport {
  const registry = input.registry ?? DEFAULT_FACTOR_REGISTRY;
  const validSeeds = input.seeds.filter(isWeightFeedbackEligible);
  const stats = buildFactorPerformanceStats({ seeds: input.seeds, registry });
  const scores = buildFactorContributionScores(stats);
  const actions = buildSuggestedWeightActions({ registry, stats, scores });
  const overBlockStats = buildOverBlockStats(input.seeds);
  const governanceItems = buildGovernanceReviewItems(actions, registry);
  return {
    reportId: `weight-feedback-${(input.createdAt ?? new Date(0).toISOString()).slice(0, 10)}`,
    createdAt: input.createdAt ?? new Date(0).toISOString(),
    sampleWindow: sampleWindow(validSeeds),
    totalValidSamples: validSeeds.length,
    excludedSamples: input.seeds.length - validSeeds.length,
    insufficientSampleFactors: scores.filter(score => score.confidence === 'INSUFFICIENT_SAMPLE').length,
    factorStats: stats,
    contributionScores: scores,
    suggestedActions: actions,
    overBlockStats,
    falsePositiveFactors: buildFalsePositiveFactors(stats),
    missedWinFactors: buildMissedWinFactors(input.seeds),
    governanceItems,
    governanceStatus: governanceItems.length > 0 ? 'PENDING_REVIEW' : 'REPORT_ONLY',
    executionImpact: 'NONE',
  };
}

function topAction(report: WeightFeedbackReport, actions: readonly SuggestedWeightAction[]): SuggestedWeightActionRecord | undefined {
  return report.suggestedActions
    .filter(action => actions.includes(action.suggestedAction))
    .sort((a, b) => (b.contributionScore ?? -1) - (a.contributionScore ?? -1))[0];
}

export function formatWeightFeedbackCompact(report: WeightFeedbackReport): string {
  const increase = topAction(report, ['INCREASE', 'PROMOTE_STAGE']);
  const decrease = topAction(report, ['DECREASE', 'DEMOTE_STAGE']);
  const quarantine = topAction(report, ['QUARANTINE']);
  const overBlock = report.overBlockStats[0];
  return [
    '[Weight Feedback]',
    `window: ${report.sampleWindow.start}..${report.sampleWindow.end}`,
    `samples: valid ${report.totalValidSamples} / excluded ${report.excludedSamples}`,
    `topIncrease: ${increase ? `${increase.factorName} +${increase.suggestedWeightDelta || 'stage'} suggested` : 'none'}`,
    `topDecrease: ${decrease ? `${decrease.factorName} ${decrease.suggestedWeightDelta} suggested` : 'none'}`,
    `topQuarantine: ${quarantine?.factorName ?? 'none'}`,
    `overBlock: ${overBlock ? `${overBlock.blockReason} avoided ${overBlock.avoidedLossCount} / missed ${overBlock.missedWinCount}` : 'none'}`,
    `falsePositive: ${report.falsePositiveFactors[0] ?? 'none'}`,
    `status: ${report.governanceStatus === 'PENDING_REVIEW' ? 'REPORT_ONLY' : report.governanceStatus}`,
    `reviewItems: ${report.governanceItems.length}`,
    `impact: ${report.executionImpact}`,
  ].join('\n');
}

export function formatWeightFeedbackDetail(report: WeightFeedbackReport): string {
  return [
    formatWeightFeedbackCompact(report),
    '',
    'Factor Contribution:',
    ...report.contributionScores
      .filter(score => score.confidence !== 'INSUFFICIENT_SAMPLE')
      .slice(0, 12)
      .map(score => `- ${score.factorName} score=${score.contributionScore ?? 'N/A'} confidence=${score.confidence} direction=${score.direction}`),
    'Suggested Actions:',
    ...report.suggestedActions
      .filter(action => action.suggestedAction !== 'INSUFFICIENT_SAMPLE')
      .slice(0, 12)
      .map(action => `- ${action.factorName} ${action.suggestedAction} current=${action.currentWeight} proposed=${action.proposedWeight} approvalRequired=true`),
    'OverBlock:',
    ...report.overBlockStats.slice(0, 8).map(stat => `- ${stat.blockReason} blocked=${stat.blockedCount} missed=${stat.missedWinCount} avoided=${stat.avoidedLossCount} action=${stat.suggestedPolicyAction}`),
  ].join('\n');
}

export function formatWeightFeedbackFull(report: WeightFeedbackReport): string {
  return [
    formatWeightFeedbackDetail(report),
    '',
    'Governance Handoff:',
    JSON.stringify({
      reportId: report.reportId,
      governanceStatus: report.governanceStatus,
      autoApplyAllowed: false,
      items: report.governanceItems,
    }, null, 2),
  ].join('\n');
}

export function formatLearningFeedbackLine(report: WeightFeedbackReport): string {
  const increase = topAction(report, ['INCREASE', 'PROMOTE_STAGE']);
  const decrease = topAction(report, ['DECREASE', 'DEMOTE_STAGE']);
  return `[Feedback] topUp ${increase?.factorName ?? 'none'} | topDown ${decrease?.factorName ?? 'none'} | review ${report.governanceItems.length} | impact NONE`;
}

export function nextWeightFeedbackRunKst(from = new Date()): string {
  const next = new Date(from);
  const day = next.getUTCDay();
  const kstHour = 7 - 9;
  const daysUntilMonday = (8 - day) % 7 || 7;
  next.setUTCDate(next.getUTCDate() + daysUntilMonday);
  next.setUTCHours(kstHour, 30, 0, 0);
  return next.toISOString();
}
