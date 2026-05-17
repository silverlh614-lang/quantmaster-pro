// @responsibility Diagnostic-only latest intraday stock/market program flow snapshot/cache.
import fs from 'fs';
import path from 'path';
import {
  LATEST_INTRADAY_PROGRAM_FLOW_SNAPSHOT_FILE,
  REPLAY_DIR,
  ensureReplayDir,
} from '../persistence/paths.js';
import {
  classifyProgramFlowSession,
  type ProgramFlowMarketSession,
} from '../trading/signalScanner/programFlowSessionGuard.js';

export type IntradayProgramFlowSourceProvider = 'KIS_API' | 'KRX_API' | 'CACHE' | 'SNAPSHOT' | 'NONE';
export type IntradayProgramFlowDataStatus = 'VERIFIED' | 'EMPTY_VALID' | 'STALE' | 'MISSING' | 'UNKNOWN';
export type IntradayProgramFlowSignal = 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'UNKNOWN' | 'UNAVAILABLE';

export interface IntradayProgramFlowStockRow {
  symbol: string;
  normalizedSymbol: string;
  name?: string;
  programNetBuyAmount?: number | null;
  programBuyAmount?: number | null;
  programSellAmount?: number | null;
  programNetVolume?: number | null;
  programNetValue?: number | null;
  sourceProvider: IntradayProgramFlowSourceProvider;
  dataStatus: IntradayProgramFlowDataStatus;
  providerIssue: boolean;
  marketSignal: boolean;
  capturedAt?: string;
  reason?: string;
}

export interface IntradayProgramFlowMarketSnapshot {
  available: boolean;
  marketProgramNetBuy?: number | null;
  kospiProgramNetBuy?: number | null;
  kosdaqProgramNetBuy?: number | null;
  combinedProgramNetBuy?: number | null;
  signal?: IntradayProgramFlowSignal;
  sourceProvider: IntradayProgramFlowSourceProvider;
  dataStatus: IntradayProgramFlowDataStatus;
  providerIssue: boolean;
  marketSignal: boolean;
  capturedAt?: string;
  reason?: string;
}

export interface IntradayProgramFlowSnapshot {
  snapshotId: string;
  snapshotKind: 'INTRADAY_PROGRAM_FLOW_SNAPSHOT';
  capturedAt: string;
  capturedAtKst: string;
  marketDate: string;
  timezone: 'Asia/Seoul';
  source: 'RUNTIME_PROGRAM_FLOW';
  replayOnly: true;
  diagnosticOnly: true;
  executionImpact: 'NONE';
  stockRows: IntradayProgramFlowStockRow[];
  marketProgram: IntradayProgramFlowMarketSnapshot;
  summary: {
    stockRowsTotal: number;
    stockRowsWithProgramValue: number;
    marketProgramAvailable: boolean;
    providerCallsAdded: 0;
  };
  sanitize: {
    applied: true;
    rawPayloadStored: false;
    removedSensitiveFields: string[];
  };
}

export interface IntradayProgramFlowSnapshotCaptureResult {
  status: 'CAPTURED' | 'SKIPPED' | 'FAILED';
  snapshot?: IntradayProgramFlowSnapshot;
  reason?: string;
  previousSnapshotPreserved: true;
  executionImpact: 'NONE';
  marketSession?: ProgramFlowMarketSession;
  programFlowExpected?: boolean;
  contextHasProgramFields?: boolean;
  contextProgramFieldsFound?: string[];
  contextProgramValuesFound?: number;
  contextParsableProgramValuesFound?: number;
  rawPayloadStored?: false;
  providerCallsAdded?: 0;
}

const STOCK_RECORD_CONTAINER_KEYS = [
  'stockRows',
  'stockProgramRows',
  'candidateRows',
  'candidates',
  'buyList',
  'programRows',
  'rows',
  'items',
  'programTrading',
  'programDiagnostic',
  'programFlow',
  'stockProgramFlow',
  'supplyDiagnostic',
  'diagnosticContext',
  'runtimeDiagnosticSnapshot',
  'providerDiagnostics',
  'snapshot',
  'runtimeSnapshot',
  'latestSnapshot',
  'latestSanitizedSnapshot',
  'cache',
  'supplySnapshotCache',
  'programTradingCache',
];

