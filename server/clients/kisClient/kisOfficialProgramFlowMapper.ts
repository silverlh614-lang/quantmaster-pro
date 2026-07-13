// @responsibility KIS official program-trade normalization and passive-flow diagnostics.

import { KIS_OFFICIAL_PROGRAM_TRADE_ENDPOINTS } from './kisOfficialEndpointRegistry.js';

type KisProgramFlowEndpointKey = 'COMP_PROGRAM_TRADE_TODAY' | 'PROGRAM_TRADE_BY_STOCK_DAILY';

type KisProgramFlowScope = 'MARKET' | 'STOCK';

export type KisProgramTradeProviderStatus =
  | 'OK_WITH_DATA'
  | 'OK_EMPTY'
  | 'HTTP_ERROR'
  | 'KIS_ERROR_CODE'
  | 'TOKEN_EXPIRED'
  | 'RATE_LIMITED'
  | 'FIELD_MISSING'
  | 'PARSE_ERROR'
  | 'UNKNOWN_ERROR';

export type KisProgramTradeConfidence =
  | 'VERIFIED'
  | 'DEGRADED'
  | 'STALE'
  | 'MISSING'
  | 'EMPTY_VALID'
  | 'AI_ESTIMATED';

export interface KisProgramFlowRawFieldCoverage {
  requiredFields: string[];
  presentFields: string[];
  missingFields: string[];
  allRequiredFieldsPresent: boolean;
}

export interface KisProgramFlowDriftDiagnostic {
  type: 'KIS_OFFICIAL_DRIFT_DETECTED';
  api: KisProgramFlowEndpointKey;
  expectedPath: string;
  actualPath: string;
  expectedTrId: string;
  actualTrId: string;
  action: 'DO_NOT_AUTO_REPLACE_REQUIRE_REVIEW';
}

export interface QmpProgramFlow {
  symbol: string | null;
  tradeDate: string | null;
  scope: KisProgramFlowScope;

  programNetBuyAmount: number | null;
  programBuyAmount: number | null;
  programSellAmount: number | null;
  programNetBuyVolume: number | null;
  programBuyVolume: number | null;
  programSellVolume: number | null;

  arbitrageNetBuyAmount?: number | null;
  nonArbitrageNetBuyAmount?: number | null;

  source: 'KIS_OFFICIAL' | 'KIS_API' | 'CACHE' | 'UNKNOWN';
  endpointKey: KisProgramFlowEndpointKey | 'UNKNOWN';
  endpoint: string | null;
  trId: string | null;

  providerStatus: KisProgramTradeProviderStatus;
  dataConfidence: KisProgramTradeConfidence;
  providerIssue: boolean;
  marketSignal: false;
  executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';

  rawFieldCoverage?: KisProgramFlowRawFieldCoverage;
  rawFieldKeys?: string[];
  driftDiagnostics?: KisProgramFlowDriftDiagnostic[];
  fetchedAt?: string | null;
  notes?: string[];
}

export interface NormalizeKisProgramFlowInput {
  symbol?: string | null;
  endpointKey: KisProgramFlowEndpointKey;
  raw: unknown;
  fetchedAt?: string;
  tradeDate?: string;
  actualPath?: string | null;
  actualTrId?: string | null;
  providerStatus?: KisProgramTradeProviderStatus | string | null;
}

type ProgramField =
  | 'programNetBuyAmount'
  | 'programBuyAmount'
  | 'programSellAmount'
  | 'programNetBuyVolume'
  | 'programBuyVolume'
  | 'programSellVolume'
  | 'arbitrageNetBuyAmount'
  | 'nonArbitrageNetBuyAmount';

const MARKET_REQUIRED_FIELDS = ['programNetBuyAmount'] as const;
const STOCK_REQUIRED_FIELDS = ['programNetBuyAmount'] as const;

