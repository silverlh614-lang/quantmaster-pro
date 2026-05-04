/**
 * @responsibility KIS 수급 zero-filled 원인 분리용 raw diagnostics.
 *
 * `/supply_health` 의 read-only 진단 보강 전용. 기존 fetchKis* 파서가 0으로 정규화한
 * 값이 실제 0인지, output 위치/필드명 drift 때문에 0 fallback 된 것인지 분리한다.
 */

import { HAS_REAL_DATA_CLIENT } from './constants.js';
import { realDataKisGet } from './http.js';
import type { KisApiPriority } from '../kisRateLimiter.js';

export type KisSupplyDiagnosticKind = 'INVESTOR_FLOW' | 'STOCK_PROGRAM';

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
  zeroReason: 'RAW_ZERO' | 'FIELD_MISSING' | 'NO_OUTPUT' | 'FETCH_FAIL' | 'NON_ZERO';
  sample: Record<string, string | number | null>;
  rootSample: Record<string, string | number | boolean | null>;
  error?: string;
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

function fmtSample(sample: Record<string, string | number | boolean | null>): string {
  const entries = Object.entries(sample).slice(0, 8);
  if (entries.length === 0) return 'NONE';
  return entries.map(([k, v]) => `${k}:${v ?? 'NULL'}`).join(',');
}

export function formatKisRawSupplyDiagnostic(diag: KisRawSupplyDiagnostic): string {
  return [
    `rawDiag=${diag.kind}`,
    `code=${diag.code}`,
    `ok=${diag.ok}`,
    `path=${diag.outputPath}`,
    `rootKeys=${diag.rootKeys.join('|') || 'NONE'}`,
    `rootSample=${fmtSample(diag.rootSample)}`,
    `outputKeys=${diag.outputKeys.slice(0, 8).join('|') || 'NONE'}`,
    `parsed=${Object.entries(diag.parsed).map(([k, v]) => `${k}:${v ?? 'NULL'}`).join(',') || 'NONE'}`,
    `zeroReason=${diag.zeroReason}`,
    diag.error ? `error=${diag.error}` : '',
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
      zeroReason: out ? classifyZero(parsed) : 'NO_OUTPUT',
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
      zeroReason: out ? classifyZero(parsed) : 'NO_OUTPUT',
      sample: pickSample(out, ['whol_smtn_ntby_qty', 'whol_smtn_ntby_tr_pbmn', 'prgm_ntby_qty', 'prgm_ntby_tr_pbmn', 'prgm_byov_rate']),
      rootSample: pickRootSample(data),
    };
  } catch (e) {
    return fail('STOCK_PROGRAM', code, STOCK_PROGRAM_TRADE_TR_ID, STOCK_PROGRAM_TRADE_PATH, 'FETCH_FAIL', e instanceof Error ? e.message : String(e));
  }
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
