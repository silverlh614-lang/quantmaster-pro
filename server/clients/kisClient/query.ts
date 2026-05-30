/**
 * @responsibility KIS 시세 조회 — 현재가·전일종가·종목명·투자자수급·시장수급
 *
 * ADR-0135 (PR-Refactor-3) — kisClient.ts 분해 시 도메인 조회 격리.
 * 모든 함수가 overrides.ts (VTS mock) 우선 + http.ts realDataKisGet 경유.
 */

import { logger } from '../../utils/logger.js';
import { HAS_REAL_DATA_CLIENT, KIS_BASE, KIS_IS_REAL, REAL_DATA_BASE } from './constants.js';
import {
  getKisTokenRemainingHours,
  getRealDataTokenRemainingHours,
  refreshKisToken,
  refreshRealDataToken,
} from './auth.js';
import { realDataKisGet } from './http.js';
import { getKisOverrides } from './overrides.js';
import type {
  KisIndexQuoteBaseUrlKind,
  KisIndexQuoteClientStatus,
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
  KisInvestorFlowActualRowCarrier,
  KisInvestorFlowRawRow,
  KisMarketProgramTrade,
  KisSectorIndexCurrentPrice,
  KisSectorIndexCurrentPriceProbeAttempt,
  KisSectorIndexCurrentPriceProbeResult,
  KisSectorIndexValueQualityStatus,
  KisSectorIndexVerifyMode,
  KisSectorIndexVerifyTransportStage,
  KisSectorIndexVerifyVariantPolicy,
  KisSectorIndexDaily,
  KisSectorIndexDailyRow,
  KisShortSaleRankingRow,
  KisStockProgramTrade,
  PrevClose,
} from './types.js';
import type { KisApiPriority } from '../kisRateLimiter.js';
import type { SectorKey } from '../sectorEnergyMaster.js';
import { isTradingDay } from '../../utils/marketDayClassifier.js';
import {
  MARKET_PROGRAM_TRADE_TR_ID,
  MARKET_PROGRAM_TRADE_PATH,
  buildMarketProgramTradeTodayParams,
  materializeKisMarketProgramTrade,
} from './programMaterializer.js';
import { classifyInvestorFlowPayload, classifyShortPayload } from './payloadValidators.js';
import {
  pickKisOutput,
  pickKisRows,
  pickMaterializedBucket,
  isAcceptedEmptyKisResponse,
  previousKrxTradingDate,
  investorDailySession,
  extractKisNumberOptional,
  extractKisString,
  formatKisYmd,
  trendFromChange,
  percentChange,
  hasAnyFinite,
} from './query/helpers.js';
import type { KisOutput } from './query/helpers.js';

// ADR-0537 — 섹터 지수 도메인 분해. fetchKisSectorIndexDaily/CurrentPrice/Probe 등
// 기존 query.js export 경로를 byte-equivalent 로 유지 (index.ts facade + 직접 importer 4종).
export * from './query/sectorIndex.js';

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

const INVESTOR_TRADE_BY_STOCK_DAILY_TR_ID = 'FHPTJ04160001';
const INVESTOR_TRADE_BY_STOCK_DAILY_PATH = '/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily';
const INVESTOR_TRADE_BY_STOCK_DAILY_ORG_ADJ_PRC = process.env.KIS_INVESTOR_DAILY_ORG_ADJ_PRC ?? '0';
const INVESTOR_TRADE_BY_STOCK_DAILY_ETC_CLS_CODE = process.env.KIS_INVESTOR_DAILY_ETC_CLS_CODE ?? '0';

/**
 * ADR-0542 — KIS investor-trade-by-stock-daily output1/output2 버킷 합성 게이트.
 * default ON. `KIS_INVESTOR_OUTPUT_BUCKET_FIX=false` 1줄로 직전(단일 버킷) 동작으로 revert.
 * KIS quota 추가 호출 0 — 이미 받은 응답의 파싱만 변경한다.
 */
function isKisInvestorOutputBucketFixEnabled(): boolean {
  return process.env.KIS_INVESTOR_OUTPUT_BUCKET_FIX !== 'false';
}

const INVESTOR_FLOW_FOREIGN_NET_BUY_KEYS = ['frgn_ntby_qty', 'frgn_ntby_tr_pbmn', 'FRGN_NTBY_QTY', 'FRGN_NTBY_TR_PBMN'];
const INVESTOR_FLOW_INSTITUTION_NET_BUY_KEYS = ['orgn_ntby_qty', 'orgn_ntby_tr_pbmn', 'ORGN_NTBY_QTY', 'ORGN_NTBY_TR_PBMN'];
const INVESTOR_FLOW_INDIVIDUAL_NET_BUY_KEYS = ['prsn_ntby_qty', 'prsn_ntby_tr_pbmn', 'PRSN_NTBY_QTY', 'PRSN_NTBY_TR_PBMN'];

type InvestorFlowBucketName = 'output' | 'output1' | 'output2';

/**
 * ADR-0542 — output1(요약 row)·output2(일자별 시계열) 어느 버킷에 순매수 필드가 있든
 * 외국인·기관·개인 net-buy 와 carrier base row 를 합성한다. 공식 spec(chk COLUMN_MAPPING)
 * 상 frgn/orgn/prsn_ntby_qty 는 두 버킷 모두에 나타날 수 있어, 단일 버킷 commit 후 한쪽이
 * 비면 누락되던(coverage 2/11) 회귀를 제거한다. base row 는 net-buy 가 잡힌 버킷의 [0] 우선.
 */