const FIELD_ALIASES: Record<ProgramField, readonly string[]> = {
  programNetBuyAmount: [
    'programNetBuyAmount',
    'programNetBuy',
    'marketProgramNetBuy',
    'totalProgramNetBuyAmount',
    'netBuyAmount',
    'whol_smtn_ntby_tr_pbmn',
    'prgm_ntby_tr_pbmn',
    'prgm_ntby_tr_pbmn_2',
    'PRGM_NTBY_TR_PBMN',
  ],
  programBuyAmount: [
    'programBuyAmount',
    'marketProgramBuyAmount',
    'buyAmount',
    'whol_smtn_shnu_tr_pbmn',
    'prgm_shnu_tr_pbmn',
    'arbt_smtn_shnu_tr_pbmn',
    'nabt_smtn_shnu_tr_pbmn',
  ],
  programSellAmount: [
    'programSellAmount',
    'marketProgramSellAmount',
    'sellAmount',
    'whol_smtn_seln_tr_pbmn',
    'prgm_seln_tr_pbmn',
    'arbt_smtn_seln_tr_pbmn',
    'nabt_smtn_seln_tr_pbmn',
  ],
  programNetBuyVolume: [
    'programNetBuyVolume',
    'programNetBuyQty',
    'programNetBuyQuantity',
    'whol_smtn_ntby_qty',
    'prgm_ntby_qty',
    'prgm_ntby_qty_2',
    'PRGM_NTBY_QTY',
  ],
  programBuyVolume: [
    'programBuyVolume',
    'programBuyQty',
    'whol_smtn_shnu_qty',
    'prgm_shnu_qty',
  ],
  programSellVolume: [
    'programSellVolume',
    'programSellQty',
    'whol_smtn_seln_qty',
    'prgm_seln_qty',
  ],
  arbitrageNetBuyAmount: [
    'arbitrageNetBuyAmount',
    'programArbitrageNetBuy',
    'arbt_smtn_ntby_tr_pbmn',
    'arbt_ntby_tr_pbmn',
    'arbt_ntby_tr_pbmn_2',
    'ARBT_NTBY_TR_PBMN',
  ],
  nonArbitrageNetBuyAmount: [
    'nonArbitrageNetBuyAmount',
    'programNonArbitrageNetBuy',
    'nabt_smtn_ntby_tr_pbmn',
    'nabt_ntby_tr_pbmn',
    'NABT_NTBY_TR_PBMN',
  ],
};

const DATE_ALIASES = ['tradeDate', 'tradingDate', 'stck_bsop_date', 'bsop_date', 'STCK_BSOP_DATE', 'BSOP_DATE'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cleanNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/,/g, '').replace(/%/g, '').replace(/\+/g, '').trim();
  if (!cleaned || cleaned === '-' || cleaned.toUpperCase() === 'N/A') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNumberField(row: Record<string, unknown>, aliases: readonly string[]): {
  value: number | null;
  present: boolean;
  parseError: boolean;
  alias: string | null;
} {
  for (const alias of aliases) {
    if (!Object.prototype.hasOwnProperty.call(row, alias)) continue;
    const value = row[alias];
    if (value == null || value === '') return { value: null, present: true, parseError: false, alias };
    const parsed = cleanNumber(value);
    return { value: parsed, present: true, parseError: parsed == null, alias };
  }
  return { value: null, present: false, parseError: false, alias: null };
}

function rowsFromRaw(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.filter(isRecord);
  if (!isRecord(raw)) return [];
  const buckets = [raw.output, raw.output1, raw.output2];
  for (const bucket of buckets) {
    if (Array.isArray(bucket)) return bucket.filter(isRecord);
    if (isRecord(bucket)) return [bucket];
  }
  if ('rt_cd' in raw || 'msg_cd' in raw || 'msg1' in raw) return [];
  return [raw];
}

function rootStatus(raw: unknown): KisProgramTradeProviderStatus | null {
  if (!isRecord(raw)) return null;
  const httpStatus = cleanNumber(raw.httpStatus ?? raw.statusCode);
  if (httpStatus != null && httpStatus >= 400) {
    if (httpStatus === 401 || httpStatus === 403) return 'TOKEN_EXPIRED';
    if (httpStatus === 429) return 'RATE_LIMITED';
    return 'HTTP_ERROR';
  }
  const rtCd = raw.rt_cd ?? raw.rtCd;
  if (rtCd != null && String(rtCd) !== '0') {
    const msg = String(raw.msg_cd ?? raw.msg1 ?? raw.message ?? '').toUpperCase();
    if (msg.includes('TOKEN') || msg.includes('AUTH') || msg.includes('OAUTH') || msg.includes('401')) return 'TOKEN_EXPIRED';
    if (msg.includes('RATE') || msg.includes('LIMIT') || msg.includes('EGW00201') || msg.includes('429')) return 'RATE_LIMITED';
    return 'KIS_ERROR_CODE';
  }
  return null;
}