const MARKET_RECORD_CONTAINER_KEYS = [
  'marketProgram',
  'programMarket',
  'marketProgramFlow',
  'programToday',
  'programTrading',
  'programDiagnostic',
  'programFlow',
  'diagnosticContext',
  'runtimeDiagnosticSnapshot',
  'providerDiagnostics',
  'snapshot',
  'runtimeSnapshot',
  'latestSnapshot',
  'latestSanitizedSnapshot',
  'cache',
  'programMarketCache',
  'programTradingCache',
];

const STOCK_PROGRAM_NET_KEYS = [
  'programNetBuyAmount',
  'stockProgramNetBuy',
  'stockProgramNetAmount',
  'programNetBuy',
  'programNetAmount',
  'programNetValue',
  'programNetVolume',
  'program_net_buy',
  'program_net_amount',
  'prgm_net_amt',
  'prgm_net_qty',
];
const STOCK_PROGRAM_BUY_KEYS = ['programBuyAmount', 'stockProgramBuyAmount', 'programBuy', 'buyAmount', 'prgm_buy_amt', 'prgm_buy_qty'];
const STOCK_PROGRAM_SELL_KEYS = ['programSellAmount', 'stockProgramSellAmount', 'programSell', 'sellAmount', 'prgm_sell_amt', 'prgm_sell_qty'];
const MARKET_PROGRAM_NET_KEYS = [
  'marketProgramNetBuy',
  'combinedProgramNetBuy',
  'programMarketNetBuy',
  'marketProgramNetAmount',
  'programNetBuyAmount',
  'programNetBuy',
  'programNetAmount',
  'combinedNetBuy',
];
const MARKET_PROGRAM_KOSPI_KEYS = ['kospiProgramNetBuy', 'kospiNetBuy'];
const MARKET_PROGRAM_KOSDAQ_KEYS = ['kosdaqProgramNetBuy', 'kosdaqNetBuy'];
const PROGRAM_FIELD_KEYS = [
  ...STOCK_PROGRAM_NET_KEYS,
  ...STOCK_PROGRAM_BUY_KEYS,
  ...STOCK_PROGRAM_SELL_KEYS,
  ...MARKET_PROGRAM_NET_KEYS,
  ...MARKET_PROGRAM_KOSPI_KEYS,
  ...MARKET_PROGRAM_KOSDAQ_KEYS,
];
const FORBIDDEN_FIELD_PATTERNS = [
  /token/i,
  /authorization/i,
  /appkey/i,
  /appsecret/i,
  /^cano$/i,
  /accountno/i,
  /accountnumber/i,
  /orderno/i,
  /orderid/i,
  /custtype/i,
  /password/i,
  /secret/i,
  /credential/i,
  /^auth$/i,
  /cookie/i,
];

export function saveLatestIntradayProgramFlowSnapshot(
  snapshot: IntradayProgramFlowSnapshot,
): IntradayProgramFlowSnapshot {
  ensureReplayDir();
  const sanitized = sanitizeIntradayProgramFlowSnapshot(snapshot);
  atomicWriteJson(snapshotFilePath(), sanitized);
  return sanitized;
}

export function loadLatestIntradayProgramFlowSnapshot(): IntradayProgramFlowSnapshot | null {
  const snapshot = safeReadJson<IntradayProgramFlowSnapshot>(snapshotFilePath());
  if (!snapshot) return null;
  const sanitized = sanitizeIntradayProgramFlowSnapshot(snapshot);
  if (sanitized.replayOnly !== true) return null;
  if (sanitized.diagnosticOnly !== true) return null;
  if (sanitized.executionImpact !== 'NONE') return null;
  return sanitized;
}

export function hasLatestIntradayProgramFlowSnapshot(): boolean {
  return fs.existsSync(snapshotFilePath());
}

