// @responsibility Gate2 external financial snapshot, derived metrics, and safe projection helpers.

import { getDartFinancials } from '../../clients/dartFinancialClient.js';
import { getKisFinancials, kisFinancialsToQmpDartFinancials, type KisFinancials } from '../../clients/kisFinanceClient.js';
import { isKisFinancePrimaryEnabled } from './kisFinancePrimaryFlag.js';
import { isGate2DartEvalUnifiedFetchEnabled } from './gate2DartEvalUnifiedFetchFlag.js';
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
import { getStockByCode, isTradableKrxEquity } from '../../persistence/krxStockMasterRepo.js';
// 정본 데이터 SSOT(Gate2 PER dedup, patch): Gate2 PER valuation 엔진(KIS FHKST01010100 추출·판정 + 정본 snapshot quote 재사용) 단일 모듈.
import { emptyPerValuation, fetchGate2PerValuation } from './gate2ExternalDataProvider/perValuation.js';
// 진단 표시 분류 SSOT (값 무변경): PER 표시 + DART 라인 건전성 condition 단위 분해.
import { classifyDartLineHealth, classifyPerValuationDisplay } from './gate2ExternalDataProvider/dataLineClassification.js';

export { fetchGate2PerValuation };

export * from './gate2ExternalDataProvider/types.js';
import type {
  Gate2FinancialSource,
  Gate2FinancialConfidence,
  Gate2FinancialStatementType,
  Gate2ConditionStatus,
  Gate2CorpCodeResolveStatus,
  Gate2FiscalPeriodStatus,
  Gate2PerValuationSource,
  Gate2CorpCodeMissingReason,
  Gate2ExternalRefreshTrace,
  Gate2InstrumentClass,
  Gate2ExternalRefreshCounters,
  Gate2ExternalRootCause,
  Gate2FinancialSnapshot,
  Gate2DerivedMetrics,
  Gate2ProjectedCondition,
  Gate2ExternalProjection,
  Gate2ExternalRefreshResult,
  Gate2DartProviderHealth,
  Gate2DartEvaluationFinancials,
  DartReportCandidate,
  Gate2PerValuationResult,
} from './gate2ExternalDataProvider/types.js';
import {
  cleanSymbol,
  compactKorean,
  finiteNumber,
  isRecord,
  nowIso,
  responseStatusCode,
  toDartAmount,
} from './gate2ExternalDataProvider/helpers.js';

const DART_BASE = 'https://opendart.fss.or.kr/api';

// ── ADR-0662 §2: DART 재무 배치 스로틀 (판정 로직 0줄 — 페이싱·429 백오프 1회·조기 중단만) ──
const DART_BATCH_MIN_INTERVAL_DEFAULT_MS = 300;
const DART_BATCH_MIN_INTERVAL_MAX_MS = 2000;

/** ENV DART_BATCH_MIN_INTERVAL_MS — 기본 300ms(≈3.3req/s, ≤4req/s 계약), 0~2000 클램프. 비수치는 기본값. */
export function resolveDartBatchMinIntervalMs(
  raw: string | undefined = process.env.DART_BATCH_MIN_INTERVAL_MS,
): number {
  if (raw == null || String(raw).trim() === '') return DART_BATCH_MIN_INTERVAL_DEFAULT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DART_BATCH_MIN_INTERVAL_DEFAULT_MS;
  return Math.min(DART_BATCH_MIN_INTERVAL_MAX_MS, Math.max(0, Math.round(parsed)));
}

function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

let _lastDartRequestAt = 0;

/**
 * 모듈 전역 DART 페이서 — fetchDartFinancialsForGate2 의 모든 요청(평가·배치 심볼 루프 공용)에
 * 최소 간격을 적용한다 (refreshGate2ExternalData 심볼 루프도 요청 단위로 페이싱됨). 대기한 ms 반환.
 */
export async function paceDartBatchRequest(deps?: {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  minIntervalMs?: number;
}): Promise<number> {
  const now = deps?.now ?? Date.now;
  const sleep = deps?.sleep ?? sleepMs;
  const interval = deps?.minIntervalMs ?? resolveDartBatchMinIntervalMs();
  if (interval <= 0) {
    _lastDartRequestAt = now();
    return 0;
  }
  const waitMs = Math.max(0, _lastDartRequestAt + interval - now());
  if (waitMs > 0) await sleep(waitMs);
  _lastDartRequestAt = now();
  return waitMs;
}

