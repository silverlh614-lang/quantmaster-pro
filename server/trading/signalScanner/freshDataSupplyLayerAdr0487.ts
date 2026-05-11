// @responsibility ADR-0487 Fresh Data Supply Layer foundation; OBSERVE/SHADOW_ONLY diagnostics only.
import type { OperatorActionSource } from './operatorActionRouterAdr0480.js';
import type { SupplyCoverageReportAdr0496 } from './investorFlowSemanticNetBuyAdr0496.js';

export type FreshDataDomain =
  | 'SECTOR_ENERGY'
  | 'SUPPLY'
  | 'PRICE_VOLUME'
  | 'PROGRAM_TRADING'
  | 'SHORT_CREDIT'
  | 'MACRO'
  | 'FUNDAMENTAL'
  | 'UNKNOWN';

export type FreshDataProvider =
  | 'KRX'
  | 'KIS'
  | 'NAVER'
  | 'FSS'
  | 'DART'
  | 'YAHOO'
  | 'CACHE'
  | 'INTERNAL'
  | 'UNKNOWN';

export type FreshDataStage = 'OBSERVE' | 'SHADOW_ONLY';

export type FreshDataLineStatus =
  | 'NOT_STARTED'
  | 'OBSERVING'
  | 'FETCH_OK'
  | 'NORMALIZED'
  | 'PARTIAL'
  | 'STALE'
  | 'MISSING'
  | 'DATA_UNAVAILABLE'
  | 'PROVIDER_ERROR'
  | 'CACHE_ONLY'
  | 'READY_FOR_SHADOW'
  | 'UNKNOWN';

export type FreshDataSourceState =
  | 'FRESH'
  | 'STALE'
  | 'MISSING'
  | 'EMPTY'
  | 'DATA_UNAVAILABLE'
  | 'PROVIDER_ERROR'
  | 'NON_TRADING_DAY'
  | 'UNKNOWN';

export type FreshDataCacheState =
  | 'FRESH'
  | 'STALE'
  | 'EMPTY'
  | 'MISSING'
  | 'UNKNOWN';

export type FreshDataReadinessKindAdr0487 =
  | 'REGISTRY_READY'
  | 'PLACEHOLDER_READY'
  | 'MATERIALIZED_SAMPLE'
  | 'CACHE_FALLBACK'
  | 'NO_SAMPLE';

export type FreshDataSourceOfTruthAdr0487 =
  | 'FRESH_DATA_STATUS'
  | 'SUPPLY_SNAPSHOT'
  | 'ROUTER_INPUT'
  | 'REGISTRY'
  | 'SYNTHETIC';

export interface FreshDataSourceRegistrationAdr0487 {
  id: string;
  domain: FreshDataDomain;
  provider: FreshDataProvider;
  priority: number;
  stage: FreshDataStage;
  fetchAllowed: boolean;
  normalizeRequired: boolean;
  freshnessRequired: boolean;
  rawPayloadPersistenceAllowed: false;
  liveExecutionAllowed: false;
  executionImpact: 'NONE';
  description: string;
  relatedAdrs: string[];
}

export interface FreshDataSnapshotAdr0487 {
  sourceId: string;
  domain: FreshDataDomain;
  provider: FreshDataProvider;
  stage: FreshDataStage;
  collectedAt: string;
  sourceDate: string | null;
  cacheState: FreshDataCacheState;
  sourceState: FreshDataSourceState;
  cacheAgeMinutes: number | null;
  sourceAgeTradingDays: number | null;
  coverageRatio: number;
  normalized: boolean;
  sampleMaterialized?: boolean;
  usableForRouter?: boolean;
  usableForShadow?: boolean;
  usableForLive?: false;
  readinessKind?: FreshDataReadinessKindAdr0487;
  sourceOfTruth?: FreshDataSourceOfTruthAdr0487;
  status: FreshDataLineStatus;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  isProviderIssue: boolean;
  isMarketSignal: false;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  operatorApprovalRequired: true;
  diagnostics: string[];
}

export interface FreshDataDomainSummaryAdr0487 {
  domain: FreshDataDomain;
  status: FreshDataLineStatus;
  sourcesTotal: number;
  sourcesFresh: number;
  sourcesStale: number;
  sourcesMissing: number;
  sourcesProviderError: number;
  averageCoverageRatio: number;
  topGaps: string[];
  recommendedNextActions: string[];
}

export interface FreshDataSupplyReportAdr0487 {
  generatedAt: string;
  registrations: FreshDataSourceRegistrationAdr0487[];
  snapshots: FreshDataSnapshotAdr0487[];
  domainSummaries: FreshDataDomainSummaryAdr0487[];
  overallStatus: FreshDataLineStatus;
  topGaps: string[];
  recommendedNextActions: string[];
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'OBSERVE' | 'SHADOW_ONLY';
  operatorApprovalRequired: true;
  diagnostics: string[];
}

export interface BuildFreshDataSnapshotInputAdr0487 {
  registration?: FreshDataSourceRegistrationAdr0487;
  sourceId?: string;
  domain?: FreshDataDomain;
  provider?: FreshDataProvider;
  stage?: FreshDataStage;
  collectedAt?: string;
  sourceDate?: string | null;
  cacheState?: FreshDataCacheState;
  sourceState?: FreshDataSourceState;
  cacheAgeMinutes?: number | null;
  sourceAgeTradingDays?: number | null;
  coverageRatio?: number | null;
  normalized?: boolean;
  sampleMaterialized?: boolean;
  usableForRouter?: boolean;
  usableForShadow?: boolean;
  readinessKind?: FreshDataReadinessKindAdr0487;
  sourceOfTruth?: FreshDataSourceOfTruthAdr0487;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  diagnostics?: readonly string[];
}

export interface FreshDataSupplyReportInputAdr0487 {
  generatedAt?: string;
  sectorEnergyDiagnosticAdr0474?: Record<string, unknown> | null;
  naverInvestorTrendAdr0481?: Record<string, unknown> | null;
  semanticNetBuyNormalizationAdr0482?: Record<string, unknown> | null;
  supplySourceFreshnessAdr0483?: {
    status?: string;
    rows?: readonly Record<string, unknown>[];
    affectedSources?: readonly string[];
    oldestSourceAgeTradingDays?: number | null;
    refreshRecommendedSources?: readonly string[];
  } | null;
  supplyCoverageRecoveryAdr0484?: Record<string, unknown> | null;
  supplyAdvisoryReadinessAdr0485?: Record<string, unknown> | null;
  supplyCoverageReportAdr0496?: SupplyCoverageReportAdr0496 | null;
  investorFlowProviderRouterAdr0477?: {
    selectedProvider?: string;
    providerStatuses?: Record<string, string>;
    status?: string;
  } | null;
  diagnostics?: readonly string[];
  throwForTest?: boolean;
}

