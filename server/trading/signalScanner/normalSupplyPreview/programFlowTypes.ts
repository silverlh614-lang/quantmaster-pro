// @responsibility Program-flow diagnostic type surface for normal supply preview.
import type {
  ProgramFlowForensicNextAction,
  ProgramFlowSessionGuard,
} from '../programFlowSessionGuard.js';

export type ProgramFlowSignal = 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'UNKNOWN' | 'UNAVAILABLE';
export type ProgramFlowSourceProvider = 'KIS_API' | 'KRX_API' | 'KRX_FALLBACK' | 'CACHE' | 'CACHE_STALE' | 'SNAPSHOT' | 'NONE';
export type ProgramFlowStockCarrySource =
  | 'CANDIDATE_CONTEXT'
  | 'LATEST_INTRADAY_PROGRAM_FLOW_SNAPSHOT'
  | 'LATEST_INTRADAY_PROGRAM_SNAPSHOT'
  | 'SUPPLY_SNAPSHOT_CACHE'
  | 'PROGRAM_TRADING_DIAGNOSTIC'
  | 'NONE';
export type ProgramFlowMarketCarrySource =
  | 'PROGRAM_MARKET_CONTEXT'
  | 'LATEST_INTRADAY_MARKET_PROGRAM_SNAPSHOT'
  | 'PROGRAM_MARKET_CACHE'
  | 'NONE';
export type ProgramFlowValueReason =
  | 'PROGRAM_VALUE_PARSE_OK'
  | 'PROGRAM_VALUE_NULL'
  | 'PROGRAM_VALUE_EMPTY'
  | 'PROGRAM_VALUE_NA'
  | 'PROGRAM_VALUE_PLACEHOLDER'
  | 'PROGRAM_VALUE_ZERO'
  | 'PROGRAM_VALUE_NUMERIC_STRING'
  | 'PROGRAM_VALUE_SIGNED_NUMERIC_STRING'
  | 'PROGRAM_VALUE_COMMA_NUMERIC_STRING'
  | 'PROGRAM_VALUE_UNIT_STRING_WON'
  | 'PROGRAM_VALUE_UNIT_STRING_MILLION'
  | 'PROGRAM_VALUE_UNIT_STRING_EOK'
  | 'PROGRAM_VALUE_OBJECT_WRAPPER'
  | 'PROGRAM_VALUE_UNSUPPORTED_FORMAT'
  | 'PROGRAM_VALUE_PARSE_FAILED';
export type ProgramFlowValueRawKind = 'number' | 'string' | 'object' | 'null' | 'undefined' | 'boolean' | 'array' | 'unknown';

export interface ProgramFlowValueNormalizationResult {
  ok: boolean;
  value?: number;
  reason: ProgramFlowValueReason;
  rawKind: ProgramFlowValueRawKind;
  sanitizedSample?: string;
  diagnosticOnly: true;
}

export interface ProgramFlowUpstreamPopulationTrace {
  stockLevel: {
    programNetBuyAmountFieldCreated: boolean;
    programNetBuyAmountNullCount: number;
    programNetBuyAmountNonNullCount: number;
    candidateContextHasField: boolean;
    candidateContextValueNull: boolean;
    snapshotContextFound: boolean;
    snapshotProgramRowsFound: number;
    snapshotProgramRowsWithValue: number;
    cacheContextFound: boolean;
    cacheProgramRowsFound: number;
    cacheProgramRowsWithValue: number;
    programTradingContextFound: boolean;
    programTradingRowsFound: number;
    programTradingRowsWithValue: number;
    carryAttempted: boolean;
    carrySource: ProgramFlowStockCarrySource;
    carrySuccessCount: number;
    carryNullCount: number;
    breakPoint: ProgramFlowStockEvidenceBreakPoint;
  };
  marketLevel: {
    marketProgramNetBuyFieldCreated: boolean;
    marketProgramNetBuyNull: boolean;
    programMarketContextFound: boolean;
    programMarketValueFound: boolean;
    latestIntradayMarketProgramSnapshotFound: boolean;
    latestIntradayMarketProgramValueFound: boolean;
    cacheContextFound: boolean;
    cacheValueFound: boolean;
    carryAttempted: boolean;
    carrySource: ProgramFlowMarketCarrySource;
    breakPoint: ProgramFlowMarketEvidenceBreakPoint;
  };
  providerCallsAdded: 0;
  executionImpact: 'NONE';
}

