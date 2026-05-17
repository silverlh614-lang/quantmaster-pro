// @responsibility Normal-mode supply diagnostic overlay under live-entry blocks.
import type {
  CandidateWithSupplyContext,
  PerSymbolSupplyContext,
  PerSymbolSupplyInjectionStats,
  SupplyProviderHealth,
  SupplySignal,
} from './injectPerSymbolSupplyContext.js';
import {
  loadLatestIntradayProgramFlowSnapshot,
  type IntradayProgramFlowSnapshot,
} from '../../replay/intradayProgramFlowSnapshotRepo.js';
import { createTraceId, logVisibilityEvent } from '../../utils/logger.js';
import {
  classifyProgramFlowSession,
  type ProgramFlowForensicNextAction,
  type ProgramFlowSessionGuard,
} from './programFlowSessionGuard.js';
import {
  classifyActivePassiveConfluence,
  describeActiveFlow,
  describeProgramSignal,
  formatAmount,
  formatAvailabilityLine,
  formatList,
  formatReasonDistribution,
  formatSampleList,
  formatStockProgramFieldKeysTop,
} from './normalSupplyPreview/formatters.js';
import { buildNormalSupplyFieldAvailability } from './normalSupplyPreview/fieldAvailabilityBuilder.js';
import {
  NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE,
  NORMAL_SUPPLY_DIAGNOSTIC_PREVIEW_MODE,
  NORMAL_SUPPLY_SCORE_THRESHOLDS,
} from './normalSupplyPreview/constants.js';
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
} from './normalSupplyPreview/programFlowEvidenceCollector.js';
import { normalizeProgramFlowValue } from './normalSupplyPreview/programFlowValueNormalizer.js';
import type {
  ActivePassiveConfluence,
  ActivePassiveConfluenceCounts,
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
} from './normalSupplyPreview/programFlowTypes.js';
import type {
  NormalSupplyPreview,
  NormalSupplyPreviewCandidate,
  NormalSupplyPreviewEngineMode,
  NormalSupplyPreviewSafety,
  NormalSupplySignalSourceSplit,
  PersistNormalSupplyPreviewInput,
} from './normalSupplyPreview/types.js';

export {
  NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE,
  NORMAL_SUPPLY_DIAGNOSTIC_PREVIEW_MODE,
  NORMAL_SUPPLY_SCORE_THRESHOLDS,
} from './normalSupplyPreview/constants.js';
export { normalizeProgramFlowValue } from './normalSupplyPreview/programFlowValueNormalizer.js';
export type {
  ActivePassiveConfluence,
  ActivePassiveConfluenceCounts,
  MarketProgramCarryForensicTrace,
  PerStockProgramCarryForensicTrace,
  ProgramFlowCarryValue,
  ProgramFlowDiagnostic,
  ProgramFlowDiagnosticsSummary,
  ProgramFlowDryRunDiagnostic,
  ProgramFlowEvidenceTrace,
  ProgramFlowMarketCarrySource,
  ProgramFlowMarketEvidenceBreakPoint,
  ProgramFlowMarketEvidenceResult,
  ProgramFlowNullRootCause,
  ProgramFlowSignal,
  ProgramFlowSourceProvider,
  ProgramFlowStockCarrySource,
  ProgramFlowStockEvidenceBreakPoint,
  ProgramFlowStockEvidenceResult,
  ProgramFlowUpstreamPopulationResult,
  ProgramFlowUpstreamPopulationTrace,
  ProgramFlowValueNormalizationResult,
  ProgramFlowValueReason,
  ProgramMarketCarryValue,
} from './normalSupplyPreview/programFlowTypes.js';
export type {
  NormalSupplyFieldAvailability,
  NormalSupplyPreview,
  NormalSupplyPreviewCandidate,
  NormalSupplyPreviewEngineMode,
  NormalSupplyPreviewFullMode,
  NormalSupplyPreviewMode,
  NormalSupplyPreviewSafety,
  NormalSupplySignalSourceSplit,
  PersistNormalSupplyPreviewInput,
} from './normalSupplyPreview/types.js';

let lastNormalSupplyPreview: NormalSupplyPreview | null = null;

function logSupplyPreviewTrace(message: string, summary: Record<string, unknown> = {}): void {
  logVisibilityEvent({
    visibility: 'TRACE',
    message,
    category: 'SUPPLY',
    sourceCommand: '/normal_supply_preview',
    summary,
    details: { message, ...summary },
    level: 'info',
    executionImpact: 'NONE',
  });
}

export function persistNormalSupplyPreview<T extends CandidateWithSupplyContext>(
  input: PersistNormalSupplyPreviewInput<T>,
): NormalSupplyPreview {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const sessionGuard = classifyProgramFlowSession(new Date(capturedAt));
  logSupplyPreviewTrace(
    `[NORMAL_SUPPLY_PREVIEW_PROGRAM_EVIDENCE_TRACE_START] ` +
      `candidateCount=${input.candidates.length} previewMode=${NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE} ` +
      `providerCallsAdded=0 executionImpact=NONE`,
    { candidateCount: input.candidates.length, previewMode: NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE },
  );
  const marketProgramFlowRaw = input.marketProgramFlow ?? extractMarketProgramFlowFromCandidates(input.candidates);
  const latestIntradayProgramFlowSnapshot = loadLatestIntradayProgramFlowSnapshot();
  logSupplyPreviewTrace(
    `[INTRADAY_PROGRAM_FLOW_CARRY_START] ` +
      `candidateCount=${input.candidates.length} ` +
      `snapshotAvailable=${Boolean(latestIntradayProgramFlowSnapshot)} ` +
      `cacheAvailable=${hasCandidateProgramContainer(input.candidates, ['cache', 'supplySnapshotCache', 'programTradingCache'])} ` +
      `programTradingContextAvailable=${hasCandidateProgramContainer(input.candidates, ['programTrading', 'programDiagnostic', 'stockProgramFlow'])} ` +
      `providerCallsAdded=0 executionImpact=NONE`,
    { candidateCount: input.candidates.length, snapshotAvailable: Boolean(latestIntradayProgramFlowSnapshot) },
  );
  const programPopulation = buildProgramFlowUpstreamPopulation(
    input.candidates,
    marketProgramFlowRaw,
    latestIntradayProgramFlowSnapshot,
  );
  logSupplyPreviewTrace(
    `[NORMAL_SUPPLY_PREVIEW_PROGRAM_UPSTREAM_POPULATION_START] ` +
      `candidateCount=${input.candidates.length} ` +
      `stockProgramNullCount=${programPopulation.trace.stockLevel.programNetBuyAmountNullCount} ` +
      `marketProgramNull=${programPopulation.trace.marketLevel.marketProgramNetBuyNull} ` +
      `providerCallsAdded=0 executionImpact=NONE`,
    { candidateCount: input.candidates.length, stockProgramNullCount: programPopulation.trace.stockLevel.programNetBuyAmountNullCount },
  );
  logSupplyPreviewTrace(
    `[NORMAL_SUPPLY_PREVIEW_PROGRAM_VALUE_NORMALIZER_START] ` +
      `candidateCount=${input.candidates.length} stockProgramKeyRows=${countStockProgramKeyRows(input.candidates)} ` +
      `marketProgramContextFound=${Boolean(asRecord(marketProgramFlowRaw))} ` +
      `providerCallsAdded=0 executionImpact=NONE`,
    { candidateCount: input.candidates.length, stockProgramKeyRows: countStockProgramKeyRows(input.candidates) },
  );
  const marketProgramFlow = normalizeMarketProgramFlow(programPopulation.marketProgramFlowRaw ?? marketProgramFlowRaw);
  const previewCandidates = input.candidates
    .map((candidate) => toPreviewCandidate(
      candidate,
      marketProgramFlow,
      programPopulation.stockCarryBySymbol.get(candidatePreviewSymbol(candidate)),
    ))
    .filter((candidate): candidate is NormalSupplyPreviewCandidate => candidate !== null);
  const healthCounts = countHealth(previewCandidates);
  const signalCounts = countSignals(previewCandidates);
  const supplyInjection = input.supplyInjection ?? buildSupplyInjectionFromCandidates(previewCandidates);
  const signalSourceSplit = buildSignalSourceSplit(previewCandidates);
  const programFlowEvidenceTrace = buildProgramFlowEvidenceTrace(
    input.candidates,
    programPopulation.marketProgramFlowRaw ?? marketProgramFlowRaw,
    previewCandidates,
    marketProgramFlow,
    programPopulation.trace,
  );
  const fieldAvailability = buildNormalSupplyFieldAvailability(previewCandidates, programFlowEvidenceTrace);
  const topCandidates = [...previewCandidates]
    .sort((a, b) => b.supplyScore - a.supplyScore || a.symbol.localeCompare(b.symbol))
    .slice(0, input.topN ?? 5);
  const activePassiveConfluenceCounts = buildActivePassiveConfluenceCounts(previewCandidates);
  const marketCarryTrace = buildMarketProgramCarryForensicTrace(
    input.marketProgramCarrySource,
    input.marketProgramFlow,
    marketProgramFlow,
    programPopulation.trace.marketLevel,
    sessionGuard,
  );
  const stockCarryTrace = buildPerStockProgramCarryForensicTrace(
    input.candidates,
    latestIntradayProgramFlowSnapshot,
    previewCandidates,
    programPopulation.trace.stockLevel,
    sessionGuard,
  );
  const programFlowDiagnostics = buildProgramFlowDiagnostics(
    previewCandidates,
    marketProgramFlow,
    programFlowEvidenceTrace,
    sessionGuard,
    marketCarryTrace,
    stockCarryTrace,
  );

  lastNormalSupplyPreview = {
    capturedAt,
    engineMode: input.engineMode,
    previewMode: NORMAL_SUPPLY_DIAGNOSTIC_PREVIEW_MODE,
    source: input.source,
    reason: input.reason,
    preflightDecision: input.preflightDecision,
    liveExecutionAllowed: false,
    realOrderAllowed: false,
    strongBuyAllowed: false,
    shadowObservableAllowed: true,
    executionImpact: 'NONE',
    candidateCount: previewCandidates.length,
    supplyInjection,
    healthCounts,
    signalCounts,
    candidates: previewCandidates,
    topCandidates,
    signalSourceSplit,
    fieldAvailability,
    activePassiveConfluenceCounts,
    programFlowDiagnostics,
    programFlowEvidenceTrace,
    programFlowUpstreamPopulationTrace: programPopulation.trace,
    safety: {
      providerIssueAsBearish: false,
      unknownPenaltyApplied: false,
      staleAsBearish: false,
      missingAsBearish: false,
      realOrderAllowed: false,
      accumulatingUsedForLiveDecision: false,
      accumulatingAllowsStrongBuy: false,
      accumulatingAllowsWatchlistBoost: true,
      accumulatingAllowsShadowTracking: true,
    },
  };
  const summaryTraceId = createTraceId('supply');
  logVisibilityEvent({
    visibility: 'SUMMARY',
    category: 'SUPPLY',
    sourceCommand: '/normal_supply_preview',
    traceId: summaryTraceId,
    message:
      `[SUPPLY_PREVIEW_SUMMARY] ` +
      `mode=${NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE} ` +
      `candidateCount=${lastNormalSupplyPreview.candidateCount} ` +
      `injected=${supplyInjection.injected} verified=${healthCounts.VERIFIED} degraded=${healthCounts.DEGRADED} ` +
      `stale=${healthCounts.STALE} missing=${healthCounts.MISSING} ` +
      `accumulating=${signalCounts.ACCUMULATING} neutral=${signalCounts.NEUTRAL} bearish=${signalCounts.BEARISH} ` +
      `programProvider=${programFlowDiagnostics.marketProgramAvailable ? 'AVAILABLE_DIAGNOSTIC_ONLY' : 'EMPTY_DIAGNOSTIC_ONLY'} ` +
      `providerCallsAdded=0 executionImpact=NONE traceId=${summaryTraceId}`,
    summary: {
      candidateCount: lastNormalSupplyPreview.candidateCount,
      injected: supplyInjection.injected,
      healthCounts,
      signalCounts,
      programProvider: programFlowDiagnostics.marketProgramAvailable ? 'AVAILABLE_DIAGNOSTIC_ONLY' : 'EMPTY_DIAGNOSTIC_ONLY',
      executionImpact: 'NONE',
    },
    details: { preview: lastNormalSupplyPreview },
    level: 'info',
    executionImpact: 'NONE',
  });
  logSupplySignalTierRefinement(lastNormalSupplyPreview);
  logProgramFlowDiagnostics(lastNormalSupplyPreview);
  return lastNormalSupplyPreview;
}

export function getLastNormalSupplyPreview(): NormalSupplyPreview | null {
  return lastNormalSupplyPreview;
}

function logSupplySignalTierRefinement(preview: NormalSupplyPreview): void {
  logVisibilityEvent({
    visibility: 'DIAGNOSTIC',
    category: 'SUPPLY',
    sourceCommand: '/normal_supply_preview',
    dedupKey: `SUPPLY_SIGNAL_TIER_REFINEMENT:${preview.candidateCount}:${preview.signalCounts.ACCUMULATING}:NONE`,
    message:
    `[SUPPLY_SIGNAL_TIER_REFINEMENT] ` +
      `candidateCount=${preview.candidateCount} bullish=${preview.signalCounts.BULLISH} ` +
      `accumulating=${preview.signalCounts.ACCUMULATING} neutral=${preview.signalCounts.NEUTRAL} ` +
      `bearish=${preview.signalCounts.BEARISH} unusable=${preview.signalCounts.UNUSABLE} ` +
      `accumulatingUsedForLiveDecision=false executionImpact=NONE`,
    summary: { signalCounts: preview.signalCounts, executionImpact: 'NONE' },
    details: { candidates: preview.candidates.map((c) => ({ symbol: c.symbol, signal: c.supplySignal, score: c.supplyScore })) },
    level: 'info',
    executionImpact: 'NONE',
  });
  const accumulating = preview.candidates.filter((candidate) => candidate.supplySignal === 'ACCUMULATING');
  if (accumulating.length > 0) {
    const traceId = createTraceId('supply_acc');
    logVisibilityEvent({
      visibility: 'SUMMARY',
      category: 'SUPPLY',
      sourceCommand: '/normal_supply_preview',
      traceId,
      message:
        `[SUPPLY_ACCUMULATING_SUMMARY] ` +
        `count=${accumulating.length} topSymbols=${accumulating.slice(0, 5).map((c) => c.name ?? c.symbol).join(',')} ` +
        `usedForLiveDecision=false shadowTracking=true executionImpact=NONE ` +
        `detailsSuppressed=${Math.max(0, accumulating.length - 5)} traceId=${traceId}`,
      summary: { count: accumulating.length, topSymbols: accumulating.slice(0, 5).map((c) => c.symbol), executionImpact: 'NONE' },
      details: { accumulating },
      level: 'info',
      executionImpact: 'NONE',
    });
  }
  for (const candidate of accumulating) {
    if (candidate.supplySignal !== 'ACCUMULATING') continue;
    logVisibilityEvent({
      visibility: 'TRACE',
      category: 'SUPPLY',
      sourceCommand: '/normal_supply_preview',
      message:
      `[SUPPLY_ACCUMULATING_DETECTED] ` +
        `symbol=${candidate.symbol} name=${candidate.name ?? 'n/a'} supplyScore=${candidate.supplyScore} ` +
        `foreignNetBuy=${candidate.foreignNetBuyAmount ?? 'N/A'} ` +
        `institutionNetBuy=${candidate.institutionNetBuyAmount ?? 'N/A'} ` +
        `reason=FOREIGN_AND_INSTITUTION_NET_BUY_BUT_BELOW_BULLISH_THRESHOLD ` +
        `usedForLiveDecision=false shadowTracking=true executionImpact=NONE`,
      summary: { symbol: candidate.symbol, supplyScore: candidate.supplyScore, executionImpact: 'NONE' },
      details: { candidate },
      level: 'info',
      executionImpact: 'NONE',
    });
  }
}

