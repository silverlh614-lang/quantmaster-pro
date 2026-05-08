// @responsibility ADR-0472 Gate1 scoring component alignment dry-run audit
import type { SignalScoreComponentCode } from './minimumSignalScoreTrace.js';
import type { PositiveScoreStarvationReport, PositiveSignalComponentCode } from './gate1PositiveScoreStarvation.js';
import type { Gate1ScoreCeilingRepairReport } from './gate1ScoreCeilingRepair.js';
import { GATE1_POSITIVE_COMPONENT_WEIGHTS } from './gate1ScoreCeilingRepair.js';
import type { PenaltyDeduplicationReport } from './gate1PenaltyDeduplication.js';
import type { RiskDoubleCountAuditReport } from './gate1RiskDoubleCount.js';
import type { FinalGate1CalibrationAuditReport, ProviderHealthState } from './gate1FinalCalibration.js';

export type Gate1ScoringAlignmentScenario =
  | 'CURRENT'
  | 'ADD_WATCHLIST_UPSTREAM_SCORE'
  | 'ADD_BREAKOUT_STRUCTURE'
  | 'ADD_WATCHLIST_AND_BREAKOUT'
  | 'ALIGN_ALL_POSITIVE_COMPONENTS'
  | 'ALIGN_PLUS_PENALTY_DEDUP'
  | 'ALIGN_PLUS_RISK_SPLIT'
  | 'ALIGN_PLUS_DEDUP_PLUS_RISK_SPLIT';

export type Gate1AlignmentMatrixScenario =
  | 'CURRENT'
  | 'POSITIVE_ALIGNMENT_ONLY'
  | 'PENALTY_DEDUP_ONLY'
  | 'RISK_SPLIT_ONLY'
  | 'POSITIVE_ALIGNMENT + PENALTY_DEDUP'
  | 'POSITIVE_ALIGNMENT + RISK_SPLIT'
  | 'PENALTY_DEDUP + RISK_SPLIT'
  | 'POSITIVE_ALIGNMENT + PENALTY_DEDUP + RISK_SPLIT'
  | 'UNKNOWN_DIAGNOSTIC_ONLY';

export type Gate1AlignmentPolicyPromotionMode = 'SHADOW_ONLY';

export interface Gate1ScoringComponentMeaning {
  code: PositiveSignalComponentCode;
  meaning: string;
  liveSignalComponentPresent: boolean;
}

export interface Gate1ScoringAlignmentScenarioResult {
  scenario: Gate1ScoringAlignmentScenario;
  netScoreAvg: number;
  positiveScoreAvg: number;
  penaltyAvg: number;
  scoreMin: number;
  scoreMax: number;
  scoreRange: number;
  compressed: boolean;
  requiredScore: number;
  hypotheticalSurvivors: number;
  survivorExamples: Array<{
    symbol: string;
    beforeScore: number;
    afterScore: number;
    requiredScore: number;
    reason: string[];
  }>;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: Gate1AlignmentPolicyPromotionMode;
}

export interface Gate1ScoringAlignmentMatrixRow {
  scenario: Gate1AlignmentMatrixScenario;
  survivors: number;
  netAvg: number;
  scoreRange: number;
  providerIssuePenaltyAvg: number;
  marketSignalPenaltyAvg: number;
  signalRiskPenaltyAvg: number;
  kellyMultiplierAvg: number;
  executionImpact: 'NONE';
}

export interface Gate1ScoringAlignmentProviderGuard {
  providerHealthStatus: ProviderHealthState;
  unknownPolicyActive: boolean;
  autoDisableWhenProviderVerified: boolean;
  providerVerifiedOverrideWarning: boolean;
}

export interface Gate1ScoringAlignmentReport {
  timestamp: string;
  forDate: string;
  regime: string;
  marketSession: string;
  totalCandidates: number;
  componentSetAligned: boolean;
  minimumSignalComponents: SignalScoreComponentCode[];
  positiveAuditComponents: PositiveSignalComponentCode[];
  missingComponents: PositiveSignalComponentCode[];
  componentMeanings: Gate1ScoringComponentMeaning[];
  requiredScore: number;
  scenarioResults: Gate1ScoringAlignmentScenarioResult[];
  matrixRows: Gate1ScoringAlignmentMatrixRow[];
  providerGuard: Gate1ScoringAlignmentProviderGuard;
  bestDryRun: Gate1ScoringAlignmentScenario;
  nextAction: 'OBSERVE_3D_THEN_OPERATOR_APPROVAL';
  observationDays: 3;
  operatorApprovalRequired: true;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: Gate1AlignmentPolicyPromotionMode;
}

