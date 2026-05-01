/**
 * @responsibility KIS 시세 조회 — 현재가·전일종가·종목명·투자자수급·시장수급
 *
 * ADR-0135 (PR-Refactor-3) — kisClient.ts 분해 시 도메인 조회 격리.
 * 모든 함수가 overrides.ts (VTS mock) 우선 + http.ts realDataKisGet 경유.
 */

import { HAS_REAL_DATA_CLIENT } from './constants.js';
import { realDataKisGet } from './http.js';
import { getKisOverrides } from './overrides.js';
import type { KisInvestorFlow, PrevClose } from './types.js';

// ─── 종목별 투자자 수급 조회 ─────────────────────────────────────────────────

/**
 * FHKST01010300 — 주식현재가 투자자별 순매수 조회.
 * KIS_APP_KEY 미설정 시 null 반환. 실계좌/VTS 모두 지원.
 */
export async function fetchKisInvestorFlow(code: string): Promise<KisInvestorFlow | null> {
  const overrides = getKisOverrides();
  if (overrides.fetchKisInvestorFlow) return overrides.fetchKisInvestorFlow(code);
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return null;
  try {
    const data = await realDataKisGet(
      'FHKST01010300',
      '/uapi/domestic-stock/v1/quotations/inquire-investor',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: code.padStart(6, '0'),
      },
    );
    const out = (data as { output?: Record<string, string> } | null)?.output;
    if (!out) return null;
    return {
      foreignNetBuy:       parseInt(out.frgn_ntby_qty ?? '0', 10),
      institutionalNetBuy: parseInt(out.orgn_ntby_qty  ?? '0', 10),
      individualNetBuy:    parseInt(out.prsn_ntby_qty  ?? '0', 10),
      source: 'KIS_API',
    };
  } catch { return null; }
}

/**
 * FHKST03030100 — 코스피 전체 투자자별 매매 동향 조회.
 * 외국인/기관/개인 전체 시장 순매수량을 반환한다.
 * KIS_APP_KEY 미설정 시 null 반환. 실계좌/VTS 모두 지원.
 */
export async function fetchKisMarketSupply(): Promise<{
  foreignNetBuy: number;
  institutionNetBuy: number;
  individualNetBuy: number;
} | null> {
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return null;
  try {
    const data = await realDataKisGet(
      'FHKST03030100',
      '/uapi/domestic-stock/v1/quotations/inquire-investor',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: '0001',
      },
    );
    const out = (data as { output?: Record<string, string> } | null)?.output;
    if (!out) return null;
    return {
      foreignNetBuy:     Number(out.frgn_ntby_qty ?? out.FRGN_NETBUY_QTY ?? 0),
      institutionNetBuy: Number(out.orgn_ntby_qty ?? out.INST_NETBUY_QTY ?? 0),
      individualNetBuy:  Number(out.prsn_ntby_qty ?? out.INDV_NETBUY_QTY ?? 0),
    };
  } catch (e) {
    console.error('[KIS] 코스피 전체 수급 조회 실패:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function fetchCurrentPrice(code: string): Promise<number | null> {
  const overrides = getKisOverrides();
  if (overrides.fetchCurrentPrice) return overrides.fetchCurrentPrice(code);
  const data = await realDataKisGet('FHKST01010100', '/uapi/domestic-stock/v1/quotations/inquire-price', {
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_INPUT_ISCD: code,
  });
  const price = parseInt(data?.output?.stck_prpr ?? '0', 10);
  return price > 0 ? price : null;
}

// ─── 전일종가 조회 (preMarketGapProbe 전용) ────────────────────────────────────

/**
 * KIS FHKST01010100 (주식현재가 시세) 응답의 `stck_sdpr`(전일종가) +
 * `stck_prdy_ctrt` 와 함께 조회되는 영업일 메타(base date) 를 합쳐 전일종가를 반환한다.
 *
 * FHKST01010100 는 현재가·전일종가·등락률을 한 번에 내려주므로 일봉 API
 * (FHKST03010100) 를 추가로 호출하지 않고 단일 라운드트립에 전일종가를 얻는다.
 * 영업일 필드는 응답에 명시적으로 없으므로 오늘 KST 를 tradingDate 로 가정하지
 * 않고 `inquire-daily-itemchartprice` 1봉을 fallback 으로 사용해 정확한 KRX
 * 영업일을 파악한다 — FHKST01010100 만으로 채워지지 않는 staleness 판정의
 * 데이터 소스.
 *
 * 실패 시 (KIS 미설정 · 회로차단 · 응답 파싱 실패) null. 호출자는 반드시
 * null-safe 처리.
 */
export async function fetchKisPrevClose(stockCode: string): Promise<PrevClose | null> {
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return null;

  const code = stockCode.padStart(6, '0');
  const nowIso = new Date().toISOString();

  // 1차: 현재가 조회에서 전일종가(stck_sdpr) 추출 — 가장 가볍고 빠른 경로.
  try {
    const data = await realDataKisGet(
      'FHKST01010100',
      '/uapi/domestic-stock/v1/quotations/inquire-price',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: code,
      },
    );
    const out = (data as { output?: Record<string, string> } | null)?.output;
    const prevClose = parseInt(out?.stck_sdpr ?? '0', 10);
    if (prevClose > 0) {
      // FHKST01010100 응답은 영업일 필드를 직접 포함하지 않는다.
      // 최근 1봉 일봉 조회로 정확한 KRX 영업일을 얻는다 (실패 시 오늘 KST 로 폴백).
      const tradingDate = await _fetchLatestKrxBusinessDate(code) ?? _kstDateStr();
      return { stockCode: code, prevClose, tradingDate, fetchedAt: nowIso };
    }
  } catch (err) {
    console.warn(
      `[KIS] fetchKisPrevClose ${code} FHKST01010100 실패:`,
      err instanceof Error ? err.message : err,
    );
  }

  // 2차: 일봉(FHKST03010100) 최근 1봉 fallback.
  try {
    const today = _kstDateStr().replace(/-/g, '');
    const startYmd = _kstDateStrOffset(-10).replace(/-/g, ''); // 최근 10일 범위면 충분
    const data = await realDataKisGet(
      'FHKST03010100',
      '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: code,
        FID_INPUT_DATE_1: startYmd,
        FID_INPUT_DATE_2: today,
        FID_PERIOD_DIV_CODE: 'D',
        FID_ORG_ADJ_PRC: '0',
      },
    );
    const output2 = (data as { output2?: Record<string, string>[] } | null)?.output2;
    const latest = Array.isArray(output2) ? output2[0] : undefined;
    const close = parseInt(latest?.stck_clpr ?? '0', 10);
    const ymd = latest?.stck_bsop_date ?? '';
    if (close > 0 && /^\d{8}$/.test(ymd)) {
      const tradingDate = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
      return { stockCode: code, prevClose: close, tradingDate, fetchedAt: nowIso };
    }
  } catch (err) {
    console.warn(
      `[KIS] fetchKisPrevClose ${code} FHKST03010100 fallback 실패:`,
      err instanceof Error ? err.message : err,
    );
  }

  return null;
}