const CONFLUENCE_LABELS: ActivePassiveConfluence[] = [
  'ACTIVE_PASSIVE_CONFIRMED_BUY',
  'ACTIVE_BUYING_ONLY',
  'PASSIVE_BUYING_ONLY',
  'ACTIVE_PASSIVE_CONFIRMED_SELL',
  'ACTIVE_SELLING_ONLY',
  'PASSIVE_SELLING_ONLY',
  'MIXED_FLOW',
  'NEUTRAL_FLOW',
  'PROGRAM_FLOW_UNAVAILABLE',
];

const PROGRAM_FLOW_NOT_AVAILABLE_STOCK: ProgramFlowDiagnostic['stockLevel'] = {
  available: false,
  signal: 'UNAVAILABLE',
  sourceProvider: 'NONE',
  providerIssue: false,
  marketSignal: false,
  reason: 'PROGRAM_FLOW_NOT_WIRED_OR_NOT_AVAILABLE',
  diagnosticOnly: true,
  executionImpact: 'NONE',
};


const PROGRAM_FLOW_NOT_AVAILABLE_MARKET: ProgramFlowDiagnostic['marketLevel'] = {
  available: false,
  signal: 'UNAVAILABLE',
  sourceProvider: 'NONE',
  providerIssue: false,
  marketSignal: false,
  reason: 'PROGRAM_FLOW_NOT_WIRED_OR_NOT_AVAILABLE',
  diagnosticOnly: true,
  executionImpact: 'NONE',
};

function buildProgramFlowUpstreamPopulation<T extends CandidateWithSupplyContext>(
  rawCandidates: T[],
  marketProgramFlowRaw: unknown,
  latestIntradayProgramFlowSnapshot?: IntradayProgramFlowSnapshot | null,
): ProgramFlowUpstreamPopulationResult {
  const trace = emptyProgramFlowUpstreamPopulationTrace(rawCandidates.length > 0);
  const stockCarryBySymbol = new Map<string, ProgramFlowCarryValue>();

  for (const candidate of rawCandidates) {
    const symbol = candidatePreviewSymbol(candidate);
    if (!symbol) continue;
    const supplyContext = candidate.preflight?.supplyContext ?? candidate.supplyContext ?? buildMissingContext(symbol);
    const contextRecords = candidateProgramContextRecords(candidate, supplyContext);
    const fieldState = programNetBuyAmountFieldState(contextRecords);
    if (fieldState.created) {
      trace.stockLevel.programNetBuyAmountFieldCreated = true;
      trace.stockLevel.candidateContextHasField = true;
      if (fieldState.nonNull) trace.stockLevel.programNetBuyAmountNonNullCount += 1;
      else {
        trace.stockLevel.programNetBuyAmountNullCount += 1;
        trace.stockLevel.candidateContextValueNull = true;
      }
    }

    const sourceRecords = stockUpstreamSourceRecords(candidate, symbol, latestIntradayProgramFlowSnapshot);
    accumulateStockSourceTrace(trace, sourceRecords.latestIntradayProgramFlowSnapshot.all, 'SNAPSHOT');
    accumulateStockSourceTrace(trace, sourceRecords.snapshot.all, 'SNAPSHOT');
    accumulateStockSourceTrace(trace, sourceRecords.cache.all, 'CACHE');
    accumulateStockSourceTrace(trace, sourceRecords.programTrading.all, 'PROGRAM_TRADING');

    const selected =
      toStockCarry('CANDIDATE_CONTEXT', contextRecords, 'KIS_API', [
        ...STOCK_PROGRAM_NET_AMOUNT_KEYS,
        ...STOCK_PROGRAM_NET_BUY_KEYS,
      ]) ??
      toStockCarry('LATEST_INTRADAY_PROGRAM_FLOW_SNAPSHOT', sourceRecords.latestIntradayProgramFlowSnapshot.matched, 'SNAPSHOT') ??
      toStockCarry('LATEST_INTRADAY_PROGRAM_SNAPSHOT', sourceRecords.snapshot.matched, 'SNAPSHOT') ??
      toStockCarry('SUPPLY_SNAPSHOT_CACHE', sourceRecords.cache.matched, 'CACHE') ??
      toStockCarry('PROGRAM_TRADING_DIAGNOSTIC', sourceRecords.programTrading.matched, 'SNAPSHOT');

    if (selected) {
      stockCarryBySymbol.set(symbol, selected);
      trace.stockLevel.carrySuccessCount += 1;
      if (trace.stockLevel.carrySource === 'NONE') trace.stockLevel.carrySource = selected.source;
    } else if (fieldState.created && !fieldState.nonNull) {
      trace.stockLevel.carryNullCount += 1;
    }
  }

  const marketResult = buildMarketProgramCarry(rawCandidates, marketProgramFlowRaw, latestIntradayProgramFlowSnapshot);
  trace.marketLevel = marketResult.trace;
  trace.stockLevel.breakPoint = chooseStockPopulationBreakPoint(trace.stockLevel);
  return {
    trace,
    stockCarryBySymbol,
    marketCarry: marketResult.carry,
    marketProgramFlowRaw: marketResult.carriedRaw,
  };
}

function emptyProgramFlowUpstreamPopulationTrace(carryAttempted: boolean): ProgramFlowUpstreamPopulationTrace {
  return {
    stockLevel: {
      programNetBuyAmountFieldCreated: false,
      programNetBuyAmountNullCount: 0,
      programNetBuyAmountNonNullCount: 0,
      candidateContextHasField: false,
      candidateContextValueNull: false,
      snapshotContextFound: false,
      snapshotProgramRowsFound: 0,
      snapshotProgramRowsWithValue: 0,
      cacheContextFound: false,
      cacheProgramRowsFound: 0,
      cacheProgramRowsWithValue: 0,
      programTradingContextFound: false,
      programTradingRowsFound: 0,
      programTradingRowsWithValue: 0,
      carryAttempted,
      carrySource: 'NONE',
      carrySuccessCount: 0,
      carryNullCount: 0,
      breakPoint: 'UNKNOWN',
    },
    marketLevel: {
      marketProgramNetBuyFieldCreated: false,
      marketProgramNetBuyNull: false,
      programMarketContextFound: false,
      programMarketValueFound: false,
      latestIntradayMarketProgramSnapshotFound: false,
      latestIntradayMarketProgramValueFound: false,
      cacheContextFound: false,
      cacheValueFound: false,
      carryAttempted,
      carrySource: 'NONE',
      breakPoint: 'UNKNOWN',
    },
    providerCallsAdded: 0,
    executionImpact: 'NONE',
  };
}

function candidateProgramContextRecords(
  candidate: CandidateWithSupplyContext,
  supplyContext: PerSymbolSupplyContext,
): Record<string, unknown>[] {
  const maybeCandidate = candidate as Record<string, unknown>;
  return directRecordsFromItems([
    supplyContext,
    candidate.preflight?.supplyContext,
    candidate.gateContext?.supplyContext,
    candidate.scoringContext?.supplyContext,
    candidate.supplyContext,
    maybeCandidate,
  ]);
}

function accumulateStockSourceTrace(
  trace: ProgramFlowUpstreamPopulationTrace,
  records: Record<string, unknown>[],
  source: 'SNAPSHOT' | 'CACHE' | 'PROGRAM_TRADING',
): void {
  const rowsFound = countRowsWithAnyProgramKey(records, STOCK_PROGRAM_SCAN_KEYS);
  const rowsWithValue = countRowsWithParsableProgramValue(records, STOCK_PROGRAM_SCAN_KEYS);
  if (source === 'SNAPSHOT') {
    trace.stockLevel.snapshotContextFound ||= records.length > 0;
    trace.stockLevel.snapshotProgramRowsFound += rowsFound;
    trace.stockLevel.snapshotProgramRowsWithValue += rowsWithValue;
  } else if (source === 'CACHE') {
    trace.stockLevel.cacheContextFound ||= records.length > 0;
    trace.stockLevel.cacheProgramRowsFound += rowsFound;
    trace.stockLevel.cacheProgramRowsWithValue += rowsWithValue;
  } else {
    trace.stockLevel.programTradingContextFound ||= records.length > 0;
    trace.stockLevel.programTradingRowsFound += rowsFound;
    trace.stockLevel.programTradingRowsWithValue += rowsWithValue;
  }
}

function toStockCarry(
  source: ProgramFlowStockCarrySource,
  records: Record<string, unknown>[],
  sourceProvider: ProgramFlowSourceProvider,
  keys: string[] = STOCK_PROGRAM_SCAN_KEYS,
): ProgramFlowCarryValue | undefined {
  const normalized = firstOkProgramValueFromRecords(records, keys);
  if (!normalized) return undefined;
  return {
    source,
    key: normalized.key,
    value: normalized.value,
    normalized,
    sourceProvider,
  };
}

function chooseStockPopulationBreakPoint(
  stock: ProgramFlowUpstreamPopulationTrace['stockLevel'],
): ProgramFlowStockEvidenceBreakPoint {
  if (stock.carrySuccessCount > 0) {
    if (
      stock.carrySource === 'LATEST_INTRADAY_PROGRAM_FLOW_SNAPSHOT' ||
      stock.carrySource === 'LATEST_INTRADAY_PROGRAM_SNAPSHOT'
    ) return 'PROGRAM_VALUE_CARRIED_FROM_SNAPSHOT';
    if (stock.carrySource === 'SUPPLY_SNAPSHOT_CACHE') return 'PROGRAM_VALUE_CARRIED_FROM_CACHE';
    if (stock.carrySource === 'PROGRAM_TRADING_DIAGNOSTIC') return 'PROGRAM_VALUE_CARRIED_FROM_PROGRAM_TRADING';
    return 'UNKNOWN';
  }
  if (stock.snapshotContextFound && stock.snapshotProgramRowsFound === 0) return 'SNAPSHOT_PROGRAM_ROWS_MISSING';
  if (stock.snapshotProgramRowsFound > 0 && stock.snapshotProgramRowsWithValue === 0) return 'SNAPSHOT_PROGRAM_VALUE_NULL';
  if (stock.cacheContextFound && stock.cacheProgramRowsFound === 0) return 'CACHE_PROGRAM_ROWS_MISSING';
  if (stock.cacheProgramRowsFound > 0 && stock.cacheProgramRowsWithValue === 0) return 'CACHE_PROGRAM_VALUE_NULL';
  if (stock.programTradingContextFound && stock.programTradingRowsWithValue === 0) return 'PROGRAM_TRADING_VALUE_NULL';
  if (stock.programNetBuyAmountFieldCreated && stock.programNetBuyAmountNullCount > 0) return 'NO_UPSTREAM_PROGRAM_VALUE';
  return 'UNKNOWN';
}

function buildMarketProgramCarry<T extends CandidateWithSupplyContext>(
  rawCandidates: T[],
  marketProgramFlowRaw: unknown,
  latestIntradayProgramFlowSnapshot?: IntradayProgramFlowSnapshot | null,
): {
  trace: ProgramFlowUpstreamPopulationTrace['marketLevel'];
  carry?: ProgramMarketCarryValue;
  carriedRaw?: Record<string, unknown>;
} {
  const root = asRecord(marketProgramFlowRaw);
  const candidateSnapshots = rawCandidates.flatMap((candidate) => marketSnapshotItems(candidate as Record<string, unknown>));
  const candidateCaches = rawCandidates.flatMap((candidate) => marketCacheItems(candidate as Record<string, unknown>));
  const latestSnapshotItems = latestIntradayProgramFlowSnapshot
    ? [latestIntradayProgramFlowSnapshot.marketProgram]
    : [];
  const contextRecords = directRecordsFromItems([
    root,
    root?.programMarket,
    root?.marketProgram,
    root?.marketProgramFlow,
    root?.programToday,
    root?.programTrading,
  ]);
  const snapshotRecords = collectUpstreamProgramRecords([
    ...latestSnapshotItems,
    root?.latestIntradayMarketProgramSnapshot,
    root?.intradayMarketProgramSnapshot,
    root?.programTradingSnapshot,
    root?.snapshot,
    root?.latestSnapshot,
    root?.latestSanitizedSnapshot,
    ...candidateSnapshots,
  ]);
  const cacheRecords = collectUpstreamProgramRecords([
    root?.programMarketCache,
    root?.programTradingCache,
    root?.cache,
    ...candidateCaches,
  ]);
  const marketContextRecords = marketLevelProgramRecords(contextRecords);
  const marketSnapshotRecords = marketLevelProgramRecords(snapshotRecords);
  const marketCacheRecords = marketLevelProgramRecords(cacheRecords);
  const contextValue = firstOkProgramValueFromRecords(marketContextRecords, MARKET_PROGRAM_NUMERIC_KEYS);
  const snapshotValue = firstOkProgramValueFromRecords(marketSnapshotRecords, MARKET_PROGRAM_NUMERIC_KEYS);
  const cacheValue = firstOkProgramValueFromRecords(marketCacheRecords, MARKET_PROGRAM_NUMERIC_KEYS);
  const contextState = marketProgramNetBuyFieldState(contextRecords);
  const trace: ProgramFlowUpstreamPopulationTrace['marketLevel'] = {
    marketProgramNetBuyFieldCreated: contextState.created,
    marketProgramNetBuyNull: contextState.created && !contextState.nonNull,
    programMarketContextFound: marketContextRecords.length > 0,
    programMarketValueFound: Boolean(contextValue),
    latestIntradayMarketProgramSnapshotFound: marketSnapshotRecords.length > 0,
    latestIntradayMarketProgramValueFound: Boolean(snapshotValue),
    cacheContextFound: marketCacheRecords.length > 0,
    cacheValueFound: Boolean(cacheValue),
    carryAttempted: rawCandidates.length > 0 || Boolean(root),
    carrySource: contextValue ? 'PROGRAM_MARKET_CONTEXT' : snapshotValue ? 'LATEST_INTRADAY_MARKET_PROGRAM_SNAPSHOT' : cacheValue ? 'PROGRAM_MARKET_CACHE' : 'NONE',
    breakPoint: 'UNKNOWN',
  };
  const selected = contextValue
    ? toMarketCarry('PROGRAM_MARKET_CONTEXT', contextValue, normalizeProgramSource(contextRecords[0]?.sourceProvider ?? contextRecords[0]?.source ?? 'NONE'))
    : snapshotValue
      ? toMarketCarry('LATEST_INTRADAY_MARKET_PROGRAM_SNAPSHOT', snapshotValue, 'SNAPSHOT')
      : cacheValue
        ? toMarketCarry('PROGRAM_MARKET_CACHE', cacheValue, 'CACHE')
        : undefined;
  trace.breakPoint = chooseMarketPopulationBreakPoint(trace);
  if (!selected) return { trace };
  if (selected.source === 'PROGRAM_MARKET_CONTEXT') return { trace, carry: selected };
  return {
    trace,
    carry: selected,
    carriedRaw: {
      marketProgramNetBuy: selected.value,
      sourceProvider: selected.sourceProvider,
      providerIssue: false,
      marketSignal: true,
      programMarketSignal: signalFromNetBuy(selected.value),
    },
  };
}

