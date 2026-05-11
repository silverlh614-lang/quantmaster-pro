// @responsibility ADR-0477 Investor Flow Provider Router; semantic net-buy routing dry-run only.
import type { NaverInvestorTrendCollectorResult } from './naverInvestorTrendCollectorAdr0481.js';
import type { SemanticNetBuyNormalizationReportAdr0482, SemanticNetBuyProvider, SemanticNetBuySampleAdr0482, SemanticNetBuyStatus } from './semanticNetBuyNormalizerAdr0482.js';
import type { FreshDataSupplyReportAdr0487, FreshDataSnapshotAdr0487 } from './freshDataSupplyLayerAdr0487.js';
import type { SupplySnapshotCacheLookupAdr0491 } from './supplySnapshotStoreReplayAdr0491.js';
import { normalizeInvestorFlowSnapshotKeyAdr0491, normalizeInvestorFlowSourceKeyAdr0491 as normalizeInvestorFlowSourceKeySharedAdr0491 } from './investorFlowSnapshotKeyNormalizerAdr0491.js';


export type InvestorFlowProviderId =
  | 'KIS'
  | 'KIS_API'
  | 'KRX'
  | 'KRX_INVESTOR_FLOW'
  | 'NAVER'
  | 'NAVER_INVESTOR_TREND'
  | 'FSS'
  | 'CACHE'
  | 'MANUAL'
  | 'SEMANTIC_NETBUY'
  | 'UNKNOWN'
  | 'NONE';

export type InvestorFlowProviderRoute =
  | 'investor_flow'
  | 'program_trading'
  | 'market_program'
  | 'foreign_trend'
  | 'short_balance'
  | 'credit_balance';

export type InvestorFlowProviderStatus =
  | 'VERIFIED'
  | 'READY_FOR_SHADOW'
  | 'OBSERVING'
  | 'DEGRADED'
  | 'PARTIAL'
  | 'STALE'
  | 'ACCEPTED_EMPTY'
  | 'CACHE_HIT'
  | 'CACHE_STALE_HIT'
  | 'CACHE_KEY_MISMATCH'
  | 'CACHE_EMPTY'
  | 'NOT_WIRED'
  | 'PROVIDER_MISMATCH'
  | 'DATA_UNAVAILABLE'
  | 'NON_TRADING_DAY'
  | 'ERROR'
  | 'EMPTY'
  | 'PARSE_ERROR'
  | 'PROVIDER_ERROR'
  | 'DISABLED'
  | 'REGISTRY_READY_NOT_MATERIALIZED'
  | 'NO_INPUT_SAMPLE'
  | 'MATERIALIZED_SAMPLE'
  | 'STALE_SAMPLE'
  | 'UNKNOWN';

export type SemanticSupplySignal =
  | 'BULLISH'
  | 'NEUTRAL'
  | 'BEARISH'
  | 'UNKNOWN';

export interface SupplyProviderCapability {
  provider: InvestorFlowProviderId;
  supportsInvestorFlow: boolean;
  supportsProgramTrading: boolean;
  supportsMarketProgram: boolean;
  supportsForeignTrend: boolean;
  supportsShortBalance: boolean;
  supportsCreditBalance: boolean;
  isSemanticNetBuyProvider: boolean;
  notes: string[];
}

export interface SemanticNetBuySample {
  code: string;
  source: InvestorFlowProviderId;
  sourceDate: string | null;
  collectedAt: string;
  foreignNetBuy: number | null;
  institutionNetBuy: number | null;
  programNetBuy: number | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  status: InvestorFlowProviderStatus;
  signal: SemanticSupplySignal;
  diagnostics: string[];
}

export interface InvestorFlowProviderRouteResult {
  code: string;
  route: 'investor_flow';
  selectedProvider: InvestorFlowProviderId;
  providerTried: InvestorFlowProviderId[];
  providerReasons: Record<string, string>;
  providerStatuses: Record<string, InvestorFlowProviderStatus>;
  semanticNetBuy: SemanticNetBuySample | null;
  status: InvestorFlowProviderStatus;
  signal: SemanticSupplySignal;
  coverage: {
    available: number;
    total: number;
    missing: number;
    stale: number;
    acceptedEmpty: number;
    providerMismatch: number;
    notWired: number;
  };
  freshness: {
    cacheState: 'FRESH' | 'STALE' | 'EMPTY' | 'UNKNOWN';
    sourceState: 'FRESH' | 'STALE' | 'MISSING' | 'UNKNOWN';
    sourceAgeTradingDays: number | null;
    oldestSourceAgeTradingDays: number | null;
    lastSourceDate: string | null;
  };
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'SHADOW_ONLY';
  operatorApprovalRequired: true;
  selectedReason: string | null;
  rawPayloadPersistenceAllowed: false;
  inputSources?: InvestorFlowProviderId[];
  cacheFallbackUsed?: boolean;
  semanticInputStatus?: InvestorFlowProviderStatus;
  naverSampleStatus?: InvestorFlowProviderStatus;
  naverReadinessKind?: string;
  semanticReadinessKind?: string;
  selectedFreshness?: 'FRESH' | 'STALE' | 'MISSING' | 'UNKNOWN';
  selectedConfidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  diagnostics: string[];
}

export interface InvestorFlowProviderRouterInput {
  code: string;
  collectedAt?: string;
  naverCollectorWired?: boolean;
  naverRaw?: Record<string, unknown> | null;
  naverCollectorResultAdr0481?: NaverInvestorTrendCollectorResult | null;
  semanticNetBuyNormalizationAdr0482?: SemanticNetBuyNormalizationReportAdr0482 | null;
  cacheRaw?: Record<string, unknown> | null;
  previousTradingDayCacheRaw?: Record<string, unknown> | null;
  kisTriedForInvestorFlow?: boolean;
  nonTradingDay?: boolean;
  sourceAgeTradingDays?: number | null;
  cacheAgeTradingDays?: number | null;
  marketProgramStatus?: InvestorFlowProviderStatus;
  fssSourceAgeTradingDays?: number | null;
  freshDataSupplyAdr0487?: FreshDataSupplyReportAdr0487 | null;
  supplySnapshotCacheLookupAdr0491?: SupplySnapshotCacheLookupAdr0491 | null;
}

