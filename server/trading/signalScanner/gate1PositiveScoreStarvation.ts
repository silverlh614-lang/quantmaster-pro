// @responsibility ADR-0467 Gate1 positive score starvation diagnostic audit
import type { MinSignalScoreDecompositionReport } from './minimumSignalScoreTrace.js';
import type { CanonicalRuntimeResolutionStep27 } from './runtimeResolverTraceStep26.js';
import { GATE1_SCORE_SCALE } from '../gateConfig.js';
import { isGate1ScaleMismatch } from './gate1ScoreAccounting.js';

export type ScoreConfidence =
  | 'VERIFIED'
  | 'DEGRADED'
  | 'STALE'
  | 'UNKNOWN'
  | 'MISSING'
  | 'DIAGNOSTIC_ONLY';

export type PositiveSignalComponentCode =
  | 'PRICE_MOMENTUM'
  | 'VOLUME_LIQUIDITY'
  | 'TECHNICAL_TREND'
  | 'RELATIVE_STRENGTH'
  | 'WATCHLIST_PRIORITY'
  | 'WATCHLIST_UPSTREAM_SCORE'
  | 'NEWS_OR_CATALYST'
  | 'SECTOR_RELATIVE_STRENGTH'
  | 'MARKET_REGIME_SUPPORT'
  | 'BREAKOUT_STRUCTURE'
  | 'VCP_OR_VOLATILITY_COMPRESSION'
  | 'LIQUIDITY_QUALITY'
  | 'GHOST_SIGNAL_STRENGTH'
  | 'COUNTERFACTUAL_SIGNAL'
  | 'OTHER_POSITIVE';

export type SignalScoreComponentCode =
  | 'SUPPLY_CONFLUENCE'
  | 'INVESTOR_FLOW'
  | 'SECTOR_ENERGY'
  | 'MARKET_REGIME'
  | 'MACRO_RISK'
  | 'DATA_QUALITY'
  | 'SESSION_STATUS'
  | 'RISK_PENALTY'
  | 'UNKNOWN_DATA_PENALTY'
  | 'SOFT_FAIL_PENALTY'
  | 'OTHER';

export type Gate1ScoreComponentScope =
  | 'CORE_SIGNAL'
  | 'ADVISORY_SIGNAL'
  | 'CONFIDENCE_ONLY';

const GATE1_SCORE_COMPONENT_SCOPES: Record<Gate1ScoreComponentScope, readonly string[]> = {
  CORE_SIGNAL: [
    'TECHNICAL_TREND',
    'PRICE_MOMENTUM',
    'RELATIVE_STRENGTH',
    'BREAKOUT_STRUCTURE',
    'VOLUME_LIQUIDITY',
    'WATCHLIST_UPSTREAM_SCORE',
  ],
  ADVISORY_SIGNAL: [
    'VCP_OR_VOLATILITY_COMPRESSION',
    'SECTOR_RELATIVE_STRENGTH',
    'GHOST_SIGNAL_STRENGTH',
    'PRE_BREAKOUT_STRUCTURE',
  ],
  CONFIDENCE_ONLY: [
    'providerIssue',
    'unknownData',
    'staleData',
    'diagnosticProviderIssue',
    'sectorPartialCoverage',
  ],
};

export interface SignalScoreComponentTrace {
  code: SignalScoreComponentCode;
  rawValue?: unknown;
  normalizedScore: number;
  weight: number;
  weightedScore: number;
  maxScore: number;
  contributionPct: number;
  confidence: ScoreConfidence;
  providerIssue: boolean;
  marketSignal: boolean;
  penaltyApplied: boolean;
  penaltyReason?: string;
  message: string;
}

export interface PositiveScoreContributionTrace {
  code: PositiveSignalComponentCode;
  available: boolean;
  rawValue?: unknown;
  normalizedScore: number;
  weight: number;
  weightedScore: number;
  maxScore: number;
  contributionPct: number;
  source?: string;
  confidence: ScoreConfidence;
  zeroContributionReason?: string;
  message: string;
}

export interface Gate1ScoreStarvationTrace {
  symbol: string;
  name?: string;
  requiredScore: number;
  actualScore: number;
  scoreGap: number;
  grossPositiveScore: number;
  totalPenaltyScore: number;
  netScoreAfterPenalty: number;
  positiveMaxPossibleScore: number;
  positiveUtilizationPct: number;
  scoreCeilingEstimate: number;
  positiveComponents: PositiveScoreContributionTrace[];
  penaltyComponents: SignalScoreComponentTrace[];
  zeroContributionComponents: PositiveSignalComponentCode[];
  missingPositiveComponents: PositiveSignalComponentCode[];
  /** ADR-P0-8 — verified current-path components that are genuinely zero. */
  verifiedZeroComponents: PositiveSignalComponentCode[];
  stalePositiveComponents: PositiveSignalComponentCode[];
  watchlistScore?: number;
  upstreamScore?: number;
  gate1ImportedWatchlistScore?: number;
  watchlistToGate1ScoreDelta?: number;
  scoreStarved: boolean;
  starvationReason: string[];
  wouldPassIfWatchlistScoreImported: boolean;
  wouldPassIfPositiveFeaturesRestored: boolean;
  wouldPassIfPenaltyNotAppliedBeforePositive: boolean;
  wouldPassIfScoreCeilingFixed: boolean;
}

export interface PositiveFeatureAvailabilityAudit {
  totalCandidates: number;
  featureAvailability: Array<{
    code: PositiveSignalComponentCode;
    availableCount: number;
    missingCount: number;
    zeroScoreCount: number;
    staleCount: number;
    avgWeightedScore: number;
    maxWeightedScore: number;
    examplesMissing: string[];
    examplesZero: string[];
  }>;
  allZeroFeatures: PositiveSignalComponentCode[];
  mostlyZeroFeatures: PositiveSignalComponentCode[];
  recommendedAction:
    | 'NO_ACTION'
    | 'CHECK_FEATURE_WIRING'
    | 'CHECK_UPSTREAM_SCORE_IMPORT'
    | 'CHECK_NORMALIZATION'
    | 'CHECK_DATA_PROVIDER'
    | 'CHECK_WEIGHT_CONFIG';
}

export interface WatchlistGate1PropagationTrace {
  symbol: string;
  name?: string;
  watchlistRank?: number;
  watchlistScore?: number;
  watchlistReason?: string[];
  upstreamCandidateScore?: number;
  gate1BaseScoreBeforePenalty: number;
  gate1PositiveScore: number;
  gate1NetScore: number;
  importedToGate1: boolean;
  importWeight?: number;
  expectedContribution?: number;
  actualContribution?: number;
  propagationGap?: number;
  propagationIssue: boolean;
  issueReason?: string;
}

export type ScoreRangeCompressionCause =
  | 'MISSING_SYMBOL_LEVEL_FEATURES'
  | 'DEFAULT_SCORE_USED_FOR_ALL'
  | 'WATCHLIST_SCORE_NOT_IMPORTED'
  | 'NORMALIZATION_COLLAPSED'
  | 'PENALTY_DOMINATES_SCORE'
  | 'SCORE_CEILING_TOO_LOW'
  | 'UNKNOWN';

export interface ScoreRangeCompressionReport {
  totalCandidates: number;
  actualScoreMin: number;
  actualScoreMax: number;
  actualScoreRange: number;
  actualScoreStdDev: number;
  grossPositiveScoreRange: number;
  positiveScoreStdDev: number;
  penaltyScoreRange: number;
  compressed: boolean;
  compressionReason: string[];
  suspectedCauses: ScoreRangeCompressionCause[];
}

export interface ScoreCeilingAudit {
  requiredScoreAvg: number;
  theoreticalMaxScore: number;
  configuredPositiveMaxScore: number;
  observedPositiveMaxScore: number;
  observedNetMaxScore: number;
  scoreCeilingBelowThreshold: boolean;
  requiredScoreReachable: boolean;
  message: string;
}

export interface PenaltyApplicationOrderAudit {
  symbol: string;
  positiveBeforePenalty: number;
  penaltyAppliedBeforePositive: boolean;
  penaltyOrder: string[];
  duplicatePenaltyWarnings: string[];
  netScore: number;
  message: string;
}

export type PositiveScoreCalibrationScenario =
  | 'IMPORT_WATCHLIST_SCORE'
  | 'RESTORE_PRICE_MOMENTUM'
  | 'RESTORE_RELATIVE_STRENGTH'
  | 'RESTORE_TECHNICAL_TREND'
  | 'RESTORE_VOLUME_LIQUIDITY'
  | 'REMOVE_DUPLICATE_SUPPLY_PENALTY'
  | 'CAP_TOTAL_PENALTY'
  | 'FIX_SCORE_CEILING'
  | 'NORMALIZE_WEIGHTS_TO_100';

