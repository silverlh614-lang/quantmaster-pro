// @responsibility Patch-006 KRX market program-trade fetcher SSOT — KIS empty fallback layer.

// =====================================================================
// Patch-MARKET-PROGRAM-TRADING-FALLBACK-RECOVERY-006 SSOT
//
// 사용자 직접 요청: route=KIS>KRX 가 표시되면 *반드시* KRX fallback 호출.
// Patch-004 (PR #941) 가 capability 만 선언했고 실제 fetch 0건 → fallback=NOT_TRIED 결함.
//
// 본 SSOT 는 KRX 시장 프로그램매매 추이 endpoint 호출 + KOSPI/KOSDAQ aggregation +
// session detection (intraday/after-hours) + ENV-overridable BLD ID + graceful degradation.
//
// 절대 변경 금지 (사용자 §11):
//   • LIVE 매매 본체 0줄 변경
//   • KIS 주문 함수 5종 import 0건
//   • 외부 API 호출은 본 SSOT 의 krxPost 단일 통로 (절대 규칙 #2 정합)
//   • providerIssue / marketSignal 변환 0 (provider 다운 != bearish)
//   • emergencyStop / SELL_ONLY / SHADOW_ONLY 자동 전환 0
// =====================================================================

import { krxPost } from './http.js';

/** 사용자 §5: marketCode mapping table SSOT (절대 변경 금지). */
export const KRX_MARKET_PROGRAM_CODE_MAP = Object.freeze({
  KOSPI: 'STK',
  KOSDAQ: 'KSQ',
  ALL: 'ALL',
} as const);

export type KrxMarketProgramCode = keyof typeof KRX_MARKET_PROGRAM_CODE_MAP;

/** ENV-overridable KRX BLD ID + path — 운영 환경 첫 호출 시 검증 + 즉시 override 가능. */
export const KRX_BLD_MARKET_PROGRAM_TRADE =
  process.env.KRX_BLD_MARKET_PROGRAM_TRADE ?? 'dbms/MDC/STAT/standard/MDCSTAT01701';

/** 사용자 §6: KRX 시장 프로그램매매 단일 row 결과. */
export interface KrxMarketProgramRow {
  market: KrxMarketProgramCode;
  programNetBuyAmount: number | null; // 억원
  programBuyAmount: number | null;
  programSellAmount: number | null;
  arbitrageNetBuy: number | null;
  nonArbitrageNetBuy: number | null;
  rawDate?: string;
}

/** 사용자 §6: aggregate (KOSPI + KOSDAQ 병합) 결과. */
export interface KrxMarketProgramAggregate {
  kospi: KrxMarketProgramRow | null;
  kosdaq: KrxMarketProgramRow | null;
  totalProgramNet: number | null; // 억원 합산
  arbitrageNet: number | null;
  nonArbitrageNet: number | null;
  timestamp: string; // ISO
  confidence: 'VERIFIED' | 'PARTIAL' | 'EMPTY';
  fetchedAt: string;
  // 진단 메타
  endpoint: string;
  bld: string;
  marketsAttempted: KrxMarketProgramCode[];
  marketsSucceeded: KrxMarketProgramCode[];
  /** Patch-007 diagnostic-only KRX intraday shape probe; never CORE-scored. */
  intradayShapeProbe?: {
    confidence: 'EMPTY' | 'SHAPE_CANDIDATE';
    topLevelKeys: string[];
    shapeCandidatePath: string | null;
    rowCount: number;
    firstRowKeys: string[];
    numericFieldCandidates: string[];
    firstRowSample: Record<string, unknown> | null;
    bld: string;
  } | null;
}

/** ENV gate SSOT (ADR-0157 정확 비교 의무). */
export function isKrxMarketProgramFallbackDisabled(): boolean {
  return process.env.KRX_MARKET_PROGRAM_FALLBACK_DISABLED === 'true';
}

/** 사용자 §J #6: 장중 detection — KST 09:00~15:30 = intraday session. */
export function isKstIntradaySession(nowMs: number = Date.now()): boolean {
  // KST = UTC+9. 평일 09:00~15:30 만 intraday session.
  const kstMs = nowMs + 9 * 60 * 60 * 1000;
  const kstDate = new Date(kstMs);
  const day = kstDate.getUTCDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  const minutes = kstDate.getUTCHours() * 60 + kstDate.getUTCMinutes();
  return minutes >= 9 * 60 && minutes <= 15 * 60 + 30;
}

function parseAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const s = String(raw).replace(/,/g, '').trim();
  if (!s || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

interface KrxRowRaw {
  [key: string]: unknown;
}

function extractRowsAt(payload: unknown): KrxRowRaw[] {
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['output', 'OutBlock_1', 'block1', 'output1']) {
    const bucket = (payload as Record<string, unknown>)[key];
    if (Array.isArray(bucket)) return bucket.filter((r): r is KrxRowRaw => !!r && typeof r === 'object');
  }
  return [];
}