const ROUTER_POLICY = {
  executionImpact: 'NONE',
  liveExecutionAllowed: false,
  policyPromotionMode: 'SHADOW_ONLY',
  operatorApprovalRequired: true,
  rawPayloadPersistenceAllowed: false,
} as const;

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function valueFromAliases(raw: Record<string, unknown> | null | undefined, keys: string[]): number | null {
  for (const key of keys) {
    const value = raw?.[key];
    if (finiteNumber(value)) return value;
  }
  return null;
}

function normalizeStatus(input: {
  raw: Record<string, unknown> | null | undefined;
  sourceAgeTradingDays?: number | null;
  fallbackStatus?: InvestorFlowProviderStatus;
}): InvestorFlowProviderStatus {
  if (!input.raw) return input.fallbackStatus ?? 'DATA_UNAVAILABLE';
  const explicit = input.raw.status;
  const allowed: InvestorFlowProviderStatus[] = [
    'VERIFIED',
    'READY_FOR_SHADOW',
    'OBSERVING',
    'DEGRADED',
    'PARTIAL',
    'STALE',
    'ACCEPTED_EMPTY',
    'CACHE_HIT',
    'CACHE_STALE_HIT',
    'CACHE_KEY_MISMATCH',
    'CACHE_EMPTY',
    'NOT_WIRED',
    'PROVIDER_MISMATCH',
    'DATA_UNAVAILABLE',
    'NON_TRADING_DAY',
    'ERROR',
    'EMPTY',
    'PARSE_ERROR',
    'PROVIDER_ERROR',
    'DISABLED',
    'REGISTRY_READY_NOT_MATERIALIZED',
    'NO_INPUT_SAMPLE',
    'MATERIALIZED_SAMPLE',
    'STALE_SAMPLE',
    'UNKNOWN',
  ];
  if (typeof explicit === 'string' && allowed.includes(explicit as InvestorFlowProviderStatus)) {
    return explicit as InvestorFlowProviderStatus;
  }
  if ((input.sourceAgeTradingDays ?? 0) >= 4) return 'STALE';
  return 'VERIFIED';
}

function confidenceForStatus(
  status: InvestorFlowProviderStatus,
  sourceAgeTradingDays?: number | null,
): SemanticNetBuySample['confidence'] {
  if (status === 'VERIFIED' || status === 'READY_FOR_SHADOW' || status === 'CACHE_HIT') return sourceAgeTradingDays !== null && sourceAgeTradingDays !== undefined && sourceAgeTradingDays > 1
    ? 'MEDIUM'
    : 'HIGH';
  if (status === 'PARTIAL' || status === 'DEGRADED' || status === 'OBSERVING') return 'MEDIUM';
  if (status === 'STALE' || status === 'CACHE_STALE_HIT') return 'LOW';
  return 'NONE';
}

function deriveSignal(input: {
  foreignNetBuy: number | null;
  institutionNetBuy: number | null;
  confidence: SemanticNetBuySample['confidence'];
  status: InvestorFlowProviderStatus;
}): SemanticSupplySignal {
  if (input.status !== 'VERIFIED' && input.status !== 'PARTIAL' && input.status !== 'READY_FOR_SHADOW' && input.status !== 'CACHE_HIT') return 'UNKNOWN';
  if (input.confidence !== 'HIGH' && input.confidence !== 'MEDIUM') return 'UNKNOWN';
  if (!finiteNumber(input.foreignNetBuy) || !finiteNumber(input.institutionNetBuy)) return 'UNKNOWN';
  if (input.foreignNetBuy > 0 && input.institutionNetBuy > 0) return 'BULLISH';
  if (input.foreignNetBuy < 0 && input.institutionNetBuy < 0) return 'BEARISH';
  return 'NEUTRAL';
}

export function buildInvestorFlowProviderCapabilities(input: {
  naverCollectorWired?: boolean;
  naverSemanticSampleAvailable?: boolean;
  cacheHasSemanticSample?: boolean;
} = {}): SupplyProviderCapability[] {
  return [
    {
      provider: 'KIS',
      supportsInvestorFlow: false,
      supportsProgramTrading: true,
      supportsMarketProgram: true,
      supportsForeignTrend: false,
      supportsShortBalance: false,
      supportsCreditBalance: false,
      isSemanticNetBuyProvider: false,
      notes: ['KIS is not a semantic investor-flow provider by default.'],
    },
    {
      provider: 'KRX',
      supportsInvestorFlow: true,
      supportsProgramTrading: false,
      supportsMarketProgram: true,
      supportsForeignTrend: false,
      supportsShortBalance: true,
      supportsCreditBalance: true,
      isSemanticNetBuyProvider: true,
      notes: ['KRX can be semantic only when normalized investor-flow rows are present.'],
    },
    {
      provider: 'NAVER',
      supportsInvestorFlow: input.naverCollectorWired !== false,
      supportsProgramTrading: false,
      supportsMarketProgram: false,
      supportsForeignTrend: true,
      supportsShortBalance: true,
      supportsCreditBalance: false,
      isSemanticNetBuyProvider: input.naverCollectorWired !== false && input.naverSemanticSampleAvailable === true,
      notes: input.naverCollectorWired !== false
        ? ['NAVER investor trend collector is wired as ADR-0481 SHADOW_ONLY candidate.', 'policyPromotionMode=SHADOW_ONLY']
        : ['NAVER investor trend collector is NOT_WIRED; this is not bearish.'],
    },
    {
      provider: 'FSS',
      supportsInvestorFlow: false,
      supportsProgramTrading: false,
      supportsMarketProgram: false,
      supportsForeignTrend: false,
      supportsShortBalance: true,
      supportsCreditBalance: true,
      isSemanticNetBuyProvider: false,
      notes: ['FSS is freshness diagnostic for passive/active, short, and credit data.'],
    },
    {
      provider: 'SEMANTIC_NETBUY',
      supportsInvestorFlow: true,
      supportsProgramTrading: false,
      supportsMarketProgram: false,
      supportsForeignTrend: true,
      supportsShortBalance: true,
      supportsCreditBalance: false,
      isSemanticNetBuyProvider: true,
      notes: ['SemanticNetBuy normalizer can route NAVER/KRX/FSS/CACHE normalized samples for SHADOW_ONLY observation.'],
    },
    {
      provider: 'CACHE',
      supportsInvestorFlow: true,
      supportsProgramTrading: false,
      supportsMarketProgram: false,
      supportsForeignTrend: false,
      supportsShortBalance: false,
      supportsCreditBalance: false,
      isSemanticNetBuyProvider: input.cacheHasSemanticSample === true,
      notes: ['CACHE is fallback only and never primary truth.'],
    },
  ];
}

