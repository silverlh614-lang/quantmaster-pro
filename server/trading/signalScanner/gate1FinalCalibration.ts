// @responsibility ADR-0471 final Gate1 calibration dry-run audit
import type { PositiveScoreStarvationReport } from './gate1PositiveScoreStarvation.js';
import type { Gate1ScoreCeilingRepairReport } from './gate1ScoreCeilingRepair.js';
import type { PenaltyDeduplicationReport } from './gate1PenaltyDeduplication.js';
import type { RiskDoubleCountAuditReport } from './gate1RiskDoubleCount.js';
import type { CanonicalRuntimeResolutionStep27 } from './runtimeResolverTraceStep26.js';

export type SupplySignalState =
  | 'BULLISH'
  | 'NEUTRAL'
  | 'BEARISH'
  | 'UNKNOWN'
  | 'UNAVAILABLE';

export type UnknownPenaltyPolicyMode =
  | 'CURRENT_RETAIN_10'
  | 'CAP_UNKNOWN_5'
  | 'CAP_UNKNOWN_3'
  | 'UNKNOWN_DIAGNOSTIC_ONLY'
  | 'UNKNOWN_TO_CONFIDENCE_DOWNGRADE'
  | 'UNKNOWN_TO_SIZING_ONLY'
  | 'BEARISH_ONLY_SUPPLY_PENALTY';

export type UnknownPenaltyPolicyScenario = UnknownPenaltyPolicyMode;

export type ProviderHealthState =
  | 'VERIFIED'
  | 'DEGRADED'
  | 'STALE'
  | 'NO_RECENT_SAMPLE'
  | 'EMPTY'
  | 'ERROR'
  | 'UNKNOWN';

export interface UnknownPenaltyPolicyTrace {
  symbol: string;
  name?: string;
  supplySignalState: SupplySignalState;
  providerIssue: boolean;
  marketSignal: boolean;
  providerHealth: ProviderHealthState;
  originalSupplyUnknownPenalty: number;
  policyMode: UnknownPenaltyPolicyMode;
  adjustedPointPenalty: number;
  confidenceDowngrade?: number;
  sizingMultiplier?: number;
  strongBuyBlocked: boolean;
  autoDisabledByProviderVerified: boolean;
  message: string;
  executionImpact: 'NONE';
}

export interface UnknownPenaltyPolicyScenarioResult {
  scenario: UnknownPenaltyPolicyScenario;
  pointPenaltyAvg: number;
  confidenceDowngradeAvg?: number;
  sizingMultiplierAvg?: number;
  netScoreAvg: number;
  scoreMin: number;
  scoreMax: number;
  gate1Survivors: number;
  strongBuyBlockedCount: number;
  executionImpact: 'NONE';
  survivorExamples: Array<{
    symbol: string;
    name?: string;
    beforeScore: number;
    afterScore: number;
    requiredScore: number;
    reason: string[];
  }>;
}

export interface ActiveComponentCoverage {
  totalCoreComponents: number;
  activeCoreComponents: number;
  activeCoveragePct: number;
  missingComponents: string[];
  diagnosticOnlyComponents: string[];
  verifiedComponents: string[];
}

export interface ActiveComponentRequiredScorePolicy {
  regime:
    | 'R3_EARLY'
    | 'R3_MID'
    | 'RISK_ON'
    | 'NEUTRAL'
    | 'RISK_OFF'
    | 'SELL_ONLY'
    | 'UNKNOWN';
  baseRequiredScore: number;
  activeCoveragePct: number;
  coverageAdjustedRequiredScore: number;
  unknownPolicyAdjustedRequiredScore: number;
  finalDryRunRequiredScore: number;
  hardFloor: number;
  hardCeiling: number;
  targetSurvivorRange: {
    min: number;
    max: number;
  };
  enableMode:
    | 'DISABLED'
    | 'DRY_RUN'
    | 'SHADOW_ONLY'
    | 'ADVISORY'
    | 'LIVE_ENABLED';
  executionImpact: 'NONE';
}

export interface FinalGate1ThresholdSweepRow {
  unknownPolicy: UnknownPenaltyPolicyScenario;
  threshold: number;
  survivors: number;
  survivorPct: number;
  scoreAvgOfSurvivors?: number;
  lowestSurvivorScore?: number;
  highestRejectedScore?: number;
  executionImpact: 'NONE';
}

export interface FinalGate1CalibrationReport {
  candidates: number;
  regime: string;
  currentRequiredScore: number;
  bestRepairedNetAvg: number;
  unknownDiagnosticNetAvg: number;
  rows: FinalGate1ThresholdSweepRow[];
  firstThresholdWithSurvivor?: number;
  recommendedDryRunThreshold?: number;
  targetSurvivorRange: {
    min: number;
    max: number;
  };
  recommendedUnknownPolicy: UnknownPenaltyPolicyScenario;
  liveExecutionAllowed: false;
}

