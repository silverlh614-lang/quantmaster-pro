// @responsibility Normal supply program flow diagnostics builder.

import type {
  CandidateWithSupplyContext,
  PerSymbolSupplyContext,
  SupplyProviderHealth,
  SupplySignal,
} from '../injectPerSymbolSupplyContext.js';
import {
  loadLatestIntradayProgramFlowSnapshot,
  type IntradayProgramFlowSnapshot,
} from '../../../replay/intradayProgramFlowSnapshotRepo.js';
import { createTraceId, logVisibilityEvent } from '../../../utils/logger.js';
import {
  classifyProgramFlowSession,
  type ProgramFlowForensicNextAction,
  type ProgramFlowSessionGuard,
} from '../programFlowSessionGuard.js';
import {
  classifyActivePassiveConfluence,
  describeActiveFlow,
  describeProgramSignal,
  formatList,
  formatReasonDistribution,
  formatStockProgramFieldKeysTop,
} from './formatters.js';
import { buildNormalSupplyFieldAvailability } from './fieldAvailabilityBuilder.js';
import { resolveProgramFlowAfterMarketDisplay } from './programFlowAfterMarketDisplay.js';
import { assembleNormalSupplyPreview } from './previewAssembler.js';
import { setLatestNormalSupplyPreview } from './previewStore.js';
import {
  NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE,
  NORMAL_SUPPLY_SCORE_THRESHOLDS,
} from './constants.js';
import {
  MARKET_PROGRAM_NUMERIC_KEYS,
  STOCK_PROGRAM_BUY_KEYS,
  STOCK_PROGRAM_NET_AMOUNT_KEYS,
  STOCK_PROGRAM_NET_BUY_KEYS,
  STOCK_PROGRAM_SCAN_KEYS,
  STOCK_PROGRAM_SELL_KEYS,
  asRecord,
  buildProgramFlowEvidenceTrace,
  candidatePreviewSymbol,
  candidateProgramRecords,
  collectProgramRecords,
  collectProgramRecordsFromItems,
  collectUpstreamProgramRecords,
  countRowsWithAnyProgramKey,
  countRowsWithParsableProgramValue,
  directRecordsFromItems,
  firstNormalizedProgramValue,
  firstOkProgramValueFromRecords,
  firstProgramValueNormalization,
  firstValueFromRecords,
  hasAnyProgramReasons,
  hasOnlyProgramReasons,
  hasProgramField,
  isStockProgramScanKey,
  marketCacheItems,
  marketLevelProgramRecords,
  marketProgramNetBuyFieldState,
  marketSnapshotItems,
  programNetBuyAmountFieldState,
  stockUpstreamSourceRecords,
  stringValue,
} from './programFlowEvidenceCollector.js';
import { normalizeProgramFlowValue } from './programFlowValueNormalizer.js';
import type {
  MarketProgramCarryForensicTrace,
  PerStockProgramCarryForensicTrace,
  ProgramFlowCarryValue,
  ProgramFlowDiagnostic,
  ProgramFlowDiagnosticsSummary,
  ProgramFlowEvidenceTrace,
  ProgramFlowMarketCarrySource,
  ProgramFlowMarketEvidenceBreakPoint,
  ProgramFlowNullRootCause,
  ProgramFlowSignal,
  ProgramFlowSourceProvider,
  ProgramFlowStockCarrySource,
  ProgramFlowStockEvidenceBreakPoint,
  ProgramFlowUpstreamPopulationResult,
  ProgramFlowUpstreamPopulationTrace,
  ProgramFlowValueNormalizationResult,
  ProgramFlowValueReason,
  ProgramMarketCarryValue,
} from './programFlowTypes.js';
import type {
  NormalSupplyPreview,
  NormalSupplyPreviewCandidate,
  NormalSupplyPreviewEngineMode,
  PersistNormalSupplyPreviewInput,
} from './types.js';
import { PROGRAM_FLOW_NOT_AVAILABLE_MARKET, PROGRAM_FLOW_NOT_AVAILABLE_STOCK } from './programFlowCarry.js';
import { buildMissingContext, normalizeProgramSource } from './candidateMapper.js';

export function countStockProgramKeyRows<T extends CandidateWithSupplyContext>(rawCandidates: T[]): number {
  let rows = 0;
  for (const candidate of rawCandidates) {
    const supplyContext = candidate.preflight?.supplyContext ?? candidate.supplyContext ?? buildMissingContext(candidatePreviewSymbol(candidate));
    const records = candidateProgramRecords(candidate, supplyContext);
    if (records.some((record) => Object.keys(record).some(isStockProgramScanKey))) rows += 1;
  }
  return rows;
}

