/**
 * @responsibility KIS 시세 조회 — 현재가·전일종가·종목명·투자자수급·시장수급
 *
 * ADR-0135 (PR-Refactor-3) — kisClient.ts 분해 시 도메인 조회 격리.
 * 모든 함수가 overrides.ts (VTS mock) 우선 + http.ts realDataKisGet 경유.
 */

import { HAS_REAL_DATA_CLIENT } from './constants.js';
import { realDataKisGet } from './http.js';
import { getKisOverrides } from './overrides.js';
import type { KisInvestorFlow, KisMarketProgramTrade, KisStockProgramTrade, PrevClose } from './types.js';
import type { KisApiPriority } from '../kisRateLimiter.js';

// ─── ADR-0137 (정정 ADR-0144): 종목별 프로그램 매매 (체결) ────────────────────
// 사용자 12 아이디어 #3 — 페르소나 자료 #6 "외국인 프로그램/비프로그램" 시그널의
// 데이터 입력.
//
// KIS 공식 GitHub 검증 (`koreainvestment/open-trading-api`, 2026-05-01):
//   - examples_llm/domestic_stock/program_trade_by_stock/program_trade_by_stock.py
//   - 카테고리: [v1_국내주식-044]  HTS 화면: [0465]
//
// 직전 추정값(`comp-program-trade-today` + `FHPPG04650201`)은 *시장 시간 path* 와
// *종목 일별 tr_id* 를 보내던 교차 미스매치 → 200 OK + 빈 output → 카드 0/10.

/** ADR-0144: KIS program-trade-by-stock TR ID + path — 둘 다 ENV 우회 가능. */
const STOCK_PROGRAM_TRADE_TR_ID = process.env.KIS_STOCK_PROGRAM_TRADE_TR_ID ?? 'FHPPG04650101';
const STOCK_PROGRAM_TRADE_PATH =
  process.env.KIS_STOCK_PROGRAM_TRADE_PATH
  ?? '/uapi/domestic-stock/v1/quotations/program-trade-by-stock';

/**
 * ADR-0146: comp-program-trade-today 의 시장구분코드는 `U` 가 아니라 국내주식 공통값 `J`.
 * `/sh` rawDiag 에서 `msg_cd=OPSQ2001 ERROR INVALID FID_COND_MRKT_DIV_CODE` 로 확인됨.
 */
const MARKET_PROGRAM_DIV_CODE = process.env.KIS_MARKET_PROGRAM_DIV_CODE ?? 'J';
const MARKET_PROGRAM_INDEX_CODE = process.env.KIS_MARKET_PROGRAM_INDEX_CODE ?? '0001';
/**
 * ADR-0147: PR #562 적용 후 `ERROR INPUT FIELD NOT FOUND [FID_MRKT_CLS_CODE]` 확인.
 * 시장 프로그램매매 endpoint 는 시장 분류 필드가 필수다. KIS 값이 계정/문서 버전에 따라
 * 다를 수 있어 ENV 로 즉시 우회 가능하게 둔다.
 */
const MARKET_PROGRAM_MARKET_CLASS_CODE = process.env.KIS_MARKET_PROGRAM_MARKET_CLASS_CODE ?? 'KOSPI';

type KisOutput = Record<string, string>;

/**
 * KIS는 동일 TR에서도 output 객체, output 배열, output1 객체, output2 배열을 섞어 반환한다.
 * PR-557: 수급 endpoint가 `output: array(30)` 으로 내려오면서 기존 object-only 파서가
 * 전부 0 fallback 처리하던 문제를 해결한다.
 */
function pickKisOutput(data: unknown): KisOutput | undefined {
  const root = data as { output?: unknown; output1?: unknown; output2?: unknown } | null;
  if (root?.output && typeof root.output === 'object' && !Array.isArray(root.output)) {
    return root.output as KisOutput;
  }
  if (Array.isArray(root?.output) && root.output.length > 0 && typeof root.output[0] === 'object') {
    return root.output[0] as KisOutput;
  }
  if (root?.output1 && typeof root.output1 === 'object' && !Array.isArray(root.output1)) {
    return root.output1 as KisOutput;
  }
  if (Array.isArray(root?.output1) && root.output1.length > 0 && typeof root.output1[0] === 'object') {
    return root.output1[0] as KisOutput;
  }
  if (Array.isArray(root?.output2) && root.output2.length > 0 && typeof root.output2[0] === 'object') {
    return root.output2[0] as KisOutput;
  }
  return undefined;
}

/**
 * KIS 응답 output 의 한글 약어 필드에서 첫 번째 매칭 값을 추출.
 * 미발견/파싱 실패 시 fallback (default 0).
 */