/** rate-limit 신호: HTTP 429 또는 DART status '020'(사용한도 초과)/'021'(분당 한도 초과). */
function isDartRateLimitSignal(httpStatus: number | undefined, body: unknown): boolean {
  if (httpStatus === 429) return true;
  const status = responseStatusCode(body);
  return status === '020' || status === '021';
}

/** 429 백오프 1회 대기 — 최소 간격 ×4 (기본 1200ms). 간격 0(운영자 명시 비활성)이면 0. */
function dartRateLimitBackoffMs(): number {
  return resolveDartBatchMinIntervalMs() * 4;
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

function inferInstrumentClassFromText(value: string): Gate2InstrumentClass {
  const upper = value.toUpperCase();
  if (/(ETF|KODEX|TIGER|ACE|KOSEF|KBSTAR|ARIRANG|HANARO|TIMEFOLIO|RISE|PLUS|FOCUS|KINDEX)/.test(upper)) return 'ETF';
  if (/ETN/.test(upper)) return 'ETN';
  if (/(FUND|펀드|투자신탁|신탁)/i.test(value)) return 'FUND';
  if (/(INDEX_PRODUCT|INDEX PRODUCT|인덱스|지수상품)/i.test(value)) return 'INDEX_PRODUCT';
  if (/(REIT|리츠)/i.test(value)) return 'REIT';
  if (/(SPAC|스팩|기업인수목적)/i.test(value)) return 'SPAC';
  if (/(PREFERRED|우선주|종류주|우$|우B|우C|1우|2우|3우)/i.test(value)) return 'PREFERRED';
  return 'UNKNOWN';
}

function isNonEquityInstrumentClass(value: Gate2InstrumentClass): boolean {
  return ['ETF', 'ETN', 'FUND', 'INDEX_PRODUCT', 'REIT', 'SPAC', 'PREFERRED'].includes(value);
}

function isPreferredInstrumentType(value: string | undefined): boolean {
  return inferInstrumentClassFromText(value ?? '') === 'PREFERRED';
}

function parentCommonSymbolCandidate(symbol: string): string | null {
  const cleaned = cleanSymbol(symbol);
  if (!/^\d{6}$/.test(cleaned) || cleaned.endsWith('0')) return null;
  return `${cleaned.slice(0, 5)}0`;
}

function describeKnownInstrumentSymbol(symbol: string): { instrumentType: string; nonEquity: boolean } {
  const knownIndexProductSymbols = new Set([
    '069500', // KODEX 200
    '102110', // TIGER 200
    '133690', // TIGER 미국나스닥100
    '153130', // KODEX 단기채권
    '229200', // KODEX 코스닥150
  ]);
  if (knownIndexProductSymbols.has(cleanSymbol(symbol))) {
    return { instrumentType: 'KIS_METADATA/ETF_OR_INDEX_PRODUCT', nonEquity: true };
  }
  return { instrumentType: 'UNKNOWN', nonEquity: false };
}

function describeInstrumentType(symbol: string): { instrumentType: string; nonEquity: boolean } {
  const entry = getStockByCode(symbol);
  if (!entry) return describeKnownInstrumentSymbol(symbol);
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
  if (input.nonEquity === true || isNonEquityInstrumentClass(inferInstrumentClassFromText(input.instrumentType ?? ''))) {
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
      const instrument = describeInstrumentType(symbol);
      let missingReason = resolved.reason;
      const parentSymbol = isPreferredInstrumentType(instrument.instrumentType)
        ? parentCommonSymbolCandidate(symbol)
        : null;
      if (parentSymbol) {
        const parentResolved = resolveDartCorpCodeFromCache(parentSymbol);
        if (parentResolved.status === 'FOUND' && parentResolved.corpCode) {
          trace.lookupKey = parentSymbol;
          trace.corpCodeResolveStatus = 'FOUND';
          trace.corpCode = parentResolved.corpCode;
          trace.corpCodeMissingReason = 'NONE';
          trace.instrumentType = `${instrument.instrumentType}|PREFERRED_PARENT_COMMON:${parentSymbol}`;
          return parentResolved.corpCode;
        }
        missingReason = parentResolved.reason ?? 'PREFERRED_PARENT_COMMON_NOT_FOUND';
      }
      trace.dartErrorCode = missingReason;
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

  // ADR-0662 §2: 429/DART 020·021 감지 시 백오프 1회 후 동일 요청 재시도, 재차 제한이면 잔여 보고서
  // 후보 조기 중단(early-abort) — 실패 누적으로 DEGRADED 를 증폭시키지 않는다. 판정 로직 무변경.
  let rateLimitBackoffUsed = false;
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
        await paceDartBatchRequest(); // ADR-0662 §2 요청 간 최소 간격 (기본 300ms · ENV DART_BATCH_MIN_INTERVAL_MS)
        let { httpStatus, body } = await fetchDartJson(url, 10000);
        if (isDartRateLimitSignal(httpStatus, body) && !rateLimitBackoffUsed) {
          rateLimitBackoffUsed = true;
          await sleepMs(dartRateLimitBackoffMs());
          await paceDartBatchRequest();
          ({ httpStatus, body } = await fetchDartJson(url, 10000));
        }
        if (isDartRateLimitSignal(httpStatus, body)) {
          // 백오프 후에도 rate-limit — 잔여 후보 조기 중단 (trace 기록: silent 아님, provider 장애 ≠ market signal).
          trace.dartHttpStatus = httpStatus;
          trace.dartErrorCode = 'RATE_LIMITED';
          trace.fiscalPeriodStatus = 'NONE';
          return { dartFin: null, trace };
        }
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
        /* SDS-ignore: classifyFetchError → trace.dartHttpStatus/dartErrorCode 진단 trace 에 기록한다 (silent 아님). */
        const classified = classifyFetchError(error);
        trace.dartHttpStatus = classified.httpStatus;
        trace.dartErrorCode = classified.errorCode;
        if (classified.errorCode === 'RATE_LIMITED') {
          // ADR-0662 §2: throw 경로(FetchRetryError 429)도 백오프 1회 관용 후 재차 제한이면 조기 중단.
          if (rateLimitBackoffUsed) {
            trace.fiscalPeriodStatus = 'NONE';
            return { dartFin: null, trace };
          }
          rateLimitBackoffUsed = true;
          await sleepMs(dartRateLimitBackoffMs());
        }
      }
    }
  }
  trace.fiscalPeriodStatus = trace.dartRequestAttempted ? 'NONE' : 'ERROR';
  return { dartFin: null, trace };
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

