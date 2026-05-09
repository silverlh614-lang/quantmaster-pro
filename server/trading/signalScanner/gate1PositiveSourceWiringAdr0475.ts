// @responsibility ADR-0475 Gate1 positive source wiring dry-run SSOT
import type {
  Gate1ScoreStarvationTrace,
  PositiveScoreStarvationReport,
} from './gate1PositiveScoreStarvation.js';
import type { Gate1ScoreCeilingRepairReport } from './gate1ScoreCeilingRepair.js';
import type { PenaltyDeduplicationReport } from './gate1PenaltyDeduplication.js';
import type { RiskDoubleCountAuditReport } from './gate1RiskDoubleCount.js';
import type { Gate1ScoringAlignmentReport } from './gate1ScoringAlignmentAdr0472.js';
import type { NaverInvestorTrendCollectorResult } from './naverInvestorTrendCollectorAdr0481.js';
import type { SemanticNetBuyNormalizationReportAdr0482, SemanticNetBuyProvider } from './semanticNetBuyNormalizerAdr0482.js';

export type Gate1PositiveSourceCode =
  | 'SEMANTIC_NETBUY_ADR0482'
  | 'NAVER_INVESTOR_TREND_ADR0481'
  | 'WATCHLIST_UPSTREAM_SCORE'
  | 'RELATIVE_STRENGTH'
  | 'BREAKOUT_STRUCTURE'
  | 'OTHER_POSITIVE_DECOMPOSITION';

export type Gate1PositiveSourceStatus =
  | 'VERIFIED'
  | 'DEGRADED'
  | 'PROXY'
  | 'MISSING'
  | 'DIAGNOSTIC_ONLY';

export type Gate1PositiveSourcePolicyMode =
  | 'DRY_RUN_ONLY'
  | 'SHADOW_ONLY'
  | 'ADVISORY_ONLY';

export interface WatchlistUpstreamScoreTrace {
  symbol: string;
  name?: string;
  stage2Score?: number;
  watchlistScore?: number;
  watchlistRank?: number;
  watchlistReason?: string[];
  importedScore: number;
  maxScore: number;
  source:
    | 'STAGE2_SCORE'
    | 'WATCHLIST_SCORE'
    | 'WATCHLIST_RANK'
    | 'WATCHLIST_REASON_PROXY'
    | 'UNAVAILABLE';
  status: Gate1PositiveSourceStatus;
  zeroReason?: string;
  executionImpact: 'NONE';
}

export interface RelativeStrengthSourceTrace {
  symbol: string;
  name?: string;
  stockReturn20d?: number;
  stockReturn60d?: number;
  benchmarkReturn20d?: number;
  benchmarkReturn60d?: number;
  sectorReturn20d?: number;
  sectorReturn60d?: number;
  relativeToMarket?: number;
  relativeToSector?: number;
  rsRankPct?: number;
  normalizedRSScore: number;
  maxScore: number;
  source:
    | 'PRICE_HISTORY'
    | 'SECTOR_RELATIVE_RETURN'
    | 'WATCHLIST_PROXY'
    | 'UNAVAILABLE';
  status: Gate1PositiveSourceStatus;
  zeroReason?: string;
  executionImpact: 'NONE';
}

export interface BreakoutStructureSourceTrace {
  symbol: string;
  name?: string;
  currentPrice?: number;
  high20?: number;
  high60?: number;
  high120?: number;
  volumeRatio?: number;
  aboveMA20?: boolean;
  aboveMA60?: boolean;
  newHigh20?: boolean;
  newHigh60?: boolean;
  nearBreakout?: boolean;
  vcpDetected?: boolean;
  normalizedBreakoutScore: number;
  maxScore: number;
  source:
    | 'OHLCV'
    | 'TECHNICAL_CACHE'
    | 'WATCHLIST_REASON_PROXY'
    | 'UNAVAILABLE';
  status: Gate1PositiveSourceStatus;
  zeroReason?: string;
  executionImpact: 'NONE';
}

export interface OtherPositiveDecompositionTrace {
  symbol: string;
  name?: string;
  otherPositiveRaw: number;
  decomposedComponents: Array<{
    code:
      | 'PRICE_MOMENTUM'
      | 'TECHNICAL_TREND'
      | 'VOLUME_LIQUIDITY'
      | 'WATCHLIST_PRIORITY'
      | 'MARKET_REGIME_SUPPORT'
      | 'UNRESOLVED_OTHER';
    score: number;
    reason: string;
  }>;
  remainingOtherPositive: number;
  decompositionCoveragePct: number;
  warningIfRemainingTooHigh: boolean;
  executionImpact: 'NONE';
}

export type Gate1PositiveSourceWiringScenario =
  | 'CURRENT'
  | 'WIRE_WATCHLIST_UPSTREAM_SCORE'
  | 'WIRE_RELATIVE_STRENGTH'
  | 'WIRE_BREAKOUT_STRUCTURE'
  | 'WIRE_WATCHLIST_AND_RS'
  | 'WIRE_WATCHLIST_AND_BREAKOUT'
  | 'WIRE_RS_AND_BREAKOUT'
  | 'WIRE_ALL_POSITIVE_SOURCES'
  | 'WIRE_ALL_PLUS_DEDUP'
  | 'WIRE_ALL_PLUS_DEDUP_PLUS_RISK_SPLIT';