export function captureLatestIntradayProgramFlowSnapshotFromRuntimeContext(
  context: unknown,
  now = new Date(),
): IntradayProgramFlowSnapshotCaptureResult {
  const sessionGuard = classifyProgramFlowSession(now);
  const contextStats = buildProgramFlowRuntimeContextStats(context);
  try {
    const snapshot = mergeWithExistingSnapshot(
      loadLatestIntradayProgramFlowSnapshot(),
      buildIntradayProgramFlowSnapshotFromRuntimeContext(context, now),
    );
    if (snapshot.summary.stockRowsWithProgramValue === 0 && !snapshot.summary.marketProgramAvailable) {
      const reason = classifyProgramFlowSnapshotSkipReason(sessionGuard, contextStats);
      console.info(
        `[INTRADAY_PROGRAM_FLOW_SNAPSHOT_SKIPPED] ` +
          `reason=${reason} marketSession=${sessionGuard.marketSession} ` +
          `programFlowExpected=${sessionGuard.programFlowExpected} ` +
          `contextHasProgramFields=${contextStats.contextHasProgramFields} ` +
          `contextProgramFieldsFound=${contextStats.contextProgramFieldsFound.join(',') || 'NONE'} ` +
          `contextProgramValuesFound=${contextStats.contextProgramValuesFound} ` +
          `contextParsableProgramValuesFound=${contextStats.contextParsableProgramValuesFound} ` +
          `previousSnapshotPreserved=true rawPayloadStored=false providerCallsAdded=0 executionImpact=NONE`,
      );
      return {
        status: 'SKIPPED',
        reason,
        previousSnapshotPreserved: true,
        executionImpact: 'NONE',
        marketSession: sessionGuard.marketSession,
        programFlowExpected: sessionGuard.programFlowExpected,
        contextHasProgramFields: contextStats.contextHasProgramFields,
        contextProgramFieldsFound: contextStats.contextProgramFieldsFound,
        contextProgramValuesFound: contextStats.contextProgramValuesFound,
        contextParsableProgramValuesFound: contextStats.contextParsableProgramValuesFound,
        rawPayloadStored: false,
        providerCallsAdded: 0,
      };
    }
    const saved = saveLatestIntradayProgramFlowSnapshot(snapshot);
    console.info(
      `[INTRADAY_PROGRAM_FLOW_SNAPSHOT_CAPTURED] ` +
        `snapshotId=${saved.snapshotId} marketDate=${saved.marketDate} ` +
        `stockRowsTotal=${saved.summary.stockRowsTotal} ` +
        `stockRowsWithProgramValue=${saved.summary.stockRowsWithProgramValue} ` +
        `marketProgramAvailable=${saved.summary.marketProgramAvailable} ` +
        `marketSession=${sessionGuard.marketSession} programFlowExpected=${sessionGuard.programFlowExpected} ` +
        `contextHasProgramFields=${contextStats.contextHasProgramFields} ` +
        `contextProgramValuesFound=${contextStats.contextProgramValuesFound} ` +
        `contextParsableProgramValuesFound=${contextStats.contextParsableProgramValuesFound} ` +
        `source=RUNTIME_PROGRAM_FLOW rawPayloadStored=false providerCallsAdded=0 executionImpact=NONE`,
    );
    return {
      status: 'CAPTURED',
      snapshot: saved,
      previousSnapshotPreserved: true,
      executionImpact: 'NONE',
      marketSession: sessionGuard.marketSession,
      programFlowExpected: sessionGuard.programFlowExpected,
      contextHasProgramFields: contextStats.contextHasProgramFields,
      contextProgramFieldsFound: contextStats.contextProgramFieldsFound,
      contextProgramValuesFound: contextStats.contextProgramValuesFound,
      contextParsableProgramValuesFound: contextStats.contextParsableProgramValuesFound,
      rawPayloadStored: false,
      providerCallsAdded: 0,
    };
  } catch (error) {
    console.warn(
      `[INTRADAY_PROGRAM_FLOW_SNAPSHOT_CAPTURE_FAILED] ` +
        `reason=${safeLogToken(error instanceof Error ? error.message : String(error))} ` +
        `previousSnapshotPreserved=true executionImpact=NONE`,
    );
    return {
      status: 'FAILED',
      reason: error instanceof Error ? error.message : String(error),
      previousSnapshotPreserved: true,
      executionImpact: 'NONE',
      marketSession: sessionGuard.marketSession,
      programFlowExpected: sessionGuard.programFlowExpected,
      contextHasProgramFields: contextStats.contextHasProgramFields,
      contextProgramFieldsFound: contextStats.contextProgramFieldsFound,
      contextProgramValuesFound: contextStats.contextProgramValuesFound,
      contextParsableProgramValuesFound: contextStats.contextParsableProgramValuesFound,
      rawPayloadStored: false,
      providerCallsAdded: 0,
    };
  }
}

interface ProgramFlowRuntimeContextStats {
  contextHasProgramFields: boolean;
  contextProgramFieldsFound: string[];
  contextProgramValuesFound: number;
  contextParsableProgramValuesFound: number;
}

