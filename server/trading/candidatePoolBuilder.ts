// @responsibility Broad candidate pool materialization before Gate evaluation.

import {
  lockSectorEnergyOutputToCanonical,
  sectorEnergyCanonicalOrMissing,
  type SectorEnergyCanonicalState,
} from '../../src/domain/sector-energy/SectorEnergyCanonicalResolver.js';

export type CandidateSourceTag =
  | 'WATCHLIST'
  | 'INTRADAY_MOVER'
  | 'BUY_LIST'
  | 'PREVIOUS_STRONG'
  | 'SECTOR_LEADER'
  | 'VOLUME_SPIKE'
  | 'RS_CANDIDATE'
  | 'BREAKOUT_CANDIDATE'
  | 'PREVIOUS_DAY_TOP_RANKED'
  | 'OPEN_SHADOW_WATCHLIST'
  | 'HIGH_LIQUIDITY'
  | 'FALLBACK_BROAD_UNIVERSE'
  | 'UNKNOWN';

export type CandidateMissingFeature =
  | 'RS_SCORE_MISSING'
  | 'BREAKOUT_SCORE_MISSING'
  | 'SUPPLY_MISSING'
  | 'TECHNICAL_TREND_MISSING'
  | 'PROGRAM_TRADE_EMPTY'
  | 'SECTOR_LEADERSHIP_MISSING'
  | 'VOLUME_ENERGY_MISSING'
  | 'QUOTE_STALE'
  | 'PROVIDER_ISSUE_ISOLATED';

export type CandidateLearningLabel =
  | 'CANDIDATE_EVALUATION_ACTIVE'
  | 'LIVE_PERMISSION_SEPARATED'
  | 'SHADOW_CANDIDATE_TRACKING_ON'
  | 'COUNTERFACTUAL_RECORDING_ON'
  | 'FALLBACK_CANDIDATE'
  | 'MISSING_FEATURE_SCORED'
  | 'PROVIDER_ISSUE_ISOLATED'
  | 'R6_PENALTY_ONLY'
  | 'SELL_ONLY_EVALUATION_CONTINUED'
  | 'KELLY_ADVISORY_ONLY';

export type CandidateDataHealth = 'VERIFIED' | 'DEGRADED' | 'STALE' | 'MISSING' | 'CORRUPTED';
export type CandidateConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface CandidateConfidence {
  overall: CandidateConfidenceLevel;
  data: CandidateConfidenceLevel;
  technical: CandidateConfidenceLevel;
  supply: CandidateConfidenceLevel;
  provider: CandidateConfidenceLevel;
}

export interface CandidateFeatureScores {
  liquidityScore: number;
  relativeStrengthScore: number;
  volumeEnergyScore: number;
  trendScore: number;
  supplyScore: number;
  breakoutScore: number;
  sectorLeadershipScore: number;
  volatilityCompressionScore: number;
  macroCompatibilityScore: number;
  dataConfidenceScore: number;
}

export interface CandidatePenalties {
  staleDataPenalty: number;
  missingFeaturePenalty: number;
  R6Penalty: number;
  providerIssuePenalty: number;
  lowLiquidityPenalty: number;
  overheatPenalty: number;
}

export interface CandidatePoolInputCandidate {
  [key: string]: unknown;
  symbol?: string;
  code?: string;
  stockCode?: string;
  name?: string;
  stockName?: string;
  market?: string;
  sector?: string;
  source?: CandidateSourceTag | string;
  sourceTags?: Array<CandidateSourceTag | string>;
  quote?: Record<string, unknown> | null;
  price?: number | null;
  currentPrice?: number | null;
  entryPrice?: number | null;
  volume?: number | null;
  avgVolume?: number | null;
  turnover?: number | null;
  marketCap?: number | null;
  dataHealth?: CandidateDataHealth;
  confidence?: Partial<CandidateConfidence>;
  featureScores?: Partial<CandidateFeatureScores>;
  penalties?: Partial<CandidatePenalties>;
  missingFeatures?: CandidateMissingFeature[];
  providerIssue?: boolean;
  marketSignal?: boolean;
  staleData?: boolean;
  untradable?: boolean;
  tradingHalted?: boolean;
  halted?: boolean;
  delisted?: boolean;
  managementIssue?: boolean;
  corrupted?: boolean;
  rsRankPct?: number | null;
  relativeStrengthScore?: number | null;
  breakoutScore?: number | null;
  supplyScore?: number | null;        // KIS 투자자 플로우 → deriveSupplyScore 결과
  sectorLeadershipScore?: number | null;  // 섹터 에너지 티어 → LEADING=8 NEUTRAL=4 LAGGING=0
  volumeRatio?: number | null;
  return5d?: number | null;
  return20d?: number | null;
  relativeReturn20d?: number | null;
  marketRelativeReturn?: number | null;
  gate1Passed?: boolean;
  gate2Passed?: boolean;
  gate3Passed?: boolean;
}

export interface CandidateSnapshot {
  sourceSnapshotId: string;
  symbol: string;
  name: string;
  market: string;
  sector: string;
  sourceTags: CandidateSourceTag[];
  quote: Record<string, unknown> | null;
  price: number | null;
  volume: number | null;
  turnover: number | null;
  dataHealth: CandidateDataHealth;
  confidence: CandidateConfidence;
  missingFeatures: CandidateMissingFeature[];
  featureScores: CandidateFeatureScores;
  penalties: CandidatePenalties;
  totalScore: number;
  rank: number;
  evaluationEligible: boolean;
  shadowEligible: boolean;
  counterfactualEligible: boolean;
  liveOrderEligible: boolean;
  exclusionReason: string | null;
  diagnosticReason: string[];
  learningLabels: CandidateLearningLabel[];
}

export interface CandidateCounterfactualRecord {
  sourceSnapshotId: string;
  symbol: string;
  candidateRank: number;
  totalScore: number;
  gateResult: {
    diagnosticPass: boolean;
    shadowPass: boolean;
    livePass: boolean;
    liveOrderAllowed: boolean;
  };
  blockReason: string | null;
  penaltyLabels: string[];
  missingFeatures: CandidateMissingFeature[];
  hypotheticalEntryPrice: number | null;
  stopLoss: number | null;
  targetPrice: number | null;
  outcomePending: boolean;
  learningLabel: 'WATCHLIST_CANDIDATE' | 'FALLBACK_CANDIDATE' | 'BLOCKED_CANDIDATE';
}

export interface CandidatePoolDiagnostics {
  invalidReasonCounts: Record<string, number>;
  topCandidateSources: Array<{ source: CandidateSourceTag; count: number }>;
  topMissingFeatures: Array<{ feature: CandidateMissingFeature; count: number }>;
  topPenalties: Array<{ penalty: keyof CandidatePenalties; avg: number; count: number }>;
  fallbackTriggerReasons: string[];
  duplicateMergedCount: number;
  duplicateSymbols: string[];
  logTags: string[];
  counterfactualRecords: CandidateCounterfactualRecord[];
  featureCoverage?: CandidateFeatureCoverageDiagnostics;
}