export interface ProviderRecoveryPolicyGuard {
  providerHealth: ProviderHealthState;
  unknownPolicyActive: boolean;
  shouldAutoDisableUnknownPolicy: boolean;
  actualSupplySignalState?: SupplySignalState;
  warningIfOverridePersists: boolean;
  message: string;
}

export interface Gate1CalibrationObservationPlan {
  observationDays: number;
  startDate: string;
  regime: string;
  recommendedUnknownPolicy: UnknownPenaltyPolicyScenario;
  recommendedDryRunThreshold: number;
  targetSurvivorRange: {
    min: number;
    max: number;
  };
  metricsToTrack: {
    survivorCount: boolean;
    avgForwardReturn1D: boolean;
    avgForwardReturn3D: boolean;
    avgForwardReturn5D: boolean;
    falsePositiveRate: boolean;
    wouldHaveHitStopLoss: boolean;
    wouldHaveReachedTarget: boolean;
  };
  liveExecutionAllowed: false;
  operatorApprovalRequired: true;
}

export interface EntryDecisionLedgerFinalCalibrationSummary {
  recommendedUnknownPolicy: UnknownPenaltyPolicyScenario;
  recommendedDryRunThreshold: number;
  providerRecoveryGuard: ProviderRecoveryPolicyGuard;
  unknownPolicyScenarios: UnknownPenaltyPolicyScenarioResult[];
  forwardReturnPlaceholders: {
    return1D?: number;
    return3D?: number;
    return5D?: number;
  };
  tags: Array<
    | 'CASE_FINAL_GATE1_CALIBRATION'
    | 'CASE_UNKNOWN_NOT_BEARISH'
    | 'CASE_SUPPLY_UNKNOWN_POLICY_DRY_RUN'
    | 'CASE_PROVIDER_RECOVERY_AUTO_DISABLE'
    | 'CASE_ACTIVE_COMPONENT_REQUIRED_SCORE'
    | 'CASE_THREE_DAY_SHADOW_OBSERVATION'
    | 'CASE_ADR_0471_LAST_DIAGNOSTIC_ADR'
  >;
  executionImpact: 'NONE';
}

export interface FinalGate1CalibrationAuditReport {
  timestamp: string;
  forDate: string;
  candidates: number;
  regime: string;
  marketSession: string;
  currentRequiredScore: number;
  bestRepairedNetAvg: number;
  unknownDiagnosticNetAvg: number;
  gapToRequiredAfterUnknownDiagnostic: number;
  unknownPolicyScenarios: UnknownPenaltyPolicyScenarioResult[];
  providerRecoveryGuard: ProviderRecoveryPolicyGuard;
  activeComponentCoverage: ActiveComponentCoverage;
  requiredScorePolicy: ActiveComponentRequiredScorePolicy;
  thresholdSweep: FinalGate1CalibrationReport;
  observationPlan: Gate1CalibrationObservationPlan;
  freezeRuleMessage: string;
  liveExecutionAllowed: false;
  executionImpact: 'NONE';
}

export interface FinalGate1CalibrationBuildInput {
  positiveStarvationReport?: PositiveScoreStarvationReport | null;
  scoreCeilingRepairReport?: Gate1ScoreCeilingRepairReport | null;
  penaltyDeduplicationReport?: PenaltyDeduplicationReport | null;
  riskDoubleCountReport?: RiskDoubleCountAuditReport | null;
  timestamp: string;
  forDate: string;
  regime: string;
  marketSession: string;
  providerHealth?: ProviderHealthState;
}

export const ADR_0471_FREEZE_RULE_MESSAGE =
  'ADR-0471 marks the final diagnostic calibration ADR. Further changes require observation data or explicit operator approval.';

const UNKNOWN_POLICY_SCENARIOS: UnknownPenaltyPolicyScenario[] = [
  'CURRENT_RETAIN_10',
  'CAP_UNKNOWN_5',
  'CAP_UNKNOWN_3',
  'UNKNOWN_DIAGNOSTIC_ONLY',
  'UNKNOWN_TO_CONFIDENCE_DOWNGRADE',
  'UNKNOWN_TO_SIZING_ONLY',
  'BEARISH_ONLY_SUPPLY_PENALTY',
];

