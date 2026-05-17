// @responsibility Pure/read-only program-flow evidence collection for normal supply preview diagnostics.
import type { IntradayProgramFlowSnapshot } from '../../../replay/intradayProgramFlowSnapshotRepo.js';
import type {
  CandidateWithSupplyContext,
  PerSymbolSupplyContext,
} from '../injectPerSymbolSupplyContext.js';
import type {
  NormalSupplyPreviewCandidate,
} from './types.js';
import type {
  ProgramFlowDiagnostic,
  ProgramFlowEvidenceTrace,
  ProgramFlowMarketEvidenceBreakPoint,
  ProgramFlowMarketEvidenceResult,
  ProgramFlowStockEvidenceBreakPoint,
  ProgramFlowStockEvidenceResult,
  ProgramFlowUpstreamPopulationTrace,
  ProgramFlowValueNormalizationResult,
} from './programFlowTypes.js';
import { normalizeProgramFlowValue } from './programFlowValueNormalizer.js';

export const STOCK_PROGRAM_BUY_KEYS = [
  'programBuyAmount', 'stockProgramBuyAmount', 'programBuy', 'programBuyAmt', 'buyAmount', 'buy', 'prgm_buy_amt', 'prgm_buy_qty',
];
export const STOCK_PROGRAM_SELL_KEYS = [
  'programSellAmount', 'stockProgramSellAmount', 'programSell', 'programSellAmt', 'sellAmount', 'sell', 'prgm_sell_amt', 'prgm_sell_qty',
];
export const STOCK_PROGRAM_NET_AMOUNT_KEYS = [
  'programNetAmount', 'stockProgramNetAmount', 'stckProgramNetAmount', 'prgmNetAmount', 'program_net_amount',
  'netAmount', 'programNetBuyAmount', 'prgm_net_amt', 'prgm_net_qty', 'programNetValue', 'programNetVolume',
];
export const STOCK_PROGRAM_NET_BUY_KEYS = [
  'programNetBuy', 'stockProgramNetBuy', 'stckProgramNetBuy', 'stockPrgmNetBuy', 'prgmNetBuy', 'program_net_buy',
];
const MARKET_PROGRAM_RECORD_KEYS = [
  'programTrading', 'programDiagnostic', 'programMarket', 'marketProgram', 'marketProgramFlow', 'programFlow',
  'supplyDiagnostic', 'diagnosticContext', 'runtimeDiagnosticSnapshot', 'runtimeSnapshot', 'snapshot', 'cache',
  'latestSnapshot', 'latestSanitizedSnapshot', 'programTradingSnapshot', 'programTradingCache',
];
const PROGRAM_FIELD_KEYS = [
  ...STOCK_PROGRAM_BUY_KEYS,
  ...STOCK_PROGRAM_SELL_KEYS,
  ...STOCK_PROGRAM_NET_AMOUNT_KEYS,
  ...STOCK_PROGRAM_NET_BUY_KEYS,
  'kospiProgramNetBuy', 'kosdaqProgramNetBuy', 'marketProgramNetBuy', 'combinedProgramNetBuy',
  'marketProgramNetAmount', 'programMarketNetBuy', 'programMarketSignal', 'stockProgramStatus',
  'marketProgramStatus', 'combinedNetBuy', 'kospiNetBuy', 'kosdaqNetBuy', 'status', 'reason',
];

export const MARKET_PROGRAM_NUMERIC_KEYS = [
  'kospiProgramNetBuy', 'kosdaqProgramNetBuy', 'marketProgramNetBuy', 'combinedProgramNetBuy',
  'marketProgramNetAmount', 'programMarketNetBuy', 'combinedNetBuy', 'kospiNetBuy', 'kosdaqNetBuy',
  'programTrading.combinedNetBuy', 'programTrading.kospiNetBuy', 'programTrading.kosdaqNetBuy',
  'programNetBuy', 'programNetBuyAmount', 'programNetAmount', 'program_net_buy', 'program_net_amount',
  'programBuyAmount', 'marketProgramBuyAmount', 'programSellAmount', 'marketProgramSellAmount',
];
const MARKET_PROGRAM_STATUS_KEYS = [
  'programMarketSignal', 'stockProgramStatus', 'marketProgramStatus', 'routedStatus', 'rawStatus',
  'selectedProvider', 'source', 'fallback', 'status', 'reason', 'scoring', 'latest', 'updatedAt',
];
export const STOCK_PROGRAM_SCAN_KEYS = Array.from(new Set([
  ...STOCK_PROGRAM_BUY_KEYS, ...STOCK_PROGRAM_SELL_KEYS, ...STOCK_PROGRAM_NET_AMOUNT_KEYS, ...STOCK_PROGRAM_NET_BUY_KEYS,
  'programNetBuyAmount', 'programBuyAmount', 'programSellAmount', 'prgm_buy_qty', 'prgm_sell_qty', 'prgm_net_qty',
]));

