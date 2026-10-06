// @responsibility Fetch current KIS prices for up to thirty KRX stocks per request.
/**
 * 관심종목(멀티종목) 시세조회 FHKST11300006 — 공식 샘플 examples_llm/domestic_stock/intstock_multprice.
 * 요청은 FID_COND_MRKT_DIV_CODE_n·FID_INPUT_ISCD_n(n=1..30) 쌍이고, 응답 output 배열에서
 * inter_shrn_iscd(종목코드)·inter2_prpr(현재가)만 쓴다. 공식 샘플에 모의투자 구분이 없어 실전 서버
 * 전용으로 취급한다. 사용할 수 없거나 응답이 비면 null을 돌려 호출측이 단건 현재가 조회를 유지한다.
 */

import { logger } from '../../../utils/logger.js';
import { HAS_REAL_DATA_CLIENT, KIS_IS_REAL } from '../constants.js';
import { realDataKisGet } from '../http.js';
import { pickKisRowsByBucket } from './helpers.js';

export const KIS_MULTI_QUOTE_LIMIT = 30;
const MULTI_QUOTE_TR_ID = 'FHKST11300006';
const MULTI_QUOTE_PATH = '/uapi/domestic-stock/v1/quotations/intstock-multprice';
const WARN_INTERVAL_MS = 10 * 60_000;
let lastWarnAt = 0;

export interface KisMultiQuote {
  code: string;
  currentPrice: number | null;
  /** Request start time, the same convention as fetchKisStockFullQuote. */
  fetchedAt: string;
}

/** Codes missing from the rows stay absent; a response without rows is null. */
export function parseKisMultiQuotes(codes: readonly string[], data: unknown, fetchedAt: string): Map<string, KisMultiQuote> | null {
  const rows = pickKisRowsByBucket(data).output;
  if (!rows.length) return null;
  const quotes = new Map<string, KisMultiQuote>();
  for (const row of rows) {
    const code = String(row.inter_shrn_iscd ?? '').trim();
    if (!codes.includes(code) || quotes.has(code)) continue;
    const price = Number.parseInt(row.inter2_prpr ?? '', 10);
    quotes.set(code, { code, currentPrice: price > 0 ? price : null, fetchedAt });
  }
  return quotes;
}

function warnUnanswered(data: unknown, requested: number, error?: unknown): void {
  if (Date.now() - lastWarnAt < WARN_INTERVAL_MS) return;
  lastWarnAt = Date.now();
  const body = data as { rt_cd?: unknown; msg_cd?: unknown; msg1?: unknown } | null;
  logger.warn('[KIS] fetchKisMultiQuotes 응답 없음 · 단건 현재가 조회로 대체', {
    requested, rtCd: body?.rt_cd ?? null, msgCd: body?.msg_cd ?? null, msg: body?.msg1 ?? null,
    error: error instanceof Error ? error.message : error === undefined ? null : String(error),
  });
}

/** Null means unavailable or failed, so the caller keeps its single-quote path. */
export async function fetchKisMultiQuotes(stockCodes: readonly string[]): Promise<Map<string, KisMultiQuote> | null> {
  const codes = [...new Set(stockCodes.map(code => code.padStart(6, '0')))];
  if (codes.length > KIS_MULTI_QUOTE_LIMIT) throw new RangeError(`KIS multi quote accepts at most ${KIS_MULTI_QUOTE_LIMIT} codes`);
  if (!codes.length || (!HAS_REAL_DATA_CLIENT && !(KIS_IS_REAL && process.env.KIS_APP_KEY))) return null;
  const params: Record<string, string> = {};
  codes.forEach((code, index) => {
    params[`FID_COND_MRKT_DIV_CODE_${index + 1}`] = 'J';
    params[`FID_INPUT_ISCD_${index + 1}`] = code;
  });
  const fetchedAt = new Date().toISOString();
  try {
    const data = await realDataKisGet(MULTI_QUOTE_TR_ID, MULTI_QUOTE_PATH, params);
    const quotes = parseKisMultiQuotes(codes, data, fetchedAt);
    if (!quotes?.size) warnUnanswered(data, codes.length);
    return quotes?.size ? quotes : null;
  } catch (error) {
    warnUnanswered(null, codes.length, error);
    return null;
  }
}

/** Test isolation only. */
export function __resetKisMultiQuoteWarningForTest(): void {
  lastWarnAt = 0;
}
