// @responsibility KIS program trade materialization SSOT for diagnostic consumers.

import type { KisMarketProgramTrade } from './types.js';
import { logVisibilityEvent } from '../../utils/logger.js';

export const MARKET_PROGRAM_TRADE_TR_ID = process.env.KIS_MARKET_PROGRAM_TRADE_TR_ID ?? 'FHPPG04600101';
export const MARKET_PROGRAM_TRADE_PATH =
  process.env.KIS_MARKET_PROGRAM_TRADE_PATH
  ?? '/uapi/domestic-stock/v1/quotations/comp-program-trade-today';
export const MARKET_PROGRAM_DIV_CODE = process.env.KIS_MARKET_PROGRAM_DIV_CODE ?? 'J';
export const MARKET_PROGRAM_PARAM_MODE = (process.env.KIS_MARKET_PROGRAM_PARAM_MODE ?? 'OFFICIAL').toUpperCase() === 'LEGACY' ? 'LEGACY' : 'OFFICIAL';
export const MARKET_PROGRAM_KOSPI_CLASS_CODE = process.env.KIS_MARKET_PROGRAM_KOSPI_CLASS_CODE ?? 'K';
export const MARKET_PROGRAM_KOSDAQ_CLASS_CODE = process.env.KIS_MARKET_PROGRAM_KOSDAQ_CLASS_CODE ?? 'Q';
export const MARKET_PROGRAM_INDEX_CODE = process.env.KIS_MARKET_PROGRAM_INDEX_CODE ?? '0001';
export const MARKET_PROGRAM_MARKET_CLASS_CODE = process.env.KIS_MARKET_PROGRAM_MARKET_CLASS_CODE ?? '1';
export const MARKET_PROGRAM_SECTION_CLASS_CODE = process.env.KIS_MARKET_PROGRAM_SECTION_CLASS_CODE ?? '0';
export const MARKET_PROGRAM_INPUT_HOUR_1 = process.env.KIS_MARKET_PROGRAM_INPUT_HOUR_1 ?? '000000';

export type MarketProgramStatus =
  | 'OK_NONZERO'
  | 'OK_RAW_ZERO'
  | 'OK_EMPTY_OUTPUT'
  | 'OK_PARSE_PARTIAL'
  | 'PROVIDER_ERROR'
  | 'STALE_CACHE'
  | 'MISSING';

export type MarketProgramMaterializerStatus = MarketProgramStatus | 'OK' | 'ACCEPTED_EMPTY' | 'TRUE_EMPTY' | 'FIELD_MISSING';

export type MarketProgramSelectedReason =
  | 'LATEST_BY_BSOP_HOUR'
  | 'LATEST_ROW_ALL_ZERO'
  | 'NO_VALID_ROW'
  | 'EMPTY_OUTPUT';

export interface MarketProgramRow {
  bsopHour?: string;
  programBuyAmount: number;
  programSellAmount: number;
  programNetBuyAmount: number;
  arbitrageNetBuy: number;
  nonArbitrageNetBuy: number;
  raw: Record<string, unknown>;
  index: number;
  hasAnyNumericField: boolean;
  hasNonZeroValue: boolean;
  numericParseFailed: boolean;
}

export interface MarketProgramAggregateDiagnostic {
  rowCount: number;
  nonZeroRowCount: number;
  sumProgramBuyAmount: number;
  sumProgramSellAmount: number;
  sumProgramNetBuyAmount: number;
  sumArbitrageNetBuy: number;
  sumNonArbitrageNetBuy: number;
}

export interface MarketProgramMaterializerDiagnostics extends MarketProgramAggregateDiagnostic {
  status: MarketProgramStatus;
  selectedPath: string;
  selectedBsopHour?: string;
  selectedReason: MarketProgramSelectedReason;
  latestRowBsopHour?: string;
  zeroReason?: 'RAW_ZERO_ALL_ROWS' | 'EMPTY_OUTPUT' | 'FIELD_MISSING' | 'PROVIDER_ERROR';
  parseQuality: 'OK' | 'OK_ZERO_VALUE' | 'PARTIAL' | 'EMPTY' | 'PROVIDER_ERROR' | 'MISSING';
  providerIssue: boolean;
  marketSignal: boolean;
  scoring: 'enabled' | 'excluded' | 'limited' | 'neutral';
  executionImpact: 'NONE';
  latest: string;
  updated: string;
  selectedLatestNetBuy: number | null;
  aggregateNetBuyDiagnostic: number;
}