export interface Gate1PositiveSourceWiringScenarioResult {
  scenario: Gate1PositiveSourceWiringScenario;
  positiveScoreAvg: number;
  penaltyAvg: number;
  netScoreAvg: number;
  scoreMin: number;
  scoreMax: number;
  scoreRange: number;
  compressed: boolean;
  requiredScore: number;
  hypotheticalSurvivors: number;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: Gate1PositiveSourcePolicyMode;
}

export interface SemanticNetBuyPositiveSourceTraceAdr0482 {
  sourceCode: 'SEMANTIC_NETBUY_ADR0482';
  code: string;
  provider: SemanticNetBuyProvider | 'NONE';
  status: 'VERIFIED' | 'MISSING' | 'DIAGNOSTIC_ONLY';
  signal: 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'UNKNOWN';
  sourceDate: string | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  foreignNetBuy: number | null;
  institutionNetBuy: number | null;
  programNetBuy: number | null;
  totalSmartMoneyNetBuy: number | null;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'SHADOW_ONLY';
  operatorApprovalRequired: true;
}

export interface NaverInvestorTrendPositiveSourceTraceAdr0481 {
  sourceCode: 'NAVER_INVESTOR_TREND_ADR0481';
  code: string;
  status: 'VERIFIED' | 'MISSING' | 'DIAGNOSTIC_ONLY';
  signal: 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'UNKNOWN';
  sourceDate: string | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  foreignNetBuy: number | null;
  institutionNetBuy: number | null;
  programNetBuy: number | null;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'SHADOW_ONLY';
  operatorApprovalRequired: true;
}

export interface Gate1PositiveSourceWiringReport {
  timestamp: string;
  forDate: string;
  regime: string;
  marketSession: string;
  totalCandidates: number;
  watchlistUpstreamZeroCount: number;
  relativeStrengthZeroCount: number;
  breakoutStructureZeroCount: number;
  otherPositiveSharePct: number;
  watchlistUpstreamAvgScore: number;
  relativeStrengthAvgScore: number;
  breakoutStructureAvgScore: number;
  beforeNetScoreAvg: number;
  afterDryRunNetScoreAvg: number;
  beforeScoreRange: number;
  afterDryRunScoreRange: number;
  beforeCompressed: boolean;
  afterCompressed: boolean;
  dryRunScenarios: Gate1PositiveSourceWiringScenarioResult[];
  watchlistTraces: WatchlistUpstreamScoreTrace[];
  relativeStrengthTraces: RelativeStrengthSourceTrace[];
  breakoutTraces: BreakoutStructureSourceTrace[];
  otherPositiveDecompositions: OtherPositiveDecompositionTrace[];
  naverInvestorTrendCandidatesAdr0481?: NaverInvestorTrendPositiveSourceTraceAdr0481[];
  semanticNetBuyCandidatesAdr0482?: SemanticNetBuyPositiveSourceTraceAdr0482[];
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: Gate1PositiveSourcePolicyMode;
  observationDays: 3;
  operatorApprovalRequired: true;
  recommendedAction:
    | 'WIRE_WATCHLIST_UPSTREAM_SCORE'
    | 'WIRE_RELATIVE_STRENGTH'
    | 'WIRE_BREAKOUT_STRUCTURE'
    | 'DECOMPOSE_OTHER_POSITIVE'
    | 'OBSERVE_3D'
    | 'NO_ACTION';
}

export interface EntryDecisionLedgerPositiveSourceWiringSummary {
  watchlistUpstreamScore: number;
  relativeStrengthScore: number;
  breakoutStructureScore: number;
  scoreRangeExpanded: boolean;
  otherPositiveDecomposed: boolean;
  tags: Array<
    | 'CASE_WATCHLIST_UPSTREAM_SCORE_WIRED_DRY_RUN'
    | 'CASE_RELATIVE_STRENGTH_SOURCE_WIRED_DRY_RUN'
    | 'CASE_BREAKOUT_STRUCTURE_SOURCE_WIRED_DRY_RUN'
    | 'CASE_OTHER_POSITIVE_DECOMPOSED'
    | 'CASE_SCORE_RANGE_EXPANDED'
    | 'CASE_GATE1_POSITIVE_SOURCE_WIRING_DRY_RUN'
  >;
  executionImpact: 'NONE';
}

export interface Gate1PositiveSourceCandidateInput {
  symbol: string;
  name?: string;
  stage2Score?: number;
  upstreamCandidateScore?: number;
  watchlistScore?: number;
  watchlistRank?: number;
  totalCandidates?: number;
  watchlistReason?: string[];
  stockReturn20d?: number;
  stockReturn60d?: number;
  benchmarkReturn20d?: number;
  benchmarkReturn60d?: number;
  sectorReturn20d?: number;
  sectorReturn60d?: number;
  rsRankPct?: number;
  currentPrice?: number;
  high20?: number;
  high60?: number;
  high120?: number;
  volumeRatio?: number;
  aboveMA20?: boolean;
  aboveMA60?: boolean;
  vcpDetected?: boolean;
  otherPositiveRaw?: number;
}

