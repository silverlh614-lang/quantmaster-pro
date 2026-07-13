// @responsibility ADR-0469 Gate1 penalty deduplication dry-run audit
import type {
  Gate1ScoreStarvationTrace,
  PositiveScoreStarvationReport,
  ScoreConfidence,
  SignalScoreComponentTrace,
} from './gate1PositiveScoreStarvation.js';
import type { Gate1ScoreCeilingRepairReport } from './gate1ScoreCeilingRepair.js';
import type { CanonicalRuntimeResolutionStep27 } from './runtimeResolverTraceStep26.js';
export type PenaltyRootCauseCode =
  | 'SUPPLY_PROVIDER_UNKNOWN'
  | 'INVESTOR_FLOW_SAMPLE_MISSING'
  | 'SUPPLY_CONFLUENCE_UNKNOWN'
  | 'SUPPLY_CONFLUENCE_BEARISH'
  | 'INVESTOR_FLOW_BEARISH'
  | 'RISK_MULTIPLIER_LOW'
  | 'MACRO_RISK'
  | 'SECTOR_ENERGY_DIAGNOSTIC'
  | 'DATA_QUALITY_STALE'
  | 'SESSION_SELL_ONLY'
  | 'SOFT_FAIL_ACCUMULATION'
  | 'UNKNOWN_ROOT_CAUSE';

export type PenaltyComponentCode =
  | 'SUPPLY_CONFLUENCE'
  | 'INVESTOR_FLOW'
  | 'RISK_PENALTY'
  | 'SOFT_FAIL_PENALTY'
  | 'SECTOR_ENERGY'
  | 'DATA_QUALITY_PENALTY'
  | 'SESSION_PENALTY'
  | 'OTHER_PENALTY';

export interface PenaltyComponentTrace {
  code: PenaltyComponentCode;
  value: number;
  rootCause: PenaltyRootCauseCode;
  providerIssue: boolean;
  marketSignal: boolean;
  confidence: ScoreConfidence;
  dedupeEligible: boolean;
  dedupeGroupKey?: string;
  message: string;
}

export interface CandidatePenaltyDedupTrace {
  symbol: string;
  name?: string;
  grossPositiveScore: number;
  originalPenaltyTotal: number;
  originalNetScore: number;
  requiredScore: number;
  penalties: PenaltyComponentTrace[];
  duplicatePenaltyGroups: Array<{
    groupKey: string;
    rootCause: PenaltyRootCauseCode;
    components: PenaltyComponentCode[];
    originalTotalPenalty: number;
    dedupedPenalty: number;
    removedPenalty: number;
    reason: string;
  }>;
  dedupedPenaltyTotal: number;
  dedupedNetScore: number;
  scoreDeltaAfterDedup: number;
  wouldPassAfterDedup: boolean;
  executionImpact: 'NONE';
}

type PenaltyDedupScenario =
  | 'CURRENT'
  | 'KEEP_LARGEST_PER_ROOT_CAUSE'
  | 'CAP_SUPPLY_UNKNOWN_PENALTY_10'
  | 'CAP_SUPPLY_UNKNOWN_PENALTY_5'
  | 'REMOVE_PROVIDER_UNKNOWN_PENALTY'
  | 'KEEP_ONLY_MARKET_SIGNAL_PENALTIES'
  | 'DEDUP_AND_POSITIVE_REPAIR'
  | 'DEDUP_POSITIVE_REPAIR_AND_RISK_CAP';

export interface PenaltyDedupScenarioResult {
  scenario: PenaltyDedupScenario;
  penaltyAvg: number;
  netScoreAvg: number;
  scoreMin: number;
  scoreMax: number;
  hypotheticalSurvivors: number;
  survivorExamples: Array<{
    symbol: string;
    name?: string;
    originalScore: number;
    adjustedScore: number;
    requiredScore: number;
    reason: string[];
  }>;
  executionImpact: 'NONE';
}

export interface RiskPenaltyDedupAudit {
  symbol: string;
  riskMultiplier: number;
  signalRiskPenalty: number;
  kellyRiskPenaltyApplied: boolean;
  doubleCountWarning: boolean;
  riskPenaltyRootCause: PenaltyRootCauseCode;
  wouldPassIfSignalRiskPenaltyCapped: boolean;
  wouldPassIfRiskPenaltyAppliedOnlyAtSizing: boolean;
}

export interface SoftFailPenaltyAudit {
  symbol: string;
  softFailPenalty: number;
  softFailSources: Array<{
    code: string;
    rootCause: PenaltyRootCauseCode;
    providerIssue: boolean;
    marketSignal: boolean;
    penaltyContribution: number;
  }>;
  duplicateWithOtherPenalty: boolean;
  duplicateGroupKey?: string;
}

export interface CombinedGate1CalibrationResult {
  scenario: string;
  positiveAvg: number;
  penaltyAvg: number;
  netScoreAvg: number;
  scoreMin: number;
  scoreMax: number;
  survivors: number;
  executionImpact: 'NONE';
}