export function hasCandidateProgramContainer<T extends CandidateWithSupplyContext>(rawCandidates: T[], keys: string[]): boolean {
  return rawCandidates.some((candidate) => {
    const record = candidate as Record<string, unknown>;
    return keys.some((key) => record[key] !== undefined && record[key] !== null);
  });
}

export function buildMarketProgramCarryForensicTrace(
  macroStateRaw: unknown,
  payloadRaw: unknown,
  marketProgramFlow: ProgramFlowDiagnostic['marketLevel'],
  upstream: ProgramFlowUpstreamPopulationTrace['marketLevel'],
  sessionGuard: ProgramFlowSessionGuard,
): MarketProgramCarryForensicTrace {
  const macro = asRecord(macroStateRaw);
  const payload = asRecord(payloadRaw);
  const macroRecords = macro ? [macro] : [];
  const payloadRecords = payload ? collectProgramRecords(payload) : [];
  const macroValue = macro ? firstNormalizedProgramValue(macro, ['programNetBuyAmount', 'marketProgramNetBuy']) : undefined;
  const macroSource = macro ? normalizeProgramSource(macro.programSource ?? macro.sourceProvider ?? macro.source) : 'N/A';
  const macroValueAmount = macroSource !== 'NONE' && macroValue?.ok && macroValue.value !== undefined
    ? macroValue.value
    : undefined;
  const payloadValue = payload ? firstProgramValueNormalization(payloadRecords, MARKET_PROGRAM_NUMERIC_KEYS) : undefined;
  const payloadKeys = payload ? Object.keys(payload).sort() : [];
  const breakPoint = chooseMarketForensicBreakPoint({
    sessionGuard,
    macro,
    payload,
    payloadValue,
    marketProgramFlow,
    upstream,
  });
  return {
    macroStateFound: Boolean(macro),
    macroStateProgramSource: macroSource,
    macroStateProgramNetBuyAmountPresent: macroValueAmount !== undefined,
    macroStateProgramNetBuyAmountValue: macroValueAmount ?? 'N/A',
    macroStateProgramArbitragePresent: macro
      ? normalizeProgramFlowValue(macro.programArbitrageNetBuy ?? macro.programArbitrageNetBuyAmount).ok
      : false,
    macroStateProgramFetchedAt: stringValue(firstValueFromRecords(macroRecords, ['programFetchedAt', 'fetchedAt'])) ?? 'N/A',
    marketProgramFlowPayloadPresent: Boolean(payload),
    marketProgramFlowPayloadKeys: payloadKeys,
    marketProgramFlowPayloadSourceProvider: payload ? normalizeProgramSource(payload.sourceProvider ?? payload.programSource ?? payload.source) : 'N/A',
    marketProgramFlowProviderIssue: payload?.providerIssue === true || marketProgramFlow.providerIssue,
    marketProgramFlowExecutionImpact: 'NONE',
    marketProgramFlowMarketSignal: marketProgramFlow.marketSignal,
    marketProgramCarrySource: upstream.carrySource,
    marketProgramBreakPoint: breakPoint,
  };
}

function chooseMarketForensicBreakPoint(input: {
  sessionGuard: ProgramFlowSessionGuard;
  macro: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
  payloadValue?: ProgramFlowValueNormalizationResult & { key: string };
  marketProgramFlow: ProgramFlowDiagnostic['marketLevel'];
  upstream: ProgramFlowUpstreamPopulationTrace['marketLevel'];
}): ProgramFlowMarketEvidenceBreakPoint {
  if (!input.sessionGuard.programFlowExpected) return 'PROGRAM_FLOW_NOT_EXPECTED_MARKET_CLOSED';
  if (input.marketProgramFlow.available || input.upstream.carrySource !== 'NONE') {
    return 'MARKET_PROGRAM_VALUE_CARRIED_DIAGNOSTIC_ONLY';
  }
  if (input.macro && normalizeProgramFlowValue(input.macro.programNetBuyAmount).ok && !input.payload) {
    return 'MARKET_PROGRAM_CARRY_PAYLOAD_MISSING';
  }
  if (isAcceptedEmptyKrxEmptyCacheMiss(input.marketProgramFlow)) return 'KIS_ACCEPTED_EMPTY_KRX_EMPTY_CACHE_MISS';
  if (input.payload && input.payloadValue && isMarketProgramConsumerParseFailure(input.payloadValue)) return 'MARKET_PROGRAM_CONSUMER_PARSE_FAILED';
  const source = input.macro ? normalizeProgramSource(input.macro.programSource ?? input.macro.sourceProvider ?? input.macro.source) : 'NONE';
  if (source === 'NONE' || input.upstream.breakPoint === 'NO_UPSTREAM_MARKET_PROGRAM_VALUE') {
    return 'MARKET_PROGRAM_UPSTREAM_VALUE_MISSING_REGULAR_SESSION';
  }
  return input.upstream.breakPoint;
}

