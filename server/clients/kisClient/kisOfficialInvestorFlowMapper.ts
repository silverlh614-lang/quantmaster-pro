// @responsibility KIS official investor-flow normalization and diagnostics.

import { KIS_OFFICIAL_INVESTOR_FLOW_ENDPOINTS } from './kisOfficialEndpointRegistry.js';

export type KisInvestorFlowEndpointKey = 'INQUIRE_INVESTOR' | 'INVESTOR_TRADE_BY_STOCK_DAILY';

export type KisInvestorFlowProviderStatus =
  | 'OK_WITH_DATA'
  | 'OK_EMPTY'
  | 'HTTP_ERROR'
  | 'KIS_ERROR_CODE'
  | 'TOKEN_EXPIRED'
  | 'RATE_LIMITED'
  | 'FIELD_MISSING'
  | 'PARSE_ERROR'
  | 'UNKNOWN_ERROR';

export type KisInvestorFlowConfidence =
  | 'VERIFIED'
  | 'DEGRADED'
  | 'STALE'
  | 'MISSING'
  | 'EMPTY_VALID'
  | 'AI_ESTIMATED';

export interface KisInvestorFlowRawFieldCoverage {
  requiredFields: string[];
  presentFields: string[];
  missingFields: string[];
  allRequiredFieldsPresent: boolean;
}

export interface KisInvestorFlowDriftDiagnostic {
  type: 'KIS_OFFICIAL_DRIFT_DETECTED';
  api: KisInvestorFlowEndpointKey;
  expectedPath: string;
  actualPath: string;
  expectedTrId: string;
  actualTrId: string;
  action: 'DO_NOT_AUTO_REPLACE_REQUIRE_REVIEW';
}

export interface QmpInvestorFlow {
  symbol: string;
  tradeDate: string | null;
  foreignNetBuy: number | null;
  institutionalNetBuy: number | null;
  individualNetBuy: number | null;
  foreignBuyAmount?: number | null;
  foreignSellAmount?: number | null;
  institutionalBuyAmount?: number | null;
  institutionalSellAmount?: number | null;
  individualBuyAmount?: number | null;
  individualSellAmount?: number | null;
  source: 'KIS_OFFICIAL' | 'KIS_API' | 'CACHE' | 'UNKNOWN';
  endpointKey: KisInvestorFlowEndpointKey | 'UNKNOWN';
  endpoint: string | null;
  trId: string | null;
  providerStatus: KisInvestorFlowProviderStatus;
  dataConfidence: KisInvestorFlowConfidence;
  providerIssue: boolean;
  marketSignal: false;
  executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
  rawFieldCoverage?: KisInvestorFlowRawFieldCoverage;
  rawFieldKeys?: string[];
  driftDiagnostics?: KisInvestorFlowDriftDiagnostic[];
  fetchedAt?: string | null;
}

export interface NormalizeKisInvestorFlowInput {
  symbol: string;
  endpointKey: KisInvestorFlowEndpointKey;
  raw: unknown;
  fetchedAt?: string;
  tradeDate?: string;
  actualPath?: string | null;
  actualTrId?: string | null;
  providerStatus?: KisInvestorFlowProviderStatus | string | null;
}

type FieldName =
  | 'foreignNetBuy'
  | 'institutionalNetBuy'
  | 'individualNetBuy'
  | 'foreignBuyAmount'
  | 'foreignSellAmount'
  | 'institutionalBuyAmount'
  | 'institutionalSellAmount'
  | 'individualBuyAmount'
  | 'individualSellAmount';

