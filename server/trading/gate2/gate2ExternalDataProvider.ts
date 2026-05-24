// @responsibility Gate2 external financial snapshot, derived metrics, and safe projection helpers.

import type { DartFinancials } from '../../clients/dartFinancialClient.js';
import { getDartFinancials } from '../../clients/dartFinancialClient.js';
import { normalizeDartFinancials, type QmpDartFinancials } from '../../clients/dartFinancialNormalizer.js';
import { fetchWithRetry, FetchRetryError } from '../../utils/fetchWithRetry.js';
import {
  ensureDartCorpCodeMasterCache,
  getDartCorpCodeCacheStatus,
  resolveDartCorpCodeFromCache,
} from './dartCorpCodeMasterCache.js';
import {
  getGate2ExternalCacheRecord,
  isGate2ExternalCacheWritable,
  loadGate2ExternalCache,
  upsertGate2ExternalCacheRecords,
  updateGate2ExternalLastRefresh,
} from './gate2ExternalCache.js';
import { realDataKisGet } from '../../clients/kisClient/http.js';
import { HAS_REAL_DATA_CLIENT } from '../../clients/kisClient/constants.js';
import { getStockByCode, isTradableKrxEquity } from '../../persistence/krxStockMasterRepo.js';

export type Gate2FinancialSource = 'DART' | 'CACHE' | 'NONE';
export type Gate2FinancialConfidence = 'VERIFIED' | 'DEGRADED' | 'STALE' | 'MISSING';
export type Gate2FinancialStatementType = 'CFS' | 'OFS' | 'UNKNOWN';
export type Gate2ConditionStatus = 'PASS' | 'FAIL' | 'UNAVAILABLE';
export type Gate2CorpCodeResolveStatus = 'FOUND' | 'NOT_FOUND' | 'CACHE_MISSING' | 'ERROR';
export type Gate2FiscalPeriodStatus = 'RESOLVED' | 'NONE' | 'ERROR';
export type Gate2PerValuationSource = 'KIS' | 'DART_EPS_PRICE' | 'CACHE' | 'NONE';
export type Gate2CorpCodeMissingReason =
  | 'NONE'
  | 'DART_NOT_APPLICABLE'
  | 'DART_CORP_CODE_NOT_FOUND'
  | 'DART_CORP_CODE_LOOKUP_FAILED'
  | 'DART_CORP_CODE_CACHE_NOT_LOADED';

export interface Gate2ExternalRefreshTrace {
  symbol: string;
  symbolNormalized?: string;
  lookupKey?: string;
  corpCodeResolveStatus: Gate2CorpCodeResolveStatus;
  corpCode?: string;
  instrumentType?: string;
  corpCodeMissingReason?: Gate2CorpCodeMissingReason;
  fiscalPeriodStatus: Gate2FiscalPeriodStatus;
  fiscalPeriod?: string;
  reportCode?: string;
  statementType?: Gate2FinancialStatementType;
  corpCodeRequestAttempted: boolean;
  dartRequestAttempted: boolean;
  dartHttpStatus?: number;
  dartErrorCode?: string;
  dartRawRows: number;
  normalizedRows: number;
  derivedMetricsComputed: boolean;
  kisPerRequestAttempted: boolean;
  kisPerRaw?: unknown;
  perNormalized?: number | null;
  perSource?: Gate2PerValuationSource;
  perReason?: string;
  epsComputed?: number | null;
  currentPrice?: number | null;
  listedShares?: number | null;
  dartEpsComputed?: boolean;
  perComputedFromPriceAndEps?: boolean;
  perCacheHit?: boolean;
  finalConfidence: 'VERIFIED' | 'STALE' | 'MISSING';
  unavailableConditions: string[];
  executionImpact: 'NONE';
}

export interface Gate2ExternalRefreshCounters {
  providerRequestsAttempted: number;
  corpCodeResolved: number;
  corpCodeMissing: number;
  dartNotApplicableCount: number;
  trueCorpCodeNotFound: number;
  corpCodeLookupFailed: number;
  fiscalPeriodResolved: number;
  fiscalPeriodMissing: number;
  dartResponsesOk: number;
  dartResponsesError: number;
  dartRowsFetched: number;
  normalizedRowsBuilt: number;
  derivedMetricsComputed: number;
  kisPerAttempted: number;
  kisPerAvailable: number;
  kisPerUnavailable: number;
  dartEpsComputed: number;
  perComputedFromPriceAndEps: number;
  perCacheHit: number;
  unavailableDueToPER: number;
  unavailableDueToCorpCodeMissing: number;
  unavailableDueToFiscalPeriodMissing: number;
  unavailableDueToFinancialRowsEmpty: number;
  unavailableDueToNormalizationFailed: number;
  unavailableCountRaw: number;
  unavailableCountActionable: number;
  unavailableExcludingExcluded: number;
  excludedCount: number;
  excludedUnavailableEquivalent: number;
}

export type Gate2ExternalRootCause =
  | 'NONE'
  | 'DART_API_KEY_MISSING'
  | 'DART_CORP_CODE_CACHE_NOT_LOADED'
  | 'DART_CORP_CODE_NOT_FOUND'
  | 'PARTIAL_CORP_CODE_NOT_FOUND'
  | 'DART_NOT_APPLICABLE_ONLY'
  | 'PER_PARTIAL_UNAVAILABLE'
  | 'DART_CORP_CODE_MAPPING_MISSING'
  | 'DART_FISCAL_PERIOD_RESOLVE_FAILED'
  | 'DART_FINANCIAL_HTTP_ERROR'
  | 'DART_FINANCIAL_ROWS_EMPTY'
  | 'DART_FINANCIAL_NORMALIZATION_FAILED'
  | 'GATE2_DERIVED_METRICS_FAILED'
  | 'DART_HTTP_OR_RESPONSE_ERROR'
  | 'DART_NORMALIZATION_MAPPING_FAILED'
  | 'DART_FINANCIALS_MISSING';

export interface Gate2FinancialSnapshot {
  symbol: string;
  corpCode: string | null;
  fiscalPeriod: string | null;
  statementType: Gate2FinancialStatementType;
  revenue: number | null;
  operatingProfit: number | null;
  netIncome: number | null;
  operatingCashFlow: number | null;
  equity: number | null;
  totalAssets: number | null;
  totalDebt: number | null;
  interestExpense: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  source: Gate2FinancialSource;
  confidence: Gate2FinancialConfidence;
  lastUpdated: string | null;
  rawStatus: string;
  normalizedStatus: string;
  providerIssue: boolean;
  marketSignal: false;
  executionImpact: 'NONE';
}

export interface Gate2DerivedMetrics {
  per: number | null;
  roe: number | null;
  opm: number | null;
  netMargin: number | null;
  icr: number | null;
  debtRatio: number | null;
  currentRatio: number | null;
  earningsQualityScore: number | null;
  ocfGreaterThanNetIncome: boolean | null;
  opmYoYAcceleration: number | null;
}

export interface Gate2ProjectedCondition {
  status: Gate2ConditionStatus;
  value: number | null;
  source: Gate2FinancialSource | 'KIS' | 'DART' | 'CACHE' | 'NONE';
  reason: string;
  executionImpact: 'NONE';
}

export interface Gate2ExternalProjection {
  symbol: string;
  asOf: string;
  financialSnapshot: Gate2FinancialSnapshot;
  metrics: Gate2DerivedMetrics;
  valuation: {
    per: Gate2ProjectedCondition & { per: number | null };
  };
  profitability: {
    roe: number | null;
    opm: number | null;
    netMargin: number | null;
    source: Gate2FinancialSource;
  };
  stability: {
    icr: number | null;
    debtRatio: number | null;
    currentRatio: number | null;
    source: Gate2FinancialSource;
  };
  earningsQuality: {
    status: Gate2ConditionStatus;
    score: number | null;
    reason: string;
    source: Gate2FinancialSource;
    executionImpact: 'NONE';
  };
  conditionResults: Record<'earnings_quality' | 'per' | 'roe' | 'opm' | 'icr', Gate2ProjectedCondition>;
  refreshTrace?: Gate2ExternalRefreshTrace;
  unavailableCount: number;
  highConvictionImpact: 'NONE' | 'BLOCK_STRONG_BUY_UPGRADE';
  entryHardBlockImpact: 'NO';
  shadowObservablePreserved: true;
  counterfactualAllowed: true;
  executionImpact: 'NONE';
}