function toMarketCarry(
  source: ProgramFlowMarketCarrySource,
  normalized: ProgramFlowValueNormalizationResult & { key: string; value: number },
  sourceProvider: ProgramFlowSourceProvider,
): ProgramMarketCarryValue {
  return {
    source,
    key: normalized.key,
    value: normalized.value,
    normalized,
    sourceProvider,
  };
}

function chooseMarketPopulationBreakPoint(
  market: ProgramFlowUpstreamPopulationTrace['marketLevel'],
): ProgramFlowMarketEvidenceBreakPoint {
  if (market.carrySource === 'LATEST_INTRADAY_MARKET_PROGRAM_SNAPSHOT') return 'MARKET_PROGRAM_VALUE_CARRIED_FROM_SNAPSHOT';
  if (market.carrySource === 'PROGRAM_MARKET_CACHE') return 'MARKET_PROGRAM_VALUE_CARRIED_FROM_CACHE';
  if (market.latestIntradayMarketProgramSnapshotFound && !market.latestIntradayMarketProgramValueFound) return 'INTRADAY_MARKET_PROGRAM_VALUE_NULL';
  if (market.cacheContextFound && !market.cacheValueFound) return 'PROGRAM_MARKET_CACHE_VALUE_NULL';
  if (market.programMarketContextFound && market.marketProgramNetBuyNull) return 'NO_UPSTREAM_MARKET_PROGRAM_VALUE';
  if (!market.programMarketContextFound) return 'PROGRAM_MARKET_CONTEXT_MISSING';
  return 'UNKNOWN';
}

function logProgramFlowDiagnostics(preview: NormalSupplyPreview): void {
  const stockProgramAvailable = preview.fieldAvailability.stockProgramAvailable;
  const marketProgramAvailable = preview.fieldAvailability.marketProgramAvailable;
  const upstream = preview.programFlowDiagnostics.upstreamPopulation;
  const traceProgram = (message: string) => logSupplyPreviewTrace(message, {
    candidateCount: preview.candidateCount,
    reason: preview.programFlowDiagnostics.reason,
    nextAction: preview.programFlowDiagnostics.nextAction,
  });
  traceProgram(
    `[NORMAL_SUPPLY_PREVIEW_PROGRAM_EVIDENCE_TRACE_DONE] ` +
      `candidateCount=${preview.candidateCount} stockProgramRowsWithAnyProgramKey=${preview.programFlowDiagnostics.stockProgramRowsWithAnyProgramKey} ` +
      `stockProgramRowsWithNumericProgramValue=${preview.programFlowDiagnostics.stockProgramRowsWithNumericProgramValue} ` +
      `marketProgramContextFound=${preview.programFlowDiagnostics.marketProgramContextFound} ` +
      `marketProgramFieldsFound=${formatList(preview.programFlowDiagnostics.marketProgramFieldsFound)} ` +
      `marketProgramNumericFieldsFound=${formatList(preview.programFlowDiagnostics.marketProgramNumericFieldsFound)} ` +
      `reason=${preview.programFlowDiagnostics.reason} nextAction=${preview.programFlowDiagnostics.nextAction} ` +
      `providerCallsAdded=0 executionImpact=NONE`,
  );
  traceProgram(
    `[NORMAL_SUPPLY_PREVIEW_PROGRAM_UPSTREAM_POPULATION_DONE] ` +
      `candidateCount=${preview.candidateCount} carrySource=${upstream.stockLevel.carrySource} ` +
      `carrySuccessCount=${upstream.stockLevel.carrySuccessCount} ` +
      `snapshotRowsWithValue=${upstream.stockLevel.snapshotProgramRowsWithValue} ` +
      `cacheRowsWithValue=${upstream.stockLevel.cacheProgramRowsWithValue} ` +
      `programTradingRowsWithValue=${upstream.stockLevel.programTradingRowsWithValue} ` +
      `marketCarrySource=${upstream.marketLevel.carrySource} ` +
      `marketProgramValueFound=${upstream.marketLevel.programMarketValueFound || upstream.marketLevel.latestIntradayMarketProgramValueFound || upstream.marketLevel.cacheValueFound} ` +
      `reason=${preview.programFlowDiagnostics.reason} nextAction=${preview.programFlowDiagnostics.nextAction} ` +
      `providerCallsAdded=0 executionImpact=NONE`,
  );
  traceProgram(
    `[INTRADAY_PROGRAM_FLOW_CARRY_DONE] ` +
      `candidateCount=${preview.candidateCount} carrySource=${upstream.stockLevel.carrySource} ` +
      `carrySuccessCount=${upstream.stockLevel.carrySuccessCount} ` +
      `snapshotRowsWithValue=${upstream.stockLevel.snapshotProgramRowsWithValue} ` +
      `cacheRowsWithValue=${upstream.stockLevel.cacheProgramRowsWithValue} ` +
      `programTradingRowsWithValue=${upstream.stockLevel.programTradingRowsWithValue} ` +
      `marketCarrySource=${upstream.marketLevel.carrySource} ` +
      `marketProgramValueFound=${upstream.marketLevel.programMarketValueFound || upstream.marketLevel.latestIntradayMarketProgramValueFound || upstream.marketLevel.cacheValueFound} ` +
      `reason=${preview.programFlowDiagnostics.reason} nextAction=${preview.programFlowDiagnostics.nextAction} ` +
      `providerCallsAdded=0 executionImpact=NONE`,
  );
  if (upstream.stockLevel.carrySuccessCount > 0 && upstream.stockLevel.carrySource !== 'CANDIDATE_CONTEXT') {
    traceProgram(
      `[NORMAL_SUPPLY_PREVIEW_PROGRAM_VALUE_CARRIED] ` +
        `scope=STOCK source=${upstream.stockLevel.carrySource} rows=${upstream.stockLevel.carrySuccessCount} ` +
        `diagnosticOnly=true executionImpact=NONE`,
    );
    traceProgram(
      `[INTRADAY_PROGRAM_FLOW_VALUE_CARRIED] ` +
        `scope=STOCK source=${upstream.stockLevel.carrySource} rows=${upstream.stockLevel.carrySuccessCount} ` +
        `diagnosticOnly=true executionImpact=NONE`,
    );
  } else if (upstream.stockLevel.carrySuccessCount === 0 && upstream.stockLevel.programNetBuyAmountFieldCreated) {
    traceProgram(
      `[NORMAL_SUPPLY_PREVIEW_PROGRAM_UPSTREAM_VALUE_MISSING] ` +
        `scope=STOCK breakPoint=${upstream.stockLevel.breakPoint} reason=${preview.programFlowDiagnostics.reason} ` +
        `providerCallsAdded=0 executionImpact=NONE`,
    );
    traceProgram(
      `[INTRADAY_PROGRAM_FLOW_UPSTREAM_VALUE_MISSING] ` +
        `scope=STOCK breakPoint=${upstream.stockLevel.breakPoint} reason=${preview.programFlowDiagnostics.reason} ` +
        `providerCallsAdded=0 executionImpact=NONE`,
    );
  }
  if (upstream.marketLevel.carrySource !== 'NONE' && upstream.marketLevel.carrySource !== 'PROGRAM_MARKET_CONTEXT') {
    traceProgram(
      `[NORMAL_SUPPLY_PREVIEW_PROGRAM_VALUE_CARRIED] ` +
        `scope=MARKET source=${upstream.marketLevel.carrySource} rows=1 ` +
        `diagnosticOnly=true executionImpact=NONE`,
    );
    traceProgram(
      `[INTRADAY_PROGRAM_FLOW_VALUE_CARRIED] ` +
        `scope=MARKET source=${upstream.marketLevel.carrySource} rows=1 ` +
        `diagnosticOnly=true executionImpact=NONE`,
    );
  } else if (upstream.marketLevel.carrySource === 'NONE' && upstream.marketLevel.marketProgramNetBuyFieldCreated) {
    traceProgram(
      `[NORMAL_SUPPLY_PREVIEW_PROGRAM_UPSTREAM_VALUE_MISSING] ` +
        `scope=MARKET breakPoint=${upstream.marketLevel.breakPoint} reason=${preview.programFlowDiagnostics.reason} ` +
        `providerCallsAdded=0 executionImpact=NONE`,
    );
    traceProgram(
      `[INTRADAY_PROGRAM_FLOW_UPSTREAM_VALUE_MISSING] ` +
        `scope=MARKET breakPoint=${upstream.marketLevel.breakPoint} reason=${preview.programFlowDiagnostics.reason} ` +
        `providerCallsAdded=0 executionImpact=NONE`,
    );
  }
  traceProgram(
    `[NORMAL_SUPPLY_PREVIEW_PROGRAM_VALUE_NORMALIZER_DONE] ` +
      `candidateCount=${preview.candidateCount} ` +
      `stockProgramRowsWithAnyProgramKey=${preview.programFlowDiagnostics.stockProgramRowsWithAnyProgramKey} ` +
      `stockProgramRowsWithParsableProgramValue=${preview.programFlowDiagnostics.stockProgramRowsWithParsableProgramValue} ` +
      `stockProgramValueReasonTop=${preview.programFlowDiagnostics.stockProgramValueReasonTop} ` +
      `marketProgramParsable=${preview.programFlowDiagnostics.marketProgramParsableFieldsFound.length > 0} ` +
      `marketProgramValueReason=${preview.programFlowDiagnostics.marketProgramValueReasonTop} ` +
      `reason=${preview.programFlowDiagnostics.reason} nextAction=${preview.programFlowDiagnostics.nextAction} ` +
      `providerCallsAdded=0 executionImpact=NONE`,
  );
  if (stockProgramAvailable > 0) {
    traceProgram(
      `[NORMAL_SUPPLY_PREVIEW_PROGRAM_EVIDENCE_FOUND] ` +
        `scope=STOCK fieldKeys=${preview.programFlowDiagnostics.stockProgramFieldKeysTop} ` +
        `numericRows=${preview.programFlowDiagnostics.stockProgramRowsWithNumericProgramValue} ` +
        `diagnosticOnly=true executionImpact=NONE`,
    );
    traceProgram(
      `[NORMAL_SUPPLY_PREVIEW_PROGRAM_VALUE_PARSED] ` +
        `scope=STOCK field=${preview.programFlowDiagnostics.stockProgramFieldKeysTop} ` +
        `parsedCount=${preview.programFlowDiagnostics.stockProgramRowsWithParsableProgramValue} ` +
        `diagnosticOnly=true executionImpact=NONE`,
    );
  } else if (preview.programFlowDiagnostics.stockProgramRowsWithAnyProgramKey > 0) {
    traceProgram(
      `[NORMAL_SUPPLY_PREVIEW_PROGRAM_VALUE_PARSE_FAILED] ` +
        `scope=STOCK reasonTop=${preview.programFlowDiagnostics.stockProgramValueReasonTop} ` +
        `diagnosticOnly=true executionImpact=NONE`,
    );
  }
  if (marketProgramAvailable) {
    traceProgram(
      `[NORMAL_SUPPLY_PREVIEW_PROGRAM_EVIDENCE_FOUND] ` +
        `scope=MARKET fieldKeys=${formatList(preview.programFlowDiagnostics.marketProgramNumericFieldsFound)} ` +
        `numericRows=1 diagnosticOnly=true executionImpact=NONE`,
    );
    traceProgram(
      `[NORMAL_SUPPLY_PREVIEW_PROGRAM_VALUE_PARSED] ` +
        `scope=MARKET field=${formatList(preview.programFlowDiagnostics.marketProgramParsableFieldsFound)} ` +
        `parsedCount=1 diagnosticOnly=true executionImpact=NONE`,
    );
  } else if (preview.programFlowDiagnostics.marketProgramFieldsFound.length > 0) {
    traceProgram(
      `[NORMAL_SUPPLY_PREVIEW_PROGRAM_VALUE_PARSE_FAILED] ` +
        `scope=MARKET reasonTop=${preview.programFlowDiagnostics.marketProgramValueReasonTop} ` +
        `diagnosticOnly=true executionImpact=NONE`,
    );
  }
  const contamination = preview.candidates.filter((candidate) =>
    candidate.programFlow?.stockLevel.available === false && candidate.supplySignal === 'BEARISH' && !candidate.marketSignal,
  ).length;
  if (contamination > 0) {
    console.warn(
      `[NORMAL_SUPPLY_PREVIEW_PROGRAM_FLOW_CONTAMINATION] ` +
        `reason=PROGRAM_MISSING_WAS_TREATED_AS_BEARISH affected=${contamination} executionImpact=NONE severity=warn`,
    );
    console.warn(
      `[INTRADAY_PROGRAM_FLOW_CONTAMINATION] ` +
        `reason=PROGRAM_NULL_WAS_TREATED_AS_BEARISH affected=${contamination} executionImpact=NONE severity=warn`,
    );
  }
}