function buildProgramFlowRuntimeContextStats(context: unknown): ProgramFlowRuntimeContextStats {
  const records = collectRecords(context, [...STOCK_RECORD_CONTAINER_KEYS, ...MARKET_RECORD_CONTAINER_KEYS]);
  const fieldsFound = new Set<string>();
  let valuesFound = 0;
  let parsableValuesFound = 0;
  for (const record of records) {
    for (const key of PROGRAM_FIELD_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
      fieldsFound.add(key);
      const value = record[key];
      if (value !== null && value !== undefined && value !== '') valuesFound++;
      if (normalizeNumberLike(value) !== null) parsableValuesFound++;
    }
  }
  return {
    contextHasProgramFields: fieldsFound.size > 0,
    contextProgramFieldsFound: [...fieldsFound].sort(),
    contextProgramValuesFound: valuesFound,
    contextParsableProgramValuesFound: parsableValuesFound,
  };
}

function classifyProgramFlowSnapshotSkipReason(
  sessionGuard: ReturnType<typeof classifyProgramFlowSession>,
  stats: ProgramFlowRuntimeContextStats,
): string {
  if (!sessionGuard.programFlowExpected) {
    if (sessionGuard.marketSession === 'WEEKEND') return 'WEEKEND_NO_PROGRAM_FLOW_EXPECTED';
    if (sessionGuard.marketSession === 'HOLIDAY') return 'HOLIDAY_NO_PROGRAM_FLOW_EXPECTED';
    return 'MARKET_CLOSED_NO_PROGRAM_FLOW_EXPECTED';
  }
  if (!stats.contextHasProgramFields) return 'REGULAR_SESSION_CONTEXT_HAS_NO_PROGRAM_FIELDS';
  if (stats.contextProgramValuesFound === 0) return 'REGULAR_SESSION_CONTEXT_HAS_FIELDS_BUT_VALUES_NULL';
  if (stats.contextParsableProgramValuesFound === 0) return 'REGULAR_SESSION_PROGRAM_FIELD_PARSE_FAILED';
  return 'REGULAR_SESSION_NO_PROGRAM_FLOW_VALUES';
}

function mergeWithExistingSnapshot(
  existing: IntradayProgramFlowSnapshot | null,
  incoming: IntradayProgramFlowSnapshot,
): IntradayProgramFlowSnapshot {
  if (!existing) return incoming;
  const stockRowsBySymbol = new Map<string, IntradayProgramFlowStockRow>();
  for (const row of existing.stockRows) stockRowsBySymbol.set(row.symbol, row);
  for (const row of incoming.stockRows) {
    const current = stockRowsBySymbol.get(row.symbol);
    if (!current || hasStockProgramValue(row) || !hasStockProgramValue(current)) {
      stockRowsBySymbol.set(row.symbol, row);
    }
  }
  const marketProgram = incoming.marketProgram.available || !existing.marketProgram.available
    ? incoming.marketProgram
    : existing.marketProgram;
  return sanitizeIntradayProgramFlowSnapshot({
    ...incoming,
    stockRows: [...stockRowsBySymbol.values()],
    marketProgram,
  });
}

export function buildIntradayProgramFlowSnapshotFromRuntimeContext(
  context: unknown,
  now = new Date(),
): IntradayProgramFlowSnapshot {
  const capturedAt = now.toISOString();
  const marketDate = kstDateString(now.getTime());
  return sanitizeIntradayProgramFlowSnapshot({
    snapshotId: generateIntradayProgramFlowSnapshotId(now.getTime()),
    snapshotKind: 'INTRADAY_PROGRAM_FLOW_SNAPSHOT',
    capturedAt,
    capturedAtKst: kstDateTimeString(now.getTime()),
    marketDate,
    timezone: 'Asia/Seoul',
    source: 'RUNTIME_PROGRAM_FLOW',
    replayOnly: true,
    diagnosticOnly: true,
    executionImpact: 'NONE',
    stockRows: buildStockRowsFromRuntimeContext(context, capturedAt),
    marketProgram: buildMarketProgramFromRuntimeContext(context, capturedAt),
    summary: {
      stockRowsTotal: 0,
      stockRowsWithProgramValue: 0,
      marketProgramAvailable: false,
      providerCallsAdded: 0,
    },
    sanitize: {
      applied: true,
      rawPayloadStored: false,
      removedSensitiveFields: collectSensitiveFieldNames(context),
    },
  });
}