export interface Gate2ExternalRefreshResult {
  asOf: string;
  requestedSymbols: string[];
  refreshedCount: number;
  verifiedCount: number;
  staleCount: number;
  missingCount: number;
  rowsProjected: number;
  unavailableCount: number;
  counters: Gate2ExternalRefreshCounters;
  rootCause: Gate2ExternalRootCause;
  traces: Gate2ExternalRefreshTrace[];
  providerHealth: Gate2DartProviderHealth;
  strongBuyBlockedReason: 'NONE' | 'DART_FINANCIALS_MISSING' | 'GATE2_EXTERNAL_PARTIAL';
  strongBuyBlockedDetails: string;
  blockingDetails: string;
  excludedDetails: string;
  excludedCount: number;
  excludedSymbols: string[];
  excludedReason: 'DART_NOT_APPLICABLE' | 'NONE';
  unavailableCountRaw: number;
  unavailableCountActionable: number;
  unavailableExcludingExcluded: number;
  excludedUnavailableEquivalent: number;
  corpCodeMissingSymbols: string[];
  dartNotApplicableSymbols: string[];
  trueCorpCodeNotFoundSymbols: string[];
  corpCodeLookupFailedSymbols: string[];
  nonEquitySymbols: string[];
  executionImpact: 'NONE';
  records: Gate2ExternalProjection[];
}

export interface Gate2DartProviderHealth {
  apiKeyPresent: boolean;
  corpCodeCacheLoaded: boolean;
  corpCodeCacheCount: number;
  lastCorpCodeCacheUpdatedAt: string | null;
  requestEnabled: boolean;
  lastHttpStatus: number | null;
  lastErrorCode: string | null;
  rateLimitState: 'UNKNOWN' | 'OK' | 'RATE_LIMITED';
  cacheWritable: boolean;
  executionImpact: 'NONE';
}

export type Gate2DartEvaluationFinancials = DartFinancials | QmpDartFinancials;
const DART_BASE = 'https://opendart.fss.or.kr/api';

function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