function isAcceptedEmptyKrxEmptyCacheMiss(marketProgramFlow: ProgramFlowDiagnostic['marketLevel']): boolean {
  const diagnostics = marketProgramFlow as unknown as Record<string, unknown>;
  return marketProgramFlow.available === false
    && marketProgramFlow.sourceProvider === 'NONE'
    && marketProgramFlow.signal === 'UNAVAILABLE'
    && marketProgramFlow.providerIssue === false
    && diagnostics.marketProgramDataStatus === 'ACCEPTED_EMPTY'
    && diagnostics.kisAttempted === true
    && diagnostics.kisStatus === 'ACCEPTED_EMPTY'
    && diagnostics.krxFallbackAttempted === true
    && diagnostics.krxFallbackStatus === 'EMPTY'
    && diagnostics.cacheFallbackAttempted === true
    && diagnostics.cacheStatus === 'MISS';
}

function isMarketProgramConsumerParseFailure(value: ProgramFlowValueNormalizationResult): boolean {
  return value.rawKind !== 'null'
    && value.rawKind !== 'undefined'
    && value.reason !== 'PROGRAM_VALUE_NULL'
    && value.reason !== 'PROGRAM_VALUE_EMPTY'
    && value.reason !== 'PROGRAM_VALUE_NA'
    && value.reason !== 'PROGRAM_VALUE_PLACEHOLDER';
}

export function buildPerStockProgramCarryForensicTrace<T extends CandidateWithSupplyContext>(
  rawCandidates: T[],
  latestSnapshot: IntradayProgramFlowSnapshot | null,
  previewCandidates: NormalSupplyPreviewCandidate[],
  upstream: ProgramFlowUpstreamPopulationTrace['stockLevel'],
  sessionGuard: ProgramFlowSessionGuard,
): PerStockProgramCarryForensicTrace {
  const candidateStockProgramFlowAttached = rawCandidates.filter((candidate) => asRecord(candidate as Record<string, unknown>)?.stockProgramFlow != null).length;
  const candidateStockProgramFlowAttachedWithValue = rawCandidates.filter((candidate) => {
    const flow = asRecord(candidate as Record<string, unknown>)?.stockProgramFlow;
    const records = flow ? collectProgramRecordsFromItems([flow]) : [];
    return Boolean(firstOkProgramValueFromRecords(records, STOCK_PROGRAM_SCAN_KEYS));
  }).length;
  const contextFieldCreated = upstream.programNetBuyAmountNullCount + upstream.programNetBuyAmountNonNullCount;
  const consumerParsed = previewCandidates.filter((candidate) => candidate.programFlow?.stockLevel.available).length;
  const snapshotRowsWithValue = latestSnapshot?.summary.stockRowsWithProgramValue
    ?? latestSnapshot?.stockRows.filter((row) => hasIntradayStockRowProgramValue(row)).length
    ?? 0;
  const stockProgramBreakPoint = chooseStockForensicBreakPoint({
    sessionGuard,
    latestSnapshot,
    snapshotRowsWithValue,
    candidateStockProgramFlowAttached,
    candidateStockProgramFlowAttachedWithValue,
    consumerParsed,
    contextFieldCreated,
    contextNonNull: upstream.programNetBuyAmountNonNullCount,
    upstream,
  });
  return {
    latestSnapshotFound: Boolean(latestSnapshot),
    latestSnapshotCapturedAt: latestSnapshot?.capturedAt ?? 'N/A',
    latestSnapshotStockRowsTotal: latestSnapshot?.stockRows.length ?? 0,
    latestSnapshotStockRowsWithProgramValue: snapshotRowsWithValue,
    latestSnapshotMarketProgramAvailable: latestSnapshot?.summary.marketProgramAvailable ?? false,
    perStockCarryMapSize: snapshotRowsWithValue,
    candidateStockProgramFlowAttached,
    candidateStockProgramFlowAttachedWithValue,
    candidateContextProgramNetBuyAmountFieldCreated: contextFieldCreated,
    candidateContextProgramNetBuyAmountNonNull: upstream.programNetBuyAmountNonNullCount,
    consumerParsedStockProgramRows: consumerParsed,
    stockCarrySource: upstream.carrySource,
    stockProgramBreakPoint,
  };
}

