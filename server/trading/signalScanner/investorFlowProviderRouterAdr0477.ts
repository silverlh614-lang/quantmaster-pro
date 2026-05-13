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
import { buildSanitizedInvestorFlowSemanticRow, normalizeNumberLikeInvestorFlowValue, unwrapInvestorFlowRows, type SanitizedInvestorFlowSemanticRow } from '../../supply/investorFlowSemanticAvailability.js';


export type InvestorFlowProviderId =
  | 'KIS'
  | 'KIS_API'
  | 'KRX'
  | 'KRX_INVESTOR_FLOW'
  | 'KRX_SYMBOL_INVESTOR_FLOW'
  | 'KRX_MARKET_INVESTOR_FLOW'
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
  | 'PROVIDER_EMPTY_RESPONSE'
  | 'QUARANTINED'
  | 'PARSER_KEY_MISMATCH'
  | 'PARSER_FIELD_MISMATCH'
  | 'MARKET_CLOSED_NO_PREVIOUS_SAMPLE'
  | 'DISABLED'
  | 'DISABLED_BY_KIS_FIRST_MODE'
  | 'DISABLED_BY_KIS_ONLY_MODE'
  | 'VERIFIED_ADAPTER_ONLY'
  | 'SEMANTIC_CARRY_FAILED'
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
  requestSymbol?: string | null;
  candidateSymbol?: string | null;
  quoteSymbol?: string | null;
  providerSymbol?: string | null;
  normalizedSymbol?: string | null;
  providerScope?: 'SYMBOL_LEVEL' | 'MARKET_LEVEL' | 'SECTOR_LEVEL' | 'UNKNOWN';
  routePurpose?: string;
  materialized?: boolean;
  usableForRouter?: boolean;
  usableForGate?: false;
  usableForLive?: false;
  usableForShadow?: true;
  scoreUsage?: 'SHADOW_ONLY';
  inferredSymbolMatched?: boolean;
  selectedProvider: InvestorFlowProviderId;
  providerTried: InvestorFlowProviderId[];
  providerReasons: Record<string, string>;
  providerStatuses: Record<string, InvestorFlowProviderStatus>;
  semanticNetBuy: SemanticNetBuySample | null;
  semanticRow?: SanitizedInvestorFlowSemanticRow | null;
  actualInvestorRow?: Record<string, unknown> | null;
  normalizedInvestorRow?: Record<string, unknown> | null;
  semanticInvestorRow?: SanitizedInvestorFlowSemanticRow | Record<string, unknown> | null;
  supplySemanticRow?: SanitizedInvestorFlowSemanticRow | Record<string, unknown> | null;
  actualRowAvailable?: boolean;
  normalizedRowAvailable?: boolean;
  semanticRowAvailable?: boolean;
  rowCarryPath?: 'ADAPTER_TO_ROUTER' | 'NONE';
  sanitizedInvestorFlowRows?: Array<Record<string, unknown>>;
  actualInvestorFlowRows?: Array<Record<string, unknown>>;
  actualInvestorFlowRowCount?: number;
  actualInvestorFlowRowSourcePath?: string | null;
  actualInvestorFlowFieldKeys?: string[];
  actualInvestorFlowNumericKeys?: string[];
  actualInvestorFlowNumericStringKeys?: string[];
  actualInvestorFlowCarried?: boolean;
  selectedCandidate?: InvestorFlowMaterializedCandidateAdr0503 | null;
  selectedActualRowPath?: string | null;
  selectedActualRowFieldKeys?: string[];
  selectedActualNumericFieldKeys?: string[];
  selectedActualNumericStringFieldKeys?: string[];
  selectedActualPlaceholderFieldKeys?: string[];
  kisRawRowAvailableAtAdapter?: boolean;
  kisNormalizedRowAvailableAtRouter?: boolean;
  kisSelectedCandidateCarriesSemanticRow?: boolean;
  semanticRowBreakPoint?: 'ADAPTER_DID_NOT_RETURN_RAW_ROW' | 'ROUTER_DROPPED_RAW_ROW' | 'SELECTED_CANDIDATE_METADATA_ONLY' | 'FORENSIC_INPUT_DROPPED_SEMANTIC_ROW' | 'FIELD_ALIAS_NOT_MAPPED' | 'ONLY_WRAPPER_METADATA' | 'NESTED_ROW_UNWRAPPED_BUT_ALIAS_NOT_MAPPED' | 'NUMERIC_FIELDS_FOUND_BUT_NOT_RECOGNIZED' | 'ROW_ARRAY_FOUND_BUT_INVESTOR_TYPE_NOT_MAPPED' | 'FIELD_ALIAS_MAPPED' | 'NO_ROW_FOUND' | 'ADAPTER_DID_NOT_ATTACH_ACTUAL_ROW' | 'ROUTER_SELECTED_CANDIDATE_DROPPED_ACTUAL_ROW' | 'FORENSIC_COLLECTOR_DROPPED_ACTUAL_ROW' | 'ACTUAL_ROW_CARRIED_BUT_EMPTY' | 'ACTUAL_ROW_CARRIED_WITH_FIELDS' | 'ACTUAL_ROW_CARRIED_ALIAS_NOT_MAPPED' | 'UNKNOWN';
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
  routerUsableCoverage?: {
    available: number;
    total: number;
  };
  diagnosticUsableCoverage?: {
    available: number;
    total: number;
  };
  selectedDiagnosticProvider?: InvestorFlowProviderId | null;
  selectedDiagnosticReason?: string | null;
  selectedForLive?: false;
  selectedForShadow?: boolean;
  kisFirstMode?: boolean;
  dryRunLane?: 'LEGACY_DIAGNOSTIC';
  usedForCurrentGate?: false;
  usedForLiveDecision?: false;
  fallbackProvider?: InvestorFlowProviderId | null;
  fallbackStatus?: InvestorFlowProviderStatus | null;
  fallbackDiagnosticOnly?: boolean;
  legacyDryRunSummary?: string | null;
  krxSourceRepairDiagnostic?: {
    parserStatus?: string;
    endpointIssueHint?: string;
    selectedKrxFlowMode?: string;
    payloadMode?: string;
    routePurpose?: string;
    selectedBld?: string;
    requiredParamMissing?: string | null;
    shortCodeToIsuCdResolved?: boolean;
    isuCd?: string | null;
    inqTpCd?: string | null;
    inqVal?: string | null;
    detailView?: string | null;
    tradeDate?: string;
    previousTradingDateCandidate?: string;
    selectedVariant?: string | null;
    otpGenerated?: boolean;
    csvDownloaded?: boolean;
    csvRowCount?: number;
    csvHeaderDetected?: boolean;
    csvNoDataReason?: string | null;
    omittedKeys?: readonly string[];
    forbiddenKeysPresent?: readonly string[];
    requiredKeysPresent?: readonly string[];
    requiredKeysMissing?: readonly string[];
    sentPayloadKeys?: readonly string[];
    contentType?: string;
    responseKind?: string;
    consecutiveFailures?: number;
    cooldownActive?: boolean;
    cooldownRemainingMs?: number;
    offHoursSuppressed?: boolean;
    diagnosticOnly?: boolean;
    useForRouter?: boolean;
    useForGate?: boolean;
    useForLive?: boolean;
    useForShadow?: boolean;
    selectedRowCount?: number;
    normalizedRows?: number;
    summary?: string;
  } | null;
  materializationDiagnostics?: Partial<Record<InvestorSampleProviderNameAdr0502, InvestorSampleDiagnosticsAdr0502>>;
  rejectedProviders?: InvestorFlowProviderId[];
  rejectedReasonByProvider?: Record<string, string>;
  fallbackChain?: InvestorFlowProviderId[];
  cacheFallbackReason?: string | null;
  staleButSelectedReason?: string | null;
  coverageBefore?: number;
  coverageAfter?: number;
  diagnosticUsableCount?: number;
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
  krxInvestorDiagnosticAdr0505?: {
    status?: 'DISABLED_BY_KIS_FIRST_MODE';
    provider?: 'KRX';
    providerIssue?: boolean;
    marketSignal?: boolean;
    executionImpact?: 'NONE';
    parserStatus?: string;
    endpointIssueHint?: string;
    endpoint?: string;
    bld?: string;
    tradeDate?: string;
    previousTradingDateCandidate?: string;
    selectedKrxFlowMode?: string;
    payloadMode?: string;
    routePurpose?: string;
    selectedBld?: string;
    requiredParamMissing?: string | null;
    shortCodeToIsuCdResolved?: boolean;
    isuCd?: string | null;
    inqTpCd?: string | null;
    inqVal?: string | null;
    detailView?: string | null;
    endpointVariant?: string;
    dateParam?: string;
    marketCode?: string | null;
    symbolCode?: string | null;
    parameterKeys?: readonly string[];
    attemptedVariants?: readonly string[];
    selectedVariant?: string | null;
    otpGenerated?: boolean;
    otpLength?: number;
    csvDownloaded?: boolean;
    csvRowCount?: number;
    csvColumnKeys?: readonly string[];
    csvFailureReason?: string | null;
    csvHeaderDetected?: boolean;
    csvNoDataReason?: string | null;
    omittedKeys?: readonly string[];
    forbiddenKeysPresent?: readonly string[];
    requiredKeysPresent?: readonly string[];
    requiredKeysMissing?: readonly string[];
    sentPayloadKeys?: readonly string[];
    contentType?: string;
    httpStatus?: number | null;
    responseKind?: string;
    consecutiveFailures?: number;
    cooldownActive?: boolean;
    cooldownRemainingMs?: number;
    offHoursSuppressed?: boolean;
    diagnosticOnly?: boolean;
    useForRouter?: boolean;
    useForGate?: boolean;
    useForLive?: boolean;
    useForShadow?: boolean;
    rawTopLevelKeys?: readonly string[];
    detectedCandidatePaths?: readonly string[];
    selectedRowPath?: string | null;
    selectedRowCount?: number;
    firstRowKeys?: readonly string[];
    normalizedRows?: number;
    fieldMappings?: Record<string, string | null>;
    summary?: string;
  } | null;
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
    const normalized = normalizeNumberLikeInvestorFlowValue(value);
    if (normalized !== null) return normalized;
  }
  return null;
}


const INVESTOR_FLOW_ROW_KEEP_KEY_PATTERN_ADR0477 = /frgn|orgn|indv|foreign|institution|individual|investor|type|net|buy|sell|ntby|shnu|seln|amount|volume|qty/i;
const PRIVATE_OR_SECRET_FIELD_PATTERN_ADR0477 = /token|secret|password|authorization|auth|appkey|appsecret|account|acct|cano|acnt/i;