function cleanSymbol(symbol: string): string {
  return String(symbol || '').replace(/[^0-9]/g, '').slice(0, 6).padStart(6, '0');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.replace(/,/g, '').replace(/%/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function toDartAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/,/g, '').replace(/%/g, '').replace(/\+/g, '').trim();
  if (!cleaned || cleaned === '-' || cleaned.toUpperCase() === 'N/A') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function newTrace(symbol: string): Gate2ExternalRefreshTrace {
  const normalizedSymbol = cleanSymbol(symbol);
  return {
    symbol: normalizedSymbol,
    symbolNormalized: normalizedSymbol,
    lookupKey: normalizedSymbol,
    corpCodeResolveStatus: 'CACHE_MISSING',
    corpCodeMissingReason: 'DART_CORP_CODE_CACHE_NOT_LOADED',
    fiscalPeriodStatus: 'NONE',
    corpCodeRequestAttempted: false,
    dartRequestAttempted: false,
    dartRawRows: 0,
    normalizedRows: 0,
    derivedMetricsComputed: false,
    kisPerRequestAttempted: false,
    perNormalized: null,
    perSource: 'NONE',
    perReason: 'PER_MISSING',
    epsComputed: null,
    currentPrice: null,
    listedShares: null,
    dartEpsComputed: false,
    perComputedFromPriceAndEps: false,
    perCacheHit: false,
    finalConfidence: 'MISSING',
    unavailableConditions: ['earnings_quality', 'per', 'roe', 'opm', 'icr'],
    executionImpact: 'NONE',
  };
}

function responseStatusCode(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const status = payload.status ?? payload.rt_cd;
  return typeof status === 'string' ? status : status == null ? null : String(status);
}

function hasKisValuationCredentials(): boolean {
  return HAS_REAL_DATA_CLIENT || Boolean(process.env.KIS_APP_KEY && process.env.KIS_APP_SECRET);
}

function describeInstrumentType(symbol: string): { instrumentType: string; nonEquity: boolean } {
  const entry = getStockByCode(symbol);
  if (!entry) return { instrumentType: 'UNKNOWN', nonEquity: false };
  const joined = [entry.market, entry.securityType, entry.stockType, entry.department, entry.name]
    .filter(Boolean)
    .join('/');
  const nonEquity = !isTradableKrxEquity(entry)
    || /ETF|ETN|ELW|REIT|SPAC|리츠|스팩|우선주|우선|종류주|기업인수목적/i.test(joined);
  return { instrumentType: joined || entry.market, nonEquity };
}

function classifyCorpCodeMissing(input: {
  symbol: string;
  status: Gate2CorpCodeResolveStatus;
  reason?: string;
}): { instrumentType: string; reason: Gate2CorpCodeMissingReason } {
  const symbol = cleanSymbol(input.symbol);
  const malformed = !/^\d{6}$/.test(symbol) || symbol === '000000';
  if (input.status === 'CACHE_MISSING') {
    return { instrumentType: 'UNKNOWN', reason: 'DART_CORP_CODE_CACHE_NOT_LOADED' };
  }
  if (input.status === 'ERROR' || malformed || input.reason === 'INVALID_SYMBOL') {
    return { instrumentType: 'UNKNOWN', reason: 'DART_CORP_CODE_LOOKUP_FAILED' };
  }
  const instrument = describeInstrumentType(symbol);
  if (instrument.nonEquity) {
    return { instrumentType: instrument.instrumentType, reason: 'DART_NOT_APPLICABLE' };
  }
  return { instrumentType: instrument.instrumentType, reason: 'DART_CORP_CODE_NOT_FOUND' };
}

export function classifyGate2CorpCodeMissingForDiagnostics(input: {
  symbol: string;
  status: Gate2CorpCodeResolveStatus;
  reason?: string;
  instrumentType?: string;
  nonEquity?: boolean;
}): { instrumentType: string; reason: Gate2CorpCodeMissingReason; executionImpact: 'NONE' } {
  if (input.nonEquity === true) {
    return {
      instrumentType: input.instrumentType ?? 'NON_EQUITY',
      reason: 'DART_NOT_APPLICABLE',
      executionImpact: 'NONE',
    };
  }
  return {
    ...classifyCorpCodeMissing(input),
    executionImpact: 'NONE',
  };
}

function applyCorpCodeMissingClassification(trace: Gate2ExternalRefreshTrace): void {
  if (trace.corpCodeResolveStatus === 'FOUND') {
    trace.corpCodeMissingReason = 'NONE';
    if (!trace.instrumentType) trace.instrumentType = describeInstrumentType(trace.symbol).instrumentType;
    return;
  }
  const classified = classifyCorpCodeMissing({
    symbol: trace.symbol,
    status: trace.corpCodeResolveStatus,
    reason: trace.dartErrorCode,
  });
  trace.instrumentType = classified.instrumentType;
  trace.corpCodeMissingReason = classified.reason;
}

async function fetchDartJson(input: string, timeoutMs = 10000): Promise<{ httpStatus: number; body: unknown }> {
  const response = await fetchWithRetry(input, {
    timeoutMs,
    retries: 1,
    callerLabel: 'gate2-dart-financials',
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { httpStatus: response.status, body };
}

function classifyFetchError(error: unknown): { httpStatus?: number; errorCode: string } {
  if (error instanceof FetchRetryError) {
    return {
      httpStatus: error.status ?? undefined,
      errorCode: error.status === 429 ? 'RATE_LIMITED' : error.status ? `HTTP_${error.status}` : 'NETWORK_OR_TIMEOUT',
    };
  }
  return { errorCode: error instanceof Error ? error.name || 'ERROR' : 'ERROR' };
}

async function resolveDartCorpCode(symbol: string, trace: Gate2ExternalRefreshTrace): Promise<string | null> {
  trace.corpCodeRequestAttempted = true;
  try {
    const master = getDartCorpCodeCacheStatus();
    trace.dartHttpStatus = master.lastHttpStatus ?? undefined;
    const resolved = resolveDartCorpCodeFromCache(symbol);
    trace.corpCodeResolveStatus = resolved.status;
    if (resolved.status !== 'FOUND' || !resolved.corpCode) {
      trace.dartErrorCode = resolved.reason;
      applyCorpCodeMissingClassification(trace);
      return null;
    }
    trace.corpCode = resolved.corpCode;
    trace.corpCodeMissingReason = 'NONE';
    trace.instrumentType = describeInstrumentType(symbol).instrumentType;
    return resolved.corpCode;
  } catch (error) {
    const classified = classifyFetchError(error);
    trace.corpCodeResolveStatus = 'ERROR';
    trace.dartHttpStatus = classified.httpStatus;
    trace.dartErrorCode = classified.errorCode;
    applyCorpCodeMissingClassification(trace);
    return null;
  }
}

interface DartReportCandidate {
  fiscalPeriod: string;
  bsnsYear: string;
  reportCode: string;
  quarter: QmpDartFinancials['quarter'];
}

function reportCandidates(now: Date = new Date()): DartReportCandidate[] {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const candidates: DartReportCandidate[] = [];
  if (month >= 11) candidates.push({ fiscalPeriod: `${year}Q3`, bsnsYear: String(year), reportCode: '11014', quarter: 'Q3' });
  if (month >= 8) candidates.push({ fiscalPeriod: `${year}Q2`, bsnsYear: String(year), reportCode: '11012', quarter: 'Q2' });
  if (month >= 5) candidates.push({ fiscalPeriod: `${year}Q1`, bsnsYear: String(year), reportCode: '11013', quarter: 'Q1' });
  if (month >= 4) candidates.push({ fiscalPeriod: `${year - 1}_ANNUAL`, bsnsYear: String(year - 1), reportCode: '11011', quarter: 'ANNUAL' });
  candidates.push({ fiscalPeriod: `${year - 1}_ANNUAL`, bsnsYear: String(year - 1), reportCode: '11011', quarter: 'ANNUAL' });
  candidates.push({ fiscalPeriod: `${year - 2}_ANNUAL`, bsnsYear: String(year - 2), reportCode: '11011', quarter: 'ANNUAL' });
  return candidates.filter((candidate, index, array) =>
    array.findIndex(item => item.fiscalPeriod === candidate.fiscalPeriod && item.reportCode === candidate.reportCode) === index,
  );
}

function rowsFromDartPayload(payload: unknown): Record<string, unknown>[] {
  if (!isRecord(payload)) return [];
  const list = payload.list;
  return Array.isArray(list) ? list.filter(isRecord) : [];
}

function compactKorean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, '').replace(/[()\uFF08\uFF09]/g, '').trim();
}

function extractAccountAmount(rows: readonly Record<string, unknown>[], aliases: readonly string[]): number | null {
  const normalizedAliases = aliases.map(compactKorean);
  for (const alias of aliases) {
    const row = rows.find(item =>
      item.account_id === alias
      || item.accountId === alias
      || normalizedAliases.includes(compactKorean(item.account_nm))
      || normalizedAliases.includes(compactKorean(item.accountName)),
    );
    const value = toDartAmount(row?.thstrm_amount ?? row?.amount ?? row?.value);
    if (value != null) return value;
  }
  return null;
}

function buildRawFinancialFlat(rows: readonly Record<string, unknown>[]): Record<string, unknown> {
  return {
    revenue: extractAccountAmount(rows, [
      'ifrs-full_Revenue',
      'ifrs_Revenue',
      'dart_Revenue',
      '\uB9E4\uCD9C\uC561',
      '\uC601\uC5C5\uC218\uC775',
    ]),
    operatingIncome: extractAccountAmount(rows, [
      'dart_OperatingIncomeLoss',
      'ifrs-full_ProfitLossFromOperatingActivities',
      'ifrs-full_OperatingIncome',
      '\uC601\uC5C5\uC774\uC775',
      '\uC601\uC5C5\uC190\uC775',
    ]),
    netIncome: extractAccountAmount(rows, [
      'ifrs-full_ProfitLoss',
      'ifrs-full_NetProfitLoss',
      'ifrs-full_ProfitLossAttributableToOwnersOfParent',
      '\uB2F9\uAE30\uC21C\uC774\uC775',
      '\uB2F9\uAE30\uC21C\uC190\uC775',
    ]),
    operatingCashFlow: extractAccountAmount(rows, [
      'ifrs-full_CashFlowsFromUsedInOperatingActivities',
      'ifrs-full_CashFlowsFromOperatingActivities',
      '\uC601\uC5C5\uD65C\uB3D9\uD604\uAE08\uD750\uB984',
    ]),
    interestExpense: extractAccountAmount(rows, ['ifrs-full_FinanceCosts', 'ifrs-full_InterestExpense', '\uC774\uC790\uBE44\uC6A9']),
    totalEquity: extractAccountAmount(rows, ['ifrs-full_Equity', 'ifrs-full_EquityAttributableToOwnersOfParent', '\uC790\uBCF8\uCD1D\uACC4']),
    totalAssets: extractAccountAmount(rows, ['ifrs-full_Assets', '\uC790\uC0B0\uCD1D\uACC4']),
    totalDebt: extractAccountAmount(rows, ['ifrs-full_Liabilities', '\uBD80\uCC44\uCD1D\uACC4']),
    currentAssets: extractAccountAmount(rows, ['ifrs-full_CurrentAssets', '\uC720\uB3D9\uC790\uC0B0']),
    currentLiabilities: extractAccountAmount(rows, ['ifrs-full_CurrentLiabilities', '\uC720\uB3D9\uBD80\uCC44']),
  };
}

function normalizeFetchedDartFinancials(input: {
  symbol: string;
  corpCode: string;
  candidate: DartReportCandidate;
  statementType: 'CFS' | 'OFS';
  rows: Record<string, unknown>[];
  asOf: string;
}): Gate2DartEvaluationFinancials {
  const flat = buildRawFinancialFlat(input.rows);
  const normalized = normalizeDartFinancials({
    symbol: input.symbol,
    corpCode: input.corpCode,
    raw: flat,
    fiscalYear: input.candidate.bsnsYear,
    quarter: input.candidate.quarter,
    reportDate: input.candidate.fiscalPeriod,
    fetchedAt: input.asOf,
    providerStatus: 'OK_WITH_DATA',
    source: 'DART',
  });
  return {
    ...normalized,
    fiscalPeriod: input.candidate.fiscalPeriod,
    statementType: input.statementType,
    totalDebt: finiteNumber(flat.totalDebt),
    currentAssets: finiteNumber(flat.currentAssets),
    currentLiabilities: finiteNumber(flat.currentLiabilities),
  } as Gate2DartEvaluationFinancials;
}

export async function fetchDartFinancialsForGate2(input: {
  symbol: string;
  apiKey?: string | null;
  now?: Date;
  asOf?: string;
  skipCorpCodeMasterEnsure?: boolean;
}): Promise<{ dartFin: Gate2DartEvaluationFinancials | null; trace: Gate2ExternalRefreshTrace }> {
  const symbol = cleanSymbol(input.symbol);
  const trace = newTrace(symbol);
  const apiKey = input.apiKey ?? process.env.DART_API_KEY ?? process.env.OPENDART_API_KEY ?? null;
  if (!apiKey) {
    trace.corpCodeResolveStatus = 'CACHE_MISSING';
    trace.dartErrorCode = 'DART_API_KEY_MISSING';
    return { dartFin: null, trace };
  }
  if (!input.skipCorpCodeMasterEnsure) {
    await ensureDartCorpCodeMasterCache({ apiKey, now: input.now });
  }
  const corpCode = await resolveDartCorpCode(symbol, trace);
  if (!corpCode) return { dartFin: null, trace };

  for (const candidate of reportCandidates(input.now)) {
    for (const statementType of ['CFS', 'OFS'] as const) {
      const url = `${DART_BASE}/fnlttSinglAcntAll.json`
        + `?crtfc_key=${encodeURIComponent(apiKey)}`
        + `&corp_code=${encodeURIComponent(corpCode)}`
        + `&bsns_year=${candidate.bsnsYear}`
        + `&reprt_code=${candidate.reportCode}`
        + `&fs_div=${statementType}`;
      trace.dartRequestAttempted = true;
      try {
        const { httpStatus, body } = await fetchDartJson(url, 10000);
        trace.dartHttpStatus = httpStatus;
        const status = responseStatusCode(body);
        if (httpStatus >= 400 || (status && status !== '000' && status !== '0')) {
          trace.dartErrorCode = isRecord(body) ? String(body.message ?? body.msg ?? status ?? `HTTP_${httpStatus}`) : `HTTP_${httpStatus}`;
          continue;
        }
        const rows = rowsFromDartPayload(body);
        trace.dartRawRows += rows.length;
        if (rows.length === 0) continue;
        const dartFin = normalizeFetchedDartFinancials({
          symbol,
          corpCode,
          candidate,
          statementType,
          rows,
          asOf: input.asOf ?? nowIso(input.now),
        });
        trace.fiscalPeriodStatus = 'RESOLVED';
        trace.fiscalPeriod = candidate.fiscalPeriod;
        trace.reportCode = candidate.reportCode;
        trace.statementType = statementType;
        trace.normalizedRows = 1;
        trace.dartErrorCode = undefined;
        return { dartFin, trace };
      } catch (error) {
        const classified = classifyFetchError(error);
        trace.dartHttpStatus = classified.httpStatus;
        trace.dartErrorCode = classified.errorCode;
      }
    }
  }
  trace.fiscalPeriodStatus = trace.dartRequestAttempted ? 'NONE' : 'ERROR';
  return { dartFin: null, trace };
}

export interface Gate2PerValuationResult {
  attempted: boolean;
  per: number | null;
  eps: number | null;
  currentPrice: number | null;
  listedShares: number | null;
  source: Gate2PerValuationSource;
  reason: string;
  raw?: unknown;
  dartEpsComputed: boolean;
  perComputedFromPriceAndEps: boolean;
  perCacheHit: boolean;
}

function emptyPerValuation(reason = 'PER_MISSING', attempted = false): Gate2PerValuationResult {
  return {
    attempted,
    per: null,
    eps: null,
    currentPrice: null,
    listedShares: null,
    source: 'NONE',
    reason,
    dartEpsComputed: false,
    perComputedFromPriceAndEps: false,
    perCacheHit: false,
  };
}

function pickKisValuationOutput(data: unknown): Record<string, unknown> | null {
  if (!isRecord(data)) return null;
  const buckets = [data.output, data.output1, data.output2];
  for (const bucket of buckets) {
    if (isRecord(bucket)) return bucket;
    if (Array.isArray(bucket)) {
      const first = bucket.find(isRecord);
      if (first) return first;
    }
  }
  return null;
}

function firstPositiveNumber(record: Record<string, unknown> | null, keys: readonly string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = finiteNumber(record[key]);
    if (value != null && value > 0) return value;
  }
  return null;
}

