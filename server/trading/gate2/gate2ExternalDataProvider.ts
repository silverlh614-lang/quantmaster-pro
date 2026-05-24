// @responsibility Gate2 external financial snapshot, derived metrics, and safe projection helpers.

import type { DartFinancials } from '../../clients/dartFinancialClient.js';
import { getDartFinancials } from '../../clients/dartFinancialClient.js';
import type { QmpDartFinancials } from '../../clients/dartFinancialNormalizer.js';
import { getGate2ExternalCacheRecord, upsertGate2ExternalCacheRecords } from './gate2ExternalCache.js';

export type Gate2FinancialSource = 'DART' | 'CACHE' | 'NONE';
export type Gate2FinancialConfidence = 'VERIFIED' | 'DEGRADED' | 'STALE' | 'MISSING';
export type Gate2FinancialStatementType = 'CFS' | 'OFS' | 'UNKNOWN';
export type Gate2ConditionStatus = 'PASS' | 'FAIL' | 'UNAVAILABLE';

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
  strongBuyBlockedReason: 'NONE' | 'DART_FINANCIALS_MISSING' | 'GATE2_EXTERNAL_PARTIAL';
  executionImpact: 'NONE';
  records: Gate2ExternalProjection[];
}

export type Gate2DartEvaluationFinancials = DartFinancials | QmpDartFinancials;

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

export function buildGate2ExternalProjection(input: {
  symbol: string;
  dartFin?: Gate2DartEvaluationFinancials | null;
  financialSnapshot?: Gate2FinancialSnapshot | null;
  per?: number | null;
  quote?: unknown;
  asOf?: string;
}): Gate2ExternalProjection {
  const asOf = input.asOf ?? nowIso();
  const quoteRecord = isRecord(input.quote) ? input.quote : {};
  const per = input.per ?? finiteNumber(quoteRecord.per ?? quoteRecord.trailingPE ?? quoteRecord.forwardPE);
  const financialSnapshot = input.financialSnapshot
    ?? buildGate2FinancialSnapshotFromDartFin(input.symbol, input.dartFin, asOf);
  const metrics = calculateGate2DerivedMetrics({ snapshot: financialSnapshot, dartFin: input.dartFin, per });
  const source = financialSnapshot.source;
  const earningsQuality = projectMetric(
    metrics.earningsQualityScore,
    source,
    value => value >= 1,
    'EARNINGS_QUALITY_UNAVAILABLE',
    'OCF_BELOW_NET_INCOME',
  );
  const conditions = {
    earnings_quality: earningsQuality,
    per: projectMetric(metrics.per, metrics.per == null ? 'NONE' : 'KIS', value => value > 0 && value <= 30, 'PER_MISSING', 'PER_TOO_HIGH'),
    roe: projectMetric(metrics.roe, source, value => value > 0, 'ROE_UNAVAILABLE', 'ROE_NOT_POSITIVE'),
    opm: projectMetric(metrics.opm, source, value => value > 0, 'OPM_UNAVAILABLE', 'OPM_NOT_POSITIVE'),
    icr: projectMetric(metrics.icr, source, value => value >= 1, 'ICR_UNAVAILABLE', 'ICR_BELOW_1'),
  };
  const unavailableCount = Object.values(conditions).filter(condition => condition.status === 'UNAVAILABLE').length;
  const highConvictionImpact = unavailableCount > 0 || Object.values(conditions).some(condition => condition.status === 'FAIL')
    ? 'BLOCK_STRONG_BUY_UPGRADE'
    : 'NONE';
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

export async function refreshGate2ExternalData(input: {
  symbols: readonly string[];
  fetcher?: (symbol: string) => Promise<Gate2DartEvaluationFinancials | null>;
  now?: Date;
}): Promise<Gate2ExternalRefreshResult> {
  const asOf = nowIso(input.now);
  const symbols = [...new Set(input.symbols.map(cleanSymbol).filter(symbol => /^\d{6}$/.test(symbol)))];
  const fetcher = input.fetcher ?? getDartFinancials;
  const records: Gate2ExternalProjection[] = [];
  for (const symbol of symbols) {
    let dartFin: Gate2DartEvaluationFinancials | null = null;
    try {
      dartFin = process.env.DART_API_KEY || input.fetcher ? await fetcher(symbol) : null;
    } catch {
      dartFin = null;
    }
    const projection = buildGate2ExternalProjection({
      symbol,
      dartFin,
      financialSnapshot: dartFin
        ? undefined
        : buildMissingGate2FinancialSnapshot(symbol, process.env.DART_API_KEY ? 'DART_FINANCIALS_MISSING' : 'DART_API_KEY_MISSING', asOf),
      asOf,
    });
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
  return {
    asOf,
    requestedSymbols: symbols,
    refreshedCount: records.length,
    verifiedCount,
    staleCount,
    missingCount,
    rowsProjected: records.length,
    unavailableCount,
    strongBuyBlockedReason: missingCount === records.length ? 'DART_FINANCIALS_MISSING' : unavailableCount > 0 ? 'GATE2_EXTERNAL_PARTIAL' : 'NONE',
    executionImpact: 'NONE',
    records,
  };
}
