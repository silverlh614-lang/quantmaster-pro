// @responsibility Regime-specific Shadow Learning Bank (diagnostic/read-only).
import { loadCounterfactualShadowLearningLedger, type CounterfactualShadowLearningLedgerEntry } from '../persistence/counterfactualShadowLearningRepo.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { loadGhostPortfolio } from '../persistence/reflectionRepo.js';
import { loadAttributionRecords, type ServerAttributionRecord } from '../persistence/attributionRepo.js';
import { getRegimeDiagnostics } from '../trading/regimeBridge.js';
import { deriveRegimePhase, isRegimePhase, normalizeRegimeContext, type RegimePhase } from '../shadow/regimeContext.js';
import { shadowCaseLedger, type ShadowCaseLedgerStore } from '../shadow/shadowCaseLedger.js';
import type { ShadowCase } from '../shadow/shadowTypes.js';
import { formatEngineRuntimePolicy, resolveEngineRuntimePolicy } from '../runtime/engineRuntimePolicy.js';
import { loadCounterfactuals, type CounterfactualEntry } from './counterfactualShadow.js';
import { inferLearningCohort, learningEntryPrice } from './learningSampleQuality.js';
import type { LearningGhostCase } from './learningTypes.js';

export { type RegimePhase } from '../shadow/regimeContext.js';

export const REGIME_LEARNING_PHASES: RegimePhase[] = [
  'R1_RECOVERY',
  'R2_EARLY',
  'R3_EXPANSION',
  'R4_NEUTRAL',
  'R5_CAUTION',
  'R6_DEFENSE',
  'SELL_ONLY',
  'HARD_BLOCK',
  'SHADOW_ONLY',
  'OBSERVE_ONLY',
  'MARKET_CLOSED',
  'UNKNOWN',
];

export type OverfitRisk = 'LOW' | 'MEDIUM' | 'HIGH';
export type RegimeLearningQualityStatus =
  | 'NO_SAMPLE'
  | 'LOW_SAMPLE'
  | 'LOW_CONFIDENCE'
  | 'LEARNING'
  | 'DIAGNOSTIC_READY'
  | 'STABLE_CANDIDATE'
  | 'OVERFIT_RISK'
  | 'DATA_QUALITY_LOW';

export type RegimeConditionDirection =
  | 'ALPHA_DRIVER'
  | 'RISK_PROTECTOR'
  | 'FALSE_COMFORT'
  | 'NOISE'
  | 'INSUFFICIENT_SAMPLE';

export interface RegimeConditionAttribution {
  conditionId: string;
  conditionName: string;
  regimePhase: RegimePhase;
  samples: number;
  highSamples: number;
  lowSamples: number;
  winRate: number;
  expectancyR: number;
  effect: number | 'N/A';
  avgReturnR: number;
  confidence: 'LOW_SAMPLE' | 'LOW_CONFIDENCE' | 'ENOUGH_FOR_REVIEW';
  minSamplePassed: boolean;
  overfitFlag: boolean;
  direction: RegimeConditionDirection;
  recommendation: string;
}

export interface RegimeSourceFamilyStats {
  sampleSize: number;
  closedCount: number;
  expectancyR: number;
}

export interface RegimeLearningQuality {
  regimePhase: RegimePhase;
  sampleSize: number;
  closedSampleCount: number;
  labelCompletionRate: number;
  sourceConfidenceHighRatio: number;
  unknownRatio: number;
  dataQualityScore: number;
  conditionCoverage: number;
  counterfactualCoverage: number;
  freshShadowCoverage: number;
  overfitRisk: OverfitRisk;
  qualityStatus: RegimeLearningQualityStatus;
}

export interface RegimeLearningStats {
  regimePhase: RegimePhase;
  sampleSize: number;
  freshShadowCount: number;
  counterfactualCount: number;
  ghostRepairCount: number;
  closedCount: number;
  winCount: number;
  lossCount: number;
  breakevenCount: number;
  winRate: number;
  avgReturnR: number;
  expectancyR: number;
  avgMFE: number;
  avgMAE: number;
  avgHoldingMinutes: number;
  labelCompletionRate: number;
  dataQualityScore: number;
  sourceConfidenceHighRatio: number;
  unknownRatio: number;
  conditionCoverage: number;
  counterfactualCoverage: number;
  freshShadowCoverage: number;
  overfitRisk: OverfitRisk;
  qualityStatus: RegimeLearningQualityStatus;
  quality: RegimeLearningQuality;
  promotionStage: 'SHADOW_SCORE' | 'ADVISORY';
  promotionAllowed: false;
  diagnosticOnly: true;
  recommendationOnly: true;
  topCondition?: string;
  worstCondition?: string;
  bestSector?: string;
  worstSector?: string;
  topSector?: string;
  topPositiveConditions: RegimeConditionAttribution[];
  topNegativeConditions: RegimeConditionAttribution[];
  lowSampleConditions: RegimeConditionAttribution[];
  unstableConditions: RegimeConditionAttribution[];
  conditionAttributions: RegimeConditionAttribution[];
  topSectors: Array<{ sector: string; samples: number; expectancyR: number }>;
  worstSectors: Array<{ sector: string; samples: number; expectancyR: number }>;
  bestSymbols: Array<{ symbol: string; name: string; returnR: number }>;
  worstSymbols: Array<{ symbol: string; name: string; returnR: number }>;
  commonFailureReasons: Array<{ reason: string; count: number }>;
  counterfactualLabelBreakdown: Record<string, number>;
  bestConditionCombo?: string;
  worstConditionCombo?: string;
  bestPattern?: string;
  worstPattern?: string;
  bestTimeWindow?: string;
  worstTimeWindow?: string;
  bestMarketSession?: string;
  commonFailureReason?: string;
  survivorPattern?: string;
  earlyLeaderPattern?: string;
  volumeAccumulationPattern?: string;
  firstBreakoutPattern?: string;
  falseStartRisk?: string;
  trendContinuationPattern?: string;
  vcpBreakoutPattern?: string;
  pullbackBuyPattern?: string;
  overheatBreakoutRisk?: string;
  breakoutPattern?: string;
  reversalPattern?: string;
  chopAvoidancePattern?: string;
  drawdownDefensePattern?: string;
  recoverySpeedPattern?: string;
  supplyRetentionPattern?: string;
  deadCatBounceRisk?: string;
  sourceConfidenceBreakdown: Record<string, number>;
  freshShadowStats: RegimeSourceFamilyStats;
  ghostRepairStats: RegimeSourceFamilyStats;
  counterfactualStats: RegimeSourceFamilyStats;
  outcomeStats: RegimeSourceFamilyStats;
  attributionStats: RegimeSourceFamilyStats;
  nextLearningNeed: string;
  blocker?: string;
}

export interface RegimeLearningBank {
  activeRegime: string;
  rawRegime: string;
  effectiveRegime: string;
  shadowLearningAllowed: true;
  stats: RegimeLearningStats[];
  bestRegimeByExpectancy?: RegimePhase;
  worstRegimeByExpectancy?: RegimePhase;
  activeRegimePhase: RegimePhase;
  activeRegimeSampleSize: number;
  activeRegimeExpectancyR: number;
  activeRegimeTopPattern: string;
  activeRegimeLearningNeed: string;
  regimeLearningSampleSize: number;
  regimeAssignedCount: number;
  unknownRegimeCount: number;
  unknownRatio: number;
  activeRegimeQualityStatus: RegimeLearningQualityStatus;
  regimeBankConsistency: 'OK' | 'MISMATCH';
  duplicateCaseCount: number;
  sourceCounts: {
    freshShadow: number;
    ghostRepair: number;
    counterfactual: number;
    outcome: number;
    attribution: number;
  };
  byConfidence: Record<string, number>;
  R1QualityStatus: RegimeLearningQualityStatus;
  R2QualityStatus: RegimeLearningQualityStatus;
  R3QualityStatus: RegimeLearningQualityStatus;
  R4QualityStatus: RegimeLearningQualityStatus;
  R5QualityStatus: RegimeLearningQualityStatus;
  R6QualityStatus: RegimeLearningQualityStatus;
  unknownReductionNeeded: boolean;
  recommendationOnly: true;
  promotionAllowed: false;
  executionImpact: 'NONE';
  brokerOrdersCreated: 0;
}