/** 오늘 KST 날짜 YYYY-MM-DD. */
function _kstDateStr(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 오늘 KST 기준 offsetDays 만큼 이동한 날짜 YYYY-MM-DD. offsetDays 는 음수 가능. */
function _kstDateStrOffset(offsetDays: number): string {
  const ms = Date.now() + 9 * 60 * 60 * 1000 + offsetDays * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * 최근 KRX 영업일을 일봉 API 최신 1봉의 `stck_bsop_date` 에서 가져온다.
 * 실패 시 null — 호출자가 오늘 KST 로 폴백.
 */
async function _fetchLatestKrxBusinessDate(code: string): Promise<string | null> {
  try {
    const today = _kstDateStr().replace(/-/g, '');
    const startYmd = _kstDateStrOffset(-10).replace(/-/g, '');
    const data = await realDataKisGet(
      'FHKST03010100',
      '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: code,
        FID_INPUT_DATE_1: startYmd,
        FID_INPUT_DATE_2: today,
        FID_PERIOD_DIV_CODE: 'D',
        FID_ORG_ADJ_PRC: '0',
      },
    );
    const output2 = (data as { output2?: Record<string, string>[] } | null)?.output2;
    const latest = Array.isArray(output2) ? output2[0] : undefined;
    const ymd = latest?.stck_bsop_date ?? '';
    if (/^\d{8}$/.test(ymd)) return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
    return null;
  } catch { return null; }
}

/**
 * KIS FHKST01010100 응답의 hts_kor_isnm 필드로 한국 종목명을 조회한다.
 * KIS 미설정 시 null 반환 — 호출자가 fallback 처리 필요.
 */
export async function fetchStockName(code: string): Promise<string | null> {
  const overrides = getKisOverrides();
  if (overrides.fetchStockName) return overrides.fetchStockName(code);
  try {
    const data = await realDataKisGet('FHKST01010100', '/uapi/domestic-stock/v1/quotations/inquire-price', {
      FID_COND_MRKT_DIV_CODE: 'J',
      FID_INPUT_ISCD: code.padStart(6, '0'),
    });
    const name = (data as { output?: Record<string, string> } | null)?.output?.hts_kor_isnm?.trim();
    return name && name.length > 0 ? name : null;
  } catch { return null; }
}