function buildActivePassiveConfluenceCounts(candidates: NormalSupplyPreviewCandidate[]): ActivePassiveConfluenceCounts {
  const counts = Object.fromEntries(CONFLUENCE_LABELS.map((label) => [label, 0])) as ActivePassiveConfluenceCounts;
  for (const candidate of candidates) counts[candidate.activePassiveConfluence] += 1;
  return counts;
}


function countStockProgramKeyRows<T extends CandidateWithSupplyContext>(rawCandidates: T[]): number {
  let rows = 0;
  for (const candidate of rawCandidates) {
    const supplyContext = candidate.preflight?.supplyContext ?? candidate.supplyContext ?? buildMissingContext(candidatePreviewSymbol(candidate));
    const records = candidateProgramRecords(candidate, supplyContext);
    if (records.some((record) => Object.keys(record).some(isStockProgramScanKey))) rows += 1;
  }
  return rows;
}

function hasCandidateProgramContainer<T extends CandidateWithSupplyContext>(rawCandidates: T[], keys: string[]): boolean {
  return rawCandidates.some((candidate) => {
    const record = candidate as Record<string, unknown>;
    return keys.some((key) => record[key] !== undefined && record[key] !== null);
  });
}

function buildMarketProgramCarryForensicTrace(
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
    macroStateProgramSource: macro ? normalizeProgramSource(macro.programSource ?? macro.sourceProvider ?? macro.source) : 'N/A',
    macroStateProgramNetBuyAmountPresent: Boolean(macroValue?.ok && macroValue.value !== undefined),
    macroStateProgramNetBuyAmountValue: macroValue?.ok && macroValue.value !== undefined ? macroValue.value : 'N/A',
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
  if (input.payload && input.payloadValue && !input.payloadValue.ok) return 'MARKET_PROGRAM_CONSUMER_PARSE_FAILED';
  const source = input.macro ? normalizeProgramSource(input.macro.programSource ?? input.macro.sourceProvider ?? input.macro.source) : 'NONE';
  if (source === 'NONE' || input.upstream.breakPoint === 'NO_UPSTREAM_MARKET_PROGRAM_VALUE') {
    return 'MARKET_PROGRAM_UPSTREAM_VALUE_MISSING_REGULAR_SESSION';
  }
  return input.upstream.breakPoint;
}