const POLICY = {
  executionImpact: 'NONE' as const,
  liveExecutionAllowed: false as const,
  operatorApprovalRequired: true as const,
};

const SOURCE_IDS = [
  'KRX_SECTOR_INDEX_MASTER',
  'SECTOR_INDEX_CODE_MAPPING',
  'SECTOR_ENERGY_STOCK_DAILY_FALLBACK',
  'NAVER_INVESTOR_TREND',
  'SEMANTIC_NETBUY',
  'KIS_PROGRAM_TRADING',
  'MARKET_PROGRAM_TRADING',
  'FSS_PASSIVE_ACTIVE',
  'SHORT_BALANCE',
  'CREDIT_BALANCE',
  'PRICE_VOLUME_DAILY',
] as const;

export function buildFreshDataSourceRegistryAdr0487(): FreshDataSourceRegistrationAdr0487[] {
  const rows: Array<Omit<FreshDataSourceRegistrationAdr0487, 'rawPayloadPersistenceAllowed' | 'liveExecutionAllowed' | 'executionImpact'>> = [
    { id: 'KRX_SECTOR_INDEX_MASTER', domain: 'SECTOR_ENERGY', provider: 'KRX', priority: 1, stage: 'OBSERVE', fetchAllowed: true, normalizeRequired: true, freshnessRequired: true, description: 'Sector indexCode master data.', relatedAdrs: ['0474', '0487'] },
    { id: 'SECTOR_INDEX_CODE_MAPPING', domain: 'SECTOR_ENERGY', provider: 'INTERNAL', priority: 2, stage: 'OBSERVE', fetchAllowed: false, normalizeRequired: true, freshnessRequired: true, description: 'Stock, sector, and indexCode mapping.', relatedAdrs: ['0474', '0487'] },
    { id: 'SECTOR_ENERGY_STOCK_DAILY_FALLBACK', domain: 'SECTOR_ENERGY', provider: 'CACHE', priority: 3, stage: 'OBSERVE', fetchAllowed: false, normalizeRequired: false, freshnessRequired: true, description: 'Fallback support data only; never leadership confidence.', relatedAdrs: ['0474', '0487'] },
    { id: 'NAVER_INVESTOR_TREND', domain: 'SUPPLY', provider: 'NAVER', priority: 1, stage: 'SHADOW_ONLY', fetchAllowed: true, normalizeRequired: true, freshnessRequired: true, description: 'NAVER investor trend sample line.', relatedAdrs: ['0481', '0487'] },
    { id: 'SEMANTIC_NETBUY', domain: 'SUPPLY', provider: 'INTERNAL', priority: 2, stage: 'SHADOW_ONLY', fetchAllowed: false, normalizeRequired: true, freshnessRequired: true, description: 'Semantic net-buy normalized sample line.', relatedAdrs: ['0482', '0487'] },
    { id: 'KIS_PROGRAM_TRADING', domain: 'PROGRAM_TRADING', provider: 'KIS', priority: 3, stage: 'OBSERVE', fetchAllowed: true, normalizeRequired: true, freshnessRequired: true, description: 'KIS program trading sample line.', relatedAdrs: ['0477', '0487'] },
    { id: 'MARKET_PROGRAM_TRADING', domain: 'PROGRAM_TRADING', provider: 'KRX', priority: 4, stage: 'OBSERVE', fetchAllowed: true, normalizeRequired: true, freshnessRequired: true, description: 'Market program trading sample line.', relatedAdrs: ['0477', '0487'] },
    { id: 'FSS_PASSIVE_ACTIVE', domain: 'SUPPLY', provider: 'FSS', priority: 5, stage: 'OBSERVE', fetchAllowed: true, normalizeRequired: true, freshnessRequired: true, description: 'FSS passive/active supply freshness line.', relatedAdrs: ['0483', '0487'] },
    { id: 'SHORT_BALANCE', domain: 'SHORT_CREDIT', provider: 'FSS', priority: 6, stage: 'OBSERVE', fetchAllowed: true, normalizeRequired: true, freshnessRequired: true, description: 'Short balance freshness line.', relatedAdrs: ['0483', '0487'] },
    { id: 'CREDIT_BALANCE', domain: 'SHORT_CREDIT', provider: 'FSS', priority: 7, stage: 'OBSERVE', fetchAllowed: true, normalizeRequired: true, freshnessRequired: true, description: 'Credit balance freshness line.', relatedAdrs: ['0483', '0487'] },
    { id: 'PRICE_VOLUME_DAILY', domain: 'PRICE_VOLUME', provider: 'CACHE', priority: 8, stage: 'OBSERVE', fetchAllowed: false, normalizeRequired: false, freshnessRequired: true, description: 'Price/volume support data if needed.', relatedAdrs: ['0487'] },
  ];
  return rows.map((row) => ({ ...row, rawPayloadPersistenceAllowed: false, liveExecutionAllowed: false, executionImpact: 'NONE' }));
}

function clampCoverage(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const ratio = value > 1 ? value / 100 : value;
  return Math.max(0, Math.min(1, Math.round(ratio * 1000) / 1000));
}

