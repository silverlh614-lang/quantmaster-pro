/**
 * @responsibility ADR-0477 investor flow router primitive helpers.
 */

import type { NaverInvestorTrendCollectorResult } from '../naverInvestorTrendCollectorAdr0481.js';
import type { SemanticNetBuyNormalizationReportAdr0482, SemanticNetBuyProvider, SemanticNetBuySampleAdr0482, SemanticNetBuyStatus } from '../semanticNetBuyNormalizerAdr0482.js';
import type { FreshDataSupplyReportAdr0487, FreshDataSnapshotAdr0487 } from '../freshDataSupplyLayerAdr0487.js';
import type { SupplySnapshotCacheLookupAdr0491 } from '../supplySnapshotStoreReplayAdr0491.js';
import { normalizeInvestorFlowSnapshotKeyAdr0491, normalizeInvestorFlowSourceKeyAdr0491 as normalizeInvestorFlowSourceKeySharedAdr0491 } from '../investorFlowSnapshotKeyNormalizerAdr0491.js';
import {
  buildInvestorSampleDiagnosticsAdr0502,
  formatInvestorSampleDiagnosticsAdr0502,
  type InvestorSampleDiagnosticsAdr0502,
  type InvestorSampleProviderNameAdr0502,
} from '../investorSampleMaterializationAdr0502.js';
import { buildSanitizedInvestorFlowSemanticRow, hasActualInvestorNumericRow, normalizeNumberLikeInvestorFlowValue, unwrapInvestorFlowRows, type SanitizedInvestorFlowSemanticRow } from '../../../supply/investorFlowSemanticAvailability.js';
import type {
  InvestorFlowProviderId,
  InvestorFlowProviderRouteResult,
  InvestorFlowProviderStatus,
  SemanticNetBuySample,
  SemanticSupplySignal,
  SupplyProviderCapability,
} from './types.js';

export const ROUTER_POLICY = {
  executionImpact: 'NONE',
  liveExecutionAllowed: false,
  policyPromotionMode: 'SHADOW_ONLY',
  operatorApprovalRequired: true,
  rawPayloadPersistenceAllowed: false,
} as const;

export function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function valueFromAliases(raw: Record<string, unknown> | null | undefined, keys: string[]): number | null {
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

export function normalizeCodeAdr0477(value: unknown): string {
  const raw = String(value ?? '');
  const digits = raw.replace(/[^0-9]/g, '');
  return digits.length >= 6 ? digits.slice(-6) : digits || raw;
}

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

export function selectedActualRowDiagnosticsAdr0477(input: unknown): {
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

export function providerIdFromMaterializationAdr0477(providerName: InvestorSampleProviderNameAdr0502): InvestorFlowProviderId {
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

export function normalizeStatus(input: {
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

export function confidenceForStatus(
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

export function deriveSignal(input: {
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


export function mapSemanticNetBuyStatusAdr0482ToAdr0477(status: SemanticNetBuyStatus): InvestorFlowProviderStatus {
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