function buildPerStockProgramCarryForensicTrace<T extends CandidateWithSupplyContext>(
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

function buildProgramFlowDiagnostics(
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
    marketProgramProviderIssue: sessionGuard.programFlowExpected
      ? marketProgramFlow.providerIssue || evidenceTrace.marketLevel.result === 'SESSION_CLOSED_DIAGNOSTIC_ONLY'
      : false,
    marketProgramMarketSignal: marketProgramFlow.marketSignal,
    marketProgramContextFound: evidenceTrace.marketLevel.fieldsFound.length > 0 || evidenceTrace.marketLevel.programTradingContextFound || evidenceTrace.marketLevel.programMarketRouterResultFound || evidenceTrace.marketLevel.programTodayContextFound || evidenceTrace.marketLevel.cacheContextFound || evidenceTrace.marketLevel.snapshotContextFound,
    marketProgramFieldsFound: evidenceTrace.marketLevel.fieldsFound,
    marketProgramNumericFieldsFound: evidenceTrace.marketLevel.numericFieldsFound,
    marketProgramParsableFieldsFound: evidenceTrace.marketLevel.parsableFieldsFound,
    marketProgramValueReasonDistribution: evidenceTrace.marketLevel.valueReasonDistribution,
    marketProgramValueReasonTop: formatReasonDistribution(evidenceTrace.marketLevel.valueReasonDistribution),
    marketProgramSanitizedSample: evidenceTrace.marketLevel.sanitizedSample,
    marketProgramStatusFieldsFound: evidenceTrace.marketLevel.statusFieldsFound,
    marketProgramBreakPoint: marketCarryTrace.marketProgramBreakPoint,
    marketProgramReason: evidenceTrace.marketLevel.result,
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

export function deriveNormalSupplyPreviewEngineMode(input: {
  sellOnly?: boolean;
  blockedBy?: string;
  preflightDecision?: string;
  macroGateState?: {
    regime?: string;
    sellOnlyMode?: boolean;
    diagnosticLiveEntryBlocked?: boolean;
    liveEntryBlockedReason?: string;
    bearDefenseMode?: boolean;
    vixGatingActive?: boolean;
    fomcPhase?: string;
  } | null;
  liveEntryBlockedReason?: string;
}): NormalSupplyPreviewEngineMode {
  const decision = `${input.preflightDecision ?? ''} ${input.blockedBy ?? ''}`.toUpperCase();
  const liveBlockReason = `${input.liveEntryBlockedReason ?? input.macroGateState?.liveEntryBlockedReason ?? ''}`.toUpperCase();
  const macroRegime = `${input.macroGateState?.regime ?? ''}`.toUpperCase();
  const regimeDiagnosticLiveBlocked =
    input.macroGateState?.diagnosticLiveEntryBlocked === true &&
    (macroRegime === 'R4_NEUTRAL' || macroRegime === 'R5_CAUTION');
  if (input.sellOnly || input.macroGateState?.sellOnlyMode || decision.includes('SELL_ONLY')) return 'SELL_ONLY';
  if (decision.includes('POSITION_FULL') || liveBlockReason.includes('POSITION_FULL')) return 'POSITION_FULL';
  if (
    liveBlockReason.includes('R4_NEUTRAL') ||
    liveBlockReason.includes('R5_CAUTION') ||
    liveBlockReason.includes('R6_DEFENSE') ||
    liveBlockReason.includes('VIX_BLOCK') ||
    liveBlockReason.includes('FOMC_BLOCK') ||
    regimeDiagnosticLiveBlocked ||
    input.macroGateState?.bearDefenseMode ||
    input.macroGateState?.vixGatingActive ||
    input.macroGateState?.fomcPhase === 'DAY'
  ) {
    return 'MACRO_LIVE_BLOCK';
  }
  if (decision.includes('HARD_BLOCK')) return 'HARD_BLOCK';
  if (decision.trim().length > 0) return 'PRE_FLIGHT_BLOCK';
  return 'NORMAL';
}

export function formatNormalSupplyPreviewSection(
  preview: NormalSupplyPreview | null | undefined,
  options: { maxTopCandidates?: number } = {},
): string | null {
  if (!preview) return null;
  const maxTop = options.maxTopCandidates ?? 5;
  const lines: string[] = [];
  lines.push('🧪 <b>Normal Supply Preview under SELL_ONLY (ADR-0518)</b>');
  lines.push('━━━━━━━━━━━━━━━━');
  lines.push(`mode: ${preview.engineMode}`);
  lines.push(`previewMode: ${preview.previewMode}`);
  lines.push(`source: ${preview.source}`);
  if (preview.reason) lines.push(`reason: ${preview.reason}`);
  if (preview.preflightDecision) lines.push(`preflightDecision: ${preview.preflightDecision}`);
  lines.push(`liveExecutionAllowed: ${preview.liveExecutionAllowed}`);
  lines.push(`realOrderAllowed: ${preview.realOrderAllowed}`);
  lines.push(`strongBuyAllowed: ${preview.strongBuyAllowed}`);
  lines.push(`shadowObservableAllowed: ${preview.shadowObservableAllowed}`);
  lines.push(`executionImpact: ${preview.executionImpact}`);
  lines.push('');
  lines.push(`정상모드 기준 후보 수: ${preview.candidateCount}`);
  lines.push('수급 주입 상태:');
  lines.push(`  VERIFIED: ${preview.healthCounts.VERIFIED}`);
  lines.push(`  DEGRADED: ${preview.healthCounts.DEGRADED}`);
  lines.push(`  STALE: ${preview.healthCounts.STALE}`);
  lines.push(`  MISSING: ${preview.healthCounts.MISSING}`);
  lines.push(`  UNKNOWN: ${preview.healthCounts.UNKNOWN}`);
  lines.push(`  routerConnected: ${preview.supplyInjection.routerConnected}`);
  lines.push(`  gateContextConnected: ${preview.supplyInjection.gateContextConnected}`);
  lines.push('');
  lines.push('정상모드 기준 수급 판정:');
  lines.push(`  BULLISH: ${preview.signalCounts.BULLISH}`);
  lines.push(`  ACCUMULATING: ${preview.signalCounts.ACCUMULATING}`);
  lines.push(`  NEUTRAL: ${preview.signalCounts.NEUTRAL}`);
  lines.push(`  BEARISH: ${preview.signalCounts.BEARISH}`);
  lines.push(`  UNUSABLE: ${preview.signalCounts.UNUSABLE}`);
  lines.push('');
  lines.push('상위 수급 후보:');
  if (preview.topCandidates.length === 0) {
    lines.push('  none');
  } else {
    preview.topCandidates.slice(0, maxTop).forEach((candidate, index) => {
      const name = candidate.name ? ` ${candidate.name}` : '';
      lines.push(
        `${index + 1}. ${candidate.symbol}${name} / ${candidate.summary} / supplyScore ${candidate.supplyScore}`,
      );
    });
  }
  lines.push('');
  lines.push('주의:');
  lines.push('SELL_ONLY 또는 macro live block 상태에서는 신규 매수는 차단됩니다.');
  lines.push('본 결과는 정상모드 기준 수급 진단이며 주문 영향 없습니다.');
  return lines.join('\n');
}

export function formatNormalSupplyPreviewFullSections(
  preview: NormalSupplyPreview | null | undefined,
  options: { maxTopCandidates?: number; maxChars?: number } = {},
): string[] {
  if (!preview) return [formatNormalSupplyPreviewMissingSection()];
  const sections = buildNormalSupplyPreviewFullSections(preview, options);
  return paginateNormalSupplyPreviewSections(sections, options.maxChars ?? 3500);
}

export function buildNormalSupplyPreviewFullSections(
  preview: NormalSupplyPreview,
  options: { maxTopCandidates?: number } = {},
): string[] {
  const thresholds = NORMAL_SUPPLY_SCORE_THRESHOLDS;
  const top = preview.topCandidates[0];
  const contamination =
    preview.signalSourceSplit.bearishFromProviderIssue +
    preview.signalSourceSplit.bullishFromProviderIssue +
    preview.signalSourceSplit.accumulatingFromProviderIssue;
  const sections: string[] = [];

  sections.push([
    '🧪 <b>Normal Supply Preview FULL under SELL_ONLY (ADR-0518)</b>',
    '━━━━━━━━━━━━━━━━',
    `mode: ${escapeHtmlText(preview.engineMode)}`,
    `previewMode: ${NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE}`,
    `source: ${escapeHtmlText(preview.source)}`,
    preview.reason ? `reason: ${escapeHtmlText(preview.reason)}` : '',
    preview.preflightDecision ? `preflightDecision: ${escapeHtmlText(preview.preflightDecision)}` : '',
    `liveExecutionAllowed=${preview.liveExecutionAllowed}`,
    `realOrderAllowed=${preview.realOrderAllowed}`,
    `strongBuyAllowed=${preview.strongBuyAllowed}`,
    `shadowObservableAllowed=${preview.shadowObservableAllowed}`,
    `executionImpact=${preview.executionImpact}`,
    '',
    `candidateCount=${preview.candidateCount}`,
    `routerConnected=${preview.supplyInjection.routerConnected}`,
    `gateContextConnected=${preview.supplyInjection.gateContextConnected}`,
    '',
    'Injection:',
    `  VERIFIED=${preview.healthCounts.VERIFIED}`,
    `  DEGRADED=${preview.healthCounts.DEGRADED}`,
    `  STALE=${preview.healthCounts.STALE}`,
    `  MISSING=${preview.healthCounts.MISSING}`,
    `  UNKNOWN=${preview.healthCounts.UNKNOWN}`,
    '',
    'Signal:',
    `  BULLISH=${preview.signalCounts.BULLISH}`,
    `  ACCUMULATING=${preview.signalCounts.ACCUMULATING}`,
    `  NEUTRAL=${preview.signalCounts.NEUTRAL}`,
    `  BEARISH=${preview.signalCounts.BEARISH}`,
    `  UNUSABLE=${preview.signalCounts.UNUSABLE}`,
    '',
    'Safety:',
    `  providerIssueAsBearish=${preview.safety.providerIssueAsBearish}`,
    `  unknownPenaltyApplied=${preview.safety.unknownPenaltyApplied}`,
    `  staleAsBearish=${preview.safety.staleAsBearish}`,
    `  missingAsBearish=${preview.safety.missingAsBearish}`,
    `  realOrderAllowed=${preview.safety.realOrderAllowed}`,
    `  accumulatingUsedForLiveDecision=${preview.safety.accumulatingUsedForLiveDecision}`,
    `  accumulatingAllowsStrongBuy=${preview.safety.accumulatingAllowsStrongBuy}`,
    `  accumulatingAllowsWatchlistBoost=${preview.safety.accumulatingAllowsWatchlistBoost}`,
    `  accumulatingAllowsShadowTracking=${preview.safety.accumulatingAllowsShadowTracking}`,
    `  executionImpact=${preview.executionImpact}`,
    contamination > 0 ? `  warning=PROVIDER_SIGNAL_CONTAMINATION count=${contamination}` : '',
    '',
    '📐 <b>Supply Score Threshold</b>',
    `  bullishThreshold: ${thresholds.bullishThreshold}`,
    `  accumulatingRange: ${thresholds.accumulatingThreshold}~${thresholds.bullishThreshold - 1}`,
    `  bearishThreshold: ${thresholds.bearishThreshold}`,
    `  neutralRange: ${thresholds.bearishThreshold}~${thresholds.accumulatingThreshold - 1}`,
    `  topSupplyScore: ${top?.supplyScore ?? 'N/A'}`,
    `  topSignal: ${top?.supplySignal ?? 'N/A'}`,
    `  explanation: ${escapeHtmlText(buildThresholdExplanation(top))}`,
    '',
    '📊 <b>Program Passive Proxy Availability</b> (Program Flow Availability)',
    formatAvailabilityLine('stockProgramNetBuyField', preview.fieldAvailability.stockProgramNetBuyField, preview.fieldAvailability.total),
    formatAvailabilityLine('stockProgramAvailable', preview.fieldAvailability.stockProgramAvailable, preview.fieldAvailability.total),
    formatAvailabilityLine('stockProgramRowsAvailable', preview.fieldAvailability.stockProgramRowsAvailable, preview.fieldAvailability.total),
    formatAvailabilityLine('stockProgramRowsWithAnyProgramKey', preview.fieldAvailability.stockProgramRowsWithAnyProgramKey, preview.fieldAvailability.total),
    formatAvailabilityLine('stockProgramRowsWithNumericProgramValue', preview.fieldAvailability.stockProgramRowsWithNumericProgramValue, preview.fieldAvailability.total),
    formatAvailabilityLine('stockProgramRowsWithParsableProgramValue', preview.fieldAvailability.stockProgramRowsWithParsableProgramValue, preview.fieldAvailability.total),
    `  stockProgramValueReasonTop: ${preview.fieldAvailability.stockProgramValueReasonTop}`,
    formatAvailabilityLine('programNetBuyField', preview.fieldAvailability.programNetBuyField, preview.fieldAvailability.total),
    `  marketProgramAvailable: ${preview.fieldAvailability.marketProgramAvailable}`,
    `  marketProgramSignal: ${preview.fieldAvailability.marketProgramSignal}`,
    `  marketProgramSource: ${preview.fieldAvailability.marketProgramSource}`,
    `  marketProgramContextFound: ${preview.fieldAvailability.marketProgramContextFound}`,
    `  marketProgramBreakPoint: ${preview.fieldAvailability.marketProgramBreakPoint}`,
    `  marketProgramParsableFieldsFound: ${formatList(preview.fieldAvailability.marketProgramParsableFieldsFound)}`,
    `  marketProgramValueReasonTop: ${preview.fieldAvailability.marketProgramValueReasonTop}`,
    `  marketProgramProviderIssue: ${preview.fieldAvailability.marketProgramProviderIssue}`,
    `  marketProgramMarketSignal: ${preview.fieldAvailability.marketProgramMarketSignal}`,
    `  missingProgramFlowAsBearish=${preview.fieldAvailability.missingProgramFlowAsBearish}`,
    `  programPenaltyApplied=${preview.fieldAvailability.programPenaltyApplied}`,
    `  programFlowUsedForLiveDecision=${preview.fieldAvailability.programFlowUsedForLiveDecision}`,
    `  passiveProxyUsedForLiveDecision=${preview.fieldAvailability.passiveProxyUsedForLiveDecision}`,
    `  providerCallsAdded=${preview.fieldAvailability.providerCallsAdded}`,
    `  executionImpact=${preview.fieldAvailability.executionImpact}`,
    '',
    '🔌 <b>Program Flow Wiring Forensic</b>',
    '  session:',
    `    marketSession=${preview.programFlowDiagnostics.sessionGuard.marketSession}`,
    `    isTradingDay=${preview.programFlowDiagnostics.sessionGuard.isTradingDay}`,
    `    kstTime=${preview.programFlowDiagnostics.sessionGuard.kstTime}`,
    `    programFlowExpected=${preview.programFlowDiagnostics.programFlowExpected}`,
    `    reason=${preview.programFlowDiagnostics.reason}`,
    `    providerIssueSuppressedByMarketClosed=${preview.programFlowDiagnostics.providerIssueSuppressedByMarketClosed}`,
    `    recheckWindowKST=${preview.programFlowDiagnostics.recheckWindowKST}`,
    `    nextAction=${preview.programFlowDiagnostics.nextAction}`,
    `    programNetBuyNullRootCause=${preview.programFlowDiagnostics.programNetBuyNullRootCause}`,
    '',
    '  marketCarry:',
    `    macroStateFound=${preview.programFlowDiagnostics.marketCarryTrace.macroStateFound}`,
    `    macroStateProgramSource=${preview.programFlowDiagnostics.marketCarryTrace.macroStateProgramSource}`,
    `    macroStateProgramNetBuyAmountPresent=${preview.programFlowDiagnostics.marketCarryTrace.macroStateProgramNetBuyAmountPresent}`,
    `    macroStateProgramNetBuyAmountValue=${preview.programFlowDiagnostics.marketCarryTrace.macroStateProgramNetBuyAmountValue}`,
    `    macroStateProgramArbitragePresent=${preview.programFlowDiagnostics.marketCarryTrace.macroStateProgramArbitragePresent}`,
    `    macroStateProgramFetchedAt=${preview.programFlowDiagnostics.marketCarryTrace.macroStateProgramFetchedAt}`,
    `    marketProgramFlowPayloadPresent=${preview.programFlowDiagnostics.marketCarryTrace.marketProgramFlowPayloadPresent}`,
    `    marketProgramFlowPayloadKeys=${formatList(preview.programFlowDiagnostics.marketCarryTrace.marketProgramFlowPayloadKeys)}`,
    `    marketProgramFlowPayloadSourceProvider=${preview.programFlowDiagnostics.marketCarryTrace.marketProgramFlowPayloadSourceProvider}`,
    `    marketProgramFlowProviderIssue=${preview.programFlowDiagnostics.marketCarryTrace.marketProgramFlowProviderIssue}`,
    `    marketProgramFlowExecutionImpact=${preview.programFlowDiagnostics.marketCarryTrace.marketProgramFlowExecutionImpact}`,
    `    marketProgramFlowMarketSignal=${preview.programFlowDiagnostics.marketCarryTrace.marketProgramFlowMarketSignal}`,
    `    marketProgramCarrySource=${preview.programFlowDiagnostics.marketCarryTrace.marketProgramCarrySource}`,
    `    marketProgramBreakPoint=${preview.programFlowDiagnostics.marketCarryTrace.marketProgramBreakPoint}`,
    '',
    '  stockCarry:',
    `    latestSnapshotFound=${preview.programFlowDiagnostics.stockCarryTrace.latestSnapshotFound}`,
    `    latestSnapshotCapturedAt=${preview.programFlowDiagnostics.stockCarryTrace.latestSnapshotCapturedAt}`,
    `    latestSnapshotStockRowsTotal=${preview.programFlowDiagnostics.stockCarryTrace.latestSnapshotStockRowsTotal}`,
    `    latestSnapshotRowsWithValue=${preview.programFlowDiagnostics.stockCarryTrace.latestSnapshotStockRowsWithProgramValue}`,
    `    latestSnapshotMarketProgramAvailable=${preview.programFlowDiagnostics.stockCarryTrace.latestSnapshotMarketProgramAvailable}`,
    `    perStockCarryMapSize=${preview.programFlowDiagnostics.stockCarryTrace.perStockCarryMapSize}`,
    `    candidateStockProgramFlowAttached=${preview.programFlowDiagnostics.stockCarryTrace.candidateStockProgramFlowAttached}/${preview.fieldAvailability.total}`,
    `    candidateStockProgramFlowAttachedWithValue=${preview.programFlowDiagnostics.stockCarryTrace.candidateStockProgramFlowAttachedWithValue}/${preview.fieldAvailability.total}`,
    `    candidateContextProgramNetBuyAmountFieldCreated=${preview.programFlowDiagnostics.stockCarryTrace.candidateContextProgramNetBuyAmountFieldCreated}/${preview.fieldAvailability.total}`,
    `    candidateContextProgramNetBuyAmountNonNull=${preview.programFlowDiagnostics.stockCarryTrace.candidateContextProgramNetBuyAmountNonNull}/${preview.fieldAvailability.total}`,
    `    consumerParsedStockProgramRows=${preview.programFlowDiagnostics.stockCarryTrace.consumerParsedStockProgramRows}/${preview.fieldAvailability.total}`,
    `    stockCarrySource=${preview.programFlowDiagnostics.stockCarryTrace.stockCarrySource}`,
    `    stockProgramBreakPoint=${preview.programFlowDiagnostics.stockCarryTrace.stockProgramBreakPoint}`,
    '',
    '  safety:',
    `    programMissingAsBearish=${preview.programFlowDiagnostics.programMissingAsBearish}`,
    `    programPenaltyApplied=${preview.programFlowDiagnostics.programPenaltyApplied}`,
    `    programFlowUsedForLiveDecision=${preview.programFlowDiagnostics.programFlowUsedForLiveDecision}`,
    `    passiveProxyUsedForLiveDecision=${preview.programFlowDiagnostics.passiveProxyUsedForLiveDecision}`,
    `    providerCallsAdded=${preview.programFlowDiagnostics.providerCallsAdded}`,
    `    executionImpact=${preview.programFlowDiagnostics.executionImpact}`,
    '',
    '🔀 <b>Active/Passive Proxy Confluence</b> (Active/Passive Confluence)',
    ...CONFLUENCE_LABELS.map((label) => `  ${label}: ${preview.activePassiveConfluenceCounts[label]}`),
    '',
    '📊 <b>Signal Source Split</b>',
    `  bullishFromMarketSignal: ${preview.signalSourceSplit.bullishFromMarketSignal}`,
    `  bullishFromProviderIssue: ${preview.signalSourceSplit.bullishFromProviderIssue}`,
    `  accumulatingFromMarketSignal: ${preview.signalSourceSplit.accumulatingFromMarketSignal}`,
    `  accumulatingFromProviderIssue: ${preview.signalSourceSplit.accumulatingFromProviderIssue}`,
    `  bearishFromMarketSignal: ${preview.signalSourceSplit.bearishFromMarketSignal}`,
    `  bearishFromProviderIssue: ${preview.signalSourceSplit.bearishFromProviderIssue}`,
    `  neutralFromVerifiedData: ${preview.signalSourceSplit.neutralFromVerifiedData}`,
    `  unusableFromDataQuality: ${preview.signalSourceSplit.unusableFromDataQuality}`,
    '  note: providerIssue is not a directional market signal.',
  ].filter(Boolean).join('\n'));

  const maxTop = options.maxTopCandidates ?? 10;
  const topCandidates = [...preview.candidates]
    .sort((a, b) => b.supplyScore - a.supplyScore || a.symbol.localeCompare(b.symbol))
    .slice(0, maxTop);
  sections.push([
    '📈 <b>Top Supply Candidates</b>',
    topCandidates.length === 0 ? 'none' : topCandidates.map((candidate, index) =>
      formatFullCandidateDetail(candidate, index + 1, {
        includeThreshold: true,
        includeInvalidWarning: true,
      }),
    ).join('\n\n'),
  ].join('\n'));

  const bearish = preview.candidates
    .filter((candidate) => candidate.supplySignal === 'BEARISH')
    .sort((a, b) => a.supplyScore - b.supplyScore || a.symbol.localeCompare(b.symbol));
  sections.push([
    `📉 <b>BEARISH Supply Candidates ${bearish.length}</b>`,
    bearish.length === 0 ? 'none' : bearish.map((candidate, index) =>
      formatFullCandidateDetail(candidate, index + 1, {
        includeThreshold: false,
        includeInvalidWarning: true,
      }),
    ).join('\n\n'),
  ].join('\n'));

  const unknownOrUnusable = preview.candidates
    .filter((candidate) =>
      candidate.supplySignal === 'UNUSABLE' ||
      candidate.supplyProviderHealth === 'UNKNOWN' ||
      candidate.supplyProviderHealth === 'MISSING' ||
      candidate.supplyProviderHealth === 'STALE',
    )
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  sections.push([
    '🔌 <b>Supply Field Availability</b>',
    formatAvailabilityLine('foreignNetBuyField', preview.fieldAvailability.foreignNetBuyField, preview.fieldAvailability.total),
    formatAvailabilityLine('institutionNetBuyField', preview.fieldAvailability.institutionNetBuyField, preview.fieldAvailability.total),
    formatAvailabilityLine('programNetBuyField', preview.fieldAvailability.programNetBuyField, preview.fieldAvailability.total),
    formatAvailabilityLine('stockProgramAvailable', preview.fieldAvailability.stockProgramAvailable, preview.fieldAvailability.total),
    formatAvailabilityLine('stockProgramRowsAvailable', preview.fieldAvailability.stockProgramRowsAvailable, preview.fieldAvailability.total),
    formatAvailabilityLine('semanticRowAvailable', preview.fieldAvailability.semanticRowAvailable, preview.fieldAvailability.total),
    formatAvailabilityLine('rawInvestorRowAvailable', preview.fieldAvailability.rawInvestorRowAvailable, preview.fieldAvailability.total),
    formatAvailabilityLine('selectedCandidateCarriesSemanticRow', preview.fieldAvailability.selectedCandidateCarriesSemanticRow, preview.fieldAvailability.total),
    formatAvailabilityLine('selectedCandidateCarriesActualRow', preview.fieldAvailability.selectedCandidateCarriesActualRow, preview.fieldAvailability.total),
    '',
    '⚪ <b>UNUSABLE / UNKNOWN Supply Rows</b>',
    `count=${unknownOrUnusable.length}`,
    unknownOrUnusable.length === 0 ? '' : unknownOrUnusable.map((candidate, index) =>
      formatUnknownCandidateDetail(candidate, index + 1),
    ).join('\n\n'),
    '',
    'Diagnostics:',
    '  usedForLiveDecision=false',
    '  penaltyApplied=false',
    '  unknownPenaltyApplied=false',
    '  providerCallsAdded=0',
    '  executionImpact=NONE',
  ].filter((line) => line !== '').join('\n'));

  sections.push([
    '⚪ <b>Program Passive Proxy Diagnostics</b> (Program Flow Diagnostics)',
    formatAvailabilityLine('stockProgramRowsAvailable', preview.programFlowDiagnostics.stockProgramRowsAvailable, preview.programFlowDiagnostics.total),
    formatAvailabilityLine('stockProgramRowsWithAnyProgramKey', preview.programFlowDiagnostics.stockProgramRowsWithAnyProgramKey, preview.programFlowDiagnostics.total),
    formatAvailabilityLine('stockProgramRowsWithNumericProgramValue', preview.programFlowDiagnostics.stockProgramRowsWithNumericProgramValue, preview.programFlowDiagnostics.total),
    formatAvailabilityLine('stockProgramRowsWithParsableProgramValue', preview.programFlowDiagnostics.stockProgramRowsWithParsableProgramValue, preview.programFlowDiagnostics.total),
    `  stockProgramFieldKeysTop: ${preview.programFlowDiagnostics.stockProgramFieldKeysTop}`,
    `  stockProgramValueReasonDistribution: ${preview.programFlowDiagnostics.stockProgramValueReasonTop}`,
    `  stockProgramSanitizedSampleTop: ${formatSampleList(preview.programFlowDiagnostics.stockProgramSanitizedSampleTop)}`,
    `  stockProgramBreakPoint: ${preview.programFlowDiagnostics.stockProgramBreakPoint}`,
    '',
    '  Upstream Population Trace:',
    `    programNetBuyAmountFieldCreated=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.programNetBuyAmountFieldCreated}`,
    `    programNetBuyAmountNullCount=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.programNetBuyAmountNullCount}`,
    `    programNetBuyAmountNonNullCount=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.programNetBuyAmountNonNullCount}`,
    `    candidateContextHasField=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.candidateContextHasField}`,
    `    candidateContextValueNull=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.candidateContextValueNull}`,
    `    snapshotContextFound=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.snapshotContextFound}`,
    `    snapshotProgramRowsFound=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.snapshotProgramRowsFound}`,
    `    snapshotProgramRowsWithValue=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.snapshotProgramRowsWithValue}`,
    `    cacheContextFound=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.cacheContextFound}`,
    `    cacheProgramRowsFound=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.cacheProgramRowsFound}`,
    `    cacheProgramRowsWithValue=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.cacheProgramRowsWithValue}`,
    `    programTradingContextFound=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.programTradingContextFound}`,
    `    programTradingRowsFound=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.programTradingRowsFound}`,
    `    programTradingRowsWithValue=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.programTradingRowsWithValue}`,
    `    carryAttempted=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.carryAttempted}`,
    `    carrySource=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.carrySource}`,
    `    carrySuccessCount=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.carrySuccessCount}`,
    `    carryNullCount=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.carryNullCount}`,
    `    stockProgramBreakPoint=${preview.programFlowDiagnostics.upstreamPopulation.stockLevel.breakPoint}`,
    `    reason=${preview.programFlowDiagnostics.reason}`,
    `    nextAction=${preview.programFlowDiagnostics.nextAction}`,
    '',
    '  Market Program Trace:',
    `    marketProgramNetBuyFieldCreated=${preview.programFlowDiagnostics.upstreamPopulation.marketLevel.marketProgramNetBuyFieldCreated}`,
    `    marketProgramNetBuyNull=${preview.programFlowDiagnostics.upstreamPopulation.marketLevel.marketProgramNetBuyNull}`,
    `    programMarketContextFound=${preview.programFlowDiagnostics.upstreamPopulation.marketLevel.programMarketContextFound}`,
    `    programMarketValueFound=${preview.programFlowDiagnostics.upstreamPopulation.marketLevel.programMarketValueFound}`,
    `    latestIntradayMarketProgramSnapshotFound=${preview.programFlowDiagnostics.upstreamPopulation.marketLevel.latestIntradayMarketProgramSnapshotFound}`,
    `    latestIntradayMarketProgramValueFound=${preview.programFlowDiagnostics.upstreamPopulation.marketLevel.latestIntradayMarketProgramValueFound}`,
    `    cacheContextFound=${preview.programFlowDiagnostics.upstreamPopulation.marketLevel.cacheContextFound}`,
    `    cacheValueFound=${preview.programFlowDiagnostics.upstreamPopulation.marketLevel.cacheValueFound}`,
    `    carryAttempted=${preview.programFlowDiagnostics.upstreamPopulation.marketLevel.carryAttempted}`,
    `    carrySource=${preview.programFlowDiagnostics.upstreamPopulation.marketLevel.carrySource}`,
    `    marketProgramBreakPoint=${preview.programFlowDiagnostics.upstreamPopulation.marketLevel.breakPoint}`,
    `    reason=${preview.programFlowDiagnostics.reason}`,
    `    nextAction=${preview.programFlowDiagnostics.nextAction}`,
    '',
    `  marketProgramAvailable: ${preview.programFlowDiagnostics.marketProgramAvailable}`,
    `  marketProgramSignal: ${preview.programFlowDiagnostics.marketProgramSignal}`,
    `  marketProgramSource: ${preview.programFlowDiagnostics.marketProgramSource}`,
    `  marketProgramProviderIssue: ${preview.programFlowDiagnostics.marketProgramProviderIssue}`,
    `  marketProgramMarketSignal: ${preview.programFlowDiagnostics.marketProgramMarketSignal}`,
    `  marketProgramContextFound: ${preview.programFlowDiagnostics.marketProgramContextFound}`,
    `  marketProgramFieldsFound: ${formatList(preview.programFlowDiagnostics.marketProgramFieldsFound)}`,
    `  marketProgramNumericFieldsFound: ${formatList(preview.programFlowDiagnostics.marketProgramNumericFieldsFound)}`,
    `  marketProgramParsableFieldsFound: ${formatList(preview.programFlowDiagnostics.marketProgramParsableFieldsFound)}`,
    `  marketProgramValueReasonDistribution: ${preview.programFlowDiagnostics.marketProgramValueReasonTop}`,
    `  marketProgramSanitizedSample: ${preview.programFlowDiagnostics.marketProgramSanitizedSample ? `"${escapeHtmlText(preview.programFlowDiagnostics.marketProgramSanitizedSample)}"` : 'none'}`,
    `  marketProgramStatusFieldsFound: ${formatList(preview.programFlowDiagnostics.marketProgramStatusFieldsFound)}`,
    `  marketProgramBreakPoint: ${preview.programFlowDiagnostics.marketProgramBreakPoint}`,
    `  marketProgramReason: ${preview.programFlowDiagnostics.marketProgramReason}`,
    '',
    `  reason: ${preview.programFlowDiagnostics.reason}`,
    `  contextFound: ${preview.programFlowDiagnostics.contextFound}`,
    `  wiredButNoFields: ${preview.programFlowDiagnostics.wiredButNoFields}`,
    `  programMissingAsBearish=${preview.programFlowDiagnostics.programMissingAsBearish}`,
    `  programPenaltyApplied=${preview.programFlowDiagnostics.programPenaltyApplied}`,
    `  programFlowUsedForLiveDecision=${preview.programFlowDiagnostics.programFlowUsedForLiveDecision}`,
    `  passiveProxyUsedForLiveDecision=${preview.programFlowDiagnostics.passiveProxyUsedForLiveDecision}`,
    `  providerCallsAdded=${preview.programFlowDiagnostics.providerCallsAdded}`,
    `  nextAction: ${preview.programFlowDiagnostics.nextAction}`,
    `  executionImpact=${preview.programFlowDiagnostics.executionImpact}`,
  ].join('\n'));

  return sections;
}

function paginateNormalSupplyPreviewSections(sections: string[], maxChars: number): string[] {
  const pages: string[] = [];
  let current: string[] = [];
  let currentLength = 0;
  const pushCurrent = () => {
    if (current.length === 0) return;
    pages.push(current.join('\n\n'));
    current = [];
    currentLength = 0;
  };

  for (const section of sections.flatMap((item) => splitOversizedSectionByLine(item, maxChars))) {
    const nextLength = currentLength + (current.length > 0 ? 2 : 0) + section.length;
    if (current.length > 0 && nextLength > maxChars) pushCurrent();
    current.push(section);
    currentLength += (current.length > 1 ? 2 : 0) + section.length;
  }
  pushCurrent();

  const total = Math.max(1, pages.length);
  return pages.map((body, index) => [
    `🔬 [normal_supply_preview full mode] Page ${index + 1}/${total}`,
    '━━━━━━━━━━━━━━━━',
    body,
  ].join('\n'));
}

function splitOversizedSectionByLine(section: string, maxChars: number): string[] {
  if (section.length <= maxChars) return [section];
  const blocks = section.split('\n\n');
  if (blocks.length > 1) return splitOversizedSectionByBlock(blocks, maxChars);
  const chunks: string[] = [];
  let lines: string[] = [];
  let length = 0;
  for (const line of section.split('\n')) {
    const nextLength = length + (lines.length > 0 ? 1 : 0) + line.length;
    if (lines.length > 0 && nextLength > maxChars) {
      chunks.push(lines.join('\n'));
      lines = [];
      length = 0;
    }
    if (line.length > maxChars) {
      if (lines.length > 0) {
        chunks.push(lines.join('\n'));
        lines = [];
        length = 0;
      }
      chunks.push(...splitLongLine(line, maxChars));
      continue;
    }
    lines.push(line);
    length += (lines.length > 1 ? 1 : 0) + line.length;
  }
  if (lines.length > 0) chunks.push(lines.join('\n'));
  return chunks;
}

function splitOversizedSectionByBlock(blocks: string[], maxChars: number): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let length = 0;
  const flush = () => {
    if (current.length === 0) return;
    chunks.push(current.join('\n\n'));
    current = [];
    length = 0;
  };
  for (const block of blocks) {
    if (block.length > maxChars) {
      flush();
      chunks.push(...splitOversizedSectionByLine(block, maxChars));
      continue;
    }
    const nextLength = length + (current.length > 0 ? 2 : 0) + block.length;
    if (current.length > 0 && nextLength > maxChars) flush();
    current.push(block);
    length += (current.length > 1 ? 2 : 0) + block.length;
  }
  flush();
  return chunks;
}

function splitLongLine(line: string, maxChars: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < line.length; index += maxChars) {
    chunks.push(line.slice(index, index + maxChars));
  }
  return chunks;
}