export interface CandidateFeatureCoverageDiagnostics {
  totalCandidates?: number;
  rs?: {
    rawComputed?: number;
    traceAvailable?: number;
    gateApplied?: number;
    scoreUsable?: number;
    selectedBasisForActualMissing?: string;
    selectedBasisForPromotionGap?: string;
  };
  breakout?: {
    mapped?: number;
    traceAvailableRuntime?: number;
    traceAvailableAlignment?: number;
    runtimeScoreComputed?: number;
    scoreMappedToGateRuntime?: number;
    scoreMappedToGateAlignment?: number;
    positive?: number;
    zeroByCondition?: number;
    selectedBasisForActualMissing?: string;
    selectedBasisForPromotionGap?: string;
  };
  supply?: {
    injected?: number;
    verified?: number;
    symbolMatched?: number;
    semanticAvailable?: number;
    gateEligibleRows?: number;
    shadowOnlyRows?: number;
  };
  sectorLeadership?: {
    sectorEnergyCanonicalState?: SectorEnergyCanonicalState;
    officialIndexCoverage?: number;
    verifiedIndexCodeCoverage?: number;
    internalGroupedSnapshotCoverage?: number;
    internalGroupedValidSectorCount?: number;
    internalGroupedExpectedSectorCount?: number;
    internalProxyCoverage?: number;
    stockDailyFallbackCoverage?: number;
    selectedSourceTier?: string;
    leadershipConfidence?: string;
    promotionAllowed?: boolean;
    sectorBoostAllowed?: boolean;
    strongBuyAllowed?: boolean;
    shadowLeadershipAllowed?: boolean;
    counterfactualAllowed?: boolean;
  };
  volumeEnergy?: {
    rawVolumeFieldAvailable?: boolean;
    rawVolumeFieldKeys?: string[];
    volumeEnergyPromoted?: boolean;
  };
}

export interface CandidatePoolResult {
  sourceSnapshotId: string;
  asOf: string;
  ttlSec: number;
  totalUniverseCount: number;
  importedCount: number;
  validCount: number;
  invalidExcludedCount: number;
  hydratedCount: number;
  rankedCandidates: number;
  gateEvaluated: number;
  candidateDiagnosticScorePositive: number;
  shadowEligible: number;
  counterfactualRecorded: number;
  fallbackUsed: boolean;
  fallbackReason?: string;
  candidateSnapshots: CandidateSnapshot[];
  diagnostics: CandidatePoolDiagnostics;
}

export interface BuildCandidatePoolInput {
  sourceSnapshotId: string;
  asOf?: string;
  ttlSec?: number;
  totalUniverseCount?: number;
  existingWatchlist?: CandidatePoolInputCandidate[];
  intradayMovers?: CandidatePoolInputCandidate[];
  buyList?: CandidatePoolInputCandidate[];
  previousStrongCandidates?: CandidatePoolInputCandidate[];
  sectorLeaders?: CandidatePoolInputCandidate[];
  volumeSpikeCandidates?: CandidatePoolInputCandidate[];
  rsCandidates?: CandidatePoolInputCandidate[];
  breakoutCandidates?: CandidatePoolInputCandidate[];
  previousDayTopRankedCandidates?: CandidatePoolInputCandidate[];
  openShadowWatchlist?: CandidatePoolInputCandidate[];
  highLiquidityCandidates?: CandidatePoolInputCandidate[];
  fallbackBroadUniverse?: CandidatePoolInputCandidate[];
  minTurnover?: number;
  minMarketCap?: number;
  fallbackLimit?: number;
  liveOrderAllowed?: boolean;
  emitLogs?: boolean;
  runtimeLabels?: {
    sellOnly?: boolean;
    r6Defense?: boolean;
    kellyZero?: boolean;
    providerIssue?: boolean;
    staleData?: boolean;
    shadowOnly?: boolean;
  };
  zeroSurvivorSignals?: {
    gateEntryCandidates?: number;
    watchlistImported?: number;
    rsScoreUsable?: number;
    breakoutScoreUsable?: number;
  };
  featureCoverage?: CandidateFeatureCoverageDiagnostics;
}

