// @responsibility Patch-007 KRX intraday market program-trade fetcher SSOT — UNSUPPORTED_INTRADAY 회복 후보.

// =====================================================================
// Patch-KRX-INTRADAY-MARKET-PROGRAM-WIRING-001 SSOT
//
// 사용자 직접 명시:
//   "KRX intraday endpoint (MDCSTAT00301 등) 실제 wiring —
//    endpoint 응답 shape 검증 의무로 별도 PR 분리."
//
// Patch-006 (PR #969) 가 EOD-only 엔드포인트 (MDCSTAT01701) 만 wiring 했고,
// 장중 confidence='EMPTY' 시 routedStatus='UNSUPPORTED_INTRADAY' 로 직행.
// Patch-SUPPLY-HEALTH-DEGENERATE-DISPLAY-001 (PR #1016) 가 운영자에게 정직한
// 안내 라인을 추가했지만 *실제 intraday endpoint wiring 부재* 결함은 잔존.
//
// 본 SSOT 는 KRX 일중 프로그램매매 추이 endpoint candidate (MDCSTAT00301) 호출 +
// graceful fallback (endpoint shape 미검증 → null 반환) + ENV opt-in (default OFF).
//
// 절대 변경 금지:
//   • LIVE 매매 본체 0줄 변경
//   • KIS 주문 함수 5종 import 0건
//   • 외부 API 호출은 krxPost 단일 통로 (절대 규칙 #2 정합)
//   • providerIssue / marketSignal 변환 0
//   • emergencyStop / SELL_ONLY 자동 전환 0
//   • Patch-006 의 EOD fetcher (programTradeFetcher.ts) 본체 무수정
//   • ENV default OFF — endpoint shape 검증 전까지 opt-in
// =====================================================================

import { krxPost } from './http.js';
import {
  KRX_MARKET_PROGRAM_CODE_MAP,
  type KrxMarketProgramCode,
  type KrxMarketProgramRow,
  type KrxMarketProgramAggregate,
} from './programTradeFetcher.js';

/** Patch-007 patch identifier (static grep guard SSOT). */
export const PATCH_007_INTRADAY_IDENTIFIER = 'Patch-KRX-INTRADAY-MARKET-PROGRAM-WIRING-001';

/**
 * ENV-overridable KRX intraday BLD ID + path. default 는 *추정* 값 — 운영 환경에서
 * 첫 호출 후 응답 shape 검증 + 실제 BLD ID override 가능.
 *
 * 후보:
 *   • MDCSTAT00301 — 일중 프로그램매매 추이 (사용자 명시)
 *   • dbms/MDC/STAT/standard/MDCSTAT00301
 *   • dbms/MDC/STAT/standard/MDCSTAT00302
 *
 * 운영자가 정확한 BLD 파악 후 ENV `KRX_BLD_MARKET_PROGRAM_INTRADAY` 로 override.
 */
export const KRX_BLD_MARKET_PROGRAM_INTRADAY =
  process.env.KRX_BLD_MARKET_PROGRAM_INTRADAY ?? 'dbms/MDC/STAT/standard/MDCSTAT00301';

/** Runtime BLD resolver — ENV override must win without process restart in tests/ops probes. */
export function getKrxIntradayMarketProgramBld(): string {
  return process.env.KRX_BLD_MARKET_PROGRAM_INTRADAY ?? KRX_BLD_MARKET_PROGRAM_INTRADAY;
}

/**
 * ENV gate SSOT (ADR-0157 정확 비교 의무).
 *
 * default OFF — endpoint shape 미검증. 운영자가 다음 모두 확인 후 활성화:
 *   1. KRX 가 실제로 intraday market program-trade endpoint 를 제공하는지
 *   2. BLD ID 정확값 (`KRX_BLD_MARKET_PROGRAM_INTRADAY` ENV 로 override)
 *   3. 응답 shape (한글/영문 키, 단위, 시간 윈도우)
 */