export interface PenaltyDeduplicationReport {
  timestamp: string;
  forDate: string;
  regime: string;
  marketSession: string;
  totalCandidates: number;
  originalPenaltyAvg: number;
  dedupedPenaltyAvg: number;
  removedPenaltyAvg: number;
  effectiveOriginalPenaltyAvg: number;
  effectiveDedupedPenaltyAvg: number;
  effectiveRemovedPenaltyAvg: number;
  diagnosticOriginalPenaltyAvg: number;
  diagnosticDedupedPenaltyAvg: number;
  diagnosticRemovedPenaltyAvg: number;
  effectiveGateScoreImpact: number;
  diagnosticOnly: boolean;
  originalNetScoreAvg: number;
  dedupedNetScoreAvg: number;
  avgScoreDelta: number;
  duplicateGroups: Array<{
    groupKey: string;
    rootCause: PenaltyRootCauseCode;
    affectedCount: number;
    avgOriginalPenalty: number;
    avgDedupedPenalty: number;
    avgRemovedPenalty: number;
    components: PenaltyComponentCode[];
  }>;
  providerIssuePenaltyAvg: number;
  marketSignalPenaltyAvg: number;
  unknownPenaltyAvg: number;
  bearishPenaltyAvg: number;
  survivorsAfterDedup: number;
  survivorsAfterDedupAndPositiveRepair: number;
  survivorExamples: Array<{
    symbol: string;
    name?: string;
    originalNetScore: number;
    dedupedNetScore: number;
    requiredScore: number;
    reason: string[];
  }>;
  riskPenaltyAudit: RiskPenaltyDedupAudit;
  softFailPenaltyAudit: SoftFailPenaltyAudit;
  scenarioResults: PenaltyDedupScenarioResult[];
  combinedCalibrationResults: CombinedGate1CalibrationResult[];
  recommendedAction:
    | 'NO_ACTION'
    | 'DIAGNOSTIC_ONLY'
    | 'DEDUP_SUPPLY_UNKNOWN_PENALTY'
    | 'CAP_UNKNOWN_PROVIDER_PENALTY'
    | 'REVIEW_RISK_PENALTY'
    | 'REVIEW_SOFT_FAIL_ACCUMULATION'
    | 'REPAIR_PROVIDER_FIRST';
  executionImpact: 'NONE';
}

export interface EntryDecisionLedgerPenaltyDedupSummary {
  duplicatePenaltyGroups: CandidatePenaltyDedupTrace['duplicatePenaltyGroups'];
  dedupedNetScore: number;
  combinedScenarioSurvivor: boolean;
  tags: Array<
    | 'CASE_SUPPLY_UNKNOWN_DUPLICATE_PENALTY'
    | 'CASE_PROVIDER_UNKNOWN_NOT_BEARISH'
    | 'CASE_PENALTY_DEDUP_DRY_RUN'
    | 'CASE_SOFT_FAIL_DUPLICATE_PENALTY'
    | 'CASE_RISK_PENALTY_DOUBLE_COUNT'
    | 'CASE_COMBINED_POSITIVE_REPAIR_PENALTY_DEDUP'
  >;
  executionImpact: 'NONE';
}