function upper(value: unknown): string {
  return typeof value === 'string' ? value.toUpperCase() : '';
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function statusForSnapshot(input: Required<Pick<BuildFreshDataSnapshotInputAdr0487, 'cacheState' | 'sourceState' | 'normalized' | 'stage'>> & { coverageRatio: number; sampleMaterialized: boolean; usableForRouter: boolean }): FreshDataLineStatus {
  if (input.sourceState === 'PROVIDER_ERROR') return 'PROVIDER_ERROR';
  if (input.sourceState === 'STALE') return 'STALE';
  if (input.sourceState === 'NON_TRADING_DAY') return 'DATA_UNAVAILABLE';
  if (input.sourceState === 'MISSING' || input.sourceState === 'EMPTY' || input.sourceState === 'DATA_UNAVAILABLE') {
    return input.cacheState === 'FRESH' || input.cacheState === 'STALE' ? 'CACHE_ONLY' : input.sourceState === 'EMPTY' ? 'MISSING' : 'DATA_UNAVAILABLE';
  }
  if (input.normalized && input.sampleMaterialized && input.usableForRouter && input.sourceState === 'FRESH' && input.coverageRatio >= 0.75 && input.stage === 'SHADOW_ONLY') return 'READY_FOR_SHADOW';
  if (input.normalized && input.sourceState === 'FRESH') return 'NORMALIZED';
  if (input.sourceState === 'FRESH' && input.coverageRatio > 0) return 'FETCH_OK';
  if (input.coverageRatio > 0) return 'PARTIAL';
  return 'DATA_UNAVAILABLE';
}

function isProviderIssue(status: FreshDataLineStatus): boolean {
  return ['PARTIAL', 'STALE', 'MISSING', 'DATA_UNAVAILABLE', 'PROVIDER_ERROR', 'CACHE_ONLY', 'UNKNOWN'].includes(status);
}

export function buildFreshDataSnapshotAdr0487(input: BuildFreshDataSnapshotInputAdr0487 = {}): FreshDataSnapshotAdr0487 {
  const registration = input.registration;
  const sourceId = input.sourceId ?? registration?.id ?? 'UNKNOWN';
  const domain = input.domain ?? registration?.domain ?? 'UNKNOWN';
  const provider = input.provider ?? registration?.provider ?? 'UNKNOWN';
  const stage = input.stage ?? registration?.stage ?? 'OBSERVE';
  const cacheState = input.cacheState ?? 'UNKNOWN';
  const sourceState = input.sourceState ?? 'UNKNOWN';
  const coverageRatio = clampCoverage(input.coverageRatio ?? 0);
  const normalized = input.normalized ?? false;
  const sampleMaterialized = input.sampleMaterialized ?? (normalized && coverageRatio > 0 && input.readinessKind !== 'REGISTRY_READY' && input.readinessKind !== 'PLACEHOLDER_READY');
  const usableForShadow = input.usableForShadow ?? sampleMaterialized;
  const usableForRouter = input.usableForRouter ?? (sampleMaterialized && normalized && (sourceState === 'FRESH' || sourceState === 'STALE'));
  const readinessKind = input.readinessKind ?? (sampleMaterialized ? 'MATERIALIZED_SAMPLE' : normalized ? 'REGISTRY_READY' : 'NO_SAMPLE');
  const sourceOfTruth = input.sourceOfTruth ?? (sampleMaterialized ? 'ROUTER_INPUT' : 'REGISTRY');
  const status = statusForSnapshot({ cacheState, sourceState, coverageRatio, normalized, stage, sampleMaterialized, usableForRouter });
  return {
    sourceId,
    domain,
    provider,
    stage,
    collectedAt: input.collectedAt ?? new Date().toISOString(),
    sourceDate: input.sourceDate ?? null,
    cacheState,
    sourceState,
    cacheAgeMinutes: input.cacheAgeMinutes ?? null,
    sourceAgeTradingDays: input.sourceAgeTradingDays ?? null,
    coverageRatio,
    normalized,
    sampleMaterialized,
    usableForRouter,
    usableForShadow,
    usableForLive: false,
    readinessKind,
    sourceOfTruth,
    status,
    confidence: input.confidence ?? (normalized && sourceState === 'FRESH' ? 'HIGH' : coverageRatio > 0 ? 'LOW' : 'NONE'),
    isProviderIssue: isProviderIssue(status),
    isMarketSignal: false,
    ...POLICY,
    diagnostics: [
      `sampleMaterialized=${sampleMaterialized}`,
      `usableForRouter=${usableForRouter}`,
      `usableForShadow=${usableForShadow}`,
      'usableForLive=false',
      `readinessKind=${readinessKind}`,
      `sourceOfTruth=${sourceOfTruth}`,
      ...(input.diagnostics ?? []),
      'ADR-0487 snapshot is diagnostic-only; provider issue is never bearish.',
    ],
  };
}

function registrationById(registrations: FreshDataSourceRegistrationAdr0487[], id: string): FreshDataSourceRegistrationAdr0487 {
  return registrations.find((registration) => registration.id === id) ?? registrations[registrations.length - 1]!;
}

function freshnessRow(input: FreshDataSupplyReportInputAdr0487, sourceId: string): Record<string, unknown> | null {
  const rows = input.supplySourceFreshnessAdr0483?.rows ?? [];
  return rows.find((row) => upper(row.sourceId) === sourceId || upper(row.source) === sourceId || upper(row.provider) === sourceId) ?? null;
}

function snapshotFromFreshness(
  input: FreshDataSupplyReportInputAdr0487,
  registration: FreshDataSourceRegistrationAdr0487,
  generatedAt: string,
): FreshDataSnapshotAdr0487 {
  const row = freshnessRow(input, registration.id) ?? freshnessRow(input, registration.provider) ?? null;
  const state = upper(row?.sourceState ?? row?.status ?? input.supplySourceFreshnessAdr0483?.status);
  const sourceState: FreshDataSourceState =
    state.includes('PROVIDER_ERROR') ? 'PROVIDER_ERROR'
      : state.includes('STALE') ? 'STALE'
        : state.includes('FRESH') ? 'FRESH'
          : state.includes('EMPTY') ? 'EMPTY'
            : state.includes('MISSING') ? 'MISSING'
              : 'DATA_UNAVAILABLE';
  const cache = upper(row?.cacheState);
  const sourceAgeTradingDays = asNumber(row?.sourceAgeTradingDays);
  return buildFreshDataSnapshotAdr0487({
    registration,
    collectedAt: generatedAt,
    sourceDate: typeof row?.sourceDate === 'string' ? row.sourceDate : null,
    cacheState: cache.includes('FRESH') ? 'FRESH' : cache.includes('STALE') ? 'STALE' : cache.includes('EMPTY') ? 'EMPTY' : 'UNKNOWN',
    sourceState,
    cacheAgeMinutes: asNumber(row?.cacheAgeMinutes),
    sourceAgeTradingDays,
    coverageRatio: sourceState === 'FRESH' ? 1 : 0,
    normalized: sourceState === 'FRESH',
    diagnostics: [
      `freshness source=${registration.id}`,
      ...(registration.id === 'FSS_PASSIVE_ACTIVE' ? [
        `lastUpdated=${typeof row?.sourceDate === 'string' ? row.sourceDate : 'none'}`,
        `staleDays=${sourceAgeTradingDays ?? 'unknown'}`,
        'expectedFreshnessDays=2',
        `usableForSemantic=${sourceAgeTradingDays !== null && sourceAgeTradingDays <= 7 ? 'true' : 'false'}`,
        'usableForLive=false',
        'nextAction=REFRESH_FSS_PASSIVE_ACTIVE',
      ] : []),
    ],
  });
}

function buildSectorSnapshots(input: FreshDataSupplyReportInputAdr0487, registrations: FreshDataSourceRegistrationAdr0487[], generatedAt: string): FreshDataSnapshotAdr0487[] {
  const diag = input.sectorEnergyDiagnosticAdr0474 ?? {};
  const coverage = clampCoverage(diag.indexCodeCoverage ?? diag.coverageRatio ?? diag.afterCoverage);
  const fallbackUsed = upper(diag.fallbackUsed);
  const missingIndexCode = Number(diag.missingIndexCode ?? diag.missingIndexCodeCount ?? 0);
  const aliasMissing = Number(diag.aliasMissing ?? diag.aliasMissingCount ?? 0);
  const sourceState: FreshDataSourceState = coverage >= 0.8 ? 'FRESH' : coverage > 0 ? 'STALE' : 'MISSING';
  return [
    buildFreshDataSnapshotAdr0487({
      registration: registrationById(registrations, 'KRX_SECTOR_INDEX_MASTER'),
      collectedAt: generatedAt,
      cacheState: coverage > 0 ? 'FRESH' : 'MISSING',
      sourceState,
      coverageRatio: coverage,
      normalized: coverage >= 0.8 && missingIndexCode === 0,
      sampleMaterialized: coverage >= 0.8 && missingIndexCode === 0,
      usableForRouter: false,
      usableForShadow: coverage > 0,
      readinessKind: coverage >= 0.8 && missingIndexCode === 0 ? 'MATERIALIZED_SAMPLE' : coverage > 0 ? 'PLACEHOLDER_READY' : 'NO_SAMPLE',
      sourceOfTruth: 'REGISTRY',
      diagnostics: [`indexCodeCoverage=${coverage}`, `missingIndexCode=${missingIndexCode}`],
    }),
    buildFreshDataSnapshotAdr0487({
      registration: registrationById(registrations, 'SECTOR_INDEX_CODE_MAPPING'),
      collectedAt: generatedAt,
      cacheState: coverage > 0 ? 'FRESH' : 'MISSING',
      sourceState: coverage > 0 ? (aliasMissing > 0 ? 'STALE' : 'FRESH') : 'MISSING',
      coverageRatio: coverage,
      normalized: coverage >= 0.8 && aliasMissing === 0,
      sampleMaterialized: coverage >= 0.8 && aliasMissing === 0,
      usableForRouter: false,
      usableForShadow: coverage > 0,
      readinessKind: coverage >= 0.8 && aliasMissing === 0 ? 'MATERIALIZED_SAMPLE' : coverage > 0 ? 'PLACEHOLDER_READY' : 'NO_SAMPLE',
      sourceOfTruth: 'REGISTRY',
      diagnostics: [`aliasMissing=${aliasMissing}`],
    }),
    buildFreshDataSnapshotAdr0487({
      registration: registrationById(registrations, 'SECTOR_ENERGY_STOCK_DAILY_FALLBACK'),
      collectedAt: generatedAt,
      cacheState: fallbackUsed && fallbackUsed !== 'NONE' ? 'FRESH' : 'MISSING',
      sourceState: fallbackUsed && fallbackUsed !== 'NONE' ? 'FRESH' : 'MISSING',
      coverageRatio: fallbackUsed && fallbackUsed !== 'NONE' ? 1 : 0,
      normalized: false,
      sampleMaterialized: false,
      usableForRouter: false,
      usableForShadow: Boolean(fallbackUsed && fallbackUsed !== 'NONE'),
      readinessKind: fallbackUsed && fallbackUsed !== 'NONE' ? 'PLACEHOLDER_READY' : 'NO_SAMPLE',
      sourceOfTruth: fallbackUsed && fallbackUsed !== 'NONE' ? 'SYNTHETIC' : 'REGISTRY',
      diagnostics: [`fallbackUsed=${fallbackUsed || 'NONE'}`, 'Fallback data is support-only and not leadership confidence.'],
    }),
  ];
}

function naverSnapshot(input: FreshDataSupplyReportInputAdr0487, registration: FreshDataSourceRegistrationAdr0487, generatedAt: string): FreshDataSnapshotAdr0487 {
  const adr0496 = input.supplyCoverageReportAdr0496;
  const naverCoverage = typeof input.naverInvestorTrendAdr0481?.coverage === 'object' && input.naverInvestorTrendAdr0481.coverage !== null
    ? input.naverInvestorTrendAdr0481.coverage as Record<string, unknown>
    : null;
  const hasNaverSample = Boolean(input.naverInvestorTrendAdr0481?.semanticNetBuyCandidate);
  const status = upper(input.naverInvestorTrendAdr0481?.status ?? input.investorFlowProviderRouterAdr0477?.providerStatuses?.NAVER);
  const available = asNumber(input.naverInvestorTrendAdr0481?.availableDays) ?? asNumber(naverCoverage?.availableDays) ?? adr0496?.sampleCount ?? 0;
  const requested = asNumber(input.naverInvestorTrendAdr0481?.requestedDays) ?? asNumber(naverCoverage?.requestedDays) ?? Math.max(1, adr0496?.sampleCount ?? 1);
  const coverage = adr0496 && adr0496.sampleCount > 0 ? adr0496.coverageAfter : requested > 0 ? available / requested : 0;
  const sourceState: FreshDataSourceState = adr0496 && adr0496.sampleCount > 0
    ? (adr0496.providerErrorCount > 0 ? 'PROVIDER_ERROR' : adr0496.staleCount > 0 ? 'STALE' : 'FRESH')
    : status.includes('DATA_AVAILABLE') || status.includes('WIRED') ? 'FRESH'
      : status.includes('STALE') ? 'STALE'
        : status.includes('PROVIDER_ERROR') ? 'PROVIDER_ERROR'
          : status.includes('EMPTY') ? 'EMPTY'
            : 'DATA_UNAVAILABLE';
  const naverFreshness = typeof input.naverInvestorTrendAdr0481?.freshness === 'object' && input.naverInvestorTrendAdr0481.freshness !== null
    ? input.naverInvestorTrendAdr0481.freshness as Record<string, unknown>
    : null;
  const normalized = hasNaverSample;
  const naverSourceState = hasNaverSample ? sourceState : sourceState === 'FRESH' ? 'DATA_UNAVAILABLE' : sourceState;
  return buildFreshDataSnapshotAdr0487({
    registration,
    collectedAt: generatedAt,
    sourceDate: typeof naverFreshness?.lastSourceDate === 'string' ? naverFreshness.lastSourceDate : null,
    sourceAgeTradingDays: asNumber(naverFreshness?.sourceAgeTradingDays),
    cacheState: hasNaverSample ? (sourceState === 'FRESH' ? 'FRESH' : 'STALE') : 'UNKNOWN',
    sourceState: naverSourceState,
    coverageRatio: hasNaverSample ? 1 : 0,
    normalized,
    sampleMaterialized: hasNaverSample,
    usableForRouter: hasNaverSample && naverSourceState === 'FRESH',
    usableForShadow: hasNaverSample,
    readinessKind: hasNaverSample ? 'MATERIALIZED_SAMPLE' : (status ? 'REGISTRY_READY' : 'NO_SAMPLE'),
    sourceOfTruth: hasNaverSample ? 'ROUTER_INPUT' : 'REGISTRY',
    diagnostics: [`ADR-0481 status=${status || 'missing'}`, `ADR-0481 sample=${hasNaverSample ? 'NORMALIZED_SAMPLE' : 'NO_SAMPLE'}`, `ADR-0496 sampleCount=${adr0496?.sampleCount ?? 0}`, `fallbackUsed=${hasNaverSample && naverSourceState === 'STALE'}`],
  });
}

function semanticSnapshot(input: FreshDataSupplyReportInputAdr0487, registration: FreshDataSourceRegistrationAdr0487, generatedAt: string): FreshDataSnapshotAdr0487 {
  const adr0496 = input.supplyCoverageReportAdr0496;
  const status = upper(input.semanticNetBuyNormalizationAdr0482?.status);
  const semanticSamples = input.semanticNetBuyNormalizationAdr0482?.samples;
  const hasAnySemanticSample = Array.isArray(semanticSamples) && semanticSamples.length > 0;
  const hasMaterializedSemantic = hasAnySemanticSample || Boolean(input.semanticNetBuyNormalizationAdr0482?.selectedSample);
  const hasSample = hasMaterializedSemantic || status.includes('DATA_AVAILABLE') || status.includes('NORMALIZED');
  const sourceState: FreshDataSourceState =
    status.includes('STALE') ? 'STALE'
      : hasSample ? 'FRESH'
        : status.includes('PARSE_ERROR') || status.includes('PROVIDER_ERROR') ? 'PROVIDER_ERROR'
          : 'DATA_UNAVAILABLE';
  return buildFreshDataSnapshotAdr0487({
    registration,
    collectedAt: generatedAt,
    cacheState: hasMaterializedSemantic ? 'FRESH' : 'UNKNOWN',
    sourceState: hasMaterializedSemantic ? sourceState : 'DATA_UNAVAILABLE',
    coverageRatio: hasMaterializedSemantic ? 1 : 0,
    normalized: hasMaterializedSemantic,
    sampleMaterialized: hasMaterializedSemantic,
    usableForRouter: hasMaterializedSemantic && sourceState === 'FRESH',
    usableForShadow: hasMaterializedSemantic,
    readinessKind: hasMaterializedSemantic ? 'MATERIALIZED_SAMPLE' : (status ? 'REGISTRY_READY' : 'NO_SAMPLE'),
    sourceOfTruth: hasMaterializedSemantic ? 'ROUTER_INPUT' : 'REGISTRY',
    diagnostics: [`ADR-0482 status=${status || 'missing'}`, `ADR-0482 sampleCount=${Array.isArray(semanticSamples) ? semanticSamples.length : 0}`, `ADR-0496 semanticNetBuyCount=${adr0496?.semanticNetBuyCount ?? 0}`, `semanticPlaceholder=${!hasMaterializedSemantic && status ? 'true' : 'false'}`],
  });
}

function programSnapshot(input: FreshDataSupplyReportInputAdr0487, registration: FreshDataSourceRegistrationAdr0487, generatedAt: string): FreshDataSnapshotAdr0487 {
  const status = upper(input.investorFlowProviderRouterAdr0477?.providerStatuses?.[registration.id] ?? input.investorFlowProviderRouterAdr0477?.status);
  const fresh = status.includes('DATA_AVAILABLE') || status.includes('WIRED') || status.includes('OK');
  const sourceState: FreshDataSourceState = fresh ? 'FRESH' : status.includes('PROVIDER') ? 'PROVIDER_ERROR' : 'DATA_UNAVAILABLE';
  return buildFreshDataSnapshotAdr0487({ registration, collectedAt: generatedAt, cacheState: fresh ? 'FRESH' : 'UNKNOWN', sourceState, coverageRatio: fresh ? 1 : 0, normalized: fresh, diagnostics: [`programStatus=${status || 'missing'}`] });
}

function fssPassiveActiveSnapshot(input: FreshDataSupplyReportInputAdr0487, registration: FreshDataSourceRegistrationAdr0487, generatedAt: string): FreshDataSnapshotAdr0487 {
  const base = snapshotFromFreshness(input, registration, generatedAt);
  const adr0496 = input.supplyCoverageReportAdr0496;
  if (!adr0496 || adr0496.sampleCount === 0 || base.coverageRatio > 0) return base;
  return buildFreshDataSnapshotAdr0487({
    registration,
    collectedAt: generatedAt,
    cacheState: 'UNKNOWN',
    sourceState: adr0496.staleCount > 0 ? 'STALE' : 'DATA_UNAVAILABLE',
    coverageRatio: 0,
    normalized: false,
    diagnostics: [`ADR-0496 FSS placeholder: staleCount=${adr0496.staleCount}`, 'FSS passive/active remains placeholder-only until refreshed.'],
  });
}

function buildSupplySnapshots(input: FreshDataSupplyReportInputAdr0487, registrations: FreshDataSourceRegistrationAdr0487[], generatedAt: string): FreshDataSnapshotAdr0487[] {
  return [
    naverSnapshot(input, registrationById(registrations, 'NAVER_INVESTOR_TREND'), generatedAt),
    semanticSnapshot(input, registrationById(registrations, 'SEMANTIC_NETBUY'), generatedAt),
    programSnapshot(input, registrationById(registrations, 'KIS_PROGRAM_TRADING'), generatedAt),
    programSnapshot(input, registrationById(registrations, 'MARKET_PROGRAM_TRADING'), generatedAt),
    fssPassiveActiveSnapshot(input, registrationById(registrations, 'FSS_PASSIVE_ACTIVE'), generatedAt),
    snapshotFromFreshness(input, registrationById(registrations, 'SHORT_BALANCE'), generatedAt),
    snapshotFromFreshness(input, registrationById(registrations, 'CREDIT_BALANCE'), generatedAt),
  ];
}

function gapForSnapshot(snapshot: FreshDataSnapshotAdr0487): string | null {
  if (snapshot.status === 'READY_FOR_SHADOW' || snapshot.status === 'NORMALIZED' || snapshot.status === 'FETCH_OK') return null;
  if (snapshot.sourceId === 'KRX_SECTOR_INDEX_MASTER') return 'REPAIR_SECTOR_INDEX_MASTER';
  if (snapshot.sourceId === 'SECTOR_INDEX_CODE_MAPPING') return snapshot.coverageRatio < 0.8 ? 'IMPROVE_INDEX_CODE_COVERAGE' : 'REDUCE_ALIAS_MISSING';
  if (snapshot.sourceId === 'SECTOR_ENERGY_STOCK_DAILY_FALLBACK' && snapshot.coverageRatio > 0) return 'DO_NOT_USE_STOCK_DAILY_FOR_LEADERSHIP_CONFIDENCE';
  if (snapshot.sourceId === 'NAVER_INVESTOR_TREND') return 'COLLECT_NAVER_INVESTOR_SAMPLE';
  if (snapshot.sourceId === 'SEMANTIC_NETBUY') return 'BUILD_SEMANTIC_NETBUY_SAMPLE';
  if (snapshot.sourceId === 'FSS_PASSIVE_ACTIVE') return 'REFRESH_FSS_PASSIVE_ACTIVE';
  if (snapshot.sourceId === 'SHORT_BALANCE' || snapshot.sourceId === 'CREDIT_BALANCE') return 'REFRESH_SHORT_CREDIT_SOURCES';
  if (snapshot.domain === 'PROGRAM_TRADING') return 'VERIFY_KIS_PROGRAM_TRADING_SESSION';
  return null;
}

function actionForGap(gap: string): string {
  const map: Record<string, string> = {
    REPAIR_SECTOR_INDEX_MASTER: 'Repair sector index master data before using SectorEnergy leadership confidence.',
    IMPROVE_INDEX_CODE_COVERAGE: 'Improve SectorEnergy indexCode coverage and mapping symmetry.',
    REDUCE_ALIAS_MISSING: 'Reduce SectorEnergy alias misses.',
    DO_NOT_USE_STOCK_DAILY_FOR_LEADERSHIP_CONFIDENCE: 'Keep stock-daily fallback as support-only, not leadership confidence.',
    COLLECT_NAVER_INVESTOR_SAMPLE: 'Collect sanitized NAVER investor trend samples.',
    BUILD_SEMANTIC_NETBUY_SAMPLE: 'Build normalized semantic net-buy samples.',
    REFRESH_FSS_PASSIVE_ACTIVE: 'Refresh FSS passive/active supply freshness.',
    REFRESH_SHORT_CREDIT_SOURCES: 'Refresh short and credit balance freshness.',
    VERIFY_KIS_PROGRAM_TRADING_SESSION: 'Verify KIS/KRX program trading session sample availability.',
  };
  return map[gap] ?? 'Continue OBSERVE diagnostics; no live policy change.';
}

function summarizeStatus(snapshots: FreshDataSnapshotAdr0487[]): FreshDataLineStatus {
  if (snapshots.length === 0) return 'DATA_UNAVAILABLE';
  if (snapshots.some((snapshot) => snapshot.status === 'READY_FOR_SHADOW')) return 'READY_FOR_SHADOW';
  if (snapshots.some((snapshot) => snapshot.status === 'NORMALIZED')) return 'NORMALIZED';
  if (snapshots.some((snapshot) => snapshot.status === 'FETCH_OK')) return 'FETCH_OK';
  if (snapshots.some((snapshot) => snapshot.status === 'PARTIAL' || snapshot.status === 'CACHE_ONLY')) return 'PARTIAL';
  if (snapshots.some((snapshot) => snapshot.status === 'STALE')) return 'STALE';
  if (snapshots.some((snapshot) => snapshot.status === 'PROVIDER_ERROR')) return 'PROVIDER_ERROR';
  return 'DATA_UNAVAILABLE';
}

export function buildFreshDataDomainSummaryAdr0487(
  snapshots: readonly FreshDataSnapshotAdr0487[],
  domain: FreshDataDomain,
): FreshDataDomainSummaryAdr0487 {
  const rows = snapshots.filter((snapshot) => snapshot.domain === domain);
  const averageCoverageRatio = rows.length === 0 ? 0 : Math.round((rows.reduce((sum, row) => sum + row.coverageRatio, 0) / rows.length) * 1000) / 1000;
  const topGaps = Array.from(new Set(rows.map(gapForSnapshot).filter((gap): gap is string => Boolean(gap)))).slice(0, 5);
  return {
    domain,
    status: summarizeStatus(rows),
    sourcesTotal: rows.length,
    sourcesFresh: rows.filter((row) => row.sourceState === 'FRESH').length,
    sourcesStale: rows.filter((row) => row.sourceState === 'STALE').length,
    sourcesMissing: rows.filter((row) => ['MISSING', 'EMPTY', 'DATA_UNAVAILABLE', 'NON_TRADING_DAY', 'UNKNOWN'].includes(row.sourceState)).length,
    sourcesProviderError: rows.filter((row) => row.sourceState === 'PROVIDER_ERROR').length,
    averageCoverageRatio,
    topGaps,
    recommendedNextActions: topGaps.map(actionForGap),
  };
}

function reportStatus(summaries: FreshDataDomainSummaryAdr0487[]): FreshDataLineStatus {
  const sector = summaries.find((summary) => summary.domain === 'SECTOR_ENERGY');
  const supply = summaries.find((summary) => summary.domain === 'SUPPLY');
  const keyCoverage = ((sector?.averageCoverageRatio ?? 0) + (supply?.averageCoverageRatio ?? 0)) / 2;
  if ((sector?.status === 'READY_FOR_SHADOW' || sector?.status === 'NORMALIZED' || (sector?.averageCoverageRatio ?? 0) >= 0.6) && supply?.status === 'READY_FOR_SHADOW') return 'READY_FOR_SHADOW';
  if ((sector?.sourcesFresh ?? 0) + (supply?.sourcesFresh ?? 0) === 0) return 'DATA_UNAVAILABLE';
  if (keyCoverage < 0.3 && (sector?.sourcesStale ?? 0) + (supply?.sourcesStale ?? 0) > (sector?.sourcesFresh ?? 0) + (supply?.sourcesFresh ?? 0)) return 'STALE';
  return keyCoverage < 0.3 ? 'OBSERVING' : 'PARTIAL';
}

export function buildFreshDataSupplyReportAdr0487(input: FreshDataSupplyReportInputAdr0487 = {}): FreshDataSupplyReportAdr0487 {
  if (input.throwForTest) throw new Error('ADR-0487 test failure');
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const registrations = buildFreshDataSourceRegistryAdr0487();
  const snapshots = [
    ...buildSectorSnapshots(input, registrations, generatedAt),
    ...buildSupplySnapshots(input, registrations, generatedAt),
  ];
  const domains = Array.from(new Set(snapshots.map((snapshot) => snapshot.domain)));
  const domainSummaries = domains.map((domain) => buildFreshDataDomainSummaryAdr0487(snapshots, domain));
  const topGaps = Array.from(new Set(domainSummaries.flatMap((summary) => summary.topGaps))).slice(0, 8);
  const overallStatus = reportStatus(domainSummaries);
  return {
    generatedAt,
    registrations,
    snapshots,
    domainSummaries,
    overallStatus,
    topGaps,
    recommendedNextActions: topGaps.map(actionForGap),
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: snapshots.some((snapshot) => snapshot.stage === 'SHADOW_ONLY') ? 'SHADOW_ONLY' : 'OBSERVE',
    operatorApprovalRequired: true,
    diagnostics: [
      ...(input.diagnostics ?? []),
      'ADR-0487 creates OBSERVE/SHADOW_ONLY data supply foundation only.',
      'UNKNOWN remains UNKNOWN; provider issue is not bearish; fresh data is not a live Gate input.',
      'No raw provider payloads are persisted by ADR-0487.',
      ...(input.supplyCoverageReportAdr0496 ? [`ADR-0496 SupplyCoverage before=${input.supplyCoverageReportAdr0496.coverageBefore} after=${input.supplyCoverageReportAdr0496.coverageAfter} sampleCount=${input.supplyCoverageReportAdr0496.sampleCount} normalizedSampleCount=${input.supplyCoverageReportAdr0496.normalizedSampleCount} semanticNetBuyCount=${input.supplyCoverageReportAdr0496.semanticNetBuyCount} nullCount=${input.supplyCoverageReportAdr0496.nullCount} zeroCount=${input.supplyCoverageReportAdr0496.zeroCount} missingCount=${input.supplyCoverageReportAdr0496.missingCount} providerIssueCount=${input.supplyCoverageReportAdr0496.providerIssueCount} marketSignalCount=${input.supplyCoverageReportAdr0496.marketSignalCount}`] : []),
    ],
  };
}

export function safeBuildFreshDataSupplyReportAdr0487(input: FreshDataSupplyReportInputAdr0487 = {}): FreshDataSupplyReportAdr0487 {
  try {
    return buildFreshDataSupplyReportAdr0487(input);
  } catch (error) {
    const generatedAt = input.generatedAt ?? new Date().toISOString();
    return {
      generatedAt,
      registrations: buildFreshDataSourceRegistryAdr0487(),
      snapshots: [],
      domainSummaries: [],
      overallStatus: 'UNKNOWN',
      topGaps: ['FRESH_DATA_SUPPLY_BUILD_FAILED'],
      recommendedNextActions: ['Inspect ADR-0487 builder exception; continue scan, Shadow Learning, and Runtime Pipeline Audit.'],
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
      policyPromotionMode: 'OBSERVE',
      operatorApprovalRequired: true,
      diagnostics: ['ADR-0487 data supply failure isolated.', error instanceof Error ? error.message : String(error)],
    };
  }
}

function percent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

export function formatFreshDataSupplyCompactAdr0487(report: FreshDataSupplyReportAdr0487 | null | undefined): string | null {
  if (!report) return null;
  const sector = report.domainSummaries.find((summary) => summary.domain === 'SECTOR_ENERGY');
  const supply = report.domainSummaries.find((summary) => summary.domain === 'SUPPLY');
  const staleSources = report.snapshots.filter((snapshot) => snapshot.status === 'STALE').map((snapshot) => snapshot.sourceId).slice(0, 3).join('/');
  const line = `ADR-0487 FreshData: ${report.overallStatus} | sector=${sector ? `${sector.status} ${percent(sector.averageCoverageRatio)}` : 'missing'} | supply=${supply ? `${supply.sourcesFresh}/${supply.sourcesTotal}` : '0/0'}${staleSources ? ` | stale=${staleSources}` : ''} | impact=${report.executionImpact}`;
  const action = report.recommendedNextActions[0] ?? null;
  return action ? `${line}\n   action: ${action}` : line;
}

export function formatFreshDataSupplyDetailAdr0487(report: FreshDataSupplyReportAdr0487): string {
  const lines = [
    'ADR-0487 Fresh Data Supply Layer Foundation',
    `overallStatus=${report.overallStatus} policyPromotionMode=${report.policyPromotionMode} sources=${report.snapshots.length}`,
    'registrations:',
    ...report.registrations.map((registration) => `- ${registration.id}: domain=${registration.domain} provider=${registration.provider} stage=${registration.stage} rawPayloadPersistenceAllowed=${registration.rawPayloadPersistenceAllowed} liveExecutionAllowed=${registration.liveExecutionAllowed}`),
    'domainSummaries:',
    ...report.domainSummaries.map((summary) => `- ${summary.domain}: status=${summary.status} fresh=${summary.sourcesFresh}/${summary.sourcesTotal} stale=${summary.sourcesStale} missing=${summary.sourcesMissing} providerError=${summary.sourcesProviderError} coverage=${percent(summary.averageCoverageRatio)} gaps=${summary.topGaps.join(',') || 'none'}`),
    'snapshots:',
    ...report.snapshots.map((snapshot) => `- ${snapshot.sourceId}: status=${snapshot.status} cacheState=${snapshot.cacheState} sourceState=${snapshot.sourceState} sourceDate=${snapshot.sourceDate ?? 'none'} staleDays=${snapshot.sourceAgeTradingDays ?? 'unknown'} coverage=${percent(snapshot.coverageRatio)} normalized=${snapshot.normalized} isProviderIssue=${snapshot.isProviderIssue} isMarketSignal=${snapshot.isMarketSignal} diagnostics=${snapshot.diagnostics.join(' | ')}`),
    ...(report.diagnostics.filter((line) => line.startsWith('ADR-0496 SupplyCoverage')).map((line) => `supplyCoverageSummary: ${line}`)),
    `topGaps=${report.topGaps.join(',') || 'none'}`,
    `recommendedNextActions=${report.recommendedNextActions.join(' | ') || 'continue observation'}`,
    `guardrails: executionImpact=${report.executionImpact}; liveExecutionAllowed=${report.liveExecutionAllowed}; policyPromotionMode=${report.policyPromotionMode}; operatorApprovalRequired=${report.operatorApprovalRequired}; requiredScore unchanged at 70; no Gate/Kelly/KIS order changes; UNKNOWN remains UNKNOWN; provider issue is not bearish.`,
  ];
  return lines.join('\n');
}

export interface FreshDataSupplyDetailRegistryEntryAdr0487 {
  adr: '0487';
  sectionId: 'fresh_data_supply';
  commandHint: '/fresh_data_status';
  scanBlockersDetailHint: '/scan_blockers_detail fresh_data_supply';
  adrTraceHint: '/adr_trace 0487';
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  render: () => string;
}

export function getFreshDataSupplyDetailRegistryEntryAdr0487(report: FreshDataSupplyReportAdr0487): FreshDataSupplyDetailRegistryEntryAdr0487 {
  return {
    adr: '0487',
    sectionId: 'fresh_data_supply',
    commandHint: '/fresh_data_status',
    scanBlockersDetailHint: '/scan_blockers_detail fresh_data_supply',
    adrTraceHint: '/adr_trace 0487',
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    render: () => formatFreshDataSupplyDetailAdr0487(report),
  };
}

function sourceForGap(gap: string): OperatorActionSource {
  const rootCode: Record<string, string> = {
    REPAIR_SECTOR_INDEX_MASTER: 'SECTOR_INDEX_MASTER_REPAIR_NEEDED',
    IMPROVE_INDEX_CODE_COVERAGE: 'SECTOR_DATA_SUPPLY_LINE_MISSING',
    REDUCE_ALIAS_MISSING: 'SECTOR_DATA_SUPPLY_LINE_MISSING',
    DO_NOT_USE_STOCK_DAILY_FOR_LEADERSHIP_CONFIDENCE: 'SECTOR_DATA_SUPPLY_LINE_MISSING',
    COLLECT_NAVER_INVESTOR_SAMPLE: 'NAVER_SAMPLE_ACQUISITION_NEEDED',
    BUILD_SEMANTIC_NETBUY_SAMPLE: 'SEMANTIC_NETBUY_SAMPLE_NEEDED',
    REFRESH_FSS_PASSIVE_ACTIVE: 'FSS_REFRESH_NEEDED',
    REFRESH_SHORT_CREDIT_SOURCES: 'SUPPLY_DATA_SUPPLY_LINE_MISSING',
    VERIFY_KIS_PROGRAM_TRADING_SESSION: 'SUPPLY_DATA_SUPPLY_LINE_MISSING',
  };
  return {
    adr: '0487',
    sectionId: 'fresh_data_supply',
    code: rootCode[gap] ?? 'SUPPLY_DATA_SUPPLY_LINE_MISSING',
    diagnosticKey: gap,
    diagnosticValue: 'ADR-0487 fresh data supply gap',
    severity: gap.includes('REPAIR') || gap.includes('COLLECT') || gap.includes('BUILD') ? 'DATA_UNAVAILABLE' : 'DEGRADED',
  };
}

export function collectOperatorActionSourcesFromFreshDataSupplyAdr0487(report: FreshDataSupplyReportAdr0487 | null | undefined): OperatorActionSource[] {
  if (!report) return [];
  return report.topGaps.map(sourceForGap);
}

export function buildFreshDataSupplyObservationRowAdr0487(report: FreshDataSupplyReportAdr0487): Record<string, unknown> {
  const sector = report.domainSummaries.find((summary) => summary.domain === 'SECTOR_ENERGY');
  const supply = report.domainSummaries.find((summary) => summary.domain === 'SUPPLY');
  return {
    id: `adr0487-${report.generatedAt}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 180),
    createdAt: report.generatedAt,
    forDate: report.generatedAt.slice(0, 10),
    source: 'ADR_0487_FRESH_DATA_SUPPLY_LAYER',
    symbol: 'FRESH_DATA_SUPPLY',
    actualGate1Passed: false,
    actualLiveEligible: false,
    dryRunDecision: 'UNKNOWN_DIAGNOSTIC_ONLY',
    dryRunScenario: 'FRESH_DATA_SUPPLY_LAYER_ADR0487',
    requiredScore: 70,
    providerIssue: report.overallStatus !== 'READY_FOR_SHADOW',
    marketSignal: false,
    sectorEnergyDiagnosticOnly: true,
    sellOnly: false,
    observationType: 'FRESH_DATA_SUPPLY_LAYER_ADR0487',
    overallStatus: report.overallStatus,
    sectorEnergyStatus: sector?.status ?? 'UNKNOWN',
    supplyStatus: supply?.status ?? 'UNKNOWN',
    sectorCoverageRatio: sector?.averageCoverageRatio ?? 0,
    supplyCoverageRatio: supply?.averageCoverageRatio ?? 0,
    topGaps: report.topGaps,
    recommendedNextActions: report.recommendedNextActions,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: report.policyPromotionMode,
    status: 'OBSERVING',
  };
}

export function formatRuntimePipelineFreshDataEvidenceLineAdr0487(report: FreshDataSupplyReportAdr0487 | null | undefined): string {
  if (!report) return 'ADR-0487 status=missing diagnosticOnly=true executionImpact=NONE';
  const sector = report.domainSummaries.find((summary) => summary.domain === 'SECTOR_ENERGY');
  const supply = report.domainSummaries.find((summary) => summary.domain === 'SUPPLY');
  return `ADR-0487 status=${report.overallStatus} sector=${sector?.status ?? 'UNKNOWN'} supply=${supply?.status ?? 'UNKNOWN'} diagnosticOnly=true executionImpact=${report.executionImpact}`;
}

export function freshDataSourceIdsAdr0487(): readonly string[] {
  return SOURCE_IDS;
}