const UPSTREAM_PROGRAM_RECORD_KEYS = [
  ...MARKET_PROGRAM_RECORD_KEYS,
  'candidateRows',
  'stockRows',
  'stockProgramRows',
  'programRows',
  'rows',
  'items',
  'latestIntradayProgramSnapshot',
  'intradayProgramSnapshot',
  'latestIntradayMarketProgramSnapshot',
  'intradayMarketProgramSnapshot',
  'supplySnapshotCache',
  'programMarketCache',
  'programToday',
  'providerDiagnostics',
  'scoring',
];

export function buildProgramFlowEvidenceTrace<T extends CandidateWithSupplyContext>(
  rawCandidates: T[],
  marketProgramFlowRaw: unknown,
  previewCandidates: NormalSupplyPreviewCandidate[],
  marketProgramFlow: ProgramFlowDiagnostic['marketLevel'],
  upstreamPopulation: ProgramFlowUpstreamPopulationTrace,
): ProgramFlowEvidenceTrace {
  const stockKeyCounts = new Map<string, number>();
  let stockRowsWithAny = 0;
  let stockRowsWithNumeric = 0;
  let stockRowsWithParsable = 0;
  const stockValueReasons = new Map<string, number>();
  const stockSamples: string[] = [];
  const normalizedFields = new Set<string>();
  const snapshotFields = new Set<string>();
  const cacheFields = new Set<string>();
  for (const candidate of rawCandidates) {
    const supplyContext = candidate.preflight?.supplyContext ?? candidate.supplyContext ?? missingSupplyContextForEvidence(candidatePreviewSymbol(candidate));
    const records = candidateProgramRecords(candidate, supplyContext);
    const rowKeys = new Set<string>();
    for (const record of records) {
      for (const key of Object.keys(record)) {
        if (isStockProgramScanKey(key)) rowKeys.add(key);
      }
    }
    let rowParsable = false;
    if (rowKeys.size > 0) {
      stockRowsWithAny += 1;
      for (const key of rowKeys) stockKeyCounts.set(key, (stockKeyCounts.get(key) ?? 0) + 1);
      for (const record of records) {
        for (const key of Object.keys(record)) {
          if (!isStockProgramScanKey(key)) continue;
          const raw = record[key];
          const normalized = normalizeProgramFlowValue(raw ?? null);
          incrementCount(stockValueReasons, normalized.reason);
          const sample = normalized.sanitizedSample ?? (raw == null ? 'null' : undefined);
          if (sample) pushUniqueLimited(stockSamples, `${key}=${sample}`, 3);
          rowParsable ||= normalized.ok;
        }
      }
    }
    if (rowParsable) stockRowsWithParsable += 1;
    if (previewCandidates.some((preview) => preview.symbol === candidatePreviewSymbol(candidate) && preview.programFlow?.stockLevel.available)) {
      stockRowsWithNumeric += 1;
    }
    collectProgramKeysInto(asRecord(supplyContext), normalizedFields, STOCK_PROGRAM_SCAN_KEYS);
    const maybeCandidate = candidate as Record<string, unknown>;
    collectProgramKeysInto(asRecord(maybeCandidate.snapshot), snapshotFields, STOCK_PROGRAM_SCAN_KEYS);
    collectProgramKeysInto(asRecord(maybeCandidate.runtimeSnapshot), snapshotFields, STOCK_PROGRAM_SCAN_KEYS);
    collectProgramKeysInto(asRecord(maybeCandidate.latestSnapshot), snapshotFields, STOCK_PROGRAM_SCAN_KEYS);
    collectProgramKeysInto(asRecord(maybeCandidate.latestSanitizedSnapshot), snapshotFields, STOCK_PROGRAM_SCAN_KEYS);
    collectProgramKeysInto(asRecord(maybeCandidate.cache), cacheFields, STOCK_PROGRAM_SCAN_KEYS);
  }
  const stockFieldsFound = sortedKeys(stockKeyCounts);
  const anyStockContext = rawCandidates.length > 0;
  const stockProviderIssue = previewCandidates.some((candidate) => candidate.programFlow?.stockLevel.providerIssue);
  const stockResult: ProgramFlowStockEvidenceResult = stockRowsWithNumeric > 0
    ? 'FIELD_FOUND'
    : stockProviderIssue ? 'PROVIDER_ISSUE_DIAGNOSTIC_ONLY'
      : !anyStockContext ? 'CONTEXT_NOT_FOUND'
        : stockRowsWithAny > 0 ? 'ONLY_NA_VALUES' : 'CONTEXT_FOUND_NO_FIELDS';
  const stockBreakPoint: ProgramFlowStockEvidenceBreakPoint = stockRowsWithNumeric > 0
    ? 'UNKNOWN'
    : !anyStockContext ? 'CANDIDATE_CONTEXT_MISSING'
      : stockRowsWithAny === 0 ? 'CANDIDATE_PROGRAM_KEYS_MISSING'
        : 'PROGRAM_KEYS_PRESENT_BUT_NON_NUMERIC';

  const marketRoot = asRecord(marketProgramFlowRaw);
  const marketRecords = marketRoot ? collectProgramRecords(marketRoot) : [];
  const marketFields = new Set<string>();
  const marketNumeric = new Set<string>();
  const marketParsable = new Set<string>();
  const marketValueReasons = new Map<string, number>();
  const marketSamples: string[] = [];
  const marketStatus = new Set<string>();
  const marketSources = new Set<string>();
  for (const record of marketRecords) {
    for (const key of Object.keys(record)) {
      if (MARKET_PROGRAM_NUMERIC_KEYS.includes(key) || MARKET_PROGRAM_STATUS_KEYS.includes(key) || key === 'programTrading') marketFields.add(key);
      if (MARKET_PROGRAM_NUMERIC_KEYS.includes(key)) {
        const normalized = normalizeProgramFlowValue(record[key]);
        incrementCount(marketValueReasons, normalized.reason);
        if (normalized.sanitizedSample) pushUniqueLimited(marketSamples, normalized.sanitizedSample, 1);
        if (normalized.ok) {
          marketNumeric.add(key);
          marketParsable.add(key);
        }
      }
      if (MARKET_PROGRAM_STATUS_KEYS.includes(key) && record[key] !== undefined && record[key] !== null) marketStatus.add(key);
    }
    const source = stringValue(record.sourceProvider ?? record.provider ?? record.programSource ?? record.source ?? record.selectedProvider);
    if (source) marketSources.add(source);
  }
  const statusText = String(firstValueFromRecords(marketRecords, ['marketProgramStatus', 'stockProgramStatus', 'status', 'rawStatus', 'routedStatus', 'reason']) ?? '');
  const sessionClosed = /SESSION[_-]?CLOSED|OFF[_-]?HOURS|CLOSED/i.test(statusText);
  const marketContextFound = marketRecords.length > 0;
  const statusOnly = marketStatus.size > 0 && marketNumeric.size === 0;
  const marketProviderIssue = marketProgramFlow.providerIssue || sessionClosed;
  const marketResult: ProgramFlowMarketEvidenceResult = marketProgramFlow.available || marketNumeric.size > 0
    ? 'FIELD_FOUND'
    : sessionClosed ? 'SESSION_CLOSED_DIAGNOSTIC_ONLY'
      : marketProviderIssue ? 'PROVIDER_ISSUE_DIAGNOSTIC_ONLY'
        : !marketContextFound ? 'CONTEXT_NOT_FOUND'
          : statusOnly ? 'ONLY_STATUS_NO_NUMERIC' : 'CONTEXT_FOUND_NO_FIELDS';
  const marketBreakPoint: ProgramFlowMarketEvidenceBreakPoint = marketProgramFlow.available || marketNumeric.size > 0
    ? 'UNKNOWN'
    : sessionClosed ? 'PROGRAM_CONTEXT_SESSION_CLOSED'
      : !marketContextFound ? 'PROGRAM_TRADING_CONTEXT_MISSING'
        : statusOnly ? 'PROGRAM_CONTEXT_HAS_STATUS_ONLY'
          : marketFields.size > 0 ? 'PROGRAM_CONTEXT_HAS_NO_NUMERIC_FIELDS' : 'NO_MARKET_LEVEL_PROGRAM_EVIDENCE';

  const contextFound = anyStockContext || marketContextFound;
  const wiredButNoFields = contextFound && stockRowsWithAny === 0 && marketFields.size === 0;
  return {
    contextFound,
    wiredButNoFields,
    upstreamPopulation,
    stockLevel: {
      candidateFieldScanAttempted: true,
      candidateFieldsFound: stockFieldsFound,
      candidateFieldCounts: Object.fromEntries(stockKeyCounts),
      candidateRowsWithAnyProgramKey: stockRowsWithAny,
      candidateRowsWithNumericProgramValue: stockRowsWithNumeric,
      candidateRowsWithParsableProgramValue: stockRowsWithParsable,
      valueReasonDistribution: Object.fromEntries(stockValueReasons),
      sanitizedSampleTop: stockSamples,
      normalizedFieldScanAttempted: true,
      normalizedFieldsFound: Array.from(normalizedFields).sort(),
      snapshotFieldScanAttempted: true,
      snapshotFieldsFound: Array.from(snapshotFields).sort(),
      cacheFieldScanAttempted: true,
      cacheFieldsFound: Array.from(cacheFields).sort(),
      result: stockResult,
      breakPoint: upstreamPopulation.stockLevel.breakPoint !== 'UNKNOWN' ? upstreamPopulation.stockLevel.breakPoint : stockBreakPoint,
    },
    marketLevel: {
      programTradingContextFound: hasNestedRecordKey(marketRoot, 'programTrading'),
      programMarketRouterResultFound: hasNestedRecordKey(marketRoot, 'programMarket') || hasNestedRecordKey(marketRoot, 'marketProgram') || hasNestedRecordKey(marketRoot, 'marketProgramFlow'),
      programTodayContextFound: hasNestedRecordKey(marketRoot, 'programToday'),
      cacheContextFound: hasNestedRecordKey(marketRoot, 'cache') || hasNestedRecordKey(marketRoot, 'programTradingCache'),
      snapshotContextFound: hasNestedRecordKey(marketRoot, 'snapshot') || hasNestedRecordKey(marketRoot, 'latestSanitizedSnapshot') || hasNestedRecordKey(marketRoot, 'programTradingSnapshot'),
      fieldsFound: Array.from(marketFields).sort(),
      numericFieldsFound: Array.from(marketNumeric).sort(),
      parsableFieldsFound: Array.from(marketParsable).sort(),
      valueReasonDistribution: Object.fromEntries(marketValueReasons),
      sanitizedSample: marketSamples[0],
      statusFieldsFound: Array.from(marketStatus).sort(),
      sourceCandidates: Array.from(marketSources).sort(),
      result: marketResult,
      breakPoint: upstreamPopulation.marketLevel.breakPoint !== 'UNKNOWN' ? upstreamPopulation.marketLevel.breakPoint : marketBreakPoint,
    },
    providerCallsAdded: 0,
    executionImpact: 'NONE',
  };
}

