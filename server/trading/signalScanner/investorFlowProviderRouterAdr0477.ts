// @responsibility ADR-0477 Investor Flow Provider Router; semantic net-buy routing dry-run only.
import type { NaverInvestorTrendCollectorResult } from './naverInvestorTrendCollectorAdr0481.js';
import type { SemanticNetBuyNormalizationReportAdr0482, SemanticNetBuyProvider, SemanticNetBuySampleAdr0482, SemanticNetBuyStatus } from './semanticNetBuyNormalizerAdr0482.js';
import type { FreshDataSupplyReportAdr0487, FreshDataSnapshotAdr0487 } from './freshDataSupplyLayerAdr0487.js';
import type { SupplySnapshotCacheLookupAdr0491 } from './supplySnapshotStoreReplayAdr0491.js';
import { normalizeInvestorFlowSnapshotKeyAdr0491, normalizeInvestorFlowSourceKeyAdr0491 as normalizeInvestorFlowSourceKeySharedAdr0491 } from './investorFlowSnapshotKeyNormalizerAdr0491.js';
import {
  buildInvestorSampleDiagnosticsAdr0502,
  formatInvestorSampleDiagnosticsAdr0502,
  type InvestorSampleDiagnosticsAdr0502,
  type InvestorSampleProviderNameAdr0502,
} from './investorSampleMaterializationAdr0502.js';


export type InvestorFlowProviderId =
  | 'KIS'
  | 'KIS_API'
  | 'KRX'
  | 'KRX_INVESTOR_FLOW'
  | 'NAVER'
  | 'NAVER_INVESTOR_TREND'
  | 'FSS'
  | 'FSS_PASSIVE_ACTIVE'
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
  materializationDiagnostics?: Partial<Record<InvestorSampleProviderNameAdr0502, InvestorSampleDiagnosticsAdr0502>>;
  rejectedProviders?: InvestorFlowProviderId[];
  rejectedReasonByProvider?: Record<string, string>;
  fallbackChain?: InvestorFlowProviderId[];
  cacheFallbackReason?: string | null;
  staleButSelectedReason?: string | null;
  coverageBefore?: number;
  coverageAfter?: number;
  noMaterializedCandidateReason?: string | null;
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
  kisInvestorRaw?: Record<string, unknown> | null;
  krxInvestorRaw?: Record<string, unknown> | null;
  previousTradingDayKrxRaw?: Record<string, unknown> | null;
  fssPassiveActiveRaw?: Record<string, unknown> | null;
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