export function normalizeSemanticNetBuySampleAdr0477(
  raw: Record<string, unknown> | null | undefined,
  source: InvestorFlowProviderId,
  opts: {
    code?: string;
    collectedAt?: string;
    sourceAgeTradingDays?: number | null;
    fallbackStatus?: InvestorFlowProviderStatus;
  } = {},
): SemanticNetBuySample {
  const status = normalizeStatus({
    raw,
    sourceAgeTradingDays: opts.sourceAgeTradingDays,
    fallbackStatus: opts.fallbackStatus,
  });
  const foreignNetBuy = valueFromAliases(raw, ['foreignNetBuy', 'investorForeignNetBuy']);
  const institutionNetBuy = valueFromAliases(raw, ['institutionNetBuy', 'investorInstitutionNetBuy']);
  const programNetBuy = valueFromAliases(raw, ['programNetBuy']);
  const confidence = confidenceForStatus(status, opts.sourceAgeTradingDays);
  const signal = deriveSignal({ foreignNetBuy, institutionNetBuy, confidence, status });
  return {
    code: opts.code ?? stringOrNull(raw?.code) ?? 'UNKNOWN',
    source,
    sourceDate: stringOrNull(raw?.sourceDate),
    collectedAt: opts.collectedAt ?? new Date().toISOString(),
    foreignNetBuy,
    institutionNetBuy,
    programNetBuy,
    confidence,
    status,
    signal,
    diagnostics: [
      `source=${source}`,
      `status=${status}`,
      signal === 'UNKNOWN' ? 'UNKNOWN/provider issue is not bearish' : `semantic signal=${signal}`,
    ],
  };
}


function mapSemanticNetBuyStatusAdr0482ToAdr0477(status: SemanticNetBuyStatus): InvestorFlowProviderStatus {
  switch (status) {
    case 'VERIFIED':
      return 'VERIFIED';
    case 'PARTIAL':
      return 'PARTIAL';
    case 'STALE':
      return 'STALE';
    case 'EMPTY':
      return 'EMPTY';
    case 'DATA_UNAVAILABLE':
      return 'DATA_UNAVAILABLE';
    case 'PROVIDER_MISMATCH':
      return 'PROVIDER_MISMATCH';
    case 'PARSE_ERROR':
      return 'PARSE_ERROR';
    case 'PROVIDER_ERROR':
      return 'PROVIDER_ERROR';
    case 'NON_TRADING_DAY':
      return 'NON_TRADING_DAY';
    case 'DISABLED':
      return 'DISABLED';
    default:
      return 'DATA_UNAVAILABLE';
  }
}

export type InvestorFlowSource = 'NAVER_INVESTOR_TREND' | 'SEMANTIC_NETBUY' | 'CACHE' | 'KRX_INVESTOR_FLOW' | 'KIS_API';

const INVESTOR_FLOW_SOURCE_ALIASES: Record<string, InvestorFlowSource> = {
  NAVER: 'NAVER_INVESTOR_TREND',
  NAVER_INVESTOR_TREND: 'NAVER_INVESTOR_TREND',
  SEMANTIC_NETBUY: 'SEMANTIC_NETBUY',
  SEMANTICNETBUY: 'SEMANTIC_NETBUY',
  'SEMANTIC NETBUY': 'SEMANTIC_NETBUY',
  CACHE: 'CACHE',
  KRX: 'KRX_INVESTOR_FLOW',
  KRX_INVESTOR_FLOW: 'KRX_INVESTOR_FLOW',
  KIS: 'KIS_API',
  KIS_API: 'KIS_API',
};

export function normalizeInvestorFlowSourceKey(input: string): InvestorFlowSource | 'UNKNOWN' {
  return normalizeInvestorFlowSourceKeySharedAdr0491(input) as InvestorFlowSource | 'UNKNOWN';
}

function providerFromSemanticAdr0482(provider: SemanticNetBuyProvider): InvestorFlowProviderId {
  const normalized = normalizeInvestorFlowSourceKey(provider);
  if (normalized !== 'UNKNOWN') return normalized;
  if (provider === 'FSS' || provider === 'MANUAL' || provider === 'UNKNOWN') return provider;
  return 'UNKNOWN';
}

function semanticNetBuyDiagnosticCandidate(report: SemanticNetBuyNormalizationReportAdr0482): SemanticNetBuySampleAdr0482 | null {
  return [...report.samples]
    .filter((sample) => (sample.status === 'VERIFIED' || sample.status === 'PARTIAL' || sample.status === 'STALE') && sample.confidence !== 'NONE')
    .sort((a, b) => {
      const confidenceScore = (value: SemanticNetBuySampleAdr0482['confidence']) => value === 'HIGH' ? 4 : value === 'MEDIUM' ? 3 : value === 'LOW' ? 2 : 0;
      const statusScore = (value: SemanticNetBuySampleAdr0482['status']) => value === 'VERIFIED' ? 4 : value === 'PARTIAL' ? 3 : value === 'STALE' ? 1 : 0;
      return (statusScore(b.status) + confidenceScore(b.confidence)) - (statusScore(a.status) + confidenceScore(a.confidence));
    })[0] ?? null;
}

function semanticNetBuyFreshCandidate(report: SemanticNetBuyNormalizationReportAdr0482): SemanticNetBuySampleAdr0482 | null {
  const selected = report.selectedSample;
  if (!selected) return null;
  return selected.status === 'VERIFIED' || selected.status === 'PARTIAL' ? selected : null;
}

function sampleFromSemanticAdr0482(sample: SemanticNetBuySampleAdr0482): SemanticNetBuySample {
  return {
    code: sample.code,
    source: providerFromSemanticAdr0482(sample.provider),
    sourceDate: sample.sourceDate,
    collectedAt: sample.collectedAt,
    foreignNetBuy: sample.foreignNetBuy,
    institutionNetBuy: sample.institutionNetBuy,
    programNetBuy: sample.programNetBuy,
    confidence: sample.confidence,
    status: mapSemanticNetBuyStatusAdr0482ToAdr0477(sample.status),
    signal: sample.signal,
    diagnostics: sample.diagnostics,
  };
}