const CANDIDATE_TAGS = new Set<CandidateSourceTag>([
  'WATCHLIST',
  'INTRADAY_MOVER',
  'BUY_LIST',
  'PREVIOUS_STRONG',
  'SECTOR_LEADER',
  'VOLUME_SPIKE',
  'RS_CANDIDATE',
  'BREAKOUT_CANDIDATE',
  'PREVIOUS_DAY_TOP_RANKED',
  'OPEN_SHADOW_WATCHLIST',
  'HIGH_LIQUIDITY',
  'FALLBACK_BROAD_UNIVERSE',
  'UNKNOWN',
]);

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(/,/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function pickNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const n = toFiniteNumber(value);
    if (n !== null) return n;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeSymbol(candidate: CandidatePoolInputCandidate): string | null {
  const raw = candidate.symbol ?? candidate.code ?? candidate.stockCode;
  if (typeof raw !== 'string') return null;
  const symbol = raw.trim();
  return symbol.length > 0 ? symbol : null;
}

function normalizeTag(value: unknown): CandidateSourceTag {
  if (typeof value !== 'string') return 'UNKNOWN';
  const tag = value.trim().toUpperCase() as CandidateSourceTag;
  return CANDIDATE_TAGS.has(tag) ? tag : 'UNKNOWN';
}

function collectTags(candidate: CandidatePoolInputCandidate, defaultTag: CandidateSourceTag): CandidateSourceTag[] {
  const tags = new Set<CandidateSourceTag>([defaultTag]);
  if (candidate.source) tags.add(normalizeTag(candidate.source));
  if (Array.isArray(candidate.sourceTags)) {
    for (const tag of candidate.sourceTags) tags.add(normalizeTag(tag));
  }
  tags.delete('UNKNOWN');
  if (tags.size === 0) tags.add('UNKNOWN');
  return [...tags];
}

function resolveQuote(candidate: CandidatePoolInputCandidate): Record<string, unknown> | null {
  const directQuote = asRecord(candidate.quote);
  if (directQuote) return directQuote;
  const symbolFeatures = asRecord(candidate.symbolFeatures);
  if (symbolFeatures) return symbolFeatures;
  return null;
}

function resolvePrice(candidate: CandidatePoolInputCandidate, quote: Record<string, unknown> | null): number | null {
  return pickNumber(
    candidate.price,
    candidate.currentPrice,
    candidate.entryPrice,
    quote?.price,
    quote?.currentPrice,
    quote?.last,
    quote?.close,
  );
}

function resolveVolume(candidate: CandidatePoolInputCandidate, quote: Record<string, unknown> | null): number | null {
  return pickNumber(candidate.volume, quote?.volume, quote?.acml_vol);
}

function resolveTurnover(candidate: CandidatePoolInputCandidate, quote: Record<string, unknown> | null): number | null {
  return pickNumber(candidate.turnover, quote?.turnover, quote?.tradingValue, quote?.acml_tr_pbmn);
}

function resolveDataHealth(candidate: CandidatePoolInputCandidate): CandidateDataHealth {
  if (candidate.dataHealth === 'CORRUPTED') return 'CORRUPTED';
  if (candidate.corrupted) return 'CORRUPTED';
  if (candidate.staleData) return 'STALE';
  if (candidate.providerIssue) return 'DEGRADED';
  if (candidate.dataHealth) return candidate.dataHealth;
  return 'VERIFIED';
}

function validityFailure(
  candidate: CandidatePoolInputCandidate,
  quote: Record<string, unknown> | null,
  price: number | null,
  input: BuildCandidatePoolInput,
): string | null {
  if (!normalizeSymbol(candidate)) return 'SYMBOL_MISSING';
  if (candidate.quote !== undefined && candidate.quote !== null && quote === null) return 'QUOTE_CORRUPTED';
  if (candidate.untradable || candidate.tradingHalted || candidate.halted) return 'UNTRADABLE_OR_HALTED';
  if (candidate.delisted || candidate.managementIssue) return 'LISTING_RISK_EXCLUDED';
  if (candidate.corrupted || candidate.dataHealth === 'CORRUPTED') return 'CORRUPTED_DATA';
  if (price !== null && price <= 0) return 'PRICE_NON_POSITIVE';

  const turnover = pickNumber(candidate.turnover, quote?.turnover);
  if (input.minTurnover !== undefined && turnover !== null && turnover < input.minTurnover) {
    return 'TURNOVER_BELOW_SYSTEM_MIN';
  }

  const marketCap = pickNumber(candidate.marketCap, quote?.marketCap);
  if (input.minMarketCap !== undefined && marketCap !== null && marketCap < input.minMarketCap) {
    return 'MARKET_CAP_BELOW_SYSTEM_MIN';
  }

  return null;
}

function scoreFromRankPct(rankPct: number | null): number | null {
  if (rankPct === null) return null;
  return Math.max(0, Math.min(15, rankPct * 0.15));
}

function scoreCandidate(
  candidate: CandidatePoolInputCandidate,
  quote: Record<string, unknown> | null,
  missingFeatures: Set<CandidateMissingFeature>,
  runtimeLabels: BuildCandidatePoolInput['runtimeLabels'] | undefined,
): { featureScores: CandidateFeatureScores; penalties: CandidatePenalties; totalScore: number } {
  const price = resolvePrice(candidate, quote);
  const volume = resolveVolume(candidate, quote);
  const turnover = resolveTurnover(candidate, quote);
  const avgVolume = pickNumber(candidate.avgVolume, quote?.avgVolume, quote?.avgVolume20d);
  const volumeRatio = pickNumber(candidate.volumeRatio, quote?.volumeRatio);
  const rsRankPct = pickNumber(candidate.rsRankPct, quote?.rsRankPct);
  const return5d = pickNumber(candidate.return5d, quote?.return5d);
  const return20d = pickNumber(candidate.return20d, quote?.return20d);
  const relativeReturn20d = pickNumber(candidate.relativeReturn20d, quote?.relativeReturn20d);
  const kospi20dReturn = pickNumber((candidate as any).kospi20dReturn, quote?.kospi20dReturn);
  const relativeReturn20dFromReturns =
    return20d !== null && kospi20dReturn !== null ? return20d - kospi20dReturn : null;
  const rsFromRelativeReturn = pickNumber(relativeReturn20d, relativeReturn20dFromReturns);
  const rsScoreFromRelativeReturn: number | null =
    rsFromRelativeReturn !== null
      ? rsFromRelativeReturn >= 10 ? 12
        : rsFromRelativeReturn >= 5 ? 10
        : rsFromRelativeReturn >= 2 ? 7
        : rsFromRelativeReturn >= 0 ? 4
        : 0
      : null;
  const relativeStrength =
    pickNumber(candidate.relativeStrengthScore, quote?.relativeStrengthScore)
    ?? scoreFromRankPct(rsRankPct)
    ?? rsScoreFromRelativeReturn;
  const breakout = pickNumber(candidate.breakoutScore, quote?.breakoutScore);
  const supplyScore = pickNumber(candidate.supplyScore, quote?.supplyScore);
  const sectorScore = pickNumber(candidate.sectorLeadershipScore, quote?.sectorLeadershipScore);
  const vcpScore = pickNumber(candidate.volatilityCompressionScore, quote?.volatilityCompressionScore, candidate.vcpScore);

  if (relativeStrength === null && rsRankPct === null) missingFeatures.add('RS_SCORE_MISSING');
  if (breakout === null) missingFeatures.add('BREAKOUT_SCORE_MISSING');
  if (supplyScore === null) missingFeatures.add('SUPPLY_MISSING');
  if (sectorScore === null) missingFeatures.add('SECTOR_LEADERSHIP_MISSING');
  if (volume === null && turnover === null && volumeRatio === null) missingFeatures.add('VOLUME_ENERGY_MISSING');
  if (return5d === null && return20d === null && relativeReturn20d === null) {
    missingFeatures.add('TECHNICAL_TREND_MISSING');
  }
  if (candidate.programTradeEmpty === true) missingFeatures.add('PROGRAM_TRADE_EMPTY');
  if (candidate.providerIssue || runtimeLabels?.providerIssue) missingFeatures.add('PROVIDER_ISSUE_ISOLATED');
  if (candidate.staleData || runtimeLabels?.staleData) missingFeatures.add('QUOTE_STALE');

  const liquidityScore = Math.max(
    0,
    Math.min(
      20,
      turnover !== null
        ? Math.log10(Math.max(10, turnover)) * 1.5
        : volume !== null
          ? Math.log10(Math.max(10, volume)) * 2
          : 0,
    ),
  );
  const volumeEnergyScore = Math.max(
    0,
    Math.min(12, volumeRatio !== null ? volumeRatio * 4 : avgVolume && volume ? (volume / Math.max(1, avgVolume)) * 4 : 0),
  );
  const trendScore = Math.max(
    0,
    Math.min(15, (return20d ?? 0) * 0.4 + (return5d ?? 0) * 0.5 + (relativeReturn20d ?? 0) * 0.4),
  );
  const dataConfidenceScore = candidate.providerIssue || runtimeLabels?.providerIssue ? 2 : candidate.staleData || runtimeLabels?.staleData ? 4 : 8;
  const featureScores: CandidateFeatureScores = {
    liquidityScore,
    relativeStrengthScore: Math.max(0, Math.min(15, relativeStrength ?? 0)),
    volumeEnergyScore,
    trendScore,
    supplyScore: Math.max(0, Math.min(10, supplyScore ?? 0)),
    breakoutScore: Math.max(0, Math.min(12, breakout ?? 0)),
    sectorLeadershipScore: Math.max(0, Math.min(8, sectorScore ?? 0)),
    volatilityCompressionScore: Math.max(0, Math.min(6, vcpScore ?? 0)),
    macroCompatibilityScore: runtimeLabels?.r6Defense ? 2 : 6,
    dataConfidenceScore,
  };
  for (const [key, value] of Object.entries(candidate.featureScores ?? {}) as Array<[keyof CandidateFeatureScores, unknown]>) {
    const finite = toFiniteNumber(value);
    if (finite !== null) featureScores[key] = finite;
  }

  const overheatPenalty = (return5d ?? 0) > 25 ? 4 : 0;
  const lowLiquidityPenalty = price !== null && volume !== null && price * volume < 50_000_000 ? 2 : 0;
  const penalties: CandidatePenalties = {
    staleDataPenalty: candidate.staleData || runtimeLabels?.staleData ? 3 : 0,
    missingFeaturePenalty: missingFeatures.size * 1.5,
    R6Penalty: runtimeLabels?.r6Defense ? 6 : 0,
    providerIssuePenalty: candidate.providerIssue || runtimeLabels?.providerIssue ? 4 : 0,
    lowLiquidityPenalty,
    overheatPenalty,
  };
  for (const [key, value] of Object.entries(candidate.penalties ?? {}) as Array<[keyof CandidatePenalties, unknown]>) {
    const finite = toFiniteNumber(value);
    if (finite !== null) penalties[key] = finite;
  }

  const baseScore = Object.values(featureScores).reduce((sum, value) => sum + value, 0);
  const penalty = Object.values(penalties).reduce((sum, value) => sum + value, 0);
  return {
    featureScores,
    penalties,
    totalScore: Math.max(0, Number((baseScore - penalty).toFixed(2))),
  };
}

function confidenceFrom(
  candidate: CandidatePoolInputCandidate,
  missingFeatures: Set<CandidateMissingFeature>,
  runtimeLabels: BuildCandidatePoolInput['runtimeLabels'] | undefined,
): CandidateConfidence {
  const providerLow = candidate.providerIssue || runtimeLabels?.providerIssue;
  const dataLow = candidate.staleData || runtimeLabels?.staleData || missingFeatures.has('QUOTE_STALE');
  const technicalLow = missingFeatures.has('TECHNICAL_TREND_MISSING') || missingFeatures.has('RS_SCORE_MISSING') || missingFeatures.has('BREAKOUT_SCORE_MISSING');
  const supplyLow = missingFeatures.has('SUPPLY_MISSING');
  const confidence: CandidateConfidence = {
    overall: providerLow || dataLow || technicalLow || supplyLow ? 'LOW' : 'HIGH',
    data: dataLow ? 'LOW' : 'HIGH',
    technical: technicalLow ? 'LOW' : 'HIGH',
    supply: supplyLow ? 'LOW' : 'HIGH',
    provider: providerLow ? 'LOW' : 'HIGH',
  };
  return {
    ...confidence,
    ...candidate.confidence,
  };
}

function buildSnapshot(
  candidate: CandidatePoolInputCandidate,
  defaultTag: CandidateSourceTag,
  input: BuildCandidatePoolInput,
): { snapshot?: CandidateSnapshot; invalidReason?: string } {
  const quote = resolveQuote(candidate);
  const price = resolvePrice(candidate, quote);
  const invalidReason = validityFailure(candidate, quote, price, input);
  if (invalidReason) return { invalidReason };

  const symbol = normalizeSymbol(candidate);
  if (!symbol) return { invalidReason: 'SYMBOL_MISSING' };

  const missingFeatures = new Set<CandidateMissingFeature>(candidate.missingFeatures ?? []);
  const scored = scoreCandidate(candidate, quote, missingFeatures, input.runtimeLabels);
  const labels = new Set<CandidateLearningLabel>([
    'CANDIDATE_EVALUATION_ACTIVE',
    'LIVE_PERMISSION_SEPARATED',
    'SHADOW_CANDIDATE_TRACKING_ON',
    'COUNTERFACTUAL_RECORDING_ON',
  ]);
  if (missingFeatures.size > 0) labels.add('MISSING_FEATURE_SCORED');
  if (input.runtimeLabels?.providerIssue || candidate.providerIssue) labels.add('PROVIDER_ISSUE_ISOLATED');
  if (input.runtimeLabels?.r6Defense) labels.add('R6_PENALTY_ONLY');
  if (input.runtimeLabels?.sellOnly) labels.add('SELL_ONLY_EVALUATION_CONTINUED');
  if (input.runtimeLabels?.kellyZero) labels.add('KELLY_ADVISORY_ONLY');
  if (defaultTag === 'FALLBACK_BROAD_UNIVERSE' || defaultTag === 'PREVIOUS_DAY_TOP_RANKED' || defaultTag === 'OPEN_SHADOW_WATCHLIST') {
    labels.add('FALLBACK_CANDIDATE');
  }

  const diagnosticReason: string[] = [...missingFeatures];
  if (input.runtimeLabels?.r6Defense) diagnosticReason.push('R6_DEFENSE_SCORED_AS_PENALTY');
  if (input.runtimeLabels?.sellOnly) diagnosticReason.push('SELL_ONLY_LIVE_PERMISSION_ONLY');
  if (input.runtimeLabels?.kellyZero) diagnosticReason.push('KELLY_ADVISORY_ONLY');
  if (input.runtimeLabels?.providerIssue || candidate.providerIssue) diagnosticReason.push('PROVIDER_ISSUE_MARKET_SIGNAL_FALSE');

  return {
    snapshot: {
      sourceSnapshotId: input.sourceSnapshotId,
      symbol,
      name: String(candidate.name ?? candidate.stockName ?? symbol),
      market: String(candidate.market ?? 'KRX'),
      sector: String(candidate.sector ?? 'UNKNOWN'),
      sourceTags: collectTags(candidate, defaultTag),
      quote,
      price,
      volume: resolveVolume(candidate, quote),
      turnover: resolveTurnover(candidate, quote),
      dataHealth: resolveDataHealth(candidate),
      confidence: confidenceFrom(candidate, missingFeatures, input.runtimeLabels),
      missingFeatures: [...missingFeatures],
      featureScores: scored.featureScores,
      penalties: scored.penalties,
      totalScore: scored.totalScore,
      rank: 0,
      evaluationEligible: true,
      shadowEligible: true,
      counterfactualEligible: true,
      liveOrderEligible: input.liveOrderAllowed === true,
      exclusionReason: null,
      diagnosticReason,
      learningLabels: [...labels],
    },
  };
}

function mergeSnapshot(existing: CandidateSnapshot, incoming: CandidateSnapshot): CandidateSnapshot {
  const sourceTags = new Set<CandidateSourceTag>([...existing.sourceTags, ...incoming.sourceTags]);
  const missingFeatures = new Set<CandidateMissingFeature>([...existing.missingFeatures, ...incoming.missingFeatures]);
  const learningLabels = new Set<CandidateLearningLabel>([...existing.learningLabels, ...incoming.learningLabels]);
  const featureScores = { ...existing.featureScores };
  for (const [key, value] of Object.entries(incoming.featureScores) as Array<[keyof CandidateFeatureScores, number]>) {
    featureScores[key] = Math.max(featureScores[key] ?? 0, value);
  }
  const penalties = { ...existing.penalties };
  for (const [key, value] of Object.entries(incoming.penalties) as Array<[keyof CandidatePenalties, number]>) {
    penalties[key] = Math.max(penalties[key] ?? 0, value);
  }
  const baseScore = Object.values(featureScores).reduce((sum, value) => sum + value, 0);
  const penaltyScore = Object.values(penalties).reduce((sum, value) => sum + value, 0);
  return {
    ...existing,
    sourceTags: [...sourceTags],
    missingFeatures: [...missingFeatures],
    learningLabels: [...learningLabels],
    featureScores,
    penalties,
    totalScore: Math.max(existing.totalScore, incoming.totalScore, Number((baseScore - penaltyScore).toFixed(2))),
    price: existing.price ?? incoming.price,
    volume: existing.volume ?? incoming.volume,
    turnover: existing.turnover ?? incoming.turnover,
    quote: existing.quote ?? incoming.quote,
    diagnosticReason: [...new Set([...existing.diagnosticReason, ...incoming.diagnosticReason])],
    liveOrderEligible: existing.liveOrderEligible || incoming.liveOrderEligible,
  };
}

function addCandidates(
  result: {
    snapshots: Map<string, CandidateSnapshot>;
    invalidReasonCounts: Record<string, number>;
    duplicateSymbols: Set<string>;
    duplicateMergedCount: number;
  },
  candidates: CandidatePoolInputCandidate[] | undefined,
  tag: CandidateSourceTag,
  input: BuildCandidatePoolInput,
): number {
  let imported = 0;
  for (const candidate of candidates ?? []) {
    imported += 1;
    const built = buildSnapshot(candidate, tag, input);
    if (!built.snapshot) {
      const reason = built.invalidReason ?? 'UNKNOWN_INVALID';
      result.invalidReasonCounts[reason] = (result.invalidReasonCounts[reason] ?? 0) + 1;
      continue;
    }
    const key = `${input.sourceSnapshotId}:${built.snapshot.market}:${built.snapshot.symbol}`;
    const existing = result.snapshots.get(key);
    if (existing) {
      result.snapshots.set(key, mergeSnapshot(existing, built.snapshot));
      result.duplicateSymbols.add(built.snapshot.symbol);
      result.duplicateMergedCount += 1;
    } else {
      result.snapshots.set(key, built.snapshot);
    }
  }
  return imported;
}

function topCounts<T extends string>(values: T[], key: string): Array<Record<string, unknown>> {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([value, count]) => ({ [key]: value, count }));
}