function synthesizeInvestorFlowAcrossBuckets(
  data: unknown,
  order: InvestorFlowBucketName[],
): {
  baseRow: KisOutput | undefined;
  baseBucket: InvestorFlowBucketName | undefined;
  foreignNetBuy: number | undefined;
  institutionalNetBuy: number | undefined;
  individualNetBuy: number | undefined;
} {
  const root = data as Partial<Record<InvestorFlowBucketName, unknown>> | null;
  let foreignNetBuy: number | undefined;
  let institutionalNetBuy: number | undefined;
  let individualNetBuy: number | undefined;
  let baseRow: KisOutput | undefined;
  let baseBucket: InvestorFlowBucketName | undefined;
  for (const bucket of order) {
    const rows = rowsFromKisInvestorBucket(root?.[bucket]);
    const row = rows[0];
    if (!row) continue;
    const f = extractKisNumberOptional(row, INVESTOR_FLOW_FOREIGN_NET_BUY_KEYS);
    const i = extractKisNumberOptional(row, INVESTOR_FLOW_INSTITUTION_NET_BUY_KEYS);
    const p = extractKisNumberOptional(row, INVESTOR_FLOW_INDIVIDUAL_NET_BUY_KEYS);
    if (foreignNetBuy === undefined && f !== undefined) foreignNetBuy = f;
    if (institutionalNetBuy === undefined && i !== undefined) institutionalNetBuy = i;
    if (individualNetBuy === undefined && p !== undefined) individualNetBuy = p;
    // base row = 외인·기관 둘 다 잡힌 첫 버킷 우선, 없으면 net-buy 가 하나라도 잡힌 첫 버킷.
    if (!baseRow && (f !== undefined || i !== undefined || p !== undefined)) {
      baseRow = row;
      baseBucket = bucket;
    }
    if (foreignNetBuy !== undefined && institutionalNetBuy !== undefined && baseRow) break;
  }
  return { baseRow, baseBucket, foreignNetBuy, institutionalNetBuy, individualNetBuy };
}

function rowsFromKisInvestorBucket(bucket: unknown): KisOutput[] {
  if (Array.isArray(bucket)) return bucket.filter((r): r is KisOutput => !!r && typeof r === 'object');
  if (bucket && typeof bucket === 'object') return [bucket as KisOutput];
  return [];
}

/**
 * ADR-0542 Step 0 — KIS_ONLY_TRACE 진단용 payloadClass. 누락 종목의 net-buy 필드가
 * 어느 버킷(output/output1/output2)에 존재/부재했는지 비식별 메타만 기록한다(값 미노출).
 * Silent 금지 — 다음 스캔에서 가설(output1 vs output2)을 확증하는 무비용 게이트.
 */
function traceInvestorFlowBuckets(data: unknown): Record<InvestorFlowBucketName, { rowCount: number; foreign: boolean; institution: boolean; individual: boolean }> {
  const root = data as Partial<Record<InvestorFlowBucketName, unknown>> | null;
  const trace = {} as Record<InvestorFlowBucketName, { rowCount: number; foreign: boolean; institution: boolean; individual: boolean }>;
  for (const bucket of ['output', 'output1', 'output2'] as InvestorFlowBucketName[]) {
    const rows = rowsFromKisInvestorBucket(root?.[bucket]);
    const row = rows[0];
    trace[bucket] = {
      rowCount: rows.length,
      foreign: row ? extractKisNumberOptional(row, INVESTOR_FLOW_FOREIGN_NET_BUY_KEYS) !== undefined : false,
      institution: row ? extractKisNumberOptional(row, INVESTOR_FLOW_INSTITUTION_NET_BUY_KEYS) !== undefined : false,
      individual: row ? extractKisNumberOptional(row, INVESTOR_FLOW_INDIVIDUAL_NET_BUY_KEYS) !== undefined : false,
    };
  }
  return trace;
}

/**
 * ADR-0146: comp-program-trade-today 의 시장구분코드는 `U` 가 아니라 국내주식 공통값 `J`.
 * `/sh` rawDiag 에서 `msg_cd=OPSQ2001 ERROR INVALID FID_COND_MRKT_DIV_CODE` 로 확인됨.
 */


const INVESTOR_FLOW_ACTUAL_ROW_KEEP_KEY_PATTERN = /code|symbol|mksc|stck|pdno|frgn|orgn|indv|prsn|foreign|institution|individual|investor|type|net|buy|sell|ntby|shnu|seln|amount|volume|qty|tr_pbmn|bsop/i;
const INVESTOR_FLOW_ACTUAL_ROW_PRIVATE_KEY_PATTERN = /token|secret|password|authorization|auth|appkey|appsecret|account|acct|cano|acnt/i;

function investorFlowActualValueKind(value: unknown): 'number' | 'numericString' | 'placeholder' | 'other' {
  if (typeof value === 'number') return Number.isFinite(value) ? 'number' : 'placeholder';
  if (value == null) return 'placeholder';
  if (typeof value !== 'string') return 'other';
  const trimmed = value.trim();
  if (!trimmed || trimmed === '-' || trimmed.toUpperCase() === 'N/A') return 'placeholder';
  return /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed.replace(/,/g, '')) ? 'numericString' : 'other';
}