function buildGate2FinancialSnapshotFromDartFin(
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

function calculateGate2DerivedMetrics(input: {
  snapshot: Gate2FinancialSnapshot;
  dartFin?: Gate2DartEvaluationFinancials | null;
  per?: number | null;
}): Gate2DerivedMetrics {
  const record: Record<string, unknown> = isRecord(input.dartFin) ? input.dartFin : {};
  const snapshot = input.snapshot;
  const roe = finiteNumber(record.roe) ?? ratio(snapshot.netIncome, snapshot.equity);
  const opm = finiteNumber(record.opm) ?? ratio(snapshot.operatingProfit, snapshot.revenue);
  // ADR-0662 §1: ocfToNi(OCF/NI 배수 명시 필드)-first — 부재(레거시/기존 배치 레코드) 시 기존 식 그대로 = byte-equivalent.
  const ocfToNi = finiteNumber(record.ocfToNi) ?? null;
  const ocfRatio = finiteNumber(record.ocfRatio) ?? ratio(snapshot.operatingCashFlow, snapshot.netIncome);
  const earningsQualityScore = ocfToNi ?? ocfRatio;
  const netMargin = ratio(snapshot.netIncome, snapshot.revenue);
  const debtRatio = finiteNumber(record.debtRatio) ?? ratio(snapshot.totalDebt, snapshot.equity);
  const currentRatio = finiteNumber(record.currentRatio) ?? ratio(snapshot.currentAssets, snapshot.currentLiabilities);
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
    earningsQualityScore,
    ocfGreaterThanNetIncome: earningsQualityScore == null ? null : earningsQualityScore >= 1,
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
    if (unavailableReason === 'EPS_NON_POSITIVE') {
      return {
        status: 'FAIL',
        value: null,
        source: source === 'NONE' ? 'KIS' : source,
        reason: 'EPS_NON_POSITIVE',
        executionImpact: 'NONE',
      };
    }
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
  const perDisplay = classifyPerValuationDisplay({
    perCondition: conditions.per,
    metricsPer: metrics.per,
    perSource: input.perSource,
    perReason: input.perReason,
    highConvictionImpact,
  });
  const dartLineHealth = classifyDartLineHealth({ metrics, refreshTrace });
  return {
    symbol: cleanSymbol(input.symbol),
    asOf,
    financialSnapshot,
    metrics,
    valuation: {
      per: {
        ...conditions.per,
        per: metrics.per,
        ...perDisplay,
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
    dartLineHealth,
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
  // ADR-0662 §4.4 cache-hit 단위 정합: unified ON 시 ocfRatio 는 snapshot raw 에서 OCF/매출×100(%) 재산출하고,
  // 배수(earningsQualityScore=OCF/NI)는 ocfToNi 로 분리 운반 — 배수를 % 임계 evaluator 입력으로 전달하던
  // 현행 잠복 오독을 봉인한다. OFF(default) = 기존 라인 byte-무변경 (byte-equivalent 원칙 우선).
  const unifiedFetch = isGate2DartEvalUnifiedFetchEnabled();
  const ocfToSalesPct = snapshot.operatingCashFlow != null && snapshot.revenue != null && snapshot.revenue !== 0
    ? (snapshot.operatingCashFlow / snapshot.revenue) * 100
    : null;
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
    ocfRatio: unifiedFetch ? ocfToSalesPct : metrics.earningsQualityScore,
    ...(unifiedFetch ? { ocfToNi: metrics.earningsQualityScore } : {}),
    roe: metrics.roe,
    opm: metrics.opm,
    debtRatio: metrics.debtRatio,
    currentRatio: metrics.currentRatio,
    opmYoYDelta: metrics.opmYoYAcceleration,
    revenueYoYGrowth: null,
    operatingIncomeYoYGrowth: null,
    marginAcceleration: metrics.opmYoYAcceleration,
    interestCoverageRatio: metrics.icr,
    source: snapshot.source === 'CACHE' ? 'QMP_CACHE' : snapshot.source === 'DART' ? 'DART' : 'UNKNOWN',
    providerStatus: snapshot.confidence === 'VERIFIED' ? 'OK_WITH_DATA' : snapshot.confidence === 'STALE' ? 'STALE_CACHE' : 'FIELD_MISSING',
    // PARTIAL 은 Gate2 내부 진단 라벨 — QmpDartFinancials 계약(DartFinancialConfidence)은 PARTIAL 미보유이므로
    // 기존 normalizeConfidence 규약과 동일하게 DEGRADED 로 투영한다 (값/판정 영향 없음, 표시 보존).
    dataConfidence: snapshot.confidence === 'PARTIAL' ? 'DEGRADED' : snapshot.confidence,
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

/**
 * ADR-0532 Phase 3: KIS L1 재무를 1차로, KIS 미가용 축(OCF/ICR/raw)만 DART 잔존에서 머지.
 * roe/opm/매출/순이익은 KIS(명시 필드 → calculateGate2DerivedMetrics 가 우선 소비), ocfRatio/icr 는 DART.
 */
function mergeKisPrimaryWithDartResidual(
  kisFin: KisFinancials,
  dartFin: Gate2DartEvaluationFinancials | null,
): Gate2DartEvaluationFinancials {
  const kisQmp = kisFinancialsToQmpDartFinancials(kisFin);
  const dartRec = isRecord(dartFin) ? (dartFin as Record<string, unknown>) : {};
  return {
    ...kisQmp,
    ocfRatio: finiteNumber(dartRec.ocfRatio) ?? kisQmp.ocfRatio,
    operatingCashFlow: finiteNumber(dartRec.operatingCashFlow) ?? kisQmp.operatingCashFlow,
    interestExpense: finiteNumber(dartRec.interestExpense) ?? kisQmp.interestExpense,
    interestCoverageRatio: finiteNumber(dartRec.interestCoverageRatio) ?? kisQmp.interestCoverageRatio,
    // ADR-0662 additive carry: kisQmp 는 ocfToNi 미보유(clobber 없음). 부재 시 null — 소비자는 ?? fallback 이라 behavior 무변경.
    ocfToNi: finiteNumber(dartRec.ocfToNi) ?? null,
  };
}

/** ADR-0662 §1 단위 계약: 모듈 B(ocfRatio=OCF/NI 배수)를 evaluator 계약(ocfRatio=OCF/매출 %)으로 정규화.
 *  ocfToNi(배수)는 명시 필드로 분리 운반. icr(interestCoverageRatio)·raw 필드는 pass-through. */
function toEvaluatorContractDartFin(
  dartFin: Gate2DartEvaluationFinancials | null,
): Gate2DartEvaluationFinancials | null {
  if (!dartFin) return null;
  const rec = dartFin as unknown as Record<string, unknown>;
  const revenue = finiteNumber(rec.revenue);
  const ocf = finiteNumber(rec.operatingCashFlow);
  const ni = finiteNumber(rec.netIncome);
  return {
    ...dartFin,
    // 동결 계약: OCF/매출 × 100 (%). 결손 시 null — OCF/NI 배수로 fallback 금지 (스케일 붕괴 방지).
    ocfRatio: ocf != null && revenue != null && revenue !== 0 ? (ocf / revenue) * 100 : null,
    // 신규 명시 필드: OCF/NI (배수). 모듈 B ocfRatio 원값(=safeRatio(OCF,NI)) 또는 raw 재산출.
    ocfToNi: finiteNumber(rec.ocfToNi) ?? (ocf != null && ni != null && ni !== 0 ? ocf / ni : null),
  } as Gate2DartEvaluationFinancials;
}

export async function getGate2DartFinancialsForEvaluation(symbol: string): Promise<Gate2DartEvaluationFinancials | null> {
  const flagOn = isKisFinancePrimaryEnabled();
  const unifiedFetch = isGate2DartEvalUnifiedFetchEnabled();
  const cached = getGate2ExternalCacheRecord(symbol);
  if (cached?.projection?.financialSnapshot?.confidence && cached.projection.financialSnapshot.confidence !== 'MISSING') {
    // ADR-0532 Phase 3 cache-hit gap: flag-on 시, PER 미보유(legacy DART-only) 캐시는 신뢰하지 않고
    // KIS-primary 로 1회 재산출한다(재산출 후 PER 보유 projection 으로 re-cache → 이후 정상 cache-hit).
    // 추가(ADR-0532 진단 self-heal): dartLineHealth.kisFinance 진단필드 미보유(진단 추가 전 구 projection)
    // 캐시도 신뢰하지 않고 1회 재산출 → 재산출 시 classifyDartLineHealth 가 kisFinance 를 채워 re-cache.
    // flag-off 는 항상 cache-hit → byte-equivalent.
    const cacheTrustedUnderFlag =
      cached.projection.valuation?.per?.per != null
      && cached.projection.dartLineHealth?.kisFinance != null
      // ADR-0662 §4.6 cache self-heal: unified ON 시 레거시 평가 경로가 심어둔 캐시(raw 필드 부재 →
      // statementType 'UNKNOWN' → ICR 영구 null)를 1회 재산출. unified OFF 는 단락으로 기존과 byte-equivalent.
      && (!unifiedFetch || cached.projection.financialSnapshot.statementType !== 'UNKNOWN');
    if (!flagOn || cacheTrustedUnderFlag) {
      return projectionToQmpDartFinancials(cached.projection);
    }
  }
  // ADR-0662 §1: unified ON 시 DART leg 를 모듈 B(fetchDartFinancialsForGate2) + evaluator 경계 단위
  // 어댑터로 교체 — ICR/ocfToNi 실값 유입. OFF(default) = 레거시 getDartFinancials byte-equivalent.
  // 실패/null 은 graceful null (providerIssue 경로 기존과 동일 — 불변식 6: marketSignal=false).
  const dartFin = unifiedFetch
    ? toEvaluatorContractDartFin(
      (await fetchDartFinancialsForGate2({ symbol }).catch(() => ({ dartFin: null }))).dartFin,
    )
    : await getDartFinancials(symbol).catch(() => null);
  // ADR-0532 Phase 2+3: KIS_FINANCE_PRIMARY_ENABLED 시 KIS L1 재무(ROE/OPM/매출/순이익)를 1차 소스로,
  // PER 는 KIS inquire-price 로, OCF/ICR 만 DART 잔존에서 머지한다 → cache projection 에 주입.
  // KIS 실패 시 DART(기존 경로) fallback. flag-off 시 byte-equivalent(DART null→null, KIS fetch 0). executionImpact=NONE.
  if (flagOn) {
    const kisFin = await getKisFinancials(symbol).catch(() => null);
    const primaryFin = kisFin ? mergeKisPrimaryWithDartResidual(kisFin, dartFin) : dartFin;
    const perValuation = await fetchGate2PerValuation({ symbol, dartFin: primaryFin }).catch(
      () => emptyPerValuation('KIS_PER_PROVIDER_ERROR', true),
    );
    const projection = buildGate2ExternalProjection({
      symbol,
      dartFin: primaryFin,
      per: perValuation.per,
      perSource: perValuation.source,
      perReason: perValuation.reason,
    });
    upsertGate2ExternalCacheRecords([{ symbol: cleanSymbol(symbol), projection, updatedAt: projection.asOf }]);
    return primaryFin;
  }
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
    perFailDueToNegativeEps: 0,
    perUnavailableDueToNegativeEps: 0,
    perUnavailableDueToProviderMissing: 0,
    perUnavailableDueToPriceMissing: 0,
    perUnavailableDueToEpsMissing: 0,
    perUnavailableDueToNonPositive: 0,
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

function perUnavailableBucket(reason: string | undefined): 'NEGATIVE_EPS' | 'PROVIDER_MISSING' | 'PRICE_MISSING' | 'EPS_MISSING' | 'NON_POSITIVE_PER' {
  const normalized = String(reason ?? '').toUpperCase();
  if (normalized === 'EPS_NON_POSITIVE') return 'NEGATIVE_EPS';
  if (normalized === 'PRICE_MISSING') return 'PRICE_MISSING';
  if (normalized === 'EPS_MISSING' || normalized === 'SHARES_OUTSTANDING_MISSING') return 'EPS_MISSING';
  if (normalized === 'PER_NON_POSITIVE_OR_UNAVAILABLE') return 'NON_POSITIVE_PER';
  return 'PROVIDER_MISSING';
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
    const shouldCountPer = trace.corpCodeResolveStatus === 'FOUND' || trace.kisPerRequestAttempted || trace.perSource === 'KIS';
    if (trace.perNormalized != null && trace.perNormalized > 0) counters.kisPerAvailable += 1;
    else if (shouldCountPer) {
      counters.kisPerUnavailable += 1;
      switch (perUnavailableBucket(trace.perReason)) {
        case 'NEGATIVE_EPS':
          counters.perFailDueToNegativeEps += 1;
          counters.perUnavailableDueToNegativeEps += 1;
          break;
        case 'PRICE_MISSING':
          counters.perUnavailableDueToPriceMissing += 1;
          break;
        case 'EPS_MISSING':
          counters.perUnavailableDueToEpsMissing += 1;
          break;
        case 'NON_POSITIVE_PER':
          counters.perUnavailableDueToNonPositive += 1;
          break;
        default:
          counters.perUnavailableDueToProviderMissing += 1;
          break;
      }
    }

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
    if (trace.unavailableConditions.includes('per') && perUnavailableBucket(trace.perReason) !== 'NEGATIVE_EPS') {
      counters.unavailableDueToPER += 1;
    }
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

function buildExternalDataBlockedDetails(
  counters: Gate2ExternalRefreshCounters,
): string {
  const parts: string[] = [];
  if (counters.perUnavailableDueToProviderMissing > 0) parts.push(`PER_PROVIDER_MISSING_${counters.perUnavailableDueToProviderMissing}`);
  if (counters.perUnavailableDueToPriceMissing > 0) parts.push(`PER_PRICE_MISSING_${counters.perUnavailableDueToPriceMissing}`);
  if (counters.perUnavailableDueToEpsMissing > 0) parts.push(`EPS_MISSING_${counters.perUnavailableDueToEpsMissing}`);
  if (counters.perUnavailableDueToNonPositive > 0) parts.push(`PER_NON_POSITIVE_${counters.perUnavailableDueToNonPositive}`);
  if (
    counters.unavailableDueToPER > 0
    && counters.perUnavailableDueToProviderMissing
      + counters.perUnavailableDueToPriceMissing
      + counters.perUnavailableDueToEpsMissing
      + counters.perUnavailableDueToNonPositive === 0
  ) {
    parts.push(`PER_PROVIDER_MISSING_${counters.unavailableDueToPER}`);
  }
  if (counters.trueCorpCodeNotFound > 0) parts.push(`TRUE_CORP_CODE_NOT_FOUND_${counters.trueCorpCodeNotFound}`);
  if (counters.corpCodeLookupFailed > 0) parts.push(`CORP_CODE_LOOKUP_FAILED_${counters.corpCodeLookupFailed}`);
  if (counters.unavailableDueToFiscalPeriodMissing > 0) parts.push(`FISCAL_PERIOD_MISSING_${counters.unavailableDueToFiscalPeriodMissing}`);
  if (counters.unavailableDueToFinancialRowsEmpty > 0) parts.push(`FINANCIAL_ROWS_EMPTY_${counters.unavailableDueToFinancialRowsEmpty}`);
  if (counters.unavailableDueToNormalizationFailed > 0) parts.push(`NORMALIZATION_FAILED_${counters.unavailableDueToNormalizationFailed}`);
  return parts.length > 0 ? parts.join('|') : 'NONE';
}

function buildFundamentalQualityFailDetails(
  counters: Gate2ExternalRefreshCounters,
): string {
  const parts: string[] = [];
  if (counters.perFailDueToNegativeEps > 0) parts.push(`EPS_NON_POSITIVE_${counters.perFailDueToNegativeEps}`);
  return parts.length > 0 ? parts.join('|') : 'NONE';
}

function fundamentalQualityFailReason(
  details: string,
): 'NONE' | 'EPS_NON_POSITIVE' {
  return details.includes('EPS_NON_POSITIVE') ? 'EPS_NON_POSITIVE' : 'NONE';
}

function buildExcludedDetails(counters: Gate2ExternalRefreshCounters): string {
  return counters.dartNotApplicableCount > 0 ? `DART_NOT_APPLICABLE_${counters.dartNotApplicableCount}` : 'NONE';
}

function isBlockingTraceError(trace: Gate2ExternalRefreshTrace): boolean {
  if (!trace.dartErrorCode) return false;
  if (trace.corpCodeMissingReason === 'DART_NOT_APPLICABLE') return false;
  return true;
}

function nonBlockingIssueFromLastRefresh(
  lastRefresh: { rootCause?: Gate2ExternalRootCause; counters?: Gate2ExternalRefreshCounters } | undefined,
): string | null {
  if (lastRefresh?.rootCause === 'DART_NOT_APPLICABLE_ONLY') return 'DART_NOT_APPLICABLE_ONLY';
  if ((lastRefresh?.counters?.dartNotApplicableCount ?? 0) > 0) return 'DART_NOT_APPLICABLE';
  if ((lastRefresh?.counters?.perFailDueToNegativeEps ?? 0) > 0) return 'EPS_NON_POSITIVE';
  return null;
}

function nonBlockingSymbolsFromTraces(traces: readonly Gate2ExternalRefreshTrace[]): string[] {
  return uniqueSymbolsByTrace(
    traces,
    trace => trace.corpCodeMissingReason === 'DART_NOT_APPLICABLE',
  );
}

export function getGate2DartProviderHealth(): Gate2DartProviderHealth {
  const apiKeyPresent = Boolean(process.env.DART_API_KEY || process.env.OPENDART_API_KEY);
  const cache = loadGate2ExternalCache();
  const corpCodeStatus = getDartCorpCodeCacheStatus();
  const lastRefresh = cache.lastRefresh;
  const cacheWritable = isGate2ExternalCacheWritable();
  const traces = lastRefresh?.traces ?? [];
  const lastTraceWithHttp = [...traces].reverse().find(trace => trace.dartHttpStatus != null || trace.dartErrorCode != null);
  const lastBlockingTraceWithError = [...traces].reverse().find(isBlockingTraceError);
  const lastNonBlockingIssue = nonBlockingIssueFromLastRefresh(lastRefresh);
  const lastNonBlockingSymbols = nonBlockingSymbolsFromTraces(traces);
  return {
    apiKeyPresent,
    corpCodeCacheLoaded: corpCodeStatus.corpCodeCacheLoaded,
    corpCodeCacheCount: corpCodeStatus.corpCodeCacheCount,
    lastCorpCodeCacheUpdatedAt: corpCodeStatus.loadedAt,
    requestEnabled: apiKeyPresent,
    lastHttpStatus: lastTraceWithHttp?.dartHttpStatus ?? corpCodeStatus.lastHttpStatus,
    lastErrorCode: lastBlockingTraceWithError?.dartErrorCode ?? (lastNonBlockingIssue ? null : corpCodeStatus.lastError),
    lastNonBlockingIssue,
    lastNonBlockingSymbols,
    rateLimitState: traces.some(trace => trace.dartErrorCode === 'RATE_LIMITED' || trace.dartHttpStatus === 429) ? 'RATE_LIMITED' : traces.length > 0 ? 'OK' : 'UNKNOWN',
    cacheWritable,
    executionImpact: 'NONE',
  };
}

export async function refreshGate2ExternalData(input: {
  symbols: readonly string[];
  fetcher?: (symbol: string) => Promise<Gate2DartEvaluationFinancials | null>;
  perFetcher?: (symbol: string, dartFin: Gate2DartEvaluationFinancials | null) => Promise<Gate2PerValuationResult>;
  /**
   * 정본 데이터 SSOT(Gate2 PER dedup, patch): 정본 SourceSnapshot quote(동일 FHKST01010100) per/eps/listedShares/currentPrice 맵.
   * 제공 시 fetchGate2PerValuation 이 재호출을 skip 하고 이 값을 재사용한다 (없으면 기존 재호출 fallback).
   */
  snapshotQuotes?: Record<string, {
    per?: number | null;
    eps?: number | null;
    listedShares?: number | null;
    currentPrice?: number | null;
  } | null | undefined>;
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
    // ADR-0532 Phase 3 fallback: KIS_FINANCE_PRIMARY_ENABLED=true 시 DART 재무 미가용(dartFin=null)이어도
    // KIS inquire-price(FHKST01010100)에서 PER 를 독립적으로 가져와 per=UNAVAILABLE 차단.
    // custom fetcher/perFetcher 경로는 그대로 유지 (테스트 하네스 byte-equivalent). executionImpact=NONE.
    const kisPrimaryEnabled = isKisFinancePrimaryEnabled();
    // ADR-0532 확장: batch refresh 경로도 KIS L1 재무(roe/opm/debtRatio/currentRatio/YoY)를 1차로 머지한다
    // (직전엔 eval 경로 getGate2DartFinancialsForEvaluation 에만 머지가 있어 batch-populated 캐시는 DART-only 였다).
    // OCF/ICR 은 DART 잔여(mergeKisPrimaryWithDartResidual 가 보존). flag-off/custom fetcher 시 byte-equivalent.
    if (kisPrimaryEnabled && !input.fetcher) {
      const kisFin = await getKisFinancials(symbol).catch(() => null);
      if (kisFin) dartFin = mergeKisPrimaryWithDartResidual(kisFin, dartFin);
    }
    const perValuation = dartFin
      ? input.perFetcher
        ? await input.perFetcher(symbol, dartFin)
        : input.fetcher
          ? emptyPerValuation('PER_MISSING', false)
          : await fetchGate2PerValuation({ symbol, dartFin, snapshotQuote: input.snapshotQuotes?.[symbol] ?? null })
      : kisPrimaryEnabled && !input.perFetcher && !input.fetcher
        ? await fetchGate2PerValuation({ symbol, dartFin: null, snapshotQuote: input.snapshotQuotes?.[symbol] ?? null }).catch(
          () => emptyPerValuation('KIS_PER_PROVIDER_ERROR', true),
        )
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
  const lastBlockingTraceWithError = [...traces].reverse().find(isBlockingTraceError);
  const lastNonBlockingIssue = counters.dartNotApplicableCount > 0
    ? counters.dartNotApplicableCount === counters.corpCodeMissing && counters.trueCorpCodeNotFound === 0 && counters.corpCodeLookupFailed === 0
      ? 'DART_NOT_APPLICABLE_ONLY'
      : 'DART_NOT_APPLICABLE'
    : counters.perFailDueToNegativeEps > 0
      ? 'EPS_NON_POSITIVE'
      : null;
  const lastNonBlockingSymbols = nonBlockingSymbolsFromTraces(traces);
  const finalProviderHealth: Gate2DartProviderHealth = {
    ...providerHealth,
    apiKeyPresent,
    requestEnabled: apiKeyPresent,
    lastHttpStatus: [...traces].reverse().find(trace => trace.dartHttpStatus != null)?.dartHttpStatus
      ?? providerHealth.lastHttpStatus,
    lastErrorCode: lastBlockingTraceWithError?.dartErrorCode ?? (lastNonBlockingIssue ? null : providerHealth.lastErrorCode),
    lastNonBlockingIssue,
    lastNonBlockingSymbols,
    rateLimitState: traces.some(trace => trace.dartErrorCode === 'RATE_LIMITED' || trace.dartHttpStatus === 429) ? 'RATE_LIMITED' : traces.length > 0 ? 'OK' : providerHealth.rateLimitState,
  };
  const rootCause = inferRootCause({
    symbols,
    counters,
    apiKeyPresent,
    corpCodeCacheLoaded: finalProviderHealth.corpCodeCacheLoaded,
    missingCount,
  });
  const externalDataBlockedDetails = buildExternalDataBlockedDetails(counters);
  const fundamentalQualityFailDetails = buildFundamentalQualityFailDetails(counters);
  const fundamentalQualityReason = fundamentalQualityFailReason(fundamentalQualityFailDetails);
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
    dartNotApplicable: counters.dartNotApplicableCount,
    trueCorpCodeNotFound: counters.trueCorpCodeNotFound,
    lookupFailed: counters.corpCodeLookupFailed,
    unavailableDueToPER: counters.unavailableDueToPER,
    unavailableDueToCorpCodeMissing: counters.unavailableDueToCorpCodeMissing,
    strongBuyBlockedDetails: externalDataBlockedDetails,
    blockingDetails: externalDataBlockedDetails,
    externalDataBlockReason: strongBuyBlockedReason,
    externalDataBlockedDetails,
    fundamentalQualityFailReason: fundamentalQualityReason,
    fundamentalQualityFailDetails,
    qualityFailDetails: fundamentalQualityFailDetails,
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
    strongBuyBlockedDetails: externalDataBlockedDetails,
    blockingDetails: externalDataBlockedDetails,
    externalDataBlockReason: strongBuyBlockedReason,
    externalDataBlockedDetails,
    fundamentalQualityFailReason: fundamentalQualityReason,
    fundamentalQualityFailDetails,
    qualityFailDetails: fundamentalQualityFailDetails,
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
