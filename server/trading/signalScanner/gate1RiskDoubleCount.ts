// @responsibility ADR-0470 Gate1 risk double-count dry-run audit
import type {
  Gate1ScoreStarvationTrace,
  PositiveScoreStarvationReport,
} from './gate1PositiveScoreStarvation.js';
import type { Gate1ScoreCeilingRepairReport } from './gate1ScoreCeilingRepair.js';
import type { PenaltyDeduplicationReport } from './gate1PenaltyDeduplication.js';

export type RiskPenaltyPlacement =
  | 'SIGNAL_SCORE'
  | 'GATE1_HARD_BLOCK'
  | 'GATE1_SOFT_FAIL'
  | 'KELLY_SIZING'
  | 'POSITION_CAP'
  | 'ADVISORY_ONLY'
  | 'UNKNOWN';

export type RiskRootCauseCode =
  | 'MACRO_RISK'
  | 'REGIME_RISK'
  | 'FOMC_RISK'
  | 'VOLATILITY_RISK'
  | 'SECTOR_RISK'
  | 'SUPPLY_PROVIDER_UNKNOWN'
  | 'SECTOR_ENERGY_DEGRADED'
  | 'SELL_ONLY_SESSION'
  | 'DATA_QUALITY_STALE'
  | 'UNKNOWN_RISK';

export interface RiskPenaltyComponentTrace {
  code: RiskRootCauseCode;
  placement: RiskPenaltyPlacement;
  value: number;
  multiplier?: number;
  providerIssue: boolean;
  marketSignal: boolean;
  executionBlocking: boolean;
  sizingOnly: boolean;
  message: string;
}

export interface CandidateRiskDoubleCountTrace {
  symbol: string;
  name?: string;
  originalSignalScore: number;
  originalSignalRiskPenalty: number;
  originalKellyMultiplier: number;
  originalFinalKelly?: number;
  riskComponents: RiskPenaltyComponentTrace[];
  signalRiskRootCauses: RiskRootCauseCode[];
  sizingRiskRootCauses: RiskRootCauseCode[];
  duplicateRiskRootCauses: RiskRootCauseCode[];
  doubleCountDetected: boolean;
  doubleCountScoreImpact: number;
  scoreIfRiskAtSizingOnly: number;
  scoreIfRiskAtSignalOnly: number;
  scoreIfRiskCappedAt05: number;
  scoreIfRiskCappedAt07: number;
  wouldPassIfRiskAtSizingOnly: boolean;
  wouldPassIfRiskCappedAt05: boolean;
  wouldPassIfRiskCappedAt07: boolean;
  executionImpact: 'NONE';
}

export interface Gate1RiskSplitPolicy {
  riskRootCause: RiskRootCauseCode;
  signalEligibilityAction:
    | 'NO_EFFECT'
    | 'ADVISORY'
    | 'SOFT_PENALTY'
    | 'HARD_BLOCK';
  sizingAction:
    | 'NO_EFFECT'
    | 'KELLY_MULTIPLIER'
    | 'POSITION_CAP'
    | 'SIZE_ZERO';
  allowDoubleCount: boolean;
  message: string;
}

export interface RiskMultiplierBreakdown {
  regimeMultiplier: number;
  fomcMultiplier: number;
  sectorMultiplier: number;
  volatilityMultiplier?: number;
  macroHealthMultiplier?: number;
  providerHealthMultiplier?: number;
  sectorEnergyMultiplier?: number;
  unknownDataMultiplier?: number;
  finalRiskMultiplier: number;
  combinedKellyMultiplier: number;
  rootCauses: Array<{
    code: RiskRootCauseCode;
    multiplierImpact: number;
    providerIssue: boolean;
    marketSignal: boolean;
    message: string;
  }>;
}

export type RiskPlacementScenario =
  | 'CURRENT'
  | 'RISK_AT_SIGNAL_ONLY'
  | 'RISK_AT_SIZING_ONLY'
  | 'REMOVE_SIGNAL_RISK_KEEP_KELLY'
  | 'KEEP_SIGNAL_RISK_REMOVE_KELLY_RISK'
  | 'RISK_CAP_0_50'
  | 'RISK_CAP_0_70'
  | 'R3_EARLY_RISK_CAP_0_70'
  | 'POSITIVE_REPAIR_DEDUP_RISK_AT_SIZING_ONLY'
  | 'POSITIVE_REPAIR_DEDUP_RISK_CAP_0_70'
  | 'KEEP_ONLY_MARKET_SIGNAL_RISK';

export interface RiskPlacementScenarioResult {
  scenario: RiskPlacementScenario;
  signalScoreAvg: number;
  riskPenaltyAvg: number;
  kellyMultiplierAvg: number;
  netScoreAvg: number;
  scoreMin: number;
  scoreMax: number;
  gate1Survivors: number;
  sizingEligibleCount: number;
  avgPositionScale?: number;
  executionImpact: 'NONE';
  survivorExamples: Array<{
    symbol: string;
    name?: string;
    beforeScore: number;
    afterScore: number;
    requiredScore: number;
    kellyMultiplier: number;
    reason: string[];
  }>;
}

export interface FinalGate1CalibrationMatrix {
  scenario: string;
  positiveAvg: number;
  penaltyAvg: number;
  riskPenaltyAvg: number;
  netScoreAvg: number;
  gate1Survivors: number;
  sizingEligibleCount: number;
  executionImpact: 'NONE';
}