function buildKisActualInvestorFlowRowCarrier(input: {
  row: KisOutput;
  safeCode: string;
  sourcePath: string;
  foreignNetBuy?: number;
  institutionalNetBuy?: number;
  individualNetBuy?: number;
}): KisInvestorFlowActualRowCarrier {
  const sanitized: KisInvestorFlowRawRow = {};
  const rawFieldKeys: string[] = [];
  const numericStringFieldKeys: string[] = [];
  const numberFieldKeys: string[] = [];
  const placeholderFieldKeys: string[] = [];
  for (const [key, value] of Object.entries(input.row)) {
    if (INVESTOR_FLOW_ACTUAL_ROW_PRIVATE_KEY_PATTERN.test(key)) continue;
    if (value != null && typeof value === 'object') continue;
    const kind = investorFlowActualValueKind(value);
    if (!INVESTOR_FLOW_ACTUAL_ROW_KEEP_KEY_PATTERN.test(key) && kind !== 'number' && kind !== 'numericString') continue;
    sanitized[key] = value;
    rawFieldKeys.push(key);
    if (kind === 'number') numberFieldKeys.push(key);
    else if (kind === 'numericString') numericStringFieldKeys.push(key);
    else if (kind === 'placeholder') placeholderFieldKeys.push(key);
  }

  const normalizedPairs: Array<[keyof KisInvestorFlowRawRow, number | undefined]> = [
    ['foreignNetBuy', input.foreignNetBuy],
    ['institutionNetBuy', input.institutionalNetBuy],
    ['institutionalNetBuy', input.institutionalNetBuy],
    ['individualNetBuy', input.individualNetBuy],
  ];
  for (const [key, value] of normalizedPairs) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    sanitized[key] = value;
    rawFieldKeys.push(String(key));
    numberFieldKeys.push(String(key));
  }

  return {
    provider: 'KIS_API',
    requestSymbol: input.safeCode,
    normalizedSymbol: input.safeCode,
    providerScope: 'SYMBOL_LEVEL',
    actualRows: Object.keys(sanitized).length > 0 ? [sanitized] : [],
    rowSourcePath: input.sourcePath,
    rawFieldKeys: Array.from(new Set(rawFieldKeys)).slice(0, 64),
    numericStringFieldKeys: Array.from(new Set(numericStringFieldKeys)).slice(0, 64),
    numberFieldKeys: Array.from(new Set(numberFieldKeys)).slice(0, 64),
    placeholderFieldKeys: Array.from(new Set(placeholderFieldKeys)).slice(0, 64),
    carriedAt: new Date().toISOString(),
  };
}

const INVESTOR_FLOW_SELECTED_UNCHANGED_SUMMARY_MS = 5 * 60 * 1000;

type InvestorFlowSelectionLogPayload = {
  source: 'INVESTOR_TRADE_BY_STOCK_DAILY';
  provider: 'KIS_API';
  materialized: number;
  confidence: 'VERIFIED' | 'DEGRADED';
  usableForSignal: boolean;
  executionImpact: 'NONE';
  providerIssue: boolean;
  marketSignal: boolean;
  logClass: 'TELEMETRY';
};

let lastInvestorFlowSelectionKey: string | undefined;
let investorFlowSelectedUnchangedRepeated = 0;
let investorFlowSelectedUnchangedLastSummaryAt = 0;
let investorFlowSelectedUnchangedLastSeen = 0;

function investorFlowSelectionKey(payload: InvestorFlowSelectionLogPayload): string {
  return [
    payload.source,
    payload.provider,
    payload.materialized,
    payload.confidence,
    payload.usableForSignal,
    payload.executionImpact,
  ].join('|');
}

function formatInvestorFlowSelectionPayload(payload: InvestorFlowSelectionLogPayload): string {
  return `source=${payload.source} provider=${payload.provider} materialized=${payload.materialized} `
    + `confidence=${payload.confidence} usableForSignal=${payload.usableForSignal} `
    + `executionImpact=${payload.executionImpact} providerIssue=${payload.providerIssue} `
    + `marketSignal=${payload.marketSignal} logClass=${payload.logClass}`;
}

function formatUtcTime(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19);
}

function logInvestorFlowSelected(materialized: number, confidence: 'VERIFIED' | 'DEGRADED' = 'VERIFIED'): void {
  const payload: InvestorFlowSelectionLogPayload = {
    source: 'INVESTOR_TRADE_BY_STOCK_DAILY',
    provider: 'KIS_API',
    materialized,
    confidence,
    usableForSignal: confidence === 'VERIFIED',
    executionImpact: 'NONE',
    providerIssue: confidence !== 'VERIFIED',
    marketSignal: false,
    logClass: 'TELEMETRY',
  };
  const now = Date.now();
  const selectionKey = investorFlowSelectionKey(payload);

  if (selectionKey !== lastInvestorFlowSelectionKey) {
    console.info(`[KIS] investorFlow selected ${formatInvestorFlowSelectionPayload(payload)}`);
    lastInvestorFlowSelectionKey = selectionKey;
    investorFlowSelectedUnchangedRepeated = 0;
    investorFlowSelectedUnchangedLastSummaryAt = now;
    investorFlowSelectedUnchangedLastSeen = now;
    return;
  }

  investorFlowSelectedUnchangedRepeated += 1;
  investorFlowSelectedUnchangedLastSeen = now;
  if (now - investorFlowSelectedUnchangedLastSummaryAt >= INVESTOR_FLOW_SELECTED_UNCHANGED_SUMMARY_MS) {
    logger.debug(
      `[KIS] investorFlow selected unchanged ${formatInvestorFlowSelectionPayload(payload)} `
      + `repeated=${investorFlowSelectedUnchangedRepeated} lastSeen=${formatUtcTime(investorFlowSelectedUnchangedLastSeen)}`,
    );
    investorFlowSelectedUnchangedLastSummaryAt = now;
    investorFlowSelectedUnchangedRepeated = 0;
  }
}