export interface Gate1ScoringAlignmentBuildInput {
  positiveStarvationReport?: PositiveScoreStarvationReport | null;
  scoreCeilingRepairReport?: Gate1ScoreCeilingRepairReport | null;
  penaltyDeduplicationReport?: PenaltyDeduplicationReport | null;
  riskDoubleCountReport?: RiskDoubleCountAuditReport | null;
  finalGate1CalibrationReport?: FinalGate1CalibrationAuditReport | null;
  timestamp: string;
  forDate: string;
  regime: string;
  marketSession: string;
  providerHealthStatus?: ProviderHealthState;
  unknownPolicyActive?: boolean;
}

export const ADR_0472_POLICY_PROMOTION_MODE: Gate1AlignmentPolicyPromotionMode = 'SHADOW_ONLY';
export const ADR_0472_OBSERVATION_DAYS = 3;

export const MINIMUM_SIGNAL_SCORE_COMPONENT_CODES_ADR0472: SignalScoreComponentCode[] = [
  'PRICE_MOMENTUM',
  'VOLUME_LIQUIDITY',
  'TECHNICAL_TREND',
  'RELATIVE_STRENGTH',
  'SUPPLY_CONFLUENCE',
  'INVESTOR_FLOW',
  'SECTOR_ENERGY',
  'MARKET_REGIME',
  'MACRO_RISK',
  'DATA_QUALITY',
  'SESSION_STATUS',
  'NEWS_OR_CATALYST',
  'WATCHLIST_PRIORITY',
  'RISK_PENALTY',
  'UNKNOWN_DATA_PENALTY',
  'SOFT_FAIL_PENALTY',
  'OTHER',
];

const REQUIRED_ALIGNMENT_COMPONENTS: PositiveSignalComponentCode[] = [
  'WATCHLIST_UPSTREAM_SCORE',
  'BREAKOUT_STRUCTURE',
];

const COMPONENT_MEANINGS: Gate1ScoringComponentMeaning[] = [
  {
    code: 'WATCHLIST_PRIORITY',
    meaning: 'Watchlist row priority or manual/derived ordering; not the upstream candidate score.',
    liveSignalComponentPresent: true,
  },
  {
    code: 'WATCHLIST_UPSTREAM_SCORE',
    meaning: 'Stage2/watchlist candidate score imported into Gate1 as a positive signal contribution.',
    liveSignalComponentPresent: false,
  },
  {
    code: 'BREAKOUT_STRUCTURE',
    meaning: 'VCP, breakout, near-breakout, or new-high structure contribution.',
    liveSignalComponentPresent: false,
  },
  {
    code: 'RELATIVE_STRENGTH',
    meaning: 'Market/sector relative strength; independent from watchlist priority and breakout structure.',
    liveSignalComponentPresent: true,
  },
];

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function range(min: number, max: number): number {
  return round1(Math.max(0, max - min));
}

function estimateSurvivors(input: {
  total: number;
  scoreMin: number;
  scoreMax: number;
  requiredScore: number;
}): number {
  if (input.total <= 0 || input.scoreMax < input.requiredScore) return 0;
  if (input.scoreMin >= input.requiredScore) return input.total;
  const width = Math.max(0.1, input.scoreMax - input.scoreMin);
  const ratio = (input.scoreMax - input.requiredScore) / width;
  return Math.max(0, Math.min(input.total, Math.round(input.total * ratio)));
}

function survivorExamples(input: {
  survivors: number;
  beforeScore: number;
  afterScore: number;
  requiredScore: number;
  reason: string[];
}): Gate1ScoringAlignmentScenarioResult['survivorExamples'] {
  return Array.from({ length: Math.min(5, input.survivors) }, (_, index) => ({
    symbol: `ADR0472-${String(index + 1).padStart(2, '0')}`,
    beforeScore: round1(input.beforeScore),
    afterScore: round1(input.afterScore),
    requiredScore: round1(input.requiredScore),
    reason: input.reason,
  }));
}

