// @responsibility Normal supply program flow carry helpers.

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
import { buildMissingContext, normalizeProgramSource, signalFromNetBuy } from './candidateMapper.js';

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

export const PROGRAM_FLOW_NOT_AVAILABLE_STOCK: ProgramFlowDiagnostic['stockLevel'] = {
  available: false,
  signal: 'UNAVAILABLE',
  sourceProvider: 'NONE',
  providerIssue: false,
  marketSignal: false,
  reason: 'PROGRAM_FLOW_NOT_WIRED_OR_NOT_AVAILABLE',
  diagnosticOnly: true,
  executionImpact: 'NONE',
};


export const PROGRAM_FLOW_NOT_AVAILABLE_MARKET: ProgramFlowDiagnostic['marketLevel'] = {
  available: false,
  signal: 'UNAVAILABLE',
  sourceProvider: 'NONE',
  providerIssue: false,
  marketSignal: false,
  reason: 'PROGRAM_FLOW_NOT_WIRED_OR_NOT_AVAILABLE',
  diagnosticOnly: true,
  executionImpact: 'NONE',
};

export function buildProgramFlowUpstreamPopulation<T extends CandidateWithSupplyContext>(
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

export function emptyProgramFlowUpstreamPopulationTrace(carryAttempted: boolean): ProgramFlowUpstreamPopulationTrace {
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

export const STOCK_PROGRAM_CONTEXT_ALIAS_KEYS = [
  'stockProgramNetBuyAmount',
  'stockProgramNetBuy',
  'programNetBuy',
  'programNetBuyAmount',
] as const;

export function wireStockProgramNetBuyContextAliases<T extends CandidateWithSupplyContext>(
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

export function candidateStockProgramMatchSymbols(candidate: CandidateWithSupplyContext): string[] {
  const ctx = candidate.preflight?.supplyContext ?? candidate.supplyContext;
  return Array.from(new Set([
    candidatePreviewSymbol(candidate),
    normalizeStockProgramMatchSymbol((candidate as { symbol?: unknown }).symbol),
    normalizeStockProgramMatchSymbol((candidate as { code?: unknown }).code),
    normalizeStockProgramMatchSymbol(ctx?.symbol),
  ].filter(Boolean)));
}

export function normalizeStockProgramMatchSymbol(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const digits = raw.replace(/[^0-9]/g, '');
  return digits.length >= 6 ? digits.slice(-6) : digits.padStart(6, '0');
}

export function candidateProgramContextRecords(
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

export function accumulateStockSourceTrace(
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

export function toStockCarry(
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

export function chooseStockPopulationBreakPoint(
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

export function buildMarketProgramCarry<T extends CandidateWithSupplyContext>(
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

export function toMarketCarry(
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

export function chooseMarketPopulationBreakPoint(
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

export function logProgramFlowDiagnostics(preview: NormalSupplyPreview): void {
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
