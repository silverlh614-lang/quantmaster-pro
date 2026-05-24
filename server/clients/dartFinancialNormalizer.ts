// @responsibility DART financial normalization with diagnostic field coverage.

export type DartFinancialProviderStatus =
  | 'OK_WITH_DATA'
  | 'OK_EMPTY'
  | 'HTTP_ERROR'
  | 'DART_ERROR_CODE'
  | 'RATE_LIMITED'
  | 'FIELD_MISSING'
  | 'PARSE_ERROR'
  | 'STALE_CACHE'
  | 'UNKNOWN_ERROR';

export type DartFinancialConfidence =
  | 'VERIFIED'
  | 'DEGRADED'
  | 'STALE'
  | 'MISSING'
  | 'EMPTY_VALID'
  | 'AI_ESTIMATED';

export type QmpDartFinancialSource = 'DART' | 'DART_CACHE' | 'QMP_CACHE' | 'MANUAL' | 'UNKNOWN';

export interface DartFinancialRawFieldCoverage {
  requiredFields: string[];
  presentFields: string[];
  missingFields: string[];
  allRequiredFieldsPresent: boolean;
}

export interface QmpDartFinancials {
  symbol: string;
  corpCode?: string | null;
  reportDate: string | null;
  fiscalYear?: string | null;
  quarter?: 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'ANNUAL' | 'UNKNOWN';

  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  operatingCashFlow: number | null;
  interestExpense: number | null;
  totalEquity: number | null;
  totalAssets: number | null;

  ocfRatio: number | null;
  roe: number | null;
  opm: number | null;
  opmYoYDelta: number | null;
  revenueYoYGrowth: number | null;
  operatingIncomeYoYGrowth: number | null;
  marginAcceleration: number | null;
  interestCoverageRatio: number | null;

  source: QmpDartFinancialSource;
  providerStatus: DartFinancialProviderStatus;
  dataConfidence: DartFinancialConfidence;
  providerIssue: boolean;
  marketSignal: false;
  executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
  rawFieldCoverage?: DartFinancialRawFieldCoverage;
  rawFieldKeys?: string[];
  fetchedAt?: string | null;
}

export interface NormalizeDartFinancialsInput {
  symbol: string;
  corpCode?: string | null;
  raw?: unknown;
  cache?: unknown;
  reportDate?: string | null;
  fetchedAt?: string | null;
  fiscalYear?: string | null;
  quarter?: QmpDartFinancials['quarter'];
  previousYearComparable?: unknown;
  providerStatus?: DartFinancialProviderStatus | string | null;
  source?: QmpDartFinancialSource | string | null;
}

type FinancialField =
  | 'revenue'
  | 'operatingIncome'
  | 'netIncome'
  | 'operatingCashFlow'
  | 'interestExpense'
  | 'totalEquity'
  | 'totalAssets';

const REQUIRED_FIELDS = ['operatingCashFlow', 'netIncome'] as const;

