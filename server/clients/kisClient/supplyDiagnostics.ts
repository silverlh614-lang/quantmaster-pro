/**
 * @responsibility KIS 수급 zero-filled 원인 분리용 raw diagnostics.
 *
 * `/supply_health` 의 read-only 진단 보강 전용. 기존 fetchKis* 파서가 0으로 정규화한
 * 값이 실제 0인지, output 위치/필드명 drift 때문에 0 fallback 된 것인지 분리한다.
 */

import { HAS_REAL_DATA_CLIENT } from './constants.js';
import { realDataKisGet } from './http.js';
import {
  MARKET_PROGRAM_TRADE_TR_ID,
  MARKET_PROGRAM_TRADE_PATH,
  MARKET_PROGRAM_INDEX_CODE,
  buildMarketProgramParams,
  materializeKisMarketProgramTrade,
} from './programMaterializer.js';
import type { KisApiPriority } from '../kisRateLimiter.js';
import { isTradingDay } from '../../utils/marketDayClassifier.js';
import { classifyInvestorFlowPayload, describeKisPayloadStatus, type KisPayloadStatus } from './payloadValidators.js';

type KisSupplyDiagnosticKind = 'INVESTOR_FLOW' | 'STOCK_PROGRAM' | 'MARKET_PROGRAM';

export interface KisRawSupplyDiagnostic {
  kind: KisSupplyDiagnosticKind;
  code: string;
  ok: boolean;
  trId: string;
  path: string;
  rootKeys: string[];
  outputPath: string;
  outputKeys: string[];
  parsed: Record<string, number | null>;
  zeroReason: 'RAW_ZERO' | 'RAW_ZERO_ALL_ROWS' | 'FIELD_MISSING' | 'FIELD_MISMATCH' | 'QUOTE_LIKE_OUTPUT' | 'HTTP_OK_BUT_EMPTY' | 'NO_OUTPUT' | 'OUTPUT_EMPTY' | 'ACCEPTED_EMPTY' | 'FETCH_FAIL' | 'NON_ZERO' | 'SESSION_UNAVAILABLE' | 'PARAM_ERROR' | 'PROVIDER_ERROR';
  sample: Record<string, string | number | null>;
  rootSample: Record<string, string | number | boolean | null>;
  error?: string;
  rowCount?: number;
  selectedPath?: string;
  selectedBsopHour?: string;
  selectedReason?: string;
  nonZeroRowCount?: number;
  latestRowBsopHour?: string;
  sumProgramBuyAmount?: number;
  sumProgramSellAmount?: number;
  sumProgramNetBuyAmount?: number;
  sumArbitrageNetBuy?: number;
  sumNonArbitrageNetBuy?: number;
  parseQuality?: string;
  providerIssue?: boolean;
  executionImpact?: 'NONE';
  status?: string;
}

const STOCK_PROGRAM_TRADE_TR_ID = process.env.KIS_STOCK_PROGRAM_TRADE_TR_ID ?? 'FHPPG04650101';
const STOCK_PROGRAM_TRADE_PATH =
  process.env.KIS_STOCK_PROGRAM_TRADE_PATH
  ?? '/uapi/domestic-stock/v1/quotations/program-trade-by-stock';


function rootKeys(data: unknown): string[] {
  return data && typeof data === 'object' ? Object.keys(data as Record<string, unknown>).slice(0, 20) : [];
}

function firstOutput(data: unknown): { path: string; out: Record<string, string> | undefined } {
  const root = data as { output?: unknown; output1?: unknown; output2?: unknown } | null;
  if (root?.output && typeof root.output === 'object' && !Array.isArray(root.output)) {
    return { path: 'output', out: root.output as Record<string, string> };
  }
  if (Array.isArray(root?.output) && root.output.length > 0 && typeof root.output[0] === 'object') {
    return { path: 'output[0]', out: root.output[0] as Record<string, string> };
  }
  if (root?.output1 && typeof root.output1 === 'object' && !Array.isArray(root.output1)) {
    return { path: 'output1', out: root.output1 as Record<string, string> };
  }
  if (Array.isArray(root?.output1) && root.output1.length > 0 && typeof root.output1[0] === 'object') {
    return { path: 'output1[0]', out: root.output1[0] as Record<string, string> };
  }
  if (Array.isArray(root?.output2) && root.output2.length > 0 && typeof root.output2[0] === 'object') {
    return { path: 'output2[0]', out: root.output2[0] as Record<string, string> };
  }
  return { path: 'NONE', out: undefined };
}