export interface MarketProgramMaterializerResult {
  parserSource: 'programMaterializer';
  status: MarketProgramMaterializerStatus;
  materialized: KisMarketProgramTrade | null;
  outputPath: string;
  rowCount: number;
  outputKeys: string[];
  parsedFields: string[];
  diagnostics?: MarketProgramMaterializerDiagnostics;
}

type KisOutput = Record<string, unknown>;

const MARKET_PROGRAM_STATUS_SUPPRESS_TTL_MS: Record<string, number> = {
  OK_RAW_ZERO: 60_000,
  OK_EMPTY_OUTPUT: 60_000,
  PROVIDER_ERROR: 300_000,
  OK_NONZERO: 0,
};
let lastMarketProgramStatusLog: { key: string; loggedAt: number; suppressedCount: number; lastSelectedBsopHour?: string } | null = null;

const MARKET_PROGRAM_NET_BUY_AMOUNT_KEYS = [
  'marketProgramNetBuy',
  'programNetBuy',
  'programNetBuyAmount',
  'programNetValue',
  'totalProgramNetBuy',
  'totalProgramNetBuyAmount',
  'kospiProgramNetBuy',
  'kosdaqProgramNetBuy',
  'netBuyAmount',
  'prgmNetBuy',
  'prgmNetBuyAmount',
  'whol_smtn_ntby_tr_pbmn',
  'prgm_ntby_tr_pbmn',
  'prgm_ntby_tr_pbmn_2',
  'PRGM_NTBY_TR_PBMN',
];
const MARKET_PROGRAM_QTY_KEYS = ['whol_smtn_ntby_qty', 'prgm_ntby_qty', 'prgm_ntby_qty_2', 'PRGM_NTBY_QTY'];
const MARKET_PROGRAM_ARBITRAGE_NET_KEYS = [
  'programArbitrageNetBuyAmount',
  'arbitrageNetBuy',
  'arbitrageNetBuyAmount',
  'arbt_smtn_ntby_tr_pbmn',
  'arbt_ntby_tr_pbmn',
  'ARBT_NTBY_TR_PBMN',
  'arbt_ntby_tr_pbmn_2',
];
const MARKET_PROGRAM_NON_ARBITRAGE_NET_KEYS = [
  'nonArbitrageNetBuy',
  'nonArbitrageNetBuyAmount',
  'nabt_smtn_ntby_tr_pbmn',
  'nabt_ntby_tr_pbmn',
  'NABT_NTBY_TR_PBMN',
];
const MARKET_PROGRAM_BUY_KEYS = ['programBuyAmount', 'marketProgramBuyAmount', 'buyAmount', 'arbt_smtn_shnu_tr_pbmn', 'nabt_smtn_shnu_tr_pbmn'];
const MARKET_PROGRAM_SELL_KEYS = ['programSellAmount', 'marketProgramSellAmount', 'sellAmount', 'arbt_smtn_seln_tr_pbmn', 'nabt_smtn_seln_tr_pbmn'];