export const __queryTestOnly = {
  logInvestorFlowSelected,
  resetInvestorFlowSelectedLogState: () => {
    lastInvestorFlowSelectionKey = undefined;
    investorFlowSelectedUnchangedRepeated = 0;
    investorFlowSelectedUnchangedLastSummaryAt = 0;
    investorFlowSelectedUnchangedLastSeen = 0;
  },
};


function investorTradeByStockDailyDateCandidates(): string[] {
  const today = _kstDateStr();
  const previous = previousKrxTradingDate(today);
  return investorDailySession(today) === 'REGULAR' ? [today, previous] : [previous];
}

function buildInvestorTradeByStockDailyParams(safeCode: string, dateKst: string): Record<string, string> {
  return {
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_INPUT_ISCD: safeCode,
    FID_INPUT_DATE_1: dateKst.replace(/-/g, ''),
    FID_ORG_ADJ_PRC: INVESTOR_TRADE_BY_STOCK_DAILY_ORG_ADJ_PRC,
    FID_ETC_CLS_CODE: INVESTOR_TRADE_BY_STOCK_DAILY_ETC_CLS_CODE,
  };
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
    const programNetBuyQty = extractKisNumberOptional(
      out,
      ['whol_smtn_ntby_qty', 'prgm_ntby_qty', 'PRGM_NTBY_QTY'],
    );
    const programNetBuyAmount = extractKisNumberOptional(
      out,
      ['whol_smtn_ntby_tr_pbmn', 'prgm_ntby_tr_pbmn', 'PRGM_NTBY_TR_PBMN'],
    );
    if (programNetBuyQty === undefined && programNetBuyAmount === undefined) return null;
    // 비중 필드는 부재 가능 — 강제 0 fallback 금지 (ADR-0136 의미 단절 차단).
    const ratioRaw = out.prgm_byov_rate ?? out.PRGM_BYOV_RATE ?? '';
    const ratioNum = ratioRaw === '' ? Number.NaN : Number(String(ratioRaw).replace(/,/g, ''));
    const programBuyRatio = Number.isFinite(ratioNum) ? ratioNum : null;

    return {
      stockCode: code.padStart(6, '0'),
      ...(programNetBuyQty !== undefined ? { programNetBuyQty } : {}),
      ...(programNetBuyAmount !== undefined ? { programNetBuyAmount } : {}),
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


function extractMarketProgramRows(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== 'object') return [];
  const rec = data as Record<string, unknown>;
  const out = rec.output;
  if (Array.isArray(out)) return out.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object');
  if (out && typeof out === 'object') return [out as Record<string, unknown>];
  return [];
}

function getLatestByBsopHour(rows: Record<string, unknown>[]): Record<string, unknown> | null {
  if (rows.length === 0) return null;
  return rows.reduce<Record<string, unknown> | null>((best, row) => {
    const hour = String(row.bsop_hour ?? '');
    if (!best) return row;
    return hour > String(best.bsop_hour ?? '') ? row : best;
  }, null);
}

function readNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ─── ADR-0138 (정정 ADR-0144): 시장 종합 프로그램 매매 추이 ───────────────────
// 사용자 12 아이디어 #4 — 시장 단위 프로그램 자금 흐름 (코스피 전체).
// ADR-0137 종목별 데이터와 *별도* — 시장 방향성 신호 (regime 가중치 입력).
//
// KIS 공식 검증: `FHPPG04600101` = 프로그램매매 종합현황(시간) → `comp-program-trade-today`
// 직전 코드: tr_id=FHPPG04600101 (시간) + path=...-daily (일별) 교차 미스매치.
// 일별이 필요한 경우: tr_id=FHPPG04600001 + path=...-daily (별도 ENV 로 전환).

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
    const [kospiData, kosdaqData] = await Promise.all([
      realDataKisGet(
      MARKET_PROGRAM_TRADE_TR_ID,
      MARKET_PROGRAM_TRADE_PATH,
      buildMarketProgramTradeTodayParams('K'),
      priority,
    ),
      realDataKisGet(
        MARKET_PROGRAM_TRADE_TR_ID,
        MARKET_PROGRAM_TRADE_PATH,
        buildMarketProgramTradeTodayParams('Q'),
        priority,
      ),
    ]);
    // [임시 진단 도구 — 5/4 영업일 검증 후 제거 예정]
    // 사용자 P1 #4 (DEBUG_PROGRAM_RAW ENV 우회) — 응답 필드 키 미스매치 vs 휴장일 효과 구분.
    // 정상 검증 후 별도 PR 로 본 블록 제거 의무.
    if (process.env.DEBUG_PROGRAM_RAW === 'true') {
      console.log('[DEBUG_PROGRAM_RAW] market', JSON.stringify({ kospiData, kosdaqData }));
    }
    const kospi = materializeKisMarketProgramTrade(kospiData);
    const kosdaq = materializeKisMarketProgramTrade(kosdaqData);
    const kospiRows = extractMarketProgramRows(kospiData);
    const kosdaqRows = extractMarketProgramRows(kosdaqData);
    const kospiSelected = getLatestByBsopHour(kospiRows);
    const kosdaqSelected = getLatestByBsopHour(kosdaqRows);
    const combinedRows = [...kospiRows, ...kosdaqRows];
    const combinedSelected = getLatestByBsopHour(combinedRows);
    const splitAvailable = kospiRows.length > 0 || kosdaqRows.length > 0;
    const combinedOnly = !splitAvailable;

    console.log('[KIS_MARKET_PROGRAM_KOSPI_FETCH_RESULT]', JSON.stringify({
      requested: true,
      marketClassCode: 'K',
      responseCode: (kospiData as Record<string, unknown> | null)?.rt_cd ?? null,
      msgCd: (kospiData as Record<string, unknown> | null)?.msg_cd ?? null,
      outputLength: kospiRows.length,
      firstRowBsopHour: kospiRows[0]?.bsop_hour ?? null,
      lastRowBsopHour: kospiRows[kospiRows.length - 1]?.bsop_hour ?? null,
      selectedBsopHour: kospiSelected?.bsop_hour ?? null,
      selectedRawWholeNetBuy: readNum(kospiSelected?.whol_smtn_ntby_tr_pbmn),
    }));
    console.log('[KIS_MARKET_PROGRAM_KOSDAQ_FETCH_RESULT]', JSON.stringify({
      requested: true,
      marketClassCode: 'Q',
      responseCode: (kosdaqData as Record<string, unknown> | null)?.rt_cd ?? null,
      msgCd: (kosdaqData as Record<string, unknown> | null)?.msg_cd ?? null,
      outputLength: kosdaqRows.length,
      firstRowBsopHour: kosdaqRows[0]?.bsop_hour ?? null,
      lastRowBsopHour: kosdaqRows[kosdaqRows.length - 1]?.bsop_hour ?? null,
      selectedBsopHour: kosdaqSelected?.bsop_hour ?? null,
      selectedRawWholeNetBuy: readNum(kosdaqSelected?.whol_smtn_ntby_tr_pbmn),
    }));
    console.log('[KIS_MARKET_PROGRAM_COMBINED_RESULT]', JSON.stringify({
      kospiOutputLength: kospiRows.length,
      kosdaqOutputLength: kosdaqRows.length,
      combinedOutputLength: combinedRows.length,
      combinedNonZeroRows: combinedRows.filter((r) => (readNum(r.whol_smtn_ntby_tr_pbmn) ?? 0) !== 0).length,
      splitAvailable,
      combinedOnly,
    }));

    const pick = kospi.materialized ?? kosdaq.materialized;
    if (pick) {
      const k = kospi.materialized;
      const q = kosdaq.materialized;
      return {
        ...pick,
        programNetBuyQty: (k?.programNetBuyQty ?? q?.programNetBuyQty ?? null) === null ? null : ((k?.programNetBuyQty ?? 0) + (q?.programNetBuyQty ?? 0)),
        programNetBuyAmount: (k?.programNetBuyAmount ?? 0) + (q?.programNetBuyAmount ?? 0),
        programArbitrageNetBuy: (k?.programArbitrageNetBuy ?? 0) + (q?.programArbitrageNetBuy ?? 0),
        programNonArbitrageNetBuy: (k?.programNonArbitrageNetBuy ?? 0) + (q?.programNonArbitrageNetBuy ?? 0),
        marketProgramStatus: k && q ? 'OK_NONZERO' : 'OK_PARSE_PARTIAL',
        aggregateDiagnostic: {
          paramMode: process.env.KIS_MARKET_PROGRAM_PARAM_MODE ?? 'OFFICIAL',
          kospi: kospi.diagnostics,
          kosdaq: kosdaq.diagnostics,
          finalStatus: k && q ? 'VERIFIED' : 'PARTIAL_VERIFIED',
          splitAvailable,
          combinedOnly,
          combinedSource: 'KOSPI_PLUS_KOSDAQ',
          rowBreakdownBundle: {
            kospi: { requested: true, marketClassCode: 'K', responseCode: String((kospiData as Record<string, unknown> | null)?.rt_cd ?? ''), outputLength: kospiRows.length, rows: kospiRows, selectedRow: kospiSelected, selectedBsopHour: kospiSelected ? String(kospiSelected.bsop_hour ?? '') : null },
            kosdaq: { requested: true, marketClassCode: 'Q', responseCode: String((kosdaqData as Record<string, unknown> | null)?.rt_cd ?? ''), outputLength: kosdaqRows.length, rows: kosdaqRows, selectedRow: kosdaqSelected, selectedBsopHour: kosdaqSelected ? String(kosdaqSelected.bsop_hour ?? '') : null },
            combined: { rows: combinedRows, outputLength: combinedRows.length, nonZeroRows: combinedRows.filter((r) => (readNum(r.whol_smtn_ntby_tr_pbmn) ?? 0) !== 0).length, selectedRow: combinedSelected, selectedBsopHour: combinedSelected ? String(combinedSelected.bsop_hour ?? '') : null },
          },
        },
      };
    }
    const result = kospi.diagnostics?.status === 'PROVIDER_ERROR' ? kospi : kosdaq;
    if (result.diagnostics && ['OK_EMPTY_OUTPUT', 'PROVIDER_ERROR'].includes(result.diagnostics.status)) {
      return {
        programNetBuyQty: null,
        programNetBuyAmount: null,
        programArbitrageNetBuy: null,
        programNonArbitrageNetBuy: null,
        programSellAmount: null,
        programBuyAmount: null,
        fetchedAt: new Date().toISOString(),
        source: 'KIS_API',
        marketProgramStatus: result.diagnostics.status,
        selectedPath: result.diagnostics.selectedPath,
        selectedBsopHour: result.diagnostics.selectedBsopHour,
        selectedReason: result.diagnostics.selectedReason,
        rowCount: result.diagnostics.rowCount,
        nonZeroRowCount: result.diagnostics.nonZeroRowCount,
        latest: result.diagnostics.latest,
        updated: result.diagnostics.updated,
        zeroReason: result.diagnostics.zeroReason,
        parseQuality: result.diagnostics.parseQuality,
        providerIssue: result.diagnostics.providerIssue,
        marketSignal: result.diagnostics.marketSignal,
        scoring: result.diagnostics.scoring,
        executionImpact: result.diagnostics.executionImpact,
        aggregateDiagnostic: result.diagnostics as unknown as Record<string, unknown>,
      };
    }
    return null;
  } catch (e) {
    console.error(
      '[KIS] 시장 종합 프로그램 매매 조회 실패:',
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

// ─── KIS 국내업종 기간별 지수 시세 (SectorEnergy 보조 fallback) ───────────────
//
// KIS 공식 오픈소스 (open-trading-api) 검증 — `[국내주식] 업종/기타 >
// 국내주식업종기간별시세(일/주/월/년) [v1_국내주식-021]`.
//   API_URL : /uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice
//   tr_id   : FHKUP03500100 (실전투자)
//   params  : FID_COND_MRKT_DIV_CODE='U' (업종) / FID_INPUT_ISCD=업종 상세코드 /
//             FID_INPUT_DATE_1=시작 / FID_INPUT_DATE_2=종료 / FID_PERIOD_DIV_CODE='D'
//   output1 : 업종 지수 현재 스냅샷 (bstp_nmix_prpr / bstp_nmix_prdy_ctrt / hts_kor_isnm)
//   output2 : 일자별 지수 OHLC 시계열 (stck_bsop_date / bstp_nmix_* / acml_vol)
//
// 정책: SectorEnergy 의 공식 원천은 KRX OpenAPI (`idx/kospi_dd_trd`). 본 함수는 KRX
// 실패 시 *임시 proxy / 보조 fallback* 으로만 사용 — ENV `KIS_SECTOR_INDEX_DAILY_ENABLED`
// default OFF. 명시 활성화 전까지 호출 0건. 본 PR 은 *callable 함수 신설* 만 —
// SectorEnergy live 파이프라인 wiring 은 후속 PR (ADR 문서화).


// ─── 시장 전체 투자자 수급 조회 ─────────────────────────────────────────────
// 종목별 투자자 수급은 fetchKisInvestorTradeByStockDaily (FHPTJ04160001) 단일 통로.

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
    const selected = pickMaterializedBucket(data, ['output2', 'output', 'output1'], (rows) => classifyShortPayload(rows, { trId: 'FHPST04830000' }));
    if (!selected) {
      const rows = pickKisRows(data);
      const payloadClass = classifyShortPayload(rows, { trId: 'FHPST04830000' });
      console.warn('[KIS] SHORT materialize skipped', payloadClass);
      return null;
    }
    const rows = selected.rows;
    const latest = rows[0];
    if (!latest) return null;
    const previous = rows[1];
    const shortSaleQty = extractKisNumberOptional(latest, ['ssts_cntg_qty', 'shts_cntg_qty', 'stss_cntg_qty', 'SSTS_CNTG_QTY', 'SHTS_CNTG_QTY', 'STSS_CNTG_QTY']);
    const shortSaleAmount = extractKisNumberOptional(latest, ['ssts_tr_pbmn', 'shts_tr_pbmn', 'stss_tr_pbmn', 'SSTS_TR_PBMN', 'SHTS_TR_PBMN', 'STSS_TR_PBMN']);
    const shortSaleRatio = extractKisNumberOptional(latest, ['ssts_tr_pbmn_rlim', 'ssts_vol_rlim', 'stss_rate', 'short_rate', 'SSTS_TR_PBMN_RLIM', 'SSTS_VOL_RLIM', 'STSS_RATE', 'SHORT_RATE']);
    const previousAmount = extractKisNumberOptional(previous, ['ssts_tr_pbmn', 'shts_tr_pbmn', 'stss_tr_pbmn', 'SSTS_TR_PBMN', 'SHTS_TR_PBMN', 'STSS_TR_PBMN']);
    const previousQty = extractKisNumberOptional(previous, ['ssts_cntg_qty', 'shts_cntg_qty', 'stss_cntg_qty', 'SSTS_CNTG_QTY', 'SHTS_CNTG_QTY', 'STSS_CNTG_QTY']);
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
  const bucketFixEnabled = isKisInvestorOutputBucketFixEnabled();
  // ADR-0542: 게이트 ON 시 output1+output2 합성을 위해 row 선택 버킷보다 raw 응답을 보존한다.
  // 게이트 OFF 면 selectedData 를 쓰지 않으므로 직전(단일 버킷) 동작과 byte-equivalent.
  try {
    let rows: KisOutput[] = [];
    let selectedData: unknown = null;
    const dateCandidates = investorTradeByStockDailyDateCandidates();
    for (let i = 0; i < dateCandidates.length; i += 1) {
      const sourceDate = dateCandidates[i];
      try {
        const data = await realDataKisGet(
          INVESTOR_TRADE_BY_STOCK_DAILY_TR_ID,
          INVESTOR_TRADE_BY_STOCK_DAILY_PATH,
          buildInvestorTradeByStockDailyParams(safeCode, sourceDate),
          priority,
        );
        if (isAcceptedEmptyKisResponse(data)) continue;
        const selected = pickMaterializedBucket(data, ['output2', 'output', 'output1'], (bucketRows) => classifyInvestorFlowPayload(bucketRows, { trId: INVESTOR_TRADE_BY_STOCK_DAILY_TR_ID }));
        rows = selected?.rows ?? [];
        selectedData = data;
        if (rows.length > 0) break;
      } catch (e) {
        if (i === dateCandidates.length - 1) throw e;
      }
    }
    const payloadClass = classifyInvestorFlowPayload(rows, { trId: INVESTOR_TRADE_BY_STOCK_DAILY_TR_ID });
    if (!payloadClass.materialized) {
      if (process.env.KIS_ONLY_TRACE === 'true') {
        // ADR-0542 Step 0 — 누락 종목의 버킷별 net-buy 존재 여부를 캡처해 가설(output1 vs output2)을 확증한다.
        console.warn('[KIS] INVESTOR_TRADE_BY_STOCK_DAILY materialize skipped', {
          ...payloadClass,
          bucketTrace: traceInvestorFlowBuckets(selectedData),
        });
      }
      return null;
    }
    const singleBucketRow = rows[0];
    if (!singleBucketRow) return null;

    // ADR-0542 — 게이트 ON: output1·output2·output 어느 버킷에 net-buy 가 있든 합성한다.
    // 게이트 OFF: 직전과 동일하게 선택 버킷 row[0] 만 사용 (byte-equivalent revert).
    const synthesized = bucketFixEnabled
      ? synthesizeInvestorFlowAcrossBuckets(selectedData, ['output2', 'output', 'output1'])
      : undefined;
    const row = synthesized?.baseRow ?? singleBucketRow;
    const baseBucket = synthesized?.baseBucket;

    const foreignNetBuy = bucketFixEnabled
      ? synthesized?.foreignNetBuy
      : extractKisNumberOptional(row, INVESTOR_FLOW_FOREIGN_NET_BUY_KEYS);
    const institutionalNetBuy = bucketFixEnabled
      ? synthesized?.institutionalNetBuy
      : extractKisNumberOptional(row, INVESTOR_FLOW_INSTITUTION_NET_BUY_KEYS);
    const individualNetBuy = bucketFixEnabled
      ? synthesized?.individualNetBuy
      : extractKisNumberOptional(row, INVESTOR_FLOW_INDIVIDUAL_NET_BUY_KEYS);
    if (foreignNetBuy === undefined || institutionalNetBuy === undefined) {
      if (process.env.KIS_ONLY_TRACE === 'true') {
        console.warn('[KIS] INVESTOR_TRADE_BY_STOCK_DAILY net-buy incomplete', {
          stockCode: safeCode,
          bucketFixEnabled,
          foreignNetBuyFinite: foreignNetBuy !== undefined,
          institutionalNetBuyFinite: institutionalNetBuy !== undefined,
          individualNetBuyFinite: individualNetBuy !== undefined,
          bucketTrace: traceInvestorFlowBuckets(selectedData),
        });
      }
      return null;
    }
    logInvestorFlowSelected(rows.length);
    const sourcePath = bucketFixEnabled && baseBucket
      ? `KIS_INVESTOR_TRADE_BY_STOCK_DAILY.${baseBucket}[0]`
      : 'KIS_INVESTOR_TRADE_BY_STOCK_DAILY.output2[0]';
    const actualInvestorFlowRowCarrier = buildKisActualInvestorFlowRowCarrier({
      row,
      safeCode,
      sourcePath,
      foreignNetBuy,
      institutionalNetBuy,
      individualNetBuy,
    });
    return {
      stockCode: safeCode,
      tradingDate: formatKisYmd(extractKisString(row, ['stck_bsop_date', 'STCK_BSOP_DATE'])),
      foreignNetBuy,
      institutionalNetBuy,
      ...(individualNetBuy !== undefined ? { individualNetBuy } : {}),
      source: 'KIS_API',
      fetchedAt: new Date().toISOString(),
      actualRows: actualInvestorFlowRowCarrier.actualRows,
      actualInvestorFlowRowCarrier,
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
      foreignNetBuy,
      institutionalNetBuy,
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

// ─── 주식 전체 시세 조회 (FHKST01010100) ───────────────────────────────────────

export interface KisStockFullQuote {
  code: string;
  currentPrice: number | null;
  volume: number | null;
  changePercent: number | null;
  prevClose: number | null;
  fetchedAt: string;
  // Gate2 PER dedup (정본 데이터 SSOT, patch): 동일 FHKST01010100 응답에 이미 존재하는
  // valuation 필드를 보존해 Gate2 PER 재호출을 제거. fetchGate2PerValuation 과 동일 추출 키.
  per?: number | null;          // per/PER/hts_per/HTS_PER 중 첫 finite
  eps?: number | null;          // eps/EPS/stac_eps/STAC_EPS 중 첫 finite
  listedShares?: number | null; // lstn_stcn/LSTN_STCN/listedShares 중 첫 positive
}

/**
 * fetchGate2PerValuation 의 finiteNumber 헬퍼와 byte-equivalent 한 숫자 강제 변환.
 * (콤마·% 제거 후 Number 변환 — parseFloat 아님). 동일 값 보장을 위해 동일 규약 사용.
 */
function valuationFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.replace(/,/g, '').replace(/%/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * FHKST01010100 output 에서 첫 번째 finite 숫자를 반환 (fetchGate2PerValuation 추출 규약과 동일).
 */
function firstFiniteFromOutput(out: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = valuationFiniteNumber(out[key]);
    if (value != null) return value;
  }
  return null;
}

/**
 * FHKST01010100 한 번의 라운드트립으로 현재가·누적거래량·등락률·전일종가를 반환한다.
 * (정본 데이터 SSOT, patch) 동일 응답의 per/eps/listedShares 도 함께 보존하여 Gate2 PER 중복 호출을 제거한다.
 * KIS 미설정 시 null. 호출자는 null-safe 처리 필수.
 */
export async function fetchKisStockFullQuote(stockCode: string): Promise<KisStockFullQuote | null> {
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return null;
  const code = stockCode.padStart(6, '0');
  const fetchedAt = new Date().toISOString();
  try {
    const data = await realDataKisGet('FHKST01010100', '/uapi/domestic-stock/v1/quotations/inquire-price', {
      FID_COND_MRKT_DIV_CODE: 'J',
      FID_INPUT_ISCD: code,
    });
    const out = (data as { output?: Record<string, string> } | null)?.output;
    if (!out) return null;
    const currentPrice = parseInt(out.stck_prpr ?? '0', 10);
    const volume = parseInt(out.acml_vol ?? '0', 10);
    const prevClose = parseInt(out.stck_sdpr ?? '0', 10);
    const changePercent = parseFloat(out.prdy_ctrt ?? 'NaN');
    // 정본 데이터 SSOT(Gate2 PER dedup, patch): fetchGate2PerValuation(L559·L562·L563) 과 동일 키·동일 추출 — 동일 값 보장.
    const per = firstFiniteFromOutput(out, ['per', 'PER', 'hts_per', 'HTS_PER']);
    const eps = firstFiniteFromOutput(out, ['eps', 'EPS', 'stac_eps', 'STAC_EPS']);
    const listedSharesRaw = firstFiniteFromOutput(out, ['lstn_stcn', 'LSTN_STCN', 'listedShares']);
    const listedShares = listedSharesRaw != null && listedSharesRaw > 0 ? listedSharesRaw : null;
    return {
      code,
      currentPrice: currentPrice > 0 ? currentPrice : null,
      volume: volume > 0 ? volume : null,
      changePercent: Number.isFinite(changePercent) ? changePercent : null,
      prevClose: prevClose > 0 ? prevClose : null,
      fetchedAt,
      per,
      eps,
      listedShares,
    };
  } catch (err) {
    logger.warn(`[KIS] fetchKisStockFullQuote ${code} 실패:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── 일봉 OHLC 조회 (FHKST03010100) ────────────────────────────────────────────

export interface KisStockDailyBar {
  date: string;
  close: number;
  volume: number | null;
}

/**
 * FHKST03010100 일봉 시계열을 lookbackCalendarDays 범위만큼 조회한다.
 * bars[0] = 가장 최근 거래일 (내림차순). KIS 미설정 시 빈 배열.
 */
export async function fetchKisStockDailyBars(
  stockCode: string,
  lookbackCalendarDays = 35,
): Promise<KisStockDailyBar[]> {
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return [];
  const code = stockCode.padStart(6, '0');
  const today = _kstDateStr().replace(/-/g, '');
  const startYmd = _kstDateStrOffset(-lookbackCalendarDays).replace(/-/g, '');
  try {
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
    if (!Array.isArray(output2)) return [];
    return output2
      .map((row): KisStockDailyBar | null => {
        const ymd = row.stck_bsop_date ?? '';
        if (!/^\d{8}$/.test(ymd)) return null;
        const close = parseInt(row.stck_clpr ?? '0', 10);
        if (close <= 0) return null;
        const vol = parseInt(row.acml_vol ?? '0', 10);
        return {
          date: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`,
          close,
          volume: vol > 0 ? vol : null,
        };
      })
      .filter((b): b is KisStockDailyBar => b !== null);
  } catch (err) {
    logger.warn(`[KIS] fetchKisStockDailyBars ${code} 실패:`, err instanceof Error ? err.message : err);
    return [];
  }
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