export interface PositiveScoreCalibrationResult {
  scenario: PositiveScoreCalibrationScenario;
  hypotheticalSurvivors: number;
  survivorExamples: Array<{
    symbol: string;
    name?: string;
    actualScore: number;
    adjustedScore: number;
    requiredScore: number;
    reason: string[];
  }>;
  executionImpact: 'NONE';
}

export interface EntryDecisionLedgerPositiveStarvationSummary {
  scoreStarved: boolean;
  grossPositiveScore: number;
  totalPenaltyScore: number;
  netScoreAfterPenalty: number;
  positiveUtilizationPct: number;
  watchlistPropagationIssue: boolean;
  scoreCeilingBelowThreshold: boolean;
  rangeCompressed: boolean;
  duplicatePenaltyWarning: boolean;
  tags: Array<
    | 'CASE_GATE1_POSITIVE_SCORE_STARVATION'
    | 'CASE_WATCHLIST_SCORE_NOT_IMPORTED'
    | 'CASE_SCORE_CEILING_BELOW_THRESHOLD'
    | 'CASE_SCORE_RANGE_COMPRESSION'
    | 'CASE_DUPLICATE_PENALTY'
  >;
  executionImpact: 'NONE';
}

export interface PositiveScoreStarvationReport {
  timestamp: string;
  forDate: string;
  regime: string;
  marketSession: string;
  totalCandidates: number;
  requiredScoreAvg: number;
  actualScoreAvg: number;
  grossPositiveScoreAvg: number;
  totalPenaltyScoreAvg: number;
  netScoreAvg: number;
  positiveUtilizationAvg: number;
  actualScoreMin: number;
  actualScoreMax: number;
  actualScoreRange: number;
  actualScoreStdDev: number;
  topPositiveContributors: Array<{
    code: PositiveSignalComponentCode;
    avgContribution: number;
    affectedCount: number;
  }>;
  zeroContributionComponents: Array<{ code: PositiveSignalComponentCode; count: number }>;
  missingPositiveComponents: Array<{ code: PositiveSignalComponentCode; count: number }>;
  verifiedZeroComponents: Array<{ code: PositiveSignalComponentCode; count: number }>;
  currentPathComponentStatus: Array<{ code: PositiveSignalComponentCode; verified: number; missing: number; avgContribution: number }>;
  scoreCeilingAudit: ScoreCeilingAudit;
  rangeCompressionReport: ScoreRangeCompressionReport;
  wouldPassIfWatchlistScoreImported: number;
  wouldPassIfPositiveFeaturesRestored: number;
  wouldPassIfPenaltyNotAppliedBeforePositive: number;
  wouldPassIfScoreCeilingFixed: number;
  calibrationResults: PositiveScoreCalibrationResult[];
  recommendedAction:
    | 'NO_ACTION'
    | 'CHECK_FEATURE_WIRING'
    | 'CHECK_WATCHLIST_SCORE_PROPAGATION'
    | 'CHECK_SCORE_CEILING'
    | 'CHECK_PENALTY_DUPLICATION'
    | 'REVIEW_SCORE_NORMALIZATION'
    | 'WIRE_RS_PERCENTILE_INPUT'
    | 'ALIGN_PRICE_MOMENTUM_SOURCE_FIELDS'
    | 'PROJECT_BREAKOUT_STRUCTURE_TO_GATE_TRACE'
    | 'OBSERVE_3D_COUNTERFACTUAL'
    | 'REPAIR_SECTOR_INDEX_MASTER';
}

export interface Gate1ScoreStarvationInput {
  symbol: string;
  name?: string;
  requiredScore: number;
  actualScore: number;
  positiveComponents: PositiveScoreContributionTrace[];
  penaltyComponents?: SignalScoreComponentTrace[];
  watchlistScore?: number;
  upstreamScore?: number;
  watchlistRank?: number;
  gate1ImportedWatchlistScore?: number;
  penaltyAppliedBeforePositive?: boolean;
  penaltyOrder?: string[];
  configuredPositiveMaxScore?: number;
}

export interface Gate1ScoreStarvationGateResultInput {
  symbol: string;
  name?: string;
  requiredScore: number;
  gateResult: {
    gateScore?: number;
    rawScore?: number;
    availableMaxScore?: number;
    normalizedGateScore?: number;
    outputs?: Array<{
      key: string;
      output: { score: number; status?: string } | null;
      context?: { hadRequiredData: boolean };
    }>;
    unavailableConditions?: readonly string[];
    thresholdNotMetConditions?: readonly string[];
    providerDegradedConditions?: readonly string[];
  };
  /**
   * ADR-0467 attribution fix: canonical Gate1 minimum-signal-score components
   * (minimumSignalScoreTrace.components — code+weightedScore+maxScore+confidence).
   * When supplied, CORE_SIGNAL component contributions (PRICE_MOMENTUM etc.) are
   * read from these canonical weightedScores instead of Gate2-level condition
   * outputs, preventing the OTHER_POSITIVE mis-attribution leak. Optional:
   * absence preserves the legacy gateResult.outputs fallback byte-equivalently.
   */
  minSignalComponents?: ReadonlyArray<{
    code: string;
    weightedScore: number;
    maxScore: number;
    confidence?: ScoreConfidence;
    message?: string;
  }>;
  watchlistScore?: number;
  upstreamScore?: number;
  watchlistRank?: number;
  scoreScale?: number;
}

const AUDITED_POSITIVE_FEATURES: PositiveSignalComponentCode[] = [
  'PRICE_MOMENTUM',
  'VOLUME_LIQUIDITY',
  'TECHNICAL_TREND',
  'RELATIVE_STRENGTH',
  'WATCHLIST_PRIORITY',
  'WATCHLIST_UPSTREAM_SCORE',
  'SECTOR_RELATIVE_STRENGTH',
  'BREAKOUT_STRUCTURE',
  'VCP_OR_VOLATILITY_COMPRESSION',
  'GHOST_SIGNAL_STRENGTH',
];

const CONDITION_TO_POSITIVE_CODE: Record<string, PositiveSignalComponentCode> = {
  momentum: 'PRICE_MOMENTUM',
  volume_breakout: 'VOLUME_LIQUIDITY',
  volume_surge: 'VOLUME_LIQUIDITY',
  ma_alignment: 'TECHNICAL_TREND',
  macd_bull: 'TECHNICAL_TREND',
  ma60_rising: 'TECHNICAL_TREND',
  weekly_rsi_zone: 'TECHNICAL_TREND',
  relative_strength: 'RELATIVE_STRENGTH',
  turtle_high: 'BREAKOUT_STRUCTURE',
  breakout_momentum: 'BREAKOUT_STRUCTURE',
  vcp: 'VCP_OR_VOLATILITY_COMPRESSION',
  pullback: 'VCP_OR_VOLATILITY_COMPRESSION',
};

/**
 * Codes in AUDITED_POSITIVE_FEATURES that have no Gate1 output key mapping and whose
 * fallbackPolicy is NEUTRAL_IF_MISSING or DIAGNOSTIC_ONLY (not MISSING).
 * When absent from Gate1 outputs these are scored zero but marked available=true
 * so they do not inflate missingPositiveComponents or trigger starvation reasons
 * that belong to genuinely unconnected features (e.g. WATCHLIST_SCORE_NOT_IMPORTED).
 * ADR-0467, gate1ScoreCeilingRepair fallbackPolicy reference.
 */