export function candidateProgramRecords(candidate: CandidateWithSupplyContext, supplyContext: PerSymbolSupplyContext): Record<string, unknown>[] {
  const maybeCandidate = candidate as Record<string, unknown>;
  return collectProgramRecordsFromItems([
    supplyContext,
    candidate.preflight?.supplyContext,
    candidate.gateContext?.supplyContext,
    candidate.scoringContext?.supplyContext,
    candidate.supplyContext,
    maybeCandidate.programFlow,
    maybeCandidate.stockProgramFlow,
    maybeCandidate.programTrading,
    maybeCandidate.programDiagnostic,
    maybeCandidate.supplyDiagnostic,
    maybeCandidate.diagnosticContext,
    maybeCandidate.runtimeDiagnosticSnapshot,
    maybeCandidate.runtimeSnapshot,
    maybeCandidate.snapshot,
    maybeCandidate.cache,
    maybeCandidate.latestSnapshot,
    maybeCandidate.latestSanitizedSnapshot,
    maybeCandidate.preflight,
    maybeCandidate.gateContext,
    maybeCandidate.scoringContext,
    maybeCandidate,
  ]);
}

export function programNetBuyAmountFieldState(records: Record<string, unknown>[]): { created: boolean; nonNull: boolean } {
  let created = false;
  let nonNull = false;
  for (const record of records) {
    if (!Object.prototype.hasOwnProperty.call(record, 'programNetBuyAmount')) continue;
    created = true;
    if (record.programNetBuyAmount !== undefined && record.programNetBuyAmount !== null) nonNull = true;
  }
  return { created, nonNull };
}