function providerIdFromMaterializationAdr0477(providerName: InvestorSampleProviderNameAdr0502): InvestorFlowProviderId {
  if (providerName === 'NAVER_INVESTOR_TREND') return 'NAVER_INVESTOR_TREND';
  if (providerName === 'SEMANTIC_NETBUY') return 'SEMANTIC_NETBUY';
  if (providerName === 'CACHE') return 'CACHE';
  if (providerName === 'KIS_INVESTOR') return 'KIS_API';
  if (providerName === 'KRX_INVESTOR_FLOW') return 'KRX_INVESTOR_FLOW';
  if (providerName === 'FSS_PASSIVE_ACTIVE') return 'FSS_PASSIVE_ACTIVE';
  return 'UNKNOWN';
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
  const foreignNetBuy = valueFromAliases(raw, ['foreignNetBuy', 'investorForeignNetBuy', 'foreign', 'frgnNetBuy']);
  const institutionNetBuy = valueFromAliases(raw, ['institutionNetBuy', 'institutionalNetBuy', 'investorInstitutionNetBuy', 'institution', 'orgNetBuy']);
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

function materializationFromSemanticSampleAdr0477(
  providerName: InvestorSampleProviderNameAdr0502,
  sample: SemanticNetBuySample | null,
  inputSourceKind: 'RAW_PROVIDER' | 'NORMALIZED_PROVIDER' | 'SEMANTIC_DERIVED' | 'CACHE_FALLBACK' | 'PLACEHOLDER' | 'NONE',
  blockedReason?: InvestorSampleDiagnosticsAdr0502['blockedReason'],
): InvestorSampleDiagnosticsAdr0502 {
  const materializedCount = sample && (finiteNumber(sample.foreignNetBuy) || finiteNumber(sample.institutionNetBuy) || finiteNumber(sample.programNetBuy)) ? 1 : 0;
  const fieldCount = sample ? [sample.foreignNetBuy, sample.institutionNetBuy, sample.programNetBuy].filter(finiteNumber).length : 0;
  return buildInvestorSampleDiagnosticsAdr0502({
    providerName,
    rawFetched: Boolean(sample),
    rawCount: sample ? 1 : 0,
    normalizedCount: sample ? 1 : 0,
    materializedCount,
    symbolCoverage: sample?.code ? 1 : 0,
    dateCoverage: sample?.sourceDate ?? null,
    fieldCoverage: fieldCount / 3,
    placeholderDetected: !sample || materializedCount === 0,
    inputSourceKind,
    inputSources: [providerName],
    confidenceLevel: sample?.confidence === 'HIGH' ? 'VERIFIED' : sample?.confidence === 'MEDIUM' ? 'PARTIAL' : sample?.confidence === 'LOW' ? 'LOW' : 'MISSING',
    staleReason: sample?.status === 'STALE' || sample?.status === 'CACHE_STALE_HIT' ? `status=${sample.status}` : null,
    blockedReason: materializedCount > 0 ? 'NONE' : blockedReason,
    safePreview: sample ? [{
      code: sample.code,
      sourceDate: sample.sourceDate,
      foreignNetBuy: sample.foreignNetBuy,
      institutionNetBuy: sample.institutionNetBuy,
      programNetBuy: sample.programNetBuy,
    }] : [],
  });
}

export type InvestorFlowMaterializedSourceKindAdr0503 =
  | 'KIS_SYMBOL_INVESTOR_FLOW'
  | 'KRX_PREVIOUS_TRADING_DATE'
  | 'NAVER_PREVIOUS_TRADING_DATE'
  | 'FSS_STALE_DIAGNOSTIC'
  | 'CACHE_SANITIZED_SNAPSHOT'
  | 'SEMANTIC_DERIVED';

export interface InvestorFlowMaterializedCandidateAdr0503 {
  provider: InvestorFlowProviderId;
  sourceKind: InvestorFlowMaterializedSourceKindAdr0503;
  sourceDate: string | null;
  rawCount: number;
  normalizedCount: number;
  materializedCount: number;
  sampleMaterialized: boolean;
  usableForRouter: boolean;
  usableForShadow: boolean;
  confidence: SemanticNetBuySample['confidence'];
  freshness: 'FRESH' | 'STALE' | 'MISSING' | 'UNKNOWN';
  blockedReason: InvestorSampleDiagnosticsAdr0502['blockedReason'];
  placeholderDetected: boolean;
  inputSourceKind: InvestorSampleDiagnosticsAdr0502['inputSourceKind'];
  selectedPriority: number;
  selectionReason: string;
}

export function collectInvestorFlowMaterializedCandidates(
  materializationDiagnostics: Partial<Record<InvestorSampleProviderNameAdr0502, InvestorSampleDiagnosticsAdr0502>>,
  samplesByProvider: Partial<Record<InvestorFlowProviderId, SemanticNetBuySample>>,
): InvestorFlowMaterializedCandidateAdr0503[] {
  const priority: Record<string, number> = {
    KIS_API: 1,
    KRX_INVESTOR_FLOW: 2,
    NAVER_INVESTOR_TREND: 3,
    FSS_PASSIVE_ACTIVE: 4,
    CACHE: 5,
    SEMANTIC_NETBUY: 6,
  };
  const sourceKind: Record<string, InvestorFlowMaterializedSourceKindAdr0503> = {
    KIS_API: 'KIS_SYMBOL_INVESTOR_FLOW',
    KRX_INVESTOR_FLOW: 'KRX_PREVIOUS_TRADING_DATE',
    NAVER_INVESTOR_TREND: 'NAVER_PREVIOUS_TRADING_DATE',
    FSS_PASSIVE_ACTIVE: 'FSS_STALE_DIAGNOSTIC',
    CACHE: 'CACHE_SANITIZED_SNAPSHOT',
    SEMANTIC_NETBUY: 'SEMANTIC_DERIVED',
  };
  return Object.values(materializationDiagnostics).map((diag) => {
    const provider = providerIdFromMaterializationAdr0477(diag.providerName);
    const sample = samplesByProvider[provider];
    const freshness: InvestorFlowMaterializedCandidateAdr0503['freshness'] =
      sample?.status === 'STALE' || sample?.status === 'CACHE_STALE_HIT' ? 'STALE'
        : sample?.status === 'VERIFIED' || sample?.status === 'PARTIAL' || sample?.status === 'CACHE_HIT' ? 'FRESH'
          : diag.staleReason ? 'STALE'
            : diag.sampleMaterialized ? 'UNKNOWN' : 'MISSING';
    return {
      provider,
      sourceKind: sourceKind[provider] ?? 'SEMANTIC_DERIVED',
      sourceDate: sample?.sourceDate ?? diag.dateCoverage,
      rawCount: diag.rawCount,
      normalizedCount: diag.normalizedCount,
      materializedCount: diag.materializedCount,
      sampleMaterialized: diag.sampleMaterialized,
      usableForRouter: diag.usableForRouter,
      usableForShadow: diag.sampleMaterialized,
      confidence: sample?.confidence ?? (diag.confidenceLevel === 'VERIFIED' ? 'HIGH' : diag.confidenceLevel === 'PARTIAL' ? 'MEDIUM' : diag.confidenceLevel === 'LOW' || diag.confidenceLevel === 'DEGRADED' ? 'LOW' : 'NONE'),
      freshness,
      blockedReason: diag.blockedReason,
      placeholderDetected: diag.placeholderDetected,
      inputSourceKind: diag.inputSourceKind,
      selectedPriority: priority[provider] ?? 99,
      selectionReason: `${provider} materialized=${diag.sampleMaterialized} usableForRouter=${diag.usableForRouter} rawCount=${diag.rawCount} normalizedCount=${diag.normalizedCount} materializedCount=${diag.materializedCount} blockedReason=${diag.blockedReason}`,
    };
  });
}

export function rankInvestorFlowMaterializedCandidates(
  candidates: readonly InvestorFlowMaterializedCandidateAdr0503[],
): InvestorFlowMaterializedCandidateAdr0503[] {
  return [...candidates]
    .filter((candidate) => candidate.sampleMaterialized && candidate.usableForRouter && !candidate.placeholderDetected)
    .sort((a, b) => a.selectedPriority - b.selectedPriority || b.materializedCount - a.materializedCount);
}

export function selectBestInvestorFlowCandidate(
  candidates: readonly InvestorFlowMaterializedCandidateAdr0503[],
): InvestorFlowMaterializedCandidateAdr0503 | null {
  return rankInvestorFlowMaterializedCandidates(candidates)[0] ?? null;
}

export function buildInvestorFlowMultiSourceMaterialization(
  materializationDiagnostics: Partial<Record<InvestorSampleProviderNameAdr0502, InvestorSampleDiagnosticsAdr0502>>,
  samplesByProvider: Partial<Record<InvestorFlowProviderId, SemanticNetBuySample>>,
): {
  candidates: InvestorFlowMaterializedCandidateAdr0503[];
  rankedCandidates: InvestorFlowMaterializedCandidateAdr0503[];
  selectedCandidate: InvestorFlowMaterializedCandidateAdr0503 | null;
  noMaterializedCandidateReason: string | null;
} {
  const candidates = collectInvestorFlowMaterializedCandidates(materializationDiagnostics, samplesByProvider);
  const rankedCandidates = rankInvestorFlowMaterializedCandidates(candidates);
  const selectedCandidate = rankedCandidates[0] ?? null;
  return {
    candidates,
    rankedCandidates,
    selectedCandidate,
    noMaterializedCandidateReason: selectedCandidate ? null : candidates.length === 0
      ? 'NO_PROVIDER_DIAGNOSTICS'
      : candidates.map((candidate) => `${candidate.provider}:${candidate.blockedReason}:materialized=${candidate.materializedCount}`).join('|'),
  };
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
  const materializationDiagnostics: Partial<Record<InvestorSampleProviderNameAdr0502, InvestorSampleDiagnosticsAdr0502>> = {};
  const samplesByProvider: Partial<Record<InvestorFlowProviderId, SemanticNetBuySample>> = {};
  const selectShadow = (provider: InvestorFlowProviderId, sample: SemanticNetBuySample, reason: string): void => {
    if (semanticNetBuy) return;
    selectedProvider = provider;
    selectedReason = reason;
    semanticNetBuy = sample;
    samplesByProvider[provider] = sample;
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
    materializationDiagnostics.NAVER_INVESTOR_TREND = materializationFromSemanticSampleAdr0477('NAVER_INVESTOR_TREND', freshNaver, 'NORMALIZED_PROVIDER');
    samplesByProvider.NAVER_INVESTOR_TREND = freshNaver;
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
    materializationDiagnostics.NAVER_INVESTOR_TREND = buildInvestorSampleDiagnosticsAdr0502({
      providerName: 'NAVER_INVESTOR_TREND',
      rawFetched: sampleMaterialized,
      rawCount: sampleMaterialized ? 1 : 0,
      normalizedCount: naverFreshDataSnapshot.normalized ? 1 : 0,
      materializedCount: sampleMaterialized ? 1 : 0,
      symbolCoverage: naverFreshDataSnapshot.coverageRatio,
      dateCoverage: naverFreshDataSnapshot.sourceDate,
      fieldCoverage: naverFreshDataSnapshot.normalized ? 1 : 0,
      placeholderDetected: !sampleMaterialized,
      inputSourceKind: sampleMaterialized ? 'NORMALIZED_PROVIDER' : 'PLACEHOLDER',
      blockedReason: sampleMaterialized ? 'NOT_ROUTER_USABLE' : 'PLACEHOLDER_ONLY',
      confidenceLevel: naverFreshDataSnapshot.confidence === 'HIGH' ? 'VERIFIED' : naverFreshDataSnapshot.confidence === 'MEDIUM' ? 'PARTIAL' : naverFreshDataSnapshot.confidence === 'LOW' ? 'LOW' : 'MISSING',
    });
    diagnostics.push(providerReasons.NAVER_INVESTOR_TREND);
  }

  const semanticFreshDataSnapshot = findFreshDataSnapshotAdr0477(input.freshDataSupplyAdr0487, 'SEMANTIC_NETBUY');
  const freshSemantic = freshDataSnapshotSampleAdr0477(input.freshDataSupplyAdr0487, 'SEMANTIC_NETBUY', input.code, collectedAt);
  if (freshSemantic) {
    materializationDiagnostics.SEMANTIC_NETBUY = materializationFromSemanticSampleAdr0477('SEMANTIC_NETBUY', freshSemantic, 'NORMALIZED_PROVIDER');
    samplesByProvider.SEMANTIC_NETBUY = freshSemantic;
    providerStatuses.SEMANTIC_NETBUY = freshSemantic.status;
    providerReasons.SEMANTIC_NETBUY = 'FreshData registry bridge READY_FOR_SHADOW normalized SEMANTIC_NETBUY sample.';
    selectShadow('SEMANTIC_NETBUY', freshSemantic, providerReasons.SEMANTIC_NETBUY);
  } else if (semanticFreshDataSnapshot) {
    const sampleMaterialized = freshDataSnapshotMaterializedAdr0477(semanticFreshDataSnapshot);
    const usableForRouter = freshDataSnapshotUsableForRouterAdr0477(semanticFreshDataSnapshot);
    providerStatuses.SEMANTIC_NETBUY = sampleMaterialized ? statusFromFreshDataSnapshot(semanticFreshDataSnapshot) : 'NO_INPUT_SAMPLE';
    providerReasons.SEMANTIC_NETBUY = `FreshData SemanticNetBuy readinessKind=${semanticFreshDataSnapshot.readinessKind ?? 'REGISTRY_READY'} sampleMaterialized=${String(sampleMaterialized)} usableForRouter=${String(usableForRouter)}; not router-selectable.`;
    materializationDiagnostics.SEMANTIC_NETBUY = buildInvestorSampleDiagnosticsAdr0502({
      providerName: 'SEMANTIC_NETBUY',
      rawFetched: sampleMaterialized,
      rawCount: sampleMaterialized ? 1 : 0,
      normalizedCount: semanticFreshDataSnapshot.normalized ? 1 : 0,
      materializedCount: sampleMaterialized ? 1 : 0,
      symbolCoverage: semanticFreshDataSnapshot.coverageRatio,
      dateCoverage: semanticFreshDataSnapshot.sourceDate,
      fieldCoverage: semanticFreshDataSnapshot.normalized ? 1 : 0,
      placeholderDetected: !sampleMaterialized,
      inputSourceKind: sampleMaterialized ? 'SEMANTIC_DERIVED' : 'PLACEHOLDER',
      blockedReason: sampleMaterialized ? 'NO_REAL_INPUT_SOURCE' : 'NO_INPUT_SAMPLE',
      confidenceLevel: semanticFreshDataSnapshot.confidence === 'HIGH' ? 'VERIFIED' : semanticFreshDataSnapshot.confidence === 'MEDIUM' ? 'PARTIAL' : semanticFreshDataSnapshot.confidence === 'LOW' ? 'LOW' : 'MISSING',
    });
    diagnostics.push(providerReasons.SEMANTIC_NETBUY);
  }

  if (input.semanticNetBuyNormalizationAdr0482) {
    materializationDiagnostics.SEMANTIC_NETBUY = input.semanticNetBuyNormalizationAdr0482.materializationDiagnostics;
    providerStatuses.SEMANTIC_NETBUY = mapSemanticNetBuyStatusAdr0482ToAdr0477(input.semanticNetBuyNormalizationAdr0482.status);
    for (const sample of input.semanticNetBuyNormalizationAdr0482.samples) {
      providerStatuses[providerFromSemanticAdr0482(sample.provider)] = mapSemanticNetBuyStatusAdr0482ToAdr0477(sample.status);
    }
    pendingSemanticFresh = semanticNetBuyFreshCandidate(input.semanticNetBuyNormalizationAdr0482);
    pendingSemanticDiagnostic = semanticNetBuyDiagnosticCandidate(input.semanticNetBuyNormalizationAdr0482);
    const semanticCandidate = pendingSemanticFresh ?? pendingSemanticDiagnostic;
    if (semanticCandidate) samplesByProvider.SEMANTIC_NETBUY = sampleFromSemanticAdr0482(semanticCandidate);
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
    if (adr0481?.materializationDiagnostics) {
      materializationDiagnostics.NAVER_INVESTOR_TREND = adr0481.materializationDiagnostics;
    }
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
    if (!materializationDiagnostics.NAVER_INVESTOR_TREND) {
      materializationDiagnostics.NAVER_INVESTOR_TREND = materializationFromSemanticSampleAdr0477('NAVER_INVESTOR_TREND', naverSample, 'RAW_PROVIDER');
    }
    if (materializationDiagnostics.NAVER_INVESTOR_TREND?.sampleMaterialized) samplesByProvider.NAVER_INVESTOR_TREND = naverSample;
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
    const sample = sampleFromSemanticAdr0482(pendingSemanticFresh);
    samplesByProvider.SEMANTIC_NETBUY = sample;
    selectShadow('SEMANTIC_NETBUY', sample, 'ADR-0482 semantic net-buy fresh selected sample consumed by ADR-0477.');
  }

  if (!semanticNetBuy && pendingNaverStale) {
    samplesByProvider.NAVER_INVESTOR_TREND = pendingNaverStale;
    selectShadow('NAVER_INVESTOR_TREND', pendingNaverStale, 'ADR-0481 NAVER previousTradingDate/off-hours sample selected as STALE SHADOW_ONLY diagnostic.');
  }

  if (!semanticNetBuy && pendingSemanticDiagnostic) {
    const sample = sampleFromSemanticAdr0482(pendingSemanticDiagnostic);
    samplesByProvider.SEMANTIC_NETBUY = sample;
    selectShadow('SEMANTIC_NETBUY', sample, 'ADR-0482 semantic net-buy diagnostic sample consumed for OBSERVE/SHADOW_ONLY only.');
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
    materializationDiagnostics.CACHE = materializationFromSemanticSampleAdr0477(
      'CACHE',
      cacheSample.status === 'CACHE_EMPTY' || cacheSample.status === 'DATA_UNAVAILABLE' ? null : cacheSample,
      'CACHE_FALLBACK',
      cacheSample.status === 'CACHE_EMPTY' ? 'NO_INPUT_SAMPLE' : undefined,
    );
    if (materializationDiagnostics.CACHE?.sampleMaterialized) samplesByProvider.CACHE = cacheSample;
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

  const krxRaw = input.krxInvestorRaw ?? input.previousTradingDayKrxRaw ?? null;
  if (krxRaw) {
    const krxSample = normalizeSemanticNetBuySampleAdr0477(krxRaw, 'KRX_INVESTOR_FLOW', {
      code: input.code,
      collectedAt,
      sourceAgeTradingDays: input.sourceAgeTradingDays ?? (input.nonTradingDay === true ? 1 : 0),
      fallbackStatus: input.nonTradingDay === true ? 'STALE' : undefined,
    });
    materializationDiagnostics.KRX_INVESTOR_FLOW = materializationFromSemanticSampleAdr0477('KRX_INVESTOR_FLOW', krxSample, 'RAW_PROVIDER');
    if (materializationDiagnostics.KRX_INVESTOR_FLOW.sampleMaterialized) samplesByProvider.KRX_INVESTOR_FLOW = krxSample;
    providerStatuses.KRX_INVESTOR_FLOW = krxSample.status;
    providerStatuses.KRX = krxSample.status;
    providerReasons.KRX_INVESTOR_FLOW = input.previousTradingDayKrxRaw
      ? 'KRX previousTradingDate materialized investor-flow row selected as SHADOW_ONLY diagnostic candidate.'
      : 'KRX materialized investor-flow row selected as SHADOW_ONLY diagnostic candidate.';
  }

  if (input.kisInvestorRaw) {
    const kisSample = normalizeSemanticNetBuySampleAdr0477(input.kisInvestorRaw, 'KIS_API', {
      code: input.code,
      collectedAt,
      sourceAgeTradingDays: input.sourceAgeTradingDays,
    });
    materializationDiagnostics.KIS_INVESTOR = materializationFromSemanticSampleAdr0477('KIS_INVESTOR', kisSample, 'RAW_PROVIDER');
    if (materializationDiagnostics.KIS_INVESTOR.sampleMaterialized) samplesByProvider.KIS_API = kisSample;
    providerStatuses.KIS_API = kisSample.status;
    providerStatuses.KIS = kisSample.status;
    providerReasons.KIS_API = 'KIS symbol-level investor-flow row materialized; route separated from program trading.';
  }

  if (input.fssPassiveActiveRaw) {
    const fssSample = normalizeSemanticNetBuySampleAdr0477(input.fssPassiveActiveRaw, 'FSS_PASSIVE_ACTIVE', {
      code: input.code,
      collectedAt,
      sourceAgeTradingDays: input.fssSourceAgeTradingDays ?? 5,
      fallbackStatus: 'STALE',
    });
    materializationDiagnostics.FSS_PASSIVE_ACTIVE = materializationFromSemanticSampleAdr0477('FSS_PASSIVE_ACTIVE', fssSample, 'RAW_PROVIDER');
    if (materializationDiagnostics.FSS_PASSIVE_ACTIVE.sampleMaterialized) samplesByProvider.FSS_PASSIVE_ACTIVE = fssSample;
    providerStatuses.FSS_PASSIVE_ACTIVE = fssSample.status;
    providerStatuses.FSS = fssSample.status;
    providerReasons.FSS_PASSIVE_ACTIVE = 'FSS stale but materialized passive/active row allowed as SHADOW_ONLY diagnostic fallback.';
  }

  if (input.kisTriedForInvestorFlow === true) {
    providerTried.push('KIS');
    if (!providerStatuses.KIS && !providerStatuses.KIS_API) {
      providerStatuses.KIS = 'PROVIDER_MISMATCH';
      providerReasons.KIS_API = 'ROUTE_MISMATCH: KIS program route is not semantic investor_flow unless symbol-level investor fields are present.';
    }
    diagnostics.push('KIS investor-flow mismatch decomposed: ROUTE_MISMATCH/SYMBOL_MISMATCH/FIELD_MISMATCH/SESSION_MISMATCH/EMPTY_OUTPUT.');
  }
  if (input.marketProgramStatus === 'ACCEPTED_EMPTY') {
    providerTried.push('KRX');
    providerStatuses.MARKET_PROGRAM = 'ACCEPTED_EMPTY';
    diagnostics.push('ACCEPTED_EMPTY market/program data excluded from scoring, not bearish.');
  }
  if ((input.fssSourceAgeTradingDays ?? 0) >= 4) {
    providerTried.push('FSS');
    providerStatuses.FSS = providerStatuses.FSS ?? 'STALE';
    diagnostics.push(`FSS source stale ${input.fssSourceAgeTradingDays} trading days; diagnostic only.`);
  }

  const multiSourceMaterialization = buildInvestorFlowMultiSourceMaterialization(materializationDiagnostics, samplesByProvider);
  const selectedMultiSourceCandidate = multiSourceMaterialization.selectedCandidate;
  if (selectedMultiSourceCandidate) {
    const sample = samplesByProvider[selectedMultiSourceCandidate.provider];
    if (sample && selectedProvider !== selectedMultiSourceCandidate.provider) {
      const previousReason = providerReasons[selectedMultiSourceCandidate.provider];
      selectedProvider = selectedMultiSourceCandidate.provider;
      selectedReason = `ADR-0503 multi-source materialized candidate selected: ${selectedMultiSourceCandidate.selectionReason}`;
      semanticNetBuy = sample;
      routeStatus = sample.status;
      providerReasons[selectedMultiSourceCandidate.provider] = previousReason ? `${selectedReason}; ${previousReason}` : selectedReason;
      diagnostics.push(providerReasons[selectedMultiSourceCandidate.provider]);
    }
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
    ...multiSourceMaterialization.candidates.filter((candidate) => candidate.sampleMaterialized).map((candidate) => candidate.provider),
    ...(input.naverCollectorResultAdr0481?.semanticNetBuyCandidate ? ['NAVER_INVESTOR_TREND' as const] : []),
    ...(input.semanticNetBuyNormalizationAdr0482?.samples.map((sample) => providerFromSemanticAdr0482(sample.provider)) ?? []),
    ...(cacheLookupSample || input.cacheRaw || input.previousTradingDayCacheRaw ? ['CACHE' as const] : []),
  ]));
  const statusCoverage = coverageFromStatuses(providerStatuses);
  const fallbackChain: InvestorFlowProviderId[] = ['KIS_API', 'KRX_INVESTOR_FLOW', 'NAVER_INVESTOR_TREND', 'FSS_PASSIVE_ACTIVE', 'CACHE', 'SEMANTIC_NETBUY'];
  const selectedProviderForDiagnostics = selectedProvider as InvestorFlowProviderId;
  const rejectedReasonByProvider: Record<string, string> = {};
  for (const [providerName, materialization] of Object.entries(materializationDiagnostics)) {
    const provider = providerIdFromMaterializationAdr0477(providerName as InvestorSampleProviderNameAdr0502);
    if (provider === selectedProviderForDiagnostics) continue;
    if (materialization?.usableForRouter === true) continue;
    rejectedReasonByProvider[providerName] = materialization
      ? `blockedReason=${materialization.blockedReason}; sampleMaterialized=${materialization.sampleMaterialized}; usableForRouter=${materialization.usableForRouter}; rawCount=${materialization.rawCount}; normalizedCount=${materialization.normalizedCount}; materializedCount=${materialization.materializedCount}; placeholderDetected=${materialization.placeholderDetected}; inputSourceKind=${materialization.inputSourceKind}`
      : providerReasons[provider] ?? providerStatuses[provider] ?? 'NO_DIAGNOSTIC';
  }
  for (const provider of ['KIS_API', 'KRX_INVESTOR_FLOW', 'NAVER_INVESTOR_TREND', 'FSS_PASSIVE_ACTIVE', 'SEMANTIC_NETBUY', 'CACHE'] as const) {
    if (provider === selectedProviderForDiagnostics || rejectedReasonByProvider[provider]) continue;
    if (providerStatuses[provider]) rejectedReasonByProvider[provider] = providerReasons[provider] ?? `status=${providerStatuses[provider]}`;
  }
  const rejectedProviders = Object.keys(rejectedReasonByProvider) as InvestorFlowProviderId[];
  const coverageAfterSet = new Set<InvestorFlowProviderId>();
  for (const materialization of Object.values(materializationDiagnostics)) {
    if (materialization?.usableForRouter) coverageAfterSet.add(providerIdFromMaterializationAdr0477(materialization.providerName));
  }
  if (selectedProviderForDiagnostics !== 'NONE') coverageAfterSet.add(selectedProviderForDiagnostics);
  const coverageAfter = coverageAfterSet.size;
  const cacheFallbackReason = selectedProviderForDiagnostics === 'CACHE'
    ? `CACHE selected after rejectedProviders=${rejectedProviders.join(',') || 'NONE'}; selectedReason=${selectedReason ?? 'NONE'}`
    : null;
  const staleButSelectedReason = selectedSemanticNetBuy?.status === 'STALE' || selectedSemanticNetBuy?.status === 'CACHE_STALE_HIT'
    ? `stale selected for SHADOW_ONLY diagnostic only; provider=${selectedProviderForDiagnostics}; status=${selectedSemanticNetBuy.status}; liveExecutionAllowed=false`
    : null;
  diagnostics.push(`fallbackChain=${fallbackChain.join('>')}; selectedProvider=${selectedProviderForDiagnostics}; rejectedProviders=${rejectedProviders.join(',') || 'NONE'}; cacheFallbackReason=${cacheFallbackReason ?? 'NONE'}; staleButSelectedReason=${staleButSelectedReason ?? 'NONE'}; coverageBefore=${statusCoverage.available}; coverageAfter=${coverageAfter}; coverageBasis=routerUsableSampleCount plus selected SHADOW fallback.`);
  diagnostics.push(`multiSourceCandidates=${multiSourceMaterialization.candidates.map((candidate) => `${candidate.provider}:${candidate.materializedCount}:${candidate.blockedReason}:priority=${candidate.selectedPriority}`).join('|') || 'NONE'}; noMaterializedCandidateReason=${multiSourceMaterialization.noMaterializedCandidateReason ?? 'NONE'}`);
  for (const materialization of Object.values(materializationDiagnostics)) {
    diagnostics.push(formatInvestorSampleDiagnosticsAdr0502(materialization));
  }

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
    coverage: {
      ...statusCoverage,
      available: coverageAfter,
    },
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
    materializationDiagnostics,
    rejectedProviders,
    rejectedReasonByProvider,
    fallbackChain,
    cacheFallbackReason,
    staleButSelectedReason,
    coverageBefore: statusCoverage.available,
    coverageAfter,
    noMaterializedCandidateReason: multiSourceMaterialization.noMaterializedCandidateReason,
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
    `- fallbackChain: ${result.fallbackChain?.join(' > ') || 'NONE'}`,
    `- rejectedProviders: ${result.rejectedProviders?.join(',') || 'NONE'}`,
    `- rejectedReasonByProvider: ${Object.entries(result.rejectedReasonByProvider ?? {}).map(([provider, reason]) => `${provider}=${reason}`).join(' | ') || 'NONE'}`,
    `- noMaterializedCandidateReason: ${result.noMaterializedCandidateReason ?? 'NONE'}`,
    `- cacheFallbackReason: ${result.cacheFallbackReason ?? 'NONE'}`,
    `- staleButSelectedReason: ${result.staleButSelectedReason ?? 'NONE'}`,
    `- coverageBasis: routerUsableSampleCount plus selected SHADOW fallback; before=${result.coverageBefore ?? result.coverage.available}, after=${result.coverageAfter ?? result.coverage.available}`,
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