function chooseStockForensicBreakPoint(input: {
  sessionGuard: ProgramFlowSessionGuard;
  latestSnapshot: IntradayProgramFlowSnapshot | null;
  snapshotRowsWithValue: number;
  candidateStockProgramFlowAttached: number;
  candidateStockProgramFlowAttachedWithValue: number;
  consumerParsed: number;
  contextFieldCreated: number;
  contextNonNull: number;
  upstream: ProgramFlowUpstreamPopulationTrace['stockLevel'];
}): ProgramFlowStockEvidenceBreakPoint {
  if (!input.sessionGuard.programFlowExpected) return 'PROGRAM_FLOW_NOT_EXPECTED_MARKET_CLOSED';
  if (input.candidateStockProgramFlowAttached > 0 && input.consumerParsed === 0) return 'STOCK_PROGRAM_CONSUMER_PARSE_FAILED';
  if (input.snapshotRowsWithValue > 0 && input.candidateStockProgramFlowAttached === 0 && input.consumerParsed === 0) return 'STOCK_PROGRAM_SYMBOL_MATCHING_FAILED';
  if (!input.latestSnapshot) return 'STOCK_PROGRAM_SNAPSHOT_MISSING';
  if (input.latestSnapshot && input.snapshotRowsWithValue === 0) return 'STOCK_PROGRAM_SNAPSHOT_HAS_NO_VALUES';
  if (input.contextFieldCreated > 0 && input.contextNonNull === 0) return 'CANDIDATE_CONTEXT_FIELD_CREATED_BUT_NULL';
  if (input.consumerParsed === 0) return 'PRODUCER_POPULATION_REQUIRED_REGULAR_SESSION';
  if (input.contextFieldCreated > 0 && input.contextNonNull > 0 && input.consumerParsed > 0) return 'OK_STOCK_PROGRAM_CONTEXT_WIRED';
  return input.upstream.breakPoint;
}

function hasIntradayStockRowProgramValue(row: IntradayProgramFlowSnapshot['stockRows'][number]): boolean {
  return row.programNetBuyAmount !== null && row.programNetBuyAmount !== undefined
    || row.programNetValue !== null && row.programNetValue !== undefined
    || row.programNetVolume !== null && row.programNetVolume !== undefined;
}

function classifyProgramNetBuyNullRootCause(input: {
  sessionGuard: ProgramFlowSessionGuard;
  marketCarryTrace: MarketProgramCarryForensicTrace;
  stockCarryTrace: PerStockProgramCarryForensicTrace;
  marketProgramAvailable: boolean;
  stockProgramRowsAvailable: number;
}): ProgramFlowNullRootCause {
  if (input.marketProgramAvailable || input.stockProgramRowsAvailable > 0) return 'VALUE_AVAILABLE_DIAGNOSTIC_ONLY';
  if (!input.sessionGuard.programFlowExpected) return 'SESSION_EXPECTED_EMPTY';
  if (input.marketCarryTrace.marketProgramBreakPoint === 'MARKET_PROGRAM_CARRY_PAYLOAD_MISSING') return 'MACRO_CARRY_MISSING';
  if (input.stockCarryTrace.stockProgramBreakPoint === 'STOCK_PROGRAM_SNAPSHOT_MISSING') return 'SNAPSHOT_MISSING';
  if (input.stockCarryTrace.stockProgramBreakPoint === 'STOCK_PROGRAM_SYMBOL_MATCHING_FAILED') return 'SYMBOL_MATCH_FAILED';
  if (
    input.stockCarryTrace.stockProgramBreakPoint === 'STOCK_PROGRAM_CONSUMER_PARSE_FAILED' ||
    input.marketCarryTrace.marketProgramBreakPoint === 'MARKET_PROGRAM_CONSUMER_PARSE_FAILED'
  ) return 'CONSUMER_PARSE_FAILED';
  if (
    input.stockCarryTrace.stockProgramBreakPoint === 'PRODUCER_POPULATION_REQUIRED_REGULAR_SESSION' ||
    input.stockCarryTrace.stockProgramBreakPoint === 'STOCK_PROGRAM_SNAPSHOT_HAS_NO_VALUES' ||
    input.marketCarryTrace.marketProgramBreakPoint === 'MARKET_PROGRAM_UPSTREAM_VALUE_MISSING_REGULAR_SESSION'
  ) return 'PRODUCER_VALUE_MISSING_REGULAR_SESSION';
  return 'UNKNOWN_DIAGNOSTIC_ONLY';
}

