/**
 * @responsibility KIS 관심종목(멀티종목) 시세조회 (FHKST11300006) — 최대 30종목 배치 시세
 *
 * ADR-0519 Phase 5: intstock-multprice 배치 시세로 symbolDataCollector 개별 quote fetch 대체.
 * 100종목 기준 100회 → 4회 KIS 호출 감소.
 * KIS 단일 통로 (kisClient) 준수. executionImpact=NONE.
 */

import { realDataKisGet } from './http.js';
import { logger } from '../../utils/logger.js';
import type { KisStockFullQuote } from './query.js';

const MULTI_PRICE_BATCH_SIZE = 30; // API 제한
const API_PATH = '/uapi/domestic-stock/v1/quotations/intstock-multprice';
const TR_ID = 'FHKST11300006';

/**
 * KIS intstock-multprice 응답 단일 row.
 * 필드명은 KIS 공식 API 응답 기준.
 */
interface KisMultiPriceRawRow {
  inter_shrn_iscd?: string;       // 종목코드
  inter_kor_isnm?: string;        // 한글 종목명
  inter2_prpr?: string;           // 현재가
  acml_vol?: string;              // 누적 거래량
  prdy_ctrt?: string;             // 전일 대비율 (%)
  inter2_prdy_clpr?: string;      // 전일 종가
  kospi_kosdaq_cls_name?: string; // KOSPI/KOSDAQ 구분
  acml_tr_pbmn?: string;          // 누적 거래 대금
}

function parseRow(row: KisMultiPriceRawRow, fetchedAt: string): KisStockFullQuote | null {
  const code = row.inter_shrn_iscd?.padStart(6, '0');
  if (!code) return null;
  return {
    code,
    currentPrice: row.inter2_prpr ? parseFloat(row.inter2_prpr) || null : null,
    volume: row.acml_vol ? parseInt(row.acml_vol, 10) || null : null,
    changePercent: row.prdy_ctrt ? parseFloat(row.prdy_ctrt) || null : null,
    prevClose: row.inter2_prdy_clpr ? parseFloat(row.inter2_prdy_clpr) || null : null,
    fetchedAt,
  };
}

/**
 * 최대 30종목 단일 배치 조회 (내부용).
 */
async function fetchOneBatch(codes: string[]): Promise<KisStockFullQuote[]> {
  if (codes.length === 0 || codes.length > MULTI_PRICE_BATCH_SIZE) {
    throw new Error(`[queryMultiPrice] batch size must be 1~30, got ${codes.length}`);
  }
  const fetchedAt = new Date().toISOString();
  const params: Record<string, string> = {};
  codes.forEach((code, i) => {
    const n = i + 1;
    params[`FID_COND_MRKT_DIV_CODE_${n}`] = 'J';
    params[`FID_INPUT_ISCD_${n}`] = code.padStart(6, '0');
  });

  try {
    const data = await realDataKisGet(TR_ID, API_PATH, params);
    if (!Array.isArray(data?.output)) return [];
    return (data.output as KisMultiPriceRawRow[])
      .map((row) => parseRow(row, fetchedAt))
      .filter((r): r is KisStockFullQuote => r !== null);
  } catch (err) {
    logger.warn(
      '[KIS/MultiPrice] batch 실패:',
      err instanceof Error ? err.message : String(err),
      { codes },
    );
    return [];
  }
}

/**
 * 여러 종목코드를 30개씩 배치로 나눠 KIS intstock-multprice 조회.
 * 실패한 배치는 빈 배열로 수렴 (전체 중단 방지).
 * @returns Map<code, KisStockFullQuote>
 */
export async function fetchKisMultiStockQuote(
  codes: string[],
): Promise<Map<string, KisStockFullQuote>> {
  if (codes.length === 0) return new Map();

  const batches: string[][] = [];
  for (let i = 0; i < codes.length; i += MULTI_PRICE_BATCH_SIZE) {
    batches.push(codes.slice(i, i + MULTI_PRICE_BATCH_SIZE));
  }

  const results = await Promise.allSettled(batches.map(fetchOneBatch));
  const map = new Map<string, KisStockFullQuote>();

  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const quote of result.value) {
        map.set(quote.code, quote);
      }
    } else {
      logger.warn(
        '[KIS/MultiPrice] 배치 Promise 실패:',
        result.reason instanceof Error ? result.reason.message : String(result.reason),
      );
    }
  }

  logger.info('[KIS/MultiPrice] 배치 시세 완료', {
    totalCodes: codes.length,
    batchCount: batches.length,
    receivedCount: map.size,
  });

  return map;
}