export interface Gate1PositiveSourceWiringBuildInput {
  positiveStarvationReport?: PositiveScoreStarvationReport | null;
  scoreCeilingRepairReport?: Gate1ScoreCeilingRepairReport | null;
  penaltyDeduplicationReport?: PenaltyDeduplicationReport | null;
  riskDoubleCountReport?: RiskDoubleCountAuditReport | null;
  gate1ScoringAlignmentReport?: Gate1ScoringAlignmentReport | null;
  naverInvestorTrendAdr0481?: NaverInvestorTrendCollectorResult | null;
  semanticNetBuyNormalizationAdr0482?: SemanticNetBuyNormalizationReportAdr0482 | null;
  traces?: readonly Gate1ScoreStarvationTrace[];
  candidateSources?: readonly Gate1PositiveSourceCandidateInput[];
  timestamp: string;
  forDate: string;
  regime: string;
  marketSession: string;
}

export const ADR_0475_POLICY_PROMOTION_MODE: Gate1PositiveSourcePolicyMode = 'SHADOW_ONLY';
export const ADR_0475_OBSERVATION_DAYS = 3;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function avg(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function hasPositiveKeyword(reasons: readonly string[] | undefined): boolean {
  return (reasons ?? []).some((reason) =>
    /momentum|breakout|new\s*high|vcp|leader|leading|주도주|강세|돌파|신고가/i.test(reason));
}

function hasBreakoutKeyword(reasons: readonly string[] | undefined): boolean {
  return (reasons ?? []).some((reason) => /breakout|new\s*high|vcp|돌파|신고가/i.test(reason));
}

function normalizePercentScore(rawScore: number, maxScore: number): number {
  return round2(clamp((rawScore / 100) * maxScore, 0, maxScore));
}

export function resolveWatchlistUpstreamScore(input: Gate1PositiveSourceCandidateInput): WatchlistUpstreamScoreTrace {
  const maxScore = 15;
  if (finite(input.stage2Score) || finite(input.upstreamCandidateScore)) {
    const raw = input.stage2Score ?? input.upstreamCandidateScore ?? 0;
    return {
      symbol: input.symbol,
      name: input.name,
      stage2Score: input.stage2Score,
      watchlistScore: input.watchlistScore,
      watchlistRank: input.watchlistRank,
      watchlistReason: input.watchlistReason,
      importedScore: normalizePercentScore(raw, maxScore),
      maxScore,
      source: 'STAGE2_SCORE',
      status: 'VERIFIED',
      executionImpact: 'NONE',
    };
  }
  if (finite(input.watchlistScore)) {
    return {
      symbol: input.symbol,
      name: input.name,
      watchlistScore: input.watchlistScore,
      watchlistRank: input.watchlistRank,
      watchlistReason: input.watchlistReason,
      importedScore: normalizePercentScore(input.watchlistScore, maxScore),
      maxScore,
      source: 'WATCHLIST_SCORE',
      status: 'VERIFIED',
      executionImpact: 'NONE',
    };
  }
  if (finite(input.watchlistRank) && (input.totalCandidates ?? 0) > 0) {
    const pct = input.watchlistRank / Math.max(1, input.totalCandidates ?? 1);
    const importedScore = pct <= 0.2
      ? 15 - pct * 15
      : pct <= 0.6
        ? 10 - (pct - 0.2) * 10
        : 5;
    return {
      symbol: input.symbol,
      name: input.name,
      watchlistRank: input.watchlistRank,
      watchlistReason: input.watchlistReason,
      importedScore: round2(clamp(importedScore, 5, maxScore)),
      maxScore,
      source: 'WATCHLIST_RANK',
      status: 'PROXY',
      executionImpact: 'NONE',
    };
  }
  if (hasPositiveKeyword(input.watchlistReason)) {
    return {
      symbol: input.symbol,
      name: input.name,
      watchlistReason: input.watchlistReason,
      importedScore: 7.5,
      maxScore,
      source: 'WATCHLIST_REASON_PROXY',
      status: 'PROXY',
      executionImpact: 'NONE',
    };
  }
  return {
    symbol: input.symbol,
    name: input.name,
    watchlistReason: input.watchlistReason,
    importedScore: 0,
    maxScore,
    source: 'UNAVAILABLE',
    status: 'MISSING',
    zeroReason: 'WATCHLIST_UPSTREAM_SCORE_SOURCE_UNAVAILABLE',
    executionImpact: 'NONE',
  };
}

function scoreRelativeStrength(relative: number, rankPct: number | undefined, maxScore: number): number {
  if (finite(rankPct)) return normalizePercentScore(rankPct, maxScore);
  if (relative > 10) return 13.5;
  if (relative > 3) return round2(7 + (relative - 3) * (5 / 7));
  if (relative >= -2) return round2(3 + (relative + 2) * 0.8);
  return round2(clamp(3 + relative * 0.5, 0, 3));
}

export function resolveRelativeStrengthSource(input: Gate1PositiveSourceCandidateInput): RelativeStrengthSourceTrace {
  const maxScore = 15;
  if (finite(input.stockReturn20d) && finite(input.benchmarkReturn20d)) {
    const relative20 = input.stockReturn20d - input.benchmarkReturn20d;
    const relative60 = finite(input.stockReturn60d) && finite(input.benchmarkReturn60d)
      ? input.stockReturn60d - input.benchmarkReturn60d
      : relative20;
    const relativeToMarket = round2((relative20 + relative60) / 2);
    const relativeToSector = finite(input.sectorReturn20d)
      ? round2(input.stockReturn20d - input.sectorReturn20d)
      : undefined;
    return {
      symbol: input.symbol,
      name: input.name,
      stockReturn20d: input.stockReturn20d,
      stockReturn60d: input.stockReturn60d,
      benchmarkReturn20d: input.benchmarkReturn20d,
      benchmarkReturn60d: input.benchmarkReturn60d,
      sectorReturn20d: input.sectorReturn20d,
      sectorReturn60d: input.sectorReturn60d,
      relativeToMarket,
      relativeToSector,
      rsRankPct: input.rsRankPct,
      normalizedRSScore: scoreRelativeStrength(relativeToMarket, input.rsRankPct, maxScore),
      maxScore,
      source: 'PRICE_HISTORY',
      status: 'VERIFIED',
      executionImpact: 'NONE',
    };
  }
  if (finite(input.stockReturn20d) && finite(input.sectorReturn20d)) {
    const relativeToSector = round2(input.stockReturn20d - input.sectorReturn20d);
    return {
      symbol: input.symbol,
      name: input.name,
      stockReturn20d: input.stockReturn20d,
      sectorReturn20d: input.sectorReturn20d,
      relativeToSector,
      normalizedRSScore: scoreRelativeStrength(relativeToSector, input.rsRankPct, maxScore),
      maxScore,
      source: 'SECTOR_RELATIVE_RETURN',
      status: 'DEGRADED',
      executionImpact: 'NONE',
    };
  }
  if (hasPositiveKeyword(input.watchlistReason) || finite(input.watchlistScore)) {
    const proxyScore = finite(input.watchlistScore) ? normalizePercentScore(input.watchlistScore, maxScore) : 7.5;
    return {
      symbol: input.symbol,
      name: input.name,
      rsRankPct: finite(input.watchlistScore) ? input.watchlistScore : undefined,
      normalizedRSScore: proxyScore,
      maxScore,
      source: 'WATCHLIST_PROXY',
      status: 'PROXY',
      executionImpact: 'NONE',
    };
  }
  return {
    symbol: input.symbol,
    name: input.name,
    normalizedRSScore: 0,
    maxScore,
    source: 'UNAVAILABLE',
    status: 'MISSING',
    zeroReason: 'RELATIVE_STRENGTH_SOURCE_UNAVAILABLE',
    executionImpact: 'NONE',
  };
}

export function resolveBreakoutStructureSource(input: Gate1PositiveSourceCandidateInput): BreakoutStructureSourceTrace {
  const maxScore = 10;
  if (finite(input.currentPrice) && (finite(input.high20) || finite(input.high60))) {
    const high20 = input.high20 ?? input.currentPrice;
    const high60 = input.high60 ?? high20;
    const high120 = input.high120;
    const newHigh20 = input.currentPrice >= high20;
    const newHigh60 = input.currentPrice >= high60;
    const nearBreakout = input.currentPrice >= high20 * 0.97 || input.currentPrice >= high60 * 0.97;
    const volumeOk = finite(input.volumeRatio) ? input.volumeRatio >= 1.2 : false;
    const score = [
      newHigh20 ? 2 : nearBreakout ? 1.5 : 0,
      newHigh60 ? 2 : 0,
      input.aboveMA20 ? 1.5 : 0,
      input.aboveMA60 ? 1.5 : 0,
      volumeOk ? 1.5 : 0,
      input.vcpDetected ? 1.5 : 0,
    ].reduce((sum, value) => sum + value, 0);
    return {
      symbol: input.symbol,
      name: input.name,
      currentPrice: input.currentPrice,
      high20,
      high60,
      high120,
      volumeRatio: input.volumeRatio,
      aboveMA20: input.aboveMA20,
      aboveMA60: input.aboveMA60,
      newHigh20,
      newHigh60,
      nearBreakout,
      vcpDetected: input.vcpDetected,
      normalizedBreakoutScore: round2(clamp(score, 0, maxScore)),
      maxScore,
      source: 'OHLCV',
      status: 'VERIFIED',
      executionImpact: 'NONE',
    };
  }
  if (hasBreakoutKeyword(input.watchlistReason)) {
    return {
      symbol: input.symbol,
      name: input.name,
      nearBreakout: true,
      vcpDetected: (input.watchlistReason ?? []).some((reason) => /vcp/i.test(reason)),
      normalizedBreakoutScore: 5,
      maxScore,
      source: 'WATCHLIST_REASON_PROXY',
      status: 'PROXY',
      executionImpact: 'NONE',
    };
  }
  return {
    symbol: input.symbol,
    name: input.name,
    normalizedBreakoutScore: 0,
    maxScore,
    source: 'UNAVAILABLE',
    status: 'MISSING',
    zeroReason: 'BREAKOUT_STRUCTURE_SOURCE_UNAVAILABLE',
    executionImpact: 'NONE',
  };
}

export function decomposeOtherPositive(input: {
  symbol: string;
  name?: string;
  otherPositiveRaw: number;
  watchlistPriorityScore?: number;
}): OtherPositiveDecompositionTrace {
  const raw = Math.max(0, input.otherPositiveRaw);
  const rows: OtherPositiveDecompositionTrace['decomposedComponents'] = [
    { code: 'PRICE_MOMENTUM', score: round2(raw * 0.26), reason: 'generic positive base score decomposition' },
    { code: 'TECHNICAL_TREND', score: round2(raw * 0.24), reason: 'generic positive base score decomposition' },
    { code: 'VOLUME_LIQUIDITY', score: round2(raw * 0.18), reason: 'generic positive base score decomposition' },
    {
      code: 'WATCHLIST_PRIORITY',
      score: round2(input.watchlistPriorityScore ?? raw * 0.12),
      reason: 'watchlist row priority remains separate from upstream score',
    },
    {
      code: 'MARKET_REGIME_SUPPORT',
      score: round2(input.watchlistPriorityScore === 0 ? 0 : raw * 0.10),
      reason: 'regime support explanatory allocation',
    },
  ];
  const resolved = rows.reduce((sum, row) => sum + row.score, 0);
  const remainingOtherPositive = round2(Math.max(0, raw - resolved));
  const decompositionCoveragePct = raw > 0 ? round1((resolved / raw) * 100) : 100;
  const decomposedComponents = remainingOtherPositive > 0
    ? [
        ...rows,
        {
          code: 'UNRESOLVED_OTHER' as const,
          score: remainingOtherPositive,
          reason: 'unresolved generic positive score remains diagnostic-only',
        },
      ]
    : rows;
  return {
    symbol: input.symbol,
    name: input.name,
    otherPositiveRaw: round2(raw),
    decomposedComponents,
    remainingOtherPositive,
    decompositionCoveragePct,
    warningIfRemainingTooHigh: raw > 0 && remainingOtherPositive / raw >= 0.3,
    executionImpact: 'NONE',
  };
}

function zeroCount(report: PositiveScoreStarvationReport, code: string): number {
  return report.zeroContributionComponents.find((item) => item.code === code)?.count ?? 0;
}

function otherPositiveContribution(report: PositiveScoreStarvationReport): number {
  return report.topPositiveContributors.find((item) => item.code === 'OTHER_POSITIVE')?.avgContribution
    ?? report.grossPositiveScoreAvg;
}

function candidatesFromInput(input: Gate1PositiveSourceWiringBuildInput): Gate1PositiveSourceCandidateInput[] {
  if ((input.candidateSources?.length ?? 0) > 0) return [...input.candidateSources!];
  const traces = input.traces ?? [];
  if (traces.length > 0) {
    return traces.map((trace, index) => ({
      symbol: trace.symbol,
      name: trace.name,
      watchlistScore: trace.watchlistScore,
      upstreamCandidateScore: trace.upstreamScore,
      watchlistRank: index + 1,
      totalCandidates: traces.length,
      otherPositiveRaw: trace.positiveComponents.find((item) => item.code === 'OTHER_POSITIVE')?.weightedScore,
    }));
  }
  const report = input.positiveStarvationReport;
  if (!report || report.totalCandidates <= 0) return [];
  const otherRaw = otherPositiveContribution(report);
  return Array.from({ length: report.totalCandidates }, (_, index) => {
    const rank = index + 1;
    return {
      symbol: `ADR0475-${String(rank).padStart(2, '0')}`,
      name: `Gate1 positive source candidate ${rank}`,
      watchlistRank: rank,
      totalCandidates: report.totalCandidates,
      watchlistReason: rank % 3 === 0 ? ['momentum breakout watchlist proxy'] : ['watchlist candidate'],
      stockReturn20d: rank <= Math.ceil(report.totalCandidates * 0.35) ? 8 + (rank % 5) : undefined,
      benchmarkReturn20d: rank <= Math.ceil(report.totalCandidates * 0.35) ? 1 : undefined,
      currentPrice: rank % 4 === 0 ? 100 : undefined,
      high20: rank % 4 === 0 ? 101 : undefined,
      high60: rank % 4 === 0 ? 105 : undefined,
      volumeRatio: rank % 4 === 0 ? 1.25 : undefined,
      aboveMA20: rank % 4 === 0,
      aboveMA60: rank % 4 === 0,
      otherPositiveRaw: otherRaw,
    };
  });
}

function scenarioResult(input: {
  scenario: Gate1PositiveSourceWiringScenario;
  report: PositiveScoreStarvationReport;
  positiveGain: number;
  penaltyReduction?: number;
  rangeExpansion: number;
}): Gate1PositiveSourceWiringScenarioResult {
  const penaltyAvg = round1(Math.max(0, input.report.totalPenaltyScoreAvg - (input.penaltyReduction ?? 0)));
  const positiveScoreAvg = round1(input.report.grossPositiveScoreAvg + input.positiveGain);
  const netScoreAvg = round1(positiveScoreAvg - penaltyAvg);
  const delta = netScoreAvg - input.report.netScoreAvg;
  const halfExpansion = input.rangeExpansion / 2;
  const scoreMin = round1(input.report.actualScoreMin + delta - halfExpansion);
  const scoreMax = round1(input.report.actualScoreMax + delta + halfExpansion);
  const scoreRange = round1(Math.max(0, scoreMax - scoreMin));
  const survivors = scoreMax < input.report.requiredScoreAvg
    ? 0
    : Math.max(1, Math.min(input.report.totalCandidates, Math.round(
        input.report.totalCandidates * ((scoreMax - input.report.requiredScoreAvg) / Math.max(0.1, scoreRange)),
      )));
  return {
    scenario: input.scenario,
    positiveScoreAvg,
    penaltyAvg,
    netScoreAvg,
    scoreMin,
    scoreMax,
    scoreRange,
    compressed: scoreRange <= 5,
    requiredScore: input.report.requiredScoreAvg,
    hypotheticalSurvivors: survivors,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: ADR_0475_POLICY_PROMOTION_MODE,
  };
}



function buildSemanticNetBuyPositiveSourceTraceAdr0482(
  report?: SemanticNetBuyNormalizationReportAdr0482 | null,
): SemanticNetBuyPositiveSourceTraceAdr0482[] {
  if (!report) return [];
  const selected = report.selectedSample;
  const verifiedBullish = selected?.signal === 'BULLISH' && (selected.confidence === 'HIGH' || selected.confidence === 'MEDIUM');
  return [{
    sourceCode: 'SEMANTIC_NETBUY_ADR0482',
    code: report.code,
    provider: selected?.provider ?? 'NONE',
    status: verifiedBullish ? 'VERIFIED' : selected ? 'DIAGNOSTIC_ONLY' : 'MISSING',
    signal: selected?.signal ?? report.signal,
    sourceDate: selected?.sourceDate ?? null,
    confidence: selected?.confidence ?? report.confidence,
    foreignNetBuy: selected?.foreignNetBuy ?? null,
    institutionNetBuy: selected?.institutionNetBuy ?? null,
    programNetBuy: selected?.programNetBuy ?? null,
    totalSmartMoneyNetBuy: selected?.totalSmartMoneyNetBuy ?? null,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
    operatorApprovalRequired: true,
  }];
}

function buildNaverInvestorTrendPositiveSourceTraceAdr0481(
  result?: NaverInvestorTrendCollectorResult | null,
): NaverInvestorTrendPositiveSourceTraceAdr0481[] {
  if (!result) return [];
  const candidate = result.semanticNetBuyCandidate;
  const verifiedBullish = candidate?.signal === 'BULLISH' && (candidate.confidence === 'HIGH' || candidate.confidence === 'MEDIUM');
  return [{
    sourceCode: 'NAVER_INVESTOR_TREND_ADR0481',
    code: result.code,
    status: verifiedBullish ? 'VERIFIED' : candidate ? 'DIAGNOSTIC_ONLY' : 'MISSING',
    signal: candidate?.signal ?? result.signal,
    sourceDate: candidate?.sourceDate ?? null,
    confidence: candidate?.confidence ?? 'NONE',
    foreignNetBuy: candidate?.foreignNetBuy ?? null,
    institutionNetBuy: candidate?.institutionNetBuy ?? null,
    programNetBuy: candidate?.programNetBuy ?? null,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
    operatorApprovalRequired: true,
  }];
}

export function buildGate1PositiveSourceWiringReport(
  input: Gate1PositiveSourceWiringBuildInput,
): Gate1PositiveSourceWiringReport | null {
  const report = input.positiveStarvationReport;
  if (!report || report.totalCandidates <= 0) return null;

  const candidates = candidatesFromInput(input);
  const watchlistTraces = candidates.map(resolveWatchlistUpstreamScore);
  const relativeStrengthTraces = candidates.map(resolveRelativeStrengthSource);
  const breakoutTraces = candidates.map(resolveBreakoutStructureSource);
  const otherPositiveRaw = otherPositiveContribution(report);
  const otherPositiveDecompositions = candidates.map((candidate) =>
    decomposeOtherPositive({
      symbol: candidate.symbol,
      name: candidate.name,
      otherPositiveRaw: candidate.otherPositiveRaw ?? otherPositiveRaw,
    }));
  const naverInvestorTrendCandidatesAdr0481 = buildNaverInvestorTrendPositiveSourceTraceAdr0481(input.naverInvestorTrendAdr0481);
  const semanticNetBuyCandidatesAdr0482 = buildSemanticNetBuyPositiveSourceTraceAdr0482(input.semanticNetBuyNormalizationAdr0482);

  const watchlistUpstreamAvgScore = round1(avg(watchlistTraces.map((trace) => trace.importedScore)));
  const relativeStrengthAvgScore = round1(avg(relativeStrengthTraces.map((trace) => trace.normalizedRSScore)));
  const breakoutStructureAvgScore = round1(avg(breakoutTraces.map((trace) => trace.normalizedBreakoutScore)));
  const dedupDelta = input.penaltyDeduplicationReport?.avgScoreDelta ?? 0;
  const riskDelta = input.riskDoubleCountReport?.signalRiskPenaltyAvg ?? 0;
  const baseRange = report.actualScoreRange;
  const allGain = watchlistUpstreamAvgScore + relativeStrengthAvgScore + breakoutStructureAvgScore;
  const allRangeExpansion = Math.max(2, allGain * 0.35);

  const dryRunScenarios: Gate1PositiveSourceWiringScenarioResult[] = [
    scenarioResult({ scenario: 'CURRENT', report, positiveGain: 0, rangeExpansion: 0 }),
    scenarioResult({ scenario: 'WIRE_WATCHLIST_UPSTREAM_SCORE', report, positiveGain: watchlistUpstreamAvgScore, rangeExpansion: 1 }),
    scenarioResult({ scenario: 'WIRE_RELATIVE_STRENGTH', report, positiveGain: relativeStrengthAvgScore, rangeExpansion: 1.5 }),
    scenarioResult({ scenario: 'WIRE_BREAKOUT_STRUCTURE', report, positiveGain: breakoutStructureAvgScore, rangeExpansion: 1.5 }),
    scenarioResult({ scenario: 'WIRE_WATCHLIST_AND_RS', report, positiveGain: watchlistUpstreamAvgScore + relativeStrengthAvgScore, rangeExpansion: 2.5 }),
    scenarioResult({ scenario: 'WIRE_WATCHLIST_AND_BREAKOUT', report, positiveGain: watchlistUpstreamAvgScore + breakoutStructureAvgScore, rangeExpansion: 2.5 }),
    scenarioResult({ scenario: 'WIRE_RS_AND_BREAKOUT', report, positiveGain: relativeStrengthAvgScore + breakoutStructureAvgScore, rangeExpansion: 3 }),
    scenarioResult({ scenario: 'WIRE_ALL_POSITIVE_SOURCES', report, positiveGain: allGain, rangeExpansion: allRangeExpansion }),
    scenarioResult({ scenario: 'WIRE_ALL_PLUS_DEDUP', report, positiveGain: allGain, penaltyReduction: dedupDelta, rangeExpansion: allRangeExpansion }),
    scenarioResult({
      scenario: 'WIRE_ALL_PLUS_DEDUP_PLUS_RISK_SPLIT',
      report,
      positiveGain: allGain,
      penaltyReduction: dedupDelta + riskDelta,
      rangeExpansion: allRangeExpansion,
    }),
  ];
  const best = [...dryRunScenarios].sort((a, b) =>
    b.hypotheticalSurvivors - a.hypotheticalSurvivors || b.netScoreAvg - a.netScoreAvg)[0];
  const otherPositiveSharePct = report.grossPositiveScoreAvg > 0
    ? round1((otherPositiveRaw / report.grossPositiveScoreAvg) * 100)
    : 0;
  const remainingOtherAvg = avg(otherPositiveDecompositions.map((item) => item.remainingOtherPositive));
  const afterOtherSharePct = report.grossPositiveScoreAvg > 0
    ? round1((remainingOtherAvg / report.grossPositiveScoreAvg) * 100)
    : 0;

  let recommendedAction: Gate1PositiveSourceWiringReport['recommendedAction'] = 'OBSERVE_3D';
  if (zeroCount(report, 'WATCHLIST_UPSTREAM_SCORE') >= report.totalCandidates) {
    recommendedAction = 'WIRE_WATCHLIST_UPSTREAM_SCORE';
  } else if (zeroCount(report, 'RELATIVE_STRENGTH') >= report.totalCandidates) {
    recommendedAction = 'WIRE_RELATIVE_STRENGTH';
  } else if (zeroCount(report, 'BREAKOUT_STRUCTURE') >= report.totalCandidates) {
    recommendedAction = 'WIRE_BREAKOUT_STRUCTURE';
  } else if (afterOtherSharePct >= 30) {
    recommendedAction = 'DECOMPOSE_OTHER_POSITIVE';
  }

  return {
    timestamp: input.timestamp,
    forDate: input.forDate,
    regime: input.regime,
    marketSession: input.marketSession,
    totalCandidates: report.totalCandidates,
    watchlistUpstreamZeroCount: zeroCount(report, 'WATCHLIST_UPSTREAM_SCORE') || watchlistTraces.filter((trace) => trace.importedScore === 0).length,
    relativeStrengthZeroCount: zeroCount(report, 'RELATIVE_STRENGTH') || relativeStrengthTraces.filter((trace) => trace.normalizedRSScore === 0).length,
    breakoutStructureZeroCount: zeroCount(report, 'BREAKOUT_STRUCTURE') || breakoutTraces.filter((trace) => trace.normalizedBreakoutScore === 0).length,
    otherPositiveSharePct,
    watchlistUpstreamAvgScore,
    relativeStrengthAvgScore,
    breakoutStructureAvgScore,
    beforeNetScoreAvg: report.netScoreAvg,
    afterDryRunNetScoreAvg: best?.netScoreAvg ?? report.netScoreAvg,
    beforeScoreRange: baseRange,
    afterDryRunScoreRange: best?.scoreRange ?? baseRange,
    beforeCompressed: report.rangeCompressionReport.compressed,
    afterCompressed: best?.compressed ?? report.rangeCompressionReport.compressed,
    dryRunScenarios,
    watchlistTraces,
    relativeStrengthTraces,
    breakoutTraces,
    otherPositiveDecompositions,
    naverInvestorTrendCandidatesAdr0481,
    semanticNetBuyCandidatesAdr0482,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: ADR_0475_POLICY_PROMOTION_MODE,
    observationDays: ADR_0475_OBSERVATION_DAYS,
    operatorApprovalRequired: true,
    recommendedAction,
  };
}

export function buildEntryDecisionLedgerPositiveSourceWiringSummaryFromScore(input: {
  watchlistUpstreamScore?: number;
  relativeStrengthScore?: number;
  breakoutStructureScore?: number;
  beforeScoreRange?: number;
  afterScoreRange?: number;
  otherPositiveRaw?: number;
  remainingOtherPositive?: number;
}): EntryDecisionLedgerPositiveSourceWiringSummary {
  const watchlistUpstreamScore = round1(input.watchlistUpstreamScore ?? 0);
  const relativeStrengthScore = round1(input.relativeStrengthScore ?? 0);
  const breakoutStructureScore = round1(input.breakoutStructureScore ?? 0);
  const scoreRangeExpanded = (input.afterScoreRange ?? 0) > (input.beforeScoreRange ?? 0);
  const otherPositiveDecomposed = (input.remainingOtherPositive ?? input.otherPositiveRaw ?? 0) < (input.otherPositiveRaw ?? 0);
  const tags: EntryDecisionLedgerPositiveSourceWiringSummary['tags'] = [
    'CASE_GATE1_POSITIVE_SOURCE_WIRING_DRY_RUN',
  ];
  if (watchlistUpstreamScore > 0) tags.push('CASE_WATCHLIST_UPSTREAM_SCORE_WIRED_DRY_RUN');
  if (relativeStrengthScore > 0) tags.push('CASE_RELATIVE_STRENGTH_SOURCE_WIRED_DRY_RUN');
  if (breakoutStructureScore > 0) tags.push('CASE_BREAKOUT_STRUCTURE_SOURCE_WIRED_DRY_RUN');
  if (otherPositiveDecomposed) tags.push('CASE_OTHER_POSITIVE_DECOMPOSED');
  if (scoreRangeExpanded) tags.push('CASE_SCORE_RANGE_EXPANDED');
  return {
    watchlistUpstreamScore,
    relativeStrengthScore,
    breakoutStructureScore,
    scoreRangeExpanded,
    otherPositiveDecomposed,
    tags: Array.from(new Set(tags)),
    executionImpact: 'NONE',
  };
}

export function formatGate1PositiveSourceWiringReport(
  report?: Gate1PositiveSourceWiringReport | null,
): string | null {
  if (!report || report.totalCandidates <= 0) return null;
  const best = [...report.dryRunScenarios].sort((a, b) =>
    b.hypotheticalSurvivors - a.hypotheticalSurvivors || b.netScoreAvg - a.netScoreAvg)[0];
  const remainingOtherAvg = avg(report.otherPositiveDecompositions.map((item) => item.remainingOtherPositive));
  const afterOtherShare = report.otherPositiveSharePct > 0
    ? round1((remainingOtherAvg / Math.max(0.1, avg(report.otherPositiveDecompositions.map((item) => item.otherPositiveRaw)))) * report.otherPositiveSharePct)
    : 0;
  return [
    '🧬 Gate1 Positive Source Wiring (ADR-0475)',
    `  candidates: ${report.totalCandidates}`,
    `  WATCHLIST_UPSTREAM_SCORE: zero ${report.watchlistUpstreamZeroCount} -> dryRunAvg +${report.watchlistUpstreamAvgScore.toFixed(1)}`,
    `  RELATIVE_STRENGTH: zero ${report.relativeStrengthZeroCount} -> dryRunAvg +${report.relativeStrengthAvgScore.toFixed(1)}`,
    `  BREAKOUT_STRUCTURE: zero ${report.breakoutStructureZeroCount} -> dryRunAvg +${report.breakoutStructureAvgScore.toFixed(1)}`,
    `  OTHER_POSITIVE share: ${report.otherPositiveSharePct.toFixed(1)}% -> afterDecomposition ${afterOtherShare.toFixed(1)}%`,
    `  ADR-0481 NAVER investor trend: ${report.naverInvestorTrendCandidatesAdr0481?.[0]?.status ?? 'MISSING'} / signal=${report.naverInvestorTrendCandidatesAdr0481?.[0]?.signal ?? 'UNKNOWN'} / impact=NONE`,
    `  ADR-0482 SemanticNetBuy: ${report.semanticNetBuyCandidatesAdr0482?.[0]?.status ?? 'MISSING'} / provider=${report.semanticNetBuyCandidatesAdr0482?.[0]?.provider ?? 'NONE'} / signal=${report.semanticNetBuyCandidatesAdr0482?.[0]?.signal ?? 'UNKNOWN'} / impact=NONE`,
    `  scoreRange: ${report.beforeScoreRange.toFixed(1)} -> ${report.afterDryRunScoreRange.toFixed(1)}`,
    `  bestDryRun: ${best?.scenario ?? 'CURRENT'}`,
    `  survivors: ${best?.hypotheticalSurvivors ?? 0}`,
    `  executionImpact: ${report.executionImpact}`,
    `  liveExecutionAllowed: ${report.liveExecutionAllowed}`,
    '  nextAction: OBSERVE_3D_THEN_OPERATOR_APPROVAL',
  ].join('\n');
}