function buildScenario(input: {
  scenario: Gate1ScoringAlignmentScenario;
  totalCandidates: number;
  requiredScore: number;
  positiveScoreAvg: number;
  penaltyAvg: number;
  scoreMin: number;
  scoreMax: number;
  beforeScore: number;
  reason: string[];
}): Gate1ScoringAlignmentScenarioResult {
  const netScoreAvg = round1(input.positiveScoreAvg - input.penaltyAvg);
  const scoreRange = range(input.scoreMin, input.scoreMax);
  const hypotheticalSurvivors = estimateSurvivors({
    total: input.totalCandidates,
    scoreMin: input.scoreMin,
    scoreMax: input.scoreMax,
    requiredScore: input.requiredScore,
  });

  return {
    scenario: input.scenario,
    netScoreAvg,
    positiveScoreAvg: round1(input.positiveScoreAvg),
    penaltyAvg: round1(input.penaltyAvg),
    scoreMin: round1(input.scoreMin),
    scoreMax: round1(input.scoreMax),
    scoreRange,
    compressed: scoreRange <= 5,
    requiredScore: round1(input.requiredScore),
    hypotheticalSurvivors,
    survivorExamples: survivorExamples({
      survivors: hypotheticalSurvivors,
      beforeScore: input.beforeScore,
      afterScore: netScoreAvg,
      requiredScore: input.requiredScore,
      reason: input.reason,
    }),
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: ADR_0472_POLICY_PROMOTION_MODE,
  };
}

export function buildGate1AlignmentProviderGuard(input: {
  providerHealthStatus: ProviderHealthState;
  unknownPolicyActive: boolean;
}): Gate1ScoringAlignmentProviderGuard {
  const providerVerified = input.providerHealthStatus === 'VERIFIED';
  const providerVerifiedOverrideWarning = providerVerified && input.unknownPolicyActive;
  return {
    providerHealthStatus: input.providerHealthStatus,
    unknownPolicyActive: providerVerified ? false : input.unknownPolicyActive,
    autoDisableWhenProviderVerified: true,
    providerVerifiedOverrideWarning,
  };
}

export function detectGate1ScoringAlignmentMissingComponents(input: {
  minimumSignalComponents?: readonly SignalScoreComponentCode[];
  requiredComponents?: readonly PositiveSignalComponentCode[];
} = {}): PositiveSignalComponentCode[] {
  const minimum = new Set<string>(input.minimumSignalComponents ?? MINIMUM_SIGNAL_SCORE_COMPONENT_CODES_ADR0472);
  const required = input.requiredComponents ?? REQUIRED_ALIGNMENT_COMPONENTS;
  return required.filter((code) => !minimum.has(code));
}