function extractKisNumber(out: Record<string, string> | undefined, keys: string[], fallback = 0): number {
  if (!out) return fallback;
  for (const k of keys) {
    const raw = out[k];
    if (raw === undefined || raw === null || raw === '') continue;
    const cleaned = String(raw).replace(/,/g, '').trim();
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/**
 * ADR-0137 — KIS comp-program-trade-today 종목별 당일 프로그램 매매 조회.
 *
 * - KIS_APP_KEY 미설정 + 실계좌 클라이언트 부재 → null (안전 fallback).
 * - realDataKisGet SSOT 경유 — 회로차단/블랙리스트/jitter 자동 적용 (절대 규칙 #2).
 * - output 필드명 한글 약어 + 영문 약어 대체값 모두 시도 (KIS 응답 변동 안전).
 * - programBuyRatio 부재 시 null (강제 0 fallback 차단 — 의미 단절 방지).
 *
 * @param code 종목코드 (6자리 zero-padded 자동 적용)
 */
export async function fetchKisStockProgramTrade(
  code: string,
  priority: KisApiPriority = 'LOW',
): Promise<KisStockProgramTrade | null> {
  const overrides = getKisOverrides();
  if (overrides.fetchKisStockProgramTrade) return overrides.fetchKisStockProgramTrade(code);
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return null;
  try {
    const data = await realDataKisGet(
      STOCK_PROGRAM_TRADE_TR_ID,
      STOCK_PROGRAM_TRADE_PATH,
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: code.padStart(6, '0'),
      },
      priority,
    );
    // [임시 진단 도구 — 5/4 영업일 검증 후 제거 예정]
    // 사용자 P1 #4 (DEBUG_PROGRAM_RAW ENV 우회) — 응답 필드 키 미스매치 vs 휴장일 효과 구분.
    // 정상 검증 후 별도 PR 로 본 블록 제거 의무.
    if (process.env.DEBUG_PROGRAM_RAW === 'true') {
      console.log('[DEBUG_PROGRAM_RAW] stock', code, JSON.stringify(data));
    }
    const out = pickKisOutput(data);
    if (!out) return null;

    // ADR-0144: KIS 공식 chk_program_trade_by_stock.py COLUMN_MAPPING 정합 — `whol_smtn_*`
    // (전체 합계 순매수) 가 1차 키. 구 endpoint(`prgm_ntby_*`) 는 fallback 으로 보존.
    const programNetBuyQty = extractKisNumber(
      out,
      ['whol_smtn_ntby_qty', 'prgm_ntby_qty', 'PRGM_NTBY_QTY'],
    );
    const programNetBuyAmount = extractKisNumber(
      out,
      ['whol_smtn_ntby_tr_pbmn', 'prgm_ntby_tr_pbmn', 'PRGM_NTBY_TR_PBMN'],
    );
    // 비중 필드는 부재 가능 — 강제 0 fallback 금지 (ADR-0136 의미 단절 차단).
    const ratioRaw = out.prgm_byov_rate ?? out.PRGM_BYOV_RATE ?? '';
    const ratioNum = ratioRaw === '' ? Number.NaN : Number(String(ratioRaw).replace(/,/g, ''));
    const programBuyRatio = Number.isFinite(ratioNum) ? ratioNum : null;

    return {
      stockCode: code.padStart(6, '0'),
      programNetBuyQty,
      programNetBuyAmount,
      programBuyRatio,
      fetchedAt: new Date().toISOString(),
      source: 'KIS_API',
    };
  } catch (e) {
    console.error(
      `[KIS] 종목별 프로그램 매매 조회 실패 (${code}):`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

// ─── ADR-0138 (정정 ADR-0144): 시장 종합 프로그램 매매 추이 ───────────────────
// 사용자 12 아이디어 #4 — 시장 단위 프로그램 자금 흐름 (코스피 전체).
// ADR-0137 종목별 데이터와 *별도* — 시장 방향성 신호 (regime 가중치 입력).
//
// KIS 공식 검증: `FHPPG04600101` = 프로그램매매 종합현황(시간) → `comp-program-trade-today`
// 직전 코드: tr_id=FHPPG04600101 (시간) + path=...-daily (일별) 교차 미스매치.
// 일별이 필요한 경우: tr_id=FHPPG04600001 + path=...-daily (별도 ENV 로 전환).

const MARKET_PROGRAM_TRADE_TR_ID = process.env.KIS_MARKET_PROGRAM_TRADE_TR_ID ?? 'FHPPG04600101';
const MARKET_PROGRAM_TRADE_PATH =
  process.env.KIS_MARKET_PROGRAM_TRADE_PATH
  ?? '/uapi/domestic-stock/v1/quotations/comp-program-trade-today';

/**
 * ADR-0138 — KIS 시장 종합 프로그램 매매 추이 조회 (코스피 시장 단위).
 *
 * - KIS_APP_KEY 미설정 + 실계좌 클라이언트 부재 → null (안전 fallback).
 * - realDataKisGet SSOT 경유 — 회로차단/블랙리스트/jitter 자동 적용 (절대 규칙 #2).
 * - output 필드 다중 키 매칭 — 한글 약어 + 영문 약어 + `_2` 변형 (ADR-0137 패턴).
 * - programArbitrageNetBuy 부재 시 null (강제 0 fallback 차단 — ADR-0136 의미 단절 정책).
 * - 일별 데이터 — output 배열 첫 요소 (당일) 또는 단일 output 객체 모두 지원.
 */
export async function fetchKisMarketProgramTrade(
  priority: KisApiPriority = 'LOW',
): Promise<KisMarketProgramTrade | null> {
  const overrides = getKisOverrides();
  if (overrides.fetchKisMarketProgramTrade) return overrides.fetchKisMarketProgramTrade();
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return null;
  try {
    const data = await realDataKisGet(
      MARKET_PROGRAM_TRADE_TR_ID,
      MARKET_PROGRAM_TRADE_PATH,
      {
        FID_COND_MRKT_DIV_CODE: MARKET_PROGRAM_DIV_CODE,
        FID_MRKT_CLS_CODE: MARKET_PROGRAM_MARKET_CLASS_CODE,
        FID_INPUT_ISCD: MARKET_PROGRAM_INDEX_CODE,
      },
      priority,
    );
    // [임시 진단 도구 — 5/4 영업일 검증 후 제거 예정]
    // 사용자 P1 #4 (DEBUG_PROGRAM_RAW ENV 우회) — 응답 필드 키 미스매치 vs 휴장일 효과 구분.
    // 정상 검증 후 별도 PR 로 본 블록 제거 의무.
    if (process.env.DEBUG_PROGRAM_RAW === 'true') {
      console.log('[DEBUG_PROGRAM_RAW] market', JSON.stringify(data));
    }

    const out = pickKisOutput(data);
    if (!out) return null;

    const programNetBuyQty = extractKisNumber(
      out,
      ['prgm_ntby_qty', 'prgm_ntby_qty_2', 'PRGM_NTBY_QTY'],
    );
    const programNetBuyAmount = extractKisNumber(
      out,
      ['prgm_ntby_tr_pbmn', 'prgm_ntby_tr_pbmn_2', 'PRGM_NTBY_TR_PBMN'],
    );
    // 차익거래 부재 가능 — 강제 0 fallback 금지.
    const arbitrageRaw =
      out.arbt_ntby_tr_pbmn
      ?? out.ARBT_NTBY_TR_PBMN
      ?? out.arbt_ntby_tr_pbmn_2
      ?? '';
    const arbNum = arbitrageRaw === '' ? Number.NaN : Number(String(arbitrageRaw).replace(/,/g, ''));
    const programArbitrageNetBuy = Number.isFinite(arbNum) ? arbNum : null;

    return {
      programNetBuyQty,
      programNetBuyAmount,
      programArbitrageNetBuy,
      fetchedAt: new Date().toISOString(),
      source: 'KIS_API',
    };
  } catch (e) {
    console.error(
      '[KIS] 시장 종합 프로그램 매매 조회 실패:',
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

// ─── 종목별 투자자 수급 조회 ─────────────────────────────────────────────────

/**
 * FHKST01010300 — 주식현재가 투자자별 순매수 조회.
 * KIS_APP_KEY 미설정 시 null 반환. 실계좌/VTS 모두 지원.
 */
export async function fetchKisInvestorFlow(
  code: string,
  priority: KisApiPriority = 'LOW',
): Promise<KisInvestorFlow | null> {
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
      priority,
    );
    const out = pickKisOutput(data);
    if (!out) return null;
    return {
      foreignNetBuy:       extractKisNumber(out, ['frgn_ntby_qty', 'FRGN_NETBUY_QTY']),
      institutionalNetBuy: extractKisNumber(out, ['orgn_ntby_qty', 'INST_NETBUY_QTY']),
      individualNetBuy:    extractKisNumber(out, ['prsn_ntby_qty', 'INDV_NETBUY_QTY']),
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
    const out = pickKisOutput(data);
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
      return { stockCode: code, prevClose, tradingDate, fetchedAt: nowIso };
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