function topPenaltyAverages(snapshots: CandidateSnapshot[]): Array<{ penalty: keyof CandidatePenalties; avg: number; count: number }> {
  const totals = new Map<keyof CandidatePenalties, { sum: number; count: number }>();
  for (const snapshot of snapshots) {
    for (const [penalty, value] of Object.entries(snapshot.penalties) as Array<[keyof CandidatePenalties, number]>) {
      if (value <= 0) continue;
      const current = totals.get(penalty) ?? { sum: 0, count: 0 };
      current.sum += value;
      current.count += 1;
      totals.set(penalty, current);
    }
  }
  return [...totals.entries()]
    .map(([penalty, value]) => ({ penalty, avg: Number((value.sum / Math.max(1, value.count)).toFixed(2)), count: value.count }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 8);
}

function fallbackTriggerReasons(input: BuildCandidatePoolInput, validCount: number, hydratedCount: number): string[] {
  const reasons: string[] = [];
  const signals = input.zeroSurvivorSignals ?? {};
  if (validCount === 0) reasons.push('VALID_COUNT_ZERO');
  if (hydratedCount === 0) reasons.push('HYDRATED_COUNT_ZERO');
  if ((signals.gateEntryCandidates ?? 1) === 0) reasons.push('GATE_ENTRY_CANDIDATES_ZERO');
  if ((signals.watchlistImported ?? 1) === 0) reasons.push('WATCHLIST_IMPORTED_ZERO');
  if ((signals.rsScoreUsable ?? 1) === 0 && (signals.breakoutScoreUsable ?? 1) === 0) {
    reasons.push('RS_AND_BREAKOUT_UNUSABLE');
  }
  return [...new Set(reasons)];
}

function sortedFallbackSources(input: BuildCandidatePoolInput): Array<[CandidateSourceTag, CandidatePoolInputCandidate[] | undefined]> {
  const highLiquidity =
    input.highLiquidityCandidates ??
    [...(input.fallbackBroadUniverse ?? [])].sort((a, b) => {
      const aq = resolveQuote(a);
      const bq = resolveQuote(b);
      return (resolveTurnover(b, bq) ?? resolveVolume(b, bq) ?? 0) - (resolveTurnover(a, aq) ?? resolveVolume(a, aq) ?? 0);
    });
  return [
    ['PREVIOUS_DAY_TOP_RANKED', input.previousDayTopRankedCandidates],
    ['OPEN_SHADOW_WATCHLIST', input.openShadowWatchlist],
    ['HIGH_LIQUIDITY', highLiquidity],
    ['SECTOR_LEADER', input.sectorLeaders],
    ['VOLUME_SPIKE', input.volumeSpikeCandidates],
    ['FALLBACK_BROAD_UNIVERSE', input.fallbackBroadUniverse],
  ];
}

function buildCounterfactualRecords(snapshots: CandidateSnapshot[]): CandidateCounterfactualRecord[] {
  return snapshots.map((snapshot) => ({
    sourceSnapshotId: snapshot.sourceSnapshotId,
    symbol: snapshot.symbol,
    candidateRank: snapshot.rank,
    totalScore: snapshot.totalScore,
    gateResult: {
      diagnosticPass: snapshot.evaluationEligible,
      shadowPass: snapshot.shadowEligible,
      livePass: snapshot.liveOrderEligible,
      liveOrderAllowed: snapshot.liveOrderEligible,
    },
    blockReason: snapshot.liveOrderEligible ? null : 'LIVE_PERMISSION_SEPARATED',
    penaltyLabels: Object.entries(snapshot.penalties)
      .filter(([, value]) => value > 0)
      .map(([key]) => key),
    missingFeatures: snapshot.missingFeatures,
    hypotheticalEntryPrice: snapshot.price,
    stopLoss: null,
    targetPrice: null,
    outcomePending: true,
    learningLabel: snapshot.learningLabels.includes('FALLBACK_CANDIDATE')
      ? 'FALLBACK_CANDIDATE'
      : snapshot.totalScore <= 0
        ? 'BLOCKED_CANDIDATE'
        : 'WATCHLIST_CANDIDATE',
  }));
}

function emitRuntimeLogs(result: CandidatePoolResult): void {
  const base = {
    sourceSnapshotId: result.sourceSnapshotId,
    importedCount: result.importedCount,
    validCount: result.validCount,
    hydratedCount: result.hydratedCount,
    rankedCandidates: result.rankedCandidates,
    fallbackUsed: result.fallbackUsed,
    executionImpact: 'NONE',
  };
  console.info('[CANDIDATE_POOL_BUILT]', base);
  console.info('[CANDIDATE_MINIMAL_VALIDITY_FILTER_APPLIED]', {
    invalidExcludedCount: result.invalidExcludedCount,
    invalidReasonCounts: result.diagnostics.invalidReasonCounts,
    executionImpact: 'NONE',
  });
  console.info('[CANDIDATE_SNAPSHOT_CREATED]', {
    candidateSnapshots: result.candidateSnapshots.length,
    sourceSnapshotId: result.sourceSnapshotId,
  });
  console.info('[CANDIDATE_FEATURE_MISSING_SCORED]', {
    topMissingFeatures: result.diagnostics.topMissingFeatures,
    marketSignal: false,
    executionImpact: 'NONE',
  });
  console.info('[CANDIDATE_RANKING_COMPLETED]', {
    rankedCandidates: result.rankedCandidates,
    topSymbols: result.candidateSnapshots.slice(0, 5).map((candidate) => candidate.symbol),
  });
  if (result.diagnostics.duplicateMergedCount > 0) {
    console.info('[CANDIDATE_SOURCE_TAGS_MERGED] [CANDIDATE_DUPLICATE_ROW_MERGED]', {
      duplicateMergedCount: result.diagnostics.duplicateMergedCount,
      duplicateSymbols: result.diagnostics.duplicateSymbols.slice(0, 10),
    });
  }
  if (result.fallbackUsed) {
    console.info('[CANDIDATE_FALLBACK_USED] [ZERO_SURVIVOR_PREVENTED] [FALLBACK_CANDIDATE_SET_BUILT]', {
      fallbackReason: result.fallbackReason,
      fallbackTriggerReasons: result.diagnostics.fallbackTriggerReasons,
      candidateSnapshots: result.candidateSnapshots.length,
    });
  }
  console.info('[GATE_EVALUATION_CONTINUED_FOR_CANDIDATES]', {
    gateEvaluated: result.gateEvaluated,
    candidateDiagnosticScorePositive: result.candidateDiagnosticScorePositive,
    executionImpact: 'NONE',
  });
  console.info('[WATCHLIST_COUNTERFACTUAL_RECORDED] [COUNTERFACTUAL_CANDIDATE_RECORDED]', {
    counterfactualRecorded: result.counterfactualRecorded,
    executionImpact: 'NONE',
  });
  console.info('[LIVE_PERMISSION_SEPARATED_FROM_CANDIDATE_EVALUATION]', {
    liveOrderEligible: result.candidateSnapshots.filter((candidate) => candidate.liveOrderEligible).length,
    evaluationEligible: result.candidateSnapshots.filter((candidate) => candidate.evaluationEligible).length,
    shadowEligible: result.shadowEligible,
    executionImpact: 'NONE',
  });
}

export function buildCandidatePool(input: BuildCandidatePoolInput): CandidatePoolResult {
  const state = {
    snapshots: new Map<string, CandidateSnapshot>(),
    invalidReasonCounts: {} as Record<string, number>,
    duplicateSymbols: new Set<string>(),
    duplicateMergedCount: 0,
  };
  let importedCount = 0;

  importedCount += addCandidates(state, input.existingWatchlist, 'WATCHLIST', input);
  importedCount += addCandidates(state, input.intradayMovers, 'INTRADAY_MOVER', input);
  importedCount += addCandidates(state, input.buyList, 'BUY_LIST', input);
  importedCount += addCandidates(state, input.previousStrongCandidates, 'PREVIOUS_STRONG', input);
  importedCount += addCandidates(state, input.sectorLeaders, 'SECTOR_LEADER', input);
  importedCount += addCandidates(state, input.volumeSpikeCandidates, 'VOLUME_SPIKE', input);
  importedCount += addCandidates(state, input.rsCandidates, 'RS_CANDIDATE', input);
  importedCount += addCandidates(state, input.breakoutCandidates, 'BREAKOUT_CANDIDATE', input);

  let snapshots = [...state.snapshots.values()];
  const preFallbackValidCount = snapshots.length;
  const preFallbackHydratedCount = snapshots.filter((candidate) => candidate.price !== null || candidate.quote !== null).length;
  const triggerReasons = fallbackTriggerReasons(input, preFallbackValidCount, preFallbackHydratedCount);
  const fallbackLimit = input.fallbackLimit ?? 50;

  if (triggerReasons.length > 0) {
    let fallbackAdded = 0;
    for (const [tag, source] of sortedFallbackSources(input)) {
      if (fallbackAdded >= fallbackLimit) break;
      const selected = (source ?? []).slice(0, Math.max(0, fallbackLimit - fallbackAdded));
      fallbackAdded += addCandidates(state, selected, tag, input);
      importedCount += selected.length;
    }
    snapshots = [...state.snapshots.values()];
  }

  snapshots = snapshots
    .sort((a, b) => b.totalScore - a.totalScore || a.symbol.localeCompare(b.symbol))
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

  const hydratedCount = snapshots.filter((candidate) => candidate.price !== null || candidate.quote !== null).length;
  const counterfactualRecords = buildCounterfactualRecords(snapshots);
  const fallbackUsed = triggerReasons.length > 0 && snapshots.length > preFallbackValidCount;
  const logTags = [
    '[CANDIDATE_POOL_BUILT]',
    '[CANDIDATE_MINIMAL_VALIDITY_FILTER_APPLIED]',
    '[CANDIDATE_SNAPSHOT_CREATED]',
    '[CANDIDATE_FEATURE_MISSING_SCORED]',
    '[CANDIDATE_RANKING_COMPLETED]',
    ...(state.duplicateMergedCount > 0 ? ['[CANDIDATE_SOURCE_TAGS_MERGED]', '[CANDIDATE_DUPLICATE_ROW_MERGED]'] : []),
    ...(fallbackUsed ? ['[CANDIDATE_FALLBACK_USED]', '[ZERO_SURVIVOR_PREVENTED]', '[FALLBACK_CANDIDATE_SET_BUILT]'] : []),
    '[GATE_EVALUATION_CONTINUED_FOR_CANDIDATES]',
    '[WATCHLIST_COUNTERFACTUAL_RECORDED]',
    '[COUNTERFACTUAL_CANDIDATE_RECORDED]',
    '[LIVE_PERMISSION_SEPARATED_FROM_CANDIDATE_EVALUATION]',
  ];

  const result: CandidatePoolResult = {
    sourceSnapshotId: input.sourceSnapshotId,
    asOf: input.asOf ?? new Date().toISOString(),
    ttlSec: input.ttlSec ?? 300,
    totalUniverseCount: input.totalUniverseCount ?? importedCount,
    importedCount,
    validCount: snapshots.length,
    invalidExcludedCount: Object.values(state.invalidReasonCounts).reduce((sum, value) => sum + value, 0),
    hydratedCount,
    rankedCandidates: snapshots.length,
    gateEvaluated: snapshots.filter((candidate) => candidate.evaluationEligible).length,
    candidateDiagnosticScorePositive: snapshots.filter((candidate) => candidate.evaluationEligible && candidate.totalScore > 0).length,
    shadowEligible: snapshots.filter((candidate) => candidate.shadowEligible).length,
    counterfactualRecorded: counterfactualRecords.length,
    fallbackUsed,
    ...(fallbackUsed ? { fallbackReason: triggerReasons.join(',') } : {}),
    candidateSnapshots: snapshots,
    diagnostics: {
      invalidReasonCounts: state.invalidReasonCounts,
      topCandidateSources: topCounts(snapshots.flatMap((candidate) => candidate.sourceTags), 'source') as Array<{ source: CandidateSourceTag; count: number }>,
      topMissingFeatures: topCounts(snapshots.flatMap((candidate) => candidate.missingFeatures), 'feature') as Array<{ feature: CandidateMissingFeature; count: number }>,
      topPenalties: topPenaltyAverages(snapshots),
      fallbackTriggerReasons: triggerReasons,
      duplicateMergedCount: state.duplicateMergedCount,
      duplicateSymbols: [...state.duplicateSymbols],
      logTags,
      counterfactualRecords,
      ...(input.featureCoverage ? { featureCoverage: input.featureCoverage } : {}),
    },
  };

  if (input.emitLogs !== false) emitRuntimeLogs(result);
  return result;
}

function finiteCount(value: unknown, total: number): number | null {
  const n = toFiniteNumber(value);
  if (n === null) return null;
  return Math.max(0, Math.min(total, Math.round(n)));
}

function formatCount(count: number | null, total: number): string {
  return count === null ? `unknown/${total}` : `${count}/${total}`;
}

function formatPct(value: unknown): string {
  const n = toFiniteNumber(value);
  if (n === null) return 'unknown';
  const pct = n <= 1 ? n * 100 : n;
  return `${pct.toFixed(1)}%`;
}

function buildFeatureCoverageDisplay(
  result: CandidatePoolResult,
  total: number,
  countMissing: (feature: CandidateMissingFeature) => number,
): {
  actualMissingFeatures: string;
  topFeaturePromotionGaps: string;
  featureCoverageLines: string[];
} {
  const coverage = result.diagnostics.featureCoverage;
  const fallbackRsMissing = countMissing('RS_SCORE_MISSING');
  const fallbackBreakoutMissing = countMissing('BREAKOUT_SCORE_MISSING');
  const fallbackSupplyMissing = countMissing('SUPPLY_MISSING');
  const fallbackSectorMissing = countMissing('SECTOR_LEADERSHIP_MISSING');
  const fallbackVolumeMissing = countMissing('VOLUME_ENERGY_MISSING');
  const hasAnyVolumeRaw = result.candidateSnapshots.some((s) => Number.isFinite(s.volume ?? NaN) && Number(s.volume) > 0);

  const rsActualBasisName =
    coverage?.rs?.selectedBasisForActualMissing ??
    (coverage?.rs?.traceAvailable !== undefined ? 'traceAvailableFromForensic'
      : coverage?.rs?.rawComputed !== undefined ? 'rawComputedFromRuntimeWiring'
        : coverage?.rs?.gateApplied !== undefined ? 'gateAppliedFromAlignment'
          : 'candidateMissingFeatureFallback');
  const rsActualBasis = finiteCount(
    rsActualBasisName.includes('trace') ? coverage?.rs?.traceAvailable
      : rsActualBasisName.includes('raw') ? coverage?.rs?.rawComputed
        : rsActualBasisName.includes('gate') ? coverage?.rs?.gateApplied
          : total - fallbackRsMissing,
    total,
  );
  const rsRawInputMissing = rsActualBasis === null ? fallbackRsMissing : Math.max(0, total - rsActualBasis);
  const rsPromotionBasisName = coverage?.rs?.selectedBasisForPromotionGap ?? 'scoreUsableFromForensic';
  const rsPromotionBasis = finiteCount(
    rsPromotionBasisName.includes('gate') ? coverage?.rs?.gateApplied : coverage?.rs?.scoreUsable,
    total,
  );
  const rsScoreNotPromoted = rsPromotionBasis === null ? fallbackRsMissing : Math.max(0, total - rsPromotionBasis);

  const breakoutActualBasisName =
    coverage?.breakout?.selectedBasisForActualMissing ??
    (coverage?.breakout?.traceAvailableAlignment !== undefined ? 'alignment.traceAvailable'
      : coverage?.breakout?.traceAvailableRuntime !== undefined ? 'runtimeMapping.traceAvailable'
        : coverage?.breakout?.mapped !== undefined ? 'runtimeWiring.mapped'
          : 'candidateMissingFeatureFallback');
  const breakoutActualBasis = finiteCount(
    breakoutActualBasisName.includes('alignment') ? coverage?.breakout?.traceAvailableAlignment
      : breakoutActualBasisName.includes('runtimeMapping') ? coverage?.breakout?.traceAvailableRuntime
        : breakoutActualBasisName.includes('runtimeWiring') ? coverage?.breakout?.mapped
          : total - fallbackBreakoutMissing,
    total,
  );
  const breakoutRawTraceMissing = breakoutActualBasis === null ? fallbackBreakoutMissing : Math.max(0, total - breakoutActualBasis);
  const breakoutPromotionBasisName = coverage?.breakout?.selectedBasisForPromotionGap ?? (
    coverage?.breakout?.scoreMappedToGateAlignment !== undefined ? 'alignment.scoreMappedToGate' : 'runtimeMapping.scoreMappedToGate'
  );
  const breakoutPromotionBasis = finiteCount(
    breakoutPromotionBasisName.includes('alignment') ? coverage?.breakout?.scoreMappedToGateAlignment : coverage?.breakout?.scoreMappedToGateRuntime,
    total,
  );
  const breakoutScoreNotPromoted = breakoutPromotionBasis === null ? fallbackBreakoutMissing : Math.max(0, total - breakoutPromotionBasis);

  const supplyInjected = finiteCount(coverage?.supply?.injected, total);
  const supplyInjectedMissing = supplyInjected === null ? 0 : Math.max(0, total - supplyInjected);
  const supplySemanticAvailable = finiteCount(coverage?.supply?.semanticAvailable, total);
  const supplyShadowOnlyRows = finiteCount(coverage?.supply?.shadowOnlyRows, total);
  const supplySemanticMissing =
    supplyShadowOnlyRows ??
    (supplySemanticAvailable === null ? fallbackSupplyMissing : Math.max(0, total - supplySemanticAvailable));

  const officialCoverage =
    coverage?.sectorLeadership?.verifiedIndexCodeCoverage ??
    coverage?.sectorLeadership?.officialIndexCoverage;
  const officialMissingLabel = toFiniteNumber(officialCoverage) === 0
    ? `true(officialCoverage=${formatPct(officialCoverage)})`
    : toFiniteNumber(officialCoverage) === null
      ? `${fallbackSectorMissing}/${total}`
      : `false(officialCoverage=${formatPct(officialCoverage)})`;
  const sectorCanonical = sectorEnergyCanonicalOrMissing(coverage?.sectorLeadership?.sectorEnergyCanonicalState);
  const lockedSectorLeadership = lockSectorEnergyOutputToCanonical({
    legacyPromotionAllowedDiagnosticOnly: coverage?.sectorLeadership?.promotionAllowed,
    legacySectorBoostAllowedDiagnosticOnly: coverage?.sectorLeadership?.sectorBoostAllowed,
    legacyStrongBuyAllowedDiagnosticOnly: coverage?.sectorLeadership?.strongBuyAllowed,
    legacyLeadershipConfidenceDiagnosticOnly: coverage?.sectorLeadership?.leadershipConfidence,
    legacySelectedSourceTierDiagnosticOnly: coverage?.sectorLeadership?.selectedSourceTier,
  }, sectorCanonical);

  const rawVolumeAvailable = coverage?.volumeEnergy?.rawVolumeFieldAvailable === true || hasAnyVolumeRaw;
  const volumeEnergyRawMissing = rawVolumeAvailable
    ? `false(rawVolumeExists${coverage?.volumeEnergy?.rawVolumeFieldKeys?.length ? `:${coverage.volumeEnergy.rawVolumeFieldKeys.join('|')}` : ''})`
    : `${fallbackVolumeMissing}/${total}`;
  const volumeEnergyNotPromoted = rawVolumeAvailable && coverage?.volumeEnergy?.volumeEnergyPromoted !== true;

  const actualMissingFeatures = [
    `rsRawInputMissing=${rsRawInputMissing}/${total}`,
    `breakoutRawTraceMissing=${breakoutRawTraceMissing}/${total}`,
    `supplyInjectedMissing=${supplyInjectedMissing}/${total}`,
    `supplySemanticMissing=${supplySemanticMissing}/${total}`,
    `sectorLeadershipOfficialMissing=${officialMissingLabel}`,
    `volumeEnergyRawMissing=${volumeEnergyRawMissing}`,
    'note=actual missing only; promotion gaps listed separately',
  ].join(', ');

  const topFeaturePromotionGaps = [
    `RS_SCORE_NOT_PROMOTED=${rsScoreNotPromoted}/${total}(basis=${rsPromotionBasisName})`,
    `BREAKOUT_SCORE_NOT_PROMOTED=${breakoutScoreNotPromoted}/${total}(basis=${breakoutPromotionBasisName})`,
    `SUPPLY_PARTIAL_ELIGIBLE=${formatCount(finiteCount(coverage?.supply?.gateEligibleRows, total), total)}`,
    `SUPPLY_SHADOW_ONLY_NEUTRAL_UNKNOWN=${supplySemanticMissing}/${total}`,
    `SECTOR_OFFICIAL_PROMOTION_DISABLED=${lockedSectorLeadership.promotionAllowed === false}`,
    `VOLUME_ENERGY_NOT_PROMOTED=${volumeEnergyNotPromoted}`,
  ].join(', ');

  const featureCoverageLines = [
    '- featureCoverage:',
    `  RS rawComputed=${formatCount(finiteCount(coverage?.rs?.rawComputed, total), total)} traceAvailable=${formatCount(finiteCount(coverage?.rs?.traceAvailable, total), total)} gateApplied=${formatCount(finiteCount(coverage?.rs?.gateApplied, total), total)} scoreUsable=${formatCount(finiteCount(coverage?.rs?.scoreUsable, total), total)} actualMissing.rawInputMissing=${rsRawInputMissing}/${total} promotionGap.scoreNotPromoted=${rsScoreNotPromoted}/${total} sourceBasis.actual=${rsActualBasisName} sourceBasis.promotion=${rsPromotionBasisName} status=${rsRawInputMissing === 0 ? 'COMPUTED' : 'PARTIAL'}`,
    `  BREAKOUT mapped=${formatCount(finiteCount(coverage?.breakout?.mapped, total), total)} traceAvailableRuntime=${formatCount(finiteCount(coverage?.breakout?.traceAvailableRuntime, total), total)} traceAvailableAlignment=${formatCount(finiteCount(coverage?.breakout?.traceAvailableAlignment, total), total)} runtimeScoreComputed=${formatCount(finiteCount(coverage?.breakout?.runtimeScoreComputed, total), total)} scoreMappedRuntime=${formatCount(finiteCount(coverage?.breakout?.scoreMappedToGateRuntime, total), total)} scoreMappedAlignment=${formatCount(finiteCount(coverage?.breakout?.scoreMappedToGateAlignment, total), total)} actualMissing.rawTraceMissing=${breakoutRawTraceMissing}/${total} promotionGap.scoreNotPromoted=${breakoutScoreNotPromoted}/${total} zeroByCondition=${formatCount(finiteCount(coverage?.breakout?.zeroByCondition, total), total)} sourceBasis.actual=${breakoutActualBasisName} sourceBasis.promotion=${breakoutPromotionBasisName} status=${breakoutRawTraceMissing === 0 ? 'COMPUTED_BUT_CONDITION_ZERO' : 'PARTIAL'}`,
    `  SUPPLY injected=${formatCount(supplyInjected, total)} displayUsable=${formatCount(finiteCount(coverage?.supply?.verified, total), total)} symbolMatched=${formatCount(finiteCount(coverage?.supply?.symbolMatched, total), total)} semanticAvailable=${formatCount(supplySemanticAvailable, total)} gateScoreEligible=${formatCount(finiteCount(coverage?.supply?.gateEligibleRows, total), total)} shadowOnlyRows=${formatCount(supplyShadowOnlyRows, total)} actualMissing.injectedMissing=${supplyInjectedMissing}/${total} actualMissing.semanticMissing=${supplySemanticMissing}/${total} status=PARTIAL_ELIGIBLE`,
    `  SECTOR_LEADERSHIP sourceOfTruth=${lockedSectorLeadership.sourceOfTruth} universeType=${lockedSectorLeadership.universeType} officialSectorCount=${lockedSectorLeadership.officialSectorCount} verifiedOfficialSectorCount=${lockedSectorLeadership.verifiedOfficialSectorCount} promotionCoverage=${formatPct(lockedSectorLeadership.promotionCoverage)} requiredPromotionCoverage=${formatPct(lockedSectorLeadership.requiredPromotionCoverage)} promotionCoveragePass=${lockedSectorLeadership.promotionCoveragePass} promotionAllowed=${lockedSectorLeadership.promotionAllowed} sectorBoostAllowed=${lockedSectorLeadership.sectorBoostAllowed} strongBuyAllowed=${lockedSectorLeadership.strongBuyAllowed} shadowLeadershipAllowed=${lockedSectorLeadership.shadowLeadershipAllowed} counterfactualAllowed=${lockedSectorLeadership.counterfactualAllowed} selectedSourceTier=${lockedSectorLeadership.selectedSourceTier} dataQuality=${lockedSectorLeadership.dataQuality} confidence=${lockedSectorLeadership.confidence} status=${lockedSectorLeadership.dataQuality} reason=${lockedSectorLeadership.reason} diagnostic.oldOfficialIndexCoverage=${formatPct(coverage?.sectorLeadership?.officialIndexCoverage)} diagnostic.verifiedIndexCodeCoverage=${formatPct(coverage?.sectorLeadership?.verifiedIndexCodeCoverage)} diagnostic.internalGroupedSnapshotCoverage=${formatPct(coverage?.sectorLeadership?.internalGroupedSnapshotCoverage ?? coverage?.sectorLeadership?.internalProxyCoverage)} diagnostic.internalGroupedValidSectorCount=${coverage?.sectorLeadership?.internalGroupedValidSectorCount ?? 0}/${coverage?.sectorLeadership?.internalGroupedExpectedSectorCount ?? 0} diagnostic.stockDailyFallbackCoverage=${formatPct(coverage?.sectorLeadership?.stockDailyFallbackCoverage)} diagnostic.kisBasketDerivedStatus=DIAGNOSTIC_ONLY diagnosticValuesDoNotDrivePromotion=true actualMissing.officialIndexMissing=${toFiniteNumber(officialCoverage) === 0}`,
    `  VOLUME_ENERGY rawVolumeFieldAvailable=${rawVolumeAvailable} rawVolumeFieldKeys=${coverage?.volumeEnergy?.rawVolumeFieldKeys?.join('|') || (hasAnyVolumeRaw ? 'candidateSnapshot.volume' : 'none')} actualMissing.rawVolumeMissing=${!rawVolumeAvailable} promotionGap.volumeEnergyNotPromoted=${volumeEnergyNotPromoted} status=${rawVolumeAvailable ? 'RAW_AVAILABLE_SCORE_NOT_PROMOTED' : 'RAW_MISSING'}`,
  ];

  return { actualMissingFeatures, topFeaturePromotionGaps, featureCoverageLines };
}

export function formatCandidatePoolSection(result?: CandidatePoolResult): string | null {
  if (!result) return null;
  const topSources = result.diagnostics.topCandidateSources
    .slice(0, 5)
    .map((item) => `${item.source}=${item.count}`)
    .join(', ') || 'none';

  const total = Math.max(1, result.validCount);
  const countMissing = (feature: CandidateMissingFeature): number =>
    result.candidateSnapshots.filter((s) => s.missingFeatures.includes(feature)).length;
  const featureCoverageDisplay = buildFeatureCoverageDisplay(result, total, countMissing);

  const topFeatureConfidencePenalties = result.diagnostics.topPenalties
    .slice(0, 5)
    .map((item) => `${item.penalty}=avg${item.avg}/n${item.count}`)
    .join(', ') || 'none';

  const debugLegacyDiag = String(process.env.DEBUG_LEGACY_DIAG ?? '').toLowerCase() === 'true';
  const deprecatedTopMissing = debugLegacyDiag
    ? result.diagnostics.topMissingFeatures
      .filter((item) => item.feature !== 'SUPPLY_MISSING')
      .slice(0, 5)
      .map((item) => `${item.feature}=${item.count}`)
      .join(', ') || 'none'
    : null;

  return [
    '[Candidate Pool Runtime]',
    `- sourceSnapshotId=${result.sourceSnapshotId}`,
    `- asOf=${result.asOf} ttlSec=${result.ttlSec}`,
    `- totalUniverse=${result.totalUniverseCount}`,
    `- importedCandidates=${result.importedCount}`,
    `- validCandidates=${result.validCount}`,
    `- invalidExcluded=${result.invalidExcludedCount}`,
    `- hydratedCandidates=${result.hydratedCount}`,
    `- rankedCandidates=${result.rankedCandidates}`,
    `- gateEvaluated=${result.gateEvaluated}`,
    '- Candidate Pool Counts:',
    `  totalUniverse=${result.totalUniverseCount}`,
    `  validCandidates=${result.validCount}`,
    `  rankedCandidates=${result.rankedCandidates}`,
    `  gateEvaluated=${result.gateEvaluated}`,
    `  candidateDiagnosticScorePositive=${result.candidateDiagnosticScorePositive}`,
    `- shadowEligible=${result.shadowEligible}`,
    `- universeCounterfactualRowsCreated=${result.counterfactualRecorded}`,
    `- fallbackUsed=${result.fallbackUsed}${result.fallbackReason ? ` reason=${result.fallbackReason}` : ''}`,
    `- topCandidateSources=${topSources}`,
    `- actualMissingFeatures=${featureCoverageDisplay.actualMissingFeatures}`,
    ...featureCoverageDisplay.featureCoverageLines,
    `- topFeaturePromotionGaps=${featureCoverageDisplay.topFeaturePromotionGaps}`,
    `- topFeatureConfidencePenalties=${topFeatureConfidencePenalties}`,
    ...(debugLegacyDiag ? [`- topMissingFeatures(deprecated)=${deprecatedTopMissing}`, '- LEGACY_FIELD_DO_NOT_USE_FOR_DECISION'] : []),
    '- Candidate evaluation active',
    '- Live order permission separated',
    '- Shadow candidate tracking ON',
    '- Counterfactual recording ON',
    `- Fallback candidate set ${result.fallbackUsed ? 'active' : 'inactive'}`,
    '- Missing features scored as confidence penalty',
    '- marketSignal=false for provider issue diagnostics',
    '- executionImpact=NONE',
  ].join('\n');
}