export function buildGate1ScoringAlignmentReport(input: Gate1ScoringAlignmentBuildInput): Gate1ScoringAlignmentReport | null {
  const positive = input.positiveStarvationReport;
  if (!positive) return null;

  const totalCandidates = positive.totalCandidates;
  const requiredScore = finite(positive.requiredScoreAvg, 70);
  const currentPositive = finite(positive.grossPositiveScoreAvg, 52.7);
  const currentPenalty = finite(positive.totalPenaltyScoreAvg, 31.3);
  const currentNet = finite(positive.netScoreAvg, positive.actualScoreAvg);
  const currentMin = finite(positive.actualScoreMin, currentNet);
  const currentMax = finite(positive.actualScoreMax, currentNet);
  const currentRange = range(currentMin, currentMax);
  const dedupDelta = finite(input.penaltyDeduplicationReport?.avgScoreDelta, 0);
  const signalRiskPenalty = finite(input.riskDoubleCountReport?.signalRiskPenaltyAvg, 0);
  const watchlistImport = 5;
  const breakoutRestore = 5;
  const relativeStrengthRestore = 9;
  const allPositiveDelta = watchlistImport + breakoutRestore + relativeStrengthRestore;
  const expandedRange = Math.max(currentRange, 10);

  const scenarioResults = [
    buildScenario({
      scenario: 'CURRENT',
      totalCandidates,
      requiredScore,
      positiveScoreAvg: currentPositive,
      penaltyAvg: currentPenalty,
      scoreMin: currentMin,
      scoreMax: currentMax,
      beforeScore: currentNet,
      reason: ['Current live score remains unchanged.'],
    }),
    buildScenario({
      scenario: 'ADD_WATCHLIST_UPSTREAM_SCORE',
      totalCandidates,
      requiredScore,
      positiveScoreAvg: currentPositive + watchlistImport,
      penaltyAvg: currentPenalty,
      scoreMin: currentMin + watchlistImport * 0.6,
      scoreMax: currentMax + watchlistImport,
      beforeScore: currentNet,
      reason: ['Dry-run imports WATCHLIST_UPSTREAM_SCORE only.'],
    }),
    buildScenario({
      scenario: 'ADD_BREAKOUT_STRUCTURE',
      totalCandidates,
      requiredScore,
      positiveScoreAvg: currentPositive + breakoutRestore,
      penaltyAvg: currentPenalty,
      scoreMin: currentMin + breakoutRestore * 0.5,
      scoreMax: currentMax + breakoutRestore,
      beforeScore: currentNet,
      reason: ['Dry-run restores BREAKOUT_STRUCTURE only.'],
    }),
    buildScenario({
      scenario: 'ADD_WATCHLIST_AND_BREAKOUT',
      totalCandidates,
      requiredScore,
      positiveScoreAvg: currentPositive + watchlistImport + breakoutRestore,
      penaltyAvg: currentPenalty,
      scoreMin: currentMin + 5,
      scoreMax: currentMax + 10,
      beforeScore: currentNet,
      reason: ['Dry-run combines watchlist upstream and breakout structure components.'],
    }),
    buildScenario({
      scenario: 'ALIGN_ALL_POSITIVE_COMPONENTS',
      totalCandidates,
      requiredScore,
      positiveScoreAvg: currentPositive + allPositiveDelta,
      penaltyAvg: currentPenalty,
      scoreMin: currentMin + allPositiveDelta * 0.6,
      scoreMax: currentMax + allPositiveDelta,
      beforeScore: currentNet,
      reason: ['Dry-run aligns watchlist, relative strength, and breakout positive components.'],
    }),
    buildScenario({
      scenario: 'ALIGN_PLUS_PENALTY_DEDUP',
      totalCandidates,
      requiredScore,
      positiveScoreAvg: currentPositive + allPositiveDelta,
      penaltyAvg: Math.max(0, currentPenalty - dedupDelta),
      scoreMin: currentMin + allPositiveDelta * 0.6 + dedupDelta,
      scoreMax: currentMax + allPositiveDelta + dedupDelta,
      beforeScore: currentNet,
      reason: ['Dry-run combines component alignment with ADR-0469 penalty deduplication.'],
    }),
    buildScenario({
      scenario: 'ALIGN_PLUS_RISK_SPLIT',
      totalCandidates,
      requiredScore,
      positiveScoreAvg: currentPositive + allPositiveDelta,
      penaltyAvg: Math.max(0, currentPenalty - signalRiskPenalty),
      scoreMin: currentMin + allPositiveDelta * 0.6 + signalRiskPenalty,
      scoreMax: currentMax + allPositiveDelta + signalRiskPenalty,
      beforeScore: currentNet,
      reason: ['Dry-run combines component alignment with ADR-0470 risk split.'],
    }),
    buildScenario({
      scenario: 'ALIGN_PLUS_DEDUP_PLUS_RISK_SPLIT',
      totalCandidates,
      requiredScore,
      positiveScoreAvg: currentPositive + allPositiveDelta,
      penaltyAvg: Math.max(0, currentPenalty - dedupDelta - signalRiskPenalty),
      scoreMin: currentMin + Math.max(expandedRange, allPositiveDelta * 0.6 + dedupDelta + signalRiskPenalty),
      scoreMax: currentMax + allPositiveDelta + dedupDelta + signalRiskPenalty,
      beforeScore: currentNet,
      reason: ['Dry-run combines component alignment, ADR-0469 dedup, and ADR-0470 risk split.'],
    }),
  ];

  const matrixRows = buildGate1AlignmentMatrixRows({
    positive,
    penaltyDeduplicationReport: input.penaltyDeduplicationReport,
    riskDoubleCountReport: input.riskDoubleCountReport,
    finalGate1CalibrationReport: input.finalGate1CalibrationReport,
    scenarioResults,
  });

  const missingComponents = detectGate1ScoringAlignmentMissingComponents();
  const bestDryRun = [...scenarioResults].sort((a, b) =>
    b.hypotheticalSurvivors - a.hypotheticalSurvivors || b.netScoreAvg - a.netScoreAvg)[0]?.scenario ?? 'CURRENT';

  return {
    timestamp: input.timestamp,
    forDate: input.forDate,
    regime: input.regime,
    marketSession: input.marketSession,
    totalCandidates,
    componentSetAligned: missingComponents.length === 0,
    minimumSignalComponents: [...MINIMUM_SIGNAL_SCORE_COMPONENT_CODES_ADR0472],
    positiveAuditComponents: GATE1_POSITIVE_COMPONENT_WEIGHTS.map((item) => item.code),
    missingComponents,
    componentMeanings: COMPONENT_MEANINGS,
    requiredScore: round1(requiredScore),
    scenarioResults,
    matrixRows,
    providerGuard: buildGate1AlignmentProviderGuard({
      providerHealthStatus: input.providerHealthStatus ?? 'UNKNOWN',
      unknownPolicyActive: input.unknownPolicyActive ?? true,
    }),
    bestDryRun,
    nextAction: 'OBSERVE_3D_THEN_OPERATOR_APPROVAL',
    observationDays: ADR_0472_OBSERVATION_DAYS,
    operatorApprovalRequired: true,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: ADR_0472_POLICY_PROMOTION_MODE,
  };
}

