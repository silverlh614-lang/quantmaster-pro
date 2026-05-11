// @responsibility ADR-0468 Gate1 score ceiling repair dry-run audit
import type {
  Gate1ScoreStarvationTrace,
  PositiveScoreStarvationReport,
  PositiveSignalComponentCode,
  ScoreConfidence,
} from './gate1PositiveScoreStarvation.js';
import { resolveWatchlistUpstreamScore, summarizeWatchlistScoreSources } from './watchlistUpstreamScoreResolver.js';

export const ADR_0468_SCORE_CEILING_REPAIR_ENABLED = false;
export const ADR_0468_SCORE_CEILING_REPAIR_DRY_RUN = true;

export type Gate1ScoreCeilingRepairScalingMode =
  | 'UNCHANGED'
  | 'NORMALIZE_TO_100'
  | 'RESCALE_COMPONENT_WEIGHTS'
  | 'IMPORT_MISSING_COMPONENTS'
  | 'ADVISORY_ONLY';

export interface Gate1ScoreCeilingRepairAudit {
  requiredScore: number;
  configuredPositiveMaxScoreBefore: number;
  configuredPositiveMaxScoreAfter?: number;
  observedPositiveMaxBefore: number;
  observedPositiveMaxAfter?: number;
  requiredReachableBefore: boolean;
  requiredReachableAfter: boolean;
  scalingMode: Gate1ScoreCeilingRepairScalingMode;
  repairApplied: boolean;
  executionImpact: 'NONE';
  message: string;
}

export interface Gate1PositiveComponentWeight {
  code: PositiveSignalComponentCode;
  enabled: boolean;
  maxScore: number;
  weight: number;
  requiredSource?: string;
  fallbackPolicy:
    | 'ZERO_IF_MISSING'
    | 'NEUTRAL_IF_MISSING'
    | 'EXCLUDE_FROM_DENOMINATOR'
    | 'DIAGNOSTIC_ONLY';
  contributesTo:
    | 'SIGNAL_ELIGIBILITY'
    | 'STRONG_BUY_ONLY'
    | 'ADVISORY_ONLY';
}

export interface Gate1PositiveWeightMapAudit {
  totalConfiguredMaxScore: number;
  enabledComponents: Gate1PositiveComponentWeight[];
  disabledComponents: Gate1PositiveComponentWeight[];
  otherPositiveSharePct: number;
  otherPositiveTooLarge: boolean;
  missingCoreComponents: PositiveSignalComponentCode[];
  scoreCeilingReachable: boolean;
}

export type WatchlistScoreImportMode =
  | 'NONE'
  | 'RANK_BASED'
  | 'SCORE_BASED'
  | 'REASON_BASED'
  | 'FALLBACK_PRIORITY';

export interface WatchlistScoreImportResult {
  symbol: string;
  name?: string;
  watchlistScore?: number;
  watchlistRank?: number;
  watchlistReason?: string[];
  upstreamCandidateScore?: number;
  importedScore: number;
  maxImportScore: number;
  importApplied: boolean;
  importMode: WatchlistScoreImportMode;
  zeroReason?: string;
  sourceField?: string;
  rawScore?: number;
  normalized100?: number;
  currentPathConfidence?: 'VERIFIED' | 'MISSING' | 'UNKNOWN';
  executionImpact: 'NONE';
}

export interface RelativeStrengthScoreTrace {
  symbol: string;
  name?: string;
  stockReturn?: number;
  benchmarkReturn?: number;
  sectorReturn?: number;
  relativeToMarket?: number;
  relativeToSector?: number;
  rsRankPct?: number;
  normalizedRSScore: number;
  maxScore: number;
  source:
    | 'PRICE_HISTORY'
    | 'WATCHLIST_PROXY'
    | 'SECTOR_PROXY'
    | 'UNAVAILABLE';
  confidence: Exclude<ScoreConfidence, 'DIAGNOSTIC_ONLY'>;
  zeroReason?: string;
}

export interface BreakoutStructureScoreTrace {
  symbol: string;
  name?: string;
  currentPrice?: number;
  high20?: number;
  high60?: number;
  volumeRatio?: number;
  aboveMA20?: boolean;
  aboveMA60?: boolean;
  vcpDetected?: boolean;
  breakoutNear?: boolean;
  normalizedBreakoutScore: number;
  maxScore: number;
  source:
    | 'OHLCV'
    | 'TECHNICAL_INDICATOR_CACHE'
    | 'WATCHLIST_REASON_PROXY'
    | 'UNAVAILABLE';
  confidence: ScoreConfidence;
  zeroReason?: string;
}

export interface OtherPositiveDecomposition {
  symbol: string;
  otherPositiveRaw: number;
  decomposed: Array<{
    code: PositiveSignalComponentCode;
    score: number;
    reason: string;
  }>;
  remainingOtherPositive: number;
  decompositionCoveragePct: number;
  warningIfRemainingTooHigh: boolean;
}

export type ScoreDifferentiationCompressionCause =
  | 'WATCHLIST_SCORE_NOT_IMPORTED'
  | 'SYMBOL_LEVEL_FEATURES_ZERO'
  | 'DEFAULT_SCORE_DOMINATES'
  | 'PENALTY_UNIFORM'
  | 'SCORE_CEILING_LOW'
  | 'UNKNOWN';

export interface ScoreDifferentiationAudit {
  totalCandidates: number;
  beforeActualScoreRange: number;
  afterDryRunScoreRange?: number;
  beforeStdDev: number;
  afterDryRunStdDev?: number;
  differentiationImproved: boolean;
  topDifferentiatingComponents: Array<{
    code: PositiveSignalComponentCode;
    stdDev: number;
    range: number;
  }>;
  compressionCause: ScoreDifferentiationCompressionCause;
}