function normalizeProviderStatus(value: unknown): KisProgramTradeProviderStatus | null {
  if (value == null || value === '') return null;
  const raw = String(value).toUpperCase();
  const allowed: KisProgramTradeProviderStatus[] = [
    'OK_WITH_DATA',
    'OK_EMPTY',
    'HTTP_ERROR',
    'KIS_ERROR_CODE',
    'TOKEN_EXPIRED',
    'RATE_LIMITED',
    'FIELD_MISSING',
    'PARSE_ERROR',
    'UNKNOWN_ERROR',
  ];
  if ((allowed as string[]).includes(raw)) return raw as KisProgramTradeProviderStatus;
  if (raw.includes('EMPTY') || raw === 'ACCEPTED_EMPTY' || raw === 'TRUE_EMPTY') return 'OK_EMPTY';
  if (raw.includes('TOKEN') || raw.includes('AUTH')) return 'TOKEN_EXPIRED';
  if (raw.includes('RATE') || raw.includes('LIMIT')) return 'RATE_LIMITED';
  if (raw.includes('FIELD')) return 'FIELD_MISSING';
  if (raw.includes('PARSE')) return 'PARSE_ERROR';
  if (raw.includes('ERROR')) return 'UNKNOWN_ERROR';
  return null;
}

function confidenceForKisProgramTradeStatus(status: KisProgramTradeProviderStatus): KisProgramTradeConfidence {
  if (status === 'OK_WITH_DATA') return 'VERIFIED';
  if (status === 'OK_EMPTY') return 'EMPTY_VALID';
  if (status === 'FIELD_MISSING' || status === 'PARSE_ERROR') return 'DEGRADED';
  if (status === 'HTTP_ERROR' || status === 'KIS_ERROR_CODE' || status === 'TOKEN_EXPIRED' || status === 'RATE_LIMITED' || status === 'UNKNOWN_ERROR') return 'DEGRADED';
  return 'MISSING';
}

function providerIssueForStatus(status: KisProgramTradeProviderStatus): boolean {
  return status !== 'OK_WITH_DATA' && status !== 'OK_EMPTY';
}

function stringFromAliases(row: Record<string, unknown>, aliases: readonly string[]): string | null {
  for (const alias of aliases) {
    const value = row[alias];
    if (value == null || value === '') continue;
    return String(value);
  }
  return null;
}

function normalizeYmd(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{8}$/.test(trimmed)) return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
  return trimmed;
}

function normalizeSymbol(symbol: string | null | undefined, scope: KisProgramFlowScope): string | null {
  if (!symbol) return null;
  return scope === 'STOCK' ? symbol.padStart(6, '0') : symbol;
}

function rawFieldKeys(raw: unknown): string[] {
  const keys = new Set<string>();
  for (const row of rowsFromRaw(raw)) {
    for (const key of Object.keys(row)) keys.add(key);
  }
  return [...keys];
}

function detectDrift(input: {
  endpointKey: KisProgramFlowEndpointKey;
  actualPath?: string | null;
  actualTrId?: string | null;
}): KisProgramFlowDriftDiagnostic[] {
  const spec = KIS_OFFICIAL_PROGRAM_TRADE_ENDPOINTS[input.endpointKey];
  const actualPath = input.actualPath ?? spec.path;
  const actualTrId = input.actualTrId ?? spec.trId;
  if (actualPath === spec.path && actualTrId === spec.trId) return [];
  return [{
    type: 'KIS_OFFICIAL_DRIFT_DETECTED',
    api: input.endpointKey,
    expectedPath: spec.path,
    actualPath,
    expectedTrId: spec.trId,
    actualTrId,
    action: 'DO_NOT_AUTO_REPLACE_REQUIRE_REVIEW',
  }];
}