const FIELD_ALIASES: Record<FieldName, readonly string[]> = {
  foreignNetBuy: ['foreignNetBuy', 'foreignerNetBuy', 'frgn_ntby_qty', 'frgn_ntby_tr_pbmn', 'FRGN_NTBY_QTY', 'FRGN_NTBY_TR_PBMN'],
  institutionalNetBuy: ['institutionalNetBuy', 'institutionNetBuy', 'orgn_ntby_qty', 'orgn_ntby_tr_pbmn', 'ORGN_NTBY_QTY', 'ORGN_NTBY_TR_PBMN'],
  individualNetBuy: ['individualNetBuy', 'retailNetBuy', 'prsn_ntby_qty', 'prsn_ntby_tr_pbmn', 'PRSN_NTBY_QTY', 'PRSN_NTBY_TR_PBMN'],
  foreignBuyAmount: ['foreignBuyAmount', 'frgn_shnu_tr_pbmn', 'frgn_buy_tr_pbmn', 'FRGN_SHNU_TR_PBMN'],
  foreignSellAmount: ['foreignSellAmount', 'frgn_seln_tr_pbmn', 'frgn_sell_tr_pbmn', 'FRGN_SELN_TR_PBMN'],
  institutionalBuyAmount: ['institutionalBuyAmount', 'orgn_shnu_tr_pbmn', 'orgn_buy_tr_pbmn', 'ORGN_SHNU_TR_PBMN'],
  institutionalSellAmount: ['institutionalSellAmount', 'orgn_seln_tr_pbmn', 'orgn_sell_tr_pbmn', 'ORGN_SELN_TR_PBMN'],
  individualBuyAmount: ['individualBuyAmount', 'prsn_shnu_tr_pbmn', 'prsn_buy_tr_pbmn', 'PRSN_SHNU_TR_PBMN'],
  individualSellAmount: ['individualSellAmount', 'prsn_seln_tr_pbmn', 'prsn_sell_tr_pbmn', 'PRSN_SELN_TR_PBMN'],
};