export type ActivePassiveConfluence =
  | 'ACTIVE_PASSIVE_CONFIRMED_BUY'
  | 'ACTIVE_BUYING_ONLY'
  | 'PASSIVE_BUYING_ONLY'
  | 'ACTIVE_PASSIVE_CONFIRMED_SELL'
  | 'ACTIVE_SELLING_ONLY'
  | 'PASSIVE_SELLING_ONLY'
  | 'MIXED_FLOW'
  | 'NEUTRAL_FLOW'
  | 'PROGRAM_FLOW_UNAVAILABLE';

export type ActivePassiveConfluenceCounts = Record<ActivePassiveConfluence, number>;

export interface ProgramFlowDiagnostic {
  stockLevel: {
    available: boolean;
    netBuy?: number;
    buyAmount?: number;
    sellAmount?: number;
    netAmount?: number;
    signal: ProgramFlowSignal;
    sourceProvider?: ProgramFlowSourceProvider;
    providerIssue: boolean;
    marketSignal: boolean;
    reason?: string;
    valueIssue?: boolean;
    valueReason?: ProgramFlowValueReason;
    sanitizedSample?: string;
    diagnosticOnly: true;
    executionImpact: 'NONE';
  };
  marketLevel: {
    available: boolean;
    kospiNetBuy?: number;
    kosdaqNetBuy?: number;
    combinedNetBuy?: number;
    signal: ProgramFlowSignal;
    sourceProvider?: ProgramFlowSourceProvider;
    providerIssue: boolean;
    marketSignal: boolean;
    reason?: string;
    valueIssue?: boolean;
    valueReason?: ProgramFlowValueReason;
    sanitizedSample?: string;
    diagnosticOnly: true;
    executionImpact: 'NONE';
  };
}

export interface ProgramFlowDryRunDiagnostic {
  currentSupplyScore: number;
  withProgramFlowScore?: number;
  reason: string;
  appliedToLiveScore: false;
  diagnosticOnly: true;
  executionImpact: 'NONE';
}

export type ProgramFlowStockEvidenceResult =
  | 'FIELD_FOUND'
  | 'CONTEXT_FOUND_NO_FIELDS'
  | 'CONTEXT_NOT_FOUND'
  | 'ONLY_NA_VALUES'
  | 'PROVIDER_ISSUE_DIAGNOSTIC_ONLY';