export function isKrxIntradayMarketProgramEnabled(): boolean {
  return process.env.KRX_INTRADAY_MARKET_PROGRAM_ENABLED === 'true';
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

export const KRX_INTRADAY_SHAPE_CANDIDATE_PATHS = Object.freeze([
  'output',
  'output1',
  'output2',
  'data',
  'rows',
  'list',
  'result',
  'grid',
  'block1',
  'block2',
  'tableData',
  // legacy KRX aliases kept after required candidates.
  'OutBlock_1',
] as const);

export interface KrxIntradayShapeProbe {
  confidence: 'EMPTY' | 'SHAPE_CANDIDATE';
  topLevelKeys: string[];
  shapeCandidatePath: string | null;
  rowCount: number;
  firstRowKeys: string[];
  numericFieldCandidates: string[];
  firstRowSample: Record<string, unknown> | null;
  bld: string;
}

export function probeKrxIntradayProgramTradeShape(payload: unknown, bld = getKrxIntradayMarketProgramBld()): KrxIntradayShapeProbe {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const topLevelKeys = Object.keys(root);
  for (const path of KRX_INTRADAY_SHAPE_CANDIDATE_PATHS) {
    const bucket = root[path];
    const rows = Array.isArray(bucket)
      ? bucket.filter((r): r is KrxRowRaw => !!r && typeof r === 'object')
      : [];
    if (rows.length > 0) {
      const firstRow = rows[0];
      const firstRowKeys = Object.keys(firstRow);
      const numericFieldCandidates = firstRowKeys.filter((key) => parseAmount(firstRow[key]) !== null);
      return {
        confidence: 'SHAPE_CANDIDATE',
        topLevelKeys,
        shapeCandidatePath: path,
        rowCount: rows.length,
        firstRowKeys,
        numericFieldCandidates,
        firstRowSample: Object.fromEntries(Object.entries(firstRow).slice(0, 12)),
        bld,
      };
    }
  }
  return {
    confidence: 'EMPTY',
    topLevelKeys,
    shapeCandidatePath: null,
    rowCount: 0,
    firstRowKeys: [],
    numericFieldCandidates: [],
    firstRowSample: null,
    bld,
  };
}

function extractRowsAt(payload: unknown): KrxRowRaw[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as Record<string, unknown>;
  for (const key of KRX_INTRADAY_SHAPE_CANDIDATE_PATHS) {
    const bucket = root[key];
    if (Array.isArray(bucket)) return bucket.filter((r): r is KrxRowRaw => !!r && typeof r === 'object');
  }
  return [];
}

/**
 * 사용자 §"intraday rows aggregation": 일중 추이 endpoint 는 통상 시간별/구간별
 * 다수 row 반환. 가장 *최근* row 1개 + market 별 합산을 사용 — 시간 정렬 키
 * (TIME_KEY/TIME/TRD_TM 등) 가 있으면 마지막 row, 없으면 첫 row.
 */
function extractLatestMarketRow(rows: KrxRowRaw[], market: KrxMarketProgramCode): KrxMarketProgramRow | null {
  if (rows.length === 0) return null;
  // 시간 정렬 키 후보. 응답 shape 검증 후 정확값 우선 적용.
  const timeKeys = ['TIME', 'TRD_TM', 'TIME_KEY', 'time', 'trd_tm'];
  let pickedRow: KrxRowRaw = rows[rows.length - 1];
  for (const tk of timeKeys) {
    if (rows.some((r) => typeof r[tk] === 'string' && r[tk])) {
      // 시간 정렬 키 발견 → 마지막 row 가 최신 (KRX intraday 표 통상 순서)
      pickedRow = rows[rows.length - 1];
      break;
    }
  }
  // EOD endpoint 와 동일한 한글/영문 키 다중 fallback (응답 shape 정확값은 운영 검증 후 갱신).
  const programNetBuyAmount = parseAmount(
    pickedRow.PRGM_NTBY_TRPMN ?? pickedRow.prgm_ntby_trpmn ?? pickedRow.NETBUY_TRDVAL ?? pickedRow.netbuy_trdval ?? pickedRow.PRGM_NTBY_TR_PBMN,
  );
  const programBuyAmount = parseAmount(
    pickedRow.PRGM_BUY_TRPMN ?? pickedRow.prgm_buy_trpmn ?? pickedRow.BUY_TRDVAL ?? pickedRow.PRGM_SHNU_TR_PBMN,
  );
  const programSellAmount = parseAmount(
    pickedRow.PRGM_SELL_TRPMN ?? pickedRow.prgm_sell_trpmn ?? pickedRow.SELL_TRDVAL ?? pickedRow.PRGM_SELN_TR_PBMN,
  );
  const arbitrageNetBuy = parseAmount(
    pickedRow.ARBT_NTBY_TRPMN ?? pickedRow.arbt_ntby_trpmn ?? pickedRow.ARBT_NTBY_TR_PBMN,
  );
  const nonArbitrageNetBuy = parseAmount(
    pickedRow.NABT_NTBY_TRPMN ?? pickedRow.nabt_ntby_trpmn ?? pickedRow.NABT_NTBY_TR_PBMN,
  );
  return {
    market,
    programNetBuyAmount,
    programBuyAmount,
    programSellAmount,
    arbitrageNetBuy,
    nonArbitrageNetBuy,
    rawDate: typeof pickedRow.TRD_DD === 'string'
      ? pickedRow.TRD_DD
      : (typeof pickedRow.trd_dd === 'string' ? pickedRow.trd_dd : undefined),
  };
}

export async function probeKrxIntradayProgramTradeSingleShape(
  market: KrxMarketProgramCode,
): Promise<KrxIntradayShapeProbe> {
  const bld = getKrxIntradayMarketProgramBld();
  if (!isKrxIntradayMarketProgramEnabled()) {
    return emptyShapeProbe(bld);
  }
  try {
    const raw = await krxPost(bld, { mktId: KRX_MARKET_PROGRAM_CODE_MAP[market] }, { bypassTimeWindow: true });
    return probeKrxIntradayProgramTradeShape(raw, bld);
  } catch {
    return emptyShapeProbe(bld);
  }
}

interface IntradaySingleFetchResult {
  row: KrxMarketProgramRow | null;
  shapeProbe: KrxIntradayShapeProbe;
}

function emptyShapeProbe(bld = getKrxIntradayMarketProgramBld()): KrxIntradayShapeProbe {
  return {
    confidence: 'EMPTY',
    topLevelKeys: [],
    shapeCandidatePath: null,
    rowCount: 0,
    firstRowKeys: [],
    numericFieldCandidates: [],
    firstRowSample: null,
    bld,
  };
}

async function fetchKrxIntradayProgramTradeSingleWithProbe(
  market: KrxMarketProgramCode,
): Promise<IntradaySingleFetchResult> {
  const bld = getKrxIntradayMarketProgramBld();
  if (!isKrxIntradayMarketProgramEnabled()) return { row: null, shapeProbe: emptyShapeProbe(bld) };
  const params: Record<string, string> = {
    mktId: KRX_MARKET_PROGRAM_CODE_MAP[market],
  };
  try {
    const raw = await krxPost(bld, params, { bypassTimeWindow: true });
    const shapeProbe = probeKrxIntradayProgramTradeShape(raw, bld);
    const rows = extractRowsAt(raw);
    if (rows.length === 0) return { row: null, shapeProbe };
    const result = extractLatestMarketRow(rows, market);
    if (
      result === null
      || (result.programNetBuyAmount === null
        && result.programBuyAmount === null
        && result.programSellAmount === null)
    ) {
      return { row: null, shapeProbe };
    }
    return { row: result, shapeProbe };
  } catch {
    return { row: null, shapeProbe: emptyShapeProbe(bld) };
  }
}

/**
 * 단일 market intraday 프로그램매매 fetch.
 *
 * @returns null = ENV disabled / endpoint 미응답 / 빈 응답 / 파싱 실패. 호출자는
 *          null 시 graceful fallback (UNSUPPORTED_INTRADAY 분기 그대로).
 */
export async function fetchKrxIntradayProgramTradeSingle(
  market: KrxMarketProgramCode,
): Promise<KrxMarketProgramRow | null> {
  return (await fetchKrxIntradayProgramTradeSingleWithProbe(market)).row;
}

/**
 * KOSPI + KOSDAQ 병합 intraday aggregate fetch. EOD aggregate 와 동일 schema 반환
 * 으로 호출자 (Patch-006 router) 가 동일 분기 로직 재사용 가능.
 */
export async function fetchKrxIntradayProgramTradeAggregate(
  nowMs: number = Date.now(),
): Promise<KrxMarketProgramAggregate> {
  const fetchedAt = new Date(nowMs).toISOString();
  if (!isKrxIntradayMarketProgramEnabled()) {
    return {
      kospi: null,
      kosdaq: null,
      totalProgramNet: null,
      arbitrageNet: null,
      nonArbitrageNet: null,
      timestamp: fetchedAt,
      confidence: 'EMPTY',
      fetchedAt,
      endpoint: getKrxIntradayMarketProgramBld(),
      bld: getKrxIntradayMarketProgramBld(),
      marketsAttempted: [],
      marketsSucceeded: [],
    };
  }

  const marketsAttempted: KrxMarketProgramCode[] = ['KOSPI', 'KOSDAQ'];
  const [kospiSingle, kosdaqSingle] = await Promise.all([
    fetchKrxIntradayProgramTradeSingleWithProbe('KOSPI'),
    fetchKrxIntradayProgramTradeSingleWithProbe('KOSDAQ'),
  ]);
  const kospiResult = kospiSingle.row;
  const kosdaqResult = kosdaqSingle.row;
  const shapeProbes = [kospiSingle.shapeProbe, kosdaqSingle.shapeProbe];
  const shapeCandidate = shapeProbes.find((probe) => probe.confidence === 'SHAPE_CANDIDATE') ?? null;

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
    endpoint: getKrxIntradayMarketProgramBld(),
    bld: getKrxIntradayMarketProgramBld(),
    marketsAttempted,
    marketsSucceeded,
    intradayShapeProbe: shapeCandidate,
  };
}