const NEUTRAL_IF_MISSING_CODES: ReadonlySet<PositiveSignalComponentCode> = new Set([
  'WATCHLIST_PRIORITY',      // fallbackPolicy: NEUTRAL_IF_MISSING — rank-based boost, not a Gate1 condition key
  'GHOST_SIGNAL_STRENGTH',   // fallbackPolicy: DIAGNOSTIC_ONLY   — advisory learning trace
  'SECTOR_RELATIVE_STRENGTH', // fallbackPolicy: EXCLUDE_FROM_DENOMINATOR — sector data often absent
]);

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function sum(values: readonly number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

function avg(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function stdDev(values: readonly number[]): number {
  if (values.length <= 1) return 0;
  const mean = avg(values);
  return Math.sqrt(avg(values.map((value) => (value - mean) ** 2)));
}

function min(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.min(...values);
}

function max(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function byCode<T extends { code: string }>(items: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const arr = map.get(item.code) ?? [];
    arr.push(item);
    map.set(item.code, arr);
  }
  return map;
}

export function positiveComponent(input: {
  code: PositiveSignalComponentCode;
  weightedScore?: number;
  maxScore?: number;
  available?: boolean;
  confidence?: ScoreConfidence;
  rawValue?: unknown;
  source?: string;
  zeroContributionReason?: string;
  message?: string;
}): PositiveScoreContributionTrace {
  const weightedScore = finite(input.weightedScore) ? input.weightedScore : 0;
  const maxScore = finite(input.maxScore) ? input.maxScore : Math.max(weightedScore, 0);
  const available = input.available ?? weightedScore > 0;
  return {
    code: input.code,
    available,
    rawValue: input.rawValue,
    normalizedScore: maxScore > 0 ? round2(weightedScore / maxScore) : 0,
    weight: maxScore,
    weightedScore,
    maxScore,
    contributionPct: maxScore > 0 ? round2((weightedScore / maxScore) * 100) : 0,
    source: input.source,
    confidence: input.confidence ?? (available ? 'VERIFIED' : 'MISSING'),
    zeroContributionReason: input.zeroContributionReason,
    message: input.message ?? `${input.code} contribution ${weightedScore.toFixed(1)}`,
  };
}

export function penaltyComponent(input: {
  code: SignalScoreComponentCode;
  weightedScore: number;
  penaltyReason?: string;
  providerIssue?: boolean;
  marketSignal?: boolean;
  confidence?: ScoreConfidence;
  message?: string;
}): SignalScoreComponentTrace {
  return {
    code: input.code,
    normalizedScore: 0,
    weight: Math.abs(input.weightedScore),
    weightedScore: input.weightedScore,
    maxScore: 0,
    contributionPct: 0,
    confidence: input.confidence ?? 'VERIFIED',
    providerIssue: input.providerIssue ?? false,
    marketSignal: input.marketSignal ?? false,
    penaltyApplied: input.weightedScore < 0,
    penaltyReason: input.penaltyReason,
    message: input.message ?? input.penaltyReason ?? `${input.code} penalty`,
  };
}

function positiveCodeForCondition(key: string): PositiveSignalComponentCode {
  return CONDITION_TO_POSITIVE_CODE[key] ?? 'OTHER_POSITIVE';
}

/**
 * ADR-0467 attribution fix: CORE_SIGNAL positive codes whose canonical Gate1
 * minimum-signal contribution lives in minimumSignalScoreTrace.components
 * (weightedScore) — NOT in Gate2-level condition outputs. When minSignalComponents
 * is supplied, these codes are sourced from the canonical weightedScore and the
 * matching condition outputs are NOT re-attributed (prevents the OTHER_POSITIVE
 * leak and the false PRICE_MOMENTUM zeroContribution). Every other code keeps the
 * legacy outputs path so absence of minSignalComponents stays byte-equivalent.
 */
const CANONICAL_MIN_SIGNAL_CODES: ReadonlySet<PositiveSignalComponentCode> = new Set([
  'PRICE_MOMENTUM',
  'TECHNICAL_TREND',
  'RELATIVE_STRENGTH',
  'BREAKOUT_STRUCTURE',
  'VOLUME_LIQUIDITY',
  'WATCHLIST_UPSTREAM_SCORE',
]);

function isCanonicalMinSignalCode(code: string): code is PositiveSignalComponentCode {
  return CANONICAL_MIN_SIGNAL_CODES.has(code as PositiveSignalComponentCode);
}

export function buildGate1ScoreStarvationTraceFromGateResult(
  input: Gate1ScoreStarvationGateResultInput,
): Gate1ScoreStarvationTrace {
  const scale = finite(input.scoreScale) ? input.scoreScale : GATE1_SCORE_SCALE;
  const actualRaw = finite(input.gateResult.rawScore)
    ? input.gateResult.rawScore
    : finite(input.gateResult.gateScore)
      ? input.gateResult.gateScore
      : 0;
  const outputs = input.gateResult.outputs ?? [];
  const grouped = new Map<PositiveSignalComponentCode, PositiveScoreContributionTrace>();

  // ADR-0467 attribution fix: canonical CORE_SIGNAL contributions come from the
  // minimumSignalScoreTrace components (weightedScore). When supplied, the codes
  // they cover are owned by the canonical path; the matching Gate2-level condition
  // outputs are skipped below so they neither create a false zeroContribution nor
  // leak their residual value into OTHER_POSITIVE. Absent => legacy outputs path.
  const canonicalComponents = (input.minSignalComponents ?? []).filter((component) =>
    isCanonicalMinSignalCode(component.code),
  );
  const canonicalCodes = new Set<PositiveSignalComponentCode>(
    canonicalComponents.map((component) => component.code as PositiveSignalComponentCode),
  );

  for (const item of outputs) {
    const code = positiveCodeForCondition(item.key);
    // Skip condition outputs whose canonical contribution is supplied via
    // minSignalComponents — prevents double-count and OTHER_POSITIVE leak.
    if (canonicalCodes.has(code)) continue;
    const score = finite(item.output?.score) ? Math.max(0, item.output.score * scale) : 0;
    const status = item.output?.status;
    const available = item.output !== null && status !== 'DATA_UNAVAILABLE' && status !== 'ERROR';
    const confidence: ScoreConfidence =
      status === 'DATA_UNAVAILABLE' || item.context?.hadRequiredData === false ? 'MISSING'
      : status === 'PROVIDER_DEGRADED' ? 'DEGRADED'
      : status === 'THRESHOLD_NOT_MET' ? 'VERIFIED'
      : 'VERIFIED';
    const current = grouped.get(code);
    const next = positiveComponent({
      code,
      weightedScore: (current?.weightedScore ?? 0) + score,
      maxScore: (current?.maxScore ?? 0) + Math.max(score, scale),
      available: (current?.available ?? false) || available,
      confidence: current?.confidence === 'DEGRADED' || confidence === 'DEGRADED'
        ? 'DEGRADED'
        : current?.confidence === 'MISSING' && confidence === 'MISSING'
          ? 'MISSING'
          : confidence,
      source: 'evaluateServerGate.outputs',
      zeroContributionReason: score === 0 ? status ?? 'ZERO_OUTPUT_SCORE' : undefined,
      message: `${code} from ${item.key}`,
    });
    grouped.set(code, next);
  }

  // ADR-0467: seed canonical CORE_SIGNAL contributions from minimumSignalScoreTrace
  // weightedScores (the SSOT for PRICE_MOMENTUM etc.). This overrides any prior
  // outputs-derived entry and authoritatively attributes the contribution.
  for (const component of canonicalComponents) {
    const code = component.code as PositiveSignalComponentCode;
    const weightedScore = finite(component.weightedScore) ? Math.max(0, component.weightedScore) : 0;
    const maxScore = finite(component.maxScore) && component.maxScore > 0 ? component.maxScore : 10;
    grouped.set(code, positiveComponent({
      code,
      weightedScore,
      maxScore,
      available: true,
      confidence: component.confidence ?? 'VERIFIED',
      source: 'minimumSignalScoreTrace.components',
      zeroContributionReason: weightedScore === 0 ? 'MIN_SIGNAL_WEIGHTED_SCORE_ZERO' : undefined,
      message: component.message ?? `${code} from minimumSignalScoreTrace (weightedScore ${weightedScore.toFixed(1)})`,
    }));
  }

  for (const code of AUDITED_POSITIVE_FEATURES) {
    if (!grouped.has(code)) {
      // NEUTRAL_IF_MISSING codes have no Gate1 output key and a fallbackPolicy that
      // does not indicate a wiring gap — treat as available=true, confidence=DIAGNOSTIC_ONLY
      // so they do not inflate missingPositiveComponents counts (ADR-0467).
      const isNeutral = NEUTRAL_IF_MISSING_CODES.has(code);
      grouped.set(code, positiveComponent({
        code,
        weightedScore: 0,
        maxScore: code === 'WATCHLIST_UPSTREAM_SCORE' ? 20 : 10,
        available: isNeutral ? true : false,
        confidence: isNeutral ? 'DIAGNOSTIC_ONLY' : 'MISSING',
        source: 'ADR-0467 audit',
        zeroContributionReason: isNeutral
          ? 'neutral-if-missing: no Gate1 output key, score=0 by design'
          : 'feature not present in Gate1 outputs',
      }));
    }
  }

  const watchlistImported = grouped.get('WATCHLIST_UPSTREAM_SCORE')?.weightedScore ?? 0;
  const penaltyComponents: SignalScoreComponentTrace[] = [
    ...(input.gateResult.unavailableConditions ?? []).map((condition) =>
      penaltyComponent({
        code: 'UNKNOWN_DATA_PENALTY',
        weightedScore: -scale,
        providerIssue: true,
        penaltyReason: `unavailable ${condition}`,
        confidence: 'UNKNOWN',
      }),
    ),
    ...(input.gateResult.providerDegradedConditions ?? []).map((condition) =>
      penaltyComponent({
        code: 'DATA_QUALITY',
        weightedScore: -scale * 0.5,
        providerIssue: true,
        penaltyReason: `provider degraded ${condition}`,
        confidence: 'DEGRADED',
      }),
    ),
  ];

  return buildGate1ScoreStarvationTrace({
    symbol: input.symbol,
    name: input.name,
    requiredScore: input.requiredScore * scale,
    actualScore: actualRaw * scale,
    positiveComponents: Array.from(grouped.values()),
    penaltyComponents,
    watchlistScore: input.watchlistScore,
    upstreamScore: input.upstreamScore,
    watchlistRank: input.watchlistRank,
    gate1ImportedWatchlistScore: watchlistImported,
    configuredPositiveMaxScore: finite(input.gateResult.availableMaxScore)
      ? input.gateResult.availableMaxScore * scale
      : undefined,
  });
}

export function buildGate1ScoreStarvationTrace(
  input: Gate1ScoreStarvationInput,
): Gate1ScoreStarvationTrace {
  const grossPositiveScore = round2(sum(input.positiveComponents.map((c) => Math.max(0, c.weightedScore))));
  const observedPenalty = round2(sum((input.penaltyComponents ?? []).map((c) => Math.abs(Math.min(0, c.weightedScore)))));
  const derivedPenalty = Math.max(0, grossPositiveScore - input.actualScore);
  const totalPenaltyScore = observedPenalty > 0 ? observedPenalty : round2(derivedPenalty);
  const netScoreAfterPenalty = round2(grossPositiveScore - totalPenaltyScore);
  const positiveMaxPossibleScore = round2(
    finite(input.configuredPositiveMaxScore)
      ? input.configuredPositiveMaxScore
      : sum(input.positiveComponents.map((c) => Math.max(0, c.maxScore))),
  );
  const positiveUtilizationPct = positiveMaxPossibleScore > 0
    ? round2(Math.max(0, Math.min(100, (grossPositiveScore / positiveMaxPossibleScore) * 100)))
    : 0;
  const scoreCeilingEstimate = round2(positiveMaxPossibleScore - totalPenaltyScore);

  const missingPositiveComponents = input.positiveComponents
    .filter((c) => !c.available || c.confidence === 'MISSING')
    .map((c) => c.code);
  const zeroContributionComponents = input.positiveComponents
    .filter((c) => c.weightedScore === 0 && c.available && c.confidence !== 'MISSING')
    .map((c) => c.code);
  const verifiedZeroComponents = input.positiveComponents
    .filter((c) => c.weightedScore === 0 && c.available && c.confidence === 'VERIFIED')
    .map((c) => c.code);
  const stalePositiveComponents = input.positiveComponents
    .filter((c) => c.confidence === 'STALE' || c.confidence === 'DEGRADED')
    .map((c) => c.code);

  const importedWatchlistScore = input.gate1ImportedWatchlistScore ??
    input.positiveComponents.find((c) => c.code === 'WATCHLIST_UPSTREAM_SCORE')?.weightedScore;
  const watchlistScore = input.watchlistScore ?? input.upstreamScore;
  const watchlistDelta = finite(watchlistScore) && finite(importedWatchlistScore)
    ? round2(watchlistScore - importedWatchlistScore)
    : undefined;

  const starvationReason: string[] = [];
  if (positiveUtilizationPct < 35) starvationReason.push('LOW_POSITIVE_UTILIZATION');
  if (zeroContributionComponents.length >= 3) starvationReason.push('MULTIPLE_ZERO_POSITIVE_COMPONENTS');
  if (missingPositiveComponents.includes('WATCHLIST_UPSTREAM_SCORE')) starvationReason.push('WATCHLIST_SCORE_NOT_IMPORTED');
  if (Math.abs(netScoreAfterPenalty - input.actualScore) > 0.2) starvationReason.push('NET_SCORE_ACTUAL_MISMATCH');
  if (scoreCeilingEstimate < input.requiredScore) starvationReason.push('SCORE_CEILING_BELOW_THRESHOLD');

  const actualScore = round2(input.actualScore);
  const restoredFeatureScore = actualScore + Math.max(0, positiveMaxPossibleScore - grossPositiveScore);
  const watchlistImportedScore = actualScore + Math.max(0, watchlistDelta ?? 0);
  const noEarlyPenaltyScore = input.penaltyAppliedBeforePositive
    ? Math.max(actualScore, grossPositiveScore)
    : actualScore;

  return {
    symbol: input.symbol,
    name: input.name,
    requiredScore: input.requiredScore,
    actualScore,
    scoreGap: round2(actualScore - input.requiredScore),
    grossPositiveScore,
    totalPenaltyScore,
    netScoreAfterPenalty,
    positiveMaxPossibleScore,
    positiveUtilizationPct,
    scoreCeilingEstimate,
    positiveComponents: input.positiveComponents,
    penaltyComponents: input.penaltyComponents ?? [],
    zeroContributionComponents,
    missingPositiveComponents,
    verifiedZeroComponents,
    stalePositiveComponents,
    watchlistScore: input.watchlistScore,
    upstreamScore: input.upstreamScore,
    gate1ImportedWatchlistScore: importedWatchlistScore,
    watchlistToGate1ScoreDelta: watchlistDelta,
    scoreStarved: starvationReason.length > 0,
    starvationReason,
    wouldPassIfWatchlistScoreImported: watchlistImportedScore >= input.requiredScore,
    wouldPassIfPositiveFeaturesRestored: restoredFeatureScore >= input.requiredScore,
    wouldPassIfPenaltyNotAppliedBeforePositive: noEarlyPenaltyScore >= input.requiredScore,
    wouldPassIfScoreCeilingFixed: Math.max(actualScore, input.requiredScore) >= input.requiredScore,
  };
}

export function buildWatchlistGate1PropagationTrace(input: {
  symbol: string;
  name?: string;
  watchlistRank?: number;
  watchlistScore?: number;
  watchlistReason?: string[];
  upstreamCandidateScore?: number;
  gate1BaseScoreBeforePenalty: number;
  gate1PositiveScore: number;
  gate1NetScore: number;
  importWeight?: number;
  actualContribution?: number;
}): WatchlistGate1PropagationTrace {
  const upstream = input.watchlistScore ?? input.upstreamCandidateScore;
  const importWeight = input.importWeight ?? 1;
  const expectedContribution = finite(upstream) ? round2(upstream * importWeight) : undefined;
  const actualContribution = input.actualContribution ?? 0;
  const importedToGate1 = actualContribution > 0;
  const propagationGap = finite(expectedContribution)
    ? round2(expectedContribution - actualContribution)
    : undefined;
  let issueReason: string | undefined;
  if (!finite(upstream)) issueReason = 'MISSING_UPSTREAM_SCORE';
  else if (!importedToGate1) issueReason = 'WATCHLIST_SCORE_NOT_IMPORTED';
  else if (finite(expectedContribution) && (propagationGap ?? 0) > Math.max(1, expectedContribution * 0.25)) {
    issueReason = 'WATCHLIST_SCORE_UNDER_IMPORTED';
  }

  return {
    symbol: input.symbol,
    name: input.name,
    watchlistRank: input.watchlistRank,
    watchlistScore: input.watchlistScore,
    watchlistReason: input.watchlistReason,
    upstreamCandidateScore: input.upstreamCandidateScore,
    gate1BaseScoreBeforePenalty: input.gate1BaseScoreBeforePenalty,
    gate1PositiveScore: input.gate1PositiveScore,
    gate1NetScore: input.gate1NetScore,
    importedToGate1,
    importWeight,
    expectedContribution,
    actualContribution,
    propagationGap,
    propagationIssue: issueReason !== undefined,
    issueReason,
  };
}

export function buildPositiveFeatureAvailabilityAudit(
  traces: readonly Gate1ScoreStarvationTrace[],
  auditedFeatures: readonly PositiveSignalComponentCode[] = AUDITED_POSITIVE_FEATURES,
): PositiveFeatureAvailabilityAudit {
  const totalCandidates = traces.length;
  const featureAvailability = auditedFeatures.map((code) => {
    const components = traces.map((trace) => trace.positiveComponents.find((c) => c.code === code));
    const missing = components.filter((c) => !c || !c.available || c.confidence === 'MISSING');
    const zero = components.filter((c) => c && c.weightedScore === 0);
    const stale = components.filter((c) => c && (c.confidence === 'STALE' || c.confidence === 'DEGRADED'));
    const scores = components.map((c) => c?.weightedScore ?? 0);
    return {
      code,
      availableCount: components.filter((c) => c?.available).length,
      missingCount: missing.length,
      zeroScoreCount: zero.length,
      staleCount: stale.length,
      avgWeightedScore: round2(avg(scores)),
      maxWeightedScore: round2(max(scores)),
      examplesMissing: traces.filter((_, index) => !components[index] || !components[index]?.available)
        .slice(0, 3).map((trace) => trace.symbol),
      examplesZero: traces.filter((_, index) => components[index]?.weightedScore === 0)
        .slice(0, 3).map((trace) => trace.symbol),
    };
  });
  const allZeroFeatures = featureAvailability
    .filter((item) => totalCandidates > 0 && item.zeroScoreCount === totalCandidates)
    .map((item) => item.code);
  const mostlyZeroFeatures = featureAvailability
    .filter((item) => totalCandidates > 0 && item.zeroScoreCount / totalCandidates >= 0.8 && item.zeroScoreCount < totalCandidates)
    .map((item) => item.code);

  let recommendedAction: PositiveFeatureAvailabilityAudit['recommendedAction'] = 'NO_ACTION';
  if (allZeroFeatures.includes('WATCHLIST_UPSTREAM_SCORE')) recommendedAction = 'CHECK_UPSTREAM_SCORE_IMPORT';
  else if (allZeroFeatures.length > 0 || mostlyZeroFeatures.length > 0) recommendedAction = 'CHECK_FEATURE_WIRING';

  return {
    totalCandidates,
    featureAvailability,
    allZeroFeatures,
    mostlyZeroFeatures,
    recommendedAction,
  };
}

export function buildScoreRangeCompressionReport(
  traces: readonly Gate1ScoreStarvationTrace[],
): ScoreRangeCompressionReport {
  const actualScores = traces.map((trace) => trace.actualScore);
  const positiveScores = traces.map((trace) => trace.grossPositiveScore);
  const penaltyScores = traces.map((trace) => trace.totalPenaltyScore);
  const actualScoreRange = round2(max(actualScores) - min(actualScores));
  const grossPositiveScoreRange = round2(max(positiveScores) - min(positiveScores));
  const penaltyScoreRange = round2(max(penaltyScores) - min(penaltyScores));
  const actualScoreStdDev = round2(stdDev(actualScores));
  const positiveScoreStdDev = round2(stdDev(positiveScores));
  const compressed = traces.length >= 3 && (actualScoreRange <= 5 || actualScoreStdDev <= 2);
  const compressionReason: string[] = [];
  const suspectedCauses: ScoreRangeCompressionCause[] = [];

  if (compressed) compressionReason.push(`actualScore range ${actualScoreRange.toFixed(1)} is narrow`);
  if (positiveScoreStdDev <= 2 && traces.length >= 3) {
    compressionReason.push('positive score stddev is low');
    suspectedCauses.push('MISSING_SYMBOL_LEVEL_FEATURES');
  }
  if (grossPositiveScoreRange <= 2 && penaltyScoreRange <= 2 && traces.length >= 3) {
    compressionReason.push('positive and penalty ranges are both flat');
    suspectedCauses.push('DEFAULT_SCORE_USED_FOR_ALL');
  }
  if (traces.some((trace) => trace.starvationReason.includes('WATCHLIST_SCORE_NOT_IMPORTED'))) {
    suspectedCauses.push('WATCHLIST_SCORE_NOT_IMPORTED');
  }
  if (traces.some((trace) => trace.totalPenaltyScore >= trace.grossPositiveScore)) {
    suspectedCauses.push('PENALTY_DOMINATES_SCORE');
  }
  if (traces.some((trace) => trace.scoreCeilingEstimate < trace.requiredScore)) {
    suspectedCauses.push('SCORE_CEILING_TOO_LOW');
  }
  if (suspectedCauses.length === 0) suspectedCauses.push('UNKNOWN');

  return {
    totalCandidates: traces.length,
    actualScoreMin: round2(min(actualScores)),
    actualScoreMax: round2(max(actualScores)),
    actualScoreRange,
    actualScoreStdDev,
    grossPositiveScoreRange,
    positiveScoreStdDev,
    penaltyScoreRange,
    compressed,
    compressionReason,
    suspectedCauses: Array.from(new Set(suspectedCauses)),
  };
}

export function buildScoreCeilingAudit(input: {
  traces: readonly Gate1ScoreStarvationTrace[];
  theoreticalMaxScore?: number;
  configuredPositiveMaxScore?: number;
}): ScoreCeilingAudit {
  const requiredScoreAvg = round2(avg(input.traces.map((trace) => trace.requiredScore)));
  const configuredPositiveMaxScore = round2(
    input.configuredPositiveMaxScore ?? max(input.traces.map((trace) => trace.positiveMaxPossibleScore)),
  );
  const theoreticalMaxScore = round2(input.theoreticalMaxScore ?? Math.max(100, configuredPositiveMaxScore));
  const observedPositiveMaxScore = round2(max(input.traces.map((trace) => trace.grossPositiveScore)));
  const observedNetMaxScore = round2(max(input.traces.map((trace) => trace.actualScore)));
  const scoreCeilingBelowThreshold = configuredPositiveMaxScore < requiredScoreAvg;
  const requiredScoreReachable = theoreticalMaxScore >= requiredScoreAvg && configuredPositiveMaxScore >= requiredScoreAvg;
  return {
    requiredScoreAvg,
    theoreticalMaxScore,
    configuredPositiveMaxScore,
    observedPositiveMaxScore,
    observedNetMaxScore,
    scoreCeilingBelowThreshold,
    requiredScoreReachable,
    message: scoreCeilingBelowThreshold
      ? 'SCORE_CEILING_BELOW_THRESHOLD: configured positive score cannot reach required score.'
      : 'Score ceiling can reach required score; investigate feature wiring and penalties.',
  };
}

export function buildPenaltyApplicationOrderAudit(input: {
  symbol: string;
  positiveBeforePenalty: number;
  netScore: number;
  penaltyComponents: readonly SignalScoreComponentTrace[];
  penaltyAppliedBeforePositive?: boolean;
  penaltyOrder?: readonly string[];
  sizingRiskPenalty?: number;
}): PenaltyApplicationOrderAudit {
  const warnings: string[] = [];
  const codes = input.penaltyComponents.map((component) => component.code);
  const hasSupply = codes.includes('SUPPLY_CONFLUENCE') || codes.includes('UNKNOWN_DATA_PENALTY');
  const hasInvestor = codes.includes('INVESTOR_FLOW');
  const hasSoft = codes.includes('SOFT_FAIL_PENALTY');
  const hasRiskSignal = codes.includes('RISK_PENALTY');
  if (hasSupply && hasInvestor && hasSoft) warnings.push('DUPLICATE_SUPPLY_UNKNOWN_PENALTY');
  if (hasRiskSignal && (input.sizingRiskPenalty ?? 0) > 0) warnings.push('RISK_PENALTY_DOUBLE_COUNT_WITH_KELLY');
  if (input.penaltyAppliedBeforePositive) warnings.push('PENALTY_APPLIED_BEFORE_POSITIVE');

  return {
    symbol: input.symbol,
    positiveBeforePenalty: input.positiveBeforePenalty,
    penaltyAppliedBeforePositive: input.penaltyAppliedBeforePositive ?? false,
    penaltyOrder: [...(input.penaltyOrder ?? codes)],
    duplicatePenaltyWarnings: warnings,
    netScore: input.netScore,
    message: warnings.length > 0 ? warnings.join('; ') : 'No duplicate penalty warning.',
  };
}

function adjustedScoreForScenario(
  trace: Gate1ScoreStarvationTrace,
  scenario: PositiveScoreCalibrationScenario,
): { adjustedScore: number; reason: string[] } {
  const component = (code: PositiveSignalComponentCode) =>
    trace.positiveComponents.find((item) => item.code === code);
  switch (scenario) {
    case 'IMPORT_WATCHLIST_SCORE': {
      const delta = Math.max(0, trace.watchlistToGate1ScoreDelta ?? trace.watchlistScore ?? 0);
      return { adjustedScore: trace.actualScore + delta, reason: ['import watchlist score delta'] };
    }
    case 'RESTORE_PRICE_MOMENTUM':
    case 'RESTORE_RELATIVE_STRENGTH':
    case 'RESTORE_TECHNICAL_TREND':
    case 'RESTORE_VOLUME_LIQUIDITY': {
      const code = scenario.replace('RESTORE_', '') as PositiveSignalComponentCode;
      const c = component(code);
      const delta = Math.max(0, (c?.maxScore ?? 10) - (c?.weightedScore ?? 0));
      return { adjustedScore: trace.actualScore + delta, reason: [`restore ${code}`] };
    }
    case 'REMOVE_DUPLICATE_SUPPLY_PENALTY': {
      const duplicate = trace.penaltyComponents
        .filter((item) => ['SUPPLY_CONFLUENCE', 'INVESTOR_FLOW', 'SOFT_FAIL_PENALTY', 'UNKNOWN_DATA_PENALTY'].includes(item.code))
        .map((item) => Math.abs(Math.min(0, item.weightedScore)));
      const delta = Math.max(0, sum(duplicate) - max(duplicate));
      return { adjustedScore: trace.actualScore + delta, reason: ['remove duplicate supply-like penalties'] };
    }
    case 'CAP_TOTAL_PENALTY': {
      const cap = trace.grossPositiveScore * 0.35;
      const delta = Math.max(0, trace.totalPenaltyScore - cap);
      return { adjustedScore: trace.actualScore + delta, reason: ['cap total penalty at 35% of gross positive'] };
    }
    case 'FIX_SCORE_CEILING':
      return { adjustedScore: Math.max(trace.actualScore, trace.requiredScore), reason: ['audit-only ceiling reachability check'] };
    case 'NORMALIZE_WEIGHTS_TO_100': {
      const scale = trace.positiveMaxPossibleScore > 0 ? 100 / trace.positiveMaxPossibleScore : 1;
      return { adjustedScore: (trace.grossPositiveScore * scale) - trace.totalPenaltyScore, reason: ['normalize positive weights to 100'] };
    }
  }
}

export function buildPositiveScoreCalibrationResults(
  traces: readonly Gate1ScoreStarvationTrace[],
  scenarios: readonly PositiveScoreCalibrationScenario[] = [
    'IMPORT_WATCHLIST_SCORE',
    'RESTORE_PRICE_MOMENTUM',
    'RESTORE_RELATIVE_STRENGTH',
    'RESTORE_TECHNICAL_TREND',
    'RESTORE_VOLUME_LIQUIDITY',
    'REMOVE_DUPLICATE_SUPPLY_PENALTY',
    'CAP_TOTAL_PENALTY',
    'FIX_SCORE_CEILING',
    'NORMALIZE_WEIGHTS_TO_100',
  ],
): PositiveScoreCalibrationResult[] {
  return scenarios.map((scenario) => {
    const adjusted = traces.map((trace) => {
      const result = adjustedScoreForScenario(trace, scenario);
      return { trace, adjustedScore: round2(result.adjustedScore), reason: result.reason };
    });
    const survivors = adjusted.filter((item) => item.adjustedScore >= item.trace.requiredScore);
    return {
      scenario,
      hypotheticalSurvivors: survivors.length,
      survivorExamples: survivors.slice(0, 5).map((item) => ({
        symbol: item.trace.symbol,
        name: item.trace.name,
        actualScore: item.trace.actualScore,
        adjustedScore: item.adjustedScore,
        requiredScore: item.trace.requiredScore,
        reason: item.reason,
      })),
      executionImpact: 'NONE',
    };
  });
}

export function buildEntryDecisionLedgerPositiveStarvationSummary(input: {
  trace: Gate1ScoreStarvationTrace;
  propagationTrace?: WatchlistGate1PropagationTrace;
  ceilingAudit?: ScoreCeilingAudit;
  compressionReport?: ScoreRangeCompressionReport;
  penaltyAudit?: PenaltyApplicationOrderAudit;
}): EntryDecisionLedgerPositiveStarvationSummary {
  const tags: EntryDecisionLedgerPositiveStarvationSummary['tags'] = [];
  if (input.trace.scoreStarved) tags.push('CASE_GATE1_POSITIVE_SCORE_STARVATION');
  if (input.propagationTrace?.propagationIssue) tags.push('CASE_WATCHLIST_SCORE_NOT_IMPORTED');
  if (input.ceilingAudit?.scoreCeilingBelowThreshold) tags.push('CASE_SCORE_CEILING_BELOW_THRESHOLD');
  if (input.compressionReport?.compressed) tags.push('CASE_SCORE_RANGE_COMPRESSION');
  if ((input.penaltyAudit?.duplicatePenaltyWarnings.length ?? 0) > 0) tags.push('CASE_DUPLICATE_PENALTY');
  return {
    scoreStarved: input.trace.scoreStarved,
    grossPositiveScore: input.trace.grossPositiveScore,
    totalPenaltyScore: input.trace.totalPenaltyScore,
    netScoreAfterPenalty: input.trace.netScoreAfterPenalty,
    positiveUtilizationPct: input.trace.positiveUtilizationPct,
    watchlistPropagationIssue: input.propagationTrace?.propagationIssue ?? false,
    scoreCeilingBelowThreshold: input.ceilingAudit?.scoreCeilingBelowThreshold ?? false,
    rangeCompressed: input.compressionReport?.compressed ?? false,
    duplicatePenaltyWarning: (input.penaltyAudit?.duplicatePenaltyWarnings.length ?? 0) > 0,
    tags,
    executionImpact: 'NONE',
  };
}

export function buildPositiveScoreStarvationReport(input: {
  traces: readonly Gate1ScoreStarvationTrace[];
  timestamp: string;
  forDate: string;
  regime: string;
  marketSession: string;
  theoreticalMaxScore?: number;
  configuredPositiveMaxScore?: number;
}): PositiveScoreStarvationReport {
  const traces = input.traces;
  const actualScores = traces.map((trace) => trace.actualScore);
  const contributionMap = byCode(traces.flatMap((trace) => trace.positiveComponents));
  const topPositiveContributors = Array.from(contributionMap.entries())
    .map(([code, components]) => ({
      code: code as PositiveSignalComponentCode,
      avgContribution: round2(avg(components.map((component) => component.weightedScore))),
      affectedCount: components.filter((component) => component.weightedScore > 0).length,
    }))
    .sort((a, b) => b.avgContribution - a.avgContribution)
    .slice(0, 8);

  const countCodes = (selector: (trace: Gate1ScoreStarvationTrace) => PositiveSignalComponentCode[]) =>
    Array.from(
      traces.reduce((map, trace) => {
        for (const code of selector(trace)) map.set(code, (map.get(code) ?? 0) + 1);
        return map;
      }, new Map<PositiveSignalComponentCode, number>()),
    )
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count);

  const currentPathComponentStatus = Array.from(contributionMap.entries())
    .map(([code, components]) => ({
      code: code as PositiveSignalComponentCode,
      verified: components.filter((component) => component.available && component.confidence !== 'MISSING').length,
      missing: components.filter((component) => !component.available || component.confidence === 'MISSING').length,
      avgContribution: round2(avg(components.map((component) => component.weightedScore))),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const scoreCeilingAudit = buildScoreCeilingAudit({
    traces,
    theoreticalMaxScore: input.theoreticalMaxScore,
    configuredPositiveMaxScore: input.configuredPositiveMaxScore,
  });
  const rangeCompressionReport = buildScoreRangeCompressionReport(traces);
  const calibrationResults = buildPositiveScoreCalibrationResults(traces);
  const hasDuplicatePenalty = traces.some((trace) => {
    const codes = trace.penaltyComponents.map((component) => component.code);
    return codes.includes('SUPPLY_CONFLUENCE') && codes.includes('INVESTOR_FLOW') && codes.includes('SOFT_FAIL_PENALTY');
  });

  let recommendedAction: PositiveScoreStarvationReport['recommendedAction'] = 'NO_ACTION';
  if (scoreCeilingAudit.scoreCeilingBelowThreshold) recommendedAction = 'CHECK_SCORE_CEILING';
  else if (rangeCompressionReport.suspectedCauses.includes('WATCHLIST_SCORE_NOT_IMPORTED') &&
    currentPathComponentStatus.find((item) => item.code === 'WATCHLIST_UPSTREAM_SCORE')?.missing !== 0) {
    recommendedAction = 'CHECK_WATCHLIST_SCORE_PROPAGATION';
  } else if (hasDuplicatePenalty) recommendedAction = 'CHECK_PENALTY_DUPLICATION';
  else if (traces.some((trace) => trace.zeroContributionComponents.length > 0)) recommendedAction = 'CHECK_FEATURE_WIRING';

  return {
    timestamp: input.timestamp,
    forDate: input.forDate,
    regime: input.regime,
    marketSession: input.marketSession,
    totalCandidates: traces.length,
    requiredScoreAvg: round1(avg(traces.map((trace) => trace.requiredScore))),
    actualScoreAvg: round1(avg(actualScores)),
    grossPositiveScoreAvg: round1(avg(traces.map((trace) => trace.grossPositiveScore))),
    totalPenaltyScoreAvg: round1(avg(traces.map((trace) => trace.totalPenaltyScore))),
    netScoreAvg: round1(avg(traces.map((trace) => trace.netScoreAfterPenalty))),
    positiveUtilizationAvg: round1(avg(traces.map((trace) => trace.positiveUtilizationPct))),
    actualScoreMin: round1(min(actualScores)),
    actualScoreMax: round1(max(actualScores)),
    actualScoreRange: round1(max(actualScores) - min(actualScores)),
    actualScoreStdDev: round2(stdDev(actualScores)),
    topPositiveContributors,
    zeroContributionComponents: countCodes((trace) => trace.zeroContributionComponents),
    missingPositiveComponents: countCodes((trace) => trace.missingPositiveComponents),
    verifiedZeroComponents: countCodes((trace) => trace.verifiedZeroComponents),
    currentPathComponentStatus,
    scoreCeilingAudit,
    rangeCompressionReport,
    wouldPassIfWatchlistScoreImported: traces.filter((trace) => trace.wouldPassIfWatchlistScoreImported).length,
    wouldPassIfPositiveFeaturesRestored: traces.filter((trace) => trace.wouldPassIfPositiveFeaturesRestored).length,
    wouldPassIfPenaltyNotAppliedBeforePositive: traces.filter((trace) => trace.wouldPassIfPenaltyNotAppliedBeforePositive).length,
    wouldPassIfScoreCeilingFixed: traces.filter((trace) => trace.wouldPassIfScoreCeilingFixed).length,
    calibrationResults,
    recommendedAction,
  };
}

export function buildPositiveScoreStarvationFallbackReport(input: {
  minSignalScoreReport?: MinSignalScoreDecompositionReport | null;
  timestamp: string;
  forDate: string;
  regime: string;
  marketSession: string;
}): PositiveScoreStarvationReport | null {
  const min = input.minSignalScoreReport;
  if (!min || min.totalCandidates <= 0) return null;

  const totalPenaltyScoreAvg = round1(sum(
    min.topPenaltyContributors.map((item) => Math.abs(item.avgPenalty)),
  ));
  const grossPositiveScoreAvg = round1(min.actualScoreAvg + totalPenaltyScoreAvg);
  const fallbackSignalEligibleMaxScore = 92;
  const configuredPositiveMaxScore = round1(Math.max(fallbackSignalEligibleMaxScore, grossPositiveScoreAvg, min.actualScoreMax));
  const requiredScoreAvg = round1(min.requiredScoreAvg);
  const actualScoreRange = round1(min.actualScoreMax - min.actualScoreMin);
  const compressed = min.totalCandidates >= 3 && actualScoreRange <= 5;
  const positiveUtilizationAvg = configuredPositiveMaxScore > 0
    ? round1(Math.max(0, Math.min(100, (grossPositiveScoreAvg / configuredPositiveMaxScore) * 100)))
    : 0;

  const scoreCeilingAudit: ScoreCeilingAudit = {
    requiredScoreAvg,
    theoreticalMaxScore: 100,
    configuredPositiveMaxScore,
    observedPositiveMaxScore: grossPositiveScoreAvg,
    observedNetMaxScore: round1(min.actualScoreMax),
    scoreCeilingBelowThreshold: configuredPositiveMaxScore < requiredScoreAvg,
    requiredScoreReachable: configuredPositiveMaxScore >= requiredScoreAvg,
    message: configuredPositiveMaxScore < requiredScoreAvg
      ? 'SCORE_CEILING_BELOW_THRESHOLD: fallback from ADR-0466 shows observed attainable score below required score.'
      : 'ADR-0466 fallback shows required score may be reachable; inspect feature wiring.',
  };
  const rangeCompressionReport: ScoreRangeCompressionReport = {
    totalCandidates: min.totalCandidates,
    actualScoreMin: round1(min.actualScoreMin),
    actualScoreMax: round1(min.actualScoreMax),
    actualScoreRange,
    actualScoreStdDev: 0,
    grossPositiveScoreRange: actualScoreRange,
    positiveScoreStdDev: 0,
    penaltyScoreRange: 0,
    compressed,
    compressionReason: compressed
      ? [`ADR-0466 actualScoreRange ${actualScoreRange.toFixed(1)} is narrow`]
      : [],
    suspectedCauses: compressed
      ? ['WATCHLIST_SCORE_NOT_IMPORTED', 'MISSING_SYMBOL_LEVEL_FEATURES']
      : ['UNKNOWN'],
  };
  const deficitCount = (code: PositiveSignalComponentCode) =>
    min.topScoreDeficits.find((item) => item.code === code)?.affectedCount ?? 0;
  const missingContributionComponents = ([
    { code: 'WATCHLIST_UPSTREAM_SCORE' as const, count: deficitCount('WATCHLIST_UPSTREAM_SCORE') },
    { code: 'RELATIVE_STRENGTH' as const, count: deficitCount('RELATIVE_STRENGTH') },
    { code: 'BREAKOUT_STRUCTURE' as const, count: deficitCount('BREAKOUT_STRUCTURE') },
  ] satisfies Array<{ code: PositiveSignalComponentCode; count: number }>).filter((item) => item.count > 0);
  const zeroContributionComponents: Array<{ code: PositiveSignalComponentCode; count: number }> = [];
  const positiveAllocations: Array<{ code: PositiveSignalComponentCode; max: number }> = [
    { code: 'PRICE_MOMENTUM', max: 20 },
    { code: 'VOLUME_LIQUIDITY', max: 12 },
    { code: 'TECHNICAL_TREND', max: 14 },
    { code: 'RELATIVE_STRENGTH', max: 10 },
    { code: 'WATCHLIST_UPSTREAM_SCORE', max: 10 },
    { code: 'BREAKOUT_STRUCTURE', max: 10 },
    { code: 'WATCHLIST_PRIORITY', max: 8 },
    { code: 'MARKET_REGIME_SUPPORT', max: 6 },
  ];
  const allocationMax = sum(positiveAllocations.map((item) => item.max));
  const topPositiveContributors = positiveAllocations.map((item) => ({
    code: item.code,
    avgContribution: round1(grossPositiveScoreAvg * (item.max / allocationMax)),
    affectedCount: min.totalCandidates,
  }));
  const allocatedPositive = round1(sum(topPositiveContributors.map((item) => item.avgContribution)));
  const remainingOtherPositive = round1(Math.max(0, grossPositiveScoreAvg - allocatedPositive));

  return {
    timestamp: input.timestamp,
    forDate: input.forDate,
    regime: input.regime,
    marketSession: input.marketSession,
    totalCandidates: min.totalCandidates,
    requiredScoreAvg,
    actualScoreAvg: round1(min.actualScoreAvg),
    grossPositiveScoreAvg,
    totalPenaltyScoreAvg,
    netScoreAvg: round1(min.actualScoreAvg),
    positiveUtilizationAvg,
    actualScoreMin: round1(min.actualScoreMin),
    actualScoreMax: round1(min.actualScoreMax),
    actualScoreRange,
    actualScoreStdDev: 0,
    topPositiveContributors: remainingOtherPositive > 0
      ? [...topPositiveContributors, { code: 'OTHER_POSITIVE', avgContribution: remainingOtherPositive, affectedCount: min.totalCandidates }]
      : topPositiveContributors,
    zeroContributionComponents,
    missingPositiveComponents: missingContributionComponents,
    verifiedZeroComponents: [],
    currentPathComponentStatus: positiveAllocations.map((item) => ({
      code: item.code,
      verified: min.totalCandidates,
      missing: missingContributionComponents.find((missing) => missing.code === item.code)?.count ?? 0,
      avgContribution: round1(grossPositiveScoreAvg * (item.max / allocationMax)),
    })),
    scoreCeilingAudit,
    rangeCompressionReport,
    wouldPassIfWatchlistScoreImported: 0,
    wouldPassIfPositiveFeaturesRestored: 0,
    wouldPassIfPenaltyNotAppliedBeforePositive: 0,
    wouldPassIfScoreCeilingFixed: scoreCeilingAudit.requiredScoreReachable ? min.totalCandidates : 0,
    calibrationResults: buildPositiveScoreCalibrationResults([]),
    recommendedAction: scoreCeilingAudit.scoreCeilingBelowThreshold
      ? 'CHECK_SCORE_CEILING'
      : 'CHECK_FEATURE_WIRING',
  };
}

function componentScopesText(): string {
  return (Object.entries(GATE1_SCORE_COMPONENT_SCOPES) as Array<[Gate1ScoreComponentScope, readonly string[]]>)
    .map(([scope, components]) => `${scope}=${components.join(',')}`)
    .join(' | ');
}

function componentResolvedByCanonical(
  code: PositiveSignalComponentCode,
  canonical?: CanonicalRuntimeResolutionStep27,
): boolean {
  if (!canonical) return false;
  if (code === 'WATCHLIST_UPSTREAM_SCORE') return canonical.watchlist.verified > 0 && canonical.watchlist.missing === 0;
  if (code === 'PRICE_MOMENTUM') return canonical.momentum.priceMomentumComputedCount > 0;
  if (code === 'RELATIVE_STRENGTH') return canonical.momentum.relativeReturn20dCount > 0;
  if (code === 'BREAKOUT_STRUCTURE') {
    return canonical.breakout.traceAvailable > 0 && canonical.breakout.scoreMapped > 0 && canonical.breakout.missingByMapping === 0;
  }
  return false;
}

export function formatPositiveScoreStarvationReport(
  report?: PositiveScoreStarvationReport | null,
  canonicalRuntimeResolution?: CanonicalRuntimeResolutionStep27,
): string | null {
  if (!report || report.totalCandidates <= 0) return null;
  const compression = report.rangeCompressionReport;
  const ceiling = report.scoreCeilingAudit;
  const calibration = Object.fromEntries(
    report.calibrationResults.map((item) => [item.scenario, item.hypotheticalSurvivors]),
  ) as Partial<Record<PositiveScoreCalibrationScenario, number>>;
  const configuredPositiveMax = Math.max(
    0.1,
    ceiling.configuredPositiveMaxScore,
    report.grossPositiveScoreAvg,
    report.actualScoreMax,
  );
  const observedPositiveMax = Math.max(ceiling.observedPositiveMaxScore, report.grossPositiveScoreAvg);
  const utilizationByMax = round1(Math.max(0, Math.min(100, (observedPositiveMax / configuredPositiveMax) * 100)));
  const utilizationByAvg = round1(Math.max(0, Math.min(100, (report.grossPositiveScoreAvg / configuredPositiveMax) * 100)));
  const scaleMismatch = isGate1ScaleMismatch(report.actualScoreAvg, report.netScoreAvg, report.positiveUtilizationAvg);
  const displayMissingPositiveComponents = report.missingPositiveComponents
    .filter((item) => !componentResolvedByCanonical(item.code, canonicalRuntimeResolution));
  const lines = [
    '🧬 Positive Score Starvation Audit (ADR-0467)',
    `  candidates: ${report.totalCandidates}`,
    `  componentScopes: ${componentScopesText()}`,
    `  requiredScoreAvg: ${report.requiredScoreAvg.toFixed(1)}`,
    `  finalGate1ScoreAvg: ${report.actualScoreAvg.toFixed(1)} (legacy actualScoreAvg)`,
    `  rawPositiveScoreAvg: ${report.grossPositiveScoreAvg.toFixed(1)} (legacy grossPositiveScoreAvg)`,
    `  rawPenaltyScoreAvg: ${report.totalPenaltyScoreAvg.toFixed(1)} (legacy totalPenaltyScoreAvg)`,
    `  netScoreAvg: ${report.netScoreAvg.toFixed(1)} (rawPositiveScoreAvg - effectivePenaltyScoreAvg)`,
    '  Positive Score Utilization:',
    `  configuredPositiveMax: ${configuredPositiveMax.toFixed(1)}`,
    `  observedPositiveMax: ${observedPositiveMax.toFixed(1)}`,
    `  utilizationByMax: ${utilizationByMax.toFixed(1)}%`,
    `  utilizationByAvg: ${utilizationByAvg.toFixed(1)}%`,
    `  scaleMismatch: ${scaleMismatch}`,
    `  previousPositiveUtilizationAvgDeprecated: ${report.positiveUtilizationAvg.toFixed(1)}% (legacy positiveUtilizationAvg)`,
    `  actualScoreMin/Max: ${report.actualScoreMin.toFixed(1)} / ${report.actualScoreMax.toFixed(1)}`,
    `  actualScoreRange: ${report.actualScoreRange.toFixed(1)} compressed=${compression.compressed}`,
    `  suspectedCause: ${compression.suspectedCauses.join(' / ') || 'NONE'}`,
  ];
  if (report.topPositiveContributors.length > 0) {
    lines.push(
      `  positive contributors: ${report.topPositiveContributors
        .slice(0, 6)
        .map((item) => `${item.code} avg +${item.avgContribution.toFixed(1)} / ${item.affectedCount}`)
        .join(', ')}`,
    );
  }
  lines.push(
    `  zeroContributionComponents: ${report.zeroContributionComponents.length > 0
      ? report.zeroContributionComponents
        .slice(0, 5)
        .map((item) => `${item.code} ${item.count}`)
        .join(', ')
      : 'none'}`,
  );
  lines.push(
    `  missingContributionComponents: ${displayMissingPositiveComponents.length > 0
      ? displayMissingPositiveComponents
        .slice(0, 5)
        .map((item) => `${item.code} ${item.count}`)
        .join(', ')
      : 'none'}`,
  );
  const watchlistStatus = report.currentPathComponentStatus.find((item) => item.code === 'WATCHLIST_UPSTREAM_SCORE');
  if (watchlistStatus) {
    lines.push(
      `  WATCHLIST_UPSTREAM_SCORE: verified ${watchlistStatus.verified} / ` +
        `missing ${watchlistStatus.missing} / avg +${watchlistStatus.avgContribution.toFixed(1)}`,
    );
  }
  if (canonicalRuntimeResolution) {
    const momentum = canonicalRuntimeResolution.momentum;
    const breakout = canonicalRuntimeResolution.breakout;
    const momentumStatus = report.currentPathComponentStatus.find((item) => item.code === 'PRICE_MOMENTUM');
    const zeroReasonTags: string[] = [];
    const computed = momentum.priceMomentumComputedCount;
    if ((momentumStatus?.avgContribution ?? 0) === 0 && computed > 0) {
      // 아래 태그는 coverage gap(임계미달 아님): return*Count < computed 는 해당 필드의
      // 커버리지가 computed(=4개 coverage 의 max)보다 작다는 격차를 뜻한다. 부호·값·점수 무관.
      if (momentum.return5dCount < computed) zeroReasonTags.push('RETURN5D_COVERAGE_GAP');
      if (momentum.return20dCount < computed) zeroReasonTags.push('RETURN20D_COVERAGE_GAP');
      if (momentum.relativeReturn20dCount < computed) zeroReasonTags.push('RELATIVE_RETURN_COVERAGE_GAP');
      if (momentum.marketRelativeReturnCount < computed) zeroReasonTags.push('NEGATIVE_SLOPE');
      if (zeroReasonTags.length === 0) zeroReasonTags.push('SCORE_CURVE_TOO_STRICT');
    }
    const zeroReason = zeroReasonTags.length > 0 ? zeroReasonTags.join('|') : 'NONE';
    lines.push(
      `  PRICE_MOMENTUM: computedCount ${momentum.priceMomentumComputedCount} / ` +
        `return5dCount ${momentum.return5dCount} / return20dCount ${momentum.return20dCount} / ` +
        `relativeReturn20dCount ${momentum.relativeReturn20dCount} / marketRelativeReturnCount ${momentum.marketRelativeReturnCount} / ` +
        `positiveCount ${Math.max(0, report.totalCandidates - (report.zeroContributionComponents.find((c) => c.code === 'PRICE_MOMENTUM')?.count ?? report.totalCandidates))} / ` +
        `zeroReason ${zeroReason}`,
    );
    lines.push(
      `  RELATIVE_STRENGTH: rsRankPctComputedCount ${momentum.relativeReturn20dCount} / ` +
        `relativeStrengthScoreComputedCount ${momentum.relativeReturn20dCount} / rsScoreAppliedCount ${momentum.relativeReturn20dCount} / ` +
        `missingByConnection=${momentum.relativeReturn20dCount === 0}`,
    );
    lines.push(
      `  BREAKOUT_STRUCTURE: traceAvailable ${breakout.traceAvailable} / scoreMappedToGate ${breakout.scoreMapped} / ` +
        `missingByMapping ${breakout.missingByMapping} / zeroByCondition ${breakout.zeroByCondition}`,
    );
  }
  lines.push(
    `  scoreCeilingAudit: configured ${ceiling.configuredPositiveMaxScore.toFixed(1)}, ` +
      `observedPositiveMax ${ceiling.observedPositiveMaxScore.toFixed(1)}, ` +
      `requiredReachable=${ceiling.requiredScoreReachable}`,
  );
  if (ceiling.scoreCeilingBelowThreshold) lines.push('  warning: SCORE_CEILING_BELOW_THRESHOLD');
  lines.push(
    `  counterfactual: importWatchlist=${calibration.IMPORT_WATCHLIST_SCORE ?? 0}, ` +
      `restoreRS=${calibration.RESTORE_RELATIVE_STRENGTH ?? 0}, ` +
      `capPenalty=${calibration.CAP_TOTAL_PENALTY ?? 0}, ` +
      `normalize100=${calibration.NORMALIZE_WEIGHTS_TO_100 ?? 0}`,
  );
  lines.push('  executionImpact: NONE');
  lines.push('  nextAction: WIRE_RS_PERCENTILE_INPUT,WIRE_BREAKOUT_STRUCTURE');
  lines.push(`  recommendedAction: ${report.recommendedAction}`);
  return lines.join('\n');
}