const THRESHOLDS = [70, 69.7, 68, 65, 63, 60, 58, 55, 52, 50];

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function bestRepairedNetAvg(input: {
  positive?: PositiveScoreStarvationReport | null;
  risk?: RiskDoubleCountAuditReport | null;
}): number {
  const matrix = input.risk?.finalCalibrationMatrix ?? [];
  const preferred = matrix.find((item) => item.scenario === 'POSITIVE_REPAIR + PENALTY_DEDUP + RISK_SPLIT');
  if (preferred) return preferred.netScoreAvg;
  return round1((input.positive?.netScoreAvg ?? 21.4) + 19 + 13 + 6.3);
}

function retainedUnknownPenalty(input?: PenaltyDeduplicationReport | null): number {
  const group = input?.duplicateGroups.find((item) => item.groupKey === 'SUPPLY_UNKNOWN');
  return group?.avgDedupedPenalty ?? 10;
}

function policyPointPenalty(input: {
  scenario: UnknownPenaltyPolicyScenario;
  originalSupplyUnknownPenalty: number;
  providerIssue: boolean;
  marketSignal: boolean;
  supplySignalState: SupplySignalState;
  providerHealth: ProviderHealthState;
}): number {
  if (input.providerHealth === 'VERIFIED' && input.supplySignalState !== 'UNKNOWN') {
    return input.supplySignalState === 'BEARISH' && input.marketSignal
      ? input.originalSupplyUnknownPenalty
      : 0;
  }
  if (input.supplySignalState === 'BEARISH' && input.marketSignal) return input.originalSupplyUnknownPenalty;
  if (!input.providerIssue || input.marketSignal) return input.originalSupplyUnknownPenalty;
  if (input.scenario === 'CURRENT_RETAIN_10') return input.originalSupplyUnknownPenalty;
  if (input.scenario === 'CAP_UNKNOWN_5') return Math.min(5, input.originalSupplyUnknownPenalty);
  if (input.scenario === 'CAP_UNKNOWN_3') return Math.min(3, input.originalSupplyUnknownPenalty);
  return 0;
}

function estimateSurvivors(input: {
  totalCandidates: number;
  scoreAvg: number;
  threshold: number;
}): number {
  if (input.scoreAvg >= input.threshold) {
    const share = 0.5 + (input.scoreAvg - input.threshold) / 10;
    return clamp(Math.round(input.totalCandidates * share), 1, input.totalCandidates);
  }
  const share = Math.max(0, (input.scoreAvg + 0.75 - input.threshold) / 5);
  return clamp(Math.round(input.totalCandidates * share), 0, input.totalCandidates);
}

function scoreBounds(avg: number): { min: number; max: number } {
  return {
    min: round1(avg - 2),
    max: round1(avg + 2),
  };
}

export function buildUnknownPenaltyPolicyTrace(input: {
  symbol: string;
  name?: string;
  supplySignalState: SupplySignalState;
  providerIssue: boolean;
  marketSignal: boolean;
  providerHealth: ProviderHealthState;
  originalSupplyUnknownPenalty: number;
  policyMode: UnknownPenaltyPolicyMode;
}): UnknownPenaltyPolicyTrace {
  const autoDisabledByProviderVerified = input.providerHealth === 'VERIFIED' && input.supplySignalState !== 'UNKNOWN';
  const adjustedPointPenalty = autoDisabledByProviderVerified
    ? policyPointPenalty({ ...input, scenario: 'BEARISH_ONLY_SUPPLY_PENALTY' })
    : policyPointPenalty({ ...input, scenario: input.policyMode });
  return {
    symbol: input.symbol,
    name: input.name,
    supplySignalState: input.supplySignalState,
    providerIssue: input.providerIssue,
    marketSignal: input.marketSignal,
    providerHealth: input.providerHealth,
    originalSupplyUnknownPenalty: input.originalSupplyUnknownPenalty,
    policyMode: input.policyMode,
    adjustedPointPenalty,
    confidenceDowngrade: adjustedPointPenalty === 0 && input.providerIssue ? 0.15 : undefined,
    sizingMultiplier: input.policyMode === 'UNKNOWN_TO_SIZING_ONLY' && input.providerIssue ? 0.9 : undefined,
    strongBuyBlocked: input.providerIssue && input.supplySignalState === 'UNKNOWN',
    autoDisabledByProviderVerified,
    message: autoDisabledByProviderVerified
      ? 'Provider VERIFIED: unknown fallback policy is auto-disabled and actual supply signal is used.'
      : 'UNKNOWN is not bearish; policy is dry-run/advisory only.',
    executionImpact: 'NONE',
  };
}