export function sanitizeIntradayProgramFlowSnapshot(input: Partial<IntradayProgramFlowSnapshot>): IntradayProgramFlowSnapshot {
  const capturedAt = typeof input.capturedAt === 'string' ? input.capturedAt : new Date().toISOString();
  const capturedAtMs = Date.parse(capturedAt);
  const safeCapturedAtMs = Number.isFinite(capturedAtMs) ? capturedAtMs : Date.now();
  const stockRows = sanitizeStockRows(input.stockRows ?? []);
  const marketProgram = sanitizeMarketProgram(input.marketProgram, capturedAt);
  return {
    snapshotId: typeof input.snapshotId === 'string' ? safeLogToken(input.snapshotId) : generateIntradayProgramFlowSnapshotId(safeCapturedAtMs),
    snapshotKind: 'INTRADAY_PROGRAM_FLOW_SNAPSHOT',
    capturedAt,
    capturedAtKst: typeof input.capturedAtKst === 'string' ? input.capturedAtKst : kstDateTimeString(safeCapturedAtMs),
    marketDate: typeof input.marketDate === 'string' ? input.marketDate : kstDateString(safeCapturedAtMs),
    timezone: 'Asia/Seoul',
    source: 'RUNTIME_PROGRAM_FLOW',
    replayOnly: true,
    diagnosticOnly: true,
    executionImpact: 'NONE',
    stockRows,
    marketProgram,
    summary: {
      stockRowsTotal: stockRows.length,
      stockRowsWithProgramValue: stockRows.filter((row) => hasStockProgramValue(row)).length,
      marketProgramAvailable: marketProgram.available,
      providerCallsAdded: 0,
    },
    sanitize: {
      applied: true,
      rawPayloadStored: false,
      removedSensitiveFields: [
        ...new Set([
          ...(input.sanitize?.removedSensitiveFields ?? []),
          ...collectSensitiveFieldNames(input),
        ]),
      ].sort(),
    },
  };
}