const FIELD_ALIASES: Record<FinancialField, readonly string[]> = {
  revenue: ['revenue', 'sales', 'ifrs-full_Revenue', 'ifrs_Revenue', 'dart_Revenue'],
  operatingIncome: [
    'operatingIncome',
    'opIncome',
    'dart_OperatingIncomeLoss',
    'ifrs-full_ProfitLossFromOperatingActivities',
    'ifrs-full_OperatingIncome',
  ],
  netIncome: [
    'netIncome',
    'profitLoss',
    'ifrs-full_ProfitLoss',
    'ifrs-full_NetProfitLoss',
    'ifrs-full_ProfitLossAttributableToOwnersOfParent',
  ],
  operatingCashFlow: [
    'operatingCashFlow',
    'opCF',
    'ifrs-full_CashFlowsFromUsedInOperatingActivities',
    'ifrs-full_CashFlowsFromOperatingActivities',
  ],
  interestExpense: ['interestExpense', 'financeCost', 'ifrs-full_FinanceCosts', 'ifrs-full_InterestExpense'],
  totalEquity: ['totalEquity', 'equity', 'ifrs-full_Equity', 'ifrs-full_EquityAttributableToOwnersOfParent'],
  totalAssets: ['totalAssets', 'assets', 'ifrs-full_Assets'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cleanNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/,/g, '').replace(/%/g, '').replace(/\+/g, '').trim();
  if (!cleaned || cleaned === '-' || cleaned.toUpperCase() === 'N/A') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function safeRatio(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return numerator / denominator;
}

function yoy(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

function normalizeSource(value: unknown): QmpDartFinancialSource {
  const raw = String(value ?? '').toUpperCase();
  if (raw.includes('DART_CACHE')) return 'DART_CACHE';
  if (raw.includes('QMP_CACHE') || raw === 'CACHE') return 'QMP_CACHE';
  if (raw.includes('MANUAL')) return 'MANUAL';
  if (raw.includes('DART')) return 'DART';
  return 'UNKNOWN';
}

function normalizeProviderStatus(value: unknown): DartFinancialProviderStatus | null {
  if (value == null || value === '') return null;
  const raw = String(value).toUpperCase();
  const allowed: DartFinancialProviderStatus[] = [
    'OK_WITH_DATA',
    'OK_EMPTY',
    'HTTP_ERROR',
    'DART_ERROR_CODE',
    'RATE_LIMITED',
    'FIELD_MISSING',
    'PARSE_ERROR',
    'STALE_CACHE',
    'UNKNOWN_ERROR',
  ];
  if ((allowed as string[]).includes(raw)) return raw as DartFinancialProviderStatus;
  if (raw.includes('EMPTY')) return 'OK_EMPTY';
  if (raw.includes('RATE') || raw.includes('LIMIT')) return 'RATE_LIMITED';
  if (raw.includes('STALE')) return 'STALE_CACHE';
  if (raw.includes('FIELD')) return 'FIELD_MISSING';
  if (raw.includes('PARSE')) return 'PARSE_ERROR';
  if (raw.includes('DART') && raw.includes('ERROR')) return 'DART_ERROR_CODE';
  if (raw.includes('HTTP')) return 'HTTP_ERROR';
  if (raw.includes('ERROR')) return 'UNKNOWN_ERROR';
  return null;
}

export function confidenceForDartFinancialStatus(status: DartFinancialProviderStatus): DartFinancialConfidence {
  if (status === 'OK_WITH_DATA') return 'VERIFIED';
  if (status === 'OK_EMPTY') return 'EMPTY_VALID';
  if (status === 'STALE_CACHE') return 'STALE';
  return status === 'FIELD_MISSING' || status === 'PARSE_ERROR'
    || status === 'HTTP_ERROR' || status === 'DART_ERROR_CODE'
    || status === 'RATE_LIMITED' || status === 'UNKNOWN_ERROR'
    ? 'DEGRADED'
    : 'MISSING';
}

function providerIssueForStatus(status: DartFinancialProviderStatus): boolean {
  return status !== 'OK_WITH_DATA' && status !== 'OK_EMPTY';
}

function rowsFromRaw(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.filter(isRecord);
  if (!isRecord(raw)) return [];
  const buckets = [raw.list, raw.output, raw.output1, raw.output2];
  for (const bucket of buckets) {
    if (Array.isArray(bucket)) return bucket.filter(isRecord);
    if (isRecord(bucket)) return [bucket];
  }
  if ('status' in raw || 'message' in raw || 'msg' in raw) return [];
  return [raw];
}

function rowValue(row: Record<string, unknown>, aliases: readonly string[]): { value: unknown; present: boolean } {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, alias)) return { value: row[alias], present: true };
  }
  return { value: undefined, present: false };
}

function extractAccountRows(rows: readonly Record<string, unknown>[]): Record<string, unknown> {
  const byAccount: Record<string, unknown> = {};
  for (const row of rows) {
    const accountId = typeof row.account_id === 'string' ? row.account_id : typeof row.accountId === 'string' ? row.accountId : null;
    if (!accountId) continue;
    byAccount[accountId] = row.thstrm_amount ?? row.amount ?? row.value;
  }
  return byAccount;
}

function buildFlatRaw(raw: unknown): Record<string, unknown> {
  const rows = rowsFromRaw(raw);
  const accountRows = extractAccountRows(rows);
  if (Object.keys(accountRows).length > 0) return accountRows;
  return rows[0] ?? {};
}

function extractField(flat: Record<string, unknown>, field: FinancialField): { value: number | null; present: boolean; parseError: boolean } {
  const raw = rowValue(flat, FIELD_ALIASES[field]);
  if (!raw.present) return { value: null, present: false, parseError: false };
  if (raw.value == null || raw.value === '') return { value: null, present: true, parseError: false };
  const value = cleanNumber(raw.value);
  return { value, present: true, parseError: value == null };
}

function statusFromRoot(raw: unknown): DartFinancialProviderStatus | null {
  if (!isRecord(raw)) return null;
  const httpStatus = cleanNumber(raw.httpStatus ?? raw.statusCode);
  if (httpStatus != null && httpStatus >= 400) {
    if (httpStatus === 429) return 'RATE_LIMITED';
    return 'HTTP_ERROR';
  }
  const status = raw.status;
  if (status != null && String(status) !== '000' && String(status) !== '0' && String(status).toUpperCase() !== 'OK') {
    const msg = String(raw.message ?? raw.msg ?? '').toUpperCase();
    if (msg.includes('RATE') || msg.includes('LIMIT')) return 'RATE_LIMITED';
    return 'DART_ERROR_CODE';
  }
  return null;
}