function parseNum(out: Record<string, string> | undefined, keys: string[]): number | null {
  if (!out) return null;
  for (const key of keys) {
    const raw = out[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const n = Number(String(raw).replace(/,/g, '').trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function sumNum(out: Record<string, string> | undefined, keys: string[]): number | null {
  if (!out) return null;
  let sum = 0;
  let found = false;
  for (const key of keys) {
    const value = parseNum(out, [key]);
    if (value === null) continue;
    sum += value;
    found = true;
  }
  return found ? sum : null;
}

function pickSample(out: Record<string, string> | undefined, keys: string[]): Record<string, string | number | null> {
  const sample: Record<string, string | number | null> = {};
  for (const key of keys) sample[key] = out?.[key] ?? null;
  return sample;
}

function pickRootSample(data: unknown): Record<string, string | number | boolean | null> {
  const sample: Record<string, string | number | boolean | null> = {};
  if (!data || typeof data !== 'object') return sample;
  const root = data as Record<string, unknown>;
  const preferred = ['rt_cd', 'msg_cd', 'msg1', 'tr_id', 'output', 'output1', 'output2'];
  for (const key of preferred) {
    const value = root[key];
    if (value === undefined) continue;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      sample[key] = value as string | number | boolean | null;
    } else if (Array.isArray(value)) {
      sample[key] = `array(${value.length})`;
    } else if (typeof value === 'object') {
      sample[key] = `object(${Object.keys(value as Record<string, unknown>).length})`;
    }
  }
  return sample;
}

function classifyZero(parsed: Record<string, number | null>): KisRawSupplyDiagnostic['zeroReason'] {
  const values = Object.values(parsed);
  if (values.every((v) => v === null)) return 'FIELD_MISSING';
  if (values.some((v) => typeof v === 'number' && v !== 0)) return 'NON_ZERO';
  return 'RAW_ZERO';
}

function classifyKisRootIssue(data: unknown): KisRawSupplyDiagnostic['zeroReason'] | null {
  const root = data as { rt_cd?: unknown; msg_cd?: unknown; msg1?: unknown; output?: unknown; output1?: unknown; output2?: unknown } | null;
  if (!root || typeof root !== 'object') return null;
  const rtCd = String(root.rt_cd ?? '');
  const msgCd = String(root.msg_cd ?? '');
  const msg = `${msgCd} ${String(root.msg1 ?? '')}`.toUpperCase();
  const emptyOutput = [root.output, root.output1, root.output2].some((bucket) => Array.isArray(bucket) && bucket.length === 0);
  if (rtCd === '0' && msgCd === 'MCA00000' && emptyOutput) return 'ACCEPTED_EMPTY';
  if (msg.includes('SESSION') || msg.includes('TOKEN') || msg.includes('AUTH') || msg.includes('AUTHORIZATION')) return 'SESSION_UNAVAILABLE';
  if (msg.includes('INPUT FIELD') || msg.includes('INVALID') || msg.includes('PARAM') || msg.includes('FID_')) return 'PARAM_ERROR';
  if (rtCd && rtCd !== '0') return 'PROVIDER_ERROR';
  if (emptyOutput) return 'OUTPUT_EMPTY';
  return null;
}

function fmtSample(sample: Record<string, string | number | boolean | null>): string {
  const entries = Object.entries(sample).slice(0, 8);
  if (entries.length === 0) return 'NONE';
  return entries.map(([k, v]) => `${k}:${v ?? 'NULL'}`).join(',');
}

function fail(
  kind: KisSupplyDiagnosticKind,
  code: string,
  trId: string,
  path: string,
  zeroReason: KisRawSupplyDiagnostic['zeroReason'],
  error: string,
): KisRawSupplyDiagnostic {
  return {
    kind,
    code,
    ok: false,
    trId,
    path,
    rootKeys: [],
    outputPath: 'NONE',
    outputKeys: [],
    parsed: {},
    zeroReason,
    sample: {},
    rootSample: {},
    error,
  };
}

function failNullResponse(
  kind: KisSupplyDiagnosticKind,
  code: string,
  trId: string,
  path: string,
): KisRawSupplyDiagnostic {
  return fail(kind, code, trId, path, 'FETCH_FAIL', 'realDataKisGet returned null — circuit/rate-limit/http/json-empty likely');
}

export function formatKisRawSupplyDiagnostic(diag: KisRawSupplyDiagnostic): string {
  return [
    `rawDiag=${diag.kind}`,
    `code=${diag.code}`,
    `ok=${diag.ok}`,
    `trId=${diag.trId}`,
    `apiPath=${diag.path}`,
    `path=${diag.outputPath}`,
    `rootKeys=${diag.rootKeys.join('|') || 'NONE'}`,
    `rootSample=${fmtSample(diag.rootSample)}`,
    diag.rowCount !== undefined ? `rowCount=${diag.rowCount}` : '',
    diag.selectedPath ? `selectedPath=${diag.selectedPath}` : '',
    diag.selectedBsopHour ? `selectedBsopHour=${diag.selectedBsopHour}` : '',
    diag.selectedReason ? `selectedReason=${diag.selectedReason}` : '',
    diag.nonZeroRowCount !== undefined ? `nonZeroRowCount=${diag.nonZeroRowCount}` : '',
    diag.latestRowBsopHour ? `latestRowBsopHour=${diag.latestRowBsopHour}` : '',
    diag.sumProgramBuyAmount !== undefined ? `sumProgramBuyAmount=${diag.sumProgramBuyAmount}` : '',
    diag.sumProgramSellAmount !== undefined ? `sumProgramSellAmount=${diag.sumProgramSellAmount}` : '',
    diag.sumProgramNetBuyAmount !== undefined ? `sumProgramNetBuyAmount=${diag.sumProgramNetBuyAmount}` : '',
    diag.sumArbitrageNetBuy !== undefined ? `sumArbitrageNetBuy=${diag.sumArbitrageNetBuy}` : '',
    diag.sumNonArbitrageNetBuy !== undefined ? `sumNonArbitrageNetBuy=${diag.sumNonArbitrageNetBuy}` : '',
    `outputKeys=${diag.outputKeys.slice(0, 8).join('|') || 'NONE'}`,
    `parsed=${Object.entries(diag.parsed).map(([k, v]) => `${k}:${v ?? 'NULL'}`).join(',') || 'NONE'}`,
    `zeroReason=${diag.zeroReason}`,
    diag.parseQuality ? `parseQuality=${diag.parseQuality}` : '',
    diag.providerIssue !== undefined ? `providerIssue=${diag.providerIssue}` : '',
    diag.executionImpact ? `executionImpact=${diag.executionImpact}` : '',
    diag.status ? `status=${diag.status}` : '',
    diag.error ? `error=${diag.error}` : '',
    ['QUOTE_LIKE_OUTPUT', 'HTTP_OK_BUT_EMPTY', 'FIELD_MISSING', 'FIELD_MISMATCH'].includes(diag.zeroReason)
      ? describeKisPayloadStatus(diag.zeroReason as KisPayloadStatus)
      : '',
  ].filter(Boolean).join(';');
}

export async function diagnoseKisInvestorFlowRaw(
  code: string,
  priority: KisApiPriority = 'LOW',
): Promise<KisRawSupplyDiagnostic> {
  const trId = 'FHKST01010300';
  const path = '/uapi/domestic-stock/v1/quotations/inquire-investor';
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) {
    return fail('INVESTOR_FLOW', code, trId, path, 'FETCH_FAIL', 'KIS_APP_KEY missing');
  }
  try {
    const data = await realDataKisGet(trId, path, {
      FID_COND_MRKT_DIV_CODE: 'J',
      FID_INPUT_ISCD: code.padStart(6, '0'),
    }, priority);
    if (!data) return failNullResponse('INVESTOR_FLOW', code, trId, path);
    const { path: outputPath, out } = firstOutput(data);
    const parsed = {
      foreignNetBuy: parseNum(out, ['frgn_ntby_qty', 'FRGN_NETBUY_QTY']),
      institutionalNetBuy: parseNum(out, ['orgn_ntby_qty', 'INST_NETBUY_QTY']),
      individualNetBuy: parseNum(out, ['prsn_ntby_qty', 'INDV_NETBUY_QTY']),
    };
    return {
      kind: 'INVESTOR_FLOW',
      code,
      ok: Boolean(out),
      trId,
      path,
      rootKeys: rootKeys(data),
      outputPath,
      outputKeys: out ? Object.keys(out).slice(0, 30) : [],
      parsed,
      zeroReason: (() => {
        if (!out) return 'NO_OUTPUT' as const;
        const c = classifyInvestorFlowPayload([out], { trId, path });
        if (c.status === 'QUOTE_LIKE_OUTPUT') return 'QUOTE_LIKE_OUTPUT' as const;
        if (c.status === 'HTTP_OK_BUT_EMPTY') return 'HTTP_OK_BUT_EMPTY' as const;
        if (c.status === 'FIELD_MISSING') return 'FIELD_MISSING' as const;
        return classifyZero(parsed);
      })(),
      sample: pickSample(out, ['frgn_ntby_qty', 'orgn_ntby_qty', 'prsn_ntby_qty', 'FRGN_NETBUY_QTY', 'INST_NETBUY_QTY', 'INDV_NETBUY_QTY']),
      rootSample: pickRootSample(data),
    };
  } catch (e) {
    return fail('INVESTOR_FLOW', code, trId, path, 'FETCH_FAIL', e instanceof Error ? e.message : String(e));
  }
}

export async function diagnoseKisStockProgramRaw(
  code: string,
  priority: KisApiPriority = 'LOW',
): Promise<KisRawSupplyDiagnostic> {
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) {
    return fail('STOCK_PROGRAM', code, STOCK_PROGRAM_TRADE_TR_ID, STOCK_PROGRAM_TRADE_PATH, 'FETCH_FAIL', 'KIS_APP_KEY missing');
  }
  try {
    const data = await realDataKisGet(STOCK_PROGRAM_TRADE_TR_ID, STOCK_PROGRAM_TRADE_PATH, {
      FID_COND_MRKT_DIV_CODE: 'J',
      FID_INPUT_ISCD: code.padStart(6, '0'),
    }, priority);
    if (!data) return failNullResponse('STOCK_PROGRAM', code, STOCK_PROGRAM_TRADE_TR_ID, STOCK_PROGRAM_TRADE_PATH);
    const { path: outputPath, out } = firstOutput(data);
    const parsed = {
      programNetBuyQty: parseNum(out, ['whol_smtn_ntby_qty', 'prgm_ntby_qty', 'PRGM_NTBY_QTY']),
      programNetBuyAmount: parseNum(out, ['whol_smtn_ntby_tr_pbmn', 'prgm_ntby_tr_pbmn', 'PRGM_NTBY_TR_PBMN']),
      programBuyRatio: parseNum(out, ['prgm_byov_rate', 'PRGM_BYOV_RATE']),
    };
    return {
      kind: 'STOCK_PROGRAM',
      code,
      ok: Boolean(out),
      trId: STOCK_PROGRAM_TRADE_TR_ID,
      path: STOCK_PROGRAM_TRADE_PATH,
      rootKeys: rootKeys(data),
      outputPath,
      outputKeys: out ? Object.keys(out).slice(0, 30) : [],
      parsed,
      zeroReason: classifyKisRootIssue(data) ?? (out ? classifyZero(parsed) : 'NO_OUTPUT'),
      sample: pickSample(out, ['whol_smtn_ntby_qty', 'whol_smtn_ntby_tr_pbmn', 'prgm_ntby_qty', 'prgm_ntby_tr_pbmn', 'prgm_byov_rate']),
      rootSample: pickRootSample(data),
    };
  } catch (e) {
    return fail('STOCK_PROGRAM', code, STOCK_PROGRAM_TRADE_TR_ID, STOCK_PROGRAM_TRADE_PATH, 'FETCH_FAIL', e instanceof Error ? e.message : String(e));
  }
}

export async function diagnoseKisMarketProgramRaw(
  priority: KisApiPriority = 'LOW',
): Promise<KisRawSupplyDiagnostic> {
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) {
    return fail('MARKET_PROGRAM', MARKET_PROGRAM_INDEX_CODE, MARKET_PROGRAM_TRADE_TR_ID, MARKET_PROGRAM_TRADE_PATH, 'FETCH_FAIL', 'KIS_APP_KEY missing');
  }
  try {
    const data = await realDataKisGet(MARKET_PROGRAM_TRADE_TR_ID, MARKET_PROGRAM_TRADE_PATH, buildMarketProgramParams(), priority);
    if (!data) return failNullResponse('MARKET_PROGRAM', MARKET_PROGRAM_INDEX_CODE, MARKET_PROGRAM_TRADE_TR_ID, MARKET_PROGRAM_TRADE_PATH);
    const materialized = materializeKisMarketProgramTrade(data);
    const { path: firstOutputPath, out } = firstOutput(data);
    const diag = materialized.diagnostics;
    const parsed = {
      programNetBuyQty: materialized.materialized?.programNetBuyQty ?? null,
      programNetBuyAmount: materialized.materialized?.programNetBuyAmount ?? null,
      programArbitrageNetBuy: materialized.materialized?.programArbitrageNetBuy ?? null,
      programNonArbitrageNetBuy: materialized.materialized?.programNonArbitrageNetBuy ?? null,
      programSellAmount: materialized.materialized?.programSellAmount ?? null,
      programBuyAmount: materialized.materialized?.programBuyAmount ?? null,
    };
    const rootIssue = classifyKisRootIssue(data);
    const okZeroReason = diag?.zeroReason === 'RAW_ZERO_ALL_ROWS' ? 'RAW_ZERO_ALL_ROWS' : undefined;
    return {
      kind: 'MARKET_PROGRAM',
      code: MARKET_PROGRAM_INDEX_CODE,
      ok: materialized.status !== 'PROVIDER_ERROR' && materialized.status !== 'TRUE_EMPTY',
      trId: MARKET_PROGRAM_TRADE_TR_ID,
      path: MARKET_PROGRAM_TRADE_PATH,
      rootKeys: rootKeys(data),
      outputPath: diag?.selectedPath ?? materialized.outputPath ?? firstOutputPath,
      outputKeys: out ? Object.keys(out).slice(0, 30) : [],
      parsed,
      zeroReason: rootIssue ?? okZeroReason ?? (materialized.status === 'FIELD_MISSING' ? 'FIELD_MISSING' : out ? classifyZero(parsed) : 'NO_OUTPUT'),
      sample: pickSample(out, ['bsop_hour', 'whol_smtn_ntby_qty', 'whol_smtn_ntby_tr_pbmn', 'arbt_smtn_ntby_tr_pbmn', 'nabt_smtn_ntby_tr_pbmn', 'arbt_smtn_seln_tr_pbmn', 'nabt_smtn_seln_tr_pbmn', 'arbt_smtn_shnu_tr_pbmn', 'nabt_smtn_shnu_tr_pbmn', 'prgm_ntby_qty', 'prgm_ntby_tr_pbmn', 'prgm_ntby_qty_2', 'prgm_ntby_tr_pbmn_2', 'arbt_ntby_tr_pbmn']),
      rootSample: pickRootSample(data),
      rowCount: diag?.rowCount,
      selectedPath: diag?.selectedPath,
      selectedBsopHour: diag?.selectedBsopHour,
      selectedReason: diag?.selectedReason,
      nonZeroRowCount: diag?.nonZeroRowCount,
      latestRowBsopHour: diag?.latestRowBsopHour,
      sumProgramBuyAmount: diag?.sumProgramBuyAmount,
      sumProgramSellAmount: diag?.sumProgramSellAmount,
      sumProgramNetBuyAmount: diag?.sumProgramNetBuyAmount,
      sumArbitrageNetBuy: diag?.sumArbitrageNetBuy,
      sumNonArbitrageNetBuy: diag?.sumNonArbitrageNetBuy,
      parseQuality: diag?.parseQuality,
      providerIssue: diag?.providerIssue,
      executionImpact: diag?.executionImpact,
      status: diag?.status,
    };
  } catch (e) {
    return fail('MARKET_PROGRAM', MARKET_PROGRAM_INDEX_CODE, MARKET_PROGRAM_TRADE_TR_ID, MARKET_PROGRAM_TRADE_PATH, 'FETCH_FAIL', e instanceof Error ? e.message : String(e));
  }
}

