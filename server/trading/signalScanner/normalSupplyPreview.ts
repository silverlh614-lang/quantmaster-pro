// @responsibility Normal-mode supply diagnostic overlay under live-entry blocks.
import type {
  CandidateWithSupplyContext,
  PerSymbolSupplyContext,
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
  formatList,
  formatReasonDistribution,
  formatStockProgramFieldKeysTop,
} from './normalSupplyPreview/formatters.js';
import { buildNormalSupplyFieldAvailability } from './normalSupplyPreview/fieldAvailabilityBuilder.js';
import { assembleNormalSupplyPreview } from './normalSupplyPreview/previewAssembler.js';
import { setLatestNormalSupplyPreview } from './normalSupplyPreview/previewStore.js';
import {
  NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE,
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
  PersistNormalSupplyPreviewInput,
} from './normalSupplyPreview/types.js';

export {
  NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE,
  NORMAL_SUPPLY_DIAGNOSTIC_PREVIEW_MODE,
  NORMAL_SUPPLY_SCORE_THRESHOLDS,
} from './normalSupplyPreview/constants.js';
export { normalizeProgramFlowValue } from './normalSupplyPreview/programFlowValueNormalizer.js';
export {
  buildNormalSupplyPreviewFullSections,
  formatNormalSupplyPreviewFullSections,
  formatNormalSupplyPreviewMissingSection,
  formatNormalSupplyPreviewSection,
} from './normalSupplyPreview/formatters.js';
export {
  __resetNormalSupplyPreviewForTests,
  getLastNormalSupplyPreview,
} from './normalSupplyPreview/previewStore.js';
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
  wireStockProgramNetBuyContextAliases(input.candidates, latestIntradayProgramFlowSnapshot);
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
  const programFlowEvidenceTrace = buildProgramFlowEvidenceTrace(
    input.candidates,
    programPopulation.marketProgramFlowRaw ?? marketProgramFlowRaw,
    previewCandidates,
    marketProgramFlow,
    programPopulation.trace,
  );
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
  const fieldAvailability = buildNormalSupplyFieldAvailability(
    previewCandidates,
    programFlowEvidenceTrace,
    programFlowDiagnostics,
  );

  const preview = setLatestNormalSupplyPreview(
    assembleNormalSupplyPreview({
      capturedAt,
      engineMode: input.engineMode,
      source: input.source,
      reason: input.reason,
      preflightDecision: input.preflightDecision,
      candidates: previewCandidates,
      supplyInjection: input.supplyInjection,
      fieldAvailability,
      programFlowDiagnostics,
      programFlowEvidenceTrace,
      programFlowUpstreamPopulationTrace: programPopulation.trace,
      topN: input.topN ?? 5,
    }),
  );
  const summaryTraceId = createTraceId('supply');
  const { healthCounts, signalCounts, supplyInjection } = preview;
  logVisibilityEvent({
    visibility: 'SUMMARY',
    category: 'SUPPLY',
    sourceCommand: '/normal_supply_preview',
    traceId: summaryTraceId,
    message:
      `[SUPPLY_PREVIEW_SUMMARY] ` +
      `mode=${NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE} ` +
      `candidateCount=${preview.candidateCount} ` +
      `injected=${supplyInjection.injected} verified=${healthCounts.VERIFIED} degraded=${healthCounts.DEGRADED} ` +
      `stale=${healthCounts.STALE} missing=${healthCounts.MISSING} ` +
      `accumulating=${signalCounts.ACCUMULATING} neutral=${signalCounts.NEUTRAL} bearish=${signalCounts.BEARISH} ` +
      `programProvider=${programFlowDiagnostics.marketProgramAvailable ? 'AVAILABLE_DIAGNOSTIC_ONLY' : 'EMPTY_DIAGNOSTIC_ONLY'} ` +
      `providerCallsAdded=0 executionImpact=NONE traceId=${summaryTraceId}`,
    summary: {
      candidateCount: preview.candidateCount,
      injected: supplyInjection.injected,
      healthCounts,
      signalCounts,
      programProvider: programFlowDiagnostics.marketProgramAvailable ? 'AVAILABLE_DIAGNOSTIC_ONLY' : 'EMPTY_DIAGNOSTIC_ONLY',
      executionImpact: 'NONE',
    },
    details: { preview },
    level: 'info',
    executionImpact: 'NONE',
  });
  logSupplySignalTierRefinement(preview);
  logProgramFlowDiagnostics(preview);
  return preview;
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
      toStockCarry('LATEST_INTRADAY_PROGRAM_FLOW_SNAPSHOT', sourceRecords.latestIntradayProgramFlowSnapshot.matched, 'SNAPSHOT') ??
      toStockCarry('LATEST_INTRADAY_PROGRAM_SNAPSHOT', sourceRecords.snapshot.matched, 'SNAPSHOT') ??
      toStockCarry('SUPPLY_SNAPSHOT_CACHE', sourceRecords.cache.matched, 'CACHE') ??
      toStockCarry('PROGRAM_TRADING_DIAGNOSTIC', sourceRecords.programTrading.matched, 'SNAPSHOT') ??
      toStockCarry('CANDIDATE_CONTEXT', contextRecords, 'KIS_API', [
        ...STOCK_PROGRAM_NET_AMOUNT_KEYS,
        ...STOCK_PROGRAM_NET_BUY_KEYS,
      ]);

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