export function buildProviderRecoveryPolicyGuard(input: {
  providerHealth: ProviderHealthState;
  unknownPolicyActive: boolean;
  actualSupplySignalState?: SupplySignalState;
}): ProviderRecoveryPolicyGuard {
  const shouldAutoDisableUnknownPolicy = input.providerHealth === 'VERIFIED';
  const warningIfOverridePersists = shouldAutoDisableUnknownPolicy && input.unknownPolicyActive;
  return {
    providerHealth: input.providerHealth,
    unknownPolicyActive: shouldAutoDisableUnknownPolicy ? false : input.unknownPolicyActive,
    shouldAutoDisableUnknownPolicy,
    actualSupplySignalState: input.actualSupplySignalState,
    warningIfOverridePersists,
    message: warningIfOverridePersists
      ? 'Provider VERIFIED but unknown policy still requested; auto-disable invariant must override it.'
      : shouldAutoDisableUnknownPolicy
        ? 'Provider VERIFIED: unknown fallback policy is disabled and actual flow state must be evaluated.'
        : 'Provider not verified: unknown policy may run in diagnostic/shadow mode only.',
  };
}

export function buildUnknownPenaltyPolicyScenarioResults(input: {
  candidates: number;
  currentRequiredScore: number;
  bestRepairedNetAvg: number;
  originalSupplyUnknownPenalty: number;
  providerHealth: ProviderHealthState;
  supplySignalState?: SupplySignalState;
  providerIssue?: boolean;
  marketSignal?: boolean;
}): UnknownPenaltyPolicyScenarioResult[] {
  const supplySignalState = input.supplySignalState ?? 'UNKNOWN';
  const providerIssue = input.providerIssue ?? true;
  const marketSignal = input.marketSignal ?? false;
  return UNKNOWN_POLICY_SCENARIOS.map((scenario) => {
    const pointPenalty = policyPointPenalty({
      scenario,
      originalSupplyUnknownPenalty: input.originalSupplyUnknownPenalty,
      providerIssue,
      marketSignal,
      supplySignalState,
      providerHealth: input.providerHealth,
    });
    const netScoreAvg = round1(input.bestRepairedNetAvg + input.originalSupplyUnknownPenalty - pointPenalty);
    const bounds = scoreBounds(netScoreAvg);
    const gate1Survivors = estimateSurvivors({
      totalCandidates: input.candidates,
      scoreAvg: netScoreAvg,
      threshold: input.currentRequiredScore,
    });
    return {
      scenario,
      pointPenaltyAvg: round1(pointPenalty),
      confidenceDowngradeAvg: pointPenalty === 0 && providerIssue ? 0.15 : undefined,
      sizingMultiplierAvg: scenario === 'UNKNOWN_TO_SIZING_ONLY' && providerIssue ? 0.9 : undefined,
      netScoreAvg,
      scoreMin: bounds.min,
      scoreMax: bounds.max,
      gate1Survivors,
      strongBuyBlockedCount: providerIssue && supplySignalState === 'UNKNOWN' ? input.candidates : 0,
      executionImpact: 'NONE',
      survivorExamples: gate1Survivors > 0 ? [{
        symbol: 'AGGREGATE_SAMPLE',
        beforeScore: input.bestRepairedNetAvg,
        afterScore: netScoreAvg,
        requiredScore: input.currentRequiredScore,
        reason: [scenario, 'UNKNOWN_NOT_BEARISH', 'ADR-0471_DRY_RUN_ONLY'],
      }] : [],
    };
  });
}

export function buildActiveComponentCoverage(
  report?: Gate1ScoreCeilingRepairReport | null,
): ActiveComponentCoverage {
  const core = ['WATCHLIST_UPSTREAM_SCORE', 'RELATIVE_STRENGTH', 'BREAKOUT_STRUCTURE', 'PRICE_MOMENTUM', 'TECHNICAL_TREND', 'VOLUME_LIQUIDITY'];
  const missing = report?.weightMapAudit.missingCoreComponents ?? [];
  const diagnostic = ['SUPPLY_UNKNOWN'];
  const verified = core.filter((code) => !missing.includes(code as never));
  const activeCoreComponents = verified.length;
  return {
    totalCoreComponents: core.length,
    activeCoreComponents,
    activeCoveragePct: round1((activeCoreComponents / core.length) * 100),
    missingComponents: missing,
    diagnosticOnlyComponents: diagnostic,
    verifiedComponents: verified,
  };
}