export interface CollectRegimeLearningInput {
  ledger?: ShadowCaseLedgerStore;
  shadowCases?: ShadowCase[];
  counterfactualEntries?: CounterfactualShadowLearningLedgerEntry[];
  legacyCounterfactualEntries?: CounterfactualEntry[];
  ghostCases?: LearningGhostCase[];
  attributionRecords?: ServerAttributionRecord[];
  includePersistedSources?: boolean;
  rawRegime?: string;
  effectiveRegime?: string;
}

export interface RegimeLearningConsistency {
  totalLearningCases: number;
  regimeLearningSampleSize: number;
  regimeAssignedCount: number;
  unknownRegimeCount: number;
  unknownRatio: number;
  regimeBankSampleCount: number;
  ghostRepairCountInBank: number;
  counterfactualCountInBank: number;
  outcomeCountInBank: number;
  attributionCountInBank: number;
  duplicateCaseCount: number;
  regimeSumMatchesTotal: boolean;
  byRegime: Record<string, number>;
  byConfidence: Record<string, number>;
  metricWarnings: string[];
  nextAction: string;
  executionImpact: 'NONE';
  brokerOrdersCreated: 0;
  promotionAllowed: false;
}

type RegimeCounterfactualEntry = CounterfactualShadowLearningLedgerEntry | {
  label?: string;
  outcomeLabel?: string;
  outcomeStatus?: string;
  blockedBy?: string[];
  regime?: string;
  rawRegime?: string;
  effectiveRegime?: string;
  regimePhase?: RegimePhase;
  originalRegimePhase?: RegimePhase;
  regimeAtSignal?: RegimePhase | string;
  engineMode?: string;
  marketSession?: string;
  sellOnlyActive?: boolean;
  hardBlockActive?: boolean;
  blockedReason?: string;
  skipReason?: string;
  sourceFreshness?: string;
  regimeConfidence?: string;
  regimeRecoveryConfidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  regimeRecoverySource?: string;
  symbol?: string;
  stockCode?: string;
  stockName?: string;
  counterfactualKey?: string;
  id?: string;
};

const CLOSED_LABELS = new Set(['WIN', 'LOSS', 'BREAKEVEN', 'EXPIRED']);
const CF_LABELS = ['MISSED_WIN', 'AVOIDED_LOSS', 'GOOD_BLOCK', 'BAD_BLOCK', 'NEUTRAL_BLOCK', 'DATA_INSUFFICIENT', 'QUARANTINED', 'PENDING_OUTCOME'];

function round(n: number, digits = 4): number {
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : 0;
}