export function stockUpstreamSourceRecords(
  candidate: CandidateWithSupplyContext,
  symbol: string,
  latestIntradayProgramFlowSnapshot?: IntradayProgramFlowSnapshot | null,
): {
  latestIntradayProgramFlowSnapshot: { all: Record<string, unknown>[]; matched: Record<string, unknown>[] };
  snapshot: { all: Record<string, unknown>[]; matched: Record<string, unknown>[] };
  cache: { all: Record<string, unknown>[]; matched: Record<string, unknown>[] };
  programTrading: { all: Record<string, unknown>[]; matched: Record<string, unknown>[] };
} {
  const maybeCandidate = candidate as Record<string, unknown>;
  const latestIntradayProgramFlowSnapshotItems = latestIntradayProgramFlowSnapshot
    ? [latestIntradayProgramFlowSnapshot.stockRows]
    : [];
  const snapshotItems = [
    maybeCandidate.latestIntradayProgramSnapshot,
    maybeCandidate.intradayProgramSnapshot,
    maybeCandidate.programTradingSnapshot,
    maybeCandidate.snapshot,
    maybeCandidate.runtimeSnapshot,
    maybeCandidate.latestSnapshot,
    maybeCandidate.latestSanitizedSnapshot,
  ];
  const cacheItems = [
    maybeCandidate.supplySnapshotCache,
    maybeCandidate.programTradingCache,
    maybeCandidate.cache,
  ];
  const programTradingItems = [
    maybeCandidate.programTrading,
    maybeCandidate.programDiagnostic,
    maybeCandidate.stockProgramFlow,
    maybeCandidate.programFlow,
    maybeCandidate.supplyDiagnostic,
    maybeCandidate.diagnosticContext,
    maybeCandidate.runtimeDiagnosticSnapshot,
  ];
  return {
    latestIntradayProgramFlowSnapshot: {
      all: collectUpstreamProgramRecords(latestIntradayProgramFlowSnapshotItems, symbol),
      matched: collectUpstreamProgramRecords(latestIntradayProgramFlowSnapshotItems, symbol),
    },
    snapshot: {
      all: collectUpstreamProgramRecords(snapshotItems),
      matched: collectUpstreamProgramRecords(snapshotItems, symbol),
    },
    cache: {
      all: collectUpstreamProgramRecords(cacheItems),
      matched: collectUpstreamProgramRecords(cacheItems, symbol),
    },
    programTrading: {
      all: collectUpstreamProgramRecords(programTradingItems),
      matched: collectUpstreamProgramRecords(programTradingItems, symbol),
    },
  };
}