function mapNaverAdr0481StatusToAdr0477(status: NaverInvestorTrendCollectorResult['status']): InvestorFlowProviderStatus {
  switch (status) {
    case 'DATA_AVAILABLE':
      return 'VERIFIED';
    case 'WIRED':
      return 'DATA_UNAVAILABLE';
    case 'PARTIAL':
      return 'PARTIAL';
    case 'STALE':
      return 'STALE';
    case 'EMPTY':
      return 'EMPTY';
    case 'PARSE_ERROR':
      return 'PARSE_ERROR';
    case 'PROVIDER_ERROR':
      return 'PROVIDER_ERROR';
    case 'NON_TRADING_DAY':
      return 'NON_TRADING_DAY';
    case 'DISABLED':
    case 'DATA_UNAVAILABLE':
      return 'DATA_UNAVAILABLE';
    default:
      return 'DATA_UNAVAILABLE';
  }
}

function coverageFromStatuses(statuses: Record<string, InvestorFlowProviderStatus>): InvestorFlowProviderRouteResult['coverage'] {
  const values = Object.values(statuses);
  return {
    available: values.filter((status) => status === 'VERIFIED' || status === 'PARTIAL' || status === 'DEGRADED' || status === 'READY_FOR_SHADOW' || status === 'OBSERVING' || status === 'CACHE_HIT' || status === 'CACHE_STALE_HIT').length,
    total: values.length,
    missing: values.filter((status) => status === 'DATA_UNAVAILABLE' || status === 'NON_TRADING_DAY' || status === 'EMPTY' || status === 'PARSE_ERROR' || status === 'PROVIDER_ERROR' || status === 'DISABLED').length,
    stale: values.filter((status) => status === 'STALE' || status === 'DEGRADED').length,
    acceptedEmpty: values.filter((status) => status === 'ACCEPTED_EMPTY').length,
    providerMismatch: values.filter((status) => status === 'PROVIDER_MISMATCH').length,
    notWired: values.filter((status) => status === 'NOT_WIRED').length,
  };
}

function cacheState(status: InvestorFlowProviderStatus | undefined): InvestorFlowProviderRouteResult['freshness']['cacheState'] {
  if (status === 'VERIFIED' || status === 'PARTIAL' || status === 'CACHE_HIT' || status === 'READY_FOR_SHADOW') return 'FRESH';
  if (status === 'STALE' || status === 'CACHE_STALE_HIT') return 'STALE';
  if (status === 'CACHE_EMPTY') return 'EMPTY';
  return 'UNKNOWN';
}

function sourceState(age: number | null): InvestorFlowProviderRouteResult['freshness']['sourceState'] {
  if (age === null) return 'UNKNOWN';
  return age >= 4 ? 'STALE' : 'FRESH';
}


function statusFromFreshDataSnapshot(snapshot: FreshDataSnapshotAdr0487): InvestorFlowProviderStatus {
  if (snapshot.status === 'READY_FOR_SHADOW') return 'READY_FOR_SHADOW';
  if (snapshot.status === 'NORMALIZED' || snapshot.status === 'FETCH_OK') return 'OBSERVING';
  if (snapshot.status === 'STALE' || snapshot.cacheState === 'STALE') return 'STALE';
  if (snapshot.status === 'CACHE_ONLY') return 'CACHE_STALE_HIT';
  if (snapshot.status === 'PROVIDER_ERROR') return 'PROVIDER_ERROR';
  if (snapshot.status === 'MISSING') return 'EMPTY';
  if (snapshot.status === 'DATA_UNAVAILABLE') return 'DATA_UNAVAILABLE';
  return 'UNKNOWN';
}

function findFreshDataSnapshotAdr0477(
  report: FreshDataSupplyReportAdr0487 | null | undefined,
  sourceKey: InvestorFlowSource,
): FreshDataSnapshotAdr0487 | null {
  return report?.snapshots.find((row) => row.domain === 'SUPPLY' && normalizeInvestorFlowSourceKey(row.sourceId) === sourceKey) ?? null;
}

function freshDataSnapshotMaterializedAdr0477(snapshot: FreshDataSnapshotAdr0487): boolean {
  if (typeof snapshot.sampleMaterialized === 'boolean') return snapshot.sampleMaterialized;
  return snapshot.normalized === true && snapshot.coverageRatio > 0 && snapshot.sourceDate !== null;
}

function freshDataSnapshotUsableForRouterAdr0477(snapshot: FreshDataSnapshotAdr0487): boolean {
  if (typeof snapshot.usableForRouter === 'boolean') return snapshot.usableForRouter;
  return freshDataSnapshotMaterializedAdr0477(snapshot) && (snapshot.sourceState === 'FRESH' || snapshot.sourceState === 'STALE');
}

function freshDataSnapshotUsableForShadowAdr0477(snapshot: FreshDataSnapshotAdr0487): boolean {
  if (typeof snapshot.usableForShadow === 'boolean') return snapshot.usableForShadow;
  return freshDataSnapshotMaterializedAdr0477(snapshot);
}

function freshDataSnapshotSampleAdr0477(
  report: FreshDataSupplyReportAdr0487 | null | undefined,
  sourceKey: InvestorFlowSource,
  code: string,
  collectedAt: string,
): SemanticNetBuySample | null {
  const snapshot = findFreshDataSnapshotAdr0477(report, sourceKey);
  if (!snapshot) return null;
  const status = statusFromFreshDataSnapshot(snapshot);
  const sampleMaterialized = freshDataSnapshotMaterializedAdr0477(snapshot);
  const usableForRouter = freshDataSnapshotUsableForRouterAdr0477(snapshot);
  const usableForShadow = freshDataSnapshotUsableForShadowAdr0477(snapshot);
  const selectableFresh = sampleMaterialized && usableForRouter && snapshot.normalized === true
    && (snapshot.stage === 'SHADOW_ONLY' || snapshot.stage === 'OBSERVE')
    && (status === 'READY_FOR_SHADOW' || status === 'OBSERVING' || status === 'VERIFIED');
  const selectableStale = sampleMaterialized && usableForShadow && snapshot.normalized === true
    && (snapshot.stage === 'SHADOW_ONLY' || snapshot.stage === 'OBSERVE')
    && (status === 'STALE' || status === 'CACHE_STALE_HIT');
  if (!selectableFresh && !selectableStale) return null;
  return {
    code,
    source: sourceKey,
    sourceDate: snapshot.sourceDate,
    collectedAt,
    foreignNetBuy: null,
    institutionNetBuy: null,
    programNetBuy: null,
    confidence: snapshot.confidence === 'NONE' ? 'LOW' : snapshot.confidence,
    status,
    signal: 'UNKNOWN',
    diagnostics: [
      'source=FRESH_DATA_REGISTRY',
      `sourceKeyNormalized=${sourceKey}`,
      `status=${status}`,
      `normalized=${String(snapshot.normalized)}`,
      `sampleMaterialized=${String(sampleMaterialized)}`,
      `usableForRouter=${String(usableForRouter)}`,
      `readinessKind=${snapshot.readinessKind ?? 'UNKNOWN'}`,
      `sourceOfTruth=${snapshot.sourceOfTruth ?? 'UNKNOWN'}`,
      'marketSignal=false because registry bridge carries sanitized readiness only',
    ],
  };
}