export type KisEndpointBlockedReason =
  | 'MATERIALIZED'
  | 'QUOTE_LIKE_OUTPUT'
  | 'QUOTE_LIKE_OUTPUT_NO_NETBUY_FIELDS'
  | 'QUOTE_LIKE_OUTPUT_NO_SHORT_FIELDS'
  | 'NO_INVESTOR_BUCKET'
  | 'NO_SHORT_BUCKET'
  | 'OUTPUT_BUCKET_MISMATCH'
  | 'SESSION_UNAVAILABLE'
  | 'EXPECTED_EMPTY_OFF_SESSION'
  | 'HTTP_OK_BUT_EMPTY'
  | 'NOT_IN_TOP_LIST'
  | 'NO_ROW_FOR_SYMBOL'
  | 'DATE_NOT_AVAILABLE'
  | 'PARAM_ERROR'
  | 'FIELD_MISSING'
  | 'PROVIDER_ERROR'
  | 'UNKNOWN';

export interface KisEndpointTrace {
  stockCode: string;
  sourceKind: string;
  trId: string;
  apiPath: string;
  params: Record<string, string>;
  httpCalled: boolean;
  httpStatus?: number;
  rtCd?: string;
  msgCd?: string;
  msg1?: string;
  rootKeys?: string[];
  outputType?: string;
  outputLength?: number;
  outputKeys?: string[];
  output1Type?: string;
  output1Length?: number;
  output1Keys?: string[];
  output2Type?: string;
  output2Length?: number;
  output2Keys?: string[];
  selectedBucket?: 'output' | 'output1' | 'output2' | 'NONE';
  outputPath?: string;
  rowCount: number;
  targetFound?: boolean;
  parsedFields: string[];
  materialized: boolean;
  blockedReason: KisEndpointBlockedReason;
}