function firstFiniteNumber(record: Record<string, unknown> | null, keys: readonly string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = finiteNumber(record[key]);
    if (value != null) return value;
  }
  return null;
}

function sanitizedKisValuationRaw(output: Record<string, unknown> | null): Record<string, unknown> | undefined {
  if (!output) return undefined;
  const keepKeys = [
    'stck_prpr',
    'prpr',
    'per',
    'hts_per',
    'eps',
    'stac_eps',
    'lstn_stcn',
    'hts_avls',
    'pbr',
    'bps',
  ];
  const sanitized: Record<string, unknown> = {};
  for (const key of keepKeys) {
    if (output[key] != null) sanitized[key] = output[key];
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function listedSharesFromMaster(symbol: string): number | null {
  const entry = getStockByCode(cleanSymbol(symbol));
  return typeof entry?.listedShares === 'number' && Number.isFinite(entry.listedShares) && entry.listedShares > 0
    ? entry.listedShares
    : null;
}

function netIncomeFromDartFin(dartFin: Gate2DartEvaluationFinancials | null | undefined): number | null {
  if (!isRecord(dartFin)) return null;
  return finiteNumber(dartFin.netIncome);
}

function sharesFromDartFin(dartFin: Gate2DartEvaluationFinancials | null | undefined): number | null {
  if (!isRecord(dartFin)) return null;
  const shares = finiteNumber(dartFin.sharesOutstanding ?? dartFin.weightedAverageShares ?? dartFin.listedShares);
  return shares != null && shares > 0 ? shares : null;
}

function reasonForMissingPer(input: {
  directPer: number | null;
  currentPrice: number | null;
  kisEps: number | null;
  dartEps: number | null;
  listedShares: number | null;
  output: Record<string, unknown> | null;
}): string {
  if (!input.output) return 'KIS_PER_OUTPUT_MISSING';
  if (input.directPer != null && input.directPer <= 0) return 'PER_NON_POSITIVE_OR_UNAVAILABLE';
  if (input.currentPrice == null || input.currentPrice <= 0) return 'PRICE_MISSING';
  if (input.kisEps != null && input.kisEps <= 0) return 'EPS_NON_POSITIVE';
  if (input.dartEps != null && input.dartEps <= 0) return 'EPS_NON_POSITIVE';
  if (input.kisEps == null && input.dartEps == null) {
    return input.listedShares == null ? 'SHARES_OUTSTANDING_MISSING' : 'EPS_MISSING';
  }
  return 'PER_UNAVAILABLE';
}

export async function fetchGate2PerValuation(input: {
  symbol: string;
  dartFin?: Gate2DartEvaluationFinancials | null;
}): Promise<Gate2PerValuationResult> {
  const symbol = cleanSymbol(input.symbol);
  if (!hasKisValuationCredentials()) return emptyPerValuation('KIS_PER_CONFIG_MISSING', false);
  try {
    const data = await realDataKisGet(
      'FHKST01010100',
      '/uapi/domestic-stock/v1/quotations/inquire-price',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: symbol,
        __kisPurpose: 'GATE2_PER_VALUATION',
      },
      'LOW',
    );
    const output = pickKisValuationOutput(data);
    const raw = sanitizedKisValuationRaw(output);
    const rawDirectPer = firstFiniteNumber(output, ['per', 'PER', 'hts_per', 'HTS_PER']);
    const directPer = rawDirectPer != null && rawDirectPer > 0 ? rawDirectPer : null;
    const currentPrice = firstPositiveNumber(output, ['stck_prpr', 'STCK_PRPR', 'prpr', 'close']);
    const kisEps = firstFiniteNumber(output, ['eps', 'EPS', 'stac_eps', 'STAC_EPS']);
    const listedShares = firstPositiveNumber(output, ['lstn_stcn', 'LSTN_STCN', 'listedShares'])
      ?? sharesFromDartFin(input.dartFin)
      ?? listedSharesFromMaster(symbol);
    if (directPer != null && directPer > 0) {
      return {
        attempted: true,
        per: directPer,
        eps: kisEps,
        currentPrice,
        listedShares,
        source: 'KIS',
        reason: directPer > 30 ? 'PER_TOO_HIGH' : 'PER_ACCEPTABLE',
        raw,
        dartEpsComputed: false,
        perComputedFromPriceAndEps: false,
        perCacheHit: false,
      };
    }
    if (currentPrice != null && currentPrice > 0 && kisEps != null && kisEps > 0) {
      return {
        attempted: true,
        per: currentPrice / kisEps,
        eps: kisEps,
        currentPrice,
        listedShares,
        source: 'KIS',
        reason: 'PER_COMPUTED_FROM_KIS_PRICE_EPS',
        raw,
        dartEpsComputed: false,
        perComputedFromPriceAndEps: true,
        perCacheHit: false,
      };
    }
    const netIncome = netIncomeFromDartFin(input.dartFin);
    const dartEps = netIncome != null && netIncome > 0 && listedShares != null && listedShares > 0
      ? netIncome / listedShares
      : null;
    if (currentPrice != null && currentPrice > 0 && dartEps != null && dartEps > 0) {
      return {
        attempted: true,
        per: currentPrice / dartEps,
        eps: dartEps,
        currentPrice,
        listedShares,
        source: 'DART_EPS_PRICE',
        reason: 'PER_COMPUTED_FROM_DART_EPS_AND_KIS_PRICE',
        raw,
        dartEpsComputed: true,
        perComputedFromPriceAndEps: true,
        perCacheHit: false,
      };
    }
    return {
      ...emptyPerValuation(reasonForMissingPer({
        directPer: rawDirectPer,
        currentPrice,
        kisEps,
        dartEps,
        listedShares,
        output,
      }), true),
      eps: kisEps ?? dartEps,
      currentPrice,
      listedShares,
      source: output ? 'KIS' : 'NONE',
      raw,
      dartEpsComputed: dartEps != null && dartEps > 0,
    };
  } catch (error) {
    return {
      ...emptyPerValuation(error instanceof Error ? `KIS_PER_PROVIDER_ERROR:${error.name}` : 'KIS_PER_PROVIDER_ERROR', true),
      source: 'KIS',
    };
  }
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return numerator / denominator;
}

function normalizeConfidence(value: unknown, fallback: Gate2FinancialConfidence): Gate2FinancialConfidence {
  const raw = String(value ?? '').toUpperCase();
  if (raw === 'VERIFIED') return 'VERIFIED';
  if (raw === 'STALE' || raw === 'STALE_VALID') return 'STALE';
  if (raw === 'DEGRADED' || raw === 'PARTIAL') return 'DEGRADED';
  if (raw === 'MISSING') return 'MISSING';
  return fallback;
}

function snapshotSourceFrom(value: unknown, fallback: Gate2FinancialSource): Gate2FinancialSource {
  const raw = String(value ?? '').toUpperCase();
  if (raw.includes('CACHE')) return 'CACHE';
  if (raw.includes('DART')) return 'DART';
  if (raw === 'NONE') return 'NONE';
  return fallback;
}

export function buildMissingGate2FinancialSnapshot(
  symbol: string,
  reason = 'DART_FINANCIALS_MISSING',
  asOf: string = nowIso(),
): Gate2FinancialSnapshot {
  return {
    symbol: cleanSymbol(symbol),
    corpCode: null,
    fiscalPeriod: null,
    statementType: 'UNKNOWN',
    revenue: null,
    operatingProfit: null,
    netIncome: null,
    operatingCashFlow: null,
    equity: null,
    totalAssets: null,
    totalDebt: null,
    interestExpense: null,
    currentAssets: null,
    currentLiabilities: null,
    source: 'NONE',
    confidence: 'MISSING',
    lastUpdated: asOf,
    rawStatus: reason,
    normalizedStatus: 'MISSING',
    providerIssue: reason !== 'NO_DATA_EXPECTED',
    marketSignal: false,
    executionImpact: 'NONE',
  };
}

export function buildGate2FinancialSnapshotFromDartFin(
  symbol: string,
  dartFin: Gate2DartEvaluationFinancials | null | undefined,
  asOf: string = nowIso(),
): Gate2FinancialSnapshot {
  if (!dartFin) return buildMissingGate2FinancialSnapshot(symbol, 'DART_FINANCIALS_MISSING', asOf);
  const record = dartFin as unknown as Record<string, unknown>;
  const qmpLike = 'dataConfidence' in record || 'providerStatus' in record || 'operatingCashFlow' in record;
  const source = snapshotSourceFrom(record.source, 'DART');
  const confidence = normalizeConfidence(record.dataConfidence ?? record.confidence, qmpLike ? 'DEGRADED' : 'VERIFIED');
  const rawStatus = String(record.providerStatus ?? record.rawStatus ?? (confidence === 'VERIFIED' ? 'OK_WITH_DATA' : confidence));
  const fiscalPeriod = String(record.fiscalPeriod ?? record.fiscalYear ?? record.year ?? record.reportDate ?? '').trim() || null;
  return {
    symbol: cleanSymbol(String(record.symbol ?? symbol)),
    corpCode: typeof record.corpCode === 'string' ? record.corpCode : null,
    fiscalPeriod,
    statementType: String(record.statementType ?? '').toUpperCase() === 'OFS' ? 'OFS' : qmpLike ? 'CFS' : 'UNKNOWN',
    revenue: finiteNumber(record.revenue),
    operatingProfit: finiteNumber(record.operatingProfit ?? record.operatingIncome),
    netIncome: finiteNumber(record.netIncome),
    operatingCashFlow: finiteNumber(record.operatingCashFlow),
    equity: finiteNumber(record.equity ?? record.totalEquity),
    totalAssets: finiteNumber(record.totalAssets),
    totalDebt: finiteNumber(record.totalDebt),
    interestExpense: finiteNumber(record.interestExpense),
    currentAssets: finiteNumber(record.currentAssets),
    currentLiabilities: finiteNumber(record.currentLiabilities),
    source,
    confidence,
    lastUpdated: String(record.lastUpdated ?? record.fetchedAt ?? asOf),
    rawStatus,
    normalizedStatus: confidence,
    providerIssue: record.providerIssue === true || ['DEGRADED', 'MISSING'].includes(confidence),
    marketSignal: false,
    executionImpact: 'NONE',
  };
}

export function calculateGate2DerivedMetrics(input: {
  snapshot: Gate2FinancialSnapshot;
  dartFin?: Gate2DartEvaluationFinancials | null;
  per?: number | null;
}): Gate2DerivedMetrics {
  const record: Record<string, unknown> = isRecord(input.dartFin) ? input.dartFin : {};
  const snapshot = input.snapshot;
  const roe = finiteNumber(record.roe) ?? ratio(snapshot.netIncome, snapshot.equity);
  const opm = finiteNumber(record.opm) ?? ratio(snapshot.operatingProfit, snapshot.revenue);
  const ocfRatio = finiteNumber(record.ocfRatio) ?? ratio(snapshot.operatingCashFlow, snapshot.netIncome);
  const netMargin = ratio(snapshot.netIncome, snapshot.revenue);
  const debtRatio = finiteNumber(record.debtRatio) ?? ratio(snapshot.totalDebt, snapshot.equity);
  const currentRatio = ratio(snapshot.currentAssets, snapshot.currentLiabilities);
  const icr = finiteNumber(record.interestCoverageRatio) ?? ratio(snapshot.operatingProfit, snapshot.interestExpense);
  const opmYoYAcceleration = finiteNumber(record.marginAcceleration ?? record.opmYoYDelta);
  return {
    per: input.per ?? null,
    roe,
    opm,
    netMargin,
    icr,
    debtRatio,
    currentRatio,
    earningsQualityScore: ocfRatio,
    ocfGreaterThanNetIncome: ocfRatio == null ? null : ocfRatio >= 1,
    opmYoYAcceleration,
  };
}

function projectMetric(
  value: number | null,
  source: Gate2FinancialSource | 'KIS' | 'DART' | 'CACHE' | 'NONE',
  pass: (value: number) => boolean,
  unavailableReason: string,
  failReason: string,
): Gate2ProjectedCondition {
  if (value == null) {
    return { status: 'UNAVAILABLE', value: null, source: 'NONE', reason: unavailableReason, executionImpact: 'NONE' };
  }
  return {
    status: pass(value) ? 'PASS' : 'FAIL',
    value,
    source,
    reason: pass(value) ? 'NONE' : failReason,
    executionImpact: 'NONE',
  };
}

function projectPer(
  value: number | null,
  source: Gate2ProjectedCondition['source'] = 'KIS',
  unavailableReason = 'PER_MISSING',
): Gate2ProjectedCondition {
  if (value == null) {
    return {
      status: 'UNAVAILABLE',
      value: null,
      source: source === 'NONE' ? 'NONE' : source,
      reason: unavailableReason,
      executionImpact: 'NONE',
    };
  }
  if (value <= 0) {
    return { status: 'UNAVAILABLE', value: null, source, reason: 'PER_NON_POSITIVE_OR_UNAVAILABLE', executionImpact: 'NONE' };
  }
  if (value > 30) {
    return { status: 'FAIL', value, source, reason: 'PER_TOO_HIGH', executionImpact: 'NONE' };
  }
  return { status: 'PASS', value, source, reason: 'PER_ACCEPTABLE', executionImpact: 'NONE' };
}

function conditionPerSource(source?: Gate2PerValuationSource): Gate2ProjectedCondition['source'] {
  if (source === 'DART_EPS_PRICE') return 'DART';
  if (source === 'CACHE') return 'CACHE';
  if (source === 'KIS') return 'KIS';
  return 'NONE';
}

export function buildGate2ExternalProjection(input: {
  symbol: string;
  dartFin?: Gate2DartEvaluationFinancials | null;
  financialSnapshot?: Gate2FinancialSnapshot | null;
  per?: number | null;
  perSource?: Gate2PerValuationSource;
  perReason?: string;
  quote?: unknown;
  asOf?: string;
  refreshTrace?: Gate2ExternalRefreshTrace;
}): Gate2ExternalProjection {
  const asOf = input.asOf ?? nowIso();
  const quoteRecord = isRecord(input.quote) ? input.quote : {};
  const per = input.per ?? finiteNumber(quoteRecord.per ?? quoteRecord.trailingPE ?? quoteRecord.forwardPE);
  const financialSnapshot = input.financialSnapshot
    ?? buildGate2FinancialSnapshotFromDartFin(input.symbol, input.dartFin, asOf);
  const metrics = calculateGate2DerivedMetrics({ snapshot: financialSnapshot, dartFin: input.dartFin, per });
  const source = financialSnapshot.source;
  const perConditionSource = input.perSource ? conditionPerSource(input.perSource) : metrics.per != null ? 'KIS' : 'NONE';
  const earningsQuality = projectMetric(
    metrics.earningsQualityScore,
    source,
    value => value >= 1,
    'EARNINGS_QUALITY_UNAVAILABLE',
    'OCF_BELOW_NET_INCOME',
  );
  const conditions = {
    earnings_quality: earningsQuality,
    per: projectPer(metrics.per, perConditionSource, input.perReason ?? 'PER_MISSING'),
    roe: projectMetric(metrics.roe, source, value => value > 0, 'ROE_UNAVAILABLE', 'ROE_NOT_POSITIVE'),
    opm: projectMetric(metrics.opm, source, value => value > 0, 'OPM_UNAVAILABLE', 'OPM_NOT_POSITIVE'),
    icr: projectMetric(metrics.icr, source, value => value >= 1, 'ICR_UNAVAILABLE', 'ICR_BELOW_1'),
  };
  const unavailableCount = Object.values(conditions).filter(condition => condition.status === 'UNAVAILABLE').length;
  const highConvictionImpact = unavailableCount > 0 || Object.values(conditions).some(condition => condition.status === 'FAIL')
    ? 'BLOCK_STRONG_BUY_UPGRADE'
    : 'NONE';
  const refreshTrace = input.refreshTrace
    ? {
      ...input.refreshTrace,
      perNormalized: metrics.per,
      derivedMetricsComputed: Object.values(conditions).some(condition => condition.status !== 'UNAVAILABLE'),
      finalConfidence: (financialSnapshot.confidence === 'STALE' ? 'STALE' : financialSnapshot.confidence === 'VERIFIED' ? 'VERIFIED' : 'MISSING') as Gate2ExternalRefreshTrace['finalConfidence'],
      unavailableConditions: Object.entries(conditions)
        .filter(([, condition]) => condition.status === 'UNAVAILABLE')
        .map(([key]) => key),
      executionImpact: 'NONE' as const,
    }
    : undefined;
  return {
    symbol: cleanSymbol(input.symbol),
    asOf,
    financialSnapshot,
    metrics,
    valuation: {
      per: {
        ...conditions.per,
        per: metrics.per,
      },
    },
    profitability: {
      roe: metrics.roe,
      opm: metrics.opm,
      netMargin: metrics.netMargin,
      source,
    },
    stability: {
      icr: metrics.icr,
      debtRatio: metrics.debtRatio,
      currentRatio: metrics.currentRatio,
      source,
    },
    earningsQuality: {
      status: conditions.earnings_quality.status,
      score: metrics.earningsQualityScore,
      reason: conditions.earnings_quality.reason,
      source,
      executionImpact: 'NONE',
    },
    conditionResults: conditions,
    ...(refreshTrace ? { refreshTrace } : {}),
    unavailableCount,
    highConvictionImpact,
    entryHardBlockImpact: 'NO',
    shadowObservablePreserved: true,
    counterfactualAllowed: true,
    executionImpact: 'NONE',
  };
}

export function projectionToQmpDartFinancials(projection: Gate2ExternalProjection): QmpDartFinancials {
  const snapshot = projection.financialSnapshot;
  const metrics = projection.metrics;
  return {
    symbol: snapshot.symbol,
    corpCode: snapshot.corpCode,
    reportDate: snapshot.lastUpdated,
    fiscalYear: snapshot.fiscalPeriod ?? undefined,
    quarter: 'UNKNOWN',
    revenue: snapshot.revenue,
    operatingIncome: snapshot.operatingProfit,
    netIncome: snapshot.netIncome,
    operatingCashFlow: snapshot.operatingCashFlow,
    interestExpense: snapshot.interestExpense,
    totalEquity: snapshot.equity,
    totalAssets: snapshot.totalAssets,
    ocfRatio: metrics.earningsQualityScore,
    roe: metrics.roe,
    opm: metrics.opm,
    opmYoYDelta: metrics.opmYoYAcceleration,
    revenueYoYGrowth: null,
    operatingIncomeYoYGrowth: null,
    marginAcceleration: metrics.opmYoYAcceleration,
    interestCoverageRatio: metrics.icr,
    source: snapshot.source === 'CACHE' ? 'QMP_CACHE' : snapshot.source === 'DART' ? 'DART' : 'UNKNOWN',
    providerStatus: snapshot.confidence === 'VERIFIED' ? 'OK_WITH_DATA' : snapshot.confidence === 'STALE' ? 'STALE_CACHE' : 'FIELD_MISSING',
    dataConfidence: snapshot.confidence,
    providerIssue: snapshot.providerIssue,
    marketSignal: false,
    executionImpact: 'DIAGNOSTIC_ONLY',
    rawFieldCoverage: {
      requiredFields: ['operatingCashFlow', 'netIncome'],
      presentFields: ['operatingCashFlow', 'netIncome'].filter(field => {
        return field === 'operatingCashFlow' ? snapshot.operatingCashFlow != null : snapshot.netIncome != null;
      }),
      missingFields: ['operatingCashFlow', 'netIncome'].filter(field => {
        return field === 'operatingCashFlow' ? snapshot.operatingCashFlow == null : snapshot.netIncome == null;
      }),
      allRequiredFieldsPresent: snapshot.operatingCashFlow != null && snapshot.netIncome != null,
    },
    fetchedAt: snapshot.lastUpdated,
  };
}

export async function getGate2DartFinancialsForEvaluation(symbol: string): Promise<Gate2DartEvaluationFinancials | null> {
  const cached = getGate2ExternalCacheRecord(symbol);
  if (cached?.projection?.financialSnapshot?.confidence && cached.projection.financialSnapshot.confidence !== 'MISSING') {
    return projectionToQmpDartFinancials(cached.projection);
  }
  const dartFin = await getDartFinancials(symbol).catch(() => null);
  if (!dartFin) return null;
  const projection = buildGate2ExternalProjection({ symbol, dartFin });
  upsertGate2ExternalCacheRecords([{ symbol: cleanSymbol(symbol), projection, updatedAt: projection.asOf }]);
  return dartFin;
}

function emptyCounters(): Gate2ExternalRefreshCounters {
  return {
    providerRequestsAttempted: 0,
    corpCodeResolved: 0,
    corpCodeMissing: 0,
    dartNotApplicableCount: 0,
    trueCorpCodeNotFound: 0,
    corpCodeLookupFailed: 0,
    fiscalPeriodResolved: 0,
    fiscalPeriodMissing: 0,
    dartResponsesOk: 0,
    dartResponsesError: 0,
    dartRowsFetched: 0,
    normalizedRowsBuilt: 0,
    derivedMetricsComputed: 0,
    kisPerAttempted: 0,
    kisPerAvailable: 0,
    kisPerUnavailable: 0,
    dartEpsComputed: 0,
    perComputedFromPriceAndEps: 0,
    perCacheHit: 0,
    unavailableDueToPER: 0,
    unavailableDueToCorpCodeMissing: 0,
    unavailableDueToFiscalPeriodMissing: 0,
    unavailableDueToFinancialRowsEmpty: 0,
    unavailableDueToNormalizationFailed: 0,
    unavailableCountRaw: 0,
    unavailableCountActionable: 0,
    unavailableExcludingExcluded: 0,
    excludedCount: 0,
    excludedUnavailableEquivalent: 0,
  };
}

function summarizeCounters(traces: readonly Gate2ExternalRefreshTrace[]): Gate2ExternalRefreshCounters {
  const counters = emptyCounters();
  for (const trace of traces) {
    if (trace.corpCodeRequestAttempted) counters.providerRequestsAttempted += 1;
    if (trace.dartRequestAttempted) counters.providerRequestsAttempted += 1;
    if (trace.corpCodeResolveStatus === 'FOUND') counters.corpCodeResolved += 1;
    if (trace.corpCodeResolveStatus !== 'FOUND') counters.corpCodeMissing += 1;
    if (trace.corpCodeMissingReason === 'DART_NOT_APPLICABLE') counters.dartNotApplicableCount += 1;
    if (trace.corpCodeMissingReason === 'DART_CORP_CODE_NOT_FOUND') counters.trueCorpCodeNotFound += 1;
    if (trace.corpCodeMissingReason === 'DART_CORP_CODE_LOOKUP_FAILED') counters.corpCodeLookupFailed += 1;
    if (trace.fiscalPeriodStatus === 'RESOLVED') counters.fiscalPeriodResolved += 1;
    if (trace.fiscalPeriodStatus !== 'RESOLVED') counters.fiscalPeriodMissing += 1;
    if (trace.dartRequestAttempted && trace.dartErrorCode == null && trace.dartRawRows > 0) counters.dartResponsesOk += 1;
    if (trace.dartRequestAttempted && (trace.dartErrorCode != null || trace.dartRawRows === 0)) counters.dartResponsesError += 1;
    counters.dartRowsFetched += trace.dartRawRows;
    counters.normalizedRowsBuilt += trace.normalizedRows;
    if (trace.derivedMetricsComputed) counters.derivedMetricsComputed += 1;
    if (trace.kisPerRequestAttempted) counters.kisPerAttempted += 1;
    if (trace.dartEpsComputed) counters.dartEpsComputed += 1;
    if (trace.perComputedFromPriceAndEps) counters.perComputedFromPriceAndEps += 1;
    if (trace.perCacheHit) counters.perCacheHit += 1;
    if (trace.perNormalized != null && trace.perNormalized > 0) counters.kisPerAvailable += 1;
    else if (trace.corpCodeResolveStatus === 'FOUND' || trace.kisPerRequestAttempted || trace.perSource === 'KIS') counters.kisPerUnavailable += 1;

    const unavailableCount = trace.unavailableConditions.length;
    counters.unavailableCountRaw += unavailableCount;
    if (trace.corpCodeMissingReason === 'DART_NOT_APPLICABLE') {
      counters.excludedCount += 1;
      counters.excludedUnavailableEquivalent += unavailableCount;
      continue;
    }
    if (unavailableCount === 0) continue;
    if (trace.corpCodeResolveStatus !== 'FOUND') {
      counters.unavailableDueToCorpCodeMissing += unavailableCount;
      continue;
    }
    if (trace.fiscalPeriodStatus !== 'RESOLVED') {
      counters.unavailableDueToFiscalPeriodMissing += unavailableCount;
      continue;
    }
    if (trace.dartRequestAttempted && trace.dartRawRows === 0) {
      counters.unavailableDueToFinancialRowsEmpty += unavailableCount;
      continue;
    }
    if (trace.dartRawRows > 0 && trace.normalizedRows === 0) {
      counters.unavailableDueToNormalizationFailed += unavailableCount;
      continue;
    }
    if (trace.unavailableConditions.includes('per')) counters.unavailableDueToPER += 1;
  }
  counters.unavailableExcludingExcluded = Math.max(0, counters.unavailableCountRaw - counters.excludedUnavailableEquivalent);
  counters.unavailableCountActionable = counters.unavailableDueToPER
    + counters.unavailableDueToCorpCodeMissing
    + counters.unavailableDueToFiscalPeriodMissing
    + counters.unavailableDueToFinancialRowsEmpty
    + counters.unavailableDueToNormalizationFailed;
  return counters;
}

function inferRootCause(input: {
  symbols: readonly string[];
  counters: Gate2ExternalRefreshCounters;
  apiKeyPresent: boolean;
  corpCodeCacheLoaded: boolean;
  missingCount: number;
}): Gate2ExternalRootCause {
  if (!input.apiKeyPresent) return 'DART_API_KEY_MISSING';
  if (input.counters.trueCorpCodeNotFound > 0 && input.counters.corpCodeResolved > 0) {
    return 'PARTIAL_CORP_CODE_NOT_FOUND';
  }
  if (
    input.counters.corpCodeMissing > 0
    && input.counters.dartNotApplicableCount === input.counters.corpCodeMissing
    && input.counters.trueCorpCodeNotFound === 0
    && input.counters.corpCodeLookupFailed === 0
  ) {
    return 'DART_NOT_APPLICABLE_ONLY';
  }
  if (input.missingCount === 0 && input.counters.unavailableDueToPER > 0) return 'PER_PARTIAL_UNAVAILABLE';
  if (input.missingCount === 0) return 'NONE';
  if (input.counters.corpCodeMissing > 0 && input.counters.corpCodeMissing === input.missingCount) {
    return input.corpCodeCacheLoaded ? 'DART_CORP_CODE_NOT_FOUND' : 'DART_CORP_CODE_CACHE_NOT_LOADED';
  }
  if (input.counters.corpCodeResolved === 0 && input.symbols.length > 0) {
    return input.corpCodeCacheLoaded ? 'DART_CORP_CODE_NOT_FOUND' : 'DART_CORP_CODE_CACHE_NOT_LOADED';
  }
  if (input.counters.corpCodeResolved > 0 && input.counters.fiscalPeriodResolved === 0) return 'DART_FISCAL_PERIOD_RESOLVE_FAILED';
  if (input.counters.dartResponsesOk === 0 && input.counters.providerRequestsAttempted > 0) return 'DART_FINANCIAL_HTTP_ERROR';
  if (input.counters.dartRowsFetched === 0 && input.counters.dartResponsesOk > 0) return 'DART_FINANCIAL_ROWS_EMPTY';
  if (input.counters.dartRowsFetched > 0 && input.counters.normalizedRowsBuilt === 0) return 'DART_FINANCIAL_NORMALIZATION_FAILED';
  if (input.counters.normalizedRowsBuilt > 0 && input.counters.derivedMetricsComputed === 0) return 'GATE2_DERIVED_METRICS_FAILED';
  return 'DART_FINANCIALS_MISSING';
}

function uniqueSymbolsByTrace(
  traces: readonly Gate2ExternalRefreshTrace[],
  predicate: (trace: Gate2ExternalRefreshTrace) => boolean,
): string[] {
  return [...new Set(traces.filter(predicate).map(trace => trace.symbol))];
}

function buildStrongBuyBlockedDetails(
  counters: Gate2ExternalRefreshCounters,
): string {
  const parts: string[] = [];
  if (counters.unavailableDueToPER > 0) parts.push(`PER_UNAVAILABLE_${counters.unavailableDueToPER}`);
  if (counters.trueCorpCodeNotFound > 0) parts.push(`TRUE_CORP_CODE_NOT_FOUND_${counters.trueCorpCodeNotFound}`);
  if (counters.corpCodeLookupFailed > 0) parts.push(`CORP_CODE_LOOKUP_FAILED_${counters.corpCodeLookupFailed}`);
  if (counters.unavailableDueToFiscalPeriodMissing > 0) parts.push(`FISCAL_PERIOD_MISSING_${counters.unavailableDueToFiscalPeriodMissing}`);
  if (counters.unavailableDueToFinancialRowsEmpty > 0) parts.push(`FINANCIAL_ROWS_EMPTY_${counters.unavailableDueToFinancialRowsEmpty}`);
  if (counters.unavailableDueToNormalizationFailed > 0) parts.push(`NORMALIZATION_FAILED_${counters.unavailableDueToNormalizationFailed}`);
  return parts.length > 0 ? parts.join('|') : 'NONE';
}

function buildExcludedDetails(counters: Gate2ExternalRefreshCounters): string {
  return counters.dartNotApplicableCount > 0 ? `DART_NOT_APPLICABLE_${counters.dartNotApplicableCount}` : 'NONE';
}

export function getGate2DartProviderHealth(): Gate2DartProviderHealth {
  const apiKeyPresent = Boolean(process.env.DART_API_KEY || process.env.OPENDART_API_KEY);
  const cache = loadGate2ExternalCache();
  const corpCodeStatus = getDartCorpCodeCacheStatus();
  const lastRefresh = cache.lastRefresh;
  const cacheWritable = isGate2ExternalCacheWritable();
  const traces = lastRefresh?.traces ?? [];
  const lastTraceWithHttp = [...traces].reverse().find(trace => trace.dartHttpStatus != null || trace.dartErrorCode != null);
  return {
    apiKeyPresent,
    corpCodeCacheLoaded: corpCodeStatus.corpCodeCacheLoaded,
    corpCodeCacheCount: corpCodeStatus.corpCodeCacheCount,
    lastCorpCodeCacheUpdatedAt: corpCodeStatus.loadedAt,
    requestEnabled: apiKeyPresent,
    lastHttpStatus: lastTraceWithHttp?.dartHttpStatus ?? corpCodeStatus.lastHttpStatus,
    lastErrorCode: lastTraceWithHttp?.dartErrorCode ?? corpCodeStatus.lastError,
    rateLimitState: traces.some(trace => trace.dartErrorCode === 'RATE_LIMITED' || trace.dartHttpStatus === 429) ? 'RATE_LIMITED' : traces.length > 0 ? 'OK' : 'UNKNOWN',
    cacheWritable,
    executionImpact: 'NONE',
  };
}

export async function refreshGate2ExternalData(input: {
  symbols: readonly string[];
  fetcher?: (symbol: string) => Promise<Gate2DartEvaluationFinancials | null>;
  perFetcher?: (symbol: string, dartFin: Gate2DartEvaluationFinancials | null) => Promise<Gate2PerValuationResult>;
  now?: Date;
}): Promise<Gate2ExternalRefreshResult> {
  const asOf = nowIso(input.now);
  const symbols = [...new Set(input.symbols.map(cleanSymbol).filter(symbol => /^\d{6}$/.test(symbol)))];
  const records: Gate2ExternalProjection[] = [];
  const traces: Gate2ExternalRefreshTrace[] = [];
  const apiKey = process.env.DART_API_KEY || process.env.OPENDART_API_KEY || null;
  if (!input.fetcher && apiKey) {
    await ensureDartCorpCodeMasterCache({ apiKey, now: input.now });
  }
  for (const symbol of symbols) {
    let dartFin: Gate2DartEvaluationFinancials | null = null;
    let trace = newTrace(symbol);
    if (input.fetcher) {
      trace.corpCodeRequestAttempted = true;
      trace.dartRequestAttempted = true;
      try {
        dartFin = await input.fetcher(symbol);
      } catch {
        dartFin = null;
        trace.dartErrorCode = 'FETCHER_ERROR';
      }
      if (dartFin) {
        trace.corpCodeResolveStatus = 'FOUND';
        trace.corpCodeMissingReason = 'NONE';
        trace.instrumentType = describeInstrumentType(symbol).instrumentType;
        trace.fiscalPeriodStatus = 'RESOLVED';
        trace.dartRawRows = 1;
        trace.normalizedRows = 1;
      } else {
        applyCorpCodeMissingClassification(trace);
      }
    } else {
      const fetched = await fetchDartFinancialsForGate2({
        symbol,
        now: input.now,
        asOf,
        skipCorpCodeMasterEnsure: true,
      });
      dartFin = fetched.dartFin;
      trace = fetched.trace;
    }
    const perValuation = dartFin
      ? input.perFetcher
        ? await input.perFetcher(symbol, dartFin)
        : input.fetcher
          ? emptyPerValuation('PER_MISSING', false)
          : await fetchGate2PerValuation({ symbol, dartFin })
      : emptyPerValuation(trace.corpCodeResolveStatus === 'FOUND' ? 'PER_MISSING' : 'PER_SKIPPED_DART_FINANCIALS_MISSING', false);
    trace.kisPerRequestAttempted = perValuation.attempted;
    trace.kisPerRaw = perValuation.raw;
    trace.perNormalized = perValuation.per;
    trace.perSource = perValuation.source;
    trace.perReason = perValuation.reason;
    trace.epsComputed = perValuation.eps;
    trace.currentPrice = perValuation.currentPrice;
    trace.listedShares = perValuation.listedShares;
    trace.dartEpsComputed = perValuation.dartEpsComputed;
    trace.perComputedFromPriceAndEps = perValuation.perComputedFromPriceAndEps;
    trace.perCacheHit = perValuation.perCacheHit;
    const projection = buildGate2ExternalProjection({
      symbol,
      dartFin,
      per: perValuation.per,
      perSource: perValuation.source,
      perReason: perValuation.reason,
      financialSnapshot: dartFin
        ? undefined
        : buildMissingGate2FinancialSnapshot(
          symbol,
          process.env.DART_API_KEY || process.env.OPENDART_API_KEY ? 'DART_FINANCIALS_MISSING' : 'DART_API_KEY_MISSING',
          asOf,
        ),
      asOf,
      refreshTrace: trace,
    });
    if (projection.refreshTrace) traces.push(projection.refreshTrace);
    else traces.push(trace);
    records.push(projection);
  }
  upsertGate2ExternalCacheRecords(records.map(projection => ({
    symbol: projection.symbol,
    projection,
    updatedAt: asOf,
  })));
  const verifiedCount = records.filter(row => row.financialSnapshot.confidence === 'VERIFIED').length;
  const staleCount = records.filter(row => row.financialSnapshot.confidence === 'STALE').length;
  const missingCount = records.filter(row => row.financialSnapshot.confidence === 'MISSING').length;
  const unavailableCount = records.reduce((sum, row) => sum + row.unavailableCount, 0);
  const counters = summarizeCounters(traces);
  const providerHealth = getGate2DartProviderHealth();
  const apiKeyPresent = Boolean(process.env.DART_API_KEY || process.env.OPENDART_API_KEY) || Boolean(input.fetcher);
  const finalProviderHealth: Gate2DartProviderHealth = {
    ...providerHealth,
    apiKeyPresent,
    requestEnabled: apiKeyPresent,
    lastHttpStatus: [...traces].reverse().find(trace => trace.dartHttpStatus != null)?.dartHttpStatus
      ?? providerHealth.lastHttpStatus,
    lastErrorCode: [...traces].reverse().find(trace => trace.dartErrorCode != null)?.dartErrorCode ?? providerHealth.lastErrorCode,
    rateLimitState: traces.some(trace => trace.dartErrorCode === 'RATE_LIMITED' || trace.dartHttpStatus === 429) ? 'RATE_LIMITED' : traces.length > 0 ? 'OK' : providerHealth.rateLimitState,
  };
  const rootCause = inferRootCause({
    symbols,
    counters,
    apiKeyPresent,
    corpCodeCacheLoaded: finalProviderHealth.corpCodeCacheLoaded,
    missingCount,
  });
  const strongBuyBlockedDetails = buildStrongBuyBlockedDetails(counters);
  const excludedDetails = buildExcludedDetails(counters);
  const strongBuyBlockedReason = counters.unavailableCountActionable === 0
    ? 'NONE'
    : missingCount === records.length
      ? 'DART_FINANCIALS_MISSING'
      : 'GATE2_EXTERNAL_PARTIAL';
  const corpCodeMissingSymbols = uniqueSymbolsByTrace(traces, trace => trace.corpCodeResolveStatus !== 'FOUND');
  const dartNotApplicableSymbols = uniqueSymbolsByTrace(traces, trace => trace.corpCodeMissingReason === 'DART_NOT_APPLICABLE');
  const trueCorpCodeNotFoundSymbols = uniqueSymbolsByTrace(traces, trace => trace.corpCodeMissingReason === 'DART_CORP_CODE_NOT_FOUND');
  const corpCodeLookupFailedSymbols = uniqueSymbolsByTrace(traces, trace => trace.corpCodeMissingReason === 'DART_CORP_CODE_LOOKUP_FAILED');
  const nonEquitySymbols = dartNotApplicableSymbols;
  updateGate2ExternalLastRefresh({
    asOf,
    counters,
    rootCause,
    traces,
    providerHealth: finalProviderHealth,
    strongBuyBlockedDetails,
    blockingDetails: strongBuyBlockedDetails,
    excludedDetails,
    excludedCount: counters.excludedCount,
    excludedSymbols: dartNotApplicableSymbols,
    excludedReason: counters.excludedCount > 0 ? 'DART_NOT_APPLICABLE' : 'NONE',
    unavailableCountRaw: counters.unavailableCountRaw,
    unavailableCountActionable: counters.unavailableCountActionable,
    unavailableExcludingExcluded: counters.unavailableExcludingExcluded,
    excludedUnavailableEquivalent: counters.excludedUnavailableEquivalent,
    corpCodeMissingSymbols,
    dartNotApplicableSymbols,
    trueCorpCodeNotFoundSymbols,
    corpCodeLookupFailedSymbols,
    nonEquitySymbols,
  });
  return {
    asOf,
    requestedSymbols: symbols,
    refreshedCount: records.length,
    verifiedCount,
    staleCount,
    missingCount,
    rowsProjected: records.length,
    unavailableCount,
    counters,
    rootCause,
    traces,
    providerHealth: finalProviderHealth,
    strongBuyBlockedReason,
    strongBuyBlockedDetails,
    blockingDetails: strongBuyBlockedDetails,
    excludedDetails,
    excludedCount: counters.excludedCount,
    excludedSymbols: dartNotApplicableSymbols,
    excludedReason: counters.excludedCount > 0 ? 'DART_NOT_APPLICABLE' : 'NONE',
    unavailableCountRaw: counters.unavailableCountRaw,
    unavailableCountActionable: counters.unavailableCountActionable,
    unavailableExcludingExcluded: counters.unavailableExcludingExcluded,
    excludedUnavailableEquivalent: counters.excludedUnavailableEquivalent,
    corpCodeMissingSymbols,
    dartNotApplicableSymbols,
    trueCorpCodeNotFoundSymbols,
    corpCodeLookupFailedSymbols,
    nonEquitySymbols,
    executionImpact: 'NONE',
    records,
  };
}