function logMarketProgramStatusDiagnostic(diag: MarketProgramMaterializerDiagnostics, nowMs = Date.now()): void {
  if (process.env.NODE_ENV === 'test') return;
  const key = `MARKET_PROGRAM_STATUS:${diag.status}:${diag.selectedBsopHour ?? 'NONE'}:${diag.zeroReason ?? 'NONE'}`;
  const ttl = MARKET_PROGRAM_STATUS_SUPPRESS_TTL_MS[diag.status] ?? 60_000;
  if (ttl > 0 && lastMarketProgramStatusLog?.key === key && nowMs - lastMarketProgramStatusLog.loggedAt < ttl) {
    lastMarketProgramStatusLog.suppressedCount += 1;
    lastMarketProgramStatusLog.lastSelectedBsopHour = diag.selectedBsopHour;
    return;
  }
  const traceId = `market_program_${new Date(nowMs).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  if (lastMarketProgramStatusLog && lastMarketProgramStatusLog.suppressedCount > 0) {
    logVisibilityEvent({
      visibility: 'SUMMARY',
      category: 'PROGRAM',
      traceId,
      message: `[MARKET_PROGRAM_STATUS_SUPPRESSED] status=${diag.status} suppressedCount=${lastMarketProgramStatusLog.suppressedCount} lastSelectedBsopHour=${lastMarketProgramStatusLog.lastSelectedBsopHour ?? 'NONE'} providerIssue=${diag.providerIssue} executionImpact=${diag.executionImpact}`,
      summary: { status: diag.status, suppressedCount: lastMarketProgramStatusLog.suppressedCount, executionImpact: diag.executionImpact },
      details: { diag },
      level: 'info',
      executionImpact: diag.executionImpact,
    });
  }
  logVisibilityEvent({
    visibility: diag.status === 'OK_EMPTY_OUTPUT' ? 'DIAGNOSTIC' : 'SUMMARY',
    category: 'PROGRAM',
    traceId,
    dedupKey: `MARKET_PROGRAM_STATUS:${diag.status}:${diag.zeroReason ?? 'NONE'}:${diag.executionImpact}`,
    message: diag.status === 'OK_EMPTY_OUTPUT'
      ? `[MARKET_PROGRAM_SUMMARY] status=EMPTY source=KIS_API scoring=excluded providerIssue=${diag.providerIssue} marketSignal=${diag.marketSignal} executionImpact=${diag.executionImpact} traceId=${traceId}`
      : `[MARKET_PROGRAM_STATUS] status=${diag.status} rowCount=${diag.rowCount} selectedPath=${diag.selectedPath} selectedBsopHour=${diag.selectedBsopHour ?? 'NONE'} selectedReason=${diag.selectedReason} nonZeroRowCount=${diag.nonZeroRowCount} zeroReason=${diag.zeroReason ?? 'NONE'} parseQuality=${diag.parseQuality} providerIssue=${diag.providerIssue} executionImpact=${diag.executionImpact}`,
    summary: { status: diag.status, source: 'KIS_API', scoring: diag.scoring, providerIssue: diag.providerIssue, marketSignal: diag.marketSignal, executionImpact: diag.executionImpact },
    details: { diag },
    level: 'info',
    executionImpact: diag.executionImpact,
  });
  lastMarketProgramStatusLog = { key, loggedAt: nowMs, suppressedCount: 0, lastSelectedBsopHour: diag.selectedBsopHour };
}

export function buildMarketProgramTradeTodayParams(marketClassCode: 'K' | 'Q'): Record<string, string> {
  if (MARKET_PROGRAM_PARAM_MODE === 'OFFICIAL') {
    return {
      FID_COND_MRKT_DIV_CODE: MARKET_PROGRAM_DIV_CODE,
      FID_MRKT_CLS_CODE: marketClassCode,
      FID_SCTN_CLS_CODE: '',
      FID_INPUT_ISCD: '',
      FID_COND_MRKT_DIV_CODE1: '',
      FID_INPUT_HOUR_1: '',
    };
  }
  return {
    FID_COND_MRKT_DIV_CODE: MARKET_PROGRAM_DIV_CODE,
    FID_COND_MRKT_DIV_CODE1: MARKET_PROGRAM_DIV_CODE,
    FID_MRKT_CLS_CODE: MARKET_PROGRAM_MARKET_CLASS_CODE,
    FID_SCTN_CLS_CODE: MARKET_PROGRAM_SECTION_CLASS_CODE,
    FID_INPUT_ISCD: MARKET_PROGRAM_INDEX_CODE,
    FID_INPUT_HOUR_1: MARKET_PROGRAM_INPUT_HOUR_1,
  };
}

/**
 * Backward-compatible wrapper for existing call-sites.
 * Default OFFICIAL path maps to KOSPI(J/K) single-market probe shape.
 */
export function buildMarketProgramParams(): Record<string, string> {
  const marketClassCode: 'K' | 'Q' =
    MARKET_PROGRAM_KOSPI_CLASS_CODE === 'Q' ? 'Q' : 'K';
  return buildMarketProgramTradeTodayParams(marketClassCode);
}

function rowsAt(data: unknown): { path: string; rows: KisOutput[] } {
  const root = data as { output?: unknown; output1?: unknown; output2?: unknown } | null;
  for (const key of ['output', 'output1', 'output2'] as const) {
    const bucket = root?.[key];
    if (Array.isArray(bucket)) return { path: key, rows: bucket.filter((v): v is KisOutput => !!v && typeof v === 'object' && !Array.isArray(v)) };
    if (bucket && typeof bucket === 'object') return { path: key, rows: [bucket as KisOutput] };
  }
  return { path: 'NONE', rows: [] };
}

function acceptedEmpty(data: unknown): boolean {
  const root = data as { rt_cd?: unknown; msg_cd?: unknown; output?: unknown; output1?: unknown; output2?: unknown } | null;
  if (!root || typeof root !== 'object') return false;
  if (String(root.rt_cd ?? '') !== '0' || String(root.msg_cd ?? '') !== 'MCA00000') return false;
  return [root.output, root.output1, root.output2].some((v) => Array.isArray(v) && v.length === 0) && rowsAt(data).rows.length === 0;
}

function providerError(data: unknown): boolean {
  const root = data as { rt_cd?: unknown } | null;
  if (!root || typeof root !== 'object' || root.rt_cd === undefined || root.rt_cd === null || String(root.rt_cd) === '') return false;
  return String(root.rt_cd) !== '0';
}

export function parseKisNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const raw = String(value).trim();
  if (raw === '') return 0;
  const normalized = raw.replace(/,/g, '');
  const n = Number(normalized);
  if (!Number.isFinite(n)) return 0;
  return n;
}

function parseDiag(value: unknown): { rawValuePresent: boolean; numericParseFailed: boolean; numericValue: number } {
  const rawValuePresent = value !== null && value !== undefined && String(value).trim() !== '';
  if (!rawValuePresent) return { rawValuePresent, numericParseFailed: false, numericValue: 0 };
  const n = Number(String(value).trim().replace(/,/g, ''));
  return { rawValuePresent, numericParseFailed: !Number.isFinite(n), numericValue: Number.isFinite(n) ? n : 0 };
}

function firstPresent(out: KisOutput | undefined, keys: string[]): { value: number; present: boolean; failed: boolean } {
  if (!out) return { value: 0, present: false, failed: false };
  for (const key of keys) {
    const d = parseDiag(out[key]);
    if (!d.rawValuePresent) continue;
    return { value: d.numericValue, present: true, failed: d.numericParseFailed };
  }
  return { value: 0, present: false, failed: false };
}

function num(out: KisOutput | undefined, keys: string[]): number | null {
  const d = firstPresent(out, keys);
  return d.present && !d.failed ? d.value : null;
}

function sum(out: KisOutput | undefined, keys: string[]): number | null {
  let total = 0;
  let found = false;
  for (const key of keys) {
    const v = num(out, [key]);
    if (v === null) continue;
    total += v;
    found = true;
  }
  return found ? total : null;
}

function normalizeBsopHour(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const digits = String(value).trim().replace(/\D/g, '');
  if (digits.length < 4) return undefined;
  return digits.length >= 6 ? digits.slice(0, 6) : digits.slice(0, 4);
}

export function formatBsopHour(value: unknown): string {
  const h = normalizeBsopHour(value);
  if (!h) return 'N/A';
  if (h.length >= 6) return `${h.slice(0, 2)}:${h.slice(2, 4)}:${h.slice(4, 6)}`;
  return `${h.slice(0, 2)}:${h.slice(2, 4)}`;
}

function bsopMinutes(value: string | undefined): number | null {
  const h = normalizeBsopHour(value);
  if (!h) return null;
  const hh = Number(h.slice(0, 2));
  const mm = Number(h.slice(2, 4));
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function kstMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hh * 60 + mm;
}

function isValidBsopHour(value: string | undefined): boolean { return bsopMinutes(value) !== null; }
function isNotFutureBsopHour(value: string | undefined, nowKst: Date): boolean {
  const m = bsopMinutes(value);
  return m !== null && m <= kstMinutes(nowKst);
}
function compareBsopHourDesc(a: string | undefined, b: string | undefined): number {
  return (bsopMinutes(b) ?? -1) - (bsopMinutes(a) ?? -1);
}

export function normalizeMarketProgramRow(raw: KisOutput, index: number): MarketProgramRow {
  const directSell = firstPresent(raw, MARKET_PROGRAM_SELL_KEYS);
  const directBuy = firstPresent(raw, MARKET_PROGRAM_BUY_KEYS);
  const arbitrageSell = firstPresent(raw, ['arbt_smtn_seln_tr_pbmn']);
  const arbitrageBuy = firstPresent(raw, ['arbt_smtn_shnu_tr_pbmn']);
  const nonArbitrageSell = firstPresent(raw, ['nabt_smtn_seln_tr_pbmn']);
  const nonArbitrageBuy = firstPresent(raw, ['nabt_smtn_shnu_tr_pbmn']);
  const arbitrageNet = firstPresent(raw, MARKET_PROGRAM_ARBITRAGE_NET_KEYS);
  const nonArbitrageNet = firstPresent(raw, MARKET_PROGRAM_NON_ARBITRAGE_NET_KEYS);
  const wholeNet = firstPresent(raw, MARKET_PROGRAM_NET_BUY_AMOUNT_KEYS);
  const qty = firstPresent(raw, MARKET_PROGRAM_QTY_KEYS);
  const diagnostics = [directSell, directBuy, arbitrageSell, arbitrageBuy, nonArbitrageSell, nonArbitrageBuy, arbitrageNet, nonArbitrageNet, wholeNet, qty];
  const programBuyAmount = directBuy.present ? directBuy.value : arbitrageBuy.value + nonArbitrageBuy.value;
  const programSellAmount = directSell.present ? directSell.value : arbitrageSell.value + nonArbitrageSell.value;
  const programNetBuyAmount = wholeNet.present
    ? wholeNet.value
    : arbitrageNet.present || nonArbitrageNet.present
      ? arbitrageNet.value + nonArbitrageNet.value
      : directBuy.present && directSell.present
        ? directBuy.value - directSell.value
        : 0;
  const numericValues = [programBuyAmount, programSellAmount, programNetBuyAmount, arbitrageNet.value, nonArbitrageNet.value, qty.value];
  return {
    bsopHour: normalizeBsopHour(raw.bsop_hour),
    programBuyAmount,
    programSellAmount,
    programNetBuyAmount,
    arbitrageNetBuy: arbitrageNet.value,
    nonArbitrageNetBuy: nonArbitrageNet.value,
    raw,
    index,
    hasAnyNumericField: diagnostics.some((d) => d.present),
    hasNonZeroValue: numericValues.some((v) => v !== 0),
    numericParseFailed: diagnostics.some((d) => d.failed),
  };
}

export function selectMarketProgramRow(rows: MarketProgramRow[], nowKst: Date): {
  selectedRow: MarketProgramRow | null;
  selectedReason: MarketProgramSelectedReason;
  nonZeroRowCount: number;
  latestRow: MarketProgramRow | null;
} {
  if (!rows.length) return { selectedRow: null, selectedReason: 'EMPTY_OUTPUT', nonZeroRowCount: 0, latestRow: null };
  const validTimeRows = rows
    .filter((r) => isValidBsopHour(r.bsopHour))
    .filter((r) => isNotFutureBsopHour(r.bsopHour, nowKst))
    .sort((a, b) => compareBsopHourDesc(a.bsopHour, b.bsopHour));
  const candidateRows = validTimeRows.length > 0 ? validTimeRows : rows.slice();
  const latestRow = candidateRows[0] ?? null;
  const nonZeroRows = candidateRows.filter((r) => r.hasNonZeroValue);
  if (latestRow?.hasNonZeroValue) {
    return { selectedRow: latestRow, selectedReason: 'LATEST_BY_BSOP_HOUR', nonZeroRowCount: nonZeroRows.length, latestRow };
  }
  return { selectedRow: latestRow, selectedReason: 'LATEST_ROW_ALL_ZERO', nonZeroRowCount: nonZeroRows.length, latestRow };
}

export function aggregateMarketProgramRows(rows: MarketProgramRow[]): MarketProgramAggregateDiagnostic {
  return {
    rowCount: rows.length,
    nonZeroRowCount: rows.filter((r) => r.hasNonZeroValue).length,
    sumProgramBuyAmount: rows.reduce((s, r) => s + r.programBuyAmount, 0),
    sumProgramSellAmount: rows.reduce((s, r) => s + r.programSellAmount, 0),
    sumProgramNetBuyAmount: rows.reduce((s, r) => s + r.programNetBuyAmount, 0),
    sumArbitrageNetBuy: rows.reduce((s, r) => s + r.arbitrageNetBuy, 0),
    sumNonArbitrageNetBuy: rows.reduce((s, r) => s + r.nonArbitrageNetBuy, 0),
  };
}

function updatedFromBsopHour(bsopHour: string | undefined, now: Date): string {
  if (!bsopHour) return 'N/A';
  const h = normalizeBsopHour(bsopHour);
  if (!h) return 'N/A';
  const kstDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const time = h.length >= 6 ? `${h.slice(0, 2)}:${h.slice(2, 4)}:${h.slice(4, 6)}` : `${h.slice(0, 2)}:${h.slice(2, 4)}:00`;
  return `${kstDate} ${time} KST`;
}

function buildDiagnostics(status: MarketProgramStatus, rows: MarketProgramRow[], outputPath: string, now: Date, providerIssue = false): MarketProgramMaterializerDiagnostics {
  const aggregate = aggregateMarketProgramRows(rows);
  const selected = selectMarketProgramRow(rows, now);
  const selectedPath = selected.selectedRow ? `${outputPath}[${selected.selectedRow.index}]` : outputPath === 'NONE' ? 'NONE' : outputPath;
  const parseFailed = rows.some((r) => r.numericParseFailed);
  const selectedBsopHour = selected.selectedRow?.bsopHour;
  const finalStatus: MarketProgramStatus = status === 'OK_NONZERO' && parseFailed ? 'OK_PARSE_PARTIAL' : status;
  return {
    ...aggregate,
    status: finalStatus,
    selectedPath,
    selectedBsopHour,
    selectedReason: selected.selectedReason,
    latestRowBsopHour: selected.latestRow?.bsopHour,
    zeroReason: finalStatus === 'OK_NONZERO' || finalStatus === 'OK_PARSE_PARTIAL'
      ? undefined
      : finalStatus === 'OK_RAW_ZERO' ? 'RAW_ZERO_ALL_ROWS' : finalStatus === 'OK_EMPTY_OUTPUT' ? 'EMPTY_OUTPUT' : finalStatus === 'PROVIDER_ERROR' ? 'PROVIDER_ERROR' : undefined,
    parseQuality: finalStatus === 'OK_NONZERO' ? 'OK' : finalStatus === 'OK_RAW_ZERO' ? 'OK_ZERO_VALUE' : finalStatus === 'OK_EMPTY_OUTPUT' ? 'EMPTY' : finalStatus === 'OK_PARSE_PARTIAL' ? 'PARTIAL' : finalStatus === 'PROVIDER_ERROR' ? 'PROVIDER_ERROR' : 'MISSING',
    providerIssue,
    marketSignal: finalStatus === 'OK_NONZERO',
    scoring: finalStatus === 'OK_NONZERO' || finalStatus === 'OK_PARSE_PARTIAL' ? 'limited' : 'excluded',
    executionImpact: 'NONE',
    latest: selectedBsopHour ? formatBsopHour(selectedBsopHour).replace(/:00$/, '') : 'N/A',
    updated: updatedFromBsopHour(selectedBsopHour, now),
    selectedLatestNetBuy: selected.selectedRow?.programNetBuyAmount ?? null,
    aggregateNetBuyDiagnostic: aggregate.sumProgramNetBuyAmount,
  };
}

export function materializeKisMarketProgramTrade(data: unknown, fetchedAt = new Date().toISOString(), now = new Date(fetchedAt)): MarketProgramMaterializerResult {
  const { path, rows: rawRows } = rowsAt(data);
  const rows = rawRows.map(normalizeMarketProgramRow);
  const out = rawRows[0];
  const outputKeys = out ? Object.keys(out).slice(0, 50) : [];

  if (providerError(data)) {
    const diagnostics = buildDiagnostics('PROVIDER_ERROR', rows, path, now, true);
    logMarketProgramStatusDiagnostic(diagnostics);
    return { parserSource: 'programMaterializer', status: 'PROVIDER_ERROR', materialized: null, outputPath: path, rowCount: rawRows.length, outputKeys, parsedFields: [], diagnostics };
  }

  if (!out) {
    const isAcceptedEmpty = acceptedEmpty(data);
    const status: MarketProgramStatus = isAcceptedEmpty ? 'OK_EMPTY_OUTPUT' : 'MISSING';
    const diagnostics = buildDiagnostics(status, rows, path, now, false);
    logMarketProgramStatusDiagnostic(diagnostics);
    return { parserSource: 'programMaterializer', status: isAcceptedEmpty ? 'OK_EMPTY_OUTPUT' : 'TRUE_EMPTY', materialized: null, outputPath: path, rowCount: rawRows.length, outputKeys, parsedFields: [], diagnostics };
  }

  const selected = selectMarketProgramRow(rows, now);
  const row = selected.selectedRow;
  if (!row || !rows.some((r) => r.hasAnyNumericField)) {
    const diagnostics = buildDiagnostics('MISSING', rows, path, now, false);
    logMarketProgramStatusDiagnostic(diagnostics);
    return { parserSource: 'programMaterializer', status: 'FIELD_MISSING', materialized: null, outputPath: path, rowCount: rawRows.length, outputKeys, parsedFields: [], diagnostics };
  }

  const wholeNet = num(row.raw, MARKET_PROGRAM_NET_BUY_AMOUNT_KEYS);
  const arbNet = num(row.raw, MARKET_PROGRAM_ARBITRAGE_NET_KEYS);
  const nonArbNet = num(row.raw, MARKET_PROGRAM_NON_ARBITRAGE_NET_KEYS);
  const buyAmountForNet = sum(row.raw, MARKET_PROGRAM_BUY_KEYS);
  const sellAmountForNet = sum(row.raw, MARKET_PROGRAM_SELL_KEYS);
  const computedNet = wholeNet
    ?? (arbNet !== null || nonArbNet !== null ? (arbNet ?? 0) + (nonArbNet ?? 0) : null)
    ?? (buyAmountForNet !== null && sellAmountForNet !== null ? buyAmountForNet - sellAmountForNet : null);
  const parsed = {
    programNetBuyQty: num(row.raw, MARKET_PROGRAM_QTY_KEYS),
    programNetBuyAmount: computedNet,
    programArbitrageNetBuy: arbNet,
    programNonArbitrageNetBuy: nonArbNet,
    programSellAmount: sum(row.raw, MARKET_PROGRAM_SELL_KEYS),
    programBuyAmount: sum(row.raw, MARKET_PROGRAM_BUY_KEYS),
  };
  const parsedFields = Object.entries(parsed).filter(([, v]) => v !== null).map(([k]) => k);
  const diagStatus: MarketProgramStatus = rows.some((r) => r.hasNonZeroValue) ? 'OK_NONZERO' : 'OK_RAW_ZERO';
  const diagnostics = buildDiagnostics(diagStatus, rows, path, now, false);
  logMarketProgramStatusDiagnostic(diagnostics);
  return {
    parserSource: 'programMaterializer',
    status: diagnostics.status,
    materialized: {
      programNetBuyQty: parsed.programNetBuyQty,
      programNetBuyAmount: parsed.programNetBuyAmount,
      programArbitrageNetBuy: parsed.programArbitrageNetBuy,
      programNonArbitrageNetBuy: parsed.programNonArbitrageNetBuy,
      programSellAmount: parsed.programSellAmount,
      programBuyAmount: parsed.programBuyAmount,
      fetchedAt,
      source: 'KIS_API',
      marketProgramStatus: diagnostics.status,
      selectedPath: diagnostics.selectedPath,
      selectedBsopHour: diagnostics.selectedBsopHour,
      selectedReason: diagnostics.selectedReason,
      rowCount: diagnostics.rowCount,
      nonZeroRowCount: diagnostics.nonZeroRowCount,
      latest: diagnostics.latest,
      updated: diagnostics.updated,
      zeroReason: diagnostics.zeroReason,
      parseQuality: diagnostics.parseQuality,
      providerIssue: diagnostics.providerIssue,
      marketSignal: diagnostics.marketSignal,
      scoring: diagnostics.scoring,
      executionImpact: diagnostics.executionImpact,
      rawFieldKeys: outputKeys,
      parsedFieldName: parsedFields[0],
      aggregateDiagnostic: { ...diagnostics, outputKeys, parsedFields } as unknown as Record<string, unknown>,
    },
    outputPath: diagnostics.selectedPath,
    rowCount: rawRows.length,
    outputKeys,
    parsedFields,
    diagnostics,
  };
}