function marketClosedProgramDataStatus(marketSession: ProgramFlowSessionGuard['marketSession']): string {
  if (marketSession === 'AFTER_MARKET' || marketSession === 'POST_CLOSE' || marketSession === 'CLOSING_SESSION') return 'NOT_EXPECTED_AFTER_MARKET';
  if (marketSession === 'PRE_MARKET' || marketSession === 'WARMUP_SESSION') return 'NOT_EXPECTED_PRE_MARKET';
  return 'NOT_EXPECTED_MARKET_CLOSED';
}

function marketClosedProgramReason(): string {
  return 'MARKET_CLOSED_NO_INTRADAY_PROGRAM_FLOW_EXPECTED';
}

function nextActionForForensicRootCause(
  rootCause: ProgramFlowNullRootCause,
  marketCarryTrace: MarketProgramCarryForensicTrace,
  stockCarryTrace: PerStockProgramCarryForensicTrace,
  legacyReason: string,
): ProgramFlowForensicNextAction {
  if (rootCause === 'SESSION_EXPECTED_EMPTY') return 'RETRY_DURING_REGULAR_SESSION';
  if (rootCause === 'VALUE_AVAILABLE_DIAGNOSTIC_ONLY') return 'OBSERVE_DIAGNOSTIC_ONLY';
  if (rootCause === 'MACRO_CARRY_MISSING') return 'CHECK_MACROSTATE_PROGRAM_CARRY';
  if (rootCause === 'SNAPSHOT_MISSING') return 'CHECK_INTRADAY_PROGRAM_SNAPSHOT_PRODUCER';
  if (rootCause === 'SYMBOL_MATCH_FAILED') return 'CHECK_PER_STOCK_SYMBOL_MATCHING';
  if (rootCause === 'CONSUMER_PARSE_FAILED') {
    return marketCarryTrace.marketProgramBreakPoint === 'MARKET_PROGRAM_CONSUMER_PARSE_FAILED'
      ? 'CHECK_MARKET_PROGRAM_CONSUMER_PARSE'
      : 'CHECK_STOCK_PROGRAM_CONSUMER_PARSE';
  }
  if (rootCause === 'PRODUCER_VALUE_MISSING_REGULAR_SESSION') {
    if (marketCarryTrace.marketProgramBreakPoint === 'MARKET_PROGRAM_CONSUMER_PARSE_FAILED') return 'CHECK_MARKET_PROGRAM_CONSUMER_PARSE';
    if (stockCarryTrace.stockProgramBreakPoint === 'STOCK_PROGRAM_CONSUMER_PARSE_FAILED') return 'CHECK_STOCK_PROGRAM_CONSUMER_PARSE';
    return 'CHECK_INTRADAY_PROGRAM_SNAPSHOT_PRODUCER';
  }
  if (legacyReason.includes('MARKET')) return 'CHECK_MARKET_PROGRAM_CONSUMER_PARSE';
  return 'CHECK_INTRADAY_PROGRAM_SNAPSHOT_PRODUCER';
}

