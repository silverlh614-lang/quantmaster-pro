/**
 * @responsibility KIS 시세 조회 — 현재가·전일종가·종목명·투자자수급·시장수급
 *
 * ADR-0135 (PR-Refactor-3) — kisClient.ts 분해 시 도메인 조회 격리.
 * 모든 함수가 overrides.ts (VTS mock) 우선 + http.ts realDataKisGet 경유.
 */

import { HAS_REAL_DATA_CLIENT } from './constants.js';
import { realDataKisGet } from './http.js';
import { getKisOverrides } from './overrides.js';
import type {
  KisCreditBalanceRankingRow,
  KisDailyCreditBalance,
  KisDailyLoanTransaction,
  KisDailyShortSale,
  KisForeignInstitutionTotal,
  KisInvestorDailyByMarket,
  KisInvestorTimeByMarket,
  KisInvestorTradeByStockDaily,
  KisInvestorTrendEstimate,
  KisInvestorFlow,
  KisMarketProgramTrade,
  KisShortSaleRankingRow,
  KisStockProgramTrade,
  PrevClose,
} from './types.js';
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
const MARKET_PROGRAM_MARKET_CLASS_CODE = process.env.KIS_MARKET_PROGRAM_MARKET_CLASS_CODE ?? '1';
/**
 * ADR-0148: PR #564 적용 후 `ERROR INPUT FIELD NOT FOUND [FID_SCTN_CLS_CODE]` 확인.
 * section class code도 시장 프로그램매매 endpoint 필수 파라미터다.
 */
const MARKET_PROGRAM_SECTION_CLASS_CODE = process.env.KIS_MARKET_PROGRAM_SECTION_CLASS_CODE ?? '0';
/** PR-572: `/pmp`에서 `FID_INPUT_HOUR_1` 존재 시 MCA00000 accepted-empty 확인. */
const MARKET_PROGRAM_INPUT_HOUR_1 = process.env.KIS_MARKET_PROGRAM_INPUT_HOUR_1 ?? '000000';

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

function pickKisRows(data: unknown): KisOutput[] {
  const root = data as { output?: unknown; output1?: unknown; output2?: unknown } | null;
  const buckets = [root?.output, root?.output1, root?.output2];
  const rows: KisOutput[] = [];
  for (const bucket of buckets) {
    if (Array.isArray(bucket)) {
      rows.push(...bucket.filter((item): item is KisOutput => !!item && typeof item === 'object' && !Array.isArray(item)));
    } else if (bucket && typeof bucket === 'object') {
      rows.push(bucket as KisOutput);
    }
  }
  return rows;
}

