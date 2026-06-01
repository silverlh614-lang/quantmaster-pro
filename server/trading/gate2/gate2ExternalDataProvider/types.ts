// @responsibility Gate2 external data provider type contracts: financial snapshot, derived metrics, refresh traces/counters, projection result shapes.

import type { DartFinancials } from '../../../clients/dartFinancialClient.js';
import type { QmpDartFinancials } from '../../../clients/dartFinancialNormalizer.js';

export type Gate2FinancialSource = 'DART' | 'CACHE' | 'NONE';
export type Gate2FinancialConfidence = 'VERIFIED' | 'PARTIAL' | 'DEGRADED' | 'STALE' | 'MISSING';
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

export type Gate2InstrumentClass =
  | 'ETF'
  | 'ETN'
  | 'FUND'
  | 'INDEX_PRODUCT'
  | 'REIT'
  | 'SPAC'
  | 'PREFERRED'
  | 'COMMON_STOCK'
  | 'UNKNOWN';

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
  perFailDueToNegativeEps: number;
  perUnavailableDueToNegativeEps: number;
  perUnavailableDueToProviderMissing: number;
  perUnavailableDueToPriceMissing: number;
  perUnavailableDueToEpsMissing: number;
  perUnavailableDueToNonPositive: number;
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

// §B PER 표시 분류 결과 (값 무변경 — 표시·분류 필드만).
export interface Gate2PerValuationDisplay {
  perStatus: 'AVAILABLE' | 'UNAVAILABLE';
  rawPER: number | null;
  normalizedPER: number | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  highConvictionImpact: 'NONE' | 'BLOCK_STRONG_BUY_UPGRADE';
  entryHardBlockImpact: 'NO';
  executionImpact: 'NONE';
}

// §C DART 데이터 라인 건전성 (condition 단위 분해 — 진단 표시, 시장 신호 아님).
export interface Gate2DartLineHealth {
  status: 'VERIFIED' | 'PARTIAL' | 'DEGRADED' | 'EMPTY_VALID' | 'NOT_ATTEMPTED';
  availableFields: string[];
  missingFields: string[];
  primaryIssue: string;
  providerIssue: boolean;
  marketSignal: false;
  executionImpact: 'NONE';
  // ADR-0532 확장 진단(표시 전용, 값/판정 무변경): KIS L1 재무 머지가 Gate2 에 반영됐는지 가시화.
  // currentRatio 는 DART 정규화가 산출하지 않고 KIS stability-ratio 만 제공하므로, non-null 이면 KIS 머지 적용 신호.
  kisFinance?: {
    financeSource: 'KIS_PRIMARY' | 'DART_OR_DERIVED' | 'UNAVAILABLE';
    kisMergeApplied: boolean;
    debtRatio: number | null;
    currentRatio: number | null;
    roe: number | null;
    opm: number | null;
  };
}

export interface Gate2ExternalProjection {
  symbol: string;
  asOf: string;
  financialSnapshot: Gate2FinancialSnapshot;
  metrics: Gate2DerivedMetrics;
  valuation: {
    per: Gate2ProjectedCondition & { per: number | null } & Gate2PerValuationDisplay;
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
  dartLineHealth: Gate2DartLineHealth;
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
  externalDataBlockReason: 'NONE' | 'DART_FINANCIALS_MISSING' | 'GATE2_EXTERNAL_PARTIAL';
  externalDataBlockedDetails: string;
  fundamentalQualityFailReason: 'NONE' | 'EPS_NON_POSITIVE';
  fundamentalQualityFailDetails: string;
  qualityFailDetails: string;
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
  lastNonBlockingIssue: string | null;
  lastNonBlockingSymbols: string[];
  rateLimitState: 'UNKNOWN' | 'OK' | 'RATE_LIMITED';
  cacheWritable: boolean;
  executionImpact: 'NONE';
}

export type Gate2DartEvaluationFinancials = DartFinancials | QmpDartFinancials;

export interface DartReportCandidate {
  fiscalPeriod: string;
  bsnsYear: string;
  reportCode: string;
  quarter: QmpDartFinancials['quarter'];
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