export function collectProgramRecordsFromItems(items: unknown[]): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  for (const item of items) {
    const record = asRecord(item);
    if (record) collectProgramRecordsInto(record, records, seen, 0);
  }
  return records;
}

export function collectProgramRecords(record: Record<string, unknown>): Record<string, unknown>[] {
  return collectProgramRecordsFromItems([record]);
}

export function candidatePreviewSymbol(candidate: CandidateWithSupplyContext): string {
  const ctx = candidate.preflight?.supplyContext ?? candidate.supplyContext;
  return normalizePreviewSymbol(candidate.symbol ?? ctx?.symbol ?? candidate.code);
}

export function directRecordsFromItems(items: unknown[]): Record<string, unknown>[] {
  return items.map(asRecord).filter((record): record is Record<string, unknown> => !!record);
}

export function collectUpstreamProgramRecords(items: unknown[], symbol?: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  for (const item of items) collectUpstreamProgramRecordsInto(item, records, seen, 0, symbol);
  return records;
}

export function marketSnapshotItems(record: Record<string, unknown>): unknown[] {
  return [
    record.latestIntradayMarketProgramSnapshot,
    record.intradayMarketProgramSnapshot,
    record.programTradingSnapshot,
    record.snapshot,
    record.runtimeSnapshot,
    record.latestSnapshot,
    record.latestSanitizedSnapshot,
  ];
}