function compactRecordAdr0477(record: Record<string, unknown> | undefined): string {
  if (!record) return 'NONE';
  return Object.entries(record).map(([key, value]) => `${key}:${String(value)}`).join(',');
}

function compactRetainedSummaryAdr0477(summary: NonNullable<SupplySnapshotCacheLookupAdr0491['debug']>['retainedSummary'] | undefined): string {
  if (!summary) return 'NONE';
  return `total=${summary.total};byDomain=${compactRecordAdr0477(summary.byDomain)};bySource=${compactRecordAdr0477(summary.bySource)};byProvider=${compactRecordAdr0477(summary.byProvider)};normalized=true:${summary.normalized.true},false:${summary.normalized.false},missing:${summary.normalized.missing};byTradingDate=${compactRecordAdr0477(summary.byTradingDate)};sampleKeys=${summary.sampleKeys.slice(0, 3).join(' || ')}`;
}

function compactRouterLookupAdr0477(lookup: NonNullable<SupplySnapshotCacheLookupAdr0491['debug']>['routerLookup'] | undefined): string {
  if (!lookup) return 'NONE';
  return `requestedCode=${lookup.requestedCode};normalizedCode=${lookup.normalizedCode};route=${lookup.route};domainCandidates=${lookup.domainCandidates.join(',')};sourceCandidates=${lookup.sourceCandidates.join(',')};providerCandidates=${lookup.providerCandidates.join(',')};dateCandidates=${lookup.tradingDateCandidates.join(',')};requireNormalized=${String(lookup.requireNormalized)};allowStale=${String(lookup.allowStale)};rawPayloadPersistenceAllowed=false;liveExecutionAllowed=false`;
}

function compactClosestMatchesAdr0477(matches: NonNullable<SupplySnapshotCacheLookupAdr0491['debug']>['closestMatches'] | undefined): string {
  if (!matches || matches.length === 0) return 'NONE';
  return matches.slice(0, 3).map((match, index) => `${index + 1}.code=${match.code} symbol=${match.symbol ?? 'NONE'} source=${match.source} provider=${match.provider} tradingDate=${match.tradingDate} sourceDate=${match.sourceDate ?? 'NONE'} normalized=${String(match.normalized)} reason=${match.reason}`).join(' || ');
}

function cacheLookupStatusAdr0477(status: SupplySnapshotCacheLookupAdr0491['status']): InvestorFlowProviderStatus {
  if (status === 'CACHE_HIT') return 'CACHE_HIT';
  if (status === 'STALE_HIT' || status === 'CACHE_STALE_HIT') return 'CACHE_STALE_HIT';
  if (status === 'CACHE_KEY_MISMATCH') return 'CACHE_KEY_MISMATCH';
  if (status === 'CACHE_EMPTY') return 'CACHE_EMPTY';
  return 'ERROR';
}

function sampleFromCacheLookupAdr0491(
  lookup: SupplySnapshotCacheLookupAdr0491 | null | undefined,
  code: string,
  collectedAt: string,
): SemanticNetBuySample | null {
  if (!lookup?.cacheRaw) return null;
  const status = cacheLookupStatusAdr0477(lookup.status);
  if (status !== 'CACHE_HIT' && status !== 'CACHE_STALE_HIT') return null;
  return normalizeSemanticNetBuySampleAdr0477(lookup.cacheRaw, 'CACHE', {
    code,
    collectedAt,
    fallbackStatus: status === 'CACHE_STALE_HIT' ? 'CACHE_STALE_HIT' : 'CACHE_HIT',
  });
}

