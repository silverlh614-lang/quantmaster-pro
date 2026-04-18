/**
 * dartFinancialClient.ts — DART Open API 기반 펀더멘털 실데이터
 *
 * @responsibility DART 재무지표를 캐시 + 재시도 + 서킷 브레이커로 안정 조회한다.
 *
 * DART_API_KEY 필요. 없으면 모두 null 반환.
 * 24시간 인메모리 캐시 (당일 재호출 차단).
 *
 * 제공 지표 (전년도 연결 사업보고서 기준):
 *   roe       — 자기자본이익률 (당기순이익/자기자본 %)
 *   opm       — 영업이익률 (영업이익/매출 %)
 *   debtRatio — 부채비율 (총부채/자기자본 %)
 *   ocfRatio  — 영업활동현금흐름/매출 (%)
 */

import { fetchJsonWithRetry, FetchRetryError } from '../utils/fetchWithRetry.js';
import { createCircuitBreaker, CircuitOpenError } from '../utils/circuitBreaker.js';

const DART_BASE = 'https://opendart.fss.or.kr/api';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// DART 공시 API: 5건/초 제한 — 5xx/네트워크 누적 시 1분 차단.
const _dartCb = createCircuitBreaker({
  name: 'dart',
  failureThreshold: 6,
  windowMs: 60_000,
  cooldownMs: 60_000,
});

export function getDartCircuitStats() {
  return _dartCb.getStats();
}

export interface DartFinancials {
  roe:       number | null;  // %
  opm:       number | null;  // %
  debtRatio: number | null;  // %
  ocfRatio:  number | null;  // %
  year: string;
  source: 'DART_API';
}

// ── 인메모리 캐시 ───────────────────────────────────────────────────────────────
const _corpCache  = new Map<string, { code: string; exp: number }>();
const _finCache   = new Map<string, { data: DartFinancials; exp: number }>();

// ── corp_code 조회 (stock_code 6자리 → DART 고유 corp_code) ───────────────────
async function getCorpCode(stockCode: string): Promise<string | null> {
  const key = stockCode.padStart(6, '0');
  const hit = _corpCache.get(key);
  if (hit && Date.now() < hit.exp) return hit.code;

  const apiKey = process.env.DART_API_KEY;
  if (!apiKey) return null;

  try {
    const data = await _dartCb.exec(() =>
      fetchJsonWithRetry<{ status: string; corp_code?: string }>(
        `${DART_BASE}/company.json?crtfc_key=${apiKey}&stock_code=${key}`,
        { timeoutMs: 8000, retries: 2, callerLabel: 'dart-corp' },
      ),
    );
    if (data.status !== '000' || !data.corp_code) return null;
    _corpCache.set(key, { code: data.corp_code, exp: Date.now() + CACHE_TTL_MS });
    return data.corp_code;
  } catch (e) {
    if (e instanceof CircuitOpenError) {
      console.warn(`[DART/Corp] 서킷 OPEN — ${key} skip`);
    } else if (e instanceof FetchRetryError) {
      console.warn(`[DART/Corp] ${key} 재시도 실패 — ${e.message}`);
    } else {
      console.error(`[DART/Corp] ${key} 예상 외 오류:`, e instanceof Error ? e.message : e);
    }
    return null;
  }
}

// ── 재무항목 추출 헬퍼 (복수 account_id 시도, 첫 번째 유효값 반환) ─────────────
type DartItem = { account_id: string; thstrm_amount?: string };

function extractAmt(list: DartItem[], ...ids: string[]): number | null {
  for (const id of ids) {
    const item = list.find(x => x.account_id === id);
    if (item?.thstrm_amount) {
      const v = parseFloat(item.thstrm_amount.replace(/,/g, ''));
      if (isFinite(v)) return v;
    }
  }
  return null;
}

// ── 공개 API ────────────────────────────────────────────────────────────────────

/**
 * 종목코드로 DART 재무제표 핵심 지표 조회.
 * - 전년도 사업보고서(reprt_code=11011), 연결재무제표(fs_div=CFS) 우선
 * - DART_API_KEY 미설정 또는 조회 실패 시 null 반환
 */