export function formatNormalSupplyPreviewMissingSection(error?: string): string {
  return [
    '🧪 <b>Normal Supply Preview under SELL_ONLY (ADR-0518)</b>',
    '━━━━━━━━━━━━━━━━',
    'status: NOT_COLLECTED',
    `previewMode: ${NORMAL_SUPPLY_DIAGNOSTIC_PREVIEW_MODE}`,
    'liveExecutionAllowed: false',
    'realOrderAllowed: false',
    'shadowObservableAllowed: true',
    'executionImpact: NONE',
    ...(error ? [`error: ${error}`] : []),
    'nextAction: run /normal_supply_preview or wait for next diagnostic scan',
  ].join('\n');
}

export function __resetNormalSupplyPreviewForTests(): void {
  lastNormalSupplyPreview = null;
}

function toPreviewCandidate(
  candidate: CandidateWithSupplyContext,
  marketProgramFlow: ProgramFlowDiagnostic['marketLevel'],
  stockCarry?: ProgramFlowCarryValue,
): NormalSupplyPreviewCandidate | null {
  const symbol = candidatePreviewSymbol(candidate);
  if (!symbol) return null;
  const ctx = candidate.preflight?.supplyContext ?? candidate.supplyContext;
  const supplyContext = ctx ?? buildMissingContext(symbol);
  const trace = candidate.supplyProviderHealth ?? {};
  const health = normalizeHealth(supplyContext.supplyProviderHealth);
  const providerIssue = supplyContext.providerIssue === true;
  const marketSignal = supplyContext.marketSignal === true;
  const supplyScore = deriveSupplyScore(supplyContext);
  const signal = classifySupplySignal({
    supplyScore,
    dataStatus: health,
    providerIssue,
    marketSignal,
    foreignNetBuy: supplyContext.foreignNetBuyAmount,
    institutionNetBuy: supplyContext.institutionNetBuyAmount,
  });
  const stockProgramFlow = extractStockProgramFlow(candidate, supplyContext, stockCarry);
  const programFlow: ProgramFlowDiagnostic = { stockLevel: stockProgramFlow, marketLevel: marketProgramFlow };
  const passiveProxySignal = selectPassiveProxySignal(stockProgramFlow, marketProgramFlow);
  const activePassiveConfluence = classifyActivePassiveConfluence({
    foreignNetBuy: supplyContext.foreignNetBuyAmount,
    institutionNetBuy: supplyContext.institutionNetBuyAmount,
    passiveProxySignal,
  });
  const reason = describeSupplyReason(supplyContext, signal, supplyScore);
  return {
    symbol,
    name: typeof (candidate as { name?: unknown }).name === 'string' ? (candidate as { name: string }).name : undefined,
    sourceProvider: supplyContext.provider,
    dataStatus: health,
    confidence: deriveConfidence(supplyContext),
    supplyProviderHealth: health,
    supplySignal: signal,
    providerIssue,
    marketSignal,
    executionImpact: supplyContext.executionImpact,
    supplyScore,
    summary: summarizeSupplyContext(supplyContext),
    reason,
    ...(signal === 'BEARISH' && providerIssue
      ? { invalidBearishReason: 'PROVIDER_ISSUE_SHOULD_NOT_BE_BEARISH' as const }
      : {}),
    ...(signal === 'BULLISH' && providerIssue
      ? { invalidBullishReason: 'PROVIDER_ISSUE_SHOULD_NOT_BE_BULLISH' as const }
      : {}),
    foreignNetBuyAmount: supplyContext.foreignNetBuyAmount,
    institutionNetBuyAmount: supplyContext.institutionNetBuyAmount,
    programNetBuyAmount: stockProgramFlow.netBuy ?? supplyContext.programNetBuyAmount,
    nonProgramNetBuyAmount: supplyContext.nonProgramNetBuyAmount,
    programFlow,
    programFlowDryRun: {
      currentSupplyScore: supplyScore,
      reason: stockProgramFlow.available ? 'PROGRAM_FLOW_DIAGNOSTIC_ONLY' : 'PROGRAM_FLOW_UNAVAILABLE',
      appliedToLiveScore: false,
      diagnosticOnly: true,
      executionImpact: 'NONE',
    },
    activeFlow: describeActiveFlow(supplyContext.foreignNetBuyAmount, supplyContext.institutionNetBuyAmount),
    passiveFlow: describeProgramSignal(passiveProxySignal),
    activePassiveConfluence,
    programMissingAsBearish: false,
    programValueReason: stockProgramFlow.valueReason,
    fetchedAt: supplyContext.fetchedAt,
    rawStatus: supplyContext.rawStatus,
    semanticRowAvailable: hasSemanticRow(trace, health),
    rawInvestorRowAvailable: hasRawInvestorRow(trace, health),
    selectedCandidateCarriesSemanticRow: selectedCarriesSemanticRow(trace, health),
    selectedCandidateCarriesActualRow: selectedCarriesActualRow(trace, health),
    usedForLiveDecision: false,
    strongBuyAllowed: false,
    watchlistPriorityBoost: signal === 'ACCUMULATING' ? 1 : 0,
    shadowTracking: signal === 'ACCUMULATING',
  };
}

