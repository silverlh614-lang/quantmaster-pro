// @responsibility SSOT snapshot contract + unified gate/policy/execution/learning context wiring.

export type MarketSession = 'REGULAR' | 'AFTERMARKET' | 'PREMARKET' | 'CLOSED';
export type ProviderStatus = 'VERIFIED' | 'PARTIAL' | 'MISSING' | 'DEGRADED' | 'NOT_FETCHED';
export type TechnicalIndicatorStatus = 'COMPUTED' | 'PARTIAL' | 'NOT_COMPUTED' | 'MISSING' | 'STALE';

export type TechnicalTrendMissingReason =
  | 'KIS_QUOTE_VERIFIED_BUT_OHLCV_NOT_FETCHED'
  | 'KIS_OHLCV_FETCHED_BUT_INDICATOR_NOT_COMPUTED'
  | 'INDICATOR_COMPUTED_BUT_FEATURE_SNAPSHOT_DROPPED'
  | 'FEATURE_SNAPSHOT_PRESENT_BUT_GATE_MAPPING_DROPPED'
  | 'FIELD_PATH_MISMATCH'
  | 'REAL_TECH_DATA_MISSING';

export interface MarketDataSnapshot {
  snapshotId: string;
  asOf: string;
  marketSession: MarketSession;
  sourceHealth: ProviderStatus;
  quoteProviderStatus: ProviderStatus;
  ohlcvProviderStatus: ProviderStatus;
  supplyProviderStatus: ProviderStatus;
  sectorProviderStatus: ProviderStatus;
  financialProviderStatus: ProviderStatus;
  macroProviderStatus: ProviderStatus;
}

export interface CandidateSnapshot {
  snapshotId: string;
  candidateId: string;
  symbol: string;
  name: string;
  market: string;
  source: string;
  importedAt: string;
  watchlistSource: string;
  candidateReason: string;
  rawCandidateData: Record<string, unknown>;
}

export interface CandidateFeaturePack {
  sourceSnapshotId: string;
  symbol: string;
  price?: number;
  ma20?: number;
  ma60?: number;
  rsi14?: number;
  atr14?: number;
  atr20avg?: number;
  return5d?: number;
  return20d?: number;
  relativeReturn20d?: number;
  marketRelativeReturn?: number;
  volumeSurgeScore?: number;
  vcpScore?: number;
  breakoutScore?: number;
  technicalTrend?: Record<string, unknown>;
  source: 'KIS_OHLCV';
  status: 'COMPUTED' | 'PARTIAL' | 'MISSING';
}

export interface FeatureSnapshot {
  snapshotId: string;
  symbol: string;
  quote: Record<string, unknown> | null;
  ohlcvDaily: Record<string, unknown> | null;
  featurePack?: CandidateFeaturePack | null;
  technicalIndicators: {
    status: TechnicalIndicatorStatus;
    source: 'COMPUTED_FROM_KIS_OHLCV' | 'COMPUTED_FROM_OTHER_OHLCV' | 'NOT_COMPUTED';
    technicalTrend?: string;
    missingReason?: TechnicalTrendMissingReason;
  };
  supplyContext: Record<string, unknown>;
  sectorContext: Record<string, unknown>;
  financialContext: Record<string, unknown>;
  macroContext: Record<string, unknown>;
  riskContext: Record<string, unknown>;
  dataConfidenceMap: Record<string, ProviderStatus>;
  featureSourceMap: Record<string, string>;
}

export interface UnifiedMarketSnapshot {
  snapshotId: string;
  asOf: string;
  marketSession: MarketSession;
  candidates: CandidateSnapshot[];
  featuresBySymbol: Record<string, FeatureSnapshot>;
  providerHealth: Record<string, ProviderStatus>;
  sourceMap: Record<string, string>;
  confidenceMap: Record<string, ProviderStatus>;
}

export function buildUnifiedMarketSnapshot(input: {
  asOf: Date;
  marketSession: MarketSession;
  candidates: CandidateSnapshot[];
  featuresBySymbol: Record<string, FeatureSnapshot>;
  providerHealth: Record<string, ProviderStatus>;
  sourceMap?: Record<string, string>;
  confidenceMap?: Record<string, ProviderStatus>;
  snapshotId?: string;
}): UnifiedMarketSnapshot {
  const snapshotId = input.snapshotId ?? `scan_${input.asOf.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}_${Math.random().toString(36).slice(2, 7)}`;
  const normalizedCandidates = input.candidates.map((candidate) => ({ ...candidate, snapshotId }));
  const normalizedFeatures = Object.fromEntries(
    Object.entries(input.featuresBySymbol).map(([symbol, feature]) => [symbol, { ...feature, snapshotId }]),
  );
  return {
    snapshotId,
    asOf: input.asOf.toISOString(),
    marketSession: input.marketSession,
    candidates: normalizedCandidates,
    featuresBySymbol: normalizedFeatures,
    providerHealth: input.providerHealth,
    sourceMap: input.sourceMap ?? {},
    confidenceMap: input.confidenceMap ?? {},
  };
}

export function classifyTechnicalTrendMissing(feature: FeatureSnapshot): TechnicalTrendMissingReason | null {
  if (feature.featurePack?.status === 'COMPUTED' && feature.technicalIndicators.status !== 'COMPUTED') return 'INDICATOR_COMPUTED_BUT_FEATURE_SNAPSHOT_DROPPED';
  if (feature.technicalIndicators.status === 'COMPUTED' && feature.featurePack?.status !== 'COMPUTED') return 'INDICATOR_COMPUTED_BUT_FEATURE_SNAPSHOT_DROPPED';
  if (feature.technicalIndicators.status === 'COMPUTED' && feature.featurePack?.status === 'COMPUTED') return null;
  if (feature.quote && !feature.ohlcvDaily) return 'KIS_QUOTE_VERIFIED_BUT_OHLCV_NOT_FETCHED';
  if (feature.ohlcvDaily && feature.technicalIndicators.status === 'NOT_COMPUTED') return 'KIS_OHLCV_FETCHED_BUT_INDICATOR_NOT_COMPUTED';
  return feature.technicalIndicators.missingReason ?? 'REAL_TECH_DATA_MISSING';
}