export function buildThresholdSweep(input: {
  candidates: number;
  regime: string;
  currentRequiredScore: number;
  bestRepairedNetAvg: number;
  unknownDiagnosticNetAvg: number;
  targetSurvivorRange: { min: number; max: number };
}): FinalGate1CalibrationReport {
  const policies: UnknownPenaltyPolicyScenario[] = ['CURRENT_RETAIN_10', 'UNKNOWN_DIAGNOSTIC_ONLY'];
  const avgFor = (policy: UnknownPenaltyPolicyScenario) =>
    policy === 'UNKNOWN_DIAGNOSTIC_ONLY' ? input.unknownDiagnosticNetAvg : input.bestRepairedNetAvg;
  const rows = policies.flatMap((policy) => THRESHOLDS.map((threshold) => {
    const scoreAvg = avgFor(policy);
    const survivors = estimateSurvivors({
      totalCandidates: input.candidates,
      scoreAvg,
      threshold,
    });
    return {
      unknownPolicy: policy,
      threshold,
      survivors,
      survivorPct: round1((survivors / input.candidates) * 100),
      scoreAvgOfSurvivors: survivors > 0 ? round1(Math.max(threshold, scoreAvg)) : undefined,
      lowestSurvivorScore: survivors > 0 ? round1(threshold) : undefined,
      highestRejectedScore: survivors < input.candidates ? round1(Math.min(threshold - 0.1, scoreAvg)) : undefined,
      executionImpact: 'NONE' as const,
    };
  }));
  const first = rows.find((row) => row.survivors > 0);
  const recommended = rows.find((row) =>
    row.unknownPolicy === 'UNKNOWN_DIAGNOSTIC_ONLY' &&
    row.survivors >= input.targetSurvivorRange.min &&
    row.survivors <= input.targetSurvivorRange.max);
  return {
    candidates: input.candidates,
    regime: input.regime,
    currentRequiredScore: input.currentRequiredScore,
    bestRepairedNetAvg: input.bestRepairedNetAvg,
    unknownDiagnosticNetAvg: input.unknownDiagnosticNetAvg,
    rows,
    firstThresholdWithSurvivor: first?.threshold,
    recommendedDryRunThreshold: recommended?.threshold ?? 70,
    targetSurvivorRange: input.targetSurvivorRange,
    recommendedUnknownPolicy: 'UNKNOWN_DIAGNOSTIC_ONLY',
    liveExecutionAllowed: false,
  };
}

export function buildActiveComponentRequiredScorePolicy(input: {
  regime: string;
  baseRequiredScore: number;
  coverage: ActiveComponentCoverage;
  recommendedThreshold?: number;
}): ActiveComponentRequiredScorePolicy {
  const normalizedRegime = input.regime === 'R3_EARLY' || input.regime === 'SELL_ONLY'
    ? input.regime
    : input.regime === 'R3_MID' || input.regime === 'RISK_ON' || input.regime === 'NEUTRAL' || input.regime === 'RISK_OFF'
      ? input.regime
      : 'UNKNOWN';
  const hardFloor = 50;
  const hardCeiling = 70;
  const coverageAdjustment = (100 - input.coverage.activeCoveragePct) * 0.05;
  const coverageAdjustedRequiredScore = round1(clamp(input.baseRequiredScore - coverageAdjustment, hardFloor, hardCeiling));
  const unknownPolicyAdjustedRequiredScore = round1(clamp(input.recommendedThreshold ?? coverageAdjustedRequiredScore, hardFloor, hardCeiling));
  return {
    regime: normalizedRegime,
    baseRequiredScore: input.baseRequiredScore,
    activeCoveragePct: input.coverage.activeCoveragePct,
    coverageAdjustedRequiredScore,
    unknownPolicyAdjustedRequiredScore,
    finalDryRunRequiredScore: unknownPolicyAdjustedRequiredScore,
    hardFloor,
    hardCeiling,
    targetSurvivorRange: { min: 3, max: 7 },
    enableMode: input.regime === 'SELL_ONLY' ? 'SHADOW_ONLY' : 'DRY_RUN',
    executionImpact: 'NONE',
  };
}

export function buildObservationPlan(input: {
  startDate: string;
  regime: string;
  recommendedUnknownPolicy: UnknownPenaltyPolicyScenario;
  recommendedDryRunThreshold: number;
}): Gate1CalibrationObservationPlan {
  return {
    observationDays: 3,
    startDate: input.startDate,
    regime: input.regime,
    recommendedUnknownPolicy: input.recommendedUnknownPolicy,
    recommendedDryRunThreshold: input.recommendedDryRunThreshold,
    targetSurvivorRange: { min: 3, max: 7 },
    metricsToTrack: {
      survivorCount: true,
      avgForwardReturn1D: true,
      avgForwardReturn3D: true,
      avgForwardReturn5D: true,
      falsePositiveRate: true,
      wouldHaveHitStopLoss: true,
      wouldHaveReachedTarget: true,
    },
    liveExecutionAllowed: false,
    operatorApprovalRequired: true,
  };
}