export interface RiskDoubleCountAuditReport {
  timestamp: string;
  forDate: string;
  regime: string;
  marketSession: string;
  totalCandidates: number;
  signalRiskPenaltyAvg: number;
  kellyRiskMultiplierAvg: number;
  combinedKellyMultiplierAvg: number;
  doubleCountCandidates: number;
  duplicateRiskRootCauses: Array<{
    code: RiskRootCauseCode;
    affectedCount: number;
    avgSignalPenalty: number;
    avgSizingMultiplierImpact: number;
    providerIssue: boolean;
    marketSignal: boolean;
  }>;
  riskMultiplierBreakdown: RiskMultiplierBreakdown;
  scenarios: RiskPlacementScenarioResult[];
  finalCalibrationMatrix: FinalGate1CalibrationMatrix[];
  firstSurvivorScenario?: string;
  scaleCalibrationRecommended: boolean;
  recommendedAction:
    | 'NO_ACTION'
    | 'DIAGNOSTIC_ONLY'
    | 'MOVE_RISK_TO_SIZING_DRY_RUN'
    | 'CAP_RISK_MULTIPLIER_DRY_RUN'
    | 'KEEP_ONLY_MARKET_SIGNAL_RISK_DRY_RUN'
    | 'REVIEW_RISK_ROOT_CAUSE';
  executionImpact: 'NONE';
}

export interface EntryDecisionLedgerRiskDoubleCountSummary {
  doubleCountDetected: boolean;
  duplicateRiskRootCauses: RiskRootCauseCode[];
  scenarioWouldPass: Array<{
    scenario: RiskPlacementScenario;
    wouldPass: boolean;
    executionImpact: 'NONE';
  }>;
  tags: Array<
    | 'CASE_RISK_DOUBLE_COUNT'
    | 'CASE_RISK_SIGNAL_AND_KELLY_DUPLICATE'
    | 'CASE_RISK_AT_SIZING_ONLY_DRY_RUN'
    | 'CASE_RISK_CAP_DRY_RUN'
    | 'CASE_FINAL_GATE1_CALIBRATION_MATRIX'
    | 'CASE_SCORE_SCALE_MISMATCH_IF_NO_SURVIVORS'
  >;
  executionImpact: 'NONE';
}

export interface RiskDoubleCountBuildInput {
  positiveStarvationReport?: PositiveScoreStarvationReport | null;
  scoreCeilingRepairReport?: Gate1ScoreCeilingRepairReport | null;
  penaltyDeduplicationReport?: PenaltyDeduplicationReport | null;
  traces?: readonly Gate1ScoreStarvationTrace[];
  timestamp: string;
  forDate: string;
  regime: string;
  marketSession: string;
  regimeMultiplier?: number;
  fomcMultiplier?: number;
  sectorMultiplier?: number;
  finalRiskMultiplier?: number;
  combinedKellyMultiplier?: number;
}