const STOCK_PROGRAM_CONTEXT_ALIAS_KEYS = [
  'stockProgramNetBuyAmount',
  'stockProgramNetBuy',
  'programNetBuy',
  'programNetBuyAmount',
] as const;

function wireStockProgramNetBuyContextAliases<T extends CandidateWithSupplyContext>(
  candidates: T[],
  latestIntradayProgramFlowSnapshot?: IntradayProgramFlowSnapshot | null,
): void {
  for (const candidate of candidates) {
    const symbols = candidateStockProgramMatchSymbols(candidate);
    if (symbols.length === 0) continue;
    const snapshotRecords = symbols.flatMap((symbol) =>
      stockUpstreamSourceRecords(candidate, symbol, latestIntradayProgramFlowSnapshot).latestIntradayProgramFlowSnapshot.matched,
    );
    const contextRecords = collectProgramRecordsFromItems([
      (candidate as Record<string, unknown>).stockProgramFlow,
      ...snapshotRecords,
    ]);
    const normalized = firstOkProgramValueFromRecords(contextRecords, [
      'stockProgramNetBuyAmount',
      ...STOCK_PROGRAM_NET_AMOUNT_KEYS,
      ...STOCK_PROGRAM_NET_BUY_KEYS,
    ]);
    if (!normalized) continue;

    const writableCandidate = candidate as Record<string, unknown>;
    for (const key of STOCK_PROGRAM_CONTEXT_ALIAS_KEYS) {
      writableCandidate[key] = normalized.value;
    }
  }
}

function candidateStockProgramMatchSymbols(candidate: CandidateWithSupplyContext): string[] {
  const ctx = candidate.preflight?.supplyContext ?? candidate.supplyContext;
  return Array.from(new Set([
    candidatePreviewSymbol(candidate),
    normalizeStockProgramMatchSymbol((candidate as { symbol?: unknown }).symbol),
    normalizeStockProgramMatchSymbol((candidate as { code?: unknown }).code),
    normalizeStockProgramMatchSymbol(ctx?.symbol),
  ].filter(Boolean)));
}