export function buildInvestorFlowProviderRouteResultAdr0477(
  input: InvestorFlowProviderRouterInput,
): InvestorFlowProviderRouteResult {
  const collectedAt = input.collectedAt ?? new Date().toISOString();
  const providerTried: InvestorFlowProviderId[] = ['NAVER', 'SEMANTIC_NETBUY', 'CACHE'];
  const providerStatuses: Record<string, InvestorFlowProviderStatus> = {};
  const providerReasons: Record<string, string> = {};
  const diagnostics: string[] = [];
  let selectedProvider: InvestorFlowProviderId = 'NONE';
  let selectedReason: string | null = null;
  let semanticNetBuy: SemanticNetBuySample | null = null;
  let routeStatus: InvestorFlowProviderStatus = input.nonTradingDay === true ? 'NON_TRADING_DAY' : 'DATA_UNAVAILABLE';
  let pendingSemanticFresh: SemanticNetBuySampleAdr0482 | null = null;
  let pendingSemanticDiagnostic: SemanticNetBuySampleAdr0482 | null = null;
  let pendingNaverStale: SemanticNetBuySample | null = null;
  const selectShadow = (provider: InvestorFlowProviderId, sample: SemanticNetBuySample, reason: string): void => {
    if (semanticNetBuy) return;
    selectedProvider = provider;
    selectedReason = reason;
    semanticNetBuy = sample;
    routeStatus = sample.status;
    providerReasons[provider] = reason;
    diagnostics.push(reason);
  };

  if (input.nonTradingDay === true) {
    providerStatuses.KRX = 'NON_TRADING_DAY';
    diagnostics.push('NON_TRADING_DAY is data unavailable, not bearish.');
  }

  const naverFreshDataSnapshot = findFreshDataSnapshotAdr0477(input.freshDataSupplyAdr0487, 'NAVER_INVESTOR_TREND');
  const freshNaver = freshDataSnapshotSampleAdr0477(input.freshDataSupplyAdr0487, 'NAVER_INVESTOR_TREND', input.code, collectedAt);
  if (freshNaver) {
    providerStatuses.NAVER = freshNaver.status;
    providerStatuses.NAVER_INVESTOR_TREND = freshNaver.status;
    providerReasons.NAVER_INVESTOR_TREND = 'FreshData registry bridge READY_FOR_SHADOW normalized NAVER_INVESTOR_TREND sample.';
    selectShadow('NAVER_INVESTOR_TREND', freshNaver, providerReasons.NAVER_INVESTOR_TREND);
  } else if (naverFreshDataSnapshot) {
    const sampleMaterialized = freshDataSnapshotMaterializedAdr0477(naverFreshDataSnapshot);
    const usableForRouter = freshDataSnapshotUsableForRouterAdr0477(naverFreshDataSnapshot);
    providerStatuses.NAVER = sampleMaterialized ? statusFromFreshDataSnapshot(naverFreshDataSnapshot) : 'REGISTRY_READY_NOT_MATERIALIZED';
    providerStatuses.NAVER_INVESTOR_TREND = providerStatuses.NAVER;
    providerReasons.NAVER_INVESTOR_TREND = `FreshData NAVER readinessKind=${naverFreshDataSnapshot.readinessKind ?? 'REGISTRY_READY'} sampleMaterialized=${String(sampleMaterialized)} usableForRouter=${String(usableForRouter)}; not router-selectable.`;
    diagnostics.push(providerReasons.NAVER_INVESTOR_TREND);
  }

  const semanticFreshDataSnapshot = findFreshDataSnapshotAdr0477(input.freshDataSupplyAdr0487, 'SEMANTIC_NETBUY');
  const freshSemantic = freshDataSnapshotSampleAdr0477(input.freshDataSupplyAdr0487, 'SEMANTIC_NETBUY', input.code, collectedAt);
  if (freshSemantic) {
    providerStatuses.SEMANTIC_NETBUY = freshSemantic.status;
    providerReasons.SEMANTIC_NETBUY = 'FreshData registry bridge READY_FOR_SHADOW normalized SEMANTIC_NETBUY sample.';
    selectShadow('SEMANTIC_NETBUY', freshSemantic, providerReasons.SEMANTIC_NETBUY);
  } else if (semanticFreshDataSnapshot) {
    const sampleMaterialized = freshDataSnapshotMaterializedAdr0477(semanticFreshDataSnapshot);
    const usableForRouter = freshDataSnapshotUsableForRouterAdr0477(semanticFreshDataSnapshot);
    providerStatuses.SEMANTIC_NETBUY = sampleMaterialized ? statusFromFreshDataSnapshot(semanticFreshDataSnapshot) : 'NO_INPUT_SAMPLE';
    providerReasons.SEMANTIC_NETBUY = `FreshData SemanticNetBuy readinessKind=${semanticFreshDataSnapshot.readinessKind ?? 'REGISTRY_READY'} sampleMaterialized=${String(sampleMaterialized)} usableForRouter=${String(usableForRouter)}; not router-selectable.`;
    diagnostics.push(providerReasons.SEMANTIC_NETBUY);
  }

  if (input.semanticNetBuyNormalizationAdr0482) {
    providerStatuses.SEMANTIC_NETBUY = mapSemanticNetBuyStatusAdr0482ToAdr0477(input.semanticNetBuyNormalizationAdr0482.status);
    for (const sample of input.semanticNetBuyNormalizationAdr0482.samples) {
      providerStatuses[providerFromSemanticAdr0482(sample.provider)] = mapSemanticNetBuyStatusAdr0482ToAdr0477(sample.status);
    }
    pendingSemanticFresh = semanticNetBuyFreshCandidate(input.semanticNetBuyNormalizationAdr0482);
    pendingSemanticDiagnostic = semanticNetBuyDiagnosticCandidate(input.semanticNetBuyNormalizationAdr0482);
    if (!pendingSemanticFresh && !pendingSemanticDiagnostic) {
      routeStatus = mapSemanticNetBuyStatusAdr0482ToAdr0477(input.semanticNetBuyNormalizationAdr0482.status);
      diagnostics.push(`ADR-0482 semantic net-buy report has no selectable sample; reason=${input.semanticNetBuyNormalizationAdr0482.diagnostics.join('; ') || 'INPUT_SAMPLE_UNAVAILABLE'}. UNKNOWN is not bearish.`);
    }
  } else if (!freshSemantic) {
    providerStatuses.SEMANTIC_NETBUY = 'DATA_UNAVAILABLE';
    providerReasons.SEMANTIC_NETBUY = 'ADR-0482 normalizer input not supplied and no FreshData registry bridge sample.';
    diagnostics.push('ADR-0482 semantic net-buy normalizer input not supplied; reason=INPUT_SAMPLE_UNAVAILABLE.');
  }

  if (input.naverCollectorWired === true || input.naverCollectorResultAdr0481) {
    const adr0481 = input.naverCollectorResultAdr0481;
    const naverRaw = adr0481?.semanticNetBuyCandidate ? {
      code: input.code,
      sourceDate: adr0481.semanticNetBuyCandidate.sourceDate,
      foreignNetBuy: adr0481.semanticNetBuyCandidate.foreignNetBuy,
      institutionNetBuy: adr0481.semanticNetBuyCandidate.institutionNetBuy,
      programNetBuy: adr0481.semanticNetBuyCandidate.programNetBuy,
      status: adr0481.semanticNetBuyCandidate.status === 'VERIFIED' ? 'VERIFIED' : adr0481.semanticNetBuyCandidate.status,
    } : input.naverRaw;
    const naverSample = normalizeSemanticNetBuySampleAdr0477(naverRaw, 'NAVER_INVESTOR_TREND', {
      code: input.code,
      collectedAt,
      sourceAgeTradingDays: adr0481?.freshness.sourceAgeTradingDays ?? input.sourceAgeTradingDays,
      fallbackStatus: naverRaw ? undefined : adr0481 ? mapNaverAdr0481StatusToAdr0477(adr0481.status) : 'DATA_UNAVAILABLE',
    });
    const collectorStatus = adr0481 ? mapNaverAdr0481StatusToAdr0477(adr0481.status) : naverSample.status;
    if (adr0481?.semanticNetBuyCandidate || !providerStatuses.NAVER_INVESTOR_TREND) {
      providerStatuses.NAVER = collectorStatus;
      providerStatuses.NAVER_INVESTOR_TREND = collectorStatus;
    }
    if ((naverSample.status === 'VERIFIED' || naverSample.status === 'PARTIAL') && !semanticNetBuy) {
      selectShadow('NAVER_INVESTOR_TREND', naverSample, 'ADR-0481 NAVER investor trend collector selected for SHADOW_ONLY.');
    } else if (naverSample.status === 'STALE' || naverSample.status === 'DEGRADED') {
      pendingNaverStale = naverSample;
      routeStatus = naverSample.status;
      diagnostics.push('NAVER source is stale/degraded; positive source blocked, not bearish.');
    }
  } else if (!freshNaver) {
    providerStatuses.NAVER = 'NOT_WIRED';
    providerReasons.NAVER = 'NAVER collector implementation not wired and no FreshData registry bridge sample.';
    diagnostics.push('NAVER investor trend collector NOT_WIRED; provider issue only.');
  }

  if (!semanticNetBuy && pendingSemanticFresh) {
    selectShadow('SEMANTIC_NETBUY', sampleFromSemanticAdr0482(pendingSemanticFresh), 'ADR-0482 semantic net-buy fresh selected sample consumed by ADR-0477.');
  }

  if (!semanticNetBuy && pendingNaverStale) {
    selectShadow('NAVER_INVESTOR_TREND', pendingNaverStale, 'ADR-0481 NAVER previousTradingDate/off-hours sample selected as STALE SHADOW_ONLY diagnostic.');
  }

  if (!semanticNetBuy && pendingSemanticDiagnostic) {
    selectShadow('SEMANTIC_NETBUY', sampleFromSemanticAdr0482(pendingSemanticDiagnostic), 'ADR-0482 semantic net-buy diagnostic sample consumed for OBSERVE/SHADOW_ONLY only.');
  }

  const cacheLookup = input.supplySnapshotCacheLookupAdr0491;
  const cacheLookupSample = sampleFromCacheLookupAdr0491(cacheLookup, input.code, collectedAt);
  if (cacheLookup) {
    providerStatuses.CACHE = cacheLookupStatusAdr0477(cacheLookup.status);
    const mismatchHints = cacheLookup.debug?.mismatchHints?.join(',') || 'NONE';
    const dateCandidates = cacheLookup.debug?.routerLookup?.tradingDateCandidates?.join(',') ?? 'NONE';
    providerReasons.CACHE = `ADR-0491 cacheLookupResult=${cacheLookup.status} reason=${cacheLookup.reason} mismatchHints=${mismatchHints} dateCandidates=${dateCandidates}`;
    const normalizedCacheKey = normalizeInvestorFlowSnapshotKeyAdr0491({ code: input.code, route: 'investor_flow', domain: 'SUPPLY' });
    diagnostics.push(`cacheLookupResult=${cacheLookup.status}; cacheLookupKey=${cacheLookup.debug?.lookupKey ?? normalizedCacheKey.lookupKey}; triedKeys=${cacheLookup.debug?.triedKeys?.join(',') ?? 'NONE'}; retained=${cacheLookup.retained}; sourceKeyNormalized=${normalizedCacheKey.sourceCandidates.join(',')}; dateCandidates=${dateCandidates}; mismatchHints=${mismatchHints}; rawPayloadPersistenceAllowed=false; liveExecutionAllowed=false`);
    diagnostics.push(`retainedSummary=${compactRetainedSummaryAdr0477(cacheLookup.debug?.retainedSummary)}`);
    diagnostics.push(`routerLookup=${compactRouterLookupAdr0477(cacheLookup.debug?.routerLookup)}`);
    diagnostics.push(`closestMatches=${compactClosestMatchesAdr0477(cacheLookup.debug?.closestMatches)}`);
  }
  if (!semanticNetBuy) {
    const cacheRaw = cacheLookupSample ? null : input.cacheRaw ?? input.previousTradingDayCacheRaw;
    const cacheSample = cacheLookupSample ?? normalizeSemanticNetBuySampleAdr0477(cacheRaw, 'CACHE', {
      code: input.code,
      collectedAt,
      sourceAgeTradingDays: input.cacheAgeTradingDays,
      fallbackStatus: cacheRaw ? undefined : 'CACHE_EMPTY',
    });
    if (!cacheLookup || cacheLookupSample) providerStatuses.CACHE = cacheLookupSample && cacheLookup ? cacheLookupStatusAdr0477(cacheLookup.status) : cacheSample.status;
    if (cacheSample.status === 'VERIFIED' || cacheSample.status === 'PARTIAL' || cacheSample.status === 'STALE' || cacheSample.status === 'CACHE_HIT' || cacheSample.status === 'CACHE_STALE_HIT') {
      const naverNotMaterialized = naverFreshDataSnapshot && !freshDataSnapshotMaterializedAdr0477(naverFreshDataSnapshot)
        ? ` because NAVER readinessKind=${naverFreshDataSnapshot.readinessKind ?? 'REGISTRY_READY'} usableForRouter=${String(freshDataSnapshotUsableForRouterAdr0477(naverFreshDataSnapshot))}`
        : '';
      selectShadow('CACHE', cacheSample, cacheLookup ? `ADR-0491 sanitized snapshot cache selected: ${cacheLookup.status}${naverNotMaterialized}.` : `CACHE fallback used${naverNotMaterialized}; fallback only, not primary truth.`);
    }
  } else if (!providerStatuses.CACHE) {
    providerStatuses.CACHE = input.cacheRaw ? 'PARTIAL' : 'CACHE_EMPTY';
  }

  if (input.kisTriedForInvestorFlow === true) {
    providerTried.push('KIS');
    providerStatuses.KIS = 'PROVIDER_MISMATCH';
    diagnostics.push('KIS skipped/mismatch for semantic investor_flow route.');
  }
  if (input.marketProgramStatus === 'ACCEPTED_EMPTY') {
    providerTried.push('KRX');
    providerStatuses.MARKET_PROGRAM = 'ACCEPTED_EMPTY';
    diagnostics.push('ACCEPTED_EMPTY market/program data excluded from scoring, not bearish.');
  }
  if ((input.fssSourceAgeTradingDays ?? 0) >= 4) {
    providerTried.push('FSS');
    providerStatuses.FSS = 'STALE';
    diagnostics.push(`FSS source stale ${input.fssSourceAgeTradingDays} trading days; diagnostic only.`);
  }

  const selectedSemanticNetBuy = semanticNetBuy as SemanticNetBuySample | null;
  const signal = selectedSemanticNetBuy?.signal ?? 'UNKNOWN';
  if (!semanticNetBuy && providerStatuses.NAVER === 'NOT_WIRED' && providerStatuses.CACHE === 'CACHE_EMPTY') {
    routeStatus = 'DATA_UNAVAILABLE';
  }
  const sourceAge = input.sourceAgeTradingDays ?? input.cacheAgeTradingDays ?? null;
  const oldest = [input.sourceAgeTradingDays, input.cacheAgeTradingDays, input.fssSourceAgeTradingDays]
    .filter((item): item is number => finiteNumber(item))
    .sort((a, b) => b - a)[0] ?? null;
  const status = signal === 'UNKNOWN' && routeStatus === 'VERIFIED' ? 'DEGRADED' : routeStatus;
  const inputSources = Array.from(new Set([
    ...(input.naverCollectorResultAdr0481?.semanticNetBuyCandidate ? ['NAVER_INVESTOR_TREND' as const] : []),
    ...(input.semanticNetBuyNormalizationAdr0482?.samples.map((sample) => providerFromSemanticAdr0482(sample.provider)) ?? []),
    ...(cacheLookupSample || input.cacheRaw || input.previousTradingDayCacheRaw ? ['CACHE' as const] : []),
  ]));

  return {
    code: input.code,
    route: 'investor_flow',
    selectedProvider,
    providerTried,
    providerReasons,
    providerStatuses,
    semanticNetBuy: selectedSemanticNetBuy,
    status,
    signal,
    coverage: coverageFromStatuses(providerStatuses),
    freshness: {
      cacheState: cacheState(providerStatuses.CACHE),
      sourceState: sourceState(sourceAge),
      sourceAgeTradingDays: sourceAge,
      oldestSourceAgeTradingDays: oldest,
      lastSourceDate: selectedSemanticNetBuy?.sourceDate ?? null,
    },
    ...ROUTER_POLICY,
    selectedReason,
    inputSources,
    cacheFallbackUsed: selectedSemanticNetBuy?.source === 'CACHE',
    semanticInputStatus: providerStatuses.SEMANTIC_NETBUY ?? 'DATA_UNAVAILABLE',
    naverSampleStatus: providerStatuses.NAVER_INVESTOR_TREND ?? providerStatuses.NAVER ?? 'DATA_UNAVAILABLE',
    naverReadinessKind: naverFreshDataSnapshot?.readinessKind,
    semanticReadinessKind: semanticFreshDataSnapshot?.readinessKind,
    selectedFreshness: selectedSemanticNetBuy?.status === 'STALE' || selectedSemanticNetBuy?.status === 'CACHE_STALE_HIT'
      ? 'STALE'
      : selectedSemanticNetBuy?.status === 'VERIFIED' || selectedSemanticNetBuy?.status === 'READY_FOR_SHADOW' || selectedSemanticNetBuy?.status === 'PARTIAL' || selectedSemanticNetBuy?.status === 'CACHE_HIT'
        ? 'FRESH'
        : selectedSemanticNetBuy ? 'UNKNOWN' : 'MISSING',
    selectedConfidence: selectedSemanticNetBuy?.confidence ?? 'NONE',
    diagnostics,
  };
}