function isAcceptedEmptyKisResponse(data: unknown): boolean {
  const root = data as { rt_cd?: unknown; msg_cd?: unknown; output?: unknown; output1?: unknown; output2?: unknown } | null;
  if (!root || typeof root !== 'object') return false;
  const accepted = String(root.rt_cd ?? '') === '0' && String(root.msg_cd ?? '') === 'MCA00000';
  if (!accepted) return false;
  const hasEmptyOutputArray = Array.isArray(root.output) && root.output.length === 0;
  const hasEmptyOutput1Array = Array.isArray(root.output1) && root.output1.length === 0;
  const hasEmptyOutput2Array = Array.isArray(root.output2) && root.output2.length === 0;
  const hasNoPickedOutput = !pickKisOutput(data);
  return hasNoPickedOutput && (hasEmptyOutputArray || hasEmptyOutput1Array || hasEmptyOutput2Array || !('output' in root));
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

function extractKisNumberOptional(out: Record<string, string> | undefined, keys: string[]): number | undefined {
  if (!out) return undefined;
  for (const k of keys) {
    const raw = out[k];
    if (raw === undefined || raw === null || raw === '') continue;
    const cleaned = String(raw).replace(/,/g, '').trim();
    if (cleaned === '') continue;
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function sumKisNumbersOptional(out: Record<string, string> | undefined, keys: string[]): number | undefined {
  if (!out) return undefined;
  let sum = 0;
  let found = false;
  for (const key of keys) {
    const value = extractKisNumberOptional(out, [key]);
    if (value === undefined) continue;
    sum += value;
    found = true;
  }
  return found ? sum : undefined;
}

function extractKisString(out: Record<string, string> | undefined, keys: string[]): string | undefined {
  if (!out) return undefined;
  for (const k of keys) {
    const raw = out[k];
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (value.length > 0) return value;
  }
  return undefined;
}

function formatKisYmd(ymd: string | undefined): string | undefined {
  if (!ymd || !/^\d{8}$/.test(ymd)) return undefined;
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function trendFromChange(change: number | undefined): 'INCREASING' | 'DECREASING' | 'FLAT' | 'UNKNOWN' {
  if (change === undefined || !Number.isFinite(change)) return 'UNKNOWN';
  if (change > 0) return 'INCREASING';
  if (change < 0) return 'DECREASING';
  return 'FLAT';
}

function percentChange(latest: number | undefined, previous: number | undefined): number | undefined {
  if (latest === undefined || previous === undefined || previous === 0) return undefined;
  if (!Number.isFinite(latest) || !Number.isFinite(previous)) return undefined;
  return ((latest - previous) / Math.abs(previous)) * 100;
}

function hasAnyFinite(...values: Array<number | undefined | null>): boolean {
  return values.some((value) => typeof value === 'number' && Number.isFinite(value));
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
 * - PR-575: `MCA00000 + output: []` 는 정상 데이터 0이 아니라 accepted-empty. null 반환.
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
        FID_COND_MRKT_DIV_CODE1: MARKET_PROGRAM_DIV_CODE,
        FID_MRKT_CLS_CODE: MARKET_PROGRAM_MARKET_CLASS_CODE,
        FID_SCTN_CLS_CODE: MARKET_PROGRAM_SECTION_CLASS_CODE,
        FID_INPUT_ISCD: MARKET_PROGRAM_INDEX_CODE,
        FID_INPUT_HOUR_1: MARKET_PROGRAM_INPUT_HOUR_1,
      },
      priority,
    );
    // [임시 진단 도구 — 5/4 영업일 검증 후 제거 예정]
    // 사용자 P1 #4 (DEBUG_PROGRAM_RAW ENV 우회) — 응답 필드 키 미스매치 vs 휴장일 효과 구분.
    // 정상 검증 후 별도 PR 로 본 블록 제거 의무.
    if (process.env.DEBUG_PROGRAM_RAW === 'true') {
      console.log('[DEBUG_PROGRAM_RAW] market', JSON.stringify(data));
    }

    if (isAcceptedEmptyKisResponse(data)) return null;

    const out = pickKisOutput(data);
    if (!out) return null;

    const programNetBuyQty = extractKisNumberOptional(
      out,
      ['whol_smtn_ntby_qty', 'prgm_ntby_qty', 'prgm_ntby_qty_2', 'PRGM_NTBY_QTY'],
    );
    const programNetBuyAmount = extractKisNumberOptional(
      out,
      ['whol_smtn_ntby_tr_pbmn', 'prgm_ntby_tr_pbmn', 'prgm_ntby_tr_pbmn_2', 'PRGM_NTBY_TR_PBMN'],
    );
    // 차익거래 부재 가능 — 강제 0 fallback 금지.
    const programArbitrageNetBuy = extractKisNumberOptional(
      out,
      ['arbt_smtn_ntby_tr_pbmn', 'arbt_ntby_tr_pbmn', 'ARBT_NTBY_TR_PBMN', 'arbt_ntby_tr_pbmn_2'],
    ) ?? null;
    const programNonArbitrageNetBuy = extractKisNumberOptional(
      out,
      ['nabt_smtn_ntby_tr_pbmn', 'nabt_ntby_tr_pbmn', 'NABT_NTBY_TR_PBMN'],
    ) ?? null;
    const programSellAmount = sumKisNumbersOptional(out, [
      'arbt_smtn_seln_tr_pbmn',
      'nabt_smtn_seln_tr_pbmn',
    ]) ?? null;
    const programBuyAmount = sumKisNumbersOptional(out, [
      'arbt_smtn_shnu_tr_pbmn',
      'nabt_smtn_shnu_tr_pbmn',
    ]) ?? null;

    return {
      programNetBuyQty: programNetBuyQty ?? null,
      programNetBuyAmount: programNetBuyAmount ?? null,
      programArbitrageNetBuy,
      programNonArbitrageNetBuy,
      programSellAmount,
      programBuyAmount,
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

// ─── KIS official supply pack sources: short sale, loan, credit, daily investor flow ───

export async function fetchKisDailyShortSale(
  code: string,
  priority: KisApiPriority = 'LOW',
): Promise<KisDailyShortSale | null> {
  const overrides = getKisOverrides();
  if (overrides.fetchKisDailyShortSale) return overrides.fetchKisDailyShortSale(code);
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return null;
  const safeCode = code.padStart(6, '0');
  try {
    const data = await realDataKisGet(
      'FHPST04830000',
      '/uapi/domestic-stock/v1/quotations/daily-short-sale',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: safeCode,
        FID_INPUT_DATE_1: _kstDateStrOffset(-21).replace(/-/g, ''),
        FID_INPUT_DATE_2: _kstDateStr().replace(/-/g, ''),
      },
      priority,
    );
    if (isAcceptedEmptyKisResponse(data)) return null;
    const rows = pickKisRows(data);
    const latest = rows[0];
    if (!latest) return null;
    const previous = rows[1];
    const shortSaleQty = extractKisNumberOptional(latest, ['ssts_cntg_qty', 'SSTS_CNTG_QTY']);
    const shortSaleAmount = extractKisNumberOptional(latest, ['ssts_tr_pbmn', 'SSTS_TR_PBMN']);
    const shortSaleRatio = extractKisNumberOptional(latest, ['ssts_tr_pbmn_rlim', 'ssts_vol_rlim', 'SSTS_TR_PBMN_RLIM']);
    const previousAmount = extractKisNumberOptional(previous, ['ssts_tr_pbmn', 'SSTS_TR_PBMN']);
    const previousQty = extractKisNumberOptional(previous, ['ssts_cntg_qty', 'SSTS_CNTG_QTY']);
    const shortSaleIncreaseRate = percentChange(shortSaleAmount ?? shortSaleQty, previousAmount ?? previousQty);
    if (!hasAnyFinite(shortSaleQty, shortSaleAmount, shortSaleRatio, shortSaleIncreaseRate)) return null;
    return {
      stockCode: safeCode,
      tradingDate: formatKisYmd(extractKisString(latest, ['stck_bsop_date', 'STCK_BSOP_DATE'])),
      ...(shortSaleQty !== undefined ? { shortSaleQty } : {}),
      ...(shortSaleAmount !== undefined ? { shortSaleAmount } : {}),
      ...(shortSaleRatio !== undefined ? { shortSaleRatio } : {}),
      ...(shortSaleIncreaseRate !== undefined ? { shortSaleIncreaseRate } : {}),
      trend: trendFromChange(shortSaleIncreaseRate),
      source: 'KIS_API',
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    console.error('[KIS] 공매도 일별 추이 조회 실패:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function fetchKisShortSaleRanking(
  priority: KisApiPriority = 'LOW',
): Promise<KisShortSaleRankingRow[] | null> {
  const overrides = getKisOverrides();
  if (overrides.fetchKisShortSaleRanking) return overrides.fetchKisShortSaleRanking();
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return null;
  try {
    const data = await realDataKisGet(
      'FHPST04820000',
      '/uapi/domestic-stock/v1/ranking/short-sale',
      {
        FID_APLY_RANG_VOL: '1000',
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_COND_SCR_DIV_CODE: '20482',
        FID_INPUT_ISCD: '0000',
        FID_PERIOD_DIV_CODE: 'D',
        FID_INPUT_CNT_1: '9',
        FID_TRGT_EXLS_CLS_CODE: '',
        FID_TRGT_CLS_CODE: '',
        FID_APLY_RANG_PRC_1: '',
        FID_APLY_RANG_PRC_2: '',
      },
      priority,
    );
    if (isAcceptedEmptyKisResponse(data)) return null;
    const rows = pickKisRows(data).map((row, idx): KisShortSaleRankingRow => ({
      stockCode: extractKisString(row, ['mksc_shrn_iscd', 'stck_shrn_iscd', 'pdno']),
      stockName: extractKisString(row, ['hts_kor_isnm', 'prdt_name', 'stck_kor_isnm']),
      shortSaleQty: extractKisNumberOptional(row, ['ssts_cntg_qty', 'stnd_shrt_wght', 'ssts_cntg_qty_2']),
      shortSaleAmount: extractKisNumberOptional(row, ['ssts_tr_pbmn', 'ssts_tr_pbmn_2']),
      shortSaleRatio: extractKisNumberOptional(row, ['ssts_tr_pbmn_rlim', 'ssts_vol_rlim']),
      rank: extractKisNumberOptional(row, ['data_rank', 'rank']) ?? idx + 1,
      source: 'KIS_API',
    }));
    return rows.length > 0 ? rows : null;
  } catch (e) {
    console.error('[KIS] 공매도 상위 조회 실패:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function fetchKisDailyLoanTransaction(
  code: string,
  priority: KisApiPriority = 'LOW',
): Promise<KisDailyLoanTransaction | null> {
  const overrides = getKisOverrides();
  if (overrides.fetchKisDailyLoanTransaction) return overrides.fetchKisDailyLoanTransaction(code);
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return null;
  const safeCode = code.padStart(6, '0');
  try {
    const data = await realDataKisGet(
      'HHPST074500C0',
      '/uapi/domestic-stock/v1/quotations/daily-loan-trans',
      {
        MRKT_DIV_CLS_CODE: '3',
        MKSC_SHRN_ISCD: safeCode,
        START_DATE: _kstDateStrOffset(-21).replace(/-/g, ''),
        END_DATE: _kstDateStr().replace(/-/g, ''),
        CTS: '',
      },
      priority,
    );
    if (isAcceptedEmptyKisResponse(data)) return null;
    const rows = pickKisRows(data);
    const latest = rows[0];
    if (!latest) return null;
    const previous = rows[1];
    const loanBalanceQty = extractKisNumberOptional(latest, ['rmnd_stcn', 'RMND_STCN']);
    const loanBalanceAmount = extractKisNumberOptional(latest, ['rmnd_amt', 'RMND_AMT']);
    const dailyChange = extractKisNumberOptional(latest, ['prdy_rmnd_vrss', 'PRDY_RMND_VRSS']);
    const previousQty = extractKisNumberOptional(previous, ['rmnd_stcn', 'RMND_STCN']);
    const loanIncreaseRate = percentChange(loanBalanceQty, previousQty)
      ?? (dailyChange !== undefined && loanBalanceQty !== undefined && loanBalanceQty !== dailyChange
        ? percentChange(loanBalanceQty, loanBalanceQty - dailyChange)
        : undefined);
    if (!hasAnyFinite(loanBalanceQty, loanBalanceAmount, loanIncreaseRate)) return null;
    return {
      stockCode: safeCode,
      tradingDate: formatKisYmd(extractKisString(latest, ['bsop_date', 'BSOP_DATE'])),
      ...(loanBalanceQty !== undefined ? { loanBalanceQty } : {}),
      ...(loanBalanceAmount !== undefined ? { loanBalanceAmount } : {}),
      ...(loanIncreaseRate !== undefined ? { loanIncreaseRate } : {}),
      trend: trendFromChange(loanIncreaseRate ?? dailyChange),
      source: 'KIS_API',
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    console.error('[KIS] 대차거래 일별 추이 조회 실패:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function fetchKisDailyCreditBalance(
  code: string,
  priority: KisApiPriority = 'LOW',
): Promise<KisDailyCreditBalance | null> {
  const overrides = getKisOverrides();
  if (overrides.fetchKisDailyCreditBalance) return overrides.fetchKisDailyCreditBalance(code);
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return null;
  const safeCode = code.padStart(6, '0');
  try {
    const data = await realDataKisGet(
      'FHPST04760000',
      '/uapi/domestic-stock/v1/quotations/daily-credit-balance',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_COND_SCR_DIV_CODE: '20476',
        FID_INPUT_ISCD: safeCode,
        FID_INPUT_DATE_1: _kstDateStr().replace(/-/g, ''),
      },
      priority,
    );
    if (isAcceptedEmptyKisResponse(data)) return null;
    const rows = pickKisRows(data);
    const latest = rows[0];
    if (!latest) return null;
    const previous = rows[1];
    const creditBalanceQty = extractKisNumberOptional(latest, ['whol_loan_rmnd_stcn', 'WHOL_LOAN_RMND_STCN']);
    const creditBalanceAmount = extractKisNumberOptional(latest, ['whol_loan_rmnd_amt', 'WHOL_LOAN_RMND_AMT']);
    const creditBalanceRatio = extractKisNumberOptional(latest, ['whol_loan_rmnd_rate', 'WHOL_LOAN_RMND_RATE']);
    const previousQty = extractKisNumberOptional(previous, ['whol_loan_rmnd_stcn', 'WHOL_LOAN_RMND_STCN']);
    const creditIncreaseRate = percentChange(creditBalanceQty, previousQty);
    if (!hasAnyFinite(creditBalanceQty, creditBalanceAmount, creditBalanceRatio, creditIncreaseRate)) return null;
    return {
      stockCode: safeCode,
      tradingDate: formatKisYmd(extractKisString(latest, ['deal_date', 'stlm_date', 'DEAL_DATE'])),
      ...(creditBalanceQty !== undefined ? { creditBalanceQty } : {}),
      ...(creditBalanceAmount !== undefined ? { creditBalanceAmount } : {}),
      ...(creditBalanceRatio !== undefined ? { creditBalanceRatio } : {}),
      ...(creditIncreaseRate !== undefined ? { creditIncreaseRate } : {}),
      trend: trendFromChange(creditIncreaseRate),
      source: 'KIS_API',
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    console.error('[KIS] 신용잔고 일별 추이 조회 실패:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function fetchKisCreditBalanceRanking(
  priority: KisApiPriority = 'LOW',
): Promise<KisCreditBalanceRankingRow[] | null> {
  const overrides = getKisOverrides();
  if (overrides.fetchKisCreditBalanceRanking) return overrides.fetchKisCreditBalanceRanking();
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return null;
  try {
    const data = await realDataKisGet(
      'FHKST17010000',
      '/uapi/domestic-stock/v1/ranking/credit-balance',
      {
        FID_COND_SCR_DIV_CODE: '11701',
        FID_INPUT_ISCD: '0000',
        FID_OPTION: '30',
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_RANK_SORT_CLS_CODE: '3',
      },
      priority,
    );
    if (isAcceptedEmptyKisResponse(data)) return null;
    const rows = pickKisRows(data).map((row, idx): KisCreditBalanceRankingRow => ({
      stockCode: extractKisString(row, ['mksc_shrn_iscd', 'stck_shrn_iscd', 'pdno']),
      stockName: extractKisString(row, ['hts_kor_isnm', 'prdt_name', 'stck_kor_isnm']),
      creditBalanceQty: extractKisNumberOptional(row, ['whol_loan_rmnd_stcn', 'loan_rmnd_stcn']),
      creditBalanceAmount: extractKisNumberOptional(row, ['whol_loan_rmnd_amt', 'loan_rmnd_amt']),
      creditIncreaseRate: extractKisNumberOptional(row, ['whol_loan_rmnd_rate', 'loan_rmnd_rate', 'prdy_vrss_sign_rate']),
      rank: extractKisNumberOptional(row, ['data_rank', 'rank']) ?? idx + 1,
      source: 'KIS_API',
    }));
    return rows.length > 0 ? rows : null;
  } catch (e) {
    console.error('[KIS] 신용잔고 상위 조회 실패:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function fetchKisInvestorTradeByStockDaily(
  code: string,
  priority: KisApiPriority = 'LOW',
): Promise<KisInvestorTradeByStockDaily | null> {
  const overrides = getKisOverrides();
  if (overrides.fetchKisInvestorTradeByStockDaily) return overrides.fetchKisInvestorTradeByStockDaily(code);
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return null;
  const safeCode = code.padStart(6, '0');
  try {
    const data = await realDataKisGet(
      'FHPTJ04160001',
      '/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: safeCode,
        FID_INPUT_DATE_1: _kstDateStr().replace(/-/g, ''),
        FID_ORG_ADJ_PRC: '',
        FID_ETC_CLS_CODE: '',
      },
      priority,
    );
    if (isAcceptedEmptyKisResponse(data)) return null;
    const row = pickKisRows(data)[0];
    if (!row) return null;
    const foreignNetBuy = extractKisNumberOptional(row, ['frgn_ntby_qty', 'FRGN_NTBY_QTY']);
    const institutionalNetBuy = extractKisNumberOptional(row, ['orgn_ntby_qty', 'ORGN_NTBY_QTY']);
    const individualNetBuy = extractKisNumberOptional(row, ['prsn_ntby_qty', 'PRSN_NTBY_QTY']);
    if (!hasAnyFinite(foreignNetBuy, institutionalNetBuy, individualNetBuy)) return null;
    return {
      stockCode: safeCode,
      tradingDate: formatKisYmd(extractKisString(row, ['stck_bsop_date', 'STCK_BSOP_DATE'])),
      ...(foreignNetBuy !== undefined ? { foreignNetBuy } : {}),
      ...(institutionalNetBuy !== undefined ? { institutionalNetBuy } : {}),
      ...(individualNetBuy !== undefined ? { individualNetBuy } : {}),
      source: 'KIS_API',
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    console.error('[KIS] 종목별 투자자매매동향 일별 조회 실패:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function fetchKisForeignInstitutionTotal(
  priority: KisApiPriority = 'LOW',
): Promise<KisForeignInstitutionTotal | null> {
  const overrides = getKisOverrides();
  if (overrides.fetchKisForeignInstitutionTotal) return overrides.fetchKisForeignInstitutionTotal();
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return null;
  try {
    const data = await realDataKisGet(
      'FHPTJ04400000',
      '/uapi/domestic-stock/v1/quotations/foreign-institution-total',
      {
        FID_COND_MRKT_DIV_CODE: 'V',
        FID_COND_SCR_DIV_CODE: '16449',
        FID_INPUT_ISCD: '0000',
        FID_DIV_CLS_CODE: '1',
        FID_RANK_SORT_CLS_CODE: '0',
        FID_ETC_CLS_CODE: '0',
      },
      priority,
    );
    if (isAcceptedEmptyKisResponse(data)) return null;
    const row = pickKisRows(data)[0];
    const foreignNetBuy = extractKisNumberOptional(row, ['frgn_ntby_tr_pbmn', 'frgn_ntby_qty', 'FRGN_NTBY_QTY']);
    const institutionalNetBuy = extractKisNumberOptional(row, ['orgn_ntby_tr_pbmn', 'orgn_ntby_qty', 'ORGN_NTBY_QTY']);
    if (!hasAnyFinite(foreignNetBuy, institutionalNetBuy)) return null;
    return {
      ...(foreignNetBuy !== undefined ? { foreignNetBuy } : {}),
      ...(institutionalNetBuy !== undefined ? { institutionalNetBuy } : {}),
      source: 'KIS_API',
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    console.error('[KIS] 외국인/기관 매매종목 가집계 조회 실패:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function fetchKisInvestorTrendEstimate(
  code: string,
  priority: KisApiPriority = 'LOW',
): Promise<KisInvestorTrendEstimate | null> {
  const overrides = getKisOverrides();
  if (overrides.fetchKisInvestorTrendEstimate) return overrides.fetchKisInvestorTrendEstimate(code);
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return null;
  const safeCode = code.padStart(6, '0');
  try {
    const data = await realDataKisGet(
      'HHPTJ04160200',
      '/uapi/domestic-stock/v1/quotations/investor-trend-estimate',
      { MKSC_SHRN_ISCD: safeCode },
      priority,
    );
    if (isAcceptedEmptyKisResponse(data)) return null;
    const row = pickKisRows(data)[0];
    const foreignNetBuyEstimate = extractKisNumberOptional(row, ['frgn_ntby_qty', 'frgn_ntby_tr_pbmn']);
    const institutionalNetBuyEstimate = extractKisNumberOptional(row, ['orgn_ntby_qty', 'orgn_ntby_tr_pbmn']);
    const individualNetBuyEstimate = extractKisNumberOptional(row, ['prsn_ntby_qty', 'prsn_ntby_tr_pbmn']);
    if (!hasAnyFinite(foreignNetBuyEstimate, institutionalNetBuyEstimate, individualNetBuyEstimate)) return null;
    return {
      stockCode: safeCode,
      ...(foreignNetBuyEstimate !== undefined ? { foreignNetBuyEstimate } : {}),
      ...(institutionalNetBuyEstimate !== undefined ? { institutionalNetBuyEstimate } : {}),
      ...(individualNetBuyEstimate !== undefined ? { individualNetBuyEstimate } : {}),
      source: 'KIS_API',
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    console.error('[KIS] 외인기관 추정 가집계 조회 실패:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function fetchKisInvestorDailyByMarket(
  priority: KisApiPriority = 'LOW',
): Promise<KisInvestorDailyByMarket | null> {
  const overrides = getKisOverrides();
  if (overrides.fetchKisInvestorDailyByMarket) return overrides.fetchKisInvestorDailyByMarket();
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return null;
  const ymd = _kstDateStr().replace(/-/g, '');
  try {
    const data = await realDataKisGet(
      'FHPTJ04040000',
      '/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market',
      {
        FID_COND_MRKT_DIV_CODE: 'U',
        FID_INPUT_ISCD: '0001',
        FID_INPUT_DATE_1: ymd,
        FID_INPUT_ISCD_1: 'KSP',
        FID_INPUT_DATE_2: ymd,
        FID_INPUT_ISCD_2: '0001',
      },
      priority,
    );
    if (isAcceptedEmptyKisResponse(data)) return null;
    const row = pickKisRows(data)[0];
    const foreignNetBuy = extractKisNumberOptional(row, ['frgn_ntby_qty', 'frgn_ntby_tr_pbmn']);
    const institutionNetBuy = extractKisNumberOptional(row, ['orgn_ntby_qty', 'orgn_ntby_tr_pbmn']);
    const individualNetBuy = extractKisNumberOptional(row, ['prsn_ntby_qty', 'prsn_ntby_tr_pbmn']);
    if (!hasAnyFinite(foreignNetBuy, institutionNetBuy, individualNetBuy)) return null;
    return {
      tradingDate: formatKisYmd(extractKisString(row, ['stck_bsop_date', 'bsop_date'])) ?? _kstDateStr(),
      ...(foreignNetBuy !== undefined ? { foreignNetBuy } : {}),
      ...(institutionNetBuy !== undefined ? { institutionNetBuy } : {}),
      ...(individualNetBuy !== undefined ? { individualNetBuy } : {}),
      source: 'KIS_API',
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    console.error('[KIS] 시장별 투자자매매동향 일별 조회 실패:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function fetchKisInvestorTimeByMarket(
  priority: KisApiPriority = 'LOW',
): Promise<KisInvestorTimeByMarket | null> {
  const overrides = getKisOverrides();
  if (overrides.fetchKisInvestorTimeByMarket) return overrides.fetchKisInvestorTimeByMarket();
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return null;
  try {
    const data = await realDataKisGet(
      'FHPTJ04030000',
      '/uapi/domestic-stock/v1/quotations/inquire-investor-time-by-market',
      {
        FID_INPUT_ISCD: '999',
        FID_INPUT_ISCD_2: 'S001',
      },
      priority,
    );
    if (isAcceptedEmptyKisResponse(data)) return null;
    const row = pickKisRows(data)[0];
    const foreignNetBuy = extractKisNumberOptional(row, ['frgn_ntby_qty', 'frgn_ntby_tr_pbmn']);
    const institutionNetBuy = extractKisNumberOptional(row, ['orgn_ntby_qty', 'orgn_ntby_tr_pbmn']);
    const individualNetBuy = extractKisNumberOptional(row, ['prsn_ntby_qty', 'prsn_ntby_tr_pbmn']);
    if (!hasAnyFinite(foreignNetBuy, institutionNetBuy, individualNetBuy)) return null;
    return {
      ...(foreignNetBuy !== undefined ? { foreignNetBuy } : {}),
      ...(institutionNetBuy !== undefined ? { institutionNetBuy } : {}),
      ...(individualNetBuy !== undefined ? { individualNetBuy } : {}),
      source: 'KIS_API',
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    console.error('[KIS] 시장별 투자자매매동향 시세 조회 실패:', e instanceof Error ? e.message : e);
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
      // ADR-0188 (lint baseline cleanup): `prevClose` shorthand 결함 수리 — `close` 변수가
      // 일봉 종가지만 본 함수는 *전일 종가* 반환이라 `prevClose: close` 명시 매핑.
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
