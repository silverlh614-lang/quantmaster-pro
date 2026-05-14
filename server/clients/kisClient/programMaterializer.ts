// @responsibility KIS program trade materialization SSOT for diagnostic consumers.

import type { KisMarketProgramTrade } from './types.js';

export const MARKET_PROGRAM_TRADE_TR_ID = process.env.KIS_MARKET_PROGRAM_TRADE_TR_ID ?? 'FHPPG04600101';
export const MARKET_PROGRAM_TRADE_PATH =
  process.env.KIS_MARKET_PROGRAM_TRADE_PATH
  ?? '/uapi/domestic-stock/v1/quotations/comp-program-trade-today';
export const MARKET_PROGRAM_DIV_CODE = process.env.KIS_MARKET_PROGRAM_DIV_CODE ?? 'J';
export const MARKET_PROGRAM_INDEX_CODE = process.env.KIS_MARKET_PROGRAM_INDEX_CODE ?? '0001';
export const MARKET_PROGRAM_MARKET_CLASS_CODE = process.env.KIS_MARKET_PROGRAM_MARKET_CLASS_CODE ?? '1';
export const MARKET_PROGRAM_SECTION_CLASS_CODE = process.env.KIS_MARKET_PROGRAM_SECTION_CLASS_CODE ?? '0';
export const MARKET_PROGRAM_INPUT_HOUR_1 = process.env.KIS_MARKET_PROGRAM_INPUT_HOUR_1 ?? '000000';

export type MarketProgramMaterializerStatus = 'OK' | 'ACCEPTED_EMPTY' | 'TRUE_EMPTY' | 'FIELD_MISSING';

export interface MarketProgramMaterializerResult {
  parserSource: 'programMaterializer';
  status: MarketProgramMaterializerStatus;
  materialized: KisMarketProgramTrade | null;
  outputPath: string;
  rowCount: number;
  outputKeys: string[];
  parsedFields: string[];
}

type KisOutput = Record<string, string>;

export function buildMarketProgramParams(): Record<string, string> {
  return {
    FID_COND_MRKT_DIV_CODE: MARKET_PROGRAM_DIV_CODE,
    FID_COND_MRKT_DIV_CODE1: MARKET_PROGRAM_DIV_CODE,
    FID_MRKT_CLS_CODE: MARKET_PROGRAM_MARKET_CLASS_CODE,
    FID_SCTN_CLS_CODE: MARKET_PROGRAM_SECTION_CLASS_CODE,
    FID_INPUT_ISCD: MARKET_PROGRAM_INDEX_CODE,
    FID_INPUT_HOUR_1: MARKET_PROGRAM_INPUT_HOUR_1,
  };
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

function num(out: KisOutput | undefined, keys: string[]): number | null {
  if (!out) return null;
  for (const key of keys) {
    const raw = out[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const n = Number(String(raw).replace(/,/g, '').trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
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

export function materializeKisMarketProgramTrade(data: unknown, fetchedAt = new Date().toISOString()): MarketProgramMaterializerResult {
  const { path, rows } = rowsAt(data);
  const out = rows[0];
  const outputKeys = out ? Object.keys(out).slice(0, 50) : [];
  if (!out) {
    return { parserSource: 'programMaterializer', status: acceptedEmpty(data) ? 'ACCEPTED_EMPTY' : 'TRUE_EMPTY', materialized: null, outputPath: path, rowCount: rows.length, outputKeys, parsedFields: [] };
  }

  const parsed = {
    programNetBuyQty: num(out, ['whol_smtn_ntby_qty', 'prgm_ntby_qty', 'prgm_ntby_qty_2', 'PRGM_NTBY_QTY']),
    programNetBuyAmount: num(out, ['whol_smtn_ntby_tr_pbmn', 'prgm_ntby_tr_pbmn', 'prgm_ntby_tr_pbmn_2', 'PRGM_NTBY_TR_PBMN']),
    programArbitrageNetBuy: num(out, ['arbt_smtn_ntby_tr_pbmn', 'arbt_ntby_tr_pbmn', 'ARBT_NTBY_TR_PBMN', 'arbt_ntby_tr_pbmn_2']),
    programNonArbitrageNetBuy: num(out, ['nabt_smtn_ntby_tr_pbmn', 'nabt_ntby_tr_pbmn', 'NABT_NTBY_TR_PBMN']),
    programSellAmount: sum(out, ['arbt_smtn_seln_tr_pbmn', 'nabt_smtn_seln_tr_pbmn']),
    programBuyAmount: sum(out, ['arbt_smtn_shnu_tr_pbmn', 'nabt_smtn_shnu_tr_pbmn']),
  };
  const parsedFields = Object.entries(parsed).filter(([, v]) => v !== null).map(([k]) => k);
  if (parsedFields.length === 0) {
    return { parserSource: 'programMaterializer', status: 'FIELD_MISSING', materialized: null, outputPath: path, rowCount: rows.length, outputKeys, parsedFields };
  }
  return {
    parserSource: 'programMaterializer',
    status: 'OK',
    materialized: {
      programNetBuyQty: parsed.programNetBuyQty,
      programNetBuyAmount: parsed.programNetBuyAmount,
      programArbitrageNetBuy: parsed.programArbitrageNetBuy,
      programNonArbitrageNetBuy: parsed.programNonArbitrageNetBuy,
      programSellAmount: parsed.programSellAmount,
      programBuyAmount: parsed.programBuyAmount,
      fetchedAt,
      source: 'KIS_API',
    },
    outputPath: path,
    rowCount: rows.length,
    outputKeys,
    parsedFields,
  };
}