function kstDateStr(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

function previousKrxTradingDate(dateKst: string): string {
  let cursor = shiftYmd(dateKst, -1);
  for (let i = 0; i < 32; i += 1) {
    if (isTradingDay(cursor)) return cursor;
    cursor = shiftYmd(cursor, -1);
  }
  return dateKst;
}

function investorDailyTraceDate(): string {
  return previousKrxTradingDate(kstDateStr()).replace(/-/g, '');
}

function isQuoteLikeOutput(row: Record<string, string> | undefined): boolean {
  if (!row) return false;
  const keys = new Set(Object.keys(row));
  return ['stck_prpr', 'cntg_vol', 'stck_cntg_hour', 'prdy_vrss', 'prdy_ctrt', 'acml_vol', 'prdy_vol'].filter((key) => keys.has(key)).length >= 3;
}

function isInquireInvestorQuoteLikeOutput(sourceKind: string, row: Record<string, string> | undefined): boolean {
  if (sourceKind !== 'INQUIRE_INVESTOR' || !row) return false;
  const keys = new Set(Object.keys(row));
  const hasInvestorKeys = ['frgn_ntby_qty', 'orgn_ntby_qty', 'prsn_ntby_qty', 'frgn_ntby_tr_pbmn', 'orgn_ntby_tr_pbmn'].some((key) => keys.has(key));
  return isQuoteLikeOutput(row) && !hasInvestorKeys;
}

function rowsFromBucket(bucket: unknown): Record<string, string>[] {
  if (Array.isArray(bucket)) return bucket.filter((v): v is Record<string, string> => !!v && typeof v === 'object' && !Array.isArray(v));
  if (bucket && typeof bucket === 'object') return [bucket as Record<string, string>];
  return [];
}

function bucketType(bucket: unknown): string {
  if (Array.isArray(bucket)) return 'array';
  if (bucket && typeof bucket === 'object') return 'object';
  if (bucket === undefined) return 'missing';
  if (bucket === null) return 'null';
  return typeof bucket;
}

function bucketKeys(rows: Record<string, string>[]): string[] {
  return rows[0] ? Object.keys(rows[0]).slice(0, 50) : [];
}

function pickKisRowsByBucket(data: unknown): Record<'output' | 'output1' | 'output2', Record<string, string>[]> {
  const root = data as { output?: unknown; output1?: unknown; output2?: unknown } | null;
  return {
    output: rowsFromBucket(root?.output),
    output1: rowsFromBucket(root?.output1),
    output2: rowsFromBucket(root?.output2),
  };
}

function bucketMeta(data: unknown): Pick<KisEndpointTrace, 'rootKeys' | 'outputType' | 'outputLength' | 'outputKeys' | 'output1Type' | 'output1Length' | 'output1Keys' | 'output2Type' | 'output2Length' | 'output2Keys'> {
  const root = data as { output?: unknown; output1?: unknown; output2?: unknown } | null;
  const rows = pickKisRowsByBucket(data);
  return {
    rootKeys: rootKeys(data),
    outputType: bucketType(root?.output),
    outputLength: rows.output.length,
    outputKeys: bucketKeys(rows.output),
    output1Type: bucketType(root?.output1),
    output1Length: rows.output1.length,
    output1Keys: bucketKeys(rows.output1),
    output2Type: bucketType(root?.output2),
    output2Length: rows.output2.length,
    output2Keys: bucketKeys(rows.output2),
  };
}

function rowsWithPath(data: unknown): { path: 'output' | 'output1' | 'output2' | 'NONE'; rows: Record<string, string>[] } {
  const buckets = pickKisRowsByBucket(data);
  for (const key of ['output', 'output1', 'output2'] as const) {
    if (buckets[key].length > 0) return { path: key, rows: buckets[key] };
  }
  return { path: 'NONE', rows: [] };
}

function rootString(data: unknown, key: string): string | undefined {
  const value = data && typeof data === 'object' ? (data as Record<string, unknown>)[key] : undefined;
  return value === undefined || value === null ? undefined : String(value);
}

function classifyEndpointRootIssue(data: unknown, sourceKind: string): KisEndpointBlockedReason | null {
  const rtCd = rootString(data, 'rt_cd') ?? '';
  const msgCd = rootString(data, 'msg_cd') ?? '';
  const msg1 = rootString(data, 'msg1') ?? '';
  const message = `${msgCd} ${msg1}`.toUpperCase();
  if (message.includes('SESSION') || message.includes('TOKEN') || message.includes('AUTH') || message.includes('AUTHORIZATION')) return 'SESSION_UNAVAILABLE';
  if (message.includes('DATE') || message.includes('일자') || message.includes('영업일')) return 'DATE_NOT_AVAILABLE';
  if (msgCd === 'OPSQ2001' || message.includes('INPUT FIELD') || message.includes('INVALID') || message.includes('PARAM') || message.includes('FID_')) return 'PARAM_ERROR';
  if (rtCd && rtCd !== '0') return 'PROVIDER_ERROR';
  if (sourceKind === 'SHORT' && message.includes('조회할 자료가 없습니다')) return 'DATE_NOT_AVAILABLE';
  return null;
}

function rowCode(row: Record<string, string>): string {
  return String(row.mksc_shrn_iscd ?? row.stck_shrn_iscd ?? row.pdno ?? row.MKSC_SHRN_ISCD ?? '').padStart(6, '0');
}

function parsedEndpointFields(sourceKind: string, row: Record<string, string> | undefined): string[] {
  if (sourceKind === 'SHORT') {
    if (!row) return [];
    const fields: string[] = [];
    if (parseNum(row, ['ssts_cntg_qty', 'shts_cntg_qty', 'stss_cntg_qty', 'SSTS_CNTG_QTY', 'SHTS_CNTG_QTY', 'STSS_CNTG_QTY']) !== null) fields.push('shortSaleQty');
    if (parseNum(row, ['ssts_tr_pbmn', 'shts_tr_pbmn', 'stss_tr_pbmn', 'SSTS_TR_PBMN', 'SHTS_TR_PBMN', 'STSS_TR_PBMN']) !== null) fields.push('shortSaleAmount');
    if (parseNum(row, ['ssts_tr_pbmn_rlim', 'ssts_vol_rlim', 'stss_rate', 'short_rate', 'SSTS_TR_PBMN_RLIM', 'SSTS_VOL_RLIM', 'STSS_RATE', 'SHORT_RATE']) !== null) fields.push('shortSaleRatio');
    return fields;
  }

  if (!row) return [];
  const fields: string[] = [];
  if (parseNum(row, ['frgn_ntby_qty', 'frgn_ntby_tr_pbmn', 'FRGN_NTBY_QTY', 'FRGN_NTBY_TR_PBMN']) !== null) fields.push('foreignNetBuy');
  if (parseNum(row, ['orgn_ntby_qty', 'orgn_ntby_tr_pbmn', 'ORGN_NTBY_QTY', 'ORGN_NTBY_TR_PBMN']) !== null) fields.push('institutionalNetBuy');
  if (parseNum(row, ['prsn_ntby_qty', 'prsn_ntby_tr_pbmn', 'PRSN_NTBY_QTY', 'PRSN_NTBY_TR_PBMN']) !== null) fields.push('individualNetBuy');
  return fields;
}

async function endpointTrace(input: {
  stockCode: string;
  sourceKind: string;
  trId: string;
  apiPath: string;
  params: Record<string, string>;
  priority: KisApiPriority;
  targetList?: boolean;
}): Promise<KisEndpointTrace> {
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) {
    return { ...input, httpCalled: false, rowCount: 0, parsedFields: [], materialized: false, blockedReason: 'SESSION_UNAVAILABLE' };
  }
  try {
    const data = await realDataKisGet(input.trId, input.apiPath, input.params, input.priority);
    if (!data) return { ...input, httpCalled: true, rowCount: 0, parsedFields: [], materialized: false, blockedReason: 'PROVIDER_ERROR' };
    const meta = bucketMeta(data);
    const buckets = pickKisRowsByBucket(data);
    const selectionOrder: Array<'output' | 'output1' | 'output2'> =
      input.sourceKind === 'INVESTOR_TRADE_BY_STOCK_DAILY' || input.sourceKind === 'SHORT'
        ? ['output2', 'output', 'output1']
        : ['output', 'output1', 'output2'];
    let selectedBucket: 'output' | 'output1' | 'output2' | 'NONE' = 'NONE';
    let rows: Record<string, string>[] = [];
    let target: Record<string, string> | undefined;
    let parsedFields: string[] = [];
    for (const bucket of selectionOrder) {
      const bucketRows = buckets[bucket];
      const bucketTarget = input.targetList ? bucketRows.find((row) => rowCode(row) === input.stockCode.padStart(6, '0')) : bucketRows[0];
      const bucketParsedFields = parsedEndpointFields(input.sourceKind, bucketTarget);
      if (bucketParsedFields.length > 0) {
        selectedBucket = bucket;
        rows = bucketRows;
        target = bucketTarget;
        parsedFields = bucketParsedFields;
        break;
      }
    }
    if (selectedBucket === 'NONE') {
      const first = rowsWithPath(data);
      selectedBucket = first.path;
      rows = first.rows;
      target = input.targetList ? rows.find((row) => rowCode(row) === input.stockCode.padStart(6, '0')) : rows[0];
      parsedFields = parsedEndpointFields(input.sourceKind, target);
    }
    const targetFound = input.targetList ? Boolean(target) : rows.length > 0;
    const materialized = parsedFields.length > 0;
    let blockedReason: KisEndpointBlockedReason = 'UNKNOWN';
    const msgCd = rootString(data, 'msg_cd');
    const rootIssue = classifyEndpointRootIssue(data, input.sourceKind);
    const anyRows = [...buckets.output, ...buckets.output1, ...buckets.output2];
    const hasQuoteLikeOnly = anyRows.length > 0 && anyRows.some(isQuoteLikeOutput);
    if (materialized) blockedReason = 'MATERIALIZED';
    else if (rootIssue) blockedReason = rootIssue;
    else if (anyRows.length === 0) blockedReason = 'HTTP_OK_BUT_EMPTY';
    else if (input.sourceKind === 'INVESTOR_TRADE_BY_STOCK_DAILY') blockedReason = buckets.output2.length === 0 ? 'NO_INVESTOR_BUCKET' : (hasQuoteLikeOnly ? 'QUOTE_LIKE_OUTPUT_NO_NETBUY_FIELDS' : 'FIELD_MISSING');
    else if (input.sourceKind === 'SHORT') blockedReason = buckets.output2.length === 0 ? 'NO_SHORT_BUCKET' : (hasQuoteLikeOnly ? 'QUOTE_LIKE_OUTPUT_NO_SHORT_FIELDS' : 'FIELD_MISSING');
    else if (isInquireInvestorQuoteLikeOutput(input.sourceKind, target)) blockedReason = 'QUOTE_LIKE_OUTPUT';
    else if (input.sourceKind === 'FOREIGN_INSTITUTION_TOTAL' && !targetFound) blockedReason = 'NOT_IN_TOP_LIST';
    else if (!targetFound) blockedReason = 'NO_ROW_FOR_SYMBOL';
    else blockedReason = 'FIELD_MISSING';
    return {
      stockCode: input.stockCode,
      sourceKind: input.sourceKind,
      trId: input.trId,
      apiPath: input.apiPath,
      params: input.params,
      httpCalled: true,
      rtCd: rootString(data, 'rt_cd'),
      msgCd,
      msg1: rootString(data, 'msg1'),
      ...meta,
      selectedBucket,
      outputPath: selectedBucket,
      rowCount: rows.length,
      targetFound,
      parsedFields,
      materialized,
      blockedReason,
    };
  } catch (e) {
    return { ...input, httpCalled: true, rowCount: 0, parsedFields: [], materialized: false, blockedReason: 'PROVIDER_ERROR', msg1: e instanceof Error ? e.message : String(e) };
  }
}