export type ProgramFlowStockEvidenceBreakPoint =
  | 'OK_STOCK_PROGRAM_CONTEXT_WIRED'
  | 'PROGRAM_FLOW_NOT_EXPECTED_MARKET_CLOSED'
  | 'STOCK_PROGRAM_SNAPSHOT_MISSING'
  | 'STOCK_PROGRAM_SNAPSHOT_HAS_NO_VALUES'
  | 'STOCK_PROGRAM_SYMBOL_MATCHING_FAILED'
  | 'STOCK_PROGRAM_CONSUMER_PARSE_FAILED'
  | 'CANDIDATE_CONTEXT_FIELD_CREATED_BUT_NULL'
  | 'PRODUCER_POPULATION_REQUIRED_REGULAR_SESSION'
  | 'CANDIDATE_CONTEXT_MISSING'
  | 'CANDIDATE_PROGRAM_KEYS_MISSING'
  | 'PROGRAM_KEYS_PRESENT_BUT_NON_NUMERIC'
  | 'PROGRAM_FIELD_CREATED_WITH_NULL'
  | 'NORMALIZED_CONTEXT_MISSING'
  | 'SNAPSHOT_CONTEXT_MISSING'
  | 'SNAPSHOT_PROGRAM_ROWS_MISSING'
  | 'SNAPSHOT_PROGRAM_VALUE_NULL'
  | 'CACHE_CONTEXT_MISSING'
  | 'CACHE_PROGRAM_ROWS_MISSING'
  | 'CACHE_PROGRAM_VALUE_NULL'
  | 'PROGRAM_TRADING_CONTEXT_MISSING'
  | 'PROGRAM_TRADING_VALUE_NULL'
  | 'NO_UPSTREAM_PROGRAM_VALUE'
  | 'PROGRAM_VALUE_CARRIED_FROM_SNAPSHOT'
  | 'PROGRAM_VALUE_CARRIED_FROM_CACHE'
  | 'PROGRAM_VALUE_CARRIED_FROM_PROGRAM_TRADING'
  | 'NO_STOCK_LEVEL_PROGRAM_EVIDENCE'
  | 'UNKNOWN';

export type ProgramFlowMarketEvidenceResult =
  | 'FIELD_FOUND'
  | 'CONTEXT_FOUND_NO_FIELDS'
  | 'CONTEXT_NOT_FOUND'
  | 'ONLY_STATUS_NO_NUMERIC'
  | 'SESSION_CLOSED_DIAGNOSTIC_ONLY'
  | 'PROVIDER_ISSUE_DIAGNOSTIC_ONLY';

export type ProgramFlowMarketEvidenceBreakPoint =
  | 'PROGRAM_FLOW_NOT_EXPECTED_MARKET_CLOSED'
  | 'MARKET_PROGRAM_CARRY_PAYLOAD_MISSING'
  | 'MARKET_PROGRAM_CONSUMER_PARSE_FAILED'
  | 'KIS_ACCEPTED_EMPTY_KRX_EMPTY_CACHE_MISS'
  | 'ALL_PROVIDERS_EMPTY'
  | 'MARKET_PROGRAM_UPSTREAM_VALUE_MISSING_REGULAR_SESSION'
  | 'MARKET_PROGRAM_VALUE_CARRIED_DIAGNOSTIC_ONLY'
  | 'MARKET_PROGRAM_FIELD_CREATED_WITH_NULL'
  | 'PROGRAM_TRADING_CONTEXT_MISSING'
  | 'PROGRAM_MARKET_ROUTER_RESULT_MISSING'
  | 'PROGRAM_MARKET_CONTEXT_MISSING'
  | 'PROGRAM_MARKET_VALUE_NULL'
  | 'INTRADAY_MARKET_PROGRAM_SNAPSHOT_MISSING'
  | 'INTRADAY_MARKET_PROGRAM_VALUE_NULL'
  | 'PROGRAM_MARKET_CACHE_MISSING'
  | 'PROGRAM_MARKET_CACHE_VALUE_NULL'
  | 'MARKET_PROGRAM_VALUE_CARRIED_FROM_SNAPSHOT'
  | 'MARKET_PROGRAM_VALUE_CARRIED_FROM_CACHE'
  | 'NO_UPSTREAM_MARKET_PROGRAM_VALUE'
  | 'PROGRAM_CONTEXT_HAS_STATUS_ONLY'
  | 'PROGRAM_CONTEXT_HAS_NO_NUMERIC_FIELDS'
  | 'PROGRAM_CONTEXT_SESSION_CLOSED'
  | 'NO_MARKET_LEVEL_PROGRAM_EVIDENCE'
  | 'UNKNOWN';