export function formatInvestorFlowProviderRouterAdr0477(
  result?: InvestorFlowProviderRouteResult | null,
): string | null {
  if (!result) return null;
  const nextAction = result.status === 'DATA_UNAVAILABLE' || result.coverage.notWired > 0
    ? 'WIRE_NAVER_OR_REPAIR_CACHE_KEY / feed SemanticNetBuy normalized input / keep UNKNOWN out of bearish scoring'
    : result.freshness.oldestSourceAgeTradingDays !== null && result.freshness.oldestSourceAgeTradingDays >= 4
      ? 'refresh stale FSS source / keep UNKNOWN out of bearish scoring'
      : 'store ADR-0476 observation row and keep provider issue out of bearish scoring';
  return [
    '🔌 Investor Flow Provider Router (ADR-0477)',
    `- route: ${result.route}`,
    `- selectedProvider: ${result.selectedProvider}`,
    `- status: ${result.status}`,
    `- signal: ${result.signal}`,
    `- coverage: ${result.coverage.available}/${result.coverage.total}`,
    `- freshness: cache=${result.freshness.cacheState}, source=${result.freshness.sourceState}, oldest=${result.freshness.oldestSourceAgeTradingDays ?? 'unknown'} trading days`,
    `- selectedReason: ${result.selectedReason ?? 'NONE'}`,
    `- inputSources: ${result.inputSources?.join(',') || 'NONE'}`,
    `- cacheFallbackUsed: ${result.cacheFallbackUsed ?? false}`,
    `- semanticInputStatus: ${result.semanticInputStatus ?? result.providerStatuses.SEMANTIC_NETBUY ?? 'DATA_UNAVAILABLE'}`,
    `- naverSampleStatus: ${result.naverSampleStatus ?? result.providerStatuses.NAVER_INVESTOR_TREND ?? result.providerStatuses.NAVER ?? 'DATA_UNAVAILABLE'}`,
    `- naverReadinessKind: ${result.naverReadinessKind ?? 'UNKNOWN'}`,
    `- semanticReadinessKind: ${result.semanticReadinessKind ?? 'UNKNOWN'}`,
    `- selectedFreshness: ${result.selectedFreshness ?? 'UNKNOWN'}`,
    `- selectedConfidence: ${result.selectedConfidence ?? 'NONE'}`,
    `- providerTried: ${result.providerTried.join(' -> ') || 'NONE'}`,
    `- providerTriedDetail: ${Object.entries(result.providerReasons).map(([provider, reason]) => `${provider}=${reason}`).join(' | ') || 'NONE'}`,
    `- rawPayloadPersistenceAllowed: false`,
    `- executionImpact: ${result.executionImpact}`,
    `- liveExecutionAllowed: ${result.liveExecutionAllowed}`,
    '- 수급 악화가 아니라 수급 데이터 라우팅/커버리지 문제입니다.',
    '- UNKNOWN/provider issue는 bearish로 변환되지 않습니다.',
    '- STRONG_BUY는 차단될 수 있지만 Gate fail로 확정하지 않습니다.',
    '- ADR-0476 ledger에 관찰 row를 저장합니다.',
    `- nextAction: ${nextAction}`,
  ].join('\n');
}