function buildStockRowsFromRuntimeContext(context: unknown, capturedAt: string): IntradayProgramFlowStockRow[] {
  const records = collectRecords(context, STOCK_RECORD_CONTAINER_KEYS);
  const bySymbol = new Map<string, IntradayProgramFlowStockRow>();
  for (const record of records) {
    const symbol = normalizeSymbol(firstValue(record, ['symbol', 'normalizedSymbol', 'stockCode', 'code', 'shortCode']));
    if (!symbol || !recordHasProgramField(record)) continue;
    const row = buildStockRowFromRecord(symbol, record, capturedAt);
    const existing = bySymbol.get(symbol);
    if (!existing || (!hasStockProgramValue(existing) && hasStockProgramValue(row))) bySymbol.set(symbol, row);
  }
  return [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function buildStockRowFromRecord(
  symbol: string,
  record: Record<string, unknown>,
  capturedAt: string,
): IntradayProgramFlowStockRow {
  const buyAmount = firstNumber(record, STOCK_PROGRAM_BUY_KEYS);
  const sellAmount = firstNumber(record, STOCK_PROGRAM_SELL_KEYS);
  const explicitNet = firstNumber(record, STOCK_PROGRAM_NET_KEYS);
  const netAmount = explicitNet ?? (buyAmount !== null && sellAmount !== null ? buyAmount - sellAmount : null);
  const providerIssue = record.providerIssue === true;
  const marketSignal = netAmount !== null && !providerIssue;
  return {
    symbol,
    normalizedSymbol: symbol,
    name: safeOptionalString(firstValue(record, ['name', 'stockName', 'korName'])),
    programNetBuyAmount: netAmount,
    programBuyAmount: buyAmount,
    programSellAmount: sellAmount,
    programNetVolume: firstNumber(record, ['programNetVolume', 'programNetBuyQty', 'prgm_net_qty']),
    programNetValue: firstNumber(record, ['programNetValue', 'programNetAmount']),
    sourceProvider: normalizeSourceProvider(firstValue(record, ['sourceProvider', 'source', 'provider'])),
    dataStatus: netAmount !== null ? 'VERIFIED' : providerIssue ? 'UNKNOWN' : 'MISSING',
    providerIssue,
    marketSignal,
    capturedAt: safeOptionalString(firstValue(record, ['capturedAt', 'fetchedAt', 'updatedAt'])) ?? capturedAt,
    reason: netAmount !== null ? 'PROGRAM_FLOW_AVAILABLE_DIAGNOSTIC_ONLY' : 'PROGRAM_VALUE_NULL',
  };
}

function buildMarketProgramFromRuntimeContext(
  context: unknown,
  capturedAt: string,
): IntradayProgramFlowMarketSnapshot {
  const records = collectRecords(context, MARKET_RECORD_CONTAINER_KEYS).filter((record) => !normalizeSymbol(firstValue(record, ['symbol', 'normalizedSymbol', 'stockCode', 'code', 'shortCode'])));
  for (const record of records) {
    if (!recordHasProgramField(record)) continue;
    const market = buildMarketProgramFromRecord(record, capturedAt);
    if (market.available || market.marketProgramNetBuy !== null || market.combinedProgramNetBuy !== null) return market;
  }
  return emptyMarketProgram(capturedAt, 'NO_MARKET_PROGRAM_FLOW_IN_RUNTIME_CONTEXT');
}

function buildMarketProgramFromRecord(
  record: Record<string, unknown>,
  capturedAt: string,
): IntradayProgramFlowMarketSnapshot {
  const kospiProgramNetBuy = firstNumber(record, MARKET_PROGRAM_KOSPI_KEYS);
  const kosdaqProgramNetBuy = firstNumber(record, MARKET_PROGRAM_KOSDAQ_KEYS);
  const explicitCombined = firstNumber(record, MARKET_PROGRAM_NET_KEYS);
  const combinedProgramNetBuy = explicitCombined ?? (
    kospiProgramNetBuy !== null || kosdaqProgramNetBuy !== null
      ? (kospiProgramNetBuy ?? 0) + (kosdaqProgramNetBuy ?? 0)
      : null
  );
  const providerIssue = record.providerIssue === true;
  const available = combinedProgramNetBuy !== null && !providerIssue;
  return {
    available,
    marketProgramNetBuy: combinedProgramNetBuy,
    kospiProgramNetBuy,
    kosdaqProgramNetBuy,
    combinedProgramNetBuy,
    signal: available ? signalFromNetBuy(combinedProgramNetBuy) : 'UNAVAILABLE',
    sourceProvider: normalizeSourceProvider(firstValue(record, ['sourceProvider', 'source', 'provider'])),
    dataStatus: available ? 'VERIFIED' : providerIssue ? 'UNKNOWN' : 'MISSING',
    providerIssue,
    marketSignal: available,
    capturedAt: safeOptionalString(firstValue(record, ['capturedAt', 'fetchedAt', 'updatedAt'])) ?? capturedAt,
    reason: available ? 'PROGRAM_FLOW_AVAILABLE_DIAGNOSTIC_ONLY' : 'PROGRAM_VALUE_NULL',
  };
}

function sanitizeStockRows(rows: IntradayProgramFlowStockRow[]): IntradayProgramFlowStockRow[] {
  const bySymbol = new Map<string, IntradayProgramFlowStockRow>();
  for (const row of rows) {
    const symbol = normalizeSymbol(row.symbol ?? row.normalizedSymbol);
    if (!symbol) continue;
    const sanitized: IntradayProgramFlowStockRow = {
      symbol,
      normalizedSymbol: symbol,
      name: safeOptionalString(row.name),
      programNetBuyAmount: nullableNumber(row.programNetBuyAmount),
      programBuyAmount: nullableNumber(row.programBuyAmount),
      programSellAmount: nullableNumber(row.programSellAmount),
      programNetVolume: nullableNumber(row.programNetVolume),
      programNetValue: nullableNumber(row.programNetValue),
      sourceProvider: normalizeSourceProvider(row.sourceProvider),
      dataStatus: normalizeDataStatus(row.dataStatus, hasStockProgramValue(row)),
      providerIssue: row.providerIssue === true,
      marketSignal: row.marketSignal === true && row.providerIssue !== true,
      capturedAt: safeOptionalString(row.capturedAt),
      reason: safeOptionalString(row.reason),
    };
    if (!sanitized.marketSignal && hasStockProgramValue(sanitized) && !sanitized.providerIssue) sanitized.marketSignal = true;
    const existing = bySymbol.get(symbol);
    if (!existing || (!hasStockProgramValue(existing) && hasStockProgramValue(sanitized))) bySymbol.set(symbol, sanitized);
  }
  return [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function sanitizeMarketProgram(
  marketProgram: IntradayProgramFlowMarketSnapshot | undefined,
  capturedAt: string,
): IntradayProgramFlowMarketSnapshot {
  if (!marketProgram) return emptyMarketProgram(capturedAt, 'NO_MARKET_PROGRAM_FLOW_IN_RUNTIME_CONTEXT');
  const combined = nullableNumber(marketProgram.combinedProgramNetBuy ?? marketProgram.marketProgramNetBuy);
  const providerIssue = marketProgram.providerIssue === true;
  const available = Boolean(marketProgram.available && combined !== null && !providerIssue);
  return {
    available,
    marketProgramNetBuy: nullableNumber(marketProgram.marketProgramNetBuy ?? combined),
    kospiProgramNetBuy: nullableNumber(marketProgram.kospiProgramNetBuy),
    kosdaqProgramNetBuy: nullableNumber(marketProgram.kosdaqProgramNetBuy),
    combinedProgramNetBuy: combined,
    signal: available ? signalFromNetBuy(combined) : normalizeSignal(marketProgram.signal),
    sourceProvider: normalizeSourceProvider(marketProgram.sourceProvider),
    dataStatus: normalizeDataStatus(marketProgram.dataStatus, available),
    providerIssue,
    marketSignal: available,
    capturedAt: safeOptionalString(marketProgram.capturedAt) ?? capturedAt,
    reason: safeOptionalString(marketProgram.reason) ?? (available ? 'PROGRAM_FLOW_AVAILABLE_DIAGNOSTIC_ONLY' : 'PROGRAM_VALUE_NULL'),
  };
}

function emptyMarketProgram(capturedAt: string, reason: string): IntradayProgramFlowMarketSnapshot {
  return {
    available: false,
    marketProgramNetBuy: null,
    kospiProgramNetBuy: null,
    kosdaqProgramNetBuy: null,
    combinedProgramNetBuy: null,
    signal: 'UNAVAILABLE',
    sourceProvider: 'NONE',
    dataStatus: 'MISSING',
    providerIssue: false,
    marketSignal: false,
    capturedAt,
    reason,
  };
}

function collectRecords(value: unknown, containerKeys: string[]): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  collectRecordsInto(value, records, new Set<unknown>(), 0, containerKeys);
  return records;
}

function collectRecordsInto(
  value: unknown,
  records: Record<string, unknown>[],
  seen: Set<unknown>,
  depth: number,
  containerKeys: string[],
): void {
  if (value === null || value === undefined || depth > 6 || seen.has(value)) return;
  if (Array.isArray(value)) {
    seen.add(value);
    for (const item of value) collectRecordsInto(item, records, seen, depth + 1, containerKeys);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  seen.add(record);
  records.push(record);
  for (const key of containerKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    collectRecordsInto(record[key], records, seen, depth + 1, containerKeys);
  }
}

function snapshotFilePath(): string {
  return process.env.INTRADAY_PROGRAM_FLOW_SNAPSHOT_FILE
    ? path.resolve(process.env.INTRADAY_PROGRAM_FLOW_SNAPSHOT_FILE)
    : LATEST_INTRADAY_PROGRAM_FLOW_SNAPSHOT_FILE;
}

function atomicWriteJson(filePath: string, payload: unknown): void {
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

function safeReadJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch (error) {
    console.warn(
      `[IntradayProgramFlowSnapshotRepo] ignoring invalid JSON file=${filePath} reason=${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function recordHasProgramField(record: Record<string, unknown>): boolean {
  return PROGRAM_FIELD_KEYS.some((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function firstValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const normalized = normalizeNumberLike(record[key]);
    if (normalized !== null) return normalized;
  }
  return null;
}

function normalizeNumberLike(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || /^(N\/A|NA|NULL|NONE|-|—)$/i.test(trimmed)) return null;
    const cleaned = trimmed.replace(/,/g, '').replace(/[^\d.+\-]/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '+') return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of ['value', 'amount', 'netBuy', 'netAmount']) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
      const nested = normalizeNumberLike(record[key]);
      if (nested !== null) return nested;
    }
  }
  return null;
}

function nullableNumber(value: unknown): number | null {
  return normalizeNumberLike(value);
}

function hasStockProgramValue(row: Pick<IntradayProgramFlowStockRow, 'programNetBuyAmount' | 'programNetValue' | 'programNetVolume'>): boolean {
  return row.programNetBuyAmount !== null && row.programNetBuyAmount !== undefined
    || row.programNetValue !== null && row.programNetValue !== undefined
    || row.programNetVolume !== null && row.programNetVolume !== undefined;
}

function normalizeSymbol(value: unknown): string {
  if (value === null || value === undefined) return '';
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return '';
  return digits.slice(-6).padStart(6, '0');
}

function normalizeSourceProvider(value: unknown): IntradayProgramFlowSourceProvider {
  const raw = String(value ?? '').toUpperCase();
  if (raw.includes('KIS')) return 'KIS_API';
  if (raw.includes('KRX')) return 'KRX_API';
  if (raw.includes('CACHE')) return 'CACHE';
  if (raw.includes('SNAPSHOT')) return 'SNAPSHOT';
  return 'NONE';
}

function normalizeDataStatus(value: unknown, hasValue: boolean): IntradayProgramFlowDataStatus {
  const raw = String(value ?? '').toUpperCase();
  if (raw === 'VERIFIED' || raw === 'EMPTY_VALID' || raw === 'STALE' || raw === 'MISSING' || raw === 'UNKNOWN') return raw;
  return hasValue ? 'VERIFIED' : 'MISSING';
}

function normalizeSignal(value: unknown): IntradayProgramFlowSignal {
  const raw = String(value ?? '').toUpperCase();
  if (raw === 'BULLISH' || raw === 'NEUTRAL' || raw === 'BEARISH' || raw === 'UNKNOWN' || raw === 'UNAVAILABLE') return raw;
  return 'UNAVAILABLE';
}

function signalFromNetBuy(value: number | null): IntradayProgramFlowSignal {
  if (value === null) return 'UNAVAILABLE';
  if (value > 0) return 'BULLISH';
  if (value < 0) return 'BEARISH';
  return 'NEUTRAL';
}

function safeOptionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text ? safeLogToken(text) : undefined;
}

function safeLogToken(value: string): string {
  return value.replace(/[\r\n\t]/g, ' ').slice(0, 160);
}

function collectSensitiveFieldNames(value: unknown): string[] {
  const names = new Set<string>();
  collectSensitiveFieldNamesInto(value, names, new Set<unknown>(), 0);
  return [...names].sort();
}

function collectSensitiveFieldNamesInto(value: unknown, names: Set<string>, seen: Set<unknown>, depth: number): void {
  if (value === null || value === undefined || depth > 5 || seen.has(value)) return;
  if (Array.isArray(value)) {
    seen.add(value);
    for (const item of value) collectSensitiveFieldNamesInto(item, names, seen, depth + 1);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  seen.add(record);
  for (const [key, nested] of Object.entries(record)) {
    if (FORBIDDEN_FIELD_PATTERNS.some((pattern) => pattern.test(key))) {
      names.add(key);
      continue;
    }
    collectSensitiveFieldNamesInto(nested, names, seen, depth + 1);
  }
}

function generateIntradayProgramFlowSnapshotId(nowMs: number): string {
  const date = new Date(nowMs);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  const nnnn = String(nowMs % 10000).padStart(4, '0');
  return `ipfs-${yyyy}${mm}${dd}-${hh}${mi}${ss}-${nnnn}`;
}

function kstDateString(nowMs: number): string {
  const kstMs = nowMs + 9 * 60 * 60 * 1000;
  const date = new Date(kstMs);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function kstDateTimeString(nowMs: number): string {
  const kstMs = nowMs + 9 * 60 * 60 * 1000;
  const date = new Date(kstMs);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss} KST`;
}

export function __resetIntradayProgramFlowSnapshotRepoForTests(): void {
  const filePath = snapshotFilePath();
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // test cleanup only
    }
  }
  if (!process.env.INTRADAY_PROGRAM_FLOW_SNAPSHOT_FILE && fs.existsSync(REPLAY_DIR)) {
    try {
      for (const entry of fs.readdirSync(REPLAY_DIR)) {
        if (!entry.startsWith('latest-intraday-program-flow-snapshot')) continue;
        fs.rmSync(path.join(REPLAY_DIR, entry), { recursive: true, force: true });
      }
    } catch {
      // test cleanup only
    }
  }
}
