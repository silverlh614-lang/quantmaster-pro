/**
 * @responsibility KRX OpenAPI 인증 종목 마스터 페치 — KOSPI/KOSDAQ 종목기본정보 단일 통로 (Tier 0)
 *
 * `data.krx.co.kr/comm/fileDn` 비인증 다운로드가 4/27 이후 'LOGOUT' 응답으로 영구 실패하던
 * 결함의 영구 해결책. KRX 가 발급한 AUTH_KEY 로 `openapi.krx.co.kr` (또는 data-dbg) 에 접근.
 *
 * 호출자: `multiSourceStockMaster.refreshMultiSourceMaster()` 의 Tier 0.
 * 비인증 다운로드(`fetchKrxMasterEntries`) 는 fallback (Tier 1) 으로 보존.
 */

import {
  fetchKospiBaseInfo,
  fetchKosdaqBaseInfo,
  isKrxOpenApiHealthy,
  type KrxIsuBaseInfoRow,
} from './krxOpenApi.js';
import type { StockMasterEntry } from '../persistence/krxStockMasterRepo.js';

/** OpenAPI 페치 결과 사유 — orchestrator 가 attempts[].reason 에 그대로 노출. */
export type KrxOpenApiFetchReason =
  | 'DISABLED'        // AUTH_KEY 미설정 또는 KRX_OPENAPI_DISABLED=true 또는 서킷 OPEN
  | 'KOSPI_EMPTY'     // KOSDAQ 만 받음
  | 'KOSDAQ_EMPTY'    // KOSPI 만 받음
  | 'EMPTY_PARSE'     // 양쪽 모두 0건 (응답 정상이지만 매핑 실패)
  | 'EXCEPTION';      // 예외 throw

export interface KrxOpenApiFetchResult {
  ok: boolean;
  entries: StockMasterEntry[];
  kospiCount: number;
  kosdaqCount: number;
  reason?: KrxOpenApiFetchReason;
  detail?: string;
}

/**
 * `KrxIsuBaseInfoRow[]` → `StockMasterEntry[]` 매핑 (테스트 가능하도록 분리).
 * 6자리 코드 검증 + dedup. market 은 호출자(KOSPI/KOSDAQ endpoint) 가 결정.
 */
export function mapBaseInfoToMaster(
  rows: KrxIsuBaseInfoRow[],
  market: 'KOSPI' | 'KOSDAQ',
): StockMasterEntry[] {
  const out: StockMasterEntry[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    if (!r.code || !r.name) continue;
    if (!/^\d{6}$/.test(r.code)) continue;
    if (seen.has(r.code)) continue;
    seen.add(r.code);
    out.push({ code: r.code, name: r.name, market });
  }
  return out;
}

/**
 * KOSPI + KOSDAQ 종목기본정보 병렬 호출 후 단일 entries 배열로 합성.
 *
 * 정책:
 * - AUTH_KEY 미설정/서킷 OPEN/DISABLED: 즉시 ok=false + reason='DISABLED' (fallback 진입).
 * - 양쪽 모두 0건: ok=false + reason='EMPTY_PARSE'.
 * - 한쪽만 0건: 남은 쪽 entries 보존 + ok=false + reason 으로 호출자에게 보고
 *   (호출자가 검증 게이트로 결정 — 부분 데이터로는 KRX_MIN_VALID_ENTRIES=2000 통과 불가).
 * - 양쪽 정상: ok=true + KOSPI+KOSDAQ 합산.
 */
export async function fetchMasterFromOpenApi(): Promise<KrxOpenApiFetchResult> {
  if (!isKrxOpenApiHealthy()) {
    return { ok: false, entries: [], kospiCount: 0, kosdaqCount: 0, reason: 'DISABLED' };
  }
  try {
    const [kospiRows, kosdaqRows] = await Promise.all([
      fetchKospiBaseInfo(),
      fetchKosdaqBaseInfo(),
    ]);
    const kospiEntries = mapBaseInfoToMaster(kospiRows, 'KOSPI');
    const kosdaqEntries = mapBaseInfoToMaster(kosdaqRows, 'KOSDAQ');
    if (kospiEntries.length === 0 && kosdaqEntries.length === 0) {
      return { ok: false, entries: [], kospiCount: 0, kosdaqCount: 0, reason: 'EMPTY_PARSE' };
    }
    if (kospiEntries.length === 0) {
      return {
        ok: false,
        entries: kosdaqEntries,
        kospiCount: 0,
        kosdaqCount: kosdaqEntries.length,
        reason: 'KOSPI_EMPTY',
      };
    }
    if (kosdaqEntries.length === 0) {
      return {
        ok: false,
        entries: kospiEntries,
        kospiCount: kospiEntries.length,
        kosdaqCount: 0,
        reason: 'KOSDAQ_EMPTY',
      };
    }
    return {
      ok: true,
      entries: [...kospiEntries, ...kosdaqEntries],
      kospiCount: kospiEntries.length,
      kosdaqCount: kosdaqEntries.length,
    };
  } catch (e) {
    return {
      ok: false,
      entries: [],
      kospiCount: 0,
      kosdaqCount: 0,
      reason: 'EXCEPTION',
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