export async function diagnoseKisInvestorEndpointTraces(code: string, priority: KisApiPriority = 'LOW'): Promise<KisEndpointTrace[]> {
  const safeCode = code.padStart(6, '0');
  const previousTradingDay = investorDailyTraceDate();
  return Promise.all([
    endpointTrace({ stockCode: safeCode, sourceKind: 'INQUIRE_INVESTOR', trId: 'FHKST01010300', apiPath: '/uapi/domestic-stock/v1/quotations/inquire-investor', params: { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: safeCode }, priority }),
    endpointTrace({ stockCode: safeCode, sourceKind: 'INVESTOR_TRADE_BY_STOCK_DAILY', trId: 'FHPTJ04160001', apiPath: '/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily', params: { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: safeCode, FID_INPUT_DATE_1: previousTradingDay, FID_ORG_ADJ_PRC: '0', FID_ETC_CLS_CODE: '0' }, priority }),
    endpointTrace({ stockCode: safeCode, sourceKind: 'FOREIGN_INSTITUTION_TOTAL', trId: 'FHPTJ04400000', apiPath: '/uapi/domestic-stock/v1/quotations/foreign-institution-total', params: { FID_COND_MRKT_DIV_CODE: 'V', FID_COND_SCR_DIV_CODE: '16449', FID_INPUT_ISCD: '0000', FID_DIV_CLS_CODE: '1', FID_RANK_SORT_CLS_CODE: '0', FID_ETC_CLS_CODE: '0' }, priority, targetList: true }),
    endpointTrace({ stockCode: safeCode, sourceKind: 'INVESTOR_TREND_ESTIMATE', trId: 'HHPTJ04160200', apiPath: '/uapi/domestic-stock/v1/quotations/investor-trend-estimate', params: { MKSC_SHRN_ISCD: safeCode }, priority }),
  ]);
}

export interface KisShortDateTrace extends KisEndpointTrace { tradingDate: string }

export async function diagnoseKisShortSaleDateTraces(code: string, tradingDates: string[], priority: KisApiPriority = 'LOW'): Promise<KisShortDateTrace[]> {
  const safeCode = code.padStart(6, '0');
  const trId = 'FHPST04830000';
  const apiPath = '/uapi/domestic-stock/v1/quotations/daily-short-sale';
  const traces: KisShortDateTrace[] = [];
  for (const date of tradingDates) {
    const ymd = date.replace(/-/g, '');
    const trace = await endpointTrace({ stockCode: safeCode, sourceKind: 'SHORT', trId, apiPath, params: { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: safeCode, FID_INPUT_DATE_1: ymd, FID_INPUT_DATE_2: ymd }, priority });
    traces.push({ ...trace, tradingDate: date });
  }
  return traces;
}