export const GATE1_RISK_SPLIT_POLICIES: Gate1RiskSplitPolicy[] = [
  {
    riskRootCause: 'REGIME_RISK',
    signalEligibilityAction: 'ADVISORY',
    sizingAction: 'KELLY_MULTIPLIER',
    allowDoubleCount: false,
    message: 'Regime risk should mainly scale position size unless it becomes a severe hard-block regime.',
  },
  {
    riskRootCause: 'MACRO_RISK',
    signalEligibilityAction: 'SOFT_PENALTY',
    sizingAction: 'KELLY_MULTIPLIER',
    allowDoubleCount: false,
    message: 'General macro risk can be advisory/soft in signal eligibility and primary in sizing.',
  },
  {
    riskRootCause: 'FOMC_RISK',
    signalEligibilityAction: 'ADVISORY',
    sizingAction: 'KELLY_MULTIPLIER',
    allowDoubleCount: false,
    message: 'FOMC normal phase should not double-count in signal score and Kelly sizing.',
  },
  {
    riskRootCause: 'VOLATILITY_RISK',
    signalEligibilityAction: 'SOFT_PENALTY',
    sizingAction: 'POSITION_CAP',
    allowDoubleCount: false,
    message: 'Volatility risk may cap size; severe volatility remains a separate hard-block policy.',
  },
  {
    riskRootCause: 'SUPPLY_PROVIDER_UNKNOWN',
    signalEligibilityAction: 'ADVISORY',
    sizingAction: 'NO_EFFECT',
    allowDoubleCount: false,
    message: 'Provider unknown is not market risk and must not reduce both signal and sizing.',
  },
  {
    riskRootCause: 'SELL_ONLY_SESSION',
    signalEligibilityAction: 'NO_EFFECT',
    sizingAction: 'SIZE_ZERO',
    allowDoubleCount: false,
    message: 'SELL_ONLY is an execution blocker, not a signal-risk penalty.',
  },
];

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function avg(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((acc, value) => acc + value, 0) / values.length;
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

function signalRiskPenaltyFrom(input: {
  positive?: PositiveScoreStarvationReport | null;
  penalty?: PenaltyDeduplicationReport | null;
}): number {
  const rawPenalty = input.penalty?.riskPenaltyAudit.signalRiskPenalty ?? 6.3;
  const fromPenalty = input.positive?.topPositiveContributors ? undefined : undefined;
  void fromPenalty;
  // P0-4: REGIME_RISK is already expressed through Kelly sizing. Keep the sizing
  // multiplier intact, but cap diagnostic signal-score risk impact to avoid a
  // second large score subtraction in Gate1 current diagnostics.
  return Math.min(3, Math.max(0, rawPenalty));
}

export function buildRiskMultiplierBreakdown(input: {
  regimeMultiplier?: number;
  fomcMultiplier?: number;
  sectorMultiplier?: number;
  finalRiskMultiplier?: number;
  combinedKellyMultiplier?: number;
  providerIssueContribution?: number;
}): RiskMultiplierBreakdown {
  const regimeMultiplier = input.regimeMultiplier ?? 0.7;
  const fomcMultiplier = input.fomcMultiplier ?? 1;
  const sectorMultiplier = input.sectorMultiplier ?? 1;
  const finalRiskMultiplier = input.finalRiskMultiplier ??
    round2((input.combinedKellyMultiplier ?? 0.26) / Math.max(0.01, regimeMultiplier * fomcMultiplier * sectorMultiplier));
  const combinedKellyMultiplier = input.combinedKellyMultiplier ??
    round2(regimeMultiplier * fomcMultiplier * sectorMultiplier * finalRiskMultiplier);
  const providerIssueContribution = input.providerIssueContribution ?? 0;
  return {
    regimeMultiplier,
    fomcMultiplier,
    sectorMultiplier,
    finalRiskMultiplier: round2(finalRiskMultiplier),
    combinedKellyMultiplier: round2(combinedKellyMultiplier),
    providerHealthMultiplier: providerIssueContribution > 0 ? round2(1 - providerIssueContribution) : undefined,
    rootCauses: [
      {
        code: 'REGIME_RISK',
        multiplierImpact: round2(1 - regimeMultiplier),
        providerIssue: false,
        marketSignal: true,
        message: `regime multiplier ${regimeMultiplier.toFixed(2)}`,
      },
      {
        code: 'FOMC_RISK',
        multiplierImpact: round2(1 - fomcMultiplier),
        providerIssue: false,
        marketSignal: fomcMultiplier < 1,
        message: `FOMC multiplier ${fomcMultiplier.toFixed(2)}`,
      },
      {
        code: 'SECTOR_RISK',
        multiplierImpact: round2(1 - sectorMultiplier),
        providerIssue: false,
        marketSignal: sectorMultiplier < 1,
        message: `sector multiplier ${sectorMultiplier.toFixed(2)}`,
      },
      {
        code: providerIssueContribution > 0 ? 'SUPPLY_PROVIDER_UNKNOWN' : 'MACRO_RISK',
        multiplierImpact: round2(1 - finalRiskMultiplier),
        providerIssue: providerIssueContribution > 0,
        marketSignal: providerIssueContribution <= 0,
        message: `risk multiplier ${finalRiskMultiplier.toFixed(2)} drives combined Kelly ${combinedKellyMultiplier.toFixed(2)}`,
      },
    ],
  };
}

export function riskPenaltyComponent(input: {
  code: RiskRootCauseCode;
  placement: RiskPenaltyPlacement;
  value: number;
  multiplier?: number;
  providerIssue?: boolean;
  marketSignal?: boolean;
  executionBlocking?: boolean;
  sizingOnly?: boolean;
  message?: string;
}): RiskPenaltyComponentTrace {
  const sizingOnly = input.sizingOnly ?? (
    input.placement === 'KELLY_SIZING' || input.placement === 'POSITION_CAP'
  );
  return {
    code: input.code,
    placement: input.placement,
    value: round2(input.value),
    multiplier: input.multiplier,
    providerIssue: input.providerIssue ?? false,
    marketSignal: input.marketSignal ?? input.code !== 'SUPPLY_PROVIDER_UNKNOWN',
    executionBlocking: input.executionBlocking ?? input.placement === 'GATE1_HARD_BLOCK',
    sizingOnly,
    message: input.message ?? `${input.code} applied at ${input.placement}`,
  };
}

export function buildCandidateRiskDoubleCountTrace(input: {
  symbol: string;
  name?: string;
  originalSignalScore: number;
  originalSignalRiskPenalty: number;
  originalKellyMultiplier: number;
  originalFinalKelly?: number;
  requiredScore: number;
  rootCause?: RiskRootCauseCode;
}): CandidateRiskDoubleCountTrace {
  const rootCause = input.rootCause ?? 'REGIME_RISK';
  const riskComponents = [
    riskPenaltyComponent({
      code: rootCause,
      placement: 'SIGNAL_SCORE',
      value: input.originalSignalRiskPenalty,
      multiplier: undefined,
      providerIssue: rootCause === 'SUPPLY_PROVIDER_UNKNOWN',
      marketSignal: rootCause !== 'SUPPLY_PROVIDER_UNKNOWN',
      sizingOnly: false,
      message: 'Risk penalty is included in Gate1 signal score.',
    }),
    riskPenaltyComponent({
      code: rootCause,
      placement: 'KELLY_SIZING',
      value: 1 - input.originalKellyMultiplier,
      multiplier: input.originalKellyMultiplier,
      providerIssue: rootCause === 'SUPPLY_PROVIDER_UNKNOWN',
      marketSignal: rootCause !== 'SUPPLY_PROVIDER_UNKNOWN',
      sizingOnly: true,
      message: 'Same risk root cause also scales Kelly/position sizing.',
    }),
  ];
  const signalRiskRootCauses = riskComponents
    .filter((component) => component.placement === 'SIGNAL_SCORE')
    .map((component) => component.code);
  const sizingRiskRootCauses = riskComponents
    .filter((component) => component.placement === 'KELLY_SIZING')
    .map((component) => component.code);
  const duplicateRiskRootCauses = signalRiskRootCauses.filter((code) => sizingRiskRootCauses.includes(code));
  const scoreIfRiskAtSizingOnly = round2(input.originalSignalScore + input.originalSignalRiskPenalty);
  const scoreIfRiskAtSignalOnly = input.originalSignalScore;
  const scoreIfRiskCappedAt05 = round2(input.originalSignalScore + Math.max(0, input.originalSignalRiskPenalty * 0.5));
  const scoreIfRiskCappedAt07 = round2(input.originalSignalScore + Math.max(0, input.originalSignalRiskPenalty * 0.7));
  return {
    symbol: input.symbol,
    name: input.name,
    originalSignalScore: round2(input.originalSignalScore),
    originalSignalRiskPenalty: round2(input.originalSignalRiskPenalty),
    originalKellyMultiplier: round2(input.originalKellyMultiplier),
    originalFinalKelly: input.originalFinalKelly,
    riskComponents,
    signalRiskRootCauses,
    sizingRiskRootCauses,
    duplicateRiskRootCauses,
    doubleCountDetected: duplicateRiskRootCauses.length > 0,
    doubleCountScoreImpact: round2(input.originalSignalRiskPenalty),
    scoreIfRiskAtSizingOnly,
    scoreIfRiskAtSignalOnly,
    scoreIfRiskCappedAt05,
    scoreIfRiskCappedAt07,
    wouldPassIfRiskAtSizingOnly: scoreIfRiskAtSizingOnly >= input.requiredScore,
    wouldPassIfRiskCappedAt05: scoreIfRiskCappedAt05 >= input.requiredScore,
    wouldPassIfRiskCappedAt07: scoreIfRiskCappedAt07 >= input.requiredScore,
    executionImpact: 'NONE',
  };
}

function buildCandidateTraces(input: {
  positive: PositiveScoreStarvationReport;
  penalty?: PenaltyDeduplicationReport | null;
  traces?: readonly Gate1ScoreStarvationTrace[];
  combinedKellyMultiplier: number;
}): CandidateRiskDoubleCountTrace[] {
  const signalRiskPenalty = signalRiskPenaltyFrom({ positive: input.positive, penalty: input.penalty });
  if ((input.traces ?? []).length > 0) {
    return (input.traces ?? []).map((trace) => buildCandidateRiskDoubleCountTrace({
      symbol: trace.symbol,
      name: trace.name,
      originalSignalScore: trace.actualScore,
      originalSignalRiskPenalty: signalRiskPenalty,
      originalKellyMultiplier: input.combinedKellyMultiplier,
      originalFinalKelly: input.combinedKellyMultiplier,
      requiredScore: trace.requiredScore,
      rootCause: 'REGIME_RISK',
    }));
  }
  return Array.from({ length: input.positive.totalCandidates }, (_, index) => buildCandidateRiskDoubleCountTrace({
    symbol: `AGGREGATE_${String(index + 1).padStart(2, '0')}`,
    originalSignalScore: input.positive.netScoreAvg,
    originalSignalRiskPenalty: signalRiskPenalty,
    originalKellyMultiplier: input.combinedKellyMultiplier,
    originalFinalKelly: input.combinedKellyMultiplier,
    requiredScore: input.positive.requiredScoreAvg,
    rootCause: 'REGIME_RISK',
  }));
}

function scenarioValues(input: {
  scenario: RiskPlacementScenario;
  positive: PositiveScoreStarvationReport;
  penalty?: PenaltyDeduplicationReport | null;
  signalRiskPenalty: number;
  combinedKellyMultiplier: number;
  finalRiskMultiplier: number;
  positiveRepairDelta: number;
  dedupDelta: number;
}): { scoreDelta: number; riskPenalty: number; kelly: number; reason: string[] } {
  const reason = [input.scenario, 'ADR-0470_DRY_RUN_ONLY'];
  switch (input.scenario) {
    case 'RISK_AT_SIGNAL_ONLY':
    case 'KEEP_SIGNAL_RISK_REMOVE_KELLY_RISK':
      return { scoreDelta: 0, riskPenalty: input.signalRiskPenalty, kelly: 1, reason };
    case 'RISK_AT_SIZING_ONLY':
    case 'REMOVE_SIGNAL_RISK_KEEP_KELLY':
      return { scoreDelta: input.signalRiskPenalty, riskPenalty: 0, kelly: input.combinedKellyMultiplier, reason };
    case 'RISK_CAP_0_50': {
      const cappedPenalty = input.signalRiskPenalty * 0.5;
      return {
        scoreDelta: input.signalRiskPenalty - cappedPenalty,
        riskPenalty: cappedPenalty,
        kelly: Math.max(input.combinedKellyMultiplier, 0.5),
        reason,
      };
    }
    case 'RISK_CAP_0_70':
    case 'R3_EARLY_RISK_CAP_0_70': {
      const cappedPenalty = input.signalRiskPenalty * 0.3;
      return {
        scoreDelta: input.signalRiskPenalty - cappedPenalty,
        riskPenalty: cappedPenalty,
        kelly: Math.max(input.combinedKellyMultiplier, 0.7),
        reason,
      };
    }
    case 'POSITIVE_REPAIR_DEDUP_RISK_AT_SIZING_ONLY':
      return {
        scoreDelta: input.positiveRepairDelta + input.dedupDelta + input.signalRiskPenalty,
        riskPenalty: 0,
        kelly: input.combinedKellyMultiplier,
        reason,
      };
    case 'POSITIVE_REPAIR_DEDUP_RISK_CAP_0_70': {
      const cappedPenalty = input.signalRiskPenalty * 0.3;
      return {
        scoreDelta: input.positiveRepairDelta + input.dedupDelta + input.signalRiskPenalty - cappedPenalty,
        riskPenalty: cappedPenalty,
        kelly: Math.max(input.combinedKellyMultiplier, 0.7),
        reason,
      };
    }
    case 'KEEP_ONLY_MARKET_SIGNAL_RISK':
      return {
        scoreDelta: 0,
        riskPenalty: input.signalRiskPenalty,
        kelly: input.combinedKellyMultiplier,
        reason,
      };
    case 'CURRENT':
    default:
      return { scoreDelta: 0, riskPenalty: input.signalRiskPenalty, kelly: input.combinedKellyMultiplier, reason };
  }
}

export function buildRiskPlacementScenarioResults(input: {
  positive: PositiveScoreStarvationReport;
  penalty?: PenaltyDeduplicationReport | null;
  traces: readonly CandidateRiskDoubleCountTrace[];
  combinedKellyMultiplier: number;
  finalRiskMultiplier: number;
  positiveRepairDelta?: number;
  dedupDelta?: number;
}): RiskPlacementScenarioResult[] {
  const scenarios: RiskPlacementScenario[] = [
    'CURRENT',
    'RISK_AT_SIGNAL_ONLY',
    'RISK_AT_SIZING_ONLY',
    'REMOVE_SIGNAL_RISK_KEEP_KELLY',
    'KEEP_SIGNAL_RISK_REMOVE_KELLY_RISK',
    'RISK_CAP_0_50',
    'RISK_CAP_0_70',
    'R3_EARLY_RISK_CAP_0_70',
    'POSITIVE_REPAIR_DEDUP_RISK_AT_SIZING_ONLY',
    'POSITIVE_REPAIR_DEDUP_RISK_CAP_0_70',
    'KEEP_ONLY_MARKET_SIGNAL_RISK',
  ];
  const signalRiskPenalty = signalRiskPenaltyFrom({ positive: input.positive, penalty: input.penalty });
  return scenarios.map((scenario) => {
    const values = scenarioValues({
      scenario,
      positive: input.positive,
      penalty: input.penalty,
      signalRiskPenalty,
      combinedKellyMultiplier: input.combinedKellyMultiplier,
      finalRiskMultiplier: input.finalRiskMultiplier,
      positiveRepairDelta: input.positiveRepairDelta ?? 0,
      dedupDelta: input.dedupDelta ?? 0,
    });
    const scores = input.traces.map((trace) => round2(trace.originalSignalScore + values.scoreDelta));
    const scoreMin = round1(scores.length > 0 ? Math.min(...scores) : 0);
    const scoreMax = round1(scores.length > 0 ? Math.max(...scores) : 0);
    const gate1Survivors = estimateSurvivors({
      totalCandidates: input.positive.totalCandidates,
      requiredScore: input.positive.requiredScoreAvg,
      minScore: scoreMin,
      maxScore: scoreMax,
    });
    const sizingEligibleCount = gate1Survivors;
    const survivorExamples = input.traces
      .map((trace, index) => ({
        trace,
        afterScore: scores[index] ?? trace.originalSignalScore,
      }))
      .filter((item) => item.afterScore >= item.trace.riskComponents.length && item.afterScore >= input.positive.requiredScoreAvg)
      .slice(0, 5)
      .map((item) => ({
        symbol: item.trace.symbol,
        name: item.trace.name,
        beforeScore: item.trace.originalSignalScore,
        afterScore: item.afterScore,
        requiredScore: input.positive.requiredScoreAvg,
        kellyMultiplier: round2(values.kelly),
        reason: values.reason,
      }));
    return {
      scenario,
      signalScoreAvg: round1(input.positive.netScoreAvg + values.scoreDelta),
      riskPenaltyAvg: round1(values.riskPenalty),
      kellyMultiplierAvg: round2(values.kelly),
      netScoreAvg: round1(input.positive.netScoreAvg + values.scoreDelta),
      scoreMin,
      scoreMax,
      gate1Survivors,
      sizingEligibleCount,
      avgPositionScale: round2(values.kelly),
      executionImpact: 'NONE',
      survivorExamples,
    };
  });
}

function positiveRepairDelta(report?: Gate1ScoreCeilingRepairReport | null): number {
  if (!report) return 0;
  const repaired = report?.dryRunResults.find((item) => item.scenario === 'ALL_POSITIVE_WIRING_REPAIRED');
  return repaired ? round1(repaired.hypotheticalNetAvg - report.actualScoreAvg) : 0;
}

function dedupDelta(report?: PenaltyDeduplicationReport | null): number {
  return report?.avgScoreDelta ?? 0;
}

export function buildFinalGate1CalibrationMatrix(input: {
  positive: PositiveScoreStarvationReport;
  penalty?: PenaltyDeduplicationReport | null;
  positiveRepairDelta: number;
  dedupDelta: number;
  signalRiskPenalty: number;
  riskSplitSurvivors: number;
  riskCapSurvivors: number;
}): FinalGate1CalibrationMatrix[] {
  const currentPenalty = input.positive.totalPenaltyScoreAvg;
  const rows = [
    ['CURRENT', 0, 0, 0, 0],
    ['POSITIVE_REPAIR_ONLY', input.positiveRepairDelta, 0, 0, 0],
    ['PENALTY_DEDUP_ONLY', 0, input.dedupDelta, 0, 0],
    ['RISK_SPLIT_ONLY', 0, 0, input.signalRiskPenalty, input.riskSplitSurvivors],
    ['POSITIVE_REPAIR + PENALTY_DEDUP', input.positiveRepairDelta, input.dedupDelta, 0, 0],
    ['POSITIVE_REPAIR + RISK_SPLIT', input.positiveRepairDelta, 0, input.signalRiskPenalty, input.riskSplitSurvivors],
    ['PENALTY_DEDUP + RISK_SPLIT', 0, input.dedupDelta, input.signalRiskPenalty, input.riskSplitSurvivors],
    ['POSITIVE_REPAIR + PENALTY_DEDUP + RISK_SPLIT', input.positiveRepairDelta, input.dedupDelta, input.signalRiskPenalty, input.riskSplitSurvivors],
    ['POSITIVE_REPAIR + PENALTY_DEDUP + RISK_CAP_0.70', input.positiveRepairDelta, input.dedupDelta, input.signalRiskPenalty * 0.7, input.riskCapSurvivors],
  ] as const;
  return rows.map(([scenario, positiveDelta, dedupScoreDelta, riskDelta, survivorHint]) => {
    const netScoreAvg = round1(input.positive.netScoreAvg + positiveDelta + dedupScoreDelta + riskDelta);
    const scoreMin = netScoreAvg - input.positive.actualScoreAvg + input.positive.actualScoreMin;
    const scoreMax = netScoreAvg - input.positive.actualScoreAvg + input.positive.actualScoreMax;
    const survivors = survivorHint > 0 ? survivorHint : estimateSurvivors({
      totalCandidates: input.positive.totalCandidates,
      requiredScore: input.positive.requiredScoreAvg,
      minScore: scoreMin,
      maxScore: scoreMax,
    });
    return {
      scenario,
      positiveAvg: round1(input.positive.grossPositiveScoreAvg + positiveDelta),
      penaltyAvg: round1(Math.max(0, currentPenalty - dedupScoreDelta - riskDelta)),
      riskPenaltyAvg: round1(Math.max(0, input.signalRiskPenalty - riskDelta)),
      netScoreAvg,
      gate1Survivors: survivors,
      sizingEligibleCount: survivors,
      executionImpact: 'NONE',
    };
  });
}

export function buildEntryDecisionLedgerRiskDoubleCountSummary(input: {
  trace: CandidateRiskDoubleCountTrace;
  scenarios?: readonly RiskPlacementScenarioResult[];
  allScenariosZero?: boolean;
}): EntryDecisionLedgerRiskDoubleCountSummary {
  const tags: EntryDecisionLedgerRiskDoubleCountSummary['tags'] = ['CASE_FINAL_GATE1_CALIBRATION_MATRIX'];
  if (input.trace.doubleCountDetected) {
    tags.push('CASE_RISK_DOUBLE_COUNT', 'CASE_RISK_SIGNAL_AND_KELLY_DUPLICATE');
  }
  if ((input.scenarios ?? []).some((item) => item.scenario === 'RISK_AT_SIZING_ONLY')) {
    tags.push('CASE_RISK_AT_SIZING_ONLY_DRY_RUN');
  }
  if ((input.scenarios ?? []).some((item) => item.scenario === 'RISK_CAP_0_70' || item.scenario === 'R3_EARLY_RISK_CAP_0_70')) {
    tags.push('CASE_RISK_CAP_DRY_RUN');
  }
  if (input.allScenariosZero) tags.push('CASE_SCORE_SCALE_MISMATCH_IF_NO_SURVIVORS');
  return {
    doubleCountDetected: input.trace.doubleCountDetected,
    duplicateRiskRootCauses: input.trace.duplicateRiskRootCauses,
    scenarioWouldPass: (input.scenarios ?? []).map((item) => ({
      scenario: item.scenario,
      wouldPass: item.gate1Survivors > 0,
      executionImpact: 'NONE',
    })),
    tags: Array.from(new Set(tags)),
    executionImpact: 'NONE',
  };
}

export function buildEntryDecisionLedgerRiskDoubleCountSummaryFromScore(input: {
  symbol: string;
  originalSignalScore: number;
  signalRiskPenalty: number;
  kellyMultiplier: number;
  requiredScore: number;
}): EntryDecisionLedgerRiskDoubleCountSummary {
  const trace = buildCandidateRiskDoubleCountTrace({
    symbol: input.symbol,
    originalSignalScore: input.originalSignalScore,
    originalSignalRiskPenalty: input.signalRiskPenalty,
    originalKellyMultiplier: input.kellyMultiplier,
    originalFinalKelly: input.kellyMultiplier,
    requiredScore: input.requiredScore,
  });
  const scenarios: RiskPlacementScenarioResult[] = [
    {
      scenario: 'RISK_AT_SIZING_ONLY',
      signalScoreAvg: trace.scoreIfRiskAtSizingOnly,
      riskPenaltyAvg: 0,
      kellyMultiplierAvg: input.kellyMultiplier,
      netScoreAvg: trace.scoreIfRiskAtSizingOnly,
      scoreMin: trace.scoreIfRiskAtSizingOnly,
      scoreMax: trace.scoreIfRiskAtSizingOnly,
      gate1Survivors: trace.wouldPassIfRiskAtSizingOnly ? 1 : 0,
      sizingEligibleCount: trace.wouldPassIfRiskAtSizingOnly ? 1 : 0,
      executionImpact: 'NONE',
      survivorExamples: [],
    },
    {
      scenario: 'RISK_CAP_0_70',
      signalScoreAvg: trace.scoreIfRiskCappedAt07,
      riskPenaltyAvg: round1(input.signalRiskPenalty * 0.3),
      kellyMultiplierAvg: 0.7,
      netScoreAvg: trace.scoreIfRiskCappedAt07,
      scoreMin: trace.scoreIfRiskCappedAt07,
      scoreMax: trace.scoreIfRiskCappedAt07,
      gate1Survivors: trace.wouldPassIfRiskCappedAt07 ? 1 : 0,
      sizingEligibleCount: trace.wouldPassIfRiskCappedAt07 ? 1 : 0,
      executionImpact: 'NONE',
      survivorExamples: [],
    },
  ];
  return buildEntryDecisionLedgerRiskDoubleCountSummary({
    trace,
    scenarios,
    allScenariosZero: scenarios.every((item) => item.gate1Survivors === 0),
  });
}

export function buildRiskDoubleCountAuditReport(input: RiskDoubleCountBuildInput): RiskDoubleCountAuditReport | null {
  const positive = input.positiveStarvationReport;
  if (!positive || positive.totalCandidates <= 0) return null;
  const breakdown = buildRiskMultiplierBreakdown({
    regimeMultiplier: input.regimeMultiplier,
    fomcMultiplier: input.fomcMultiplier,
    sectorMultiplier: input.sectorMultiplier,
    finalRiskMultiplier: input.finalRiskMultiplier,
    combinedKellyMultiplier: input.combinedKellyMultiplier,
  });
  const signalRiskPenalty = signalRiskPenaltyFrom({ positive, penalty: input.penaltyDeduplicationReport });
  const traces = buildCandidateTraces({
    positive,
    penalty: input.penaltyDeduplicationReport,
    traces: input.traces,
    combinedKellyMultiplier: breakdown.combinedKellyMultiplier,
  });
  const positiveDelta = positiveRepairDelta(input.scoreCeilingRepairReport);
  const dedupScoreDelta = dedupDelta(input.penaltyDeduplicationReport);
  const scenarios = buildRiskPlacementScenarioResults({
    positive,
    penalty: input.penaltyDeduplicationReport,
    traces,
    combinedKellyMultiplier: breakdown.combinedKellyMultiplier,
    finalRiskMultiplier: breakdown.finalRiskMultiplier,
    positiveRepairDelta: positiveDelta,
    dedupDelta: dedupScoreDelta,
  });
  const duplicateCodes = Array.from(new Set(traces.flatMap((trace) => trace.duplicateRiskRootCauses)));
  const duplicateRiskRootCauses = duplicateCodes.map((code) => ({
    code,
    affectedCount: traces.filter((trace) => trace.duplicateRiskRootCauses.includes(code)).length,
    avgSignalPenalty: round1(avg(traces
      .filter((trace) => trace.duplicateRiskRootCauses.includes(code))
      .map((trace) => trace.originalSignalRiskPenalty))),
    avgSizingMultiplierImpact: round2(1 - breakdown.combinedKellyMultiplier),
    providerIssue: code === 'SUPPLY_PROVIDER_UNKNOWN',
    marketSignal: code !== 'SUPPLY_PROVIDER_UNKNOWN',
  }));
  const riskSplit = scenarios.find((item) => item.scenario === 'RISK_AT_SIZING_ONLY');
  const riskCap = scenarios.find((item) => item.scenario === 'POSITIVE_REPAIR_DEDUP_RISK_CAP_0_70');
  const finalCalibrationMatrix = buildFinalGate1CalibrationMatrix({
    positive,
    penalty: input.penaltyDeduplicationReport,
    positiveRepairDelta: positiveDelta,
    dedupDelta: dedupScoreDelta,
    signalRiskPenalty,
    riskSplitSurvivors: riskSplit?.gate1Survivors ?? 0,
    riskCapSurvivors: riskCap?.gate1Survivors ?? 0,
  });
  const firstSurvivorScenario = finalCalibrationMatrix.find((item) => item.gate1Survivors > 0)?.scenario;
  const scaleCalibrationRecommended = finalCalibrationMatrix.every((item) => item.gate1Survivors === 0);
  let recommendedAction: RiskDoubleCountAuditReport['recommendedAction'] = 'DIAGNOSTIC_ONLY';
  if (duplicateRiskRootCauses.length > 0) recommendedAction = 'MOVE_RISK_TO_SIZING_DRY_RUN';
  if (scaleCalibrationRecommended) recommendedAction = 'REVIEW_RISK_ROOT_CAUSE';
  return {
    timestamp: input.timestamp,
    forDate: input.forDate,
    regime: input.regime,
    marketSession: input.marketSession,
    totalCandidates: positive.totalCandidates,
    signalRiskPenaltyAvg: round1(signalRiskPenalty),
    kellyRiskMultiplierAvg: breakdown.combinedKellyMultiplier,
    combinedKellyMultiplierAvg: breakdown.combinedKellyMultiplier,
    doubleCountCandidates: traces.filter((trace) => trace.doubleCountDetected).length,
    duplicateRiskRootCauses,
    riskMultiplierBreakdown: breakdown,
    scenarios,
    finalCalibrationMatrix,
    firstSurvivorScenario,
    scaleCalibrationRecommended,
    recommendedAction,
    executionImpact: 'NONE',
  };
}

export function formatRiskDoubleCountAuditReport(report?: RiskDoubleCountAuditReport | null): string | null {
  if (!report || report.totalCandidates <= 0) return null;
  const scenario = Object.fromEntries(
    report.scenarios.map((item) => [item.scenario, item]),
  ) as Partial<Record<RiskPlacementScenario, RiskPlacementScenarioResult>>;
  const breakdown = report.riskMultiplierBreakdown;
  const duplicate = report.duplicateRiskRootCauses[0];
  const lines = [
    '🧮 Risk Penalty Double-Count Audit (ADR-0470)',
    `  candidates: ${report.totalCandidates}`,
    `  signalRiskPenaltyAvg: ${report.signalRiskPenaltyAvg.toFixed(1)}`,
    `  kellyRiskMultiplierAvg: ${report.kellyRiskMultiplierAvg.toFixed(2)}`,
    `  doubleCountCandidates: ${report.doubleCountCandidates}`,
    `  doubleCountWarning: ${report.doubleCountCandidates > 0}`,
  ];
  if (duplicate) {
    lines.push(
      '  Risk root causes:',
      `  1. ${duplicate.code}`,
      '     placement: SIGNAL_SCORE + KELLY_SIZING',
      `     affected: ${duplicate.affectedCount}`,
      `     providerIssue: ${duplicate.providerIssue}`,
      `     marketSignal: ${duplicate.marketSignal}`,
    );
  }
  lines.push(
    '  Risk multiplier breakdown:',
    `  regime x${breakdown.regimeMultiplier.toFixed(2)}`,
    `  FOMC x${breakdown.fomcMultiplier.toFixed(2)}`,
    `  sector x${breakdown.sectorMultiplier.toFixed(2)}`,
    `  risk x${breakdown.finalRiskMultiplier.toFixed(2)}`,
    `  combined x${breakdown.combinedKellyMultiplier.toFixed(2)}`,
    `  providerIssueContribution: ${breakdown.rootCauses.filter((item) => item.providerIssue).reduce((acc, item) => acc + item.multiplierImpact, 0).toFixed(2)}`,
    `  marketSignalContribution: ${breakdown.rootCauses.filter((item) => item.marketSignal).reduce((acc, item) => acc + item.multiplierImpact, 0).toFixed(2)}`,
    '  Dry-run scenarios:',
    `  1. CURRENT: gate1Survivors ${scenario.CURRENT?.gate1Survivors ?? 0} / netAvg ${(scenario.CURRENT?.netScoreAvg ?? 0).toFixed(1)} / kelly x${(scenario.CURRENT?.kellyMultiplierAvg ?? report.combinedKellyMultiplierAvg).toFixed(2)}`,
    `  2. RISK_AT_SIZING_ONLY: gate1Survivors ${scenario.RISK_AT_SIZING_ONLY?.gate1Survivors ?? 0} / kelly x${(scenario.RISK_AT_SIZING_ONLY?.kellyMultiplierAvg ?? report.combinedKellyMultiplierAvg).toFixed(2)}`,
    `  3. RISK_CAP_0.50: gate1Survivors ${scenario.RISK_CAP_0_50?.gate1Survivors ?? 0}`,
    `  4. RISK_CAP_0.70: gate1Survivors ${scenario.RISK_CAP_0_70?.gate1Survivors ?? 0}`,
    `  5. POSITIVE_REPAIR_DEDUP_RISK_AT_SIZING_ONLY: gate1Survivors ${scenario.POSITIVE_REPAIR_DEDUP_RISK_AT_SIZING_ONLY?.gate1Survivors ?? 0}`,
    `  6. POSITIVE_REPAIR_DEDUP_RISK_CAP_0.70: gate1Survivors ${scenario.POSITIVE_REPAIR_DEDUP_RISK_CAP_0_70?.gate1Survivors ?? 0}`,
    `  7. KEEP_ONLY_MARKET_SIGNAL_RISK: gate1Survivors ${scenario.KEEP_ONLY_MARKET_SIGNAL_RISK?.gate1Survivors ?? 0}`,
    '  Final Gate1 calibration matrix:',
    ...report.finalCalibrationMatrix.slice(0, 9).map((item) =>
      `  - ${item.scenario}: survivors ${item.gate1Survivors} / netAvg ${item.netScoreAvg.toFixed(1)}`),
    `  firstSurvivorScenario: ${report.firstSurvivorScenario ?? 'NONE'}`,
    `  scaleCalibrationRecommended: ${report.scaleCalibrationRecommended}`,
    '  executionImpact: NONE',
    `  recommendedAction: ${report.recommendedAction}`,
  );
  return lines.join('\n');
}