function extractMarketRow(rows: KrxRowRaw[], market: KrxMarketProgramCode): KrxMarketProgramRow | null {
  if (rows.length === 0) return null;
  // KRX MDCSTAT01701 일반적으로 market 별 단일 row 또는 aggregated row.
  // 다중 row 시 첫 row 만 사용 (혹은 market 매칭 가능 시 매칭).
  // 한글 + 영문 + 다양 KRX 키 다중 fallback.
  const row = rows[0];
  const programNetBuyAmount = parseAmount(
    row.PRGM_NTBY_TRPMN ?? row.prgm_ntby_trpmn ?? row.NETBUY_TRDVAL ?? row.netbuy_trdval ?? row.PRGM_NTBY_TR_PBMN,
  );
  const programBuyAmount = parseAmount(
    row.PRGM_BUY_TRPMN ?? row.prgm_buy_trpmn ?? row.BUY_TRDVAL ?? row.PRGM_SHNU_TR_PBMN,
  );
  const programSellAmount = parseAmount(
    row.PRGM_SELL_TRPMN ?? row.prgm_sell_trpmn ?? row.SELL_TRDVAL ?? row.PRGM_SELN_TR_PBMN,
  );
  const arbitrageNetBuy = parseAmount(
    row.ARBT_NTBY_TRPMN ?? row.arbt_ntby_trpmn ?? row.ARBT_NTBY_TR_PBMN,
  );
  const nonArbitrageNetBuy = parseAmount(
    row.NABT_NTBY_TRPMN ?? row.nabt_ntby_trpmn ?? row.NABT_NTBY_TR_PBMN,
  );
  return {
    market,
    programNetBuyAmount,
    programBuyAmount,
    programSellAmount,
    arbitrageNetBuy,
    nonArbitrageNetBuy,
    rawDate: typeof row.TRD_DD === 'string' ? row.TRD_DD : (typeof row.trd_dd === 'string' ? row.trd_dd : undefined),
  };
}

/**
 * 사용자 §J #2: 단일 market KRX 프로그램매매 fetch.
 * KIS empty 시 fallback chain 의 첫 단계로 호출됨.
 *
 * @returns KrxMarketProgramRow null 시 fetch 실패 (provider error / 빈 응답 / 파싱 실패).
 */
export async function fetchKrxMarketProgramTradeSingle(
  market: KrxMarketProgramCode,
): Promise<KrxMarketProgramRow | null> {
  if (isKrxMarketProgramFallbackDisabled()) return null;
  const params: Record<string, string> = {
    mktId: KRX_MARKET_PROGRAM_CODE_MAP[market],
  };
  try {
    const raw = await krxPost(KRX_BLD_MARKET_PROGRAM_TRADE, params, { bypassTimeWindow: true });
    const rows = extractRowsAt(raw);
    if (rows.length === 0) return null;
    const result = extractMarketRow(rows, market);
    // 모든 필드 null 이면 의미 없는 응답 — null 반환
    if (
      result === null
      || (result.programNetBuyAmount === null
        && result.programBuyAmount === null
        && result.programSellAmount === null)
    ) {
      return null;
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * 사용자 §6: KOSPI + KOSDAQ 병합 aggregate fetch.
 * 단일 시장 endpoint 가 없으면 병렬 호출 후 합산.
 */
export async function fetchKrxMarketProgramTradeAggregate(
  nowMs: number = Date.now(),
): Promise<KrxMarketProgramAggregate> {
  const fetchedAt = new Date(nowMs).toISOString();
  if (isKrxMarketProgramFallbackDisabled()) {
    return {
      kospi: null,
      kosdaq: null,
      totalProgramNet: null,
      arbitrageNet: null,
      nonArbitrageNet: null,
      timestamp: fetchedAt,
      confidence: 'EMPTY',
      fetchedAt,
      endpoint: KRX_BLD_MARKET_PROGRAM_TRADE,
      bld: KRX_BLD_MARKET_PROGRAM_TRADE,
      marketsAttempted: [],
      marketsSucceeded: [],
    };
  }

  const marketsAttempted: KrxMarketProgramCode[] = ['KOSPI', 'KOSDAQ'];
  const [kospiResult, kosdaqResult] = await Promise.all([
    fetchKrxMarketProgramTradeSingle('KOSPI'),
    fetchKrxMarketProgramTradeSingle('KOSDAQ'),
  ]);

  const marketsSucceeded: KrxMarketProgramCode[] = [];
  if (kospiResult !== null) marketsSucceeded.push('KOSPI');
  if (kosdaqResult !== null) marketsSucceeded.push('KOSDAQ');

  const sumOpt = (a: number | null, b: number | null): number | null => {
    if (a === null && b === null) return null;
    return (a ?? 0) + (b ?? 0);
  };

  const totalProgramNet = sumOpt(
    kospiResult?.programNetBuyAmount ?? null,
    kosdaqResult?.programNetBuyAmount ?? null,
  );
  const arbitrageNet = sumOpt(
    kospiResult?.arbitrageNetBuy ?? null,
    kosdaqResult?.arbitrageNetBuy ?? null,
  );
  const nonArbitrageNet = sumOpt(
    kospiResult?.nonArbitrageNetBuy ?? null,
    kosdaqResult?.nonArbitrageNetBuy ?? null,
  );

  let confidence: 'VERIFIED' | 'PARTIAL' | 'EMPTY';
  if (kospiResult !== null && kosdaqResult !== null) confidence = 'VERIFIED';
  else if (kospiResult !== null || kosdaqResult !== null) confidence = 'PARTIAL';
  else confidence = 'EMPTY';

  return {
    kospi: kospiResult,
    kosdaq: kosdaqResult,
    totalProgramNet,
    arbitrageNet,
    nonArbitrageNet,
    timestamp: fetchedAt,
    confidence,
    fetchedAt,
    endpoint: KRX_BLD_MARKET_PROGRAM_TRADE,
    bld: KRX_BLD_MARKET_PROGRAM_TRADE,
    marketsAttempted,
    marketsSucceeded,
  };
}