function rawFieldKeys(raw: unknown): string[] {
  const rows = rowsFromRaw(raw);
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) keys.add(key);
  }
  return [...keys];
}

export function normalizeDartFinancials(input: NormalizeDartFinancialsInput): QmpDartFinancials {
  const sourceRaw = input.raw ?? input.cache ?? null;
  const flat = buildFlatRaw(sourceRaw);
  const parsed = {
    revenue: extractField(flat, 'revenue'),
    operatingIncome: extractField(flat, 'operatingIncome'),
    netIncome: extractField(flat, 'netIncome'),
    operatingCashFlow: extractField(flat, 'operatingCashFlow'),
    interestExpense: extractField(flat, 'interestExpense'),
    totalEquity: extractField(flat, 'totalEquity'),
    totalAssets: extractField(flat, 'totalAssets'),
  };
  const priorFlat = buildFlatRaw(input.previousYearComparable);
  const priorRevenue = extractField(priorFlat, 'revenue').value;
  const priorOperatingIncome = extractField(priorFlat, 'operatingIncome').value;
  const priorOpm = safeRatio(priorOperatingIncome, priorRevenue);

  const revenueYoYGrowth = yoy(parsed.revenue.value, priorRevenue);
  const operatingIncomeYoYGrowth = yoy(parsed.operatingIncome.value, priorOperatingIncome);
  const opm = safeRatio(parsed.operatingIncome.value, parsed.revenue.value);
  const opmYoYDelta = opm != null && priorOpm != null ? opm - priorOpm : null;
  const marginAcceleration = operatingIncomeYoYGrowth != null && revenueYoYGrowth != null
    ? operatingIncomeYoYGrowth - revenueYoYGrowth
    : null;

  const presentFields = REQUIRED_FIELDS.filter(field => parsed[field].value != null);
  const missingFields = REQUIRED_FIELDS.filter(field => parsed[field].value == null);
  const rawFieldCoverage: DartFinancialRawFieldCoverage = {
    requiredFields: [...REQUIRED_FIELDS],
    presentFields,
    missingFields,
    allRequiredFieldsPresent: missingFields.length === 0,
  };
  const parseError = Object.values(parsed).some(item => item.parseError);
  const rows = rowsFromRaw(sourceRaw);
  const providerStatus = normalizeProviderStatus(input.providerStatus)
    ?? statusFromRoot(sourceRaw)
    ?? (rows.length === 0 ? 'OK_EMPTY' : parseError ? 'PARSE_ERROR' : rawFieldCoverage.allRequiredFieldsPresent ? 'OK_WITH_DATA' : 'FIELD_MISSING');
  const dataConfidence = confidenceForDartFinancialStatus(providerStatus);

  return {
    symbol: input.symbol.padStart(6, '0'),
    corpCode: input.corpCode ?? (isRecord(sourceRaw) && typeof sourceRaw.corp_code === 'string' ? sourceRaw.corp_code : null),
    reportDate: input.reportDate ?? null,
    fiscalYear: input.fiscalYear ?? (isRecord(sourceRaw) && typeof sourceRaw.bsns_year === 'string' ? sourceRaw.bsns_year : undefined),
    quarter: input.quarter ?? 'UNKNOWN',
    revenue: parsed.revenue.value,
    operatingIncome: parsed.operatingIncome.value,
    netIncome: parsed.netIncome.value,
    operatingCashFlow: parsed.operatingCashFlow.value,
    interestExpense: parsed.interestExpense.value,
    totalEquity: parsed.totalEquity.value,
    totalAssets: parsed.totalAssets.value,
    ocfRatio: safeRatio(parsed.operatingCashFlow.value, parsed.netIncome.value),
    roe: safeRatio(parsed.netIncome.value, parsed.totalEquity.value),
    opm,
    opmYoYDelta,
    revenueYoYGrowth,
    operatingIncomeYoYGrowth,
    marginAcceleration,
    interestCoverageRatio: safeRatio(parsed.operatingIncome.value, parsed.interestExpense.value),
    source: normalizeSource(input.source ?? (input.cache ? 'DART_CACHE' : 'DART')),
    providerStatus,
    dataConfidence,
    providerIssue: providerIssueForStatus(providerStatus),
    marketSignal: false,
    executionImpact: 'DIAGNOSTIC_ONLY',
    rawFieldCoverage,
    rawFieldKeys: rawFieldKeys(sourceRaw),
    fetchedAt: input.fetchedAt ?? null,
  };
}