export interface ProgramFlowEvidenceTrace {
  contextFound: boolean;
  wiredButNoFields: boolean;
  upstreamPopulation: ProgramFlowUpstreamPopulationTrace;
  stockLevel: {
    candidateFieldScanAttempted: boolean;
    candidateFieldsFound: string[];
    candidateFieldCounts: Record<string, number>;
    candidateRowsWithAnyProgramKey: number;
    candidateRowsWithNumericProgramValue: number;
    candidateRowsWithParsableProgramValue: number;
    valueReasonDistribution: Record<string, number>;
    sanitizedSampleTop: string[];
    normalizedFieldScanAttempted: boolean;
    normalizedFieldsFound: string[];
    snapshotFieldScanAttempted: boolean;
    snapshotFieldsFound: string[];
    cacheFieldScanAttempted: boolean;
    cacheFieldsFound: string[];
    result: ProgramFlowStockEvidenceResult;
    breakPoint: ProgramFlowStockEvidenceBreakPoint;
  };
  marketLevel: {
    programTradingContextFound: boolean;
    programMarketRouterResultFound: boolean;
    programTodayContextFound: boolean;
    cacheContextFound: boolean;
    snapshotContextFound: boolean;
    fieldsFound: string[];
    numericFieldsFound: string[];
    parsableFieldsFound: string[];
    valueReasonDistribution: Record<string, number>;
    sanitizedSample?: string;
    statusFieldsFound: string[];
    sourceCandidates: string[];
    result: ProgramFlowMarketEvidenceResult;
    breakPoint: ProgramFlowMarketEvidenceBreakPoint;
  };
  providerCallsAdded: 0;
  executionImpact: 'NONE';
}

export type ProgramFlowNullRootCause =
  | 'SESSION_EXPECTED_EMPTY'
  | 'MACRO_CARRY_MISSING'
  | 'SNAPSHOT_MISSING'
  | 'SYMBOL_MATCH_FAILED'
  | 'CONSUMER_PARSE_FAILED'
  | 'PRODUCER_VALUE_MISSING_REGULAR_SESSION'
  | 'VALUE_AVAILABLE_DIAGNOSTIC_ONLY'
  | 'UNKNOWN_DIAGNOSTIC_ONLY';

export interface MarketProgramCarryForensicTrace {
  macroStateFound: boolean;
  macroStateProgramSource: ProgramFlowSourceProvider | 'N/A';
  macroStateProgramNetBuyAmountPresent: boolean;
  macroStateProgramNetBuyAmountValue: number | 'N/A';
  macroStateProgramArbitragePresent: boolean;
  macroStateProgramFetchedAt: string | 'N/A';
  marketProgramFlowPayloadPresent: boolean;
  marketProgramFlowPayloadKeys: string[];
  marketProgramFlowPayloadSourceProvider: ProgramFlowSourceProvider | 'N/A';
  marketProgramFlowProviderIssue: boolean;
  marketProgramFlowExecutionImpact: 'NONE';
  marketProgramFlowMarketSignal: boolean;
  marketProgramCarrySource: ProgramFlowMarketCarrySource;
  marketProgramBreakPoint: ProgramFlowMarketEvidenceBreakPoint;
}

export interface ProgramFlowMarketProgramDisplayStatus {
  rawBreakPoint: string;
  displayBreakPoint: string;
  rawReason: string;
  displayReason: string;
  programDataParsed: boolean;
  programDataAvailable: boolean;
  outsideLiveWindow: boolean;
  diagnosticOnly: boolean;
  usedForLiveDecision: boolean;
  usedForShadow: boolean;
  userMessage: string;
}

export interface PerStockProgramCarryForensicTrace {
  latestSnapshotFound: boolean;
  latestSnapshotCapturedAt: string | 'N/A';
  latestSnapshotStockRowsTotal: number;
  latestSnapshotStockRowsWithProgramValue: number;
  latestSnapshotMarketProgramAvailable: boolean;
  perStockCarryMapSize: number;
  candidateStockProgramFlowAttached: number;
  candidateStockProgramFlowAttachedWithValue: number;
  candidateContextProgramNetBuyAmountFieldCreated: number;
  candidateContextProgramNetBuyAmountNonNull: number;
  consumerParsedStockProgramRows: number;
  stockCarrySource: ProgramFlowStockCarrySource;
  stockProgramBreakPoint: ProgramFlowStockEvidenceBreakPoint;
}