export function buildEntryDecisionLedgerFinalCalibrationSummary(input: {
  report: FinalGate1CalibrationAuditReport;
}): EntryDecisionLedgerFinalCalibrationSummary {
  return {
    recommendedUnknownPolicy: input.report.thresholdSweep.recommendedUnknownPolicy,
    recommendedDryRunThreshold: input.report.thresholdSweep.recommendedDryRunThreshold ?? input.report.currentRequiredScore,
    providerRecoveryGuard: input.report.providerRecoveryGuard,
    unknownPolicyScenarios: input.report.unknownPolicyScenarios,
    forwardReturnPlaceholders: {},
    tags: [
      'CASE_FINAL_GATE1_CALIBRATION',
      'CASE_UNKNOWN_NOT_BEARISH',
      'CASE_SUPPLY_UNKNOWN_POLICY_DRY_RUN',
      'CASE_PROVIDER_RECOVERY_AUTO_DISABLE',
      'CASE_ACTIVE_COMPONENT_REQUIRED_SCORE',
      'CASE_THREE_DAY_SHADOW_OBSERVATION',
      'CASE_ADR_0471_LAST_DIAGNOSTIC_ADR',
    ],
    executionImpact: 'NONE',
  };
}

export function buildEntryDecisionLedgerFinalCalibrationSummaryFromScore(input: {
  symbol: string;
  requiredScore: number;
  netScore: number;
}): EntryDecisionLedgerFinalCalibrationSummary {
  const guard = buildProviderRecoveryPolicyGuard({
    providerHealth: 'UNKNOWN',
    unknownPolicyActive: true,
    actualSupplySignalState: 'UNKNOWN',
  });
  const scenarios = buildUnknownPenaltyPolicyScenarioResults({
    candidates: 1,
    currentRequiredScore: input.requiredScore,
    bestRepairedNetAvg: input.netScore,
    originalSupplyUnknownPenalty: 10,
    providerHealth: 'UNKNOWN',
  });
  const report = {
    timestamp: '',
    forDate: '',
    candidates: 1,
    regime: 'UNKNOWN',
    marketSession: 'UNKNOWN',
    currentRequiredScore: input.requiredScore,
    bestRepairedNetAvg: input.netScore,
    unknownDiagnosticNetAvg: input.netScore + 10,
    gapToRequiredAfterUnknownDiagnostic: round1(input.netScore + 10 - input.requiredScore),
    unknownPolicyScenarios: scenarios,
    providerRecoveryGuard: guard,
    activeComponentCoverage: {
      totalCoreComponents: 0,
      activeCoreComponents: 0,
      activeCoveragePct: 0,
      missingComponents: [],
      diagnosticOnlyComponents: [],
      verifiedComponents: [],
    },
    requiredScorePolicy: {
      regime: 'UNKNOWN' as const,
      baseRequiredScore: input.requiredScore,
      activeCoveragePct: 0,
      coverageAdjustedRequiredScore: input.requiredScore,
      unknownPolicyAdjustedRequiredScore: input.requiredScore,
      finalDryRunRequiredScore: input.requiredScore,
      hardFloor: 50,
      hardCeiling: 70,
      targetSurvivorRange: { min: 3, max: 7 },
      enableMode: 'DRY_RUN' as const,
      executionImpact: 'NONE' as const,
    },
    thresholdSweep: {
      candidates: 1,
      regime: 'UNKNOWN',
      currentRequiredScore: input.requiredScore,
      bestRepairedNetAvg: input.netScore,
      unknownDiagnosticNetAvg: input.netScore + 10,
      rows: [],
      targetSurvivorRange: { min: 3, max: 7 },
      recommendedUnknownPolicy: 'UNKNOWN_DIAGNOSTIC_ONLY' as const,
      liveExecutionAllowed: false as const,
    },
    observationPlan: buildObservationPlan({
      startDate: '',
      regime: 'UNKNOWN',
      recommendedUnknownPolicy: 'UNKNOWN_DIAGNOSTIC_ONLY',
      recommendedDryRunThreshold: input.requiredScore,
    }),
    freezeRuleMessage: ADR_0471_FREEZE_RULE_MESSAGE,
    liveExecutionAllowed: false as const,
    executionImpact: 'NONE' as const,
  };
  void input.symbol;
  return buildEntryDecisionLedgerFinalCalibrationSummary({ report });
}