function buildRawCoverage(requiredFields: readonly string[], mapped: Record<ProgramField, ReturnType<typeof parseNumberField>>): KisProgramFlowRawFieldCoverage {
  const missingFields = requiredFields.filter(field => mapped[field as ProgramField].value == null);
  return {
    requiredFields: [...requiredFields],
    presentFields: requiredFields.filter(field => !missingFields.includes(field)),
    missingFields,
    allRequiredFieldsPresent: missingFields.length === 0,
  };
}

export function normalizeKisProgramFlow(input: NormalizeKisProgramFlowInput): QmpProgramFlow {
  const spec = KIS_OFFICIAL_PROGRAM_TRADE_ENDPOINTS[input.endpointKey];
  const scope = spec.scope as KisProgramFlowScope;
  const rows = rowsFromRaw(input.raw);
  const row = rows[0] ?? {};
  const mapped: Record<ProgramField, ReturnType<typeof parseNumberField>> = {
    programNetBuyAmount: parseNumberField(row, FIELD_ALIASES.programNetBuyAmount),
    programBuyAmount: parseNumberField(row, FIELD_ALIASES.programBuyAmount),
    programSellAmount: parseNumberField(row, FIELD_ALIASES.programSellAmount),
    programNetBuyVolume: parseNumberField(row, FIELD_ALIASES.programNetBuyVolume),
    programBuyVolume: parseNumberField(row, FIELD_ALIASES.programBuyVolume),
    programSellVolume: parseNumberField(row, FIELD_ALIASES.programSellVolume),
    arbitrageNetBuyAmount: parseNumberField(row, FIELD_ALIASES.arbitrageNetBuyAmount),
    nonArbitrageNetBuyAmount: parseNumberField(row, FIELD_ALIASES.nonArbitrageNetBuyAmount),
  };
  const requiredFields = scope === 'MARKET' ? MARKET_REQUIRED_FIELDS : STOCK_REQUIRED_FIELDS;
  const rawFieldCoverage = buildRawCoverage(requiredFields, mapped);
  const parseError = Object.values(mapped).some(item => item.parseError);
  const explicitStatus = normalizeProviderStatus(input.providerStatus);
  const status = explicitStatus
    ?? rootStatus(input.raw)
    ?? (rows.length === 0 ? 'OK_EMPTY' : parseError ? 'PARSE_ERROR' : rawFieldCoverage.allRequiredFieldsPresent ? 'OK_WITH_DATA' : 'FIELD_MISSING');
  const dataConfidence = confidenceForKisProgramTradeStatus(status);

  return {
    symbol: normalizeSymbol(input.symbol, scope),
    tradeDate: normalizeYmd(input.tradeDate ?? stringFromAliases(row, DATE_ALIASES)),
    scope,
    programNetBuyAmount: mapped.programNetBuyAmount.value,
    programBuyAmount: mapped.programBuyAmount.value,
    programSellAmount: mapped.programSellAmount.value,
    programNetBuyVolume: mapped.programNetBuyVolume.value,
    programBuyVolume: mapped.programBuyVolume.value,
    programSellVolume: mapped.programSellVolume.value,
    arbitrageNetBuyAmount: mapped.arbitrageNetBuyAmount.value,
    nonArbitrageNetBuyAmount: mapped.nonArbitrageNetBuyAmount.value,
    source: 'KIS_OFFICIAL',
    endpointKey: input.endpointKey,
    endpoint: spec.path,
    trId: spec.trId,
    providerStatus: status,
    dataConfidence,
    providerIssue: providerIssueForStatus(status),
    marketSignal: false,
    executionImpact: 'DIAGNOSTIC_ONLY',
    rawFieldCoverage,
    rawFieldKeys: rawFieldKeys(input.raw),
    driftDiagnostics: detectDrift({
      endpointKey: input.endpointKey,
      actualPath: input.actualPath,
      actualTrId: input.actualTrId,
    }),
    fetchedAt: input.fetchedAt ?? null,
    notes: status === 'OK_EMPTY' ? ['PROGRAM_TRADE_EMPTY_VALID_NOT_BEARISH'] : [],
  };
}