function investorFlowValueKindAdr0477(value: unknown): 'number' | 'numericString' | 'placeholder' | 'other' {
  if (typeof value === 'number') return Number.isFinite(value) ? 'number' : 'placeholder';
  if (value == null) return 'placeholder';
  if (typeof value !== 'string') return 'other';
  const trimmed = value.trim();
  if (!trimmed || trimmed === '-' || trimmed.toUpperCase() === 'N/A') return 'placeholder';
  return normalizeNumberLikeInvestorFlowValue(trimmed) !== null ? 'numericString' : 'other';
}

function sanitizeActualInvestorFlowRowsAdr0477(rows: readonly Record<string, unknown>[]): Array<Record<string, unknown>> {
  return rows.slice(0, 8).map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (PRIVATE_OR_SECRET_FIELD_PATTERN_ADR0477.test(key)) continue;
      if (value != null && typeof value === 'object') continue;
      if (!INVESTOR_FLOW_ROW_KEEP_KEY_PATTERN_ADR0477.test(key) && investorFlowValueKindAdr0477(value) !== 'number' && investorFlowValueKindAdr0477(value) !== 'numericString') continue;
      out[key] = value;
    }
    return out;
  }).filter((row) => Object.keys(row).length > 0);
}

function selectedActualRowDiagnosticsAdr0477(input: unknown): {
  rows: Array<Record<string, unknown>>;
  selectedPath: string | null;
  fieldKeys: string[];
  numericFieldKeys: string[];
  numericStringFieldKeys: string[];
  placeholderFieldKeys: string[];
  wrapperOnly: boolean;
  breakPoint: InvestorFlowProviderRouteResult['semanticRowBreakPoint'];
} {
  const unwrap = unwrapInvestorFlowRows(input);
  const rows = sanitizeActualInvestorFlowRowsAdr0477(unwrap.rows);
  const fieldKeys: string[] = [];
  const numericFieldKeys: string[] = [];
  const numericStringFieldKeys: string[] = [];
  const placeholderFieldKeys: string[] = [];
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      fieldKeys.push(key);
      const kind = investorFlowValueKindAdr0477(value);
      if (kind === 'number') numericFieldKeys.push(key);
      else if (kind === 'numericString') numericStringFieldKeys.push(key);
      else if (kind === 'placeholder') placeholderFieldKeys.push(key);
    }
  }
  return {
    rows,
    selectedPath: unwrap.selectedPath,
    fieldKeys: Array.from(new Set(fieldKeys)).slice(0, 32),
    numericFieldKeys: Array.from(new Set(numericFieldKeys)).slice(0, 32),
    numericStringFieldKeys: Array.from(new Set(numericStringFieldKeys)).slice(0, 32),
    placeholderFieldKeys: Array.from(new Set(placeholderFieldKeys)).slice(0, 32),
    wrapperOnly: unwrap.reason === 'ONLY_WRAPPER_METADATA' || ((unwrap.wrapperOnlyCount ?? 0) > 0 && rows.length === 0),
    breakPoint: unwrap.reason === 'ONLY_WRAPPER_METADATA' ? 'ONLY_WRAPPER_METADATA' : rows.length === 0 ? 'NO_ROW_FOUND' : undefined,
  };
}