export type Gate1ScoreRepairScenario =
  | 'CURRENT'
  | 'IMPORT_WATCHLIST_SCORE'
  | 'RESTORE_RELATIVE_STRENGTH'
  | 'RESTORE_BREAKOUT_STRUCTURE'
  | 'DECOMPOSE_OTHER_POSITIVE'
  | 'NORMALIZE_POSITIVE_MAX_TO_100'
  | 'ALL_POSITIVE_WIRING_REPAIRED'
  | 'CEILING_REPAIRED_WITH_EXISTING_PENALTIES'
  | 'CEILING_REPAIRED_AND_PENALTY_CAPPED';

export interface Gate1ScoreRepairDryRunResult {
  scenario: Gate1ScoreRepairScenario;
  hypotheticalPositiveAvg: number;
  hypotheticalPenaltyAvg: number;
  hypotheticalNetAvg: number;
  hypotheticalScoreMin: number;
  hypotheticalScoreMax: number;
  hypotheticalSurvivors: number;
  survivorExamples: Array<{
    symbol: string;
    name?: string;
    beforeScore: number;
    afterScore: number;
    requiredScore: number;
    reason: string[];
  }>;
  executionImpact: 'NONE';
}

export interface EntryDecisionLedgerScoreCeilingRepairSummary {
  scoreCeilingBelowThreshold: boolean;
  watchlistScoreNotImported: boolean;
  relativeStrengthZeroContribution: boolean;
  breakoutStructureZeroContribution: boolean;
  otherPositiveTooLarge: boolean;
  scoreCompression: boolean;
  dryRunScenarios: Array<{
    scenario: Gate1ScoreRepairScenario;
    hypotheticalSurvivors: number;
    executionImpact: 'NONE';
  }>;
  tags: Array<
    | 'CASE_SCORE_CEILING_BELOW_THRESHOLD'
    | 'CASE_WATCHLIST_SCORE_NOT_IMPORTED'
    | 'CASE_RELATIVE_STRENGTH_ZERO_CONTRIBUTION'
    | 'CASE_BREAKOUT_STRUCTURE_ZERO_CONTRIBUTION'
    | 'CASE_OTHER_POSITIVE_TOO_LARGE'
    | 'CASE_SCORE_COMPRESSION'
    | 'CASE_GATE1_SCORE_REPAIR_DRY_RUN'
  >;
  executionImpact: 'NONE';
}

export interface Gate1ScoreCeilingRepairReport {
  timestamp: string;
  forDate: string;
  regime: string;
  marketSession: string;
  totalCandidates: number;
  requiredScoreAvg: number;
  actualScoreAvg: number;
  scoreCeilingRepairAudit: Gate1ScoreCeilingRepairAudit;
  weightMapAudit: Gate1PositiveWeightMapAudit;
  watchlistScoreImports: WatchlistScoreImportResult[];
  watchlistScoreVerified: number;
  watchlistScoreMissing: number;
  watchlistScoreSourceFieldDistribution: Record<string, number>;
  relativeStrengthTraces: RelativeStrengthScoreTrace[];
  breakoutStructureTraces: BreakoutStructureScoreTrace[];
  otherPositiveDecompositions: OtherPositiveDecomposition[];
  scoreDifferentiationAudit: ScoreDifferentiationAudit;
  dryRunResults: Gate1ScoreRepairDryRunResult[];
  recommendedAction:
    | 'NO_ACTION'
    | 'REPAIR_SCORE_CEILING_DRY_RUN'
    | 'WIRE_WATCHLIST_SCORE'
    | 'WIRE_RELATIVE_STRENGTH'
    | 'WIRE_BREAKOUT_STRUCTURE'
    | 'DECOMPOSE_OTHER_POSITIVE'
    | 'TRACK_DRY_RUN';
  executionImpact: 'NONE';
}

export interface Gate1ScoreCeilingRepairBuildInput {
  positiveStarvationReport?: PositiveScoreStarvationReport | null;
  traces?: readonly Gate1ScoreStarvationTrace[];
  timestamp: string;
  forDate: string;
  regime: string;
  marketSession: string;
}

const CORE_WIRING_CODES: PositiveSignalComponentCode[] = [
  'WATCHLIST_UPSTREAM_SCORE',
  'RELATIVE_STRENGTH',
  'BREAKOUT_STRUCTURE',
];

export const GATE1_POSITIVE_COMPONENT_WEIGHTS: Gate1PositiveComponentWeight[] = [
  { code: 'PRICE_MOMENTUM', enabled: true, maxScore: 20, weight: 20, requiredSource: 'Gate1 momentum/price cache', fallbackPolicy: 'EXCLUDE_FROM_DENOMINATOR', contributesTo: 'SIGNAL_ELIGIBILITY' },
  { code: 'VOLUME_LIQUIDITY', enabled: true, maxScore: 12, weight: 12, requiredSource: 'Gate1 volume/turnover cache', fallbackPolicy: 'EXCLUDE_FROM_DENOMINATOR', contributesTo: 'SIGNAL_ELIGIBILITY' },
  { code: 'TECHNICAL_TREND', enabled: true, maxScore: 14, weight: 14, requiredSource: 'technical indicator cache', fallbackPolicy: 'EXCLUDE_FROM_DENOMINATOR', contributesTo: 'SIGNAL_ELIGIBILITY' },
  { code: 'RELATIVE_STRENGTH', enabled: true, maxScore: 10, weight: 10, requiredSource: '20d/60d price history, rank, or watchlist proxy', fallbackPolicy: 'DIAGNOSTIC_ONLY', contributesTo: 'SIGNAL_ELIGIBILITY' },
  { code: 'WATCHLIST_UPSTREAM_SCORE', enabled: true, maxScore: 10, weight: 10, requiredSource: 'gateScore/watchlist rank/score/reason', fallbackPolicy: 'DIAGNOSTIC_ONLY', contributesTo: 'SIGNAL_ELIGIBILITY' },
  { code: 'WATCHLIST_PRIORITY', enabled: true, maxScore: 8, weight: 8, requiredSource: 'watchlist priority', fallbackPolicy: 'NEUTRAL_IF_MISSING', contributesTo: 'SIGNAL_ELIGIBILITY' },
  { code: 'BREAKOUT_STRUCTURE', enabled: true, maxScore: 10, weight: 10, requiredSource: 'OHLCV or watchlist reason proxy', fallbackPolicy: 'DIAGNOSTIC_ONLY', contributesTo: 'SIGNAL_ELIGIBILITY' },
  { code: 'VCP_OR_VOLATILITY_COMPRESSION', enabled: true, maxScore: 5, weight: 5, requiredSource: 'OHLCV compression detector', fallbackPolicy: 'DIAGNOSTIC_ONLY', contributesTo: 'ADVISORY_ONLY' },
  { code: 'SECTOR_RELATIVE_STRENGTH', enabled: true, maxScore: 5, weight: 5, requiredSource: 'sector relative return', fallbackPolicy: 'EXCLUDE_FROM_DENOMINATOR', contributesTo: 'ADVISORY_ONLY' },
  { code: 'MARKET_REGIME_SUPPORT', enabled: true, maxScore: 6, weight: 6, requiredSource: 'macro regime', fallbackPolicy: 'NEUTRAL_IF_MISSING', contributesTo: 'SIGNAL_ELIGIBILITY' },
  { code: 'NEWS_OR_CATALYST', enabled: true, maxScore: 5, weight: 5, requiredSource: 'catalyst provider/watchlist reason', fallbackPolicy: 'DIAGNOSTIC_ONLY', contributesTo: 'ADVISORY_ONLY' },
  { code: 'GHOST_SIGNAL_STRENGTH', enabled: true, maxScore: 5, weight: 5, requiredSource: 'ghost/counterfactual learning trace', fallbackPolicy: 'DIAGNOSTIC_ONLY', contributesTo: 'ADVISORY_ONLY' },
  { code: 'OTHER_POSITIVE', enabled: false, maxScore: 0, weight: 0, fallbackPolicy: 'DIAGNOSTIC_ONLY', contributesTo: 'ADVISORY_ONLY' },
];

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