function normalizeStockProgramMatchSymbol(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const digits = raw.replace(/[^0-9]/g, '');
  return digits.length >= 6 ? digits.slice(-6) : digits.padStart(6, '0');
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
  const marketClosedProgramUnavailable = !sessionGuard.programFlowExpected;
  const marketProgramReason = marketClosedProgramUnavailable
    ? marketClosedProgramReason()
    : marketCarryTrace.marketProgramBreakPoint === 'KIS_ACCEPTED_EMPTY_KRX_EMPTY_CACHE_MISS'
      ? 'MARKET_PROGRAM_EMPTY_VALID_DIAGNOSTIC_ONLY'
      : evidenceTrace.marketLevel.result;
  const marketProgramDataStatus = marketClosedProgramUnavailable
    ? marketClosedProgramDataStatus(sessionGuard.marketSession)
    : stringValue((marketProgramFlow as unknown as Record<string, unknown>).marketProgramDataStatus) ?? (marketProgramAvailable ? 'PARSED' : 'MISSING');
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
    marketProgramReason,
    marketProgramNetBuyAmount: displayMarketProgramNetBuyAmount(marketProgramFlow),
    marketProgramDataStatus,
    kisAttempted: (marketProgramFlow as unknown as Record<string, unknown>).kisAttempted === true,
    kisStatus: stringValue((marketProgramFlow as unknown as Record<string, unknown>).kisStatus) ?? 'NOT_ATTEMPTED',
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

function displayMarketProgramNetBuyAmount(
  marketProgramFlow: ProgramFlowDiagnostic['marketLevel'],
): number | 'N/A' {
  if ((marketProgramFlow.sourceProvider ?? 'NONE') === 'NONE') return 'N/A';
  return marketProgramFlow.combinedNetBuy ?? 'N/A';
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
    stockProgramNetBuyAmount: stockProgramFlow.netBuy,
    stockProgramNetBuy: stockProgramFlow.netBuy,
    programNetBuy: stockProgramFlow.netBuy,
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
    'programNetValue',
    'totalProgramNetBuy',
    'totalProgramNetBuyAmount',
    'kospiProgramNetBuy',
    'kosdaqProgramNetBuy',
    'netBuyAmount',
    'prgmNetBuy',
    'prgmNetBuyAmount',
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
  const diagnosticCarry = pickMarketProgramProviderDiagnostics(root);
  const derivedCombined = combined
    ?? (kospiNetBuy !== undefined || kosdaqNetBuy !== undefined ? (kospiNetBuy ?? 0) + (kosdaqNetBuy ?? 0) : undefined)
    ?? (buyAmount !== undefined && sellAmount !== undefined ? buyAmount - sellAmount : undefined);
  if (sourceProvider === 'CACHE_STALE') {
    return {
      ...PROGRAM_FLOW_NOT_AVAILABLE_MARKET,
      sourceProvider,
      providerIssue,
      marketSignal: false,
      signal: 'UNKNOWN',
      reason: 'MARKET_PROGRAM_CACHE_STALE_DIAGNOSTIC_ONLY',
      valueIssue: false,
      ...diagnosticCarry,
    };
  }
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
      ...diagnosticCarry,
    };
  }
  const selectedValue = combinedResult ?? kospiResult ?? kosdaqResult ?? buyAmountResult ?? sellAmountResult;
  const signal = providerIssue ? 'UNKNOWN' : explicitSignal ?? marketSignalFromNetBuy(derivedCombined);
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
    ...diagnosticCarry,
    diagnosticOnly: true,
    executionImpact: 'NONE',
  };
}


function pickMarketProgramProviderDiagnostics(root: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    'marketProgramDataStatus', 'kisAttempted', 'kisStatus', 'krxFallbackAttempted', 'krxFallbackStatus',
    'cacheFallbackAttempted', 'cacheStatus', 'fetchedAt', 'parsedFieldName', 'rawFieldKeys',
    'programFlowUsedForLiveDecision', 'passiveProxyUsedForLiveDecision', 'programPenaltyApplied',
  ];
  const carried: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(root, key)) carried[key] = root[key];
  }
  return carried;
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


function marketSignalFromNetBuy(value: number): ProgramFlowSignal {
  if (value >= 1000) return 'BULLISH';
  if (value <= -1000) return 'BEARISH';
  return 'NEUTRAL';
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
  if (value === 'KRX_FALLBACK') return 'KRX_FALLBACK';
  if (value === 'KRX_API' || value === 'KRX' || value === 'KRX_INVESTOR_FLOW') return 'KRX_API';
  if (value === 'CACHE_STALE') return 'CACHE_STALE';
  if (value === 'CACHE') return 'CACHE';
  if (value === 'SNAPSHOT') return 'SNAPSHOT';
  return 'NONE';
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