export function marketCacheItems(record: Record<string, unknown>): unknown[] {
  return [
    record.programMarketCache,
    record.programTradingCache,
    record.supplySnapshotCache,
    record.cache,
  ];
}

export function marketLevelProgramRecords(records: Record<string, unknown>[]): Record<string, unknown>[] {
  return records.filter((record) => !normalizeRecordSymbol(record));
}

export function countRowsWithAnyProgramKey(records: Record<string, unknown>[], keys: string[]): number {
  return records.filter((record) => Object.keys(record).some((key) => keys.includes(key))).length;
}

export function countRowsWithParsableProgramValue(records: Record<string, unknown>[], keys: string[]): number {
  return records.filter((record) => firstOkProgramValueFromRecords([record], keys)).length;
}

export function firstOkProgramValueFromRecords(
  records: Record<string, unknown>[],
  keys: string[],
): (ProgramFlowValueNormalizationResult & { key: string; value: number }) | undefined {
  for (const record of records) {
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
      const normalized = normalizeProgramFlowValue(record[key]);
      if (normalized.ok && normalized.value !== undefined) return { ...normalized, key, value: normalized.value };
    }
  }
  return undefined;
}

export function marketProgramNetBuyFieldState(records: Record<string, unknown>[]): { created: boolean; nonNull: boolean } {
  let created = false;
  let nonNull = false;
  for (const record of records) {
    if (!Object.prototype.hasOwnProperty.call(record, 'marketProgramNetBuy')) continue;
    created = true;
    if (record.marketProgramNetBuy !== undefined && record.marketProgramNetBuy !== null) nonNull = true;
  }
  return { created, nonNull };
}

export function hasProgramField(record: Record<string, unknown>): boolean {
  return hasAnyKey(record, PROGRAM_FIELD_KEYS);
}

export function firstValueFromRecords(records: Record<string, unknown>[], keys: string[]): unknown {
  for (const record of records) {
    for (const key of keys) {
      if (record[key] !== undefined && record[key] !== null) return record[key];
    }
  }
  return undefined;
}