function buildMissingContext(symbol: string): PerSymbolSupplyContext {
  return {
    symbol,
    provider: 'NONE',
    supplyProviderHealth: 'MISSING',
    supplySignal: 'UNUSABLE',
    providerIssue: true,
    marketSignal: false,
    executionImpact: 'NONE',
    rawStatus: 'SUPPLY_CONTEXT_NOT_INJECTED',
  };
}

function normalizeHealth(value: unknown): SupplyProviderHealth {
  if (value === 'VERIFIED' || value === 'DEGRADED' || value === 'STALE' || value === 'MISSING') return value;
  return 'UNKNOWN';
}

function normalizeSignal(value: unknown): SupplySignal {
  if (
    value === 'BULLISH' ||
    value === 'ACCUMULATING' ||
    value === 'NEUTRAL' ||
    value === 'BEARISH' ||
    value === 'UNUSABLE'
  ) {
    return value;
  }
  return 'UNUSABLE';
}

export function classifySupplySignal(input: {
  supplyScore: number;
  dataStatus: SupplyProviderHealth;
  providerIssue: boolean;
  marketSignal: boolean;
  foreignNetBuy?: number | null;
  institutionNetBuy?: number | null;
}): SupplySignal {
  const {
    supplyScore,
    dataStatus,
    providerIssue,
    marketSignal,
    foreignNetBuy,
    institutionNetBuy,
  } = input;

  if (dataStatus !== 'VERIFIED') return 'UNUSABLE';
  if (providerIssue) return 'UNUSABLE';
  if (!marketSignal) return 'NEUTRAL';
  if (foreignNetBuy == null || institutionNetBuy == null) return 'UNUSABLE';
  if (supplyScore >= NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold) return 'BULLISH';
  if (supplyScore >= NORMAL_SUPPLY_SCORE_THRESHOLDS.accumulatingThreshold) return 'ACCUMULATING';
  if (supplyScore < NORMAL_SUPPLY_SCORE_THRESHOLDS.bearishThreshold) return 'BEARISH';
  return 'NEUTRAL';
}

function countHealth(candidates: NormalSupplyPreviewCandidate[]): Record<SupplyProviderHealth, number> {
  const counts: Record<SupplyProviderHealth, number> = {
    VERIFIED: 0,
    DEGRADED: 0,
    STALE: 0,
    MISSING: 0,
    UNKNOWN: 0,
  };
  for (const candidate of candidates) counts[candidate.supplyProviderHealth] += 1;
  return counts;
}

function countSignals(candidates: NormalSupplyPreviewCandidate[]): Record<SupplySignal, number> {
  const counts: Record<SupplySignal, number> = {
    BULLISH: 0,
    ACCUMULATING: 0,
    NEUTRAL: 0,
    BEARISH: 0,
    UNUSABLE: 0,
  };
  for (const candidate of candidates) counts[candidate.supplySignal] += 1;
  return counts;
}

function buildSignalSourceSplit(candidates: NormalSupplyPreviewCandidate[]): NormalSupplySignalSourceSplit {
  const split: NormalSupplySignalSourceSplit = {
    bullishFromMarketSignal: 0,
    bullishFromProviderIssue: 0,
    accumulatingFromMarketSignal: 0,
    accumulatingFromProviderIssue: 0,
    bearishFromMarketSignal: 0,
    bearishFromProviderIssue: 0,
    neutralFromVerifiedData: 0,
    unusableFromDataQuality: 0,
  };
  for (const candidate of candidates) {
    if (candidate.supplySignal === 'BULLISH') {
      if (candidate.providerIssue) split.bullishFromProviderIssue += 1;
      else if (candidate.marketSignal) split.bullishFromMarketSignal += 1;
    } else if (candidate.supplySignal === 'ACCUMULATING') {
      if (candidate.providerIssue) split.accumulatingFromProviderIssue += 1;
      else if (candidate.marketSignal) split.accumulatingFromMarketSignal += 1;
    } else if (candidate.supplySignal === 'BEARISH') {
      if (candidate.providerIssue) split.bearishFromProviderIssue += 1;
      else if (candidate.marketSignal) split.bearishFromMarketSignal += 1;
    } else if (candidate.supplySignal === 'NEUTRAL' && candidate.supplyProviderHealth === 'VERIFIED') {
      split.neutralFromVerifiedData += 1;
    } else if (
      candidate.supplySignal === 'UNUSABLE' ||
      candidate.supplyProviderHealth === 'MISSING' ||
      candidate.supplyProviderHealth === 'STALE' ||
      candidate.supplyProviderHealth === 'UNKNOWN'
    ) {
      split.unusableFromDataQuality += 1;
    }
  }
  return split;
}

function normalizeMarketProgramFlow(value: unknown): ProgramFlowDiagnostic['marketLevel'] {
  const root = asRecord(value);
  if (!root) return { ...PROGRAM_FLOW_NOT_AVAILABLE_MARKET, reason: 'PROGRAM_FLOW_CONTEXT_NOT_FOUND' };
  const records = collectProgramRecords(root);
  const hasAnyProgramField = records.some(hasProgramField);
  const kospiResult = firstProgramValueNormalization(records, ['kospiNetBuy', 'kospiProgramNetBuy', 'kospiProgramNetBuyAmount']);
  const kosdaqResult = firstProgramValueNormalization(records, ['kosdaqNetBuy', 'kosdaqProgramNetBuy', 'kosdaqProgramNetBuyAmount']);
  const combinedResult = firstProgramValueNormalization(records, [
    'combinedNetBuy',
    'combinedProgramNetBuy',
    'marketProgramNetBuy',
    'marketProgramNetAmount',
    'programMarketNetBuy',
    'programNetBuy',
    'programNetBuyAmount',
    'programNetAmount',
    'program_net_buy',
    'program_net_amount',
  ]);
  const buyAmountResult = firstProgramValueNormalization(records, ['programBuyAmount', 'marketProgramBuyAmount', 'buyAmount', 'programBuy']);
  const sellAmountResult = firstProgramValueNormalization(records, ['programSellAmount', 'marketProgramSellAmount', 'sellAmount', 'programSell']);
  const firstValueFailure = [kospiResult, kosdaqResult, combinedResult, buyAmountResult, sellAmountResult].find((item) => item && !item.ok);
  const kospiNetBuy = kospiResult?.value;
  const kosdaqNetBuy = kosdaqResult?.value;
  const combined = combinedResult?.value;
  const buyAmount = buyAmountResult?.value;
  const sellAmount = sellAmountResult?.value;
  const providerIssue = records.some((record) => record.providerIssue === true);
  const sourceProvider = normalizeProgramSource(firstValueFromRecords(records, ['sourceProvider', 'provider', 'programSource', 'source']));
  const explicitSignal = normalizeProgramFlowSignal(firstValueFromRecords(records, ['programMarketSignal', 'marketProgramSignal', 'signal']));
  const status = stringValue(firstValueFromRecords(records, ['stockProgramStatus', 'marketProgramStatus', 'status']));
  const derivedCombined = combined
    ?? (kospiNetBuy !== undefined || kosdaqNetBuy !== undefined ? (kospiNetBuy ?? 0) + (kosdaqNetBuy ?? 0) : undefined)
    ?? (buyAmount !== undefined && sellAmount !== undefined ? buyAmount - sellAmount : undefined);
  if (derivedCombined === undefined) {
    const unavailableByStatus = status ? /UNAVAILABLE|MISSING|UNSUPPORTED|EMPTY|NONE/i.test(status) : false;
    return {
      ...PROGRAM_FLOW_NOT_AVAILABLE_MARKET,
      sourceProvider,
      providerIssue,
      marketSignal: false,
      signal: providerIssue ? 'UNKNOWN' : explicitSignal ?? (unavailableByStatus ? 'UNAVAILABLE' : 'UNAVAILABLE'),
      reason: stringValue(firstValueFromRecords(records, ['reason'])) ?? firstValueFailure?.reason ?? (hasAnyProgramField ? 'PROGRAM_FLOW_WIRED_BUT_ALL_NA' : 'PROGRAM_FLOW_WIRED_BUT_NO_FIELDS'),
      valueIssue: Boolean(firstValueFailure),
      valueReason: firstValueFailure?.reason,
      sanitizedSample: firstValueFailure?.sanitizedSample,
    };
  }
  const selectedValue = combinedResult ?? kospiResult ?? kosdaqResult ?? buyAmountResult ?? sellAmountResult;
  const signal = providerIssue ? 'UNKNOWN' : explicitSignal ?? signalFromNetBuy(derivedCombined);
  return {
    available: true,
    ...(kospiNetBuy !== undefined ? { kospiNetBuy } : {}),
    ...(kosdaqNetBuy !== undefined ? { kosdaqNetBuy } : {}),
    combinedNetBuy: derivedCombined,
    signal,
    sourceProvider,
    providerIssue,
    marketSignal: !providerIssue && signal !== 'UNKNOWN' && signal !== 'UNAVAILABLE',
    reason: 'MARKET_PROGRAM_FLOW_AVAILABLE_DIAGNOSTIC_ONLY',
    valueIssue: false,
    valueReason: selectedValue?.reason,
    sanitizedSample: selectedValue?.sanitizedSample,
    diagnosticOnly: true,
    executionImpact: 'NONE',
  };
}

function extractStockProgramFlow(
  candidate: CandidateWithSupplyContext,
  supplyContext: PerSymbolSupplyContext,
  carry?: ProgramFlowCarryValue,
): ProgramFlowDiagnostic['stockLevel'] {
  if (carry) {
    return {
      available: true,
      netBuy: carry.value,
      signal: signalFromNetBuy(carry.value),
      sourceProvider: carry.sourceProvider,
      providerIssue: false,
      marketSignal: true,
      reason: `STOCK_PROGRAM_FLOW_CARRIED_FROM_${carry.source}`,
      valueIssue: false,
      valueReason: carry.normalized.reason,
      sanitizedSample: carry.normalized.sanitizedSample,
      diagnosticOnly: true,
      executionImpact: 'NONE',
    };
  }
  const records = candidateProgramRecords(candidate, supplyContext);
  let providerIssue = false;
  let sourceProvider: ProgramFlowSourceProvider = 'NONE';
  let firstValueFailure: (ProgramFlowValueNormalizationResult & { key: string }) | undefined;
  for (const record of records) {
    providerIssue = providerIssue || record.providerIssue === true;
    const normalizedSource = normalizeProgramSource(record.sourceProvider ?? record.provider ?? record.programSource ?? record.source);
    if (normalizedSource !== 'NONE') sourceProvider = normalizedSource;
    const buyAmountResult = firstNormalizedProgramValue(record, STOCK_PROGRAM_BUY_KEYS);
    const sellAmountResult = firstNormalizedProgramValue(record, STOCK_PROGRAM_SELL_KEYS);
    const netAmountResult = firstNormalizedProgramValue(record, STOCK_PROGRAM_NET_AMOUNT_KEYS);
    const directNetBuyResult = firstNormalizedProgramValue(record, STOCK_PROGRAM_NET_BUY_KEYS);
    firstValueFailure ??= [buyAmountResult, sellAmountResult, netAmountResult, directNetBuyResult].find((item) => item && !item.ok);
    const buyAmount = buyAmountResult?.value;
    const sellAmount = sellAmountResult?.value;
    const netAmount = netAmountResult?.value;
    const directNetBuy = directNetBuyResult?.value;
    const selectedValue = buyAmount !== undefined && sellAmount !== undefined
      ? buyAmountResult ?? sellAmountResult
      : netAmountResult ?? directNetBuyResult;
    const netBuy = buyAmount !== undefined && sellAmount !== undefined
      ? buyAmount - sellAmount
      : netAmount ?? directNetBuy;
    if (netBuy === undefined) continue;
    return {
      available: true,
      netBuy,
      ...(buyAmount !== undefined ? { buyAmount } : {}),
      ...(sellAmount !== undefined ? { sellAmount } : {}),
      ...(netAmount !== undefined ? { netAmount } : {}),
      signal: record.providerIssue === true ? 'UNKNOWN' : signalFromNetBuy(netBuy),
      sourceProvider: normalizeProgramSource(record.sourceProvider ?? record.provider ?? supplyContext.provider),
      providerIssue: Boolean(record.providerIssue),
      marketSignal: record.providerIssue !== true,
      reason: 'STOCK_PROGRAM_FLOW_AVAILABLE_DIAGNOSTIC_ONLY',
      valueIssue: false,
      valueReason: selectedValue?.reason,
      sanitizedSample: selectedValue?.sanitizedSample,
      diagnosticOnly: true,
      executionImpact: 'NONE',
    };
  }
  const hasContext = records.length > 0;
  const hasAnyProgramField = records.some(hasProgramField);
  return {
    ...PROGRAM_FLOW_NOT_AVAILABLE_STOCK,
    sourceProvider: sourceProvider !== 'NONE' ? sourceProvider : normalizeProgramSource(supplyContext.provider),
    providerIssue,
    signal: providerIssue ? 'UNKNOWN' : 'UNAVAILABLE',
    reason: providerIssue
      ? 'PROGRAM_PROVIDER_ISSUE_DIAGNOSTIC_ONLY'
      : firstValueFailure
        ? firstValueFailure.reason
        : !hasContext
          ? 'PROGRAM_FLOW_CONTEXT_NOT_FOUND'
          : hasAnyProgramField ? 'PROGRAM_FLOW_WIRED_BUT_ALL_NA' : 'PROGRAM_FLOW_WIRED_BUT_NO_FIELDS',
    valueIssue: Boolean(firstValueFailure),
    valueReason: firstValueFailure?.reason,
    sanitizedSample: firstValueFailure?.sanitizedSample,
  };
}


function extractMarketProgramFlowFromCandidates<T extends CandidateWithSupplyContext>(candidates: T[]): unknown {
  for (const candidate of candidates) {
    const evidence = findMarketProgramEvidence(candidate, 0, new Set<unknown>());
    if (evidence) return evidence;
  }
  return undefined;
}