export async function getDartFinancials(stockCode: string): Promise<DartFinancials | null> {
  const apiKey = process.env.DART_API_KEY;
  if (!apiKey) return null;

  const key = stockCode.padStart(6, '0');

  const hit = _finCache.get(key);
  if (hit && Date.now() < hit.exp) return hit.data;

  const corpCode = await getCorpCode(key);
  if (!corpCode) return null;

  // 전년도 기준 (당해 연도 사업보고서는 이듬해 3~4월 공시)
  const year = String(new Date().getFullYear() - 1);
  const url =
    `${DART_BASE}/fnlttSinglAcntAll.json` +
    `?crtfc_key=${apiKey}&corp_code=${corpCode}` +
    `&bsns_year=${year}&reprt_code=11011&fs_div=CFS`;

  try {
    const data = await _dartCb.exec(() =>
      fetchJsonWithRetry<{ status: string; list?: DartItem[] }>(url, {
        timeoutMs: 10000, retries: 2, callerLabel: 'dart-fin-cfs',
      }),
    );

    // CFS 없으면 OFS(개별) fallback
    let list = data.list ?? [];
    if (data.status !== '000' || list.length === 0) {
      const url2 = url.replace('fs_div=CFS', 'fs_div=OFS');
      const data2 = await _dartCb.exec(() =>
        fetchJsonWithRetry<{ status: string; list?: DartItem[] }>(url2, {
          timeoutMs: 10000, retries: 2, callerLabel: 'dart-fin-ofs',
        }),
      );
      if (data2.status !== '000' || !data2.list?.length) return null;
      list = data2.list;
    }

    const revenue   = extractAmt(list, 'ifrs-full_Revenue', 'ifrs_Revenue', 'dart_Revenue');
    const opIncome  = extractAmt(list,
      'dart_OperatingIncomeLoss',
      'ifrs-full_ProfitLossFromOperatingActivities',
      'ifrs-full_OperatingIncome',
    );
    const netIncome = extractAmt(list,
      'ifrs-full_ProfitLoss',
      'ifrs-full_NetProfitLoss',
      'ifrs-full_ProfitLossAttributableToOwnersOfParent',
    );
    const equity    = extractAmt(list,
      'ifrs-full_Equity',
      'ifrs-full_EquityAttributableToOwnersOfParent',
    );
    const liabs     = extractAmt(list, 'ifrs-full_Liabilities');
    const opCF      = extractAmt(list,
      'ifrs-full_CashFlowsFromUsedInOperatingActivities',
      'ifrs-full_CashFlowsFromOperatingActivities',
    );

    const result: DartFinancials = {
      roe:       (netIncome != null && equity   && equity   !== 0) ? netIncome / equity   * 100 : null,
      opm:       (opIncome  != null && revenue  && revenue  !== 0) ? opIncome  / revenue  * 100 : null,
      debtRatio: (liabs     != null && equity   && equity   !== 0) ? liabs     / equity   * 100 : null,
      ocfRatio:  (opCF      != null && revenue  && revenue  !== 0) ? opCF      / revenue  * 100 : null,
      year,
      source: 'DART_API',
    };

    _finCache.set(key, { data: result, exp: Date.now() + CACHE_TTL_MS });
    console.log(
      `[DART/Fin] ${key} ${year}: ROE=${result.roe?.toFixed(1) ?? 'N/A'}% ` +
      `OPM=${result.opm?.toFixed(1) ?? 'N/A'}% DR=${result.debtRatio?.toFixed(0) ?? 'N/A'}%`,
    );
    return result;
  } catch (e) {
    if (e instanceof CircuitOpenError) {
      console.warn(`[DART/Fin] 서킷 OPEN — ${key} skip`);
    } else if (e instanceof FetchRetryError) {
      console.warn(`[DART/Fin] ${key} 재시도 실패 — ${e.message}`);
    } else {
      console.error(`[DART/Fin] ${key} 실패:`, e instanceof Error ? e.message : e);
    }
    return null;
  }
}