export interface ProgramFlowDiagnosticsSummary {
  stockProgramRowsAvailable: number;
  stockProgramRowsWithAnyProgramKey: number;
  stockProgramRowsWithNumericProgramValue: number;
  stockProgramRowsWithParsableProgramValue: number;
  stockProgramValueReasonDistribution: Record<string, number>;
  stockProgramValueReasonTop: string;
  stockProgramSanitizedSampleTop: string[];
  stockProgramFieldKeysTop: string;
  stockProgramBreakPoint: ProgramFlowEvidenceTrace['stockLevel']['breakPoint'];
  total: number;
  marketProgramAvailable: boolean;
  marketProgramSignal: ProgramFlowSignal;
  marketProgramSource: ProgramFlowSourceProvider;
  marketProgramProviderIssue: boolean;
  marketProgramMarketSignal: boolean;
  marketProgramContextFound: boolean;
  marketProgramFieldsFound: string[];
  marketProgramNumericFieldsFound: string[];
  marketProgramParsableFieldsFound: string[];
  marketProgramValueReasonDistribution: Record<string, number>;
  marketProgramValueReasonTop: string;
  marketProgramSanitizedSample?: string;
  marketProgramStatusFieldsFound: string[];
  marketProgramBreakPoint: ProgramFlowEvidenceTrace['marketLevel']['breakPoint'];
  marketProgramReason: string;
  marketProgramNetBuyAmount: number | 'N/A';
  marketProgramDataStatus: string;
  marketProgramStatus: ProgramFlowMarketProgramDisplayStatus;
  kisAttempted: boolean;
  kisStatus: string;
  krxFallbackAttempted: boolean;
  krxFallbackStatus: string;
  cacheFallbackAttempted: boolean;
  cacheStatus: string;
  marketProgramFetchedAt: string | 'N/A';
  marketProgramParsedFieldName: string | 'N/A';
  marketProgramRawFieldKeys: string[];
  upstreamPopulation: ProgramFlowUpstreamPopulationTrace;
  sessionGuard: ProgramFlowSessionGuard;
  marketCarryTrace: MarketProgramCarryForensicTrace;
  stockCarryTrace: PerStockProgramCarryForensicTrace;
  programFlowExpected: boolean;
  programFlowExpectedReason: ProgramFlowSessionGuard['programFlowExpectedReason'];
  providerIssueSuppressedByMarketClosed: boolean;
  recheckWindowKST: '09:10~15:20';
  programNetBuyNullRootCause: ProgramFlowNullRootCause;
  reason: string;
  contextFound: boolean;
  wiredButNoFields: boolean;
  programMissingAsBearish: false;
  programPenaltyApplied: false;
  programFlowUsedForLiveDecision: false;
  providerCallsAdded: 0;
  passiveProxyUsedForLiveDecision: false;
  nextAction: ProgramFlowForensicNextAction;
  executionImpact: 'NONE';
}

export interface ProgramFlowCarryValue {
  source: ProgramFlowStockCarrySource;
  key: string;
  value: number;
  normalized: ProgramFlowValueNormalizationResult;
  sourceProvider: ProgramFlowSourceProvider;
}

export interface ProgramMarketCarryValue {
  source: ProgramFlowMarketCarrySource;
  key: string;
  value: number;
  normalized: ProgramFlowValueNormalizationResult;
  sourceProvider: ProgramFlowSourceProvider;
}

export interface ProgramFlowUpstreamPopulationResult {
  trace: ProgramFlowUpstreamPopulationTrace;
  stockCarryBySymbol: Map<string, ProgramFlowCarryValue>;
  marketCarry?: ProgramMarketCarryValue;
  marketProgramFlowRaw?: Record<string, unknown>;
}