function findMarketProgramEvidence(value: unknown, depth: number, seen: Set<unknown>): Record<string, unknown> | undefined {
  if (depth > 5 || value === null || typeof value !== 'object' || seen.has(value)) return undefined;
  seen.add(value);
  const record = value as Record<string, unknown>;
  if (hasAnyKey(record, [
    'kospiProgramNetBuy', 'kosdaqProgramNetBuy', 'marketProgramNetBuy', 'combinedProgramNetBuy',
    'marketProgramNetAmount', 'programMarketNetBuy', 'programMarketSignal', 'marketProgramStatus',
    'combinedNetBuy', 'kospiNetBuy', 'kosdaqNetBuy',
  ])) {
    return record;
  }
  for (const nested of Object.values(record)) {
    if (Array.isArray(nested)) continue;
    const evidence = findMarketProgramEvidence(nested, depth + 1, seen);
    if (evidence) return evidence;
  }
  return undefined;
}

function selectPassiveProxySignal(
  stockLevel: ProgramFlowDiagnostic['stockLevel'],
  marketLevel: ProgramFlowDiagnostic['marketLevel'],
): ProgramFlowSignal {
  if (stockLevel.available && stockLevel.marketSignal) return stockLevel.signal;
  if (marketLevel.available && marketLevel.marketSignal) return marketLevel.signal;
  if (stockLevel.providerIssue || marketLevel.providerIssue) return 'UNKNOWN';
  return 'UNAVAILABLE';
}

function signalFromNetBuy(value: number): ProgramFlowSignal {
  if (value > 0) return 'BULLISH';
  if (value < 0) return 'BEARISH';
  return 'NEUTRAL';
}

function hasAnyKey(record: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => record[key] !== undefined && record[key] !== null);
}

function normalizeProgramFlowSignal(value: unknown): ProgramFlowSignal | undefined {
  if (value === 'BULLISH' || value === 'NEUTRAL' || value === 'BEARISH' || value === 'UNKNOWN' || value === 'UNAVAILABLE') {
    return value;
  }
  return undefined;
}

function normalizeProgramSource(value: unknown): ProgramFlowSourceProvider {
  if (value === 'KIS_API') return 'KIS_API';
  if (value === 'KRX_API' || value === 'KRX' || value === 'KRX_INVESTOR_FLOW') return 'KRX_API';
  if (value === 'CACHE') return 'CACHE';
  if (value === 'SNAPSHOT') return 'SNAPSHOT';
  return 'NONE';
}


function buildSupplyInjectionFromCandidates(candidates: NormalSupplyPreviewCandidate[]): PerSymbolSupplyInjectionStats {
  const health = countHealth(candidates);
  return {
    totalCandidates: candidates.length,
    requestedSymbols: candidates.length,
    receivedResults: candidates.length,
    injected: health.VERIFIED,
    verified: health.VERIFIED,
    degraded: health.DEGRADED,
    stale: health.STALE,
    missing: health.MISSING,
    unknown: health.UNKNOWN,
    routerConnected: candidates.length > 0,
    gateContextConnected: candidates.length > 0,
  };
}

function deriveSupplyScore(ctx: PerSymbolSupplyContext): number {
  let score = 50;
  const health = normalizeHealth(ctx.supplyProviderHealth);
  const signal = normalizeSignal(ctx.supplySignal);
  if (health === 'VERIFIED') score += 10;
  if (health === 'DEGRADED') score -= 5;
  if (health === 'STALE') score -= 10;
  if (health === 'MISSING') score -= 15;
  if (health === 'UNKNOWN') score -= 20;
  if (signal === 'BULLISH') score += 20;
  if (signal === 'NEUTRAL') score += 5;
  if (signal === 'BEARISH') score -= 20;
  if (signal === 'UNUSABLE') score -= 15;
  score += signedAmountScore(ctx.foreignNetBuyAmount, 6);
  score += signedAmountScore(ctx.institutionNetBuyAmount, 6);
  score += signedAmountScore(ctx.programNetBuyAmount, 4);
  score += signedAmountScore(ctx.nonProgramNetBuyAmount, 3);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function deriveConfidence(ctx: PerSymbolSupplyContext): NormalSupplyPreviewCandidate['confidence'] {
  const health = normalizeHealth(ctx.supplyProviderHealth);
  if (health === 'VERIFIED' && ctx.providerIssue !== true) return 'HIGH';
  if (health === 'DEGRADED' || health === 'STALE') return 'MEDIUM';
  if (health === 'MISSING') return 'LOW';
  return 'UNKNOWN';
}

function hasSemanticRow(
  trace: CandidateWithSupplyContext['supplyProviderHealth'],
  health: SupplyProviderHealth,
): boolean {
  if (!trace) return health === 'VERIFIED';
  return Boolean(
    trace.semanticRow ||
      trace.semanticInvestorRow ||
      trace.supplySemanticRow ||
      trace.materialized === true ||
      health === 'VERIFIED',
  );
}

function hasRawInvestorRow(
  trace: CandidateWithSupplyContext['supplyProviderHealth'],
  health: SupplyProviderHealth,
): boolean {
  if (!trace) return health === 'VERIFIED';
  return Boolean(
    trace.actualInvestorRow ||
      trace.diagnosticActualInvestorRow ||
      trace.normalizedInvestorRow ||
      (trace.actualInvestorFlowRows?.length ?? 0) > 0 ||
      trace.actualInvestorFlowCarried === true ||
      trace.materialized === true ||
      health === 'VERIFIED',
  );
}

function selectedCarriesSemanticRow(
  trace: CandidateWithSupplyContext['supplyProviderHealth'],
  health: SupplyProviderHealth,
): boolean {
  if (!trace) return health === 'VERIFIED';
  return Boolean(trace.semanticRow || trace.semanticInvestorRow || trace.supplySemanticRow || trace.materialized === true || health === 'VERIFIED');
}

function selectedCarriesActualRow(
  trace: CandidateWithSupplyContext['supplyProviderHealth'],
  health: SupplyProviderHealth,
): boolean {
  if (!trace) return health === 'VERIFIED';
  return Boolean(
    trace.actualInvestorFlowCarried === true ||
      trace.actualInvestorRow ||
      (trace.actualInvestorFlowRows?.length ?? 0) > 0 ||
      trace.materialized === true ||
      health === 'VERIFIED',
  );
}

function signedAmountScore(value: number | undefined, weight: number): number {
  if (value === undefined || value === 0) return 0;
  return value > 0 ? weight : -weight;
}

function formatFullCandidateDetail(
  candidate: NormalSupplyPreviewCandidate,
  rank: number,
  options: { includeThreshold: boolean; includeInvalidWarning: boolean },
): string {
  const name = candidate.name ? ` ${escapeHtmlText(candidate.name)}` : '';
  const lines = [
    `${rank}. ${candidate.symbol}${name}`,
    `   signal=${candidate.supplySignal} / supplyScore=${candidate.supplyScore}`,
    ...(options.includeThreshold
      ? [`   bullishThreshold=${NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold}`]
      : []),
    ...(candidate.supplySignal === 'ACCUMULATING'
      ? [`   accumulatingRange=${NORMAL_SUPPLY_SCORE_THRESHOLDS.accumulatingThreshold}~${NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold - 1}`]
      : []),
    `   reason=${escapeHtmlText(candidate.reason)}`,
    `   activeFlow=${escapeHtmlText(candidate.activeFlow)}`,
    `   passiveFlow=${candidate.passiveFlow}`,
    `   confluence=${candidate.activePassiveConfluence}`,
    `   programFlow: stockLevel=${candidate.programFlow?.stockLevel.signal ?? 'UNAVAILABLE'} / marketLevel=${candidate.programFlow?.marketLevel.signal ?? 'UNAVAILABLE'}`,
    `   foreignNetBuy=${formatAmount(candidate.foreignNetBuyAmount)}`,
    `   institutionNetBuy=${formatAmount(candidate.institutionNetBuyAmount)}`,
    `   stockProgramNetBuy=${formatAmount(candidate.programFlow?.stockLevel.netBuy)}`,
    `   programValueReason=${candidate.programValueReason ?? candidate.programFlow?.stockLevel.valueReason ?? 'N/A'}`,
    `   marketProgramSignal=${candidate.programFlow?.marketLevel.signal ?? 'UNAVAILABLE'}`,
    `   programNetBuy=${formatAmount(candidate.programNetBuyAmount)}`,
    `   programMissingAsBearish=${candidate.programMissingAsBearish}`,
    '   programPenaltyApplied=false',
    '   passiveProxyUsedForLiveDecision=false',
    `   providerIssue=${candidate.providerIssue}`,
    `   marketSignal=${candidate.marketSignal}`,
    `   dataStatus=${candidate.dataStatus}`,
    `   sourceProvider=${candidate.sourceProvider}`,
    `   confidence=${candidate.confidence}`,
    `   watchlistPriorityBoost=${candidate.watchlistPriorityBoost}`,
    `   shadowTracking=${candidate.shadowTracking}`,
    `   programFlowDryRun=appliedToLiveScore:${candidate.programFlowDryRun.appliedToLiveScore}/reason:${candidate.programFlowDryRun.reason}`,
    '   usedForLiveDecision=false',
    '   strongBuyAllowed=false',
    '   executionImpact=NONE',
  ];
  if (options.includeInvalidWarning && candidate.invalidBearishReason) {
    lines.push(`   ⚠️ invalidBearishReason=${candidate.invalidBearishReason}`);
  }
  if (options.includeInvalidWarning && candidate.invalidBullishReason) {
    lines.push(`   ⚠️ invalidBullishReason=${candidate.invalidBullishReason}`);
  }
  return lines.join('\n');
}

function formatUnknownCandidateDetail(candidate: NormalSupplyPreviewCandidate, rank: number): string {
  const name = candidate.name ? ` ${escapeHtmlText(candidate.name)}` : '';
  return [
    `${rank}. ${candidate.symbol}${name}`,
    `   reason=${escapeHtmlText(candidate.reason)}`,
    `   providerIssue=${candidate.providerIssue}`,
    '   marketSignal=false',
    `   status=${candidate.dataStatus}`,
    `   sourceProvider=${candidate.sourceProvider}`,
    '   executionImpact=NONE',
    '   penaltyApplied=false',
  ].join('\n');
}

function buildThresholdExplanation(candidate: NormalSupplyPreviewCandidate | undefined): string {
  if (!candidate) return 'No candidate rows are available for threshold explanation.';
  if (candidate.supplySignal === 'ACCUMULATING') {
    return `supplyScore ${candidate.supplyScore} is below bullishThreshold ${NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold} and inside accumulatingRange ${NORMAL_SUPPLY_SCORE_THRESHOLDS.accumulatingThreshold}-${NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold - 1}; quiet accumulation candidate, not a live buy signal.`;
  }
  if (candidate.supplySignal === 'NEUTRAL' && candidate.supplyScore < NORMAL_SUPPLY_SCORE_THRESHOLDS.accumulatingThreshold) {
    return `supplyScore ${candidate.supplyScore} is below accumulatingRange ${NORMAL_SUPPLY_SCORE_THRESHOLDS.accumulatingThreshold}-${NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold - 1}; classified as NEUTRAL.`;
  }
  if (candidate.supplySignal === 'NEUTRAL' && candidate.supplyScore < NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold) {
    return `supplyScore ${candidate.supplyScore}은 ${candidate.reason} 기준이나 bullishThreshold ${NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold} 미만이므로 NEUTRAL로 분류됩니다.`;
  }
  if (candidate.supplySignal === 'BULLISH') {
    return `supplyScore ${candidate.supplyScore}이며 현재 수급 신호가 BULLISH입니다.`;
  }
  if (candidate.supplySignal === 'BEARISH') {
    return `supplyScore ${candidate.supplyScore}이며 marketSignal=${candidate.marketSignal} 기준 BEARISH입니다. providerIssue는 bearish로 해석하지 않습니다.`;
  }
  return `supplyScore ${candidate.supplyScore}이며 dataStatus=${candidate.dataStatus}입니다. UNKNOWN/MISSING/STALE은 bearish penalty로 변환하지 않습니다.`;
}

function describeSupplyReason(ctx: PerSymbolSupplyContext, classifiedSignal?: SupplySignal, supplyScore?: number): string {
  const health = normalizeHealth(ctx.supplyProviderHealth);
  const signal = classifiedSignal ?? normalizeSignal(ctx.supplySignal);
  if (ctx.providerIssue === true || health !== 'VERIFIED') {
    return `${health} provider gap (${ctx.rawStatus ?? 'n/a'})`;
  }
  const foreign = ctx.foreignNetBuyAmount ?? 0;
  const institution = ctx.institutionNetBuyAmount ?? 0;
  const program = ctx.programNetBuyAmount ?? 0;
  if (signal === 'ACCUMULATING' && foreign > 0 && institution > 0) {
    return `foreign+institution net buy but below bullish threshold (${supplyScore ?? 'n/a'}/${NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold}) - ACCUMULATING quiet observation candidate`;
  }
  if (signal === 'ACCUMULATING') {
    return `VERIFIED supply data shows accumulation (${supplyScore ?? 'n/a'}) - diagnostic/shadow only, not used for live decision`;
  }
  if (signal === 'BEARISH' && foreign < 0 && institution < 0) return '외국인+기관 동반 순매도';
  if (signal === 'BULLISH' && foreign > 0 && institution > 0 && program > 0) return '외국인+기관+프로그램 동반 순매수';
  if (signal === 'NEUTRAL' && foreign > 0 && institution > 0) return '외인+기관 동반 순매수이나 bullish threshold 미달';
  if (foreign > 0 && institution > 0) return '외인+기관 동반 순매수';
  if (foreign < 0 && institution < 0) return '외국인+기관 동반 순매도';
  if (foreign > 0) return '외국인 순매수 우위';
  if (institution > 0) return '기관 순매수 우위';
  if (program > 0) return '프로그램 순매수 우위';
  return `${signal} supply`;
}

function escapeHtmlText(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function summarizeSupplyContext(ctx: PerSymbolSupplyContext): string {
  const health = normalizeHealth(ctx.supplyProviderHealth);
  const signal = normalizeSignal(ctx.supplySignal);
  if (health !== 'VERIFIED') return `${health} provider gap (${ctx.rawStatus ?? 'n/a'})`;
  const foreign = ctx.foreignNetBuyAmount ?? 0;
  const institution = ctx.institutionNetBuyAmount ?? 0;
  const program = ctx.programNetBuyAmount ?? 0;
  if (foreign > 0 && institution > 0) return '외인+기관 동반 순매수';
  if (institution > 0 && program > 0) return '기관+프로그램 순매수';
  if (foreign > 0) return '외인 순매수 우위';
  if (institution > 0) return '기관 순매수 우위';
  if (signal === 'BEARISH') return '외인/기관 수급 약세';
  return `${signal} supply`;
}