export function buildFinalGate1CalibrationAuditReport(
  input: FinalGate1CalibrationBuildInput,
): FinalGate1CalibrationAuditReport | null {
  const positive = input.positiveStarvationReport;
  if (!positive || positive.totalCandidates <= 0) return null;
  const currentRequiredScore = positive.requiredScoreAvg;
  const bestNet = bestRepairedNetAvg({
    positive,
    risk: input.riskDoubleCountReport,
  });
  const unknownPenalty = retainedUnknownPenalty(input.penaltyDeduplicationReport);
  const unknownDiagnosticNetAvg = round1(bestNet + unknownPenalty);
  const providerHealth = input.providerHealth ?? 'UNKNOWN';
  const unknownPolicyScenarios = buildUnknownPenaltyPolicyScenarioResults({
    candidates: positive.totalCandidates,
    currentRequiredScore,
    bestRepairedNetAvg: bestNet,
    originalSupplyUnknownPenalty: unknownPenalty,
    providerHealth,
  });
  const guard = buildProviderRecoveryPolicyGuard({
    providerHealth,
    unknownPolicyActive: providerHealth !== 'VERIFIED',
    actualSupplySignalState: providerHealth === 'VERIFIED' ? 'NEUTRAL' : 'UNKNOWN',
  });
  const coverage = buildActiveComponentCoverage(input.scoreCeilingRepairReport);
  const thresholdSweep = buildThresholdSweep({
    candidates: positive.totalCandidates,
    regime: input.regime,
    currentRequiredScore,
    bestRepairedNetAvg: bestNet,
    unknownDiagnosticNetAvg,
    targetSurvivorRange: { min: 3, max: 7 },
  });
  const requiredScorePolicy = buildActiveComponentRequiredScorePolicy({
    regime: input.marketSession === 'SELL_ONLY' ? 'SELL_ONLY' : input.regime,
    baseRequiredScore: currentRequiredScore,
    coverage,
    recommendedThreshold: thresholdSweep.recommendedDryRunThreshold,
  });
  const observationPlan = buildObservationPlan({
    startDate: input.forDate,
    regime: input.regime,
    recommendedUnknownPolicy: thresholdSweep.recommendedUnknownPolicy,
    recommendedDryRunThreshold: thresholdSweep.recommendedDryRunThreshold ?? currentRequiredScore,
  });
  return {
    timestamp: input.timestamp,
    forDate: input.forDate,
    candidates: positive.totalCandidates,
    regime: input.regime,
    marketSession: input.marketSession,
    currentRequiredScore,
    bestRepairedNetAvg: bestNet,
    unknownDiagnosticNetAvg,
    gapToRequiredAfterUnknownDiagnostic: round1(unknownDiagnosticNetAvg - currentRequiredScore),
    unknownPolicyScenarios,
    providerRecoveryGuard: guard,
    activeComponentCoverage: coverage,
    requiredScorePolicy,
    thresholdSweep,
    observationPlan,
    freezeRuleMessage: ADR_0471_FREEZE_RULE_MESSAGE,
    liveExecutionAllowed: false,
    executionImpact: 'NONE',
  };
}