function providerIdFromMaterializationAdr0477(providerName: InvestorSampleProviderNameAdr0502): InvestorFlowProviderId {
  if (providerName === 'NAVER_INVESTOR_TREND') return 'NAVER_INVESTOR_TREND';
  if (providerName === 'SEMANTIC_NETBUY') return 'SEMANTIC_NETBUY';
  if (providerName === 'CACHE') return 'CACHE';
  if (providerName === 'KIS_INVESTOR') return 'KIS_API';
  if (providerName === 'KRX_SYMBOL_INVESTOR_FLOW') return 'KRX_SYMBOL_INVESTOR_FLOW';
  if (providerName === 'KRX_MARKET_INVESTOR_FLOW') return 'KRX_MARKET_INVESTOR_FLOW';
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
    'QUARANTINED',
    'DISABLED',
    'DISABLED_BY_KIS_FIRST_MODE',
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
  const foreignNetBuy = valueFromAliases(raw, ['foreignNetBuy', 'foreignNetAmount', 'foreignNetVolume', 'foreignerNetBuy', 'frgnNetBuy', 'frgnNetAmount', 'frgn_ntby', 'frgn_ntby_qty', 'frgn_ntby_tr_pbmn', 'frgn_ntby_tr_pbmn_amt', 'frgn_ntby_vol', 'investorForeignNetBuy', 'foreign']);
  const institutionNetBuy = valueFromAliases(raw, ['institutionalNetBuy', 'institutionNetBuy', 'instNetBuy', 'orgNetBuy', 'orgnNetBuy', 'orgn_ntby', 'orgn_ntby_qty', 'orgn_ntby_tr_pbmn', 'orgn_ntby_tr_pbmn_amt', 'orgn_ntby_vol', 'investorInstitutionNetBuy', 'institution']);
  const individualNetBuy = valueFromAliases(raw, ['individualNetBuy', 'retailNetBuy', 'prsnNetBuy', 'indvNetBuy', 'indv_ntby', 'indv_ntby_qty', 'indv_ntby_tr_pbmn', 'individual', 'retail', 'prvtNetBuy']);
  const programNetBuy = valueFromAliases(raw, ['programNetBuy']) ?? individualNetBuy;
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

export type InvestorFlowSource = 'NAVER_INVESTOR_TREND' | 'SEMANTIC_NETBUY' | 'CACHE' | 'KRX_INVESTOR_FLOW' | 'KRX_SYMBOL_INVESTOR_FLOW' | 'KRX_MARKET_INVESTOR_FLOW' | 'KIS_API';

const INVESTOR_FLOW_SOURCE_ALIASES: Record<string, InvestorFlowSource> = {
  NAVER: 'NAVER_INVESTOR_TREND',
  NAVER_INVESTOR_TREND: 'NAVER_INVESTOR_TREND',
  SEMANTIC_NETBUY: 'SEMANTIC_NETBUY',
  SEMANTICNETBUY: 'SEMANTIC_NETBUY',
  'SEMANTIC NETBUY': 'SEMANTIC_NETBUY',
  CACHE: 'CACHE',
  KRX: 'KRX_INVESTOR_FLOW',
  KRX_INVESTOR_FLOW: 'KRX_INVESTOR_FLOW',
  KRX_SYMBOL_INVESTOR_FLOW: 'KRX_SYMBOL_INVESTOR_FLOW',
  KRX_MARKET_INVESTOR_FLOW: 'KRX_MARKET_INVESTOR_FLOW',
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
    missing: values.filter((status) => status === 'DATA_UNAVAILABLE' || status === 'NON_TRADING_DAY' || status === 'EMPTY' || status === 'PARSE_ERROR' || status === 'PROVIDER_ERROR' || status === 'PROVIDER_EMPTY_RESPONSE' || status === 'PARSER_KEY_MISMATCH' || status === 'PARSER_FIELD_MISMATCH' || status === 'MARKET_CLOSED_NO_PREVIOUS_SAMPLE' || status === 'DISABLED').length,
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

function findFreshDataSnapshotBySourceIdAdr0477(
  report: FreshDataSupplyReportAdr0487 | null | undefined,
  sourceId: string,
): FreshDataSnapshotAdr0487 | null {
  return report?.snapshots.find((row) => row.domain === 'SUPPLY' && row.sourceId === sourceId) ?? null;
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

function krxDiagnosticStatusAdr0477(status: string | undefined): InvestorFlowProviderStatus {
  if (status === 'DISABLED_BY_KIS_FIRST_MODE') return 'DISABLED_BY_KIS_FIRST_MODE';
  if (status === 'OK') return 'VERIFIED';
  if (status === 'PROVIDER_EMPTY_RESPONSE') return 'PROVIDER_EMPTY_RESPONSE';
  if (status === 'PARSER_KEY_MISMATCH') return 'PARSER_KEY_MISMATCH';
  if (status === 'PARSER_FIELD_MISMATCH') return 'PARSER_FIELD_MISMATCH';
  if (status === 'MARKET_CLOSED_NO_PREVIOUS_SAMPLE') return 'MARKET_CLOSED_NO_PREVIOUS_SAMPLE';
  return 'DATA_UNAVAILABLE';
}

function isKisFirstRebuildModeAdr0477(): boolean {
  return process.env.KIS_FIRST_REBUILD_MODE === 'true';
}

function isKrxQuarantineDiagnosticAdr0477(input: NonNullable<InvestorFlowProviderRouterInput['krxInvestorDiagnosticAdr0505']>): boolean {
  return input.offHoursSuppressed === true
    && ((input.consecutiveFailures ?? 0) >= 2 || input.cooldownActive === true || input.useForRouter === false);
}

function formatKrxRepairDiagnosticAdr0477(input: NonNullable<InvestorFlowProviderRouterInput['krxInvestorDiagnosticAdr0505']>): string {
  const fieldMappings = input.fieldMappings
    ? Object.entries(input.fieldMappings).map(([key, value]) => `${key}:${value ?? 'NONE'}`).join(',')
    : 'NONE';
  return [
    `KRX_INVESTOR_FLOW ${input.parserStatus ?? 'DATA_UNAVAILABLE'}`,
    `endpoint=${input.endpoint ?? 'MDCSTAT02203'}`,
    `bld=${input.bld ?? 'UNKNOWN'}`,
    `tradeDate=${input.tradeDate ?? 'UNKNOWN'}`,
    `previousTradingDateCandidate=${input.previousTradingDateCandidate ?? 'UNKNOWN'}`,
    `selectedKrxFlowMode=${input.selectedKrxFlowMode ?? 'UNKNOWN'}`,
    `payloadMode=${input.payloadMode ?? 'UNKNOWN'}`,
    `routePurpose=${input.routePurpose ?? 'UNKNOWN'}`,
    `selectedBld=${input.selectedBld ?? input.bld ?? 'UNKNOWN'}`,
    `requiredParamMissing=${input.requiredParamMissing ?? 'NONE'}`,
    `shortCodeToIsuCdResolved=${String(input.shortCodeToIsuCdResolved ?? false)}`,
    `isuCd=${input.isuCd ?? 'NONE'}`,
    `inqTpCd=${input.inqTpCd ?? 'NONE'}`,
    `inqVal=${input.inqVal ?? 'NONE'}`,
    `detailView=${input.detailView ?? 'NONE'}`,
    `endpointVariant=${input.endpointVariant ?? 'UNKNOWN'}`,
    `dateParam=${input.dateParam ?? 'UNKNOWN'}`,
    `marketCode=${input.marketCode ?? 'UNKNOWN'}`,
    `symbolCode=${input.symbolCode ?? 'NONE'}`,
    'symbolCodeFormat=6_DIGIT',
    `parameterKeys=${input.parameterKeys?.join(',') || 'UNKNOWN'}`,
    `attemptedVariants=${input.attemptedVariants?.join('|') || 'UNKNOWN'}`,
    `selectedVariant=${input.selectedVariant ?? 'NONE'}`,
    `otpGenerated=${String(input.otpGenerated ?? false)}`,
    `otpLength=${input.otpLength ?? 0}`,
    `csvDownloaded=${String(input.csvDownloaded ?? false)}`,
    `csvRowCount=${input.csvRowCount ?? 0}`,
    `csvColumnKeys=${input.csvColumnKeys?.join(',') || 'NONE'}`,
    `csvFailureReason=${input.csvFailureReason ?? 'NONE'}`,
    `csvHeaderDetected=${String(input.csvHeaderDetected ?? false)}`,
    `csvNoDataReason=${input.csvNoDataReason ?? 'NONE'}`,
    `omittedKeys=${input.omittedKeys?.join(',') || 'NONE'}`,
    `forbiddenKeysPresent=${input.forbiddenKeysPresent?.join(',') || 'NONE'}`,
    `requiredKeysPresent=${input.requiredKeysPresent?.join(',') || 'NONE'}`,
    `requiredKeysMissing=${input.requiredKeysMissing?.join(',') || 'NONE'}`,
    `sentPayloadKeys=${input.sentPayloadKeys?.join(',') || 'NONE'}`,
    `contentType=${input.contentType ?? 'unknown'}`,
    `responseKind=${input.responseKind ?? 'UNKNOWN'}`,
    `httpStatus=${input.httpStatus ?? 'NONE'}`,
    `consecutiveFailures=${input.consecutiveFailures ?? 0}`,
    `cooldownActive=${String(input.cooldownActive ?? false)}`,
    `cooldownRemainingMs=${input.cooldownRemainingMs ?? 0}`,
    `offHoursSuppressed=${String(input.offHoursSuppressed ?? false)}`,
    `diagnosticOnly=${String(input.diagnosticOnly ?? false)}`,
    `useForRouter=${String(input.useForRouter ?? true)}`,
    `useForGate=${String(input.useForGate ?? true)}`,
    `useForLive=${String(input.useForLive ?? false)}`,
    `useForShadow=${String(input.useForShadow ?? true)}`,
    `endpointIssueHint=${input.endpointIssueHint ?? 'UNKNOWN'}`,
    `rawTopLevelKeys=${input.rawTopLevelKeys?.join(',') || 'NONE'}`,
    `responseKeySummary=${input.detectedCandidatePaths?.join(',') || 'NONE'}`,
    `selectedRowPath=${input.selectedRowPath ?? 'NONE'}`,
    `selectedRowCount=${input.selectedRowCount ?? 0}`,
    `normalizedRows=${input.normalizedRows ?? 0}`,
    `firstRowKeys=${input.firstRowKeys?.join(',') || 'NONE'}`,
    `fieldMappings=${fieldMappings}`,
    'providerIssue=true',
    'marketSignal=false',
  ].join('; ');
}

function sampleFromCacheLookupAdr0491(
  lookup: SupplySnapshotCacheLookupAdr0491 | null | undefined,
  code: string,
  collectedAt: string,
): SemanticNetBuySample | null {
  const status = lookup ? cacheLookupStatusAdr0477(lookup.status) : 'CACHE_EMPTY';
  if (!lookup || (status !== 'CACHE_HIT' && status !== 'CACHE_STALE_HIT')) return null;
  const latest = lookup.snapshot?.latestInvestorFlowSample;
  const snapshotRaw = latest ? {
    code,
    sourceDate: latest.dataDate,
    foreignNetBuy: latest.foreignNetBuy,
    institutionNetBuy: latest.institutionNetBuy,
    individualNetBuy: latest.retailNetBuy,
    status: status === 'CACHE_STALE_HIT' ? 'STALE' : 'CACHE_HIT',
  } : null;
  const cacheRaw = lookup.cacheRaw ?? snapshotRaw;
  if (!cacheRaw) return null;
  const sample = normalizeSemanticNetBuySampleAdr0477(cacheRaw, 'CACHE', {
    code,
    collectedAt,
    fallbackStatus: status === 'CACHE_STALE_HIT' ? 'CACHE_STALE_HIT' : 'CACHE_HIT',
  });
  const hasRows = finiteNumber(sample.foreignNetBuy) || finiteNumber(sample.institutionNetBuy) || finiteNumber(sample.programNetBuy);
  return hasRows ? sample : null;
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
  | 'KRX_SYMBOL_INVESTOR_FLOW'
  | 'KRX_MARKET_INVESTOR_FLOW'
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
  actualInvestorFlowRows?: Array<Record<string, unknown>>;
  actualInvestorFlowRowCount?: number;
  actualInvestorFlowRowSourcePath?: string | null;
  actualInvestorFlowFieldKeys?: string[];
  actualInvestorFlowNumericKeys?: string[];
  actualInvestorFlowNumericStringKeys?: string[];
  actualInvestorFlowCarried?: boolean;
  actualInvestorRow?: Record<string, unknown> | null;
  normalizedInvestorRow?: Record<string, unknown> | null;
  semanticInvestorRow?: SanitizedInvestorFlowSemanticRow | Record<string, unknown> | null;
  supplySemanticRow?: SanitizedInvestorFlowSemanticRow | Record<string, unknown> | null;
  actualRowAvailable?: boolean;
  normalizedRowAvailable?: boolean;
  semanticRowAvailable?: boolean;
  rowCarryPath?: 'ADAPTER_TO_ROUTER' | 'NONE';
  supplyProviderStatus?: InvestorFlowProviderStatus;
}

type ActualInvestorFlowCarryAdr0477 = Pick<InvestorFlowMaterializedCandidateAdr0503,
  | 'actualInvestorFlowRows'
  | 'actualInvestorFlowRowCount'
  | 'actualInvestorFlowRowSourcePath'
  | 'actualInvestorFlowFieldKeys'
  | 'actualInvestorFlowNumericKeys'
  | 'actualInvestorFlowNumericStringKeys'
  | 'actualInvestorFlowCarried'
  | 'actualInvestorRow'
  | 'normalizedInvestorRow'
  | 'semanticInvestorRow'
  | 'supplySemanticRow'
  | 'actualRowAvailable'
  | 'normalizedRowAvailable'
  | 'semanticRowAvailable'
  | 'rowCarryPath'
>;

type ActualInvestorFlowDropReasonAdr0477 =
  | 'ADAPTER_ROW_NOT_PRESENT'
  | 'NORMALIZER_DROPPED_ACTUAL_ROW'
  | 'MATERIALIZED_CANDIDATE_DROPPED_ACTUAL_ROW'
  | 'SELECTED_CANDIDATE_DROPPED_ACTUAL_ROW'
  | 'SELECTED_CANDIDATE_CARRIES_ACTUAL_ROW'
  | 'UNKNOWN';


function normalizedInvestorRowFromSemanticAdr0477(row: SanitizedInvestorFlowSemanticRow | null | undefined): Record<string, unknown> | null {
  if (!row) return null;
  const normalized: Record<string, unknown> = {
    symbol: row.symbol,
    provider: row.provider,
    providerScope: row.providerScope,
  };
  if (row.foreignNetBuy !== null) normalized.foreignNetBuy = row.foreignNetBuy;
  if (row.institutionalNetBuy !== null) normalized.institutionNetBuy = row.institutionalNetBuy;
  if (row.individualNetBuy !== null) normalized.individualNetBuy = row.individualNetBuy;
  if (row.netBuyAmount !== null) normalized.netBuyAmount = row.netBuyAmount;
  if (row.netBuyVolume !== null) normalized.netBuyVolume = row.netBuyVolume;
  return normalized;
}

function supplyRowKeysAdr0477(row: unknown): string[] {
  return row && typeof row === 'object' && !Array.isArray(row) ? Object.keys(row as Record<string, unknown>) : [];
}

function supplyNumericKeysAdr0477(row: unknown): string[] {
  return row && typeof row === 'object' && !Array.isArray(row)
    ? Object.entries(row as Record<string, unknown>)
      .filter(([, value]) => normalizeNumberLikeInvestorFlowValue(value) !== null)
      .map(([key]) => key)
    : [];
}

interface InvestorFlowDiagnosticUsableCandidateAdr0504 {
  provider: InvestorFlowProviderId;
  status: InvestorFlowProviderStatus;
  reason: string;
  source: 'FRESH_DATA_AGGREGATE' | 'CACHE_LOOKUP' | 'MATERIALIZED_SHADOW';
}

export function collectInvestorFlowMaterializedCandidates(
  materializationDiagnostics: Partial<Record<InvestorSampleProviderNameAdr0502, InvestorSampleDiagnosticsAdr0502>>,
  samplesByProvider: Partial<Record<InvestorFlowProviderId, SemanticNetBuySample>>,
  actualRowCarryByProvider: Partial<Record<InvestorFlowProviderId, ActualInvestorFlowCarryAdr0477>> = {},
): InvestorFlowMaterializedCandidateAdr0503[] {
  const priority: Record<string, number> = {
    KRX_SYMBOL_INVESTOR_FLOW: 1,
    KRX_INVESTOR_FLOW: 2,
    KIS_API: 3,
    KRX_MARKET_INVESTOR_FLOW: 4,
    FSS_PASSIVE_ACTIVE: 5,
    NAVER_INVESTOR_TREND: 6,
    CACHE: 7,
    SEMANTIC_NETBUY: 8,
  };
  const sourceKind: Record<string, InvestorFlowMaterializedSourceKindAdr0503> = {
    KIS_API: 'KIS_SYMBOL_INVESTOR_FLOW',
    KRX_SYMBOL_INVESTOR_FLOW: 'KRX_SYMBOL_INVESTOR_FLOW',
    KRX_MARKET_INVESTOR_FLOW: 'KRX_MARKET_INVESTOR_FLOW',
    KRX_INVESTOR_FLOW: 'KRX_PREVIOUS_TRADING_DATE',
    NAVER_INVESTOR_TREND: 'NAVER_PREVIOUS_TRADING_DATE',
    FSS_PASSIVE_ACTIVE: 'FSS_STALE_DIAGNOSTIC',
    CACHE: 'CACHE_SANITIZED_SNAPSHOT',
    SEMANTIC_NETBUY: 'SEMANTIC_DERIVED',
  };
  return Object.values(materializationDiagnostics).map((diag) => {
    const provider = providerIdFromMaterializationAdr0477(diag.providerName);
    const sample = samplesByProvider[provider];
    const actualCarry = actualRowCarryByProvider[provider];
    const freshness: InvestorFlowMaterializedCandidateAdr0503['freshness'] =
      sample?.status === 'STALE' || sample?.status === 'CACHE_STALE_HIT' ? 'STALE'
        : sample?.status === 'VERIFIED' || sample?.status === 'PARTIAL' || sample?.status === 'CACHE_HIT' ? 'FRESH'
          : diag.staleReason ? 'STALE'
            : diag.sampleMaterialized ? 'UNKNOWN' : 'MISSING';
    const candidateUsableForRouter = provider === 'SEMANTIC_NETBUY' ? false : diag.usableForRouter;
    return {
      provider,
      sourceKind: sourceKind[provider] ?? 'SEMANTIC_DERIVED',
      sourceDate: sample?.sourceDate ?? diag.dateCoverage,
      rawCount: diag.rawCount,
      normalizedCount: diag.normalizedCount,
      materializedCount: diag.materializedCount,
      sampleMaterialized: diag.sampleMaterialized,
      usableForRouter: candidateUsableForRouter,
      usableForShadow: diag.sampleMaterialized,
      confidence: sample?.confidence ?? (diag.confidenceLevel === 'VERIFIED' ? 'HIGH' : diag.confidenceLevel === 'PARTIAL' ? 'MEDIUM' : diag.confidenceLevel === 'LOW' || diag.confidenceLevel === 'DEGRADED' ? 'LOW' : 'NONE'),
      freshness,
      blockedReason: diag.blockedReason,
      placeholderDetected: diag.placeholderDetected,
      inputSourceKind: diag.inputSourceKind,
      selectedPriority: priority[provider] ?? 99,
      selectionReason: `${provider} materialized=${diag.sampleMaterialized} usableForRouter=${candidateUsableForRouter} rawCount=${diag.rawCount} normalizedCount=${diag.normalizedCount} materializedCount=${diag.materializedCount} blockedReason=${provider === 'SEMANTIC_NETBUY' && diag.sampleMaterialized ? 'NO_REAL_INPUT_SOURCE' : diag.blockedReason}`,
      ...(actualCarry ? {
        actualInvestorFlowRows: actualCarry.actualInvestorFlowRows,
        actualInvestorFlowRowCount: actualCarry.actualInvestorFlowRowCount,
        actualInvestorFlowRowSourcePath: actualCarry.actualInvestorFlowRowSourcePath,
        actualInvestorFlowFieldKeys: actualCarry.actualInvestorFlowFieldKeys,
        actualInvestorFlowNumericKeys: actualCarry.actualInvestorFlowNumericKeys,
        actualInvestorFlowNumericStringKeys: actualCarry.actualInvestorFlowNumericStringKeys,
        actualInvestorFlowCarried: actualCarry.actualInvestorFlowCarried,
        actualInvestorRow: actualCarry.actualInvestorRow,
        normalizedInvestorRow: actualCarry.normalizedInvestorRow,
        semanticInvestorRow: actualCarry.semanticInvestorRow,
        supplySemanticRow: actualCarry.supplySemanticRow,
        actualRowAvailable: actualCarry.actualRowAvailable,
        normalizedRowAvailable: actualCarry.normalizedRowAvailable,
        semanticRowAvailable: actualCarry.semanticRowAvailable,
        rowCarryPath: actualCarry.rowCarryPath,
      } : {}),
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
  actualRowCarryByProvider: Partial<Record<InvestorFlowProviderId, ActualInvestorFlowCarryAdr0477>> = {},
): {
  candidates: InvestorFlowMaterializedCandidateAdr0503[];
  rankedCandidates: InvestorFlowMaterializedCandidateAdr0503[];
  selectedCandidate: InvestorFlowMaterializedCandidateAdr0503 | null;
  noMaterializedCandidateReason: string | null;
} {
  const candidates = collectInvestorFlowMaterializedCandidates(materializationDiagnostics, samplesByProvider, actualRowCarryByProvider);
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
  const kisFirstMode = isKisFirstRebuildModeAdr0477();
  const providerTried: InvestorFlowProviderId[] = ['KRX_SYMBOL_INVESTOR_FLOW', 'KRX_MARKET_INVESTOR_FLOW', 'KIS_API', 'FSS_PASSIVE_ACTIVE', 'NAVER_INVESTOR_TREND', 'CACHE', 'SEMANTIC_NETBUY'];
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
  const actualRowCarryByProvider: Partial<Record<InvestorFlowProviderId, ActualInvestorFlowCarryAdr0477>> = {};
  const semanticRowsByProvider: Partial<Record<InvestorFlowProviderId, SanitizedInvestorFlowSemanticRow>> = {};
  let kisRawRowAvailableAtAdapter = false;
  let kisNormalizedRowAvailableAtRouter = false;
  let selectedActualRowPath: string | null = null;
  let sanitizedInvestorFlowRows: Array<Record<string, unknown>> = [];
  let selectedActualRowFieldKeys: string[] = [];
  let selectedActualNumericFieldKeys: string[] = [];
  let selectedActualNumericStringFieldKeys: string[] = [];
  let selectedActualPlaceholderFieldKeys: string[] = [];
  let selectedActualWrapperOnly = false;
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
    providerReasons.NAVER_INVESTOR_TREND = 'FreshData registry bridge READY_FOR_SHADOW normalized NAVER_INVESTOR_TREND sample; role=SECONDARY sourceOfTruth=KRX when KRX is available.';
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
    providerReasons.SEMANTIC_NETBUY = 'FreshData registry bridge READY_FOR_SHADOW normalized SEMANTIC_NETBUY sample; role=DERIVED usableForShadow=true usableForLive=false and not selectable as source-of-truth.';
    diagnostics.push(providerReasons.SEMANTIC_NETBUY);
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
      selectShadow('NAVER_INVESTOR_TREND', naverSample, 'ADR-0481 NAVER investor trend collector selected for SHADOW_ONLY as SECONDARY/DISPLAY_DERIVED fallback; KRX remains sourceOfTruth when available.');
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
    routeStatus = sample.status;
    diagnostics.push('ADR-0482 semantic net-buy fresh sample retained for SHADOW_ONLY DERIVED diagnostics; selectedProvider remains real-source-only.');
  }

  if (!semanticNetBuy && pendingNaverStale) {
    samplesByProvider.NAVER_INVESTOR_TREND = pendingNaverStale;
    selectShadow('NAVER_INVESTOR_TREND', pendingNaverStale, 'ADR-0481 NAVER previousTradingDate/off-hours sample selected as STALE SHADOW_ONLY diagnostic.');
  }

  if (!semanticNetBuy && pendingSemanticDiagnostic) {
    const sample = sampleFromSemanticAdr0482(pendingSemanticDiagnostic);
    samplesByProvider.SEMANTIC_NETBUY = sample;
    routeStatus = sample.status;
    diagnostics.push('ADR-0482 semantic net-buy diagnostic sample retained for OBSERVE/SHADOW_ONLY DERIVED diagnostics; selectedProvider remains real-source-only.');
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
      const staleCacheBlockedByKisFirst = kisFirstMode && (cacheSample.status === 'STALE' || cacheSample.status === 'CACHE_STALE_HIT');
      const naverNotMaterialized = naverFreshDataSnapshot && !freshDataSnapshotMaterializedAdr0477(naverFreshDataSnapshot)
        ? ` because NAVER readinessKind=${naverFreshDataSnapshot.readinessKind ?? 'REGISTRY_READY'} usableForRouter=${String(freshDataSnapshotUsableForRouterAdr0477(naverFreshDataSnapshot))}`
        : '';
      if (staleCacheBlockedByKisFirst) {
        diagnostics.push(`KIS_FIRST_REBUILD_MODE=true; CACHE_STALE_HIT is fallbackDiagnosticOnly and cannot be selectedProvider. fallbackProvider=CACHE; fallbackStatus=${cacheSample.status}; marketSignal=false.`);
      } else {
        selectShadow('CACHE', cacheSample, cacheLookup ? `ADR-0491 sanitized snapshot cache selected: ${cacheLookup.status}${naverNotMaterialized}.` : `CACHE fallback used${naverNotMaterialized}; fallback only, not primary truth.`);
      }
    }
  } else if (!providerStatuses.CACHE) {
    providerStatuses.CACHE = input.cacheRaw ? 'PARTIAL' : 'CACHE_EMPTY';
  }

  const krxDisabledDiagnostic = input.krxInvestorDiagnosticAdr0505?.parserStatus === 'DISABLED_BY_KIS_FIRST_MODE';
  const krxRaw = krxDisabledDiagnostic ? null : input.krxInvestorRaw ?? input.previousTradingDayKrxRaw ?? null;
  if (krxRaw) {
    const krxProvider: InvestorFlowProviderId = input.krxInvestorDiagnosticAdr0505?.routePurpose === 'SYMBOL_LEVEL'
      ? 'KRX_SYMBOL_INVESTOR_FLOW'
      : input.krxInvestorDiagnosticAdr0505?.routePurpose === 'MARKET_LEVEL'
        ? 'KRX_MARKET_INVESTOR_FLOW'
        : 'KRX_INVESTOR_FLOW';
    const krxMaterializationProvider: InvestorSampleProviderNameAdr0502 = krxProvider === 'KRX_MARKET_INVESTOR_FLOW'
      ? 'KRX_MARKET_INVESTOR_FLOW'
      : krxProvider === 'KRX_SYMBOL_INVESTOR_FLOW'
        ? 'KRX_SYMBOL_INVESTOR_FLOW'
        : 'KRX_INVESTOR_FLOW';
    const krxSample = normalizeSemanticNetBuySampleAdr0477(krxRaw, krxProvider, {
      code: input.code,
      collectedAt,
      sourceAgeTradingDays: input.sourceAgeTradingDays ?? (input.nonTradingDay === true ? 1 : 0),
      fallbackStatus: input.nonTradingDay === true ? 'STALE' : undefined,
    });
    materializationDiagnostics[krxMaterializationProvider] = materializationFromSemanticSampleAdr0477(krxMaterializationProvider, krxSample, 'RAW_PROVIDER');
    if (materializationDiagnostics[krxMaterializationProvider]?.sampleMaterialized) samplesByProvider[krxProvider] = krxSample;
    providerStatuses[krxProvider] = krxSample.status;
    providerStatuses.KRX_INVESTOR_FLOW = krxSample.status;
    providerStatuses.KRX = krxSample.status;
    providerReasons[krxProvider] = input.previousTradingDayKrxRaw
      ? `${krxProvider} previousTradingDate materialized investor-flow row selected as SHADOW_ONLY diagnostic candidate.`
      : `${krxProvider} materialized investor-flow row selected as SHADOW_ONLY diagnostic candidate.`;
    providerReasons.KRX_INVESTOR_FLOW = providerReasons[krxProvider];
  } else if (input.krxInvestorDiagnosticAdr0505) {
    const krxQuarantined = kisFirstMode && isKrxQuarantineDiagnosticAdr0477(input.krxInvestorDiagnosticAdr0505);
    const krxStatus = krxQuarantined ? 'QUARANTINED' : krxDiagnosticStatusAdr0477(input.krxInvestorDiagnosticAdr0505.parserStatus);
    const krxReason = formatKrxRepairDiagnosticAdr0477(input.krxInvestorDiagnosticAdr0505);
    const krxDiagnosticProvider: InvestorFlowProviderId = input.krxInvestorDiagnosticAdr0505.routePurpose === 'SYMBOL_LEVEL'
      ? 'KRX_SYMBOL_INVESTOR_FLOW'
      : input.krxInvestorDiagnosticAdr0505.routePurpose === 'MARKET_LEVEL'
        ? 'KRX_MARKET_INVESTOR_FLOW'
        : 'KRX_INVESTOR_FLOW';
    providerStatuses[krxDiagnosticProvider] = krxStatus;
    providerStatuses.KRX_INVESTOR_FLOW = krxStatus;
    providerStatuses.KRX = krxStatus;
    providerReasons[krxDiagnosticProvider] = krxStatus === 'DISABLED_BY_KIS_FIRST_MODE'
      ? `${krxReason}; status=DISABLED_BY_KIS_FIRST_MODE; provider=KRX; providerIssue=false; marketSignal=false; useForRouter=false; useForGate=false; useForLive=false; useForShadow=false; executionImpact=NONE`
      : krxQuarantined
        ? `${krxReason}; QUARANTINED retryAfterMs=${input.krxInvestorDiagnosticAdr0505.cooldownRemainingMs ?? 60 * 60 * 1000}; useForGate=false; useForRouter=false; useForLive=false; useForShadow=true; diagnosticOnly=true; executionImpact=NONE`
        : krxReason;
    providerReasons.KRX_INVESTOR_FLOW = providerReasons[krxDiagnosticProvider];
    providerReasons.KRX = providerReasons[krxDiagnosticProvider];
    diagnostics.push(providerReasons[krxDiagnosticProvider]);
  }

  if (input.kisInvestorRaw) {
    const actualRowDiagnostic = selectedActualRowDiagnosticsAdr0477(input.kisInvestorRaw);
    sanitizedInvestorFlowRows = actualRowDiagnostic.rows;
    selectedActualRowPath = actualRowDiagnostic.selectedPath;
    selectedActualRowFieldKeys = actualRowDiagnostic.fieldKeys;
    selectedActualNumericFieldKeys = actualRowDiagnostic.numericFieldKeys;
    selectedActualNumericStringFieldKeys = actualRowDiagnostic.numericStringFieldKeys;
    selectedActualPlaceholderFieldKeys = actualRowDiagnostic.placeholderFieldKeys;
    selectedActualWrapperOnly = actualRowDiagnostic.wrapperOnly;
    const actualFlowForSemantic = sanitizedInvestorFlowRows.length > 0 ? sanitizedInvestorFlowRows : input.kisInvestorRaw;
    const kisSemanticRow = buildSanitizedInvestorFlowSemanticRow({
      flow: actualFlowForSemantic,
      symbol: input.code,
      provider: 'KIS_API',
      providerScope: 'SYMBOL_LEVEL',
    });
    kisRawRowAvailableAtAdapter = kisSemanticRow.rawFieldKeys.length > 0 || sanitizedInvestorFlowRows.length > 0;
    kisNormalizedRowAvailableAtRouter = kisSemanticRow.normalizedFieldKeys.length > 0 || kisSemanticRow.foreignNetBuy !== null || kisSemanticRow.institutionalNetBuy !== null || kisSemanticRow.individualNetBuy !== null;
    semanticRowsByProvider.KIS_API = kisSemanticRow;
    const kisActualInvestorRow = sanitizedInvestorFlowRows[0] ?? (input.kisInvestorRaw as Record<string, unknown>);
    const kisNormalizedInvestorRow = normalizedInvestorRowFromSemanticAdr0477(kisSemanticRow);
    const kisSample = normalizeSemanticNetBuySampleAdr0477((sanitizedInvestorFlowRows[0] ?? input.kisInvestorRaw) as Record<string, unknown>, 'KIS_API', {
      code: input.code,
      collectedAt,
      sourceAgeTradingDays: input.sourceAgeTradingDays,
    });
    materializationDiagnostics.KIS_INVESTOR = materializationFromSemanticSampleAdr0477('KIS_INVESTOR', kisSample, 'RAW_PROVIDER');
    actualRowCarryByProvider.KIS_API = {
      actualInvestorFlowRows: sanitizedInvestorFlowRows,
      actualInvestorFlowRowCount: sanitizedInvestorFlowRows.length,
      actualInvestorFlowRowSourcePath: selectedActualRowPath,
      actualInvestorFlowFieldKeys: selectedActualRowFieldKeys,
      actualInvestorFlowNumericKeys: Array.from(new Set([...selectedActualNumericFieldKeys, ...selectedActualNumericStringFieldKeys])),
      actualInvestorFlowNumericStringKeys: selectedActualNumericStringFieldKeys,
      actualInvestorFlowCarried: sanitizedInvestorFlowRows.length > 0,
      actualInvestorRow: kisActualInvestorRow,
      normalizedInvestorRow: kisNormalizedInvestorRow,
      semanticInvestorRow: kisSemanticRow,
      supplySemanticRow: kisSemanticRow,
      actualRowAvailable: Boolean(kisActualInvestorRow),
      normalizedRowAvailable: Boolean(kisNormalizedInvestorRow),
      semanticRowAvailable: kisNormalizedRowAvailableAtRouter,
      rowCarryPath: 'ADAPTER_TO_ROUTER',
    };
    diagnostics.push(`[SUPPLY_ROUTER_ROW_CARRIED] symbol=${input.code} actualRowAvailable=${Boolean(kisActualInvestorRow)} semanticRowAvailable=${kisNormalizedRowAvailableAtRouter} fieldKeys=${supplyRowKeysAdr0477(kisActualInvestorRow).slice(0, 16).join(',') || 'NONE'} numericKeys=${supplyNumericKeysAdr0477(kisActualInvestorRow).slice(0, 16).join(',') || 'NONE'} rowCarryPath=ADAPTER_TO_ROUTER`);
    diagnostics.push(`[SUPPLY_SEMANTIC_FIELD_MAPPED] symbol=${input.code} foreignField=${kisSemanticRow.sourceFields.foreign ?? 'none'} institutionField=${kisSemanticRow.sourceFields.institutional ?? 'none'} individualField=${kisSemanticRow.sourceFields.individual ?? 'none'} foreignNetBuy=${kisSemanticRow.foreignNetBuy ?? 'null'} institutionNetBuy=${kisSemanticRow.institutionalNetBuy ?? 'null'} individualNetBuy=${kisSemanticRow.individualNetBuy ?? 'null'}`);
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

  const multiSourceMaterialization = buildInvestorFlowMultiSourceMaterialization(materializationDiagnostics, samplesByProvider, actualRowCarryByProvider);
  const krxAutoDisabled = providerStatuses.KRX_INVESTOR_FLOW === 'DISABLED_BY_KIS_FIRST_MODE' || providerStatuses.KRX === 'DISABLED_BY_KIS_FIRST_MODE';
  const isBlockedAutoKrxCandidate = (provider: InvestorFlowProviderId): boolean => (kisFirstMode || krxAutoDisabled) && (provider === 'KRX_INVESTOR_FLOW' || provider === 'KRX_SYMBOL_INVESTOR_FLOW' || provider === 'KRX_MARKET_INVESTOR_FLOW');
  const selectedMultiSourceCandidate = kisFirstMode || krxAutoDisabled
    ? multiSourceMaterialization.rankedCandidates.find((candidate) => !isBlockedAutoKrxCandidate(candidate.provider) && !(candidate.provider === 'CACHE' && candidate.freshness === 'STALE')) ?? null
    : multiSourceMaterialization.selectedCandidate;
  const adapterCarriesActualRow = sanitizedInvestorFlowRows.length > 0;
  const candidateBeforeSelectionCarriesActualRow = multiSourceMaterialization.candidates.some((candidate) => candidate.provider === 'KIS_API' && (candidate.actualInvestorFlowRowCount ?? 0) > 0);
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

  const diagnosticUsableCandidates: InvestorFlowDiagnosticUsableCandidateAdr0504[] = [];
  const fssFreshDataSnapshot = findFreshDataSnapshotBySourceIdAdr0477(input.freshDataSupplyAdr0487, 'FSS_PASSIVE_ACTIVE');
  if (fssFreshDataSnapshot && (fssFreshDataSnapshot.status === 'STALE' || fssFreshDataSnapshot.sourceState === 'STALE' || fssFreshDataSnapshot.usableForShadow === true)) {
    providerStatuses.FSS_PASSIVE_ACTIVE = providerStatuses.FSS_PASSIVE_ACTIVE ?? 'STALE';
    providerStatuses.FSS = providerStatuses.FSS ?? providerStatuses.FSS_PASSIVE_ACTIVE;
    providerReasons.FSS_PASSIVE_ACTIVE = providerReasons.FSS_PASSIVE_ACTIVE ?? `FreshData aggregate diagnostic provider=FSS status=${fssFreshDataSnapshot.status} confidence=${fssFreshDataSnapshot.confidence}; selectedForShadow=true selectedForLive=false.`;
    diagnosticUsableCandidates.push({
      provider: 'FSS_PASSIVE_ACTIVE',
      status: providerStatuses.FSS_PASSIVE_ACTIVE,
      reason: providerReasons.FSS_PASSIVE_ACTIVE,
      source: 'FRESH_DATA_AGGREGATE',
    });
  }
  const cacheFreshDataSnapshot = findFreshDataSnapshotBySourceIdAdr0477(input.freshDataSupplyAdr0487, 'SUPPLY_SNAPSHOT_CACHE');
  const cacheDiagnosticStatus = providerStatuses.CACHE;
  if ((cacheLookup && (cacheLookup.status === 'CACHE_HIT' || cacheLookup.status === 'CACHE_STALE_HIT' || cacheLookup.status === 'STALE_HIT')) || cacheFreshDataSnapshot?.cacheState === 'FRESH' || cacheFreshDataSnapshot?.cacheState === 'STALE') {
    providerStatuses.CACHE = providerStatuses.CACHE ?? (cacheFreshDataSnapshot?.cacheState === 'STALE' ? 'CACHE_STALE_HIT' : 'CACHE_HIT');
    providerReasons.CACHE = providerReasons.CACHE ?? `FreshData/cache diagnostic fallback status=${providerStatuses.CACHE}; selectedForShadow=true selectedForLive=false.`;
    diagnosticUsableCandidates.push({
      provider: 'CACHE',
      status: providerStatuses.CACHE ?? cacheDiagnosticStatus ?? 'OBSERVING',
      reason: providerReasons.CACHE,
      source: 'CACHE_LOOKUP',
    });
  }
  for (const candidate of multiSourceMaterialization.candidates) {
    if (candidate.provider !== 'SEMANTIC_NETBUY' && !isBlockedAutoKrxCandidate(candidate.provider) && candidate.sampleMaterialized && candidate.usableForShadow && !candidate.placeholderDetected) {
      diagnosticUsableCandidates.push({
        provider: candidate.provider,
        status: samplesByProvider[candidate.provider]?.status ?? (candidate.freshness === 'STALE' ? 'STALE' : 'OBSERVING'),
        reason: candidate.selectionReason,
        source: 'MATERIALIZED_SHADOW',
      });
    }
  }
  const selectedDiagnosticCandidate = selectedProvider === 'NONE'
    ? diagnosticUsableCandidates.find((candidate) => candidate.provider === 'FSS_PASSIVE_ACTIVE')
      ?? diagnosticUsableCandidates.find((candidate) => candidate.provider === 'CACHE' && (!kisFirstMode || candidate.status === 'CACHE_HIT'))
      ?? diagnosticUsableCandidates.find((candidate) => !(kisFirstMode && candidate.provider === 'CACHE' && candidate.status !== 'CACHE_HIT'))
      ?? null
    : null;
  let selectedDiagnosticProvider: InvestorFlowProviderId | null = null;
  let selectedDiagnosticReason: string | null = null;
  if (selectedDiagnosticCandidate) {
    selectedProvider = selectedDiagnosticCandidate.provider;
    selectedDiagnosticProvider = selectedDiagnosticCandidate.provider;
    selectedDiagnosticReason = selectedDiagnosticCandidate.reason;
    selectedReason = selectedDiagnosticCandidate.reason;
    routeStatus = selectedDiagnosticCandidate.status === 'CACHE_HIT' ? 'OBSERVING' : selectedDiagnosticCandidate.status;
    providerStatuses[selectedDiagnosticCandidate.provider] = selectedDiagnosticCandidate.status;
    providerReasons[selectedDiagnosticCandidate.provider] = selectedDiagnosticCandidate.reason;
    const diagnosticSample = samplesByProvider[selectedDiagnosticCandidate.provider];
    if (!semanticNetBuy && diagnosticSample) semanticNetBuy = diagnosticSample;
    diagnostics.push(`diagnosticUsableCandidate selected provider=${selectedDiagnosticCandidate.provider}; source=${selectedDiagnosticCandidate.source}; status=${selectedDiagnosticCandidate.status}; selectedForShadow=true; selectedForLive=false`);
  }

  const staleCacheQuarantinedByKisFirst = kisFirstMode
    && selectedProvider === 'NONE'
    && (providerStatuses.CACHE === 'CACHE_STALE_HIT' || providerStatuses.CACHE === 'STALE');
  if (staleCacheQuarantinedByKisFirst) {
    selectedReason = 'NO_FRESH_SEMANTIC_NETBUY';
    routeStatus = input.krxInvestorDiagnosticAdr0505 && isKrxQuarantineDiagnosticAdr0477(input.krxInvestorDiagnosticAdr0505)
      ? 'DATA_UNAVAILABLE'
      : routeStatus;
    diagnostics.push('selectedProvider=NONE; fallbackProvider=CACHE; fallbackStatus=CACHE_STALE_HIT; fallbackDiagnosticOnly=true; selectedReason=NO_FRESH_SEMANTIC_NETBUY; marketSignal=false');
  }

  const selectedSemanticRow = semanticRowsByProvider[selectedProvider] ?? null;
  const selectedMaterializedCandidate = selectedMultiSourceCandidate?.provider === selectedProvider
    ? selectedMultiSourceCandidate
    : multiSourceMaterialization.candidates.find((candidate) => candidate.provider === selectedProvider) ?? null;
  const selectedCandidateActualRows = selectedMaterializedCandidate?.actualInvestorFlowRows ?? (selectedProvider === 'KIS_API' ? sanitizedInvestorFlowRows : []);
  const selectedCandidateActualRowCount = selectedMaterializedCandidate?.actualInvestorFlowRowCount ?? selectedCandidateActualRows.length;
  const selectedCandidateCarriesActualRow = selectedCandidateActualRowCount > 0;
  const selectedCandidateActualRowFieldKeysTop = selectedMaterializedCandidate?.actualInvestorFlowFieldKeys ?? selectedActualRowFieldKeys;
  const selectedCandidateActualRowDropReason: ActualInvestorFlowDropReasonAdr0477 = selectedCandidateCarriesActualRow
    ? 'SELECTED_CANDIDATE_CARRIES_ACTUAL_ROW'
    : !input.kisInvestorRaw
      ? 'ADAPTER_ROW_NOT_PRESENT'
      : sanitizedInvestorFlowRows.length === 0
        ? 'NORMALIZER_DROPPED_ACTUAL_ROW'
        : !candidateBeforeSelectionCarriesActualRow
          ? 'MATERIALIZED_CANDIDATE_DROPPED_ACTUAL_ROW'
          : selectedProvider === 'KIS_API'
            ? 'SELECTED_CANDIDATE_DROPPED_ACTUAL_ROW'
            : 'UNKNOWN';
  if (selectedMaterializedCandidate) {
    selectedMaterializedCandidate.supplyProviderStatus = routeStatus;
    diagnostics.push(`[SELECTED_CANDIDATE_SUPPLY_ROW_ATTACHED] symbol=${input.code} hasActualInvestorRow=${Boolean(selectedMaterializedCandidate.actualInvestorRow ?? selectedCandidateActualRows[0])} hasSemanticInvestorRow=${Boolean(selectedMaterializedCandidate.semanticInvestorRow ?? selectedSemanticRow)} source=SUPPLY_ROUTER_BY_SYMBOL fieldKeys=${(selectedMaterializedCandidate.actualInvestorFlowFieldKeys ?? selectedCandidateActualRowFieldKeysTop).slice(0, 16).join(',') || 'NONE'} numericKeys=${(selectedMaterializedCandidate.actualInvestorFlowNumericKeys ?? selectedActualNumericFieldKeys).slice(0, 16).join(',') || 'NONE'}`);
  }
  const selectedSemanticNetBuy = semanticNetBuy as SemanticNetBuySample | null;
  const signal = selectedSemanticNetBuy?.signal ?? 'UNKNOWN';
  if (!semanticNetBuy && !selectedDiagnosticProvider && providerStatuses.NAVER === 'NOT_WIRED' && providerStatuses.CACHE === 'CACHE_EMPTY') {
    routeStatus = 'DATA_UNAVAILABLE';
  }
  const sourceAge = input.sourceAgeTradingDays ?? input.cacheAgeTradingDays ?? null;
  const oldest = [input.sourceAgeTradingDays, input.cacheAgeTradingDays, input.fssSourceAgeTradingDays]
    .filter((item): item is number => finiteNumber(item))
    .sort((a, b) => b - a)[0] ?? null;
  const routerCarriesActualRow = selectedCandidateCarriesActualRow || (selectedProvider === 'KIS_API' && sanitizedInvestorFlowRows.length > 0);
  const routerVerifiedGuardStatus: InvestorFlowProviderStatus = routeStatus === 'VERIFIED' && (selectedProvider === 'KIS_API' || providerStatuses.KIS_API === 'VERIFIED') && !routerCarriesActualRow
    ? (adapterCarriesActualRow ? 'VERIFIED_ADAPTER_ONLY' : 'SEMANTIC_CARRY_FAILED')
    : routeStatus;
  const status = signal === 'UNKNOWN' && routerVerifiedGuardStatus === 'VERIFIED' ? 'DEGRADED' : routerVerifiedGuardStatus;
  const inputSources = Array.from(new Set([
    ...multiSourceMaterialization.candidates.filter((candidate) => candidate.sampleMaterialized).map((candidate) => candidate.provider),
    ...(input.naverCollectorResultAdr0481?.semanticNetBuyCandidate ? ['NAVER_INVESTOR_TREND' as const] : []),
    ...(input.semanticNetBuyNormalizationAdr0482?.samples.map((sample) => providerFromSemanticAdr0482(sample.provider)) ?? []),
    ...(cacheLookupSample || input.cacheRaw || input.previousTradingDayCacheRaw ? ['CACHE' as const] : []),
    ...(selectedDiagnosticProvider ? [selectedDiagnosticProvider] : []),
  ]));
  const statusCoverage = coverageFromStatuses(providerStatuses);
  const fallbackChain: InvestorFlowProviderId[] = ['KRX_SYMBOL_INVESTOR_FLOW', 'KRX_MARKET_INVESTOR_FLOW', 'KIS_API', 'FSS_PASSIVE_ACTIVE', 'NAVER_INVESTOR_TREND', 'CACHE', 'SEMANTIC_NETBUY'];
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
  for (const provider of ['KRX_SYMBOL_INVESTOR_FLOW', 'KRX_MARKET_INVESTOR_FLOW', 'KRX_INVESTOR_FLOW', 'KIS_API', 'FSS_PASSIVE_ACTIVE', 'NAVER_INVESTOR_TREND', 'CACHE', 'SEMANTIC_NETBUY'] as const) {
    if (provider === selectedProviderForDiagnostics || rejectedReasonByProvider[provider]) continue;
    if (providerStatuses[provider]) rejectedReasonByProvider[provider] = providerReasons[provider] ?? `status=${providerStatuses[provider]}`;
  }
  const rejectedProviders = Object.keys(rejectedReasonByProvider) as InvestorFlowProviderId[];
  const coverageAfterSet = new Set<InvestorFlowProviderId>();
  for (const materialization of Object.values(materializationDiagnostics)) {
    const provider = materialization ? providerIdFromMaterializationAdr0477(materialization.providerName) : 'UNKNOWN';
    const staleCacheRouterBlocked = kisFirstMode && provider === 'CACHE' && (providerStatuses.CACHE === 'CACHE_STALE_HIT' || providerStatuses.CACHE === 'STALE');
    if (materialization?.usableForRouter && !staleCacheRouterBlocked) coverageAfterSet.add(provider);
  }
  if (selectedProviderForDiagnostics !== 'NONE' && selectedDiagnosticProvider !== selectedProviderForDiagnostics) coverageAfterSet.add(selectedProviderForDiagnostics);
  const coverageAfter = coverageAfterSet.size;
  const routerUsableCoverage = {
    available: coverageAfterSet.size,
    total: statusCoverage.total,
  };
  const diagnosticUsableCoverageSet = new Set<InvestorFlowProviderId>();
  for (const candidate of diagnosticUsableCandidates) diagnosticUsableCoverageSet.add(candidate.provider);
  const diagnosticUsableCount = diagnosticUsableCoverageSet.size;
  const diagnosticUsableCoverage = {
    available: diagnosticUsableCount,
    total: statusCoverage.total,
  };
  const fallbackProvider: InvestorFlowProviderId | null = staleCacheQuarantinedByKisFirst ? 'CACHE' : null;
  const fallbackStatus: InvestorFlowProviderStatus | null = staleCacheQuarantinedByKisFirst ? 'CACHE_STALE_HIT' : null;
  const fallbackDiagnosticOnly = staleCacheQuarantinedByKisFirst;
  const cacheFallbackReason = selectedProviderForDiagnostics === 'CACHE'
    ? `CACHE selected after rejectedProviders=${rejectedProviders.join(',') || 'NONE'}; selectedReason=${selectedReason ?? 'NONE'}`
    : staleCacheQuarantinedByKisFirst
      ? 'CACHE_STALE_HIT retained as fallbackDiagnosticOnly under KIS_FIRST_REBUILD_MODE=true; selectedProvider=NONE'
    : null;
  const staleButSelectedReason = selectedSemanticNetBuy?.status === 'STALE' || selectedSemanticNetBuy?.status === 'CACHE_STALE_HIT'
    ? `stale selected for SHADOW_ONLY diagnostic only; provider=${selectedProviderForDiagnostics}; status=${selectedSemanticNetBuy.status}; liveExecutionAllowed=false`
    : null;
  diagnostics.push(`fallbackChain=${fallbackChain.join('>')}; selectedProvider=${selectedProviderForDiagnostics}; rejectedProviders=${rejectedProviders.join(',') || 'NONE'}; cacheFallbackReason=${cacheFallbackReason ?? 'NONE'}; staleButSelectedReason=${staleButSelectedReason ?? 'NONE'}; coverageBefore=${statusCoverage.available}; coverageAfter=${coverageAfter}; routerUsableCoverage=${routerUsableCoverage.available}/${routerUsableCoverage.total}; diagnosticUsableCoverage=${diagnosticUsableCoverage.available}/${diagnosticUsableCoverage.total}; diagnosticUsableCount=${diagnosticUsableCount}; selectedDiagnosticProvider=${selectedDiagnosticProvider ?? 'NONE'}; coverageBasis=routerUsableSampleCount plus selected SHADOW fallback.`);
  diagnostics.push(`sourceOfTruth=${selectedProvider === 'KRX_INVESTOR_FLOW' || selectedProvider === 'KRX_SYMBOL_INVESTOR_FLOW' || selectedProvider === 'KRX_MARKET_INVESTOR_FLOW' ? 'KRX' : selectedProvider === 'FSS_PASSIVE_ACTIVE' ? 'FSS_OFFICIAL_DIAGNOSTIC' : selectedProvider === 'NAVER_INVESTOR_TREND' ? 'NAVER_SECONDARY' : selectedProvider === 'CACHE' ? 'CACHE_STALE_FALLBACK' : selectedProvider === 'SEMANTIC_NETBUY' ? 'SEMANTIC_DERIVED' : selectedProvider}; NAVER role=SECONDARY; SEMANTIC role=DERIVED; CACHE role=STALE_FALLBACK`);
  const kisSelectedCandidateCarriesSemanticRow = selectedProvider === 'KIS_API' && Boolean(selectedSemanticRow);
  const semanticRowBreakPoint = selectedProvider === 'KIS_API'
    ? !input.kisInvestorRaw
      ? 'ADAPTER_DID_NOT_ATTACH_ACTUAL_ROW'
      : sanitizedInvestorFlowRows.length === 0 && selectedActualWrapperOnly
        ? 'ACTUAL_ROW_CARRIED_BUT_EMPTY'
        : sanitizedInvestorFlowRows.length === 0
          ? 'ADAPTER_DID_NOT_ATTACH_ACTUAL_ROW'
          : !kisRawRowAvailableAtAdapter
            ? 'ADAPTER_DID_NOT_RETURN_RAW_ROW'
            : !selectedSemanticRow
              ? 'ROUTER_SELECTED_CANDIDATE_DROPPED_ACTUAL_ROW'
              : !kisNormalizedRowAvailableAtRouter
                ? 'ACTUAL_ROW_CARRIED_ALIAS_NOT_MAPPED'
                : 'ACTUAL_ROW_CARRIED_WITH_FIELDS'
    : undefined;
  diagnostics.push(`kisRawRowAvailableAtAdapter=${kisRawRowAvailableAtAdapter}; kisNormalizedRowAvailableAtRouter=${kisNormalizedRowAvailableAtRouter}; kisSelectedCandidateCarriesSemanticRow=${kisSelectedCandidateCarriesSemanticRow}; semanticRowBreakPoint=${semanticRowBreakPoint ?? 'UNKNOWN'}; selectedActualRowPath=${selectedActualRowPath ?? 'none'}; selectedActualRowFieldKeys=${selectedActualRowFieldKeys.join(',') || 'none'}; selectedActualNumericStringFieldKeys=${selectedActualNumericStringFieldKeys.join(',') || 'none'}; sanitizedInvestorFlowRows=${sanitizedInvestorFlowRows.length}; rawPayloadPersistenceAllowed=false`);
  diagnostics.push(`adapterCarriesActualRow=${String(adapterCarriesActualRow)}; routerCarriesActualRow=${String(routerCarriesActualRow)}; candidateBeforeSelectionCarriesActualRow=${String(candidateBeforeSelectionCarriesActualRow)}; selectedCandidateCarriesActualRow=${String(selectedCandidateCarriesActualRow)}; selectedCandidateActualRowCount=${selectedCandidateActualRowCount}; selectedCandidateActualRowFieldKeysTop=${selectedCandidateActualRowFieldKeysTop.slice(0, 16).join(',') || 'NONE'}; selectedCandidateActualRowDropReason=${selectedCandidateActualRowDropReason}; executionImpact=NONE; scoreUsage=SHADOW_ONLY`);
  diagnostics.push(`[SUPPLY_ROUTER_VERIFIED_GUARD] symbol=${input.code} adapterHasActualRow=${adapterCarriesActualRow} routerCarriesActualRow=${routerCarriesActualRow} candidateCarriesActualRow=${selectedCandidateCarriesActualRow} forensicCarriesActualRow=deferred routerStatus=${status}`);
  diagnostics.push(`multiSourceCandidates=${multiSourceMaterialization.candidates.map((candidate) => `${candidate.provider}:${candidate.materializedCount}:${candidate.blockedReason}:priority=${candidate.selectedPriority}`).join('|') || 'NONE'}; noMaterializedCandidateReason=${multiSourceMaterialization.noMaterializedCandidateReason ?? 'NONE'}`);
  for (const materialization of Object.values(materializationDiagnostics)) {
    diagnostics.push(formatInvestorSampleDiagnosticsAdr0502(materialization));
  }

  return {
    code: input.code,
    route: 'investor_flow',
    requestSymbol: input.code,
    candidateSymbol: input.code,
    quoteSymbol: input.code,
    providerSymbol: selectedSemanticNetBuy?.code ?? null,
    normalizedSymbol: selectedSemanticNetBuy?.code ?? input.code,
    providerScope: 'SYMBOL_LEVEL',
    routePurpose: 'SYMBOL_LEVEL_INVESTOR_FLOW_SHADOW_AUDIT',
    materialized: Boolean(selectedSemanticNetBuy),
    usableForRouter: routerUsableCoverage.available > 0,
    usableForGate: false,
    usableForLive: false,
    usableForShadow: true,
    scoreUsage: 'SHADOW_ONLY',
    inferredSymbolMatched: !selectedSemanticNetBuy?.code && Boolean(input.code),
    selectedProvider,
    providerTried,
    providerReasons,
    providerStatuses,
    semanticNetBuy: selectedSemanticNetBuy,
    semanticRow: selectedSemanticRow,
    actualInvestorRow: selectedMaterializedCandidate?.actualInvestorRow ?? selectedCandidateActualRows[0] ?? null,
    normalizedInvestorRow: selectedMaterializedCandidate?.normalizedInvestorRow ?? normalizedInvestorRowFromSemanticAdr0477(selectedSemanticRow) ?? null,
    semanticInvestorRow: selectedMaterializedCandidate?.semanticInvestorRow ?? selectedSemanticRow,
    supplySemanticRow: selectedMaterializedCandidate?.supplySemanticRow ?? selectedSemanticRow,
    actualRowAvailable: Boolean(selectedMaterializedCandidate?.actualInvestorRow ?? selectedCandidateActualRows[0]),
    normalizedRowAvailable: Boolean(selectedMaterializedCandidate?.normalizedInvestorRow ?? selectedSemanticRow),
    semanticRowAvailable: Boolean(selectedMaterializedCandidate?.semanticInvestorRow ?? selectedSemanticRow),
    rowCarryPath: selectedProvider === 'KIS_API' ? 'ADAPTER_TO_ROUTER' : 'NONE',
    sanitizedInvestorFlowRows,
    actualInvestorFlowRows: selectedProvider === 'KIS_API' ? selectedCandidateActualRows : sanitizedInvestorFlowRows,
    actualInvestorFlowRowCount: selectedProvider === 'KIS_API' ? selectedCandidateActualRowCount : sanitizedInvestorFlowRows.length,
    actualInvestorFlowRowSourcePath: selectedMaterializedCandidate?.actualInvestorFlowRowSourcePath ?? selectedActualRowPath,
    actualInvestorFlowFieldKeys: selectedMaterializedCandidate?.actualInvestorFlowFieldKeys ?? selectedActualRowFieldKeys,
    actualInvestorFlowNumericKeys: selectedMaterializedCandidate?.actualInvestorFlowNumericKeys ?? Array.from(new Set([...selectedActualNumericFieldKeys, ...selectedActualNumericStringFieldKeys])),
    actualInvestorFlowNumericStringKeys: selectedMaterializedCandidate?.actualInvestorFlowNumericStringKeys ?? selectedActualNumericStringFieldKeys,
    actualInvestorFlowCarried: selectedProvider === 'KIS_API' && selectedCandidateCarriesActualRow,
    selectedCandidate: selectedMaterializedCandidate,
    selectedActualRowPath,
    selectedActualRowFieldKeys,
    selectedActualNumericFieldKeys,
    selectedActualNumericStringFieldKeys,
    selectedActualPlaceholderFieldKeys,
    kisRawRowAvailableAtAdapter,
    kisNormalizedRowAvailableAtRouter,
    kisSelectedCandidateCarriesSemanticRow,
    semanticRowBreakPoint,
    status,
    signal,
    coverage: {
      ...statusCoverage,
      available: routerUsableCoverage.available,
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
    cacheFallbackUsed: selectedProvider === 'CACHE' || selectedSemanticNetBuy?.source === 'CACHE',
    semanticInputStatus: providerStatuses.SEMANTIC_NETBUY ?? 'DATA_UNAVAILABLE',
    naverSampleStatus: providerStatuses.NAVER_INVESTOR_TREND ?? providerStatuses.NAVER ?? 'DATA_UNAVAILABLE',
    naverReadinessKind: naverFreshDataSnapshot?.readinessKind,
    semanticReadinessKind: semanticFreshDataSnapshot?.readinessKind,
    selectedFreshness: selectedDiagnosticProvider
      ? (routeStatus === 'STALE' || routeStatus === 'CACHE_STALE_HIT' ? 'STALE' : routeStatus === 'OBSERVING' || routeStatus === 'CACHE_HIT' ? 'UNKNOWN' : 'MISSING')
      : selectedSemanticNetBuy?.status === 'STALE' || selectedSemanticNetBuy?.status === 'CACHE_STALE_HIT'
      ? 'STALE'
      : selectedSemanticNetBuy?.status === 'VERIFIED' || selectedSemanticNetBuy?.status === 'READY_FOR_SHADOW' || selectedSemanticNetBuy?.status === 'PARTIAL' || selectedSemanticNetBuy?.status === 'CACHE_HIT'
        ? 'FRESH'
        : selectedSemanticNetBuy ? 'UNKNOWN' : 'MISSING',
    selectedConfidence: selectedSemanticNetBuy?.confidence ?? (selectedDiagnosticProvider ? 'LOW' : 'NONE'),
    routerUsableCoverage,
    diagnosticUsableCoverage,
    selectedDiagnosticProvider,
    selectedDiagnosticReason,
    selectedForLive: false,
    selectedForShadow: selectedProvider !== 'NONE',
    kisFirstMode,
    dryRunLane: kisFirstMode ? 'LEGACY_DIAGNOSTIC' : undefined,
    usedForCurrentGate: false,
    usedForLiveDecision: false,
    fallbackProvider,
    fallbackStatus,
    fallbackDiagnosticOnly,
    legacyDryRunSummary: kisFirstMode
      ? 'ADR-0467/0468/0469/0470/0471/0472/0475/0476/0477 emitted; usedForCurrentGate=false; executionImpact=NONE'
      : null,
    krxSourceRepairDiagnostic: input.krxInvestorDiagnosticAdr0505
      ? {
          parserStatus: input.krxInvestorDiagnosticAdr0505.parserStatus,
          endpointIssueHint: input.krxInvestorDiagnosticAdr0505.endpointIssueHint,
          selectedKrxFlowMode: input.krxInvestorDiagnosticAdr0505.selectedKrxFlowMode,
          payloadMode: input.krxInvestorDiagnosticAdr0505.payloadMode,
          routePurpose: input.krxInvestorDiagnosticAdr0505.routePurpose,
          selectedBld: input.krxInvestorDiagnosticAdr0505.selectedBld,
          requiredParamMissing: input.krxInvestorDiagnosticAdr0505.requiredParamMissing,
          shortCodeToIsuCdResolved: input.krxInvestorDiagnosticAdr0505.shortCodeToIsuCdResolved,
          isuCd: input.krxInvestorDiagnosticAdr0505.isuCd,
          inqTpCd: input.krxInvestorDiagnosticAdr0505.inqTpCd,
          inqVal: input.krxInvestorDiagnosticAdr0505.inqVal,
          detailView: input.krxInvestorDiagnosticAdr0505.detailView,
          tradeDate: input.krxInvestorDiagnosticAdr0505.tradeDate,
          previousTradingDateCandidate: input.krxInvestorDiagnosticAdr0505.previousTradingDateCandidate,
          selectedVariant: input.krxInvestorDiagnosticAdr0505.selectedVariant,
          otpGenerated: input.krxInvestorDiagnosticAdr0505.otpGenerated,
          csvDownloaded: input.krxInvestorDiagnosticAdr0505.csvDownloaded,
          csvRowCount: input.krxInvestorDiagnosticAdr0505.csvRowCount,
          csvHeaderDetected: input.krxInvestorDiagnosticAdr0505.csvHeaderDetected,
          csvNoDataReason: input.krxInvestorDiagnosticAdr0505.csvNoDataReason,
          omittedKeys: input.krxInvestorDiagnosticAdr0505.omittedKeys,
          forbiddenKeysPresent: input.krxInvestorDiagnosticAdr0505.forbiddenKeysPresent,
          requiredKeysPresent: input.krxInvestorDiagnosticAdr0505.requiredKeysPresent,
          requiredKeysMissing: input.krxInvestorDiagnosticAdr0505.requiredKeysMissing,
          sentPayloadKeys: input.krxInvestorDiagnosticAdr0505.sentPayloadKeys,
          contentType: input.krxInvestorDiagnosticAdr0505.contentType,
          responseKind: input.krxInvestorDiagnosticAdr0505.responseKind,
          consecutiveFailures: input.krxInvestorDiagnosticAdr0505.consecutiveFailures,
          cooldownActive: input.krxInvestorDiagnosticAdr0505.cooldownActive,
          cooldownRemainingMs: input.krxInvestorDiagnosticAdr0505.cooldownRemainingMs,
          offHoursSuppressed: input.krxInvestorDiagnosticAdr0505.offHoursSuppressed,
          diagnosticOnly: input.krxInvestorDiagnosticAdr0505.diagnosticOnly,
          useForRouter: input.krxInvestorDiagnosticAdr0505.useForRouter,
          useForGate: input.krxInvestorDiagnosticAdr0505.useForGate,
          useForLive: input.krxInvestorDiagnosticAdr0505.useForLive,
          useForShadow: input.krxInvestorDiagnosticAdr0505.useForShadow,
          selectedRowCount: input.krxInvestorDiagnosticAdr0505.selectedRowCount,
          normalizedRows: input.krxInvestorDiagnosticAdr0505.normalizedRows,
          summary: input.krxInvestorDiagnosticAdr0505.summary,
        }
      : null,
    materializationDiagnostics,
    rejectedProviders,
    rejectedReasonByProvider,
    fallbackChain,
    cacheFallbackReason,
    staleButSelectedReason,
    coverageBefore: statusCoverage.available,
    coverageAfter,
    diagnosticUsableCount,
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
    `- routerUsableCoverage: ${result.routerUsableCoverage?.available ?? result.coverage.available}/${result.routerUsableCoverage?.total ?? result.coverage.total}`,
    `- diagnosticUsableCoverage: ${result.diagnosticUsableCoverage?.available ?? result.diagnosticUsableCount ?? 0}/${result.diagnosticUsableCoverage?.total ?? result.coverage.total}`,
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
    `- diagnosticUsableCount: ${result.diagnosticUsableCount ?? 0}`,
    `- selectedDiagnosticProvider: ${result.selectedDiagnosticProvider ?? 'NONE'}`,
    `- selectedDiagnosticReason: ${result.selectedDiagnosticReason ?? 'NONE'}`,
    `- selectedForLive: ${result.selectedForLive ?? false}`,
    `- selectedForShadow: ${result.selectedForShadow ?? result.selectedProvider !== 'NONE'}`,
    `- kisFirstMode: ${result.kisFirstMode ?? false}`,
    `- dryRunLane: ${result.dryRunLane ?? 'NONE'}`,
    `- usedForCurrentGate: ${result.usedForCurrentGate ?? false}`,
    `- usedForLiveDecision: ${result.usedForLiveDecision ?? false}`,
    `- fallbackProvider: ${result.fallbackProvider ?? 'NONE'}`,
    `- fallbackStatus: ${result.fallbackStatus ?? 'NONE'}`,
    `- fallbackDiagnosticOnly: ${result.fallbackDiagnosticOnly ?? false}`,
    `- legacyDryRunSummary: ${result.legacyDryRunSummary ?? 'NONE'}`,
    `- krxSourceRepair: ${result.krxSourceRepairDiagnostic?.summary ?? result.krxSourceRepairDiagnostic?.parserStatus ?? 'NONE'}`,
    `- semanticInputStatus: ${result.semanticInputStatus ?? result.providerStatuses.SEMANTIC_NETBUY ?? 'DATA_UNAVAILABLE'}`,
    `- kisRawRowAvailableAtAdapter: ${result.kisRawRowAvailableAtAdapter ?? false}`,
    `- kisNormalizedRowAvailableAtRouter: ${result.kisNormalizedRowAvailableAtRouter ?? false}`,
    `- kisSelectedCandidateCarriesSemanticRow: ${result.kisSelectedCandidateCarriesSemanticRow ?? false}`,
    `- semanticRowBreakPoint: ${result.semanticRowBreakPoint ?? 'UNKNOWN'}`,
    `- selectedActualRowPath: ${result.selectedActualRowPath ?? 'NONE'}`,
    `- selectedActualRowFieldKeys: ${result.selectedActualRowFieldKeys?.join(',') || 'NONE'}`,
    `- selectedActualNumericStringFieldKeys: ${result.selectedActualNumericStringFieldKeys?.join(',') || 'NONE'}`,
    `- selectedCandidateCarriesActualRow: ${result.selectedCandidate?.actualInvestorFlowCarried ?? result.actualInvestorFlowCarried ?? false}`,
    `- selectedCandidateActualRowCount: ${result.selectedCandidate?.actualInvestorFlowRowCount ?? result.actualInvestorFlowRowCount ?? 0}`,
    `- selectedCandidateActualRowFieldKeysTop: ${(result.selectedCandidate?.actualInvestorFlowFieldKeys ?? result.actualInvestorFlowFieldKeys ?? []).slice(0, 16).join(',') || 'NONE'}`,
    `- selectedCandidateActualRowDropReason: ${(result.actualInvestorFlowCarried ?? false) ? 'SELECTED_CANDIDATE_CARRIES_ACTUAL_ROW' : 'SELECTED_CANDIDATE_DROPPED_ACTUAL_ROW'}`,

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