function avg(xs: number[]): number {
  return xs.length > 0 ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

function pct(n: number, d: number): number {
  return d > 0 ? round(n / d, 4) : 0;
}

function normalizePhaseValue(value: unknown): RegimePhase | undefined {
  return isRegimePhase(value) ? String(value).toUpperCase() as RegimePhase : undefined;
}

function freqTop(map: Map<string, number>, limit = 5): Array<{ key: string; count: number }> {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function returnR(c: ShadowCase): number {
  if (typeof c.returnR === 'number' && Number.isFinite(c.returnR)) return c.returnR;
  if (typeof c.finalReturnPct === 'number' && Number.isFinite(c.finalReturnPct)) return c.finalReturnPct / 100;
  if (typeof c.currentReturnPct === 'number' && Number.isFinite(c.currentReturnPct)) return c.currentReturnPct / 100;
  return 0;
}

function scoreDataQuality(c: ShadowCase): number {
  if (c.dataHealth === 'OK' || c.confidenceLevel === 'VERIFIED') return 1;
  if (c.dataHealth === 'STALE') return 0.65;
  if (c.dataHealth === 'DEGRADED' || c.confidenceLevel === 'FALLBACK') return 0.5;
  if (c.dataHealth === 'EMPTY' || c.dataHealth === 'UNAVAILABLE') return 0.2;
  if (c.dataHealth === 'CORRUPTED' || c.confidenceLevel === 'QUARANTINED') return 0;
  return 0.5;
}

function sourceConfidenceOfCase(c: ShadowCase): 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN' {
  if (c.regimeRecoveryConfidence) return c.regimeRecoveryConfidence;
  if (phaseForShadowCase(c) === 'UNKNOWN') return 'UNKNOWN';
  if (c.sourceConfidence === 'VERIFIED' || c.sourceConfidence === 'CALCULATED' || c.confidenceLevel === 'VERIFIED') return 'HIGH';
  if (c.sourceConfidence === 'EXTERNAL_API') return 'MEDIUM';
  if (c.sourceConfidence === 'FALLBACK' || c.confidenceLevel === 'LOW' || c.confidenceLevel === 'FALLBACK') return 'LOW';
  return 'UNKNOWN';
}

function sourceConfidenceOfCounterfactual(e: RegimeCounterfactualEntry): 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN' {
  const row = e as RegimeCounterfactualEntry & { regimeRecoveryConfidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN' };
  if (row.regimeRecoveryConfidence) return row.regimeRecoveryConfidence;
  return phaseForCounterfactual(e) === 'UNKNOWN' ? 'UNKNOWN' : 'HIGH';
}

function phaseForShadowCase(c: ShadowCase): RegimePhase {
  return normalizePhaseValue(c.regimeAtSignal) ?? c.regimePhase ?? deriveRegimePhase({
    rawRegime: c.rawRegime ?? c.regimeTag,
    effectiveRegime: c.effectiveRegime ?? c.regimeTag,
    engineMode: c.engineMode,
    marketSession: c.marketSession,
    sellOnlyActive: c.sellOnlyActive,
    hardBlockActive: c.hardBlockActive,
    blockedReason: c.blockedReason,
    sourceFreshness: c.sourceFreshness,
    regimeConfidence: c.regimeConfidence,
  });
}

function phaseForCounterfactual(e: RegimeCounterfactualEntry): RegimePhase {
  const legacy = e as RegimeCounterfactualEntry & { blockedReason?: string; skipReason?: string };
  return e.regimePhase ?? deriveRegimePhase({
    rawRegime: e.rawRegime ?? e.regime,
    effectiveRegime: e.effectiveRegime ?? e.regime,
    engineMode: e.engineMode,
    marketSession: e.marketSession,
    sellOnlyActive: e.sellOnlyActive,
    hardBlockActive: e.hardBlockActive,
    blockedReason: e.blockedBy?.[0] ?? legacy.blockedReason ?? legacy.skipReason,
    sourceFreshness: e.sourceFreshness,
    regimeConfidence: e.regimeConfidence,
  });
}

function conditionTags(c: ShadowCase): string[] {
  const tags = c.conditionTags?.filter(Boolean) ?? [];
  if (tags.length > 0) return tags;
  if (c.learningTag) return [c.learningTag];
  return [];
}

function qualityStatus(input: {
  sampleSize: number;
  labelCompletionRate: number;
  dataQualityScore: number;
  sourceConfidenceHighRatio: number;
  overfitRisk: OverfitRisk;
}): RegimeLearningQualityStatus {
  if (input.sampleSize === 0) return 'NO_SAMPLE';
  if (input.sampleSize < 30) return 'LOW_SAMPLE';
  if (input.sampleSize < 70) return 'LEARNING';
  if (input.sourceConfidenceHighRatio < 0.7) return 'LOW_CONFIDENCE';
  if (input.labelCompletionRate < 0.8) return 'DATA_QUALITY_LOW';
  if (input.overfitRisk !== 'LOW') return 'OVERFIT_RISK';
  if (input.sampleSize >= 100 && input.labelCompletionRate >= 0.95 && input.sourceConfidenceHighRatio >= 0.8) return 'STABLE_CANDIDATE';
  return 'DIAGNOSTIC_READY';
}

function patternText(phase: RegimePhase, kind: 'best' | 'worst', seed?: string, sector?: string): string {
  const positive = seed || sector || 'N/A';
  if (phase === 'R2_EARLY') return kind === 'best'
    ? `R2 early leader pattern: ${positive} + volume accumulation / first breakout`
    : 'R2 failure pattern: false start without follow-through accumulation';
  if (phase === 'R6_DEFENSE') return kind === 'best'
    ? `R6 survivor pattern: ${positive} + index drawdown defense / supply retention / next-session recovery`
    : `R6 failure pattern: ${positive} with dead-cat bounce risk and recovery failure`;
  if (phase === 'R3_EXPANSION') return kind === 'best'
    ? `R3 trend continuation pattern: ${positive} + VCP breakout / pullback buy confirmation`
    : 'R3 failure pattern: overheated breakout without supply follow-through';
  if (phase === 'R1_RECOVERY') return kind === 'best'
    ? `R1 reversal pattern: ${positive}`
    : 'R1 failure pattern: weak bounce without accumulation';
  if (phase === 'R4_NEUTRAL') return kind === 'best'
    ? `R4 chop-avoidance pattern: ${positive}`
    : 'R4 failure pattern: chasing directionless breakout';
  return kind === 'best' ? `bestPattern=${positive}` : `worstPattern=${positive}`;
}

function buildConditionAttribution(
  regimePhase: RegimePhase,
  cases: ShadowCase[],
): RegimeConditionAttribution[] {
  const byCondition = new Map<string, ShadowCase[]>();
  const closed = cases.filter((c) => CLOSED_LABELS.has(c.outcomeLabel ?? ''));
  for (const c of cases) {
    for (const tag of conditionTags(c)) {
      const rows = byCondition.get(tag) ?? [];
      rows.push(c);
      byCondition.set(tag, rows);
    }
  }
  return [...byCondition.entries()]
    .map(([conditionId, rows]) => {
      const highClosed = rows.filter((c) => CLOSED_LABELS.has(c.outcomeLabel ?? ''));
      const highIds = new Set(rows.map((c) => c.caseId));
      const lowClosed = closed.filter((c) => !highIds.has(c.caseId));
      const highSamples = highClosed.length;
      const lowSamples = lowClosed.length;
      const highReturns = highClosed.map(returnR);
      const lowReturns = lowClosed.map(returnR);
      const avgReturnR = round(avg(highReturns));
      const lowAvg = round(avg(lowReturns));
      const effect: number | 'N/A' = highSamples + lowSamples === 0 ? 'N/A' : round(avgReturnR - lowAvg);
      const samples = rows.length;
      const wins = highClosed.filter((c) => c.outcomeLabel === 'WIN').length;
      const losses = highClosed.filter((c) => c.outcomeLabel === 'LOSS').length;
      const winRate = pct(wins, wins + losses);
      const direction: RegimeConditionDirection =
        samples < 30 ? 'INSUFFICIENT_SAMPLE'
          : effect === 'N/A' ? 'NOISE'
            : avgReturnR > 0 && winRate >= pct(closed.filter((c) => c.outcomeLabel === 'WIN').length, closed.filter((c) => c.outcomeLabel === 'WIN' || c.outcomeLabel === 'LOSS').length) ? 'ALPHA_DRIVER'
              : avgReturnR >= 0 && effect > 0 ? 'RISK_PROTECTOR'
                : avgReturnR < 0 && samples >= 30 ? 'FALSE_COMFORT'
                  : 'NOISE';
      const confidence = samples < 30 ? 'LOW_SAMPLE' as const : samples < 70 ? 'LOW_CONFIDENCE' as const : 'ENOUGH_FOR_REVIEW' as const;
      return {
        conditionId,
        conditionName: conditionId.replace(/^condition:/, ''),
        regimePhase,
        samples,
        highSamples,
        lowSamples,
        winRate,
        expectancyR: avgReturnR,
        effect,
        avgReturnR,
        confidence,
        minSamplePassed: samples >= 30,
        overfitFlag: samples < 30,
        direction,
        recommendation: samples < 30
          ? 'INSUFFICIENT_SAMPLE_NO_WEIGHT_UPDATE'
          : samples < 70
            ? 'LOW_CONFIDENCE_NO_WEIGHT_UPDATE_RECOMMENDATION_ONLY'
            : 'recommendationOnly',
      };
    })
    .sort((a, b) => b.samples - a.samples || b.avgReturnR - a.avgReturnR);
}

function cfLabel(e: RegimeCounterfactualEntry): string {
  if ('outcomeLabel' in e && e.outcomeLabel) return e.outcomeLabel;
  if ('label' in e && e.label) return e.label;
  if ('outcomeStatus' in e && e.outcomeStatus === 'QUARANTINED') return 'QUARANTINED';
  if ('outcomeStatus' in e && e.outcomeStatus === 'DATA_INSUFFICIENT') return 'DATA_INSUFFICIENT';
  return 'PENDING_OUTCOME';
}

function buildStatsForPhase(
  regimePhase: RegimePhase,
  cases: ShadowCase[],
  counterfactuals: RegimeCounterfactualEntry[],
): RegimeLearningStats {
  const closed = cases.filter((c) => CLOSED_LABELS.has(c.outcomeLabel ?? ''));
  const wins = closed.filter((c) => c.outcomeLabel === 'WIN');
  const losses = closed.filter((c) => c.outcomeLabel === 'LOSS');
  const breakevens = closed.filter((c) => c.outcomeLabel === 'BREAKEVEN');
  const returns = closed.map(returnR);
  const sectorGroups = new Map<string, ShadowCase[]>();
  const failureReasons = new Map<string, number>();
  const cfLabels = new Map<string, number>(CF_LABELS.map((label) => [label, 0]));
  const timeWindowGroups = new Map<string, ShadowCase[]>();
  const marketSessionGroups = new Map<string, ShadowCase[]>();
  const sourceConfidenceBreakdown: Record<string, number> = {};

  for (const c of cases) {
    const sector = c.sectorTag ?? 'UNKNOWN';
    sectorGroups.set(sector, [...(sectorGroups.get(sector) ?? []), c]);
    const timeWindow = c.timeWindowTag ?? 'UNKNOWN';
    timeWindowGroups.set(timeWindow, [...(timeWindowGroups.get(timeWindow) ?? []), c]);
    const session = c.marketSession ?? 'UNKNOWN';
    marketSessionGroups.set(session, [...(marketSessionGroups.get(session) ?? []), c]);
    if (c.outcomeLabel === 'LOSS' || (c.finalReturnPct ?? 0) < 0) {
      const reason = c.blockedReason ?? c.learningTag ?? 'UNKNOWN';
      failureReasons.set(reason, (failureReasons.get(reason) ?? 0) + 1);
    }
    sourceConfidenceBreakdown[sourceConfidenceOfCase(c)] = (sourceConfidenceBreakdown[sourceConfidenceOfCase(c)] ?? 0) + 1;
  }
  for (const e of counterfactuals) {
    const label = cfLabel(e);
    cfLabels.set(label, (cfLabels.get(label) ?? 0) + 1);
    for (const b of e.blockedBy ?? []) failureReasons.set(b, (failureReasons.get(b) ?? 0) + 1);
    sourceConfidenceBreakdown[sourceConfidenceOfCounterfactual(e)] = (sourceConfidenceBreakdown[sourceConfidenceOfCounterfactual(e)] ?? 0) + 1;
  }

  const allSectors = [...sectorGroups.entries()]
    .map(([sector, rows]) => ({ sector, samples: rows.length, expectancyR: round(avg(rows.map(returnR))) }))
    .sort((a, b) => b.expectancyR - a.expectancyR || b.samples - a.samples);
  const sortedReturns = [...closed].sort((a, b) => returnR(b) - returnR(a));
  const conditionAttributions = buildConditionAttribution(regimePhase, cases);
  const topPositiveConditions = conditionAttributions
    .filter((c) => c.avgReturnR >= 0 && c.direction !== 'INSUFFICIENT_SAMPLE')
    .sort((a, b) => b.expectancyR - a.expectancyR || b.samples - a.samples)
    .slice(0, 5);
  const topNegativeConditions = conditionAttributions
    .filter((c) => c.avgReturnR < 0 && c.direction !== 'INSUFFICIENT_SAMPLE')
    .sort((a, b) => a.expectancyR - b.expectancyR || b.samples - a.samples)
    .slice(0, 5);
  const lowSampleConditions = conditionAttributions.filter((c) => c.direction === 'INSUFFICIENT_SAMPLE').slice(0, 10);
  const unstableConditions = conditionAttributions.filter((c) => c.confidence === 'LOW_CONFIDENCE' || c.overfitFlag).slice(0, 10);
  const closedOrLabeledCount = closed.length + counterfactuals.filter((e) => cfLabel(e) !== 'PENDING_OUTCOME').length;
  const sampleSize = cases.length + counterfactuals.length;
  const overfitRisk: OverfitRisk = sampleSize < 30 ? 'HIGH' : sampleSize < 70 ? 'MEDIUM' : 'LOW';
  const labelCompletionRate = pct(closedOrLabeledCount, sampleSize);
  const dataQualityScore = cases.length > 0 ? round(avg(cases.map(scoreDataQuality))) : 1;
  const highConfidenceCount = (sourceConfidenceBreakdown.HIGH ?? 0);
  const sourceConfidenceHighRatio = pct(highConfidenceCount, sampleSize);
  const unknownConfidenceCount = (sourceConfidenceBreakdown.UNKNOWN ?? 0);
  const unknownRatio = pct(unknownConfidenceCount, sampleSize);
  const conditionCoverage = pct(conditionAttributions.length, Math.max(sampleSize, 1));
  const counterfactualCoverage = pct(counterfactuals.length + cases.filter((c) => c.cohortType === 'COUNTERFACTUAL_BLOCKED' || c.counterfactualRecorded).length, sampleSize);
  const freshShadowCoverage = pct(cases.filter((c) => c.cohortType === 'FRESH_SHADOW').length, sampleSize);
  const status = qualityStatus({ sampleSize, labelCompletionRate, dataQualityScore, sourceConfidenceHighRatio, overfitRisk });
  const quality: RegimeLearningQuality = {
    regimePhase,
    sampleSize,
    closedSampleCount: closed.length,
    labelCompletionRate,
    sourceConfidenceHighRatio,
    unknownRatio,
    dataQualityScore,
    conditionCoverage,
    counterfactualCoverage,
    freshShadowCoverage,
    overfitRisk,
    qualityStatus: status,
  };
  const bestTimeWindow = [...timeWindowGroups.entries()].map(([key, rows]) => ({ key, value: avg(rows.map(returnR)) })).sort((a, b) => b.value - a.value)[0]?.key;
  const worstTimeWindow = [...timeWindowGroups.entries()].map(([key, rows]) => ({ key, value: avg(rows.map(returnR)) })).sort((a, b) => a.value - b.value)[0]?.key;
  const bestMarketSession = [...marketSessionGroups.entries()].map(([key, rows]) => ({ key, value: avg(rows.map(returnR)) })).sort((a, b) => b.value - a.value)[0]?.key;
  const bestConditionCombo = topPositiveConditions.slice(0, 2).map((c) => c.conditionId).join('+') || undefined;
  const worstConditionCombo = topNegativeConditions.slice(0, 2).map((c) => c.conditionId).join('+') || undefined;
  const bestSector = allSectors[0]?.sector;
  const worstSector = allSectors.at(-1)?.sector;
  const bestPattern = patternText(regimePhase, 'best', bestConditionCombo, bestSector);
  const worstPattern = patternText(regimePhase, 'worst', worstConditionCombo, worstSector);
  const familyStats = (rows: ShadowCase[], extraSampleSize = 0): RegimeSourceFamilyStats => {
    const familyClosed = rows.filter((c) => CLOSED_LABELS.has(c.outcomeLabel ?? ''));
    return {
      sampleSize: rows.length + extraSampleSize,
      closedCount: familyClosed.length,
      expectancyR: round(avg(familyClosed.map(returnR))),
    };
  };
  const freshRows = cases.filter((c) => c.cohortType === 'FRESH_SHADOW');
  const ghostRows = cases.filter((c) => c.cohortType === 'GHOST_REPAIR');
  const counterfactualRows = cases.filter((c) => c.cohortType === 'COUNTERFACTUAL_BLOCKED' || c.counterfactualRecorded);
  const outcomeRows = cases.filter((c) => CLOSED_LABELS.has(c.outcomeLabel ?? ''));
  const attributionRows = cases.filter((c) => c.cohortType === 'BACKLOG_REPAIR' && c.caseId.startsWith('trade:'));

  return {
    regimePhase,
    sampleSize,
    freshShadowCount: cases.filter((c) => c.cohortType === 'FRESH_SHADOW').length,
    counterfactualCount: cases.filter((c) => c.cohortType === 'COUNTERFACTUAL_BLOCKED' || c.counterfactualRecorded).length + counterfactuals.length,
    ghostRepairCount: cases.filter((c) => c.cohortType === 'GHOST_REPAIR').length,
    closedCount: closed.length,
    winCount: wins.length,
    lossCount: losses.length,
    breakevenCount: breakevens.length,
    winRate: pct(wins.length, wins.length + losses.length),
    avgReturnR: round(avg(returns)),
    expectancyR: round(avg(returns)),
    avgMFE: round(avg(cases.map((c) => c.mfe ?? 0))),
    avgMAE: round(avg(cases.map((c) => c.mae ?? 0))),
    avgHoldingMinutes: round(avg(closed.map((c) => c.holdingMinutes ?? 0)), 2),
    labelCompletionRate,
    dataQualityScore,
    sourceConfidenceHighRatio,
    unknownRatio,
    conditionCoverage,
    counterfactualCoverage,
    freshShadowCoverage,
    overfitRisk,
    qualityStatus: status,
    quality,
    promotionStage: sampleSize >= 30 && labelCompletionRate > 0 ? 'ADVISORY' : 'SHADOW_SCORE',
    promotionAllowed: false,
    diagnosticOnly: true,
    recommendationOnly: true,
    topCondition: topPositiveConditions[0]?.conditionId,
    worstCondition: topNegativeConditions[0]?.conditionId,
    bestSector,
    worstSector,
    topSector: allSectors[0]?.sector,
    topPositiveConditions,
    topNegativeConditions,
    lowSampleConditions,
    unstableConditions,
    conditionAttributions,
    topSectors: allSectors.slice(0, 5),
    worstSectors: [...allSectors].reverse().slice(0, 5),
    bestSymbols: sortedReturns.slice(0, 5).map((c) => ({ symbol: c.symbol, name: c.symbolName, returnR: round(returnR(c)) })),
    worstSymbols: sortedReturns.slice(-5).reverse().map((c) => ({ symbol: c.symbol, name: c.symbolName, returnR: round(returnR(c)) })),
    commonFailureReasons: freqTop(failureReasons).map(({ key, count }) => ({ reason: key, count })),
    counterfactualLabelBreakdown: Object.fromEntries(cfLabels),
    bestConditionCombo,
    worstConditionCombo,
    bestPattern,
    worstPattern,
    bestTimeWindow,
    worstTimeWindow,
    bestMarketSession,
    commonFailureReason: freqTop(failureReasons, 1)[0]?.key,
    survivorPattern: regimePhase === 'R6_DEFENSE' ? bestPattern : undefined,
    earlyLeaderPattern: regimePhase === 'R2_EARLY' ? bestPattern : undefined,
    volumeAccumulationPattern: regimePhase === 'R2_EARLY' ? `${bestConditionCombo ?? bestSector ?? 'N/A'} + volume accumulation` : undefined,
    firstBreakoutPattern: regimePhase === 'R2_EARLY' ? `${bestConditionCombo ?? 'N/A'} + first breakout` : undefined,
    falseStartRisk: regimePhase === 'R2_EARLY' ? worstPattern : undefined,
    trendContinuationPattern: regimePhase === 'R3_EXPANSION' ? bestPattern : undefined,
    vcpBreakoutPattern: regimePhase === 'R3_EXPANSION' ? `${bestConditionCombo ?? 'N/A'} + VCP breakout` : undefined,
    pullbackBuyPattern: regimePhase === 'R3_EXPANSION' ? `${bestSector ?? 'N/A'} pullback confirmation` : undefined,
    overheatBreakoutRisk: regimePhase === 'R3_EXPANSION' ? worstPattern : undefined,
    breakoutPattern: regimePhase === 'R3_EXPANSION' ? bestPattern : undefined,
    reversalPattern: regimePhase === 'R1_RECOVERY' ? bestPattern : undefined,
    chopAvoidancePattern: regimePhase === 'R4_NEUTRAL' ? bestPattern : undefined,
    drawdownDefensePattern: regimePhase === 'R6_DEFENSE' ? `${bestSector ?? 'N/A'} relative drawdown defense` : undefined,
    recoverySpeedPattern: regimePhase === 'R6_DEFENSE' ? `${bestConditionCombo ?? 'N/A'} next-session recovery` : undefined,
    supplyRetentionPattern: regimePhase === 'R6_DEFENSE' ? `${bestConditionCombo ?? bestSector ?? 'N/A'} supply retention` : undefined,
    deadCatBounceRisk: regimePhase === 'R6_DEFENSE' ? worstPattern : undefined,
    sourceConfidenceBreakdown,
    freshShadowStats: familyStats(freshRows),
    ghostRepairStats: familyStats(ghostRows),
    counterfactualStats: familyStats(counterfactualRows, counterfactuals.length),
    outcomeStats: familyStats(outcomeRows),
    attributionStats: familyStats(attributionRows),
    nextLearningNeed: sampleSize < 30 ? 'LOW_SAMPLE' : closed.length === 0 ? 'NEEDS_OUTCOME_LABELS' : 'OBSERVE_AND_COMPARE',
    blocker: status === 'STABLE_CANDIDATE' ? undefined : status,
  };
}

function cohortForShadowCase(value: string | undefined): ShadowCase['cohortType'] {
  if (value === 'FRESH_SHADOW') return 'FRESH_SHADOW';
  if (value === 'GHOST_REPAIR') return 'GHOST_REPAIR';
  if (value === 'RECOVERED_METADATA') return 'RECOVERED_METADATA';
  if (value === 'QUARANTINED') return 'QUARANTINED';
  if (value === 'COUNTERFACTUAL_BLOCKED' || value === 'COUNTERFACTUAL_MISSED_WIN' || value === 'COUNTERFACTUAL_AVOIDED_LOSS') return 'COUNTERFACTUAL_BLOCKED';
  return 'BACKLOG_REPAIR';
}

function ghostCaseId(g: LearningGhostCase): string {
  const row = g as LearningGhostCase & { tradeId?: string };
  return row.tradeId ? `trade:${row.tradeId}` : `ghost:${g.id ?? `${g.stockCode}:${g.signalDate}`}`;
}

function shadowFromGhost(g: LearningGhostCase): ShadowCase {
  const detectedAt = g.entryAt ?? `${g.signalDate}T00:00:00.000Z`;
  const conditionTags = Object.keys(g.conditionScores ?? {}).map((id) => `condition:${id}`);
  const entry = learningEntryPrice(g);
  return {
    caseId: ghostCaseId(g),
    signalId: ghostCaseId(g),
    symbol: g.stockCode,
    symbolName: g.stockName,
    detectedAt,
    marketSession: g.marketSession ?? 'UNKNOWN',
    engineMode: (g.engineMode === 'SELL_ONLY' || g.engineMode === 'SHADOW_ONLY' || g.engineMode === 'OBSERVE_ONLY' || g.engineMode === 'DEGRADED') ? g.engineMode : 'NORMAL',
    blockedReason: g.rejectionReason ?? g.quarantinedReason ?? g.closeReason,
    dataHealth: g.dataQuality === 'QUARANTINED' ? 'CORRUPTED' : g.dataQuality === 'MISSING' ? 'EMPTY' : g.dataQuality === 'STALE' ? 'STALE' : 'OK',
    providerHealth: 'OK',
    confidenceLevel: g.regimeRecoveryConfidence === 'UNKNOWN' ? 'FALLBACK' : g.dataQuality === 'QUARANTINED' ? 'QUARANTINED' : 'CALCULATED',
    executionImpact: 'NONE',
    entryPriceVirtual: entry,
    stopPriceVirtual: g.stopPrice,
    targetPriceVirtual: g.targetPrice,
    mfe: g.mfe,
    mae: g.mae,
    currentReturnPct: g.currentReturnPct,
    finalReturnPct: g.finalReturnPct,
    holdingMinutes: (g as LearningGhostCase & { holdingMinutes?: number }).holdingMinutes,
    outcomeLabel: g.outcomeLabel,
    learningTag: g.rejectionReason ?? g.closeReason,
    rawRegime: g.rawRegime ?? (g as LearningGhostCase & { regime?: string }).regime,
    effectiveRegime: g.effectiveRegime ?? (g as LearningGhostCase & { regime?: string }).regime,
    regimePhase: g.regimePhase,
    originalRegimePhase: g.originalRegimePhase,
    regimeAtSignal: g.regimeAtSignal,
    regimeAtEntry: g.regimeAtEntry,
    regimeAtExit: g.regimeAtExit,
    regimeAtOutcome: g.regimeAtOutcome,
    r6Trigger: g.r6Trigger,
    sellOnlyActive: g.sellOnlyActive,
    hardBlockActive: g.hardBlockActive,
    sourceFreshness: g.sourceFreshness,
    conditionTags,
    conditionScores: Object.fromEntries(Object.entries(g.conditionScores ?? {}).map(([k, v]) => [String(k), v])),
    sourceConfidence: g.regimeRecoveryConfidence === 'UNKNOWN' ? 'UNKNOWN' : g.regimeRecoveryConfidence === 'LOW' ? 'FALLBACK' : 'CALCULATED',
    createdAt: detectedAt,
    updatedAt: g.lastUpdatedAt ?? g.closedAt ?? detectedAt,
    cohortType: cohortForShadowCase(inferLearningCohort(g)),
    repairRunId: g.repairRunId,
    pendingRetryReason: g.pendingRetryReason,
    quarantinedReason: g.quarantinedReason,
    returnR: g.returnR,
  };
}

function shadowFromAttribution(r: ServerAttributionRecord): ShadowCase {
  const conditionTags = Object.entries(r.conditionScores ?? {})
    .filter(([, score]) => Number(score) >= 7)
    .map(([id]) => `condition:${id}`);
  return {
    caseId: `trade:${r.tradeId}`,
    signalId: `trade:${r.tradeId}`,
    symbol: r.stockCode,
    symbolName: r.stockName,
    detectedAt: r.closedAt,
    marketSession: r.marketSession ?? 'UNKNOWN',
    engineMode: (r.engineMode === 'SELL_ONLY' || r.engineMode === 'SHADOW_ONLY' || r.engineMode === 'OBSERVE_ONLY' || r.engineMode === 'DEGRADED') ? r.engineMode : 'NORMAL',
    blockedReason: r.sellReason,
    dataHealth: 'OK',
    providerHealth: 'OK',
    confidenceLevel: 'CALCULATED',
    executionImpact: 'NONE',
    finalReturnPct: r.returnPct,
    holdingMinutes: r.holdingDays * 24 * 60,
    outcomeLabel: r.returnPct > 0 ? 'WIN' : r.returnPct < 0 ? 'LOSS' : 'BREAKEVEN',
    learningTag: r.sellReason,
    rawRegime: r.rawRegime ?? r.entryRegime,
    effectiveRegime: r.effectiveRegime ?? r.entryRegime,
    regimePhase: r.regimePhase,
    originalRegimePhase: r.originalRegimePhase,
    regimeAtSignal: r.regimeAtSignal,
    regimeAtEntry: r.regimeAtEntry,
    regimeAtExit: r.regimeAtExit,
    regimeAtOutcome: r.regimeAtOutcome,
    r6Trigger: r.r6Trigger,
    sellOnlyActive: r.sellOnlyActive,
    hardBlockActive: r.hardBlockActive,
    sourceFreshness: r.sourceFreshness,
    conditionTags,
    conditionScores: Object.fromEntries(Object.entries(r.conditionScores ?? {}).map(([k, v]) => [String(k), v])),
    sourceConfidence: r.regimeRecoveryConfidence === 'UNKNOWN' ? 'UNKNOWN' : r.regimeRecoveryConfidence === 'LOW' ? 'FALLBACK' : 'CALCULATED',
    createdAt: r.closedAt,
    updatedAt: r.closedAt,
    cohortType: 'BACKLOG_REPAIR',
    returnR: r.returnPct / 100,
  };
}

function legacyCounterfactual(e: CounterfactualEntry): RegimeCounterfactualEntry {
  return {
    id: e.id,
    counterfactualKey: e.counterfactualKey,
    symbol: e.symbol ?? e.stockCode,
    stockCode: e.stockCode,
    stockName: e.stockName,
    regime: e.regime,
    rawRegime: e.rawRegime,
    effectiveRegime: e.effectiveRegime,
    regimePhase: e.regimePhase,
    originalRegimePhase: e.originalRegimePhase,
    regimeAtSignal: e.regimeAtSignal,
    engineMode: e.engineMode,
    marketSession: e.marketSession,
    sellOnlyActive: e.sellOnlyActive,
    hardBlockActive: e.hardBlockActive,
    blockedReason: e.blockedReason,
    skipReason: e.skipReason,
    blockedBy: [e.blockedReason ?? e.skipReason].filter(Boolean) as string[],
    outcomeLabel: e.outcomeLabel,
    outcomeStatus: e.outcomeStatus,
    regimeRecoveryConfidence: e.regimeRecoveryConfidence,
    regimeRecoverySource: e.regimeRecoverySource,
  };
}

function shouldReadPersisted(input: CollectRegimeLearningInput): boolean {
  return input.includePersistedSources ?? (
    input.shadowCases === undefined
    && input.counterfactualEntries === undefined
    && input.legacyCounterfactualEntries === undefined
    && input.ghostCases === undefined
    && input.attributionRecords === undefined
  );
}

function collectCases(input: CollectRegimeLearningInput, ledger: ShadowCaseLedgerStore) {
  const includePersisted = shouldReadPersisted(input);
  const explicitCases = input.shadowCases ?? ledger.listCases();
  const cases: ShadowCase[] = [...explicitCases];
  const seen = new Set(cases.map((c) => c.caseId));
  let duplicateCaseCount = 0;
  let attributionCaseCount = 0;

  const addCase = (c: ShadowCase, fromAttribution = false) => {
    if (seen.has(c.caseId)) {
      duplicateCaseCount++;
      return;
    }
    seen.add(c.caseId);
    cases.push(c);
    if (fromAttribution) attributionCaseCount++;
  };

  const ghosts = input.ghostCases ?? (includePersisted ? (loadGhostPortfolio() as LearningGhostCase[]) : []);
  for (const g of ghosts) addCase(shadowFromGhost(g));

  const attribution = input.attributionRecords ?? (includePersisted ? loadAttributionRecords() : []);
  for (const r of attribution) addCase(shadowFromAttribution(r), true);

  const ledgerCounterfactuals = input.counterfactualEntries ?? (includePersisted ? loadCounterfactualShadowLearningLedger() : []);
  const legacyCounterfactuals = input.legacyCounterfactualEntries ?? (includePersisted ? loadCounterfactuals() : []);
  const counterfactuals: RegimeCounterfactualEntry[] = [
    ...ledgerCounterfactuals,
    ...legacyCounterfactuals.map(legacyCounterfactual),
  ];

  return { cases, counterfactuals, duplicateCaseCount, attributionCaseCount };
}

export function collectRegimeLearningBank(input: CollectRegimeLearningInput = {}): RegimeLearningBank {
  const ledger = input.ledger ?? shadowCaseLedger;
  const { cases, counterfactuals, duplicateCaseCount, attributionCaseCount } = collectCases(input, ledger);
  const diagnostics = input.rawRegime && input.effectiveRegime
    ? undefined
    : getRegimeDiagnostics(loadMacroState());
  const rawRegime = input.rawRegime ?? diagnostics?.rawRegime ?? 'UNKNOWN';
  const effectiveRegime = input.effectiveRegime ?? diagnostics?.effectiveRegime ?? rawRegime;
  const activeContext = normalizeRegimeContext({
    rawRegime,
    effectiveRegime,
    sourceFreshness: diagnostics?.sourceFreshness,
    regimeConfidence: diagnostics?.sourceFreshness === 'FRESH' ? 'VERIFIED' : diagnostics?.sourceFreshness,
  });

  const byPhase = new Map<RegimePhase, { cases: ShadowCase[]; counterfactuals: RegimeCounterfactualEntry[] }>();
  for (const phase of REGIME_LEARNING_PHASES) byPhase.set(phase, { cases: [], counterfactuals: [] });
  for (const c of cases) byPhase.get(phaseForShadowCase(c))?.cases.push(c);
  for (const e of counterfactuals) byPhase.get(phaseForCounterfactual(e))?.counterfactuals.push(e);

  const stats = REGIME_LEARNING_PHASES
    .map((phase) => {
      const group = byPhase.get(phase)!;
      return buildStatsForPhase(phase, group.cases, group.counterfactuals);
    })
    .filter((s) => s.sampleSize > 0 || s.regimePhase === activeContext.regimePhase);
  const nonEmpty = stats.filter((s) => s.closedCount > 0);
  const best = [...nonEmpty].sort((a, b) => b.expectancyR - a.expectancyR)[0];
  const worst = [...nonEmpty].sort((a, b) => a.expectancyR - b.expectancyR)[0];
  const active = stats.find((s) => s.regimePhase === activeContext.regimePhase) ?? buildStatsForPhase(activeContext.regimePhase, [], []);
  const regimeLearningSampleSize = stats.reduce((sum, row) => sum + row.sampleSize, 0);
  const unknownRegimeCount = stats.find((row) => row.regimePhase === 'UNKNOWN')?.sampleSize ?? 0;
  const regimeAssignedCount = regimeLearningSampleSize - unknownRegimeCount;
  const unknownRatio = pct(unknownRegimeCount, regimeLearningSampleSize);
  const byConfidence = stats.reduce<Record<string, number>>((acc, row) => {
    for (const [key, count] of Object.entries(row.sourceConfidenceBreakdown)) {
      acc[key] = (acc[key] ?? 0) + count;
    }
    return acc;
  }, {});
  const r1 = stats.find((row) => row.regimePhase === 'R1_RECOVERY') ?? buildStatsForPhase('R1_RECOVERY', [], []);
  const r2 = stats.find((row) => row.regimePhase === 'R2_EARLY') ?? buildStatsForPhase('R2_EARLY', [], []);
  const r3 = stats.find((row) => row.regimePhase === 'R3_EXPANSION') ?? buildStatsForPhase('R3_EXPANSION', [], []);
  const r4 = stats.find((row) => row.regimePhase === 'R4_NEUTRAL') ?? buildStatsForPhase('R4_NEUTRAL', [], []);
  const r5 = stats.find((row) => row.regimePhase === 'R5_CAUTION') ?? buildStatsForPhase('R5_CAUTION', [], []);
  const r6 = stats.find((row) => row.regimePhase === 'R6_DEFENSE') ?? buildStatsForPhase('R6_DEFENSE', [], []);
  const sourceCounts = {
    freshShadow: cases.filter((c) => c.cohortType === 'FRESH_SHADOW').length,
    ghostRepair: cases.filter((c) => c.cohortType === 'GHOST_REPAIR').length,
    counterfactual: cases.filter((c) => c.cohortType === 'COUNTERFACTUAL_BLOCKED' || c.counterfactualRecorded).length + counterfactuals.length,
    outcome: cases.filter((c) => CLOSED_LABELS.has(c.outcomeLabel ?? '')).length,
    attribution: attributionCaseCount,
  };
  const phaseSum = stats.reduce((sum, row) => sum + row.sampleSize, 0);

  return {
    activeRegime: activeContext.regimePhase,
    rawRegime,
    effectiveRegime,
    shadowLearningAllowed: true,
    stats,
    bestRegimeByExpectancy: best?.regimePhase,
    worstRegimeByExpectancy: worst?.regimePhase,
    activeRegimePhase: activeContext.regimePhase,
    activeRegimeSampleSize: active.sampleSize,
    activeRegimeExpectancyR: active.expectancyR,
    activeRegimeTopPattern: active.bestPattern ?? active.bestConditionCombo ?? active.topSector ?? 'N/A',
    activeRegimeLearningNeed: active.nextLearningNeed,
    regimeLearningSampleSize,
    regimeAssignedCount,
    unknownRegimeCount,
    unknownRatio,
    activeRegimeQualityStatus: active.qualityStatus,
    regimeBankConsistency: phaseSum === regimeLearningSampleSize ? 'OK' : 'MISMATCH',
    duplicateCaseCount,
    sourceCounts,
    byConfidence,
    R1QualityStatus: r1.qualityStatus,
    R2QualityStatus: r2.qualityStatus,
    R3QualityStatus: r3.qualityStatus,
    R4QualityStatus: r4.qualityStatus,
    R5QualityStatus: r5.qualityStatus,
    R6QualityStatus: r6.qualityStatus,
    unknownReductionNeeded: unknownRegimeCount > 0,
    recommendationOnly: true,
    promotionAllowed: false,
    executionImpact: 'NONE',
    brokerOrdersCreated: 0,
  };
}

export function collectRegimeLearningConsistency(bank: RegimeLearningBank = collectRegimeLearningBank()): RegimeLearningConsistency {
  const regimeBankSampleCount = bank.stats.reduce((sum, row) => sum + row.sampleSize, 0);
  const regimeSumMatchesTotal = regimeBankSampleCount === bank.regimeLearningSampleSize;
  const byRegime = Object.fromEntries(bank.stats.map((row) => [row.regimePhase, row.sampleSize]));
  const metricWarnings = regimeSumMatchesTotal ? [] : ['REGIME_BANK_SAMPLE_SUM_MISMATCH'];
  if (bank.unknownRatio >= 0.25) metricWarnings.push('UNKNOWN_RATIO_HIGH');
  if ((bank.byConfidence.LOW ?? 0) + (bank.byConfidence.UNKNOWN ?? 0) > 0) metricWarnings.push('LOW_CONFIDENCE_REGIME_BACKFILL');
  if (bank.duplicateCaseCount > 0) metricWarnings.push('REGIME_SAMPLE_DUPLICATION_SUSPECT');
  if (bank.sourceCounts.freshShadow === 0) metricWarnings.push('FRESH_SHADOW_ZERO');
  const r6 = bank.stats.find((row) => row.regimePhase === 'R6_DEFENSE');
  if (r6 && r6.sampleSize > 0 && r6.sampleSize < 30) metricWarnings.push('R6_LOW_SAMPLE');
  const nextAction = bank.unknownRatio >= 0.25
    ? 'RUN_REGIME_UNKNOWN_ANALYSIS'
    : r6 && r6.sampleSize < 30
      ? 'COLLECT_R6_SURVIVOR_SAMPLES'
      : 'OBSERVE_DIAGNOSTIC_ONLY';
  return {
    totalLearningCases: bank.regimeLearningSampleSize,
    regimeLearningSampleSize: bank.regimeLearningSampleSize,
    regimeAssignedCount: bank.regimeAssignedCount,
    unknownRegimeCount: bank.unknownRegimeCount,
    unknownRatio: bank.unknownRatio,
    regimeBankSampleCount,
    ghostRepairCountInBank: bank.sourceCounts.ghostRepair,
    counterfactualCountInBank: bank.sourceCounts.counterfactual,
    outcomeCountInBank: bank.sourceCounts.outcome,
    attributionCountInBank: bank.sourceCounts.attribution,
    duplicateCaseCount: bank.duplicateCaseCount,
    regimeSumMatchesTotal,
    byRegime,
    byConfidence: bank.byConfidence,
    metricWarnings,
    nextAction,
    executionImpact: 'NONE',
    brokerOrdersCreated: 0,
    promotionAllowed: false,
  };
}

export function formatRegimeLearningSummary(bank: RegimeLearningBank = collectRegimeLearningBank()): string {
  const rows = [...bank.stats].sort((a, b) => b.sampleSize - a.sampleSize);
  return [
    '<b>[Regime Learning Bank]</b>',
    `activeRegime=${bank.activeRegime} rawRegime=${bank.rawRegime} effectiveRegime=${bank.effectiveRegime}`,
    formatEngineRuntimePolicy(resolveEngineRuntimePolicy({
      engineMode: bank.activeRegime === 'SELL_ONLY' ? 'SELL_ONLY' : bank.activeRegime === 'SHADOW_ONLY' ? 'SHADOW_ONLY' : bank.activeRegime === 'OBSERVE_ONLY' ? 'OBSERVE_ONLY' : 'NORMAL',
      macroRegime: bank.effectiveRegime,
      liveBuyGateAllowed: false,
      reasonCodes: ['REGIME_LEARNING_DIAGNOSTIC'],
    })),
    `shadowLearningAllowed=${bank.shadowLearningAllowed} recommendationOnly=${bank.recommendationOnly} promotionAllowed=${bank.promotionAllowed} executionImpact=${bank.executionImpact} brokerOrdersCreated=${bank.brokerOrdersCreated}`,
    `regimeLearningSampleSize=${bank.regimeLearningSampleSize} regimeAssignedCount=${bank.regimeAssignedCount} unknownRegimeCount=${bank.unknownRegimeCount} unknownRatio=${bank.unknownRatio} regimeBankConsistency=${bank.regimeBankConsistency}`,
    ...rows.map((s) => `${s.regimePhase}: sample=${s.sampleSize} fresh=${s.freshShadowCount} ghostRepair=${s.ghostRepairCount} counterfactual=${s.counterfactualCount} closed=${s.closedCount} winRate=${round(s.winRate * 100, 1)}% expectancyR=${s.expectancyR} labelCompletionRate=${s.labelCompletionRate} dataQualityScore=${s.dataQualityScore} qualityStatus=${s.qualityStatus} topCondition=${s.topCondition ?? 'N/A'} topSector=${s.topSector ?? 'N/A'} blocker=${s.blocker ?? 'NONE'}`),
  ].join('\n');
}

export function formatRegimeLearningDetail(regime: string, bank: RegimeLearningBank = collectRegimeLearningBank()): string {
  const phase = deriveRegimePhase({ regimePhase: regime, effectiveRegime: regime });
  const s = bank.stats.find((row) => row.regimePhase === phase) ?? buildStatsForPhase(phase, [], []);
  return [
    `<b>[Regime Learning Detail: ${phase}]</b>`,
    `sampleSize=${s.sampleSize}`,
    `freshShadowCount=${s.freshShadowCount}`,
    `counterfactualCount=${s.counterfactualCount}`,
    `ghostRepairCount=${s.ghostRepairCount}`,
    `closedCount=${s.closedCount}`,
    `labelBreakdown=${JSON.stringify({ WIN: s.winCount, LOSS: s.lossCount, BREAKEVEN: s.breakevenCount, ...s.counterfactualLabelBreakdown })}`,
    `expectancyR=${s.expectancyR}`,
    `winRate=${round(s.winRate * 100, 1)}%`,
    `avgReturnR=${s.avgReturnR}`,
    `qualityStatus=${s.qualityStatus}`,
    `sourceConfidenceBreakdown=${JSON.stringify(s.sourceConfidenceBreakdown)}`,
    `promotionStage=${s.promotionStage}`,
    `topPositiveConditions=${s.topPositiveConditions.map((c) => `${c.conditionId}:${c.expectancyR}:${c.direction}:${c.confidence}`).join(',') || 'N/A'}`,
    `topNegativeConditions=${s.topNegativeConditions.map((c) => `${c.conditionId}:${c.expectancyR}:${c.direction}:${c.confidence}`).join(',') || 'N/A'}`,
    `lowSampleConditions=${s.lowSampleConditions.map((c) => `${c.conditionId}:${c.samples}`).join(',') || 'N/A'}`,
    `unstableConditions=${s.unstableConditions.map((c) => `${c.conditionId}:${c.confidence}`).join(',') || 'N/A'}`,
    `topSectors=${s.topSectors.map((x) => `${x.sector}:${x.expectancyR}`).join(',') || 'N/A'}`,
    `worstSectors=${s.worstSectors.map((x) => `${x.sector}:${x.expectancyR}`).join(',') || 'N/A'}`,
    `bestTimeWindow=${s.bestTimeWindow ?? 'N/A'}`,
    `worstTimeWindow=${s.worstTimeWindow ?? 'N/A'}`,
    `bestMarketSession=${s.bestMarketSession ?? 'N/A'}`,
    `bestPattern=${s.bestPattern ?? 'N/A'}`,
    `worstPattern=${s.worstPattern ?? 'N/A'}`,
    `earlyLeaderPattern=${s.earlyLeaderPattern ?? 'N/A'}`,
    `volumeAccumulationPattern=${s.volumeAccumulationPattern ?? 'N/A'}`,
    `firstBreakoutPattern=${s.firstBreakoutPattern ?? 'N/A'}`,
    `falseStartRisk=${s.falseStartRisk ?? 'N/A'}`,
    `trendContinuationPattern=${s.trendContinuationPattern ?? 'N/A'}`,
    `vcpBreakoutPattern=${s.vcpBreakoutPattern ?? 'N/A'}`,
    `pullbackBuyPattern=${s.pullbackBuyPattern ?? 'N/A'}`,
    `overheatBreakoutRisk=${s.overheatBreakoutRisk ?? 'N/A'}`,
    `survivorPattern=${s.survivorPattern ?? 'N/A'}`,
    `drawdownDefensePattern=${s.drawdownDefensePattern ?? 'N/A'}`,
    `recoverySpeedPattern=${s.recoverySpeedPattern ?? 'N/A'}`,
    `supplyRetentionPattern=${s.supplyRetentionPattern ?? 'N/A'}`,
    `deadCatBounceRisk=${s.deadCatBounceRisk ?? 'N/A'}`,
    `breakoutPattern=${s.breakoutPattern ?? 'N/A'}`,
    `reversalPattern=${s.reversalPattern ?? 'N/A'}`,
    `chopAvoidancePattern=${s.chopAvoidancePattern ?? 'N/A'}`,
    `bestSymbols=${s.bestSymbols.map((x) => `${x.name}:${x.returnR}`).join(',') || 'N/A'}`,
    `worstSymbols=${s.worstSymbols.map((x) => `${x.name}:${x.returnR}`).join(',') || 'N/A'}`,
    `commonFailureReasons=${s.commonFailureReasons.map((x) => `${x.reason}:${x.count}`).join(',') || 'N/A'}`,
    `nextLearningNeed=${s.nextLearningNeed}`,
    'recommendationOnly=true',
    'promotionAllowed=false',
  ].join('\n');
}

export function formatRegimeConditionAttribution(regime?: string, bank: RegimeLearningBank = collectRegimeLearningBank()): string {
  const phase = regime ? deriveRegimePhase({ regimePhase: regime, effectiveRegime: regime }) : undefined;
  const rows = bank.stats
    .filter((stat) => !phase || stat.regimePhase === phase)
    .flatMap((stat) => stat.conditionAttributions.map((condition) => ({ stat, condition })))
    .sort((a, b) => b.condition.samples - a.condition.samples || b.condition.expectancyR - a.condition.expectancyR)
    .slice(0, phase ? 30 : 60);
  return [
    `<b>[Regime Condition Attribution${phase ? `: ${phase}` : ''}]</b>`,
    ...rows.map(({ condition }) => [
      `regimePhase=${condition.regimePhase}`,
      `conditionId=${condition.conditionId}`,
      `conditionName=${condition.conditionName}`,
      `samples=${condition.samples}`,
      `highSamples=${condition.highSamples}`,
      `lowSamples=${condition.lowSamples}`,
      `expectancyR=${condition.expectancyR}`,
      `winRate=${round(condition.winRate * 100, 1)}%`,
      `effect=${condition.effect}`,
      `direction=${condition.direction}`,
      `confidence=${condition.confidence}`,
      `minSamplePassed=${condition.minSamplePassed}`,
      `overfitFlag=${condition.overfitFlag}`,
      `recommendation=${condition.recommendation}`,
    ].join(' / ')),
    'recommendationOnly=true',
    'promotionAllowed=false',
  ].join('\n');
}

export function formatRegimeLearningConsistency(s: RegimeLearningConsistency = collectRegimeLearningConsistency()): string {
  return [
    '<b>[Regime Learning Consistency]</b>',
    `totalLearningCases=${s.totalLearningCases} regimeLearningSampleSize=${s.regimeLearningSampleSize} regimeAssignedCount=${s.regimeAssignedCount} unknownRegimeCount=${s.unknownRegimeCount} unknownRatio=${s.unknownRatio}`,
    `regimeBankSampleCount=${s.regimeBankSampleCount} ghostRepairCountInBank=${s.ghostRepairCountInBank} counterfactualCountInBank=${s.counterfactualCountInBank} outcomeCountInBank=${s.outcomeCountInBank} attributionCountInBank=${s.attributionCountInBank}`,
    `duplicateCaseCount=${s.duplicateCaseCount} regimeSumMatchesTotal=${s.regimeSumMatchesTotal}`,
    `byRegime=${JSON.stringify(s.byRegime)}`,
    `byConfidence=${JSON.stringify(s.byConfidence)}`,
    `metricWarnings=${JSON.stringify(s.metricWarnings)} nextAction=${s.nextAction}`,
    `executionImpact=${s.executionImpact} brokerOrdersCreated=${s.brokerOrdersCreated} promotionAllowed=${s.promotionAllowed}`,
  ].join('\n');
}