export function buildProgramFlowDiagnostics(
  candidates: NormalSupplyPreviewCandidate[],
  marketProgramFlow: ProgramFlowDiagnostic['marketLevel'],
  evidenceTrace: ProgramFlowEvidenceTrace,
  sessionGuard: ProgramFlowSessionGuard,
  marketCarryTrace: MarketProgramCarryForensicTrace,
  stockCarryTrace: PerStockProgramCarryForensicTrace,
): ProgramFlowDiagnosticsSummary {
  const stockProgramRowsAvailable = candidates.filter((candidate) => candidate.programFlow?.stockLevel.available).length;
  const marketProgramAvailable = marketProgramFlow.available;
  const stockAny = evidenceTrace.stockLevel.candidateRowsWithAnyProgramKey;
  const stockNumeric = evidenceTrace.stockLevel.candidateRowsWithNumericProgramValue;
  const stockParsable = evidenceTrace.stockLevel.candidateRowsWithParsableProgramValue;
  const upstream = evidenceTrace.upstreamPopulation;
  const reusableStockSourceExists =
    upstream.stockLevel.snapshotContextFound ||
    upstream.stockLevel.cacheContextFound ||
    upstream.stockLevel.programTradingContextFound;
  const reusableMarketSourceExists =
    upstream.marketLevel.latestIntradayMarketProgramSnapshotFound ||
    upstream.marketLevel.cacheContextFound ||
    upstream.marketLevel.programMarketContextFound;
  const noReusableProgramFlowSourceExists = !reusableStockSourceExists && !reusableMarketSourceExists;
  let legacyReason = 'PROGRAM_FLOW_NOT_WIRED_OR_NOT_AVAILABLE';
  if (!evidenceTrace.contextFound) legacyReason = 'PROGRAM_FLOW_CONTEXT_NOT_FOUND';
  else if (marketProgramAvailable && stockProgramRowsAvailable === 0) legacyReason = 'MARKET_PROGRAM_AVAILABLE_STOCK_PROGRAM_MISSING';
  else if (marketProgramAvailable || stockNumeric > 0 || stockParsable > 0 || upstream.stockLevel.carrySuccessCount > 0) legacyReason = 'PROGRAM_FLOW_AVAILABLE_DIAGNOSTIC_ONLY';
  else if (hasAnyProgramReasons(evidenceTrace, ['PROGRAM_VALUE_UNSUPPORTED_FORMAT'])) legacyReason = 'PROGRAM_VALUE_UNSUPPORTED_FORMAT';
  else if (noReusableProgramFlowSourceExists && (stockAny > 0 || upstream.stockLevel.programNetBuyAmountFieldCreated || evidenceTrace.marketLevel.fieldsFound.length > 0)) legacyReason = 'PROGRAM_UPSTREAM_SNAPSHOT_CACHE_MISSING';
  else if (evidenceTrace.marketLevel.result === 'SESSION_CLOSED_DIAGNOSTIC_ONLY' || marketProgramFlow.providerIssue) legacyReason = 'PROGRAM_PROVIDER_ISSUE_DIAGNOSTIC_ONLY';
  else if (evidenceTrace.wiredButNoFields) legacyReason = 'PROGRAM_FLOW_WIRED_BUT_NO_FIELDS';
  else if (upstream.stockLevel.cacheProgramRowsWithValue > 0 && upstream.stockLevel.carrySuccessCount === 0) legacyReason = 'PROGRAM_CACHE_VALUE_NOT_CARRIED';
  else if (upstream.stockLevel.programTradingRowsWithValue > 0 && upstream.stockLevel.carrySuccessCount === 0) legacyReason = 'PROGRAM_TRADING_VALUE_NOT_CARRIED';
  else if (upstream.stockLevel.snapshotProgramRowsFound > 0 && upstream.stockLevel.snapshotProgramRowsWithValue === 0) legacyReason = 'PROGRAM_SNAPSHOT_VALUE_NULL';
  else if (
    upstream.stockLevel.programNetBuyAmountFieldCreated &&
    upstream.stockLevel.programNetBuyAmountNullCount > 0 &&
    upstream.stockLevel.snapshotProgramRowsWithValue === 0 &&
    upstream.stockLevel.cacheProgramRowsWithValue === 0 &&
    upstream.stockLevel.programTradingRowsWithValue === 0 &&
    !marketProgramAvailable
  ) legacyReason = 'PROGRAM_UPSTREAM_VALUE_MISSING';
  else if (hasOnlyProgramReasons(evidenceTrace, ['PROGRAM_VALUE_NA', 'PROGRAM_VALUE_PLACEHOLDER', 'PROGRAM_VALUE_EMPTY', 'PROGRAM_VALUE_NULL'])) legacyReason = 'PROGRAM_VALUE_PLACEHOLDER_ONLY';
  else if (hasAnyProgramReasons(evidenceTrace, ['PROGRAM_VALUE_UNIT_STRING_WON', 'PROGRAM_VALUE_UNIT_STRING_MILLION', 'PROGRAM_VALUE_UNIT_STRING_EOK'])) legacyReason = 'PROGRAM_VALUE_UNIT_NORMALIZATION_REQUIRED';
  else if (evidenceTrace.marketLevel.result === 'ONLY_STATUS_NO_NUMERIC') legacyReason = 'PROGRAM_CONTEXT_HAS_STATUS_ONLY';
  else if (stockAny > 0 || evidenceTrace.marketLevel.fieldsFound.length > 0) legacyReason = 'PROGRAM_VALUE_NORMALIZATION_REQUIRED';
  else legacyReason = 'PROGRAM_FLOW_WIRED_BUT_NO_FIELDS';

  const rootCause = classifyProgramNetBuyNullRootCause({
    sessionGuard,
    marketCarryTrace,
    stockCarryTrace,
    marketProgramAvailable,
    stockProgramRowsAvailable,
  });
  const reason = rootCause === 'VALUE_AVAILABLE_DIAGNOSTIC_ONLY'
    ? 'PROGRAM_FLOW_AVAILABLE_DIAGNOSTIC_ONLY'
    : sessionGuard.programFlowExpected
      ? 'PROGRAM_FLOW_EXPECTED_BUT_VALUE_MISSING_DIAGNOSTIC_ONLY'
      : 'PROGRAM_FLOW_NOT_EXPECTED_MARKET_CLOSED';
  const nextAction = nextActionForForensicRootCause(rootCause, marketCarryTrace, stockCarryTrace, legacyReason);
  const marketClosedProgramUnavailable = !sessionGuard.programFlowExpected;
  const afterMarketZeroPlaceholder = isAfterMarketZeroPlaceholderDiagnostic(marketProgramFlow);
  const marketProgramReason = marketClosedProgramUnavailable
    ? afterMarketZeroPlaceholder
      ? 'AFTER_MARKET_ZERO_PLACEHOLDER'
      : marketClosedProgramReason()
    : marketCarryTrace.marketProgramBreakPoint === 'KIS_ACCEPTED_EMPTY_KRX_EMPTY_CACHE_MISS'
      ? 'MARKET_PROGRAM_EMPTY_VALID_DIAGNOSTIC_ONLY'
      : evidenceTrace.marketLevel.result;
  const marketProgramDataStatus = marketClosedProgramUnavailable
    ? marketClosedProgramDataStatus(sessionGuard.marketSession)
    : stringValue((marketProgramFlow as unknown as Record<string, unknown>).marketProgramDataStatus) ?? (marketProgramAvailable ? 'PARSED' : 'MISSING');
  const marketProgramProviderIssue = sessionGuard.programFlowExpected
    ? marketProgramFlow.providerIssue || evidenceTrace.marketLevel.result === 'SESSION_CLOSED_DIAGNOSTIC_ONLY'
    : false;
  const marketProgramMarketSignal = marketProgramFlow.marketSignal;
  const kisStatus = stringValue((marketProgramFlow as unknown as Record<string, unknown>).kisStatus) ?? 'NOT_ATTEMPTED';
  const marketProgramStatus = resolveProgramFlowAfterMarketDisplay({
    marketSession: sessionGuard.marketSession,
    programFlowExpected: sessionGuard.programFlowExpected,
    marketProgramAvailable,
    kisStatus,
    marketProgramDataStatus,
    marketProgramProviderIssue,
    marketProgramMarketSignal,
    marketProgramBreakPoint: marketCarryTrace.marketProgramBreakPoint,
    marketProgramReason,
    programFlowUsedForLiveDecision: false,
    passiveProxyUsedForLiveDecision: false,
    executionImpact: 'NONE',
  });
  return {
    stockProgramRowsAvailable,
    stockProgramRowsWithAnyProgramKey: stockAny,
    stockProgramRowsWithNumericProgramValue: stockNumeric,
    stockProgramRowsWithParsableProgramValue: evidenceTrace.stockLevel.candidateRowsWithParsableProgramValue,
    stockProgramValueReasonDistribution: evidenceTrace.stockLevel.valueReasonDistribution,
    stockProgramValueReasonTop: formatReasonDistribution(evidenceTrace.stockLevel.valueReasonDistribution),
    stockProgramSanitizedSampleTop: evidenceTrace.stockLevel.sanitizedSampleTop,
    stockProgramFieldKeysTop: formatStockProgramFieldKeysTop(evidenceTrace.stockLevel.candidateFieldsFound, evidenceTrace.stockLevel.candidateFieldCounts),
    stockProgramBreakPoint: stockCarryTrace.stockProgramBreakPoint,
    total: candidates.length,
    marketProgramAvailable,
    marketProgramSignal: marketProgramFlow.signal,
    marketProgramSource: marketProgramFlow.sourceProvider ?? 'NONE',
    marketProgramProviderIssue,
    marketProgramMarketSignal,
    marketProgramContextFound: evidenceTrace.marketLevel.fieldsFound.length > 0 || evidenceTrace.marketLevel.programTradingContextFound || evidenceTrace.marketLevel.programMarketRouterResultFound || evidenceTrace.marketLevel.programTodayContextFound || evidenceTrace.marketLevel.cacheContextFound || evidenceTrace.marketLevel.snapshotContextFound,
    marketProgramFieldsFound: evidenceTrace.marketLevel.fieldsFound,
    marketProgramNumericFieldsFound: evidenceTrace.marketLevel.numericFieldsFound,
    marketProgramParsableFieldsFound: evidenceTrace.marketLevel.parsableFieldsFound,
    marketProgramValueReasonDistribution: evidenceTrace.marketLevel.valueReasonDistribution,
    marketProgramValueReasonTop: formatReasonDistribution(evidenceTrace.marketLevel.valueReasonDistribution),
    marketProgramSanitizedSample: evidenceTrace.marketLevel.sanitizedSample,
    marketProgramStatusFieldsFound: evidenceTrace.marketLevel.statusFieldsFound,
    marketProgramBreakPoint: marketCarryTrace.marketProgramBreakPoint,
    marketProgramReason,
    marketProgramNetBuyAmount: displayMarketProgramNetBuyAmount(marketProgramFlow),
    marketProgramDataStatus,
    marketProgramStatus,
    kisAttempted: (marketProgramFlow as unknown as Record<string, unknown>).kisAttempted === true,
    kisStatus,
    krxFallbackAttempted: (marketProgramFlow as unknown as Record<string, unknown>).krxFallbackAttempted === true,
    krxFallbackStatus: stringValue((marketProgramFlow as unknown as Record<string, unknown>).krxFallbackStatus) ?? 'NOT_ATTEMPTED',
    cacheFallbackAttempted: (marketProgramFlow as unknown as Record<string, unknown>).cacheFallbackAttempted === true,
    cacheStatus: stringValue((marketProgramFlow as unknown as Record<string, unknown>).cacheStatus) ?? 'MISS',
    marketProgramFetchedAt: stringValue((marketProgramFlow as unknown as Record<string, unknown>).fetchedAt) ?? stringValue((marketProgramFlow as unknown as Record<string, unknown>).programFetchedAt) ?? 'N/A',
    marketProgramParsedFieldName: stringValue((marketProgramFlow as unknown as Record<string, unknown>).parsedFieldName) ?? 'N/A',
    marketProgramRawFieldKeys: Array.isArray((marketProgramFlow as unknown as Record<string, unknown>).rawFieldKeys)
      ? ((marketProgramFlow as unknown as Record<string, unknown>).rawFieldKeys as unknown[]).filter((key): key is string => typeof key === 'string')
      : [],
    upstreamPopulation: upstream,
    sessionGuard,
    marketCarryTrace,
    stockCarryTrace,
    programFlowExpected: sessionGuard.programFlowExpected,
    programFlowExpectedReason: reason === 'PROGRAM_FLOW_EXPECTED_BUT_VALUE_MISSING_DIAGNOSTIC_ONLY'
      ? reason
      : sessionGuard.programFlowExpectedReason,
    providerIssueSuppressedByMarketClosed: sessionGuard.providerIssueSuppressedByMarketClosed,
    recheckWindowKST: sessionGuard.recheckWindowKST,
    programNetBuyNullRootCause: rootCause,
    reason,
    contextFound: evidenceTrace.contextFound,
    wiredButNoFields: evidenceTrace.wiredButNoFields,
    programMissingAsBearish: false,
    programPenaltyApplied: false,
    programFlowUsedForLiveDecision: false,
    providerCallsAdded: 0,
    passiveProxyUsedForLiveDecision: false,
    nextAction,
    executionImpact: 'NONE',
  };
}

function isAfterMarketZeroPlaceholderDiagnostic(marketProgramFlow: ProgramFlowDiagnostic['marketLevel']): boolean {
  const diagnostics = marketProgramFlow as unknown as Record<string, unknown>;
  return marketProgramFlow.reason === 'AFTER_MARKET_ZERO_PLACEHOLDER' ||
    diagnostics.marketProgramDataStatus === 'AFTER_MARKET_ZERO_PLACEHOLDER' ||
    diagnostics.breakPoint === 'AFTER_MARKET_ZERO_PLACEHOLDER';
}

function displayMarketProgramNetBuyAmount(
  marketProgramFlow: ProgramFlowDiagnostic['marketLevel'],
): number | 'N/A' {
  if ((marketProgramFlow.sourceProvider ?? 'NONE') === 'NONE') return 'N/A';
  return marketProgramFlow.combinedNetBuy ?? 'N/A';
}