const DATE_ALIASES = ['tradeDate', 'tradingDate', 'stck_bsop_date', 'bsop_date', 'STCK_BSOP_DATE', 'BSOP_DATE'];
const REQUIRED_NORMALIZED_FIELDS = ['foreignNetBuy', 'institutionalNetBuy'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cleanNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/,/g, '').replace(/%/g, '').replace(/\+/g, '').trim();
  if (!cleaned || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseNumberField(row: Record<string, unknown>, aliases: readonly string[]): { value: number | null; present: boolean; parseError: boolean; alias: string | null } {
  for (const alias of aliases) {
    if (!Object.prototype.hasOwnProperty.call(row, alias)) continue;
    const value = row[alias];
    if (value == null || value === '') return { value: null, present: true, parseError: false, alias };
    const parsed = cleanNumber(value);
    return { value: parsed, present: true, parseError: parsed == null, alias };
  }
  return { value: null, present: false, parseError: false, alias: null };
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

function rootStatus(raw: unknown): KisInvestorFlowProviderStatus | null {
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

function normalizeProviderStatus(value: unknown): KisInvestorFlowProviderStatus | null {
  if (value == null || value === '') return null;
  const raw = String(value).toUpperCase();
  const allowed: KisInvestorFlowProviderStatus[] = [
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
  if ((allowed as string[]).includes(raw)) return raw as KisInvestorFlowProviderStatus;
  if (raw.includes('EMPTY')) return 'OK_EMPTY';
  if (raw.includes('TOKEN') || raw.includes('AUTH')) return 'TOKEN_EXPIRED';
  if (raw.includes('RATE') || raw.includes('LIMIT')) return 'RATE_LIMITED';
  if (raw.includes('FIELD')) return 'FIELD_MISSING';
  if (raw.includes('PARSE')) return 'PARSE_ERROR';
  if (raw.includes('ERROR')) return 'UNKNOWN_ERROR';
  return null;
}

function confidenceForKisInvestorFlowStatus(status: KisInvestorFlowProviderStatus): KisInvestorFlowConfidence {
  if (status === 'OK_WITH_DATA') return 'VERIFIED';
  if (status === 'OK_EMPTY') return 'EMPTY_VALID';
  if (status === 'FIELD_MISSING' || status === 'PARSE_ERROR') return 'DEGRADED';
  if (status === 'HTTP_ERROR' || status === 'KIS_ERROR_CODE' || status === 'TOKEN_EXPIRED' || status === 'RATE_LIMITED' || status === 'UNKNOWN_ERROR') return 'DEGRADED';
  return 'MISSING';
}

function providerIssueForStatus(status: KisInvestorFlowProviderStatus): boolean {
  return status !== 'OK_WITH_DATA' && status !== 'OK_EMPTY';
}

function detectDrift(input: {
  endpointKey: KisInvestorFlowEndpointKey;
  actualPath?: string | null;
  actualTrId?: string | null;
}): KisInvestorFlowDriftDiagnostic[] {
  const spec = KIS_OFFICIAL_INVESTOR_FLOW_ENDPOINTS[input.endpointKey];
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

export function normalizeKisInvestorFlow(input: NormalizeKisInvestorFlowInput): QmpInvestorFlow {
  const spec = KIS_OFFICIAL_INVESTOR_FLOW_ENDPOINTS[input.endpointKey];
  const rows = rowsFromRaw(input.raw);
  const row = rows[0] ?? {};
  const mapped: Record<FieldName, ReturnType<typeof parseNumberField>> = {
    foreignNetBuy: parseNumberField(row, FIELD_ALIASES.foreignNetBuy),
    institutionalNetBuy: parseNumberField(row, FIELD_ALIASES.institutionalNetBuy),
    individualNetBuy: parseNumberField(row, FIELD_ALIASES.individualNetBuy),
    foreignBuyAmount: parseNumberField(row, FIELD_ALIASES.foreignBuyAmount),
    foreignSellAmount: parseNumberField(row, FIELD_ALIASES.foreignSellAmount),
    institutionalBuyAmount: parseNumberField(row, FIELD_ALIASES.institutionalBuyAmount),
    institutionalSellAmount: parseNumberField(row, FIELD_ALIASES.institutionalSellAmount),
    individualBuyAmount: parseNumberField(row, FIELD_ALIASES.individualBuyAmount),
    individualSellAmount: parseNumberField(row, FIELD_ALIASES.individualSellAmount),
  };

  const presentFields = REQUIRED_NORMALIZED_FIELDS.filter(field => mapped[field].value != null);
  const missingFields = REQUIRED_NORMALIZED_FIELDS.filter(field => mapped[field].value == null);
  const rawFieldCoverage: KisInvestorFlowRawFieldCoverage = {
    requiredFields: [...REQUIRED_NORMALIZED_FIELDS],
    presentFields,
    missingFields,
    allRequiredFieldsPresent: missingFields.length === 0,
  };

  const parseError = Object.values(mapped).some(item => item.parseError);
  const explicitStatus = normalizeProviderStatus(input.providerStatus);
  const status = explicitStatus
    ?? rootStatus(input.raw)
    ?? (rows.length === 0 ? 'OK_EMPTY' : parseError ? 'PARSE_ERROR' : rawFieldCoverage.allRequiredFieldsPresent ? 'OK_WITH_DATA' : 'FIELD_MISSING');
  const dataConfidence = confidenceForKisInvestorFlowStatus(status);

  return {
    symbol: input.symbol.padStart(6, '0'),
    tradeDate: normalizeYmd(input.tradeDate ?? stringFromAliases(row, DATE_ALIASES)),
    foreignNetBuy: mapped.foreignNetBuy.value,
    institutionalNetBuy: mapped.institutionalNetBuy.value,
    individualNetBuy: mapped.individualNetBuy.value,
    foreignBuyAmount: mapped.foreignBuyAmount.value,
    foreignSellAmount: mapped.foreignSellAmount.value,
    institutionalBuyAmount: mapped.institutionalBuyAmount.value,
    institutionalSellAmount: mapped.institutionalSellAmount.value,
    individualBuyAmount: mapped.individualBuyAmount.value,
    individualSellAmount: mapped.individualSellAmount.value,
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
    rawFieldKeys: Object.keys(row),
    driftDiagnostics: detectDrift(input),
    fetchedAt: input.fetchedAt ?? null,
  };
}