export function firstNumberFromRecords(records: Record<string, unknown>[], keys: string[]): number | undefined {
  for (const record of records) {
    const value = firstNumber(record, keys);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function firstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  const normalized = firstNormalizedProgramValue(record, keys);
  return normalized?.value;
}

export function firstNormalizedProgramValue(
  record: Record<string, unknown>,
  keys: string[],
): (ProgramFlowValueNormalizationResult & { key: string }) | undefined {
  let firstFailure: (ProgramFlowValueNormalizationResult & { key: string }) | undefined;
  for (const key of keys) {
    if (record[key] === undefined) continue;
    const normalized = normalizeProgramFlowValue(record[key]);
    const keyed = { ...normalized, key };
    if (normalized.ok) return keyed;
    firstFailure ??= keyed;
  }
  return firstFailure;
}

export function firstProgramValueNormalization(
  records: Record<string, unknown>[],
  keys: string[],
): (ProgramFlowValueNormalizationResult & { key: string }) | undefined {
  let firstFailure: (ProgramFlowValueNormalizationResult & { key: string }) | undefined;
  for (const record of records) {
    for (const key of keys) {
      if (record[key] === undefined) continue;
      const normalized = normalizeProgramFlowValue(record[key]);
      const keyed = { ...normalized, key };
      if (normalized.ok) return keyed;
      firstFailure ??= keyed;
    }
  }
  return firstFailure;
}

export function parseFiniteNumber(value: unknown): number | undefined {
  const normalized = normalizeProgramFlowValue(value);
  return normalized.ok ? normalized.value : undefined;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function isStockProgramScanKey(key: string): boolean {
  return STOCK_PROGRAM_SCAN_KEYS.includes(key);
}

export function hasNestedRecordKey(record: Record<string, unknown> | null, targetKey: string, depth = 0, seen = new Set<unknown>()): boolean {
  if (!record || depth > 5 || seen.has(record)) return false;
  seen.add(record);
  if (asRecord(record[targetKey])) return true;
  for (const value of Object.values(record)) {
    const nested = asRecord(value);
    if (nested && hasNestedRecordKey(nested, targetKey, depth + 1, seen)) return true;
  }
  return false;
}

export function hasAnyProgramReasons(evidenceTrace: ProgramFlowEvidenceTrace, reasons: string[]): boolean {
  const wanted = new Set(reasons);
  return allProgramReasonEntries(evidenceTrace).some((reason) => wanted.has(reason));
}

export function hasOnlyProgramReasons(evidenceTrace: ProgramFlowEvidenceTrace, reasons: string[]): boolean {
  const entries = allProgramReasonEntries(evidenceTrace);
  if (entries.length === 0) return false;
  const allowed = new Set(reasons);
  return entries.every((reason) => allowed.has(reason));
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function allProgramReasonEntries(evidenceTrace: ProgramFlowEvidenceTrace): string[] {
  return [
    ...Object.keys(evidenceTrace.stockLevel.valueReasonDistribution),
    ...Object.keys(evidenceTrace.marketLevel.valueReasonDistribution),
  ];
}

function collectUpstreamProgramRecordsInto(
  value: unknown,
  records: Record<string, unknown>[],
  seen: Set<unknown>,
  depth: number,
  symbol?: string,
): void {
  if (value === null || value === undefined || depth > 5 || seen.has(value)) return;
  if (Array.isArray(value)) {
    seen.add(value);
    for (const item of value) collectUpstreamProgramRecordsInto(item, records, seen, depth + 1, symbol);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  seen.add(record);
  if (recordMatchesSymbolOrUnspecified(record, symbol)) records.push(record);
  for (const key of UPSTREAM_PROGRAM_RECORD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    collectUpstreamProgramRecordsInto(record[key], records, seen, depth + 1, symbol);
  }
}

function recordMatchesSymbolOrUnspecified(record: Record<string, unknown>, symbol?: string): boolean {
  if (!symbol) return true;
  const recordSymbol = normalizeRecordSymbol(record);
  return !recordSymbol || recordSymbol === symbol;
}

function normalizeRecordSymbol(record: Record<string, unknown>): string {
  for (const key of ['symbol', 'normalizedSymbol', 'stockCode', 'code', 'shortCode']) {
    const normalized = normalizePreviewSymbol(record[key]);
    if (normalized) return normalized;
  }
  return '';
}

function collectProgramRecordsInto(
  record: Record<string, unknown>,
  records: Record<string, unknown>[],
  seen: Set<unknown>,
  depth: number,
): void {
  if (seen.has(record) || depth > 4) return;
  seen.add(record);
  records.push(record);
  for (const key of MARKET_PROGRAM_RECORD_KEYS) {
    const nested = asRecord(record[key]);
    if (nested) collectProgramRecordsInto(nested, records, seen, depth + 1);
  }
}

function hasAnyKey(record: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => record[key] !== undefined && record[key] !== null);
}

function collectProgramKeysInto(record: Record<string, unknown> | null, target: Set<string>, keys: string[]): void {
  if (!record) return;
  const records = collectProgramRecords(record);
  for (const item of records) {
    for (const key of Object.keys(item)) {
      if (keys.includes(key)) target.add(key);
    }
  }
}

function sortedKeys(counts: Map<string, number>): string[] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key]) => key);
}

function incrementCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function pushUniqueLimited(values: string[], value: string, limit: number): void {
  if (values.length >= limit || values.includes(value)) return;
  values.push(value);
}

function normalizePreviewSymbol(value: unknown): string {
  if (typeof value !== 'string') return '';
  const digits = value.replace(/[^0-9]/g, '');
  return digits.length >= 6 ? digits.slice(-6) : digits;
}

function missingSupplyContextForEvidence(symbol: string): PerSymbolSupplyContext {
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