function buildGate1AlignmentMatrixRows(input: {
  positive: PositiveScoreStarvationReport;
  penaltyDeduplicationReport?: PenaltyDeduplicationReport | null;
  riskDoubleCountReport?: RiskDoubleCountAuditReport | null;
  finalGate1CalibrationReport?: FinalGate1CalibrationAuditReport | null;
  scenarioResults: readonly Gate1ScoringAlignmentScenarioResult[];
}): Gate1ScoringAlignmentMatrixRow[] {
  const positive = input.positive;
  const current = input.scenarioResults.find((item) => item.scenario === 'CURRENT');
  const align = input.scenarioResults.find((item) => item.scenario === 'ALIGN_ALL_POSITIVE_COMPONENTS');
  const alignDedup = input.scenarioResults.find((item) => item.scenario === 'ALIGN_PLUS_PENALTY_DEDUP');
  const alignRisk = input.scenarioResults.find((item) => item.scenario === 'ALIGN_PLUS_RISK_SPLIT');
  const alignAll = input.scenarioResults.find((item) => item.scenario === 'ALIGN_PLUS_DEDUP_PLUS_RISK_SPLIT');
  const requiredScore = positive.requiredScoreAvg;
  const dedupDelta = finite(input.penaltyDeduplicationReport?.avgScoreDelta, 0);
  const riskDelta = finite(input.riskDoubleCountReport?.signalRiskPenaltyAvg, 0);
  const providerIssuePenaltyAvg = finite(input.penaltyDeduplicationReport?.providerIssuePenaltyAvg, 0);
  const marketSignalPenaltyAvg = finite(input.penaltyDeduplicationReport?.marketSignalPenaltyAvg, 0);
  const signalRiskPenaltyAvg = finite(input.riskDoubleCountReport?.signalRiskPenaltyAvg, 0);
  const kellyMultiplierAvg = finite(input.riskDoubleCountReport?.kellyRiskMultiplierAvg, 0);
  const unknownDiagnosticNet = finite(input.finalGate1CalibrationReport?.unknownDiagnosticNetAvg, positive.netScoreAvg);

  const row = (
    scenario: Gate1AlignmentMatrixScenario,
    netAvg: number,
    scoreRange: number,
    survivors: number,
  ): Gate1ScoringAlignmentMatrixRow => ({
    scenario,
    survivors,
    netAvg: round1(netAvg),
    scoreRange: round1(scoreRange),
    providerIssuePenaltyAvg: round1(providerIssuePenaltyAvg),
    marketSignalPenaltyAvg: round1(marketSignalPenaltyAvg),
    signalRiskPenaltyAvg: round1(signalRiskPenaltyAvg),
    kellyMultiplierAvg: round1(kellyMultiplierAvg),
    executionImpact: 'NONE',
  });

  return [
    row('CURRENT', current?.netScoreAvg ?? positive.netScoreAvg, current?.scoreRange ?? positive.actualScoreRange, current?.hypotheticalSurvivors ?? 0),
    row('POSITIVE_ALIGNMENT_ONLY', align?.netScoreAvg ?? positive.netScoreAvg, align?.scoreRange ?? positive.actualScoreRange, align?.hypotheticalSurvivors ?? 0),
    row('PENALTY_DEDUP_ONLY', positive.netScoreAvg + dedupDelta, positive.actualScoreRange, estimateSurvivors({
      total: positive.totalCandidates,
      scoreMin: positive.actualScoreMin + dedupDelta,
      scoreMax: positive.actualScoreMax + dedupDelta,
      requiredScore,
    })),
    row('RISK_SPLIT_ONLY', positive.netScoreAvg + riskDelta, positive.actualScoreRange, estimateSurvivors({
      total: positive.totalCandidates,
      scoreMin: positive.actualScoreMin + riskDelta,
      scoreMax: positive.actualScoreMax + riskDelta,
      requiredScore,
    })),
    row('POSITIVE_ALIGNMENT + PENALTY_DEDUP', alignDedup?.netScoreAvg ?? positive.netScoreAvg, alignDedup?.scoreRange ?? positive.actualScoreRange, alignDedup?.hypotheticalSurvivors ?? 0),
    row('POSITIVE_ALIGNMENT + RISK_SPLIT', alignRisk?.netScoreAvg ?? positive.netScoreAvg, alignRisk?.scoreRange ?? positive.actualScoreRange, alignRisk?.hypotheticalSurvivors ?? 0),
    row('PENALTY_DEDUP + RISK_SPLIT', positive.netScoreAvg + dedupDelta + riskDelta, positive.actualScoreRange, estimateSurvivors({
      total: positive.totalCandidates,
      scoreMin: positive.actualScoreMin + dedupDelta + riskDelta,
      scoreMax: positive.actualScoreMax + dedupDelta + riskDelta,
      requiredScore,
    })),
    row('POSITIVE_ALIGNMENT + PENALTY_DEDUP + RISK_SPLIT', alignAll?.netScoreAvg ?? positive.netScoreAvg, alignAll?.scoreRange ?? positive.actualScoreRange, alignAll?.hypotheticalSurvivors ?? 0),
    row('UNKNOWN_DIAGNOSTIC_ONLY', unknownDiagnosticNet, positive.actualScoreRange, estimateSurvivors({
      total: positive.totalCandidates,
      scoreMin: positive.actualScoreMin + (unknownDiagnosticNet - positive.netScoreAvg),
      scoreMax: positive.actualScoreMax + (unknownDiagnosticNet - positive.netScoreAvg),
      requiredScore,
    })),
  ];
}

export function formatGate1ScoringAlignmentReport(report?: Gate1ScoringAlignmentReport | null): string | null {
  if (!report) return null;
  const best = report.scenarioResults.find((item) => item.scenario === report.bestDryRun);
  return [
    '🎚️ Gate1 Scoring Alignment (ADR-0472)',
    `  componentSetAligned: ${report.componentSetAligned}`,
    `  missingComponents: ${report.missingComponents.length > 0 ? report.missingComponents.join(', ') : 'none'}`,
    `  policyPromotionMode: ${report.policyPromotionMode}`,
    `  liveExecutionAllowed: ${report.liveExecutionAllowed}`,
    `  bestDryRun: ${report.bestDryRun}`,
    `  survivors: ${best?.hypotheticalSurvivors ?? 0}`,
    `  executionImpact: ${report.executionImpact}`,
    `  nextAction: ${report.nextAction}`,
  ].join('\n');
}