export interface PenaltyDeduplicationBuildInput {
  positiveStarvationReport?: PositiveScoreStarvationReport | null;
  scoreCeilingRepairReport?: Gate1ScoreCeilingRepairReport | null;
  traces?: readonly Gate1ScoreStarvationTrace[];
  timestamp: string;
  forDate: string;
  regime: string;
  marketSession: string;
  riskMultiplier?: number;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function avg(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((acc, value) => acc + value, 0) / values.length;
}

function sum(values: readonly number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function estimateSurvivors(input: {
  totalCandidates: number;
  requiredScore: number;
  minScore: number;
  maxScore: number;
}): number {
  if (input.maxScore < input.requiredScore) return 0;
  if (input.minScore >= input.requiredScore) return input.totalCandidates;
  const range = Math.max(0.1, input.maxScore - input.minScore);
  return Math.min(
    input.totalCandidates,
    Math.max(1, Math.round(input.totalCandidates * ((input.maxScore - input.requiredScore) / range))),
  );
}

function toPenaltyCode(code: SignalScoreComponentTrace['code']): PenaltyComponentCode {
  if (code === 'SUPPLY_CONFLUENCE') return 'SUPPLY_CONFLUENCE';
  if (code === 'INVESTOR_FLOW') return 'INVESTOR_FLOW';
  if (code === 'RISK_PENALTY' || code === 'MACRO_RISK') return 'RISK_PENALTY';
  if (code === 'SOFT_FAIL_PENALTY') return 'SOFT_FAIL_PENALTY';
  if (code === 'SECTOR_ENERGY') return 'SECTOR_ENERGY';
  if (code === 'DATA_QUALITY' || code === 'UNKNOWN_DATA_PENALTY') return 'DATA_QUALITY_PENALTY';
  if (code === 'SESSION_STATUS') return 'SESSION_PENALTY';
  return 'OTHER_PENALTY';
}

function inferRootCause(input: {
  code: PenaltyComponentCode;
  providerIssue: boolean;
  marketSignal: boolean;
  message?: string;
}): PenaltyRootCauseCode {
  if (input.code === 'SUPPLY_CONFLUENCE') {
    return input.marketSignal ? 'SUPPLY_CONFLUENCE_BEARISH' : 'SUPPLY_PROVIDER_UNKNOWN';
  }
  if (input.code === 'INVESTOR_FLOW') {
    return input.marketSignal ? 'INVESTOR_FLOW_BEARISH' : 'SUPPLY_PROVIDER_UNKNOWN';
  }
  if (input.code === 'SOFT_FAIL_PENALTY' && input.providerIssue && !input.marketSignal) {
    return 'SUPPLY_PROVIDER_UNKNOWN';
  }
  if (input.code === 'RISK_PENALTY') return 'RISK_MULTIPLIER_LOW';
  if (input.code === 'SECTOR_ENERGY') return 'SECTOR_ENERGY_DIAGNOSTIC';
  if (input.code === 'DATA_QUALITY_PENALTY') return 'DATA_QUALITY_STALE';
  if (input.code === 'SESSION_PENALTY') return 'SESSION_SELL_ONLY';
  return 'UNKNOWN_ROOT_CAUSE';
}

export function penaltyComponentTrace(input: {
  code: PenaltyComponentCode;
  value: number;
  rootCause?: PenaltyRootCauseCode;
  providerIssue?: boolean;
  marketSignal?: boolean;
  confidence?: ScoreConfidence;
  message?: string;
}): PenaltyComponentTrace {
  const providerIssue = input.providerIssue ?? false;
  const marketSignal = input.marketSignal ?? false;
  const rootCause = input.rootCause ?? inferRootCause({
    code: input.code,
    providerIssue,
    marketSignal,
    message: input.message,
  });
  const supplyUnknown = rootCause === 'SUPPLY_PROVIDER_UNKNOWN' && providerIssue && !marketSignal;
  return {
    code: input.code,
    value: round2(Math.abs(input.value)),
    rootCause,
    providerIssue,
    marketSignal,
    confidence: input.confidence ?? (providerIssue ? 'UNKNOWN' : 'VERIFIED'),
    dedupeEligible: supplyUnknown,
    dedupeGroupKey: supplyUnknown ? 'SUPPLY_UNKNOWN' : undefined,
    message: input.message ?? `${input.code} penalty rootCause=${rootCause}`,
  };
}

function defaultAggregatePenalties(totalPenalty: number): PenaltyComponentTrace[] {
  const base = [
    penaltyComponentTrace({ code: 'SUPPLY_CONFLUENCE', value: 10, providerIssue: true, marketSignal: false }),
    penaltyComponentTrace({ code: 'INVESTOR_FLOW', value: 8, providerIssue: true, marketSignal: false }),
    penaltyComponentTrace({ code: 'SOFT_FAIL_PENALTY', value: 5, providerIssue: true, marketSignal: false }),
    penaltyComponentTrace({ code: 'RISK_PENALTY', value: 6.3, rootCause: 'RISK_MULTIPLIER_LOW', providerIssue: false, marketSignal: true }),
  ];
  const used = sum(base.map((item) => item.value));
  const remaining = round2(Math.max(0, totalPenalty - used));
  if (remaining > 0) {
    base.push(penaltyComponentTrace({
      code: 'SECTOR_ENERGY',
      value: remaining,
      rootCause: 'SECTOR_ENERGY_DIAGNOSTIC',
      providerIssue: false,
      marketSignal: false,
      confidence: 'DIAGNOSTIC_ONLY',
    }));
  }
  return base;
}

function penaltiesFromTrace(trace: Gate1ScoreStarvationTrace): PenaltyComponentTrace[] {
  if (trace.penaltyComponents.length === 0) return defaultAggregatePenalties(trace.totalPenaltyScore);
  return trace.penaltyComponents.map((component) => {
    const code = toPenaltyCode(component.code);
    return penaltyComponentTrace({
      code,
      value: Math.abs(component.weightedScore),
      providerIssue: component.providerIssue,
      marketSignal: component.marketSignal,
      confidence: component.confidence,
      message: component.message,
    });
  });
}

function buildDuplicateGroups(penalties: readonly PenaltyComponentTrace[]) {
  const groups = new Map<string, PenaltyComponentTrace[]>();
  for (const penalty of penalties) {
    if (!penalty.dedupeEligible || !penalty.dedupeGroupKey) continue;
    const items = groups.get(penalty.dedupeGroupKey) ?? [];
    items.push(penalty);
    groups.set(penalty.dedupeGroupKey, items);
  }
  return Array.from(groups.entries())
    .filter(([, items]) => items.length > 1)
    .map(([groupKey, items]) => {
      const originalTotalPenalty = round2(sum(items.map((item) => item.value)));
      const dedupedPenalty = round2(Math.max(...items.map((item) => item.value)));
      return {
        groupKey,
        rootCause: items[0]?.rootCause ?? 'UNKNOWN_ROOT_CAUSE',
        components: Array.from(new Set(items.map((item) => item.code))),
        originalTotalPenalty,
        dedupedPenalty,
        removedPenalty: round2(originalTotalPenalty - dedupedPenalty),
        reason: `${groupKey} provider unknown is not market bearish; keep largest diagnostic penalty only in dry-run.`,
      };
    });
}

export function buildCandidatePenaltyDedupTrace(input: {
  symbol: string;
  name?: string;
  grossPositiveScore: number;
  originalPenaltyTotal: number;
  originalNetScore: number;
  requiredScore: number;
  penalties: readonly PenaltyComponentTrace[];
}): CandidatePenaltyDedupTrace {
  const duplicatePenaltyGroups = buildDuplicateGroups(input.penalties);
  const diagnosticRemovedPenalty = sum(duplicatePenaltyGroups.map((group) => group.removedPenalty));
  const removedPenalty = round2(Math.min(Math.max(0, input.originalPenaltyTotal), diagnosticRemovedPenalty));
  const dedupedPenaltyTotal = round2(Math.max(0, input.originalPenaltyTotal - removedPenalty));
  const dedupedNetScore = round2(input.originalNetScore + removedPenalty);
  return {
    symbol: input.symbol,
    name: input.name,
    grossPositiveScore: round2(input.grossPositiveScore),
    originalPenaltyTotal: round2(input.originalPenaltyTotal),
    originalNetScore: round2(input.originalNetScore),
    requiredScore: round2(input.requiredScore),
    penalties: [...input.penalties],
    duplicatePenaltyGroups,
    dedupedPenaltyTotal,
    dedupedNetScore,
    scoreDeltaAfterDedup: round2(removedPenalty),
    wouldPassAfterDedup: dedupedNetScore >= input.requiredScore,
    executionImpact: 'NONE',
  };
}

function buildCandidateTraces(input: {
  report: PositiveScoreStarvationReport;
  traces?: readonly Gate1ScoreStarvationTrace[];
}): CandidatePenaltyDedupTrace[] {
  const traces = input.traces ?? [];
  if (traces.length > 0) {
    return traces.map((trace) => buildCandidatePenaltyDedupTrace({
      symbol: trace.symbol,
      name: trace.name,
      grossPositiveScore: trace.grossPositiveScore,
      originalPenaltyTotal: trace.totalPenaltyScore,
      originalNetScore: trace.actualScore,
      requiredScore: trace.requiredScore,
      penalties: penaltiesFromTrace(trace),
    }));
  }
  return Array.from({ length: input.report.totalCandidates }, (_, index) => buildCandidatePenaltyDedupTrace({
    symbol: `AGGREGATE_${String(index + 1).padStart(2, '0')}`,
    grossPositiveScore: input.report.grossPositiveScoreAvg,
    originalPenaltyTotal: input.report.totalPenaltyScoreAvg,
    originalNetScore: input.report.netScoreAvg,
    requiredScore: input.report.requiredScoreAvg,
    penalties: defaultAggregatePenalties(input.report.totalPenaltyScoreAvg),
  }));
}

function groupReport(traces: readonly CandidatePenaltyDedupTrace[]) {
  const keys = new Map<string, CandidatePenaltyDedupTrace['duplicatePenaltyGroups']>();
  for (const trace of traces) {
    for (const group of trace.duplicatePenaltyGroups) {
      const groups = keys.get(group.groupKey) ?? [];
      groups.push(group);
      keys.set(group.groupKey, groups);
    }
  }
  return Array.from(keys.entries()).map(([groupKey, groups]) => ({
    groupKey,
    rootCause: groups[0]?.rootCause ?? 'UNKNOWN_ROOT_CAUSE',
    affectedCount: groups.length,
    avgOriginalPenalty: round1(avg(groups.map((group) => group.originalTotalPenalty))),
    avgDedupedPenalty: round1(avg(groups.map((group) => group.dedupedPenalty))),
    avgRemovedPenalty: round1(avg(groups.map((group) => group.removedPenalty))),
    components: Array.from(new Set(groups.flatMap((group) => group.components))),
  }));
}

function scenarioAdjustedPenalty(input: {
  trace: CandidatePenaltyDedupTrace;
  scenario: PenaltyDedupScenario;
  positiveRepairDelta: number;
  riskCap: number;
}): { penalty: number; net: number; reasons: string[] } {
  const supplyUnknown = input.trace.duplicatePenaltyGroups.find((group) => group.groupKey === 'SUPPLY_UNKNOWN');
  const supplyOriginal = supplyUnknown?.originalTotalPenalty ?? 0;
  const supplyKeepLargest = supplyUnknown?.dedupedPenalty ?? supplyOriginal;
  const providerPenalty = sum(input.trace.penalties.filter((item) => item.providerIssue).map((item) => item.value));
  const marketSignalPenalty = sum(input.trace.penalties.filter((item) => item.marketSignal).map((item) => item.value));
  const riskPenalty = input.trace.penalties.find((item) => item.code === 'RISK_PENALTY')?.value ?? 0;
  let penalty = input.trace.originalPenaltyTotal;
  let positiveDelta = 0;
  const reasons = [input.scenario, 'ADR-0469_DRY_RUN_ONLY'];
  if (input.scenario === 'KEEP_LARGEST_PER_ROOT_CAUSE') penalty -= Math.max(0, supplyOriginal - supplyKeepLargest);
  if (input.scenario === 'CAP_SUPPLY_UNKNOWN_PENALTY_10') penalty -= Math.max(0, supplyOriginal - 10);
  if (input.scenario === 'CAP_SUPPLY_UNKNOWN_PENALTY_5') penalty -= Math.max(0, supplyOriginal - 5);
  if (input.scenario === 'REMOVE_PROVIDER_UNKNOWN_PENALTY') penalty -= providerPenalty;
  if (input.scenario === 'KEEP_ONLY_MARKET_SIGNAL_PENALTIES') penalty = marketSignalPenalty;
  if (input.scenario === 'DEDUP_AND_POSITIVE_REPAIR' || input.scenario === 'DEDUP_POSITIVE_REPAIR_AND_RISK_CAP') {
    penalty -= Math.max(0, supplyOriginal - supplyKeepLargest);
    positiveDelta = input.positiveRepairDelta;
  }
  if (input.scenario === 'DEDUP_POSITIVE_REPAIR_AND_RISK_CAP') {
    penalty -= Math.max(0, riskPenalty - input.riskCap);
  }
  penalty = round2(Math.max(0, penalty));
  return {
    penalty,
    net: round2(input.trace.grossPositiveScore + positiveDelta - penalty),
    reasons,
  };
}

export function buildPenaltyDedupScenarioResults(input: {
  traces: readonly CandidatePenaltyDedupTrace[];
  positiveRepairDelta?: number;
  riskCap?: number;
}): PenaltyDedupScenarioResult[] {
  const scenarios: PenaltyDedupScenario[] = [
    'CURRENT',
    'KEEP_LARGEST_PER_ROOT_CAUSE',
    'CAP_SUPPLY_UNKNOWN_PENALTY_10',
    'CAP_SUPPLY_UNKNOWN_PENALTY_5',
    'REMOVE_PROVIDER_UNKNOWN_PENALTY',
    'KEEP_ONLY_MARKET_SIGNAL_PENALTIES',
    'DEDUP_AND_POSITIVE_REPAIR',
    'DEDUP_POSITIVE_REPAIR_AND_RISK_CAP',
  ];
  return scenarios.map((scenario) => {
    const adjusted = input.traces.map((trace) =>
      scenarioAdjustedPenalty({
        trace,
        scenario,
        positiveRepairDelta: input.positiveRepairDelta ?? 0,
        riskCap: input.riskCap ?? 3,
      }),
    );
    const scores = adjusted.map((item) => item.net);
    const survivors = input.traces
      .map((trace, index) => ({ trace, adjusted: adjusted[index] }))
      .filter((item) => (item.adjusted?.net ?? 0) >= item.trace.requiredScore);
    return {
      scenario,
      penaltyAvg: round1(avg(adjusted.map((item) => item.penalty))),
      netScoreAvg: round1(avg(scores)),
      scoreMin: round1(scores.length > 0 ? Math.min(...scores) : 0),
      scoreMax: round1(scores.length > 0 ? Math.max(...scores) : 0),
      hypotheticalSurvivors: survivors.length,
      survivorExamples: survivors.slice(0, 5).map((item) => ({
        symbol: item.trace.symbol,
        name: item.trace.name,
        originalScore: item.trace.originalNetScore,
        adjustedScore: item.adjusted?.net ?? item.trace.originalNetScore,
        requiredScore: item.trace.requiredScore,
        reason: item.adjusted?.reasons ?? [scenario],
      })),
      executionImpact: 'NONE',
    };
  });
}

export function buildRiskPenaltyDedupAudit(input: {
  symbol: string;
  requiredScore: number;
  originalNetScore: number;
  riskMultiplier: number;
  signalRiskPenalty: number;
}): RiskPenaltyDedupAudit {
  const kellyRiskPenaltyApplied = input.riskMultiplier < 0.8;
  const doubleCountWarning = input.signalRiskPenalty > 0 && kellyRiskPenaltyApplied;
  return {
    symbol: input.symbol,
    riskMultiplier: input.riskMultiplier,
    signalRiskPenalty: round1(input.signalRiskPenalty),
    kellyRiskPenaltyApplied,
    doubleCountWarning,
    riskPenaltyRootCause: input.riskMultiplier < 0.8 ? 'RISK_MULTIPLIER_LOW' : 'MACRO_RISK',
    wouldPassIfSignalRiskPenaltyCapped: input.originalNetScore + Math.max(0, input.signalRiskPenalty - 3) >= input.requiredScore,
    wouldPassIfRiskPenaltyAppliedOnlyAtSizing: input.originalNetScore + input.signalRiskPenalty >= input.requiredScore,
  };
}

export function buildSoftFailPenaltyAudit(input: {
  symbol: string;
  penalties: readonly PenaltyComponentTrace[];
}): SoftFailPenaltyAudit {
  const softFail = input.penalties.find((item) => item.code === 'SOFT_FAIL_PENALTY');
  const supplyUnknownExists = input.penalties.some((item) =>
    item.dedupeGroupKey === 'SUPPLY_UNKNOWN' && item.code !== 'SOFT_FAIL_PENALTY');
  const duplicate = Boolean(softFail?.dedupeGroupKey === 'SUPPLY_UNKNOWN' && supplyUnknownExists);
  return {
    symbol: input.symbol,
    softFailPenalty: softFail?.value ?? 0,
    softFailSources: softFail
      ? [{
          code: 'SOFT_FAIL_PENALTY',
          rootCause: softFail.rootCause,
          providerIssue: softFail.providerIssue,
          marketSignal: softFail.marketSignal,
          penaltyContribution: softFail.value,
        }]
      : [],
    duplicateWithOtherPenalty: duplicate,
    duplicateGroupKey: duplicate ? 'SUPPLY_UNKNOWN' : undefined,
  };
}

function positiveRepairDelta(report?: Gate1ScoreCeilingRepairReport | null): number {
  if (!report) return 0;
  const allPositive = report?.dryRunResults.find((item) => item.scenario === 'ALL_POSITIVE_WIRING_REPAIRED');
  if (!allPositive) return 0;
  return round1(allPositive.hypotheticalNetAvg - report.actualScoreAvg);
}

function buildCombinedResults(input: {
  positiveReport: PositiveScoreStarvationReport;
  scenarioResults: readonly PenaltyDedupScenarioResult[];
  positiveRepairDelta: number;
}): CombinedGate1CalibrationResult[] {
  const resultFor = (scenario: PenaltyDedupScenario) =>
    input.scenarioResults.find((item) => item.scenario === scenario);
  const current = resultFor('CURRENT');
  const dedup = resultFor('KEEP_LARGEST_PER_ROOT_CAUSE');
  const cap10 = resultFor('CAP_SUPPLY_UNKNOWN_PENALTY_10');
  const cap5 = resultFor('CAP_SUPPLY_UNKNOWN_PENALTY_5');
  const combined = resultFor('DEDUP_AND_POSITIVE_REPAIR');
  const riskCap = resultFor('DEDUP_POSITIVE_REPAIR_AND_RISK_CAP');
  const rows: Array<[string, PenaltyDedupScenarioResult | undefined, number]> = [
    ['CURRENT', current, 0],
    ['POSITIVE_REPAIR_ONLY', current, input.positiveRepairDelta],
    ['PENALTY_DEDUP_ONLY', dedup, 0],
    ['POSITIVE_REPAIR_AND_PENALTY_DEDUP', combined, input.positiveRepairDelta],
    ['POSITIVE_REPAIR_AND_UNKNOWN_CAP_10', cap10, input.positiveRepairDelta],
    ['POSITIVE_REPAIR_AND_UNKNOWN_CAP_5', cap5, input.positiveRepairDelta],
    ['POSITIVE_REPAIR_DEDUP_AND_RISK_CAP', riskCap, input.positiveRepairDelta],
  ];
  return rows.map(([scenario, result, positiveDelta]) => {
    const netAvg = round1((result?.netScoreAvg ?? input.positiveReport.netScoreAvg) + (
      scenario === 'POSITIVE_REPAIR_ONLY' ||
      scenario === 'POSITIVE_REPAIR_AND_UNKNOWN_CAP_10' ||
      scenario === 'POSITIVE_REPAIR_AND_UNKNOWN_CAP_5'
        ? positiveDelta
        : 0
    ));
    const scoreMin = round1((result?.scoreMin ?? input.positiveReport.actualScoreMin) + (
      scenario === 'POSITIVE_REPAIR_ONLY' ||
      scenario === 'POSITIVE_REPAIR_AND_UNKNOWN_CAP_10' ||
      scenario === 'POSITIVE_REPAIR_AND_UNKNOWN_CAP_5'
        ? positiveDelta
        : 0
    ));
    const scoreMax = round1((result?.scoreMax ?? input.positiveReport.actualScoreMax) + (
      scenario === 'POSITIVE_REPAIR_ONLY' ||
      scenario === 'POSITIVE_REPAIR_AND_UNKNOWN_CAP_10' ||
      scenario === 'POSITIVE_REPAIR_AND_UNKNOWN_CAP_5'
        ? positiveDelta
        : 0
    ));
    return {
      scenario,
      positiveAvg: round1(input.positiveReport.grossPositiveScoreAvg + positiveDelta),
      penaltyAvg: result?.penaltyAvg ?? input.positiveReport.totalPenaltyScoreAvg,
      netScoreAvg: netAvg,
      scoreMin,
      scoreMax,
      survivors: result?.hypotheticalSurvivors ?? estimateSurvivors({
        totalCandidates: input.positiveReport.totalCandidates,
        requiredScore: input.positiveReport.requiredScoreAvg,
        minScore: scoreMin,
        maxScore: scoreMax,
      }),
      executionImpact: 'NONE',
    };
  });
}

export function buildEntryDecisionLedgerPenaltyDedupSummary(input: {
  trace: CandidatePenaltyDedupTrace;
  riskAudit?: RiskPenaltyDedupAudit;
  combinedCalibrationResults?: readonly CombinedGate1CalibrationResult[];
}): EntryDecisionLedgerPenaltyDedupSummary {
  const tags: EntryDecisionLedgerPenaltyDedupSummary['tags'] = ['CASE_PENALTY_DEDUP_DRY_RUN'];
  if (input.trace.duplicatePenaltyGroups.some((group) => group.groupKey === 'SUPPLY_UNKNOWN')) {
    tags.push('CASE_SUPPLY_UNKNOWN_DUPLICATE_PENALTY', 'CASE_PROVIDER_UNKNOWN_NOT_BEARISH');
  }
  if (input.trace.penalties.some((item) => item.code === 'SOFT_FAIL_PENALTY' && item.dedupeGroupKey === 'SUPPLY_UNKNOWN')) {
    tags.push('CASE_SOFT_FAIL_DUPLICATE_PENALTY');
  }
  if (input.riskAudit?.doubleCountWarning) tags.push('CASE_RISK_PENALTY_DOUBLE_COUNT');
  const combinedSurvivor = (input.combinedCalibrationResults ?? [])
    .some((item) => item.scenario.includes('POSITIVE_REPAIR') && item.survivors > 0);
  if (combinedSurvivor) tags.push('CASE_COMBINED_POSITIVE_REPAIR_PENALTY_DEDUP');
  return {
    duplicatePenaltyGroups: input.trace.duplicatePenaltyGroups,
    dedupedNetScore: input.trace.dedupedNetScore,
    combinedScenarioSurvivor: combinedSurvivor,
    tags: Array.from(new Set(tags)),
    executionImpact: 'NONE',
  };
}

export function buildEntryDecisionLedgerPenaltyDedupSummaryFromScore(input: {
  symbol: string;
  grossPositiveScore: number;
  originalPenaltyTotal: number;
  originalNetScore: number;
  requiredScore: number;
  riskMultiplier?: number;
}): EntryDecisionLedgerPenaltyDedupSummary {
  const trace = buildCandidatePenaltyDedupTrace({
    symbol: input.symbol,
    grossPositiveScore: input.grossPositiveScore,
    originalPenaltyTotal: input.originalPenaltyTotal,
    originalNetScore: input.originalNetScore,
    requiredScore: input.requiredScore,
    penalties: defaultAggregatePenalties(input.originalPenaltyTotal),
  });
  const riskAudit = buildRiskPenaltyDedupAudit({
    symbol: input.symbol,
    requiredScore: input.requiredScore,
    originalNetScore: input.originalNetScore,
    riskMultiplier: input.riskMultiplier ?? 0.38,
    signalRiskPenalty: trace.penalties.find((item) => item.code === 'RISK_PENALTY')?.value ?? 0,
  });
  return buildEntryDecisionLedgerPenaltyDedupSummary({
    trace,
    riskAudit,
    combinedCalibrationResults: [],
  });
}

export function buildPenaltyDeduplicationReport(input: PenaltyDeduplicationBuildInput): PenaltyDeduplicationReport | null {
  const positiveReport = input.positiveStarvationReport;
  if (!positiveReport || positiveReport.totalCandidates <= 0) return null;
  const traces = buildCandidateTraces({
    report: positiveReport,
    traces: input.traces,
  });
  const positiveDelta = positiveRepairDelta(input.scoreCeilingRepairReport);
  const scenarioResults = buildPenaltyDedupScenarioResults({
    traces,
    positiveRepairDelta: positiveDelta,
    riskCap: 3,
  });
  const duplicateGroups = groupReport(traces);
  const riskPenaltyAvg = avg(traces.map((trace) =>
    trace.penalties.find((item) => item.code === 'RISK_PENALTY')?.value ?? 0));
  const firstTrace = traces[0];
  const riskPenaltyAudit = buildRiskPenaltyDedupAudit({
    symbol: firstTrace?.symbol ?? 'AGGREGATE_SAMPLE',
    requiredScore: positiveReport.requiredScoreAvg,
    originalNetScore: positiveReport.netScoreAvg,
    riskMultiplier: input.riskMultiplier ?? 0.38,
    signalRiskPenalty: riskPenaltyAvg,
  });
  const softFailPenaltyAudit = buildSoftFailPenaltyAudit({
    symbol: firstTrace?.symbol ?? 'AGGREGATE_SAMPLE',
    penalties: firstTrace?.penalties ?? defaultAggregatePenalties(positiveReport.totalPenaltyScoreAvg),
  });
  const combinedCalibrationResults = buildCombinedResults({
    positiveReport,
    scenarioResults,
    positiveRepairDelta: positiveDelta,
  });
  const dedupedNetScores = traces.map((trace) => trace.dedupedNetScore);
  const providerIssuePenaltyAvg = round1(avg(traces.map((trace) =>
    sum(trace.penalties.filter((penalty) => penalty.providerIssue).map((penalty) => penalty.value)))));
  const marketSignalPenaltyAvg = round1(avg(traces.map((trace) =>
    sum(trace.penalties.filter((penalty) => penalty.marketSignal).map((penalty) => penalty.value)))));
  const unknownPenaltyAvg = round1(avg(traces.map((trace) =>
    sum(trace.penalties.filter((penalty) => penalty.providerIssue && !penalty.marketSignal).map((penalty) => penalty.value)))));
  const bearishPenaltyAvg = round1(avg(traces.map((trace) =>
    sum(trace.penalties.filter((penalty) =>
      penalty.marketSignal &&
      (penalty.rootCause === 'SUPPLY_CONFLUENCE_BEARISH' || penalty.rootCause === 'INVESTOR_FLOW_BEARISH')
    ).map((penalty) => penalty.value)))));
  const survivorsAfterDedup = traces.filter((trace) => trace.wouldPassAfterDedup).length;
  const dedupPositive = scenarioResults.find((item) => item.scenario === 'DEDUP_AND_POSITIVE_REPAIR');
  const effectiveOriginalPenaltyAvg = round1(avg(traces.map((trace) => trace.originalPenaltyTotal)));
  const effectiveDedupedPenaltyAvg = round1(avg(traces.map((trace) => trace.dedupedPenaltyTotal)));
  const effectiveRemovedPenaltyAvg = round1(avg(traces.map((trace) => trace.scoreDeltaAfterDedup)));
  const diagnosticOriginalPenaltyAvg = round1(avg(traces.map((trace) =>
    sum(trace.duplicatePenaltyGroups.map((group) => group.originalTotalPenalty)))));
  const diagnosticDedupedPenaltyAvg = round1(avg(traces.map((trace) =>
    sum(trace.duplicatePenaltyGroups.map((group) => group.dedupedPenalty)))));
  const diagnosticRemovedPenaltyAvg = round1(avg(traces.map((trace) =>
    sum(trace.duplicatePenaltyGroups.map((group) => group.removedPenalty)))));
  let recommendedAction: PenaltyDeduplicationReport['recommendedAction'] = 'DIAGNOSTIC_ONLY';
  if (diagnosticRemovedPenaltyAvg > 0 && effectiveOriginalPenaltyAvg === 0) {
    recommendedAction = 'DIAGNOSTIC_ONLY';
  } else if (duplicateGroups.some((group) => group.groupKey === 'SUPPLY_UNKNOWN') && effectiveOriginalPenaltyAvg > 0) {
    recommendedAction = 'DEDUP_SUPPLY_UNKNOWN_PENALTY';
  }
  else if (riskPenaltyAudit.doubleCountWarning) recommendedAction = 'REVIEW_RISK_PENALTY';
  else if (softFailPenaltyAudit.duplicateWithOtherPenalty) recommendedAction = 'REVIEW_SOFT_FAIL_ACCUMULATION';

  return {
    timestamp: input.timestamp,
    forDate: input.forDate,
    regime: input.regime,
    marketSession: input.marketSession,
    totalCandidates: positiveReport.totalCandidates,
    originalPenaltyAvg: effectiveOriginalPenaltyAvg,
    dedupedPenaltyAvg: effectiveDedupedPenaltyAvg,
    removedPenaltyAvg: effectiveRemovedPenaltyAvg,
    effectiveOriginalPenaltyAvg,
    effectiveDedupedPenaltyAvg,
    effectiveRemovedPenaltyAvg,
    diagnosticOriginalPenaltyAvg,
    diagnosticDedupedPenaltyAvg,
    diagnosticRemovedPenaltyAvg,
    effectiveGateScoreImpact: effectiveRemovedPenaltyAvg,
    diagnosticOnly: diagnosticRemovedPenaltyAvg > 0 && effectiveRemovedPenaltyAvg === 0,
    originalNetScoreAvg: round1(avg(traces.map((trace) => trace.originalNetScore))),
    dedupedNetScoreAvg: round1(avg(dedupedNetScores)),
    avgScoreDelta: round1(avg(traces.map((trace) => trace.scoreDeltaAfterDedup))),
    duplicateGroups,
    providerIssuePenaltyAvg,
    marketSignalPenaltyAvg,
    unknownPenaltyAvg,
    bearishPenaltyAvg,
    survivorsAfterDedup,
    survivorsAfterDedupAndPositiveRepair: dedupPositive?.hypotheticalSurvivors ?? 0,
    survivorExamples: traces
      .filter((trace) => trace.wouldPassAfterDedup)
      .slice(0, 5)
      .map((trace) => ({
        symbol: trace.symbol,
        name: trace.name,
        originalNetScore: trace.originalNetScore,
        dedupedNetScore: trace.dedupedNetScore,
        requiredScore: trace.requiredScore,
        reason: ['SUPPLY_UNKNOWN_DUPLICATE_PENALTY_REMOVED', 'ADR-0469_DRY_RUN_ONLY'],
      })),
    riskPenaltyAudit,
    softFailPenaltyAudit,
    scenarioResults,
    combinedCalibrationResults,
    recommendedAction,
    executionImpact: 'NONE',
  };
}

export function formatPenaltyDeduplicationReport(
  report?: PenaltyDeduplicationReport | null,
  canonicalRuntimeResolution?: CanonicalRuntimeResolutionStep27,
): string | null {
  if (!report || report.totalCandidates <= 0) return null;
  const scenarios = Object.fromEntries(
    report.scenarioResults.map((item) => [item.scenario, item]),
  ) as Partial<Record<PenaltyDedupScenario, PenaltyDedupScenarioResult>>;
  const lines = [
    '🧯 Penalty Deduplication Audit (ADR-0469)',
    `  candidates: ${report.totalCandidates}`,
    `  effectiveOriginalPenaltyAvg: ${(report.effectiveOriginalPenaltyAvg ?? report.originalPenaltyAvg).toFixed(1)}`,
    `  effectiveDedupedPenaltyAvg: ${(report.effectiveDedupedPenaltyAvg ?? report.dedupedPenaltyAvg).toFixed(1)}`,
    `  effectiveRemovedPenaltyAvg: ${(report.effectiveRemovedPenaltyAvg ?? report.removedPenaltyAvg).toFixed(1)}`,
    `  diagnosticOriginalPenaltyAvg: ${(report.diagnosticOriginalPenaltyAvg ?? 0).toFixed(1)}`,
    `  diagnosticDedupedPenaltyAvg: ${(report.diagnosticDedupedPenaltyAvg ?? 0).toFixed(1)}`,
    `  diagnosticRemovedPenaltyAvg: ${(report.diagnosticRemovedPenaltyAvg ?? 0).toFixed(1)}`,
    `  effectiveGateScoreImpact: ${(report.effectiveGateScoreImpact ?? 0).toFixed(1)}`,
    `  diagnosticOnly: ${report.diagnosticOnly ?? false}`,
    `  originalNetScoreAvg: ${report.originalNetScoreAvg.toFixed(1)}`,
    `  dedupedNetScoreAvg: ${report.dedupedNetScoreAvg.toFixed(1)}`,
    `  avgScoreDelta: +${report.avgScoreDelta.toFixed(1)}`,
  ];
  if (report.duplicateGroups.length > 0) {
    const group = report.duplicateGroups[0];
    if (group) {
      lines.push(
        '  Duplicate penalty groups:',
        `  1. ${group.groupKey}`,
        `     components: ${group.components.join(', ')}`,
        `     affected: ${group.affectedCount}`,
        `     rootCause: ${group.rootCause}`,
        '     providerIssue: true',
        '     marketSignal: false',
        '     scope: DIAGNOSTIC_SIMULATION',
        `     diagnosticAvgOriginalPenalty: ${group.avgOriginalPenalty.toFixed(1)}`,
        `     diagnosticAvgDedupedPenalty: ${group.avgDedupedPenalty.toFixed(1)}`,
        `     diagnosticAvgRemovedPenalty: ${group.avgRemovedPenalty.toFixed(1)}`,
        '     effectiveGateScoreImpact: 0.0',
      );
    }
  }
  lines.push(
    '  Penalty source split:',
    ...(canonicalRuntimeResolution
      ? [
          `  originalDiagnosticProviderPenaltyAvg: ${canonicalRuntimeResolution.providerPenalty.originalDiagnosticProviderPenaltyAvg.toFixed(1)}`,
          `  effectiveProviderPenaltyAvg: ${canonicalRuntimeResolution.providerPenalty.effectiveProviderPenaltyAvg.toFixed(1)}`,
          `  originalDiagnosticUnknownPenaltyAvg: ${canonicalRuntimeResolution.providerPenalty.originalDiagnosticUnknownPenaltyAvg.toFixed(1)}`,
          `  effectiveUnknownPenaltyAvg: ${canonicalRuntimeResolution.providerPenalty.effectiveUnknownPenaltyAvg.toFixed(1)}`,
          `  penaltyScope: ${canonicalRuntimeResolution.providerPenalty.penaltyScope}`,
          '  gateScoreImpact: 0.0',
        ]
      : [
          `  providerIssuePenaltyAvg: ${report.providerIssuePenaltyAvg.toFixed(1)}`,
          `  unknownPenaltyAvg: ${report.unknownPenaltyAvg.toFixed(1)}`,
        ]),
    `  marketSignalPenaltyAvg: ${report.marketSignalPenaltyAvg.toFixed(1)}`,
    `  bearishPenaltyAvg: ${report.bearishPenaltyAvg.toFixed(1)}`,
    '  Risk penalty:',
    `  signalRiskPenaltyAvg: ${report.riskPenaltyAudit.signalRiskPenalty.toFixed(1)}`,
    `  kellyRiskMultiplier: ${report.riskPenaltyAudit.riskMultiplier.toFixed(2)}`,
    `  doubleCountWarning: ${report.riskPenaltyAudit.doubleCountWarning}`,
    '  Dry-run scenarios:',
    `  1. CURRENT: survivors ${scenarios.CURRENT?.hypotheticalSurvivors ?? 0} / netAvg ${(scenarios.CURRENT?.netScoreAvg ?? report.originalNetScoreAvg).toFixed(1)}`,
    `  2. KEEP_LARGEST_PER_ROOT_CAUSE: survivors ${scenarios.KEEP_LARGEST_PER_ROOT_CAUSE?.hypotheticalSurvivors ?? 0}`,
    `  3. CAP_SUPPLY_UNKNOWN_PENALTY_10: survivors ${scenarios.CAP_SUPPLY_UNKNOWN_PENALTY_10?.hypotheticalSurvivors ?? 0}`,
    `  4. CAP_SUPPLY_UNKNOWN_PENALTY_5: survivors ${scenarios.CAP_SUPPLY_UNKNOWN_PENALTY_5?.hypotheticalSurvivors ?? 0}`,
    `  5. KEEP_ONLY_MARKET_SIGNAL_PENALTIES: survivors ${scenarios.KEEP_ONLY_MARKET_SIGNAL_PENALTIES?.hypotheticalSurvivors ?? 0}`,
    `  6. DEDUP_AND_POSITIVE_REPAIR: survivors ${scenarios.DEDUP_AND_POSITIVE_REPAIR?.hypotheticalSurvivors ?? 0}`,
    `  7. DEDUP_POSITIVE_REPAIR_AND_RISK_CAP: survivors ${scenarios.DEDUP_POSITIVE_REPAIR_AND_RISK_CAP?.hypotheticalSurvivors ?? 0}`,
    `  survivorsAfterDedup: ${report.survivorsAfterDedup}`,
    `  survivorsAfterDedupAndPositiveRepair: ${report.survivorsAfterDedupAndPositiveRepair}`,
    '  executionImpact: NONE',
    `  recommendedAction: ${report.recommendedAction}`,
  );
  return lines.join('\n');
}