export function formatFinalGate1CalibrationReport(
  report?: FinalGate1CalibrationAuditReport | null,
  canonicalRuntimeResolution?: CanonicalRuntimeResolutionStep27,
): string | null {
  if (!report || report.candidates <= 0) return null;
  const scenario = Object.fromEntries(
    report.unknownPolicyScenarios.map((item) => [item.scenario, item]),
  ) as Partial<Record<UnknownPenaltyPolicyScenario, UnknownPenaltyPolicyScenarioResult>>;
  const rowFor = (threshold: number) =>
    report.thresholdSweep.rows.find((row) =>
      row.unknownPolicy === report.thresholdSweep.recommendedUnknownPolicy &&
      row.threshold === threshold);
  const providerHealth = canonicalRuntimeResolution?.kisInvestorFlow.selectedProvider === 'KIS_API' &&
    String(canonicalRuntimeResolution.kisInvestorFlow.selectedProviderStatus).toUpperCase() === 'VERIFIED'
    ? 'VERIFIED'
    : report.providerRecoveryGuard.providerHealth;
  const unknownPolicyActive = canonicalRuntimeResolution
    ? false
    : report.providerRecoveryGuard.unknownPolicyActive;
  const unknownDiagnosticNetAvg = canonicalRuntimeResolution
    ? report.bestRepairedNetAvg
    : report.unknownDiagnosticNetAvg;
  const lines = [
    '🎚️ Final Gate1 Calibration (ADR-0471)',
    `  candidates: ${report.candidates}`,
    `  regime: ${report.regime}`,
    `  currentRequiredScore: ${report.currentRequiredScore.toFixed(1)}`,
    `  bestRepairedNetAvg: ${report.bestRepairedNetAvg.toFixed(1)}`,
    `  unknownDiagnosticNetAvg: ${unknownDiagnosticNetAvg.toFixed(1)}`,
    `  gapToRequiredAfterUnknownDiagnostic: ${(report.currentRequiredScore - unknownDiagnosticNetAvg).toFixed(1)}`,
    '  Unknown penalty policy:',
    `  1. CURRENT_RETAIN_10: netAvg ${(scenario.CURRENT_RETAIN_10?.netScoreAvg ?? 0).toFixed(1)} / survivors ${scenario.CURRENT_RETAIN_10?.gate1Survivors ?? 0}`,
    `  2. CAP_UNKNOWN_5: netAvg ${(scenario.CAP_UNKNOWN_5?.netScoreAvg ?? 0).toFixed(1)} / survivors ${scenario.CAP_UNKNOWN_5?.gate1Survivors ?? 0}`,
    `  3. CAP_UNKNOWN_3: netAvg ${(scenario.CAP_UNKNOWN_3?.netScoreAvg ?? 0).toFixed(1)} / survivors ${scenario.CAP_UNKNOWN_3?.gate1Survivors ?? 0}`,
    `  4. UNKNOWN_DIAGNOSTIC_ONLY: netAvg ${(scenario.UNKNOWN_DIAGNOSTIC_ONLY?.netScoreAvg ?? 0).toFixed(1)} / survivors ${scenario.UNKNOWN_DIAGNOSTIC_ONLY?.gate1Survivors ?? 0}`,
    `  5. UNKNOWN_TO_CONFIDENCE_DOWNGRADE: netAvg ${(scenario.UNKNOWN_TO_CONFIDENCE_DOWNGRADE?.netScoreAvg ?? 0).toFixed(1)} / survivors ${scenario.UNKNOWN_TO_CONFIDENCE_DOWNGRADE?.gate1Survivors ?? 0}`,
    `  6. UNKNOWN_TO_SIZING_ONLY: netAvg ${(scenario.UNKNOWN_TO_SIZING_ONLY?.netScoreAvg ?? 0).toFixed(1)} / survivors ${scenario.UNKNOWN_TO_SIZING_ONLY?.gate1Survivors ?? 0}`,
    `  7. BEARISH_ONLY_SUPPLY_PENALTY: netAvg ${(scenario.BEARISH_ONLY_SUPPLY_PENALTY?.netScoreAvg ?? 0).toFixed(1)} / survivors ${scenario.BEARISH_ONLY_SUPPLY_PENALTY?.gate1Survivors ?? 0}`,
    '  Provider recovery guard:',
    `  providerHealth: ${providerHealth}`,
    `  unknownPolicyActive: ${unknownPolicyActive}`,
    ...(canonicalRuntimeResolution
      ? [
          `  effectiveProviderPenaltyAvg: ${canonicalRuntimeResolution.providerPenalty.effectiveProviderPenaltyAvg.toFixed(1)}`,
          `  effectiveUnknownPenaltyAvg: ${canonicalRuntimeResolution.providerPenalty.effectiveUnknownPenaltyAvg.toFixed(1)}`,
          '  gateScoreImpact: 0.0',
        ]
      : []),
    `  autoDisableWhenProviderVerified: ${report.providerRecoveryGuard.shouldAutoDisableUnknownPolicy || providerHealth !== 'VERIFIED'}`,
    `  providerVerifiedOverrideWarning: ${report.providerRecoveryGuard.warningIfOverridePersists}`,
    '  Active component requiredScore:',
    `  activeCoveragePct: ${report.activeComponentCoverage.activeCoveragePct.toFixed(1)}%`,
    `  recommendedDryRunThreshold: ${(report.thresholdSweep.recommendedDryRunThreshold ?? report.currentRequiredScore).toFixed(1)}`,
    `  targetSurvivorRange: ${report.thresholdSweep.targetSurvivorRange.min}~${report.thresholdSweep.targetSurvivorRange.max}`,
    `  enableMode: ${report.requiredScorePolicy.enableMode}`,
    `  liveExecutionAllowed: ${report.liveExecutionAllowed}`,
    '  Threshold sweep:',
    ...[70, 69.7, 68, 65, 63, 60].map((threshold) =>
      `  ${threshold.toFixed(1)}: survivors ${rowFor(threshold)?.survivors ?? 0}`),
    '  Observation plan:',
    `  observationDays: ${report.observationPlan.observationDays}`,
    '  track: 1D / 3D / 5D forward returns',
    `  operatorApprovalRequired: ${report.observationPlan.operatorApprovalRequired}`,
    `  freezeRule: ${report.freezeRuleMessage}`,
    '  executionImpact: NONE',
  ];
  return lines.join('\n');
}