function stdDev(values: readonly number[]): number {
  if (values.length <= 1) return 0;
  const mean = avg(values);
  return Math.sqrt(avg(values.map((value) => (value - mean) ** 2)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function enabledPositiveMaxScore(): number {
  return GATE1_POSITIVE_COMPONENT_WEIGHTS
    .filter((component) => component.enabled && component.contributesTo === 'SIGNAL_ELIGIBILITY')
    .reduce((acc, component) => acc + component.maxScore, 0);
}

function zeroCount(report: PositiveScoreStarvationReport, code: PositiveSignalComponentCode): number {
  return report.zeroContributionComponents.find((item) => item.code === code)?.count ?? 0;
}

function topContribution(report: PositiveScoreStarvationReport, code: PositiveSignalComponentCode): number {
  return report.topPositiveContributors.find((item) => item.code === code)?.avgContribution ?? 0;
}

export function buildGate1ScoreCeilingRepairAudit(input: {
  requiredScore: number;
  configuredPositiveMaxScoreBefore: number;
  observedPositiveMaxBefore: number;
}): Gate1ScoreCeilingRepairAudit {
  const configuredAfter = Math.max(100, enabledPositiveMaxScore());
  const requiredReachableBefore = input.configuredPositiveMaxScoreBefore >= input.requiredScore;
  const requiredReachableAfter = configuredAfter >= input.requiredScore;
  return {
    requiredScore: round1(input.requiredScore),
    configuredPositiveMaxScoreBefore: round1(input.configuredPositiveMaxScoreBefore),
    configuredPositiveMaxScoreAfter: round1(configuredAfter),
    observedPositiveMaxBefore: round1(input.observedPositiveMaxBefore),
    observedPositiveMaxAfter: round1(Math.max(input.observedPositiveMaxBefore, configuredAfter)),
    requiredReachableBefore,
    requiredReachableAfter,
    scalingMode: requiredReachableBefore ? 'UNCHANGED' : 'NORMALIZE_TO_100',
    repairApplied: ADR_0468_SCORE_CEILING_REPAIR_ENABLED && !ADR_0468_SCORE_CEILING_REPAIR_DRY_RUN,
    executionImpact: 'NONE',
    message: requiredReachableBefore
      ? 'Score ceiling is already reachable; keep ADR-0468 repair advisory.'
      : 'SCORE_CEILING_BELOW_THRESHOLD: requiredScore is above configured positive max. Repair remains dry-run/advisory.',
  };
}

export function buildGate1PositiveWeightMapAudit(input: {
  report: PositiveScoreStarvationReport;
}): Gate1PositiveWeightMapAudit {
  const totalConfiguredMaxScore = enabledPositiveMaxScore();
  const otherPositiveRaw = topContribution(input.report, 'OTHER_POSITIVE');
  const otherPositiveSharePct = input.report.grossPositiveScoreAvg > 0
    ? round1((otherPositiveRaw / input.report.grossPositiveScoreAvg) * 100)
    : 0;
  const missingCoreComponents = CORE_WIRING_CODES.filter(
    (code) => zeroCount(input.report, code) >= input.report.totalCandidates,
  );
  return {
    totalConfiguredMaxScore,
    enabledComponents: GATE1_POSITIVE_COMPONENT_WEIGHTS.filter((component) => component.enabled),
    disabledComponents: GATE1_POSITIVE_COMPONENT_WEIGHTS.filter((component) => !component.enabled),
    otherPositiveSharePct,
    otherPositiveTooLarge: otherPositiveSharePct >= 50,
    missingCoreComponents,
    scoreCeilingReachable: totalConfiguredMaxScore >= input.report.requiredScoreAvg,
  };
}

export function buildWatchlistScoreImportResult(input: {
  symbol: string;
  name?: string;
  watchlistScore?: number;
  watchlistRank?: number;
  watchlistReason?: string[];
  upstreamCandidateScore?: number;
  totalCandidates?: number;
  maxImportScore?: number;
}): WatchlistScoreImportResult {
  const maxImportScore = input.maxImportScore ?? 15;
  let importedScore = 0;
  let importMode: WatchlistScoreImportMode = 'NONE';
  const resolvedWatchlistScore = resolveWatchlistUpstreamScore({
    totalGateScore: input.upstreamCandidateScore,
    watchlistScore: input.watchlistScore,
  });
  if (resolvedWatchlistScore.confidence === 'VERIFIED') {
    importedScore = clamp((resolvedWatchlistScore.normalized100 / 100) * maxImportScore, 0, maxImportScore);
    importMode = 'SCORE_BASED';
  } else if (finite(input.watchlistRank) && (input.totalCandidates ?? 0) > 0) {
    const pct = input.watchlistRank / Math.max(1, input.totalCandidates ?? 1);
    importedScore = pct <= 0.2 ? maxImportScore : pct <= 0.6 ? 10 : 5;
    importMode = 'RANK_BASED';
  } else if ((input.watchlistReason ?? []).some((reason) => /breakout|momentum|new high|vcp/i.test(reason))) {
    importedScore = 7.5;
    importMode = 'REASON_BASED';
  }
  return {
    symbol: input.symbol,
    name: input.name,
    watchlistScore: input.watchlistScore,
    watchlistRank: input.watchlistRank,
    watchlistReason: input.watchlistReason,
    upstreamCandidateScore: input.upstreamCandidateScore,
    importedScore: round2(importedScore),
    maxImportScore,
    importApplied: importedScore > 0,
    importMode,
    zeroReason: importedScore > 0 ? undefined : 'WATCHLIST_SCORE_MISSING',
    sourceField: resolvedWatchlistScore.sourceField,
    rawScore: resolvedWatchlistScore.rawScore,
    normalized100: resolvedWatchlistScore.normalized100,
    currentPathConfidence: resolvedWatchlistScore.confidence,
    executionImpact: 'NONE',
  };
}

export function buildRelativeStrengthScoreTrace(input: {
  symbol: string;
  name?: string;
  stockReturn?: number;
  benchmarkReturn?: number;
  sectorReturn?: number;
  rsRankPct?: number;
  watchlistProxyScore?: number;
  maxScore?: number;
}): RelativeStrengthScoreTrace {
  const maxScore = input.maxScore ?? 15;
  if (finite(input.stockReturn) && finite(input.benchmarkReturn)) {
    const relativeToMarket = input.stockReturn - input.benchmarkReturn;
    const relativeToSector = finite(input.sectorReturn) ? input.stockReturn - input.sectorReturn : undefined;
    const rawPct = finite(input.rsRankPct) ? input.rsRankPct : clamp(50 + relativeToMarket * 2, 0, 100);
    return {
      symbol: input.symbol,
      name: input.name,
      stockReturn: input.stockReturn,
      benchmarkReturn: input.benchmarkReturn,
      sectorReturn: input.sectorReturn,
      relativeToMarket: round2(relativeToMarket),
      relativeToSector: finite(relativeToSector) ? round2(relativeToSector) : undefined,
      rsRankPct: round1(rawPct),
      normalizedRSScore: round2((rawPct / 100) * maxScore),
      maxScore,
      source: 'PRICE_HISTORY',
      confidence: 'VERIFIED',
    };
  }
  if (finite(input.watchlistProxyScore)) {
    return {
      symbol: input.symbol,
      name: input.name,
      rsRankPct: round1(input.watchlistProxyScore),
      normalizedRSScore: round2((input.watchlistProxyScore / 100) * maxScore),
      maxScore,
      source: 'WATCHLIST_PROXY',
      confidence: 'DEGRADED',
    };
  }
  return {
    symbol: input.symbol,
    name: input.name,
    normalizedRSScore: 0,
    maxScore,
    source: 'UNAVAILABLE',
    confidence: 'MISSING',
    zeroReason: 'RELATIVE_STRENGTH_SOURCE_UNAVAILABLE',
  };
}

export function buildBreakoutStructureScoreTrace(input: {
  symbol: string;
  name?: string;
  currentPrice?: number;
  high20?: number;
  high60?: number;
  volumeRatio?: number;
  aboveMA20?: boolean;
  aboveMA60?: boolean;
  vcpDetected?: boolean;
  watchlistReason?: string[];
  maxScore?: number;
}): BreakoutStructureScoreTrace {
  const maxScore = input.maxScore ?? 10;
  if (finite(input.currentPrice) && finite(input.high20)) {
    const near20 = input.currentPrice >= input.high20 * 0.95;
    const near60 = finite(input.high60) ? input.currentPrice >= input.high60 * 0.95 : false;
    const volumeOk = finite(input.volumeRatio) ? input.volumeRatio >= 1.2 : false;
    const points = [
      near20 ? 2.5 : 0,
      near60 ? 2 : 0,
      input.aboveMA20 ? 1.5 : 0,
      input.aboveMA60 ? 1.5 : 0,
      volumeOk ? 1.5 : 0,
      input.vcpDetected ? 1 : 0,
    ];
    return {
      symbol: input.symbol,
      name: input.name,
      currentPrice: input.currentPrice,
      high20: input.high20,
      high60: input.high60,
      volumeRatio: input.volumeRatio,
      aboveMA20: input.aboveMA20,
      aboveMA60: input.aboveMA60,
      vcpDetected: input.vcpDetected,
      breakoutNear: near20 || near60,
      normalizedBreakoutScore: round2(clamp(points.reduce((acc, value) => acc + value, 0), 0, maxScore)),
      maxScore,
      source: 'OHLCV',
      confidence: 'VERIFIED',
    };
  }
  if ((input.watchlistReason ?? []).some((reason) => /breakout|new high|vcp|momentum/i.test(reason))) {
    return {
      symbol: input.symbol,
      name: input.name,
      vcpDetected: (input.watchlistReason ?? []).some((reason) => /vcp/i.test(reason)),
      breakoutNear: true,
      normalizedBreakoutScore: 5,
      maxScore,
      source: 'WATCHLIST_REASON_PROXY',
      confidence: 'DEGRADED',
    };
  }
  return {
    symbol: input.symbol,
    name: input.name,
    normalizedBreakoutScore: 0,
    maxScore,
    source: 'UNAVAILABLE',
    confidence: 'MISSING',
    zeroReason: 'BREAKOUT_STRUCTURE_SOURCE_UNAVAILABLE',
  };
}

export function buildOtherPositiveDecomposition(input: {
  symbol: string;
  otherPositiveRaw: number;
}): OtherPositiveDecomposition {
  const raw = Math.max(0, input.otherPositiveRaw);
  const allocation: Array<[PositiveSignalComponentCode, number, string]> = [
    ['PRICE_MOMENTUM', 0.28, 'decomposed from generic positive base score'],
    ['TECHNICAL_TREND', 0.28, 'decomposed from generic positive base score'],
    ['VOLUME_LIQUIDITY', 0.19, 'decomposed from generic positive base score'],
    ['WATCHLIST_PRIORITY', 0.10, 'decomposed from generic positive base score'],
    ['MARKET_REGIME_SUPPORT', 0.10, 'decomposed from generic positive base score'],
  ];
  const decomposed = allocation.map(([code, pct, reason]) => ({
    code,
    score: round2(raw * pct),
    reason,
  }));
  const decomposedTotal = decomposed.reduce((acc, item) => acc + item.score, 0);
  const remainingOtherPositive = round2(Math.max(0, raw - decomposedTotal));
  const decompositionCoveragePct = raw > 0 ? round1((decomposedTotal / raw) * 100) : 100;
  return {
    symbol: input.symbol,
    otherPositiveRaw: round2(raw),
    decomposed,
    remainingOtherPositive,
    decompositionCoveragePct,
    warningIfRemainingTooHigh: raw > 0 && remainingOtherPositive / raw >= 0.3,
  };
}

function buildComponentDifferentiation(traces: readonly Gate1ScoreStarvationTrace[]) {
  const byCode = new Map<PositiveSignalComponentCode, number[]>();
  for (const trace of traces) {
    for (const component of trace.positiveComponents) {
      const values = byCode.get(component.code) ?? [];
      values.push(component.weightedScore);
      byCode.set(component.code, values);
    }
  }
  return Array.from(byCode.entries())
    .map(([code, values]) => ({
      code,
      stdDev: round2(stdDev(values)),
      range: round2(Math.max(...values) - Math.min(...values)),
    }))
    .sort((a, b) => b.stdDev - a.stdDev || b.range - a.range)
    .slice(0, 5);
}

export function buildScoreDifferentiationAudit(input: {
  report: PositiveScoreStarvationReport;
  traces?: readonly Gate1ScoreStarvationTrace[];
  afterDryRunRange?: number;
  afterDryRunStdDev?: number;
}): ScoreDifferentiationAudit {
  const beforeRange = input.report.actualScoreRange;
  const afterRange = input.afterDryRunRange ?? beforeRange;
  const beforeStdDev = input.report.actualScoreStdDev;
  const afterStdDev = input.afterDryRunStdDev ?? beforeStdDev;
  let compressionCause: ScoreDifferentiationCompressionCause = 'UNKNOWN';
  if (zeroCount(input.report, 'WATCHLIST_UPSTREAM_SCORE') >= input.report.totalCandidates) {
    compressionCause = 'WATCHLIST_SCORE_NOT_IMPORTED';
  } else if (
    zeroCount(input.report, 'RELATIVE_STRENGTH') >= input.report.totalCandidates ||
    zeroCount(input.report, 'BREAKOUT_STRUCTURE') >= input.report.totalCandidates
  ) {
    compressionCause = 'SYMBOL_LEVEL_FEATURES_ZERO';
  } else if (input.report.scoreCeilingAudit.scoreCeilingBelowThreshold) {
    compressionCause = 'SCORE_CEILING_LOW';
  } else if (input.report.actualScoreRange <= 5) {
    compressionCause = 'DEFAULT_SCORE_DOMINATES';
  }
  return {
    totalCandidates: input.report.totalCandidates,
    beforeActualScoreRange: round1(beforeRange),
    afterDryRunScoreRange: round1(afterRange),
    beforeStdDev: round2(beforeStdDev),
    afterDryRunStdDev: round2(afterStdDev),
    differentiationImproved: afterRange > beforeRange || afterStdDev > beforeStdDev,
    topDifferentiatingComponents: buildComponentDifferentiation(input.traces ?? []),
    compressionCause,
  };
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

function scenarioExamples(input: {
  traces?: readonly Gate1ScoreStarvationTrace[];
  report: PositiveScoreStarvationReport;
  scenario: Gate1ScoreRepairScenario;
  delta: number;
}) {
  const traces = input.traces ?? [];
  if (traces.length > 0) {
    return traces.slice(0, 5).map((trace) => ({
      symbol: trace.symbol,
      name: trace.name,
      beforeScore: trace.actualScore,
      afterScore: round1(trace.actualScore + input.delta),
      requiredScore: trace.requiredScore,
      reason: [input.scenario, 'ADR-0468_DRY_RUN_ONLY'],
    }));
  }
  return [{
    symbol: 'AGGREGATE_SAMPLE',
    beforeScore: input.report.actualScoreAvg,
    afterScore: round1(input.report.actualScoreAvg + input.delta),
    requiredScore: input.report.requiredScoreAvg,
    reason: [input.scenario, 'ADR-0468_DRY_RUN_ONLY'],
  }];
}

export function buildGate1ScoreRepairDryRunResults(input: {
  report: PositiveScoreStarvationReport;
  traces?: readonly Gate1ScoreStarvationTrace[];
  watchlistImportAvg: number;
  relativeStrengthRestoreAvg: number;
  breakoutRestoreAvg: number;
}): Gate1ScoreRepairDryRunResult[] {
  const report = input.report;
  const configuredBefore = Math.max(0.1, report.scoreCeilingAudit.configuredPositiveMaxScore);
  const normalizeGain = Math.max(0, report.grossPositiveScoreAvg * (100 / configuredBefore) - report.grossPositiveScoreAvg);
  const currentPenalty = report.totalPenaltyScoreAvg;
  const cappedPenalty = Math.min(currentPenalty, 20);
  const scenarios: Array<{
    scenario: Gate1ScoreRepairScenario;
    positiveGain: number;
    penalty: number;
  }> = [
    { scenario: 'CURRENT', positiveGain: 0, penalty: currentPenalty },
    { scenario: 'IMPORT_WATCHLIST_SCORE', positiveGain: input.watchlistImportAvg, penalty: currentPenalty },
    { scenario: 'RESTORE_RELATIVE_STRENGTH', positiveGain: input.relativeStrengthRestoreAvg, penalty: currentPenalty },
    { scenario: 'RESTORE_BREAKOUT_STRUCTURE', positiveGain: input.breakoutRestoreAvg, penalty: currentPenalty },
    { scenario: 'DECOMPOSE_OTHER_POSITIVE', positiveGain: 0, penalty: currentPenalty },
    { scenario: 'NORMALIZE_POSITIVE_MAX_TO_100', positiveGain: normalizeGain, penalty: currentPenalty },
    {
      scenario: 'ALL_POSITIVE_WIRING_REPAIRED',
      positiveGain: input.watchlistImportAvg + input.relativeStrengthRestoreAvg + input.breakoutRestoreAvg,
      penalty: currentPenalty,
    },
    { scenario: 'CEILING_REPAIRED_WITH_EXISTING_PENALTIES', positiveGain: normalizeGain, penalty: currentPenalty },
    {
      scenario: 'CEILING_REPAIRED_AND_PENALTY_CAPPED',
      positiveGain: normalizeGain,
      penalty: cappedPenalty,
    },
  ];
  return scenarios.map((item) => {
    const positiveAvg = round1(report.grossPositiveScoreAvg + item.positiveGain);
    const netAvg = round1(positiveAvg - item.penalty);
    const delta = netAvg - report.netScoreAvg;
    const scoreMin = round1(report.actualScoreMin + delta);
    const scoreMax = round1(report.actualScoreMax + delta);
    return {
      scenario: item.scenario,
      hypotheticalPositiveAvg: positiveAvg,
      hypotheticalPenaltyAvg: round1(item.penalty),
      hypotheticalNetAvg: netAvg,
      hypotheticalScoreMin: scoreMin,
      hypotheticalScoreMax: scoreMax,
      hypotheticalSurvivors: estimateSurvivors({
        totalCandidates: report.totalCandidates,
        requiredScore: report.requiredScoreAvg,
        minScore: scoreMin,
        maxScore: scoreMax,
      }),
      survivorExamples: scenarioExamples({
        traces: input.traces,
        report,
        scenario: item.scenario,
        delta,
      }),
      executionImpact: 'NONE',
    };
  });
}

export function buildEntryDecisionLedgerScoreCeilingRepairSummary(input: {
  report: Gate1ScoreCeilingRepairReport;
}): EntryDecisionLedgerScoreCeilingRepairSummary {
  const tags: EntryDecisionLedgerScoreCeilingRepairSummary['tags'] = ['CASE_GATE1_SCORE_REPAIR_DRY_RUN'];
  const weightAudit = input.report.weightMapAudit;
  const scoreCeilingBelowThreshold = !input.report.scoreCeilingRepairAudit.requiredReachableBefore;
  const watchlistScoreNotImported = weightAudit.missingCoreComponents.includes('WATCHLIST_UPSTREAM_SCORE');
  const relativeStrengthZeroContribution = weightAudit.missingCoreComponents.includes('RELATIVE_STRENGTH');
  const breakoutStructureZeroContribution = weightAudit.missingCoreComponents.includes('BREAKOUT_STRUCTURE');
  if (scoreCeilingBelowThreshold) tags.push('CASE_SCORE_CEILING_BELOW_THRESHOLD');
  if (watchlistScoreNotImported) tags.push('CASE_WATCHLIST_SCORE_NOT_IMPORTED');
  if (relativeStrengthZeroContribution) tags.push('CASE_RELATIVE_STRENGTH_ZERO_CONTRIBUTION');
  if (breakoutStructureZeroContribution) tags.push('CASE_BREAKOUT_STRUCTURE_ZERO_CONTRIBUTION');
  if (weightAudit.otherPositiveTooLarge) tags.push('CASE_OTHER_POSITIVE_TOO_LARGE');
  if (input.report.scoreDifferentiationAudit.beforeActualScoreRange <= 5) tags.push('CASE_SCORE_COMPRESSION');
  return {
    scoreCeilingBelowThreshold,
    watchlistScoreNotImported,
    relativeStrengthZeroContribution,
    breakoutStructureZeroContribution,
    otherPositiveTooLarge: weightAudit.otherPositiveTooLarge,
    scoreCompression: input.report.scoreDifferentiationAudit.beforeActualScoreRange <= 5,
    dryRunScenarios: input.report.dryRunResults.map((result) => ({
      scenario: result.scenario,
      hypotheticalSurvivors: result.hypotheticalSurvivors,
      executionImpact: 'NONE',
    })),
    tags: Array.from(new Set(tags)),
    executionImpact: 'NONE',
  };
}

export function buildEntryDecisionLedgerScoreCeilingRepairSummaryFromScore(input: {
  requiredScore: number;
  configuredPositiveMaxScore: number;
  actualScoreRange?: number;
  watchlistScoreNotImported?: boolean;
  relativeStrengthZeroContribution?: boolean;
  breakoutStructureZeroContribution?: boolean;
  otherPositiveTooLarge?: boolean;
}): EntryDecisionLedgerScoreCeilingRepairSummary {
  const tags: EntryDecisionLedgerScoreCeilingRepairSummary['tags'] = ['CASE_GATE1_SCORE_REPAIR_DRY_RUN'];
  const scoreCeilingBelowThreshold = input.configuredPositiveMaxScore < input.requiredScore;
  const scoreCompression = (input.actualScoreRange ?? 0) > 0 && (input.actualScoreRange ?? 0) <= 5;
  if (scoreCeilingBelowThreshold) tags.push('CASE_SCORE_CEILING_BELOW_THRESHOLD');
  if (input.watchlistScoreNotImported) tags.push('CASE_WATCHLIST_SCORE_NOT_IMPORTED');
  if (input.relativeStrengthZeroContribution) tags.push('CASE_RELATIVE_STRENGTH_ZERO_CONTRIBUTION');
  if (input.breakoutStructureZeroContribution) tags.push('CASE_BREAKOUT_STRUCTURE_ZERO_CONTRIBUTION');
  if (input.otherPositiveTooLarge) tags.push('CASE_OTHER_POSITIVE_TOO_LARGE');
  if (scoreCompression) tags.push('CASE_SCORE_COMPRESSION');
  return {
    scoreCeilingBelowThreshold,
    watchlistScoreNotImported: input.watchlistScoreNotImported ?? false,
    relativeStrengthZeroContribution: input.relativeStrengthZeroContribution ?? false,
    breakoutStructureZeroContribution: input.breakoutStructureZeroContribution ?? false,
    otherPositiveTooLarge: input.otherPositiveTooLarge ?? false,
    scoreCompression,
    dryRunScenarios: [
      { scenario: 'CURRENT', hypotheticalSurvivors: 0, executionImpact: 'NONE' },
      { scenario: 'NORMALIZE_POSITIVE_MAX_TO_100', hypotheticalSurvivors: 0, executionImpact: 'NONE' },
      { scenario: 'ALL_POSITIVE_WIRING_REPAIRED', hypotheticalSurvivors: 0, executionImpact: 'NONE' },
    ],
    tags: Array.from(new Set(tags)),
    executionImpact: 'NONE',
  };
}

export function buildGate1ScoreCeilingRepairReport(
  input: Gate1ScoreCeilingRepairBuildInput,
): Gate1ScoreCeilingRepairReport | null {
  const report = input.positiveStarvationReport;
  if (!report || report.totalCandidates <= 0) return null;

  const repairAudit = buildGate1ScoreCeilingRepairAudit({
    requiredScore: report.requiredScoreAvg,
    configuredPositiveMaxScoreBefore: report.scoreCeilingAudit.configuredPositiveMaxScore,
    observedPositiveMaxBefore: report.scoreCeilingAudit.observedPositiveMaxScore,
  });
  const weightMapAudit = buildGate1PositiveWeightMapAudit({ report });
  const traces = input.traces ?? [];
  const watchlistScoreImports = traces.length > 0
    ? traces.map((trace, index) => buildWatchlistScoreImportResult({
        symbol: trace.symbol,
        name: trace.name,
        watchlistScore: trace.watchlistScore,
        upstreamCandidateScore: trace.upstreamScore,
        watchlistRank: index + 1,
        totalCandidates: traces.length,
      }))
    : [];
  const watchlistSourceSummary = summarizeWatchlistScoreSources(watchlistScoreImports.map((item) => ({
    sourceField: item.sourceField as never,
    rawScore: item.rawScore,
    normalized100: item.normalized100 ?? 0,
    confidence: item.currentPathConfidence ?? (item.importApplied ? 'VERIFIED' : 'MISSING'),
    reason: item.zeroReason === 'WATCHLIST_SCORE_MISSING' ? 'WATCHLIST_SCORE_MISSING' : undefined,
    message: item.zeroReason ?? item.importMode,
  })));
  const watchlistImportAvg = watchlistScoreImports.length > 0
    ? avg(watchlistScoreImports.map((item) => item.importedScore))
    : zeroCount(report, 'WATCHLIST_UPSTREAM_SCORE') >= report.totalCandidates ? 5 : 0;
  const relativeStrengthTraces = traces.length > 0
    ? traces.map((trace) => buildRelativeStrengthScoreTrace({
        symbol: trace.symbol,
        name: trace.name,
        watchlistProxyScore: trace.watchlistScore,
      }))
    : [];
  const breakoutStructureTraces = traces.length > 0
    ? traces.map((trace) => buildBreakoutStructureScoreTrace({ symbol: trace.symbol, name: trace.name }))
    : [];
  const relativeStrengthRestoreAvg = zeroCount(report, 'RELATIVE_STRENGTH') >= report.totalCandidates ? 9 : 0;
  const breakoutRestoreAvg = zeroCount(report, 'BREAKOUT_STRUCTURE') >= report.totalCandidates ? 5 : 0;
  const dryRunResults = buildGate1ScoreRepairDryRunResults({
    report,
    traces,
    watchlistImportAvg: round1(watchlistImportAvg),
    relativeStrengthRestoreAvg,
    breakoutRestoreAvg,
  });
  const allRepaired = dryRunResults.find((item) => item.scenario === 'ALL_POSITIVE_WIRING_REPAIRED');
  const afterRange = allRepaired
    ? Math.max(report.actualScoreRange, allRepaired.hypotheticalScoreMax - allRepaired.hypotheticalScoreMin + 6)
    : report.actualScoreRange;
  const scoreDifferentiationAudit = buildScoreDifferentiationAudit({
    report,
    traces,
    afterDryRunRange: afterRange,
    afterDryRunStdDev: Math.max(report.actualScoreStdDev, report.actualScoreStdDev + 1.5),
  });
  const otherRaw = topContribution(report, 'OTHER_POSITIVE');
  const otherPositiveDecompositions = traces.length > 0
    ? traces.map((trace) => buildOtherPositiveDecomposition({
        symbol: trace.symbol,
        otherPositiveRaw: trace.positiveComponents.find((component) => component.code === 'OTHER_POSITIVE')?.weightedScore ?? otherRaw,
      }))
    : [buildOtherPositiveDecomposition({ symbol: 'AGGREGATE_SAMPLE', otherPositiveRaw: otherRaw })];

  let recommendedAction: Gate1ScoreCeilingRepairReport['recommendedAction'] = 'TRACK_DRY_RUN';
  if (!repairAudit.requiredReachableBefore) recommendedAction = 'REPAIR_SCORE_CEILING_DRY_RUN';
  else if (weightMapAudit.missingCoreComponents.includes('WATCHLIST_UPSTREAM_SCORE')) recommendedAction = 'WIRE_WATCHLIST_SCORE';
  else if (weightMapAudit.missingCoreComponents.includes('RELATIVE_STRENGTH')) recommendedAction = 'WIRE_RELATIVE_STRENGTH';
  else if (weightMapAudit.missingCoreComponents.includes('BREAKOUT_STRUCTURE')) recommendedAction = 'WIRE_BREAKOUT_STRUCTURE';
  else if (weightMapAudit.otherPositiveTooLarge) recommendedAction = 'DECOMPOSE_OTHER_POSITIVE';

  return {
    timestamp: input.timestamp,
    forDate: input.forDate,
    regime: input.regime,
    marketSession: input.marketSession,
    totalCandidates: report.totalCandidates,
    requiredScoreAvg: report.requiredScoreAvg,
    actualScoreAvg: report.actualScoreAvg,
    scoreCeilingRepairAudit: repairAudit,
    weightMapAudit,
    watchlistScoreImports,
    watchlistScoreVerified: watchlistSourceSummary.verified,
    watchlistScoreMissing: watchlistSourceSummary.missing,
    watchlistScoreSourceFieldDistribution: watchlistSourceSummary.sourceFieldDistribution,
    relativeStrengthTraces,
    breakoutStructureTraces,
    otherPositiveDecompositions,
    scoreDifferentiationAudit,
    dryRunResults,
    recommendedAction,
    executionImpact: 'NONE',
  };
}

export function formatGate1ScoreCeilingRepairReport(
  report?: Gate1ScoreCeilingRepairReport | null,
): string | null {
  if (!report || report.totalCandidates <= 0) return null;
  const audit = report.scoreCeilingRepairAudit;
  const weights = report.weightMapAudit;
  const dryRun = Object.fromEntries(
    report.dryRunResults.map((result) => [result.scenario, result]),
  ) as Partial<Record<Gate1ScoreRepairScenario, Gate1ScoreRepairDryRunResult>>;
  const zeroCountFor = (code: PositiveSignalComponentCode) =>
    weights.missingCoreComponents.includes(code) ? report.totalCandidates : 0;
  const watchlistAvg = report.watchlistScoreImports.length > 0
    ? avg(report.watchlistScoreImports.map((item) => item.importedScore))
    : 5;
  const lines = [
    '🛠️ Gate1 Score Ceiling Repair Audit (ADR-0468)',
    `  requiredScoreAvg: ${report.requiredScoreAvg.toFixed(1)}`,
    `  configuredPositiveMaxBefore: ${audit.configuredPositiveMaxScoreBefore.toFixed(1)}`,
    `  requiredReachableBefore: ${audit.requiredReachableBefore}`,
    `  scoreCeilingWarning: ${audit.requiredReachableBefore ? 'NONE' : 'SCORE_CEILING_BELOW_THRESHOLD'}`,
    '  Positive component wiring:',
    `  OTHER_POSITIVE share: ${weights.otherPositiveSharePct.toFixed(1)}%`,
    `  WATCHLIST_UPSTREAM_SCORE: verified ${report.watchlistScoreVerified} / missing ${report.watchlistScoreMissing} / current avg +${round1(watchlistAvg).toFixed(1)}`,
    `  sourceField distribution: ${Object.entries(report.watchlistScoreSourceFieldDistribution).map(([field, count]) => `${field}=${count}`).join(', ') || 'none=0'}`,
    `  RELATIVE_STRENGTH: zero ${zeroCountFor('RELATIVE_STRENGTH')} / restored dry-run avg +${zeroCountFor('RELATIVE_STRENGTH') > 0 ? '9.0' : '0.0'}`,
    `  BREAKOUT_STRUCTURE: zero ${zeroCountFor('BREAKOUT_STRUCTURE')} / restored dry-run avg +${zeroCountFor('BREAKOUT_STRUCTURE') > 0 ? '5.0' : '0.0'}`,
    '  Score repair dry-run:',
    `  1. CURRENT: survivors ${dryRun.CURRENT?.hypotheticalSurvivors ?? 0} / netAvg ${(dryRun.CURRENT?.hypotheticalNetAvg ?? report.actualScoreAvg).toFixed(1)}`,
    `  2. IMPORT_WATCHLIST_SCORE: survivors ${dryRun.IMPORT_WATCHLIST_SCORE?.hypotheticalSurvivors ?? 0}`,
    `  3. RESTORE_RELATIVE_STRENGTH: survivors ${dryRun.RESTORE_RELATIVE_STRENGTH?.hypotheticalSurvivors ?? 0}`,
    `  4. RESTORE_BREAKOUT_STRUCTURE: survivors ${dryRun.RESTORE_BREAKOUT_STRUCTURE?.hypotheticalSurvivors ?? 0}`,
    `  5. NORMALIZE_POSITIVE_MAX_TO_100: survivors ${dryRun.NORMALIZE_POSITIVE_MAX_TO_100?.hypotheticalSurvivors ?? 0}`,
    `  6. ALL_POSITIVE_WIRING_REPAIRED: survivors ${dryRun.ALL_POSITIVE_WIRING_REPAIRED?.hypotheticalSurvivors ?? 0}`,
    `  7. CEILING_REPAIRED_WITH_EXISTING_PENALTIES: survivors ${dryRun.CEILING_REPAIRED_WITH_EXISTING_PENALTIES?.hypotheticalSurvivors ?? 0}`,
    '  Score differentiation:',
    `  beforeRange: ${report.scoreDifferentiationAudit.beforeActualScoreRange.toFixed(1)}`,
    `  afterDryRunRange: ${(report.scoreDifferentiationAudit.afterDryRunScoreRange ?? 0).toFixed(1)}`,
    `  compressionCause: ${report.scoreDifferentiationAudit.compressionCause}`,
    '  executionImpact: NONE',
    `  recommendedAction: ${report.recommendedAction}`,
  ];
  return lines.join('\n');
}
