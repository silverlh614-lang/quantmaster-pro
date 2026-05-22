// @responsibility krxClient 외부 클라이언트 모듈
/**
 * krxClient.ts — 한국거래소(KRX) 정보데이터시스템 OpenAPI 어댑터 (아이디어 2)
 *
 * 단일 책임: data.krx.co.kr 공개 엔드포인트에서 합법·무료 시장 데이터를 받아
 * 일관된 스키마로 변환한다. KIS 랭킹 TR 장애 시 stockScreener가 이 어댑터로
 * 폴백하도록 설계되어 있으며, 네이버 스크래핑을 완전히 대체한다.
 *
 * 제공 함수:
 *   - fetchInvestorTrading(date)  — 투자자별 거래실적(외국인/기관/개인)
 *   - fetchPerPbr(date)           — 상장종목 PER/PBR/배당수익률
 *   - fetchShortBalance(date)     — 공매도 잔고 상위
 *
 * 설계 원칙:
 *   1. 네트워크 실패·파싱 실패·JSON 이상은 전부 [] (빈 배열) 반환. throw 하지 않는다.
 *   2. 메모리 캐시 (TTL 10분) — 반복 호출에도 API 부하를 주지 않는다.
 *   3. KRX_PUBLIC_API_BASE 환경변수로 공개 엔드포인트 라우팅(사내 프록시 등) 가능.
 *      ※ 블루프린트의 KRX_API_BASE 는 인증 OpenAPI 전용이므로 네임스페이스를 분리했다.
 *   4. KRX_API_DISABLED=true 면 호출 없이 즉시 빈 배열 — 네트워크가 막힌 환경 보호.
 *
 * KRX 공개 엔드포인트는 HTML 폼을 통한 동적 JSON 응답을 제공한다
 *   POST http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd
 *     body: application/x-www-form-urlencoded
 *           bld=<페이지 내부 식별자>
 *           <각 보고서별 파라미터>
 *
 * 호출자가 날짜를 넘기지 않으면 "직전 영업일" 개념으로 KST 오늘 하루 전을 사용한다.
 */

import { logger, logVisibilityEvent } from '../utils/logger.js';


// ADR-0502c Phase 2: `krxGet as _openApiGet` 는 ./krxClient/http.ts 가 단독 import.
import {
  fetchKospiDailyTrade,
  fetchKosdaqDailyTrade,
  fetchKospiIndexDaily,
  fetchKosdaqIndexDaily,
  fetchKrxIndexDaily,
  isKrxOpenApiHealthy,
  getKrxOpenApiStatus,
  type KrxStockDailyRow,
  type KrxIndexDailyRow,
} from './krxOpenApi.js';
import { getStockByCode } from '../persistence/krxStockMasterRepo.js';
// ADR-0502c Phase 2: isMarketDataPublished / isKstWeekend 는 ./krxClient/http.ts SSOT 안으로 이동.

// ── 타입 (ADR-0502c 분해 — types.ts SSOT) ────────────────────────────────────
export type {
  KrxInvestorRow,
  KrxInvestorParserStatus,
  KrxInvestorTradingDiagnostic,
  KrxPerPbrRow,
  KrxShortBalanceRow,
  KrxInvestorDetailRow,
  KrxMarketCapRow,
  FetchInvestorTradingOptions,
  KrxRawResponse,
  KrxPostMeta,
  KrxInvestorEndpointVariant,
  ParsedKrxCsv,
  ExtractRowsResult,
  NormalizedInvestorRowsResult,
  KrxIsuCdResolution,
} from './krxClient/types.js';
import type {
  KrxInvestorRow,
  KrxInvestorParserStatus,
  KrxInvestorTradingDiagnostic,
  KrxPerPbrRow,
  KrxShortBalanceRow,
  KrxInvestorDetailRow,
  KrxMarketCapRow,
  FetchInvestorTradingOptions,
  KrxRawResponse,
  KrxPostMeta,
  KrxInvestorEndpointVariant,
  ParsedKrxCsv,
  ExtractRowsResult,
  NormalizedInvestorRowsResult,
  KrxIsuCdResolution,
} from './krxClient/types.js';

// ── 설정 (ADR-0502c 분해 — constants.ts SSOT) ───────────────────────────────
// Phase 2: HTTP layer 전용 상수·헬퍼 (KRX_JSON_PATH / KRX_OTP_PATH /
// KRX_DOWNLOAD_CSV_PATH / REQUEST_TIMEOUT_MS / KRX_USER_AGENT /
// BLD_KIS_FIRST_QUARANTINE_THRESHOLD / isKisFirstRebuildMode /
// isKisOnlyRebuildMode / krxDisabledStatus / krxDisabledReasonMessage) 와
// 회로 상수 (BLD_FAILURE_THRESHOLD / BLD_COOLDOWN_MS / RECOVERY_PROBE_WINDOW_MS)
// 는 ./krxClient/{http,cooldown}.ts SSOT 안으로 이동.
import {
  KRX_BASE,
  KRX_DISABLED,
  CACHE_TTL_MS,
  BLD_INVESTOR_TRADING,
  BLD_PER_PBR,
  BLD_SHORT_BALANCE,
  BLD_INVESTOR_DETAIL,
  isKrxAutoFetchDisabled,
  krxAutoFetchDisabledReason,
} from './krxClient/constants.js';

export { isKrxAutomaticFetchDisabled } from './krxClient/constants.js';

// ── 캐시 (ADR-0502c — cache.ts SSOT) ─────────────────────────────────────────
import {
  getCached,
  setCached,
  setInvestorTradingDiagnostic,
  listCacheKeys,
  resetCacheState,
} from './krxClient/cache.js';
import { resetCooldownState as _resetCooldownState } from './krxClient/cooldown.js';
export { getLastKrxInvestorTradingDiagnostic } from './krxClient/cache.js';

/**
 * 전체 in-memory state 초기화. cache + cooldown + http meta clear.
 * 외부 호출자 진입점 (테스트 격리 + /api/system/reset).
 * ADR-0502c Phase 2: http meta state 가 ./krxClient/http.ts SSOT 로 이전 —
 * `clearLastKrxPostMetaState()` 위임 호출.
 */
export function resetKrxCache(): void {
  resetCacheState();
  _resetCooldownState();
  clearLastKrxPostMetaState();
  resetKrxInvestorDetailSafeProbeGuardState();
}

// ── ADR-0009 / 0259 회로 (ADR-0502c — cooldown.ts SSOT) ──────────────────────
// Phase 2: 6 회로 함수 (isBldCooldown / shouldSkipForRecoveryProbe /
// markRecoveryProbed / recordBldFailure / recordBldSuccess / getBldFailureState)
// 는 ./krxClient/http.ts SSOT 안에서 사용. otpCsv 는 recordBldSuccess 만 사용.
// 본 파일은 진단 read-only export (getKrxBldFailureStates) 만 노출.
export { getKrxBldFailureStates } from './krxClient/cooldown.js';

// ── ADR-0256 시간대 게이팅 (ADR-0502c — timeWindow.ts SSOT) ──────────────────
export { shouldSkipKrxCallByTimeWindow } from './krxClient/timeWindow.js';

// ── 날짜 유틸 (ADR-0502c — dateUtils.ts SSOT) ────────────────────────────────
import {
  todayKstYYYYMMDD,
  isValidYyyymmdd,
  previousBusinessDayYYYYMMDD,
  resolveTradeDate,
  compactTradeDate,
} from './krxClient/dateUtils.js';

// ── HTTP layer (ADR-0502c Phase 2 — http.ts SSOT) ────────────────────────────
// KrxRawResponse / KrxPostMeta / KrxInvestorEndpointVariant / ParsedKrxCsv 등
// 도메인 타입은 ./krxClient/types.ts SSOT 로 분리 (Phase 1). HTTP 본체 +
// payload sanitize / meta state / krxGet 위임은 본 Phase 2 에서 분리.
import {
  krxPost,
  getLastKrxPostMeta,
  clearLastKrxPostMetaState,
  sanitizeKrxPayload,
  allowedKrxPayloadKeys,
  validateKrxPayloadForVariantAdr0526,
  buildKrxAutoDisabledDiagnostic,
} from './krxClient/http.js';
// setKrxPostMeta / classifyContentType / makeKrxResponseKind / buildKrxOtpPayload
// 는 ./krxClient/{http,otpCsv}.ts 내부에서만 사용 — 본 파일 export 0건.

// __krxClientTestOnly — 외부 회귀 테스트가 호출하는 thin re-export.
// sanitizeKrxPayload + buildKrxAutoDisabledDiagnostic 시그니처 byte-equivalent 보존.
export const __krxClientTestOnly = {
  sanitizeKrxPayload,
  allowedKrxPayloadKeys,
  validateKrxPayloadForVariantAdr0526,
  buildKrxAutoDisabledDiagnostic,
  hasKrxInvestorDetailRequiredParams,
};

// ── CSV 파서 + OTP-CSV flow (ADR-0502c Phase 2 — csv.ts + otpCsv.ts SSOT) ────
import { krxInvestorOtpCsv } from './krxClient/otpCsv.js';


const INVESTOR_ROW_CANDIDATE_KEYS = ['OutBlock_1', 'output', 'output1', 'output2', 'data', 'csv', 'list', 'rows', 'result', 'block1'] as const;
const INVESTOR_DETAIL_SAFE_PROBE_ENDPOINTS = new Set(['MDCSTAT02201', 'MDCSTAT02203']);
const INVESTOR_DETAIL_SAFE_PROBE_COOLDOWN_MS = 60 * 60 * 1000;

type KrxEndpointGuardReason =
  | 'SESSION_CLOSED_NOT_APPLICABLE'
  | 'ENDPOINT_PARAM_NOT_READY'
  | 'BAD_REQUEST_SESSION_OR_PARAM';

const krxInvestorDetailGuardCooldown = new Map<string, number>();
const krxInvestorDetailGuardLogState = new Map<string, { lastEmittedAt: number; suppressedCount: number }>();

function resetKrxInvestorDetailSafeProbeGuardState(): void {
  krxInvestorDetailGuardCooldown.clear();
  krxInvestorDetailGuardLogState.clear();
}

function kstDateParts(now: Date): { day: number; hour: number; minute: number } {
  const kst = new Date(now.getTime() + 9 * 60 * 60_000);
  return {
    day: kst.getUTCDay(),
    hour: kst.getUTCHours(),
    minute: kst.getUTCMinutes(),
  };
}

function isKrxInvestorDetailIntradaySession(now: Date): boolean {
  if (process.env.KRX_TIME_WINDOW_GATING_DISABLED === 'true') return true;
  if (process.env.DATA_FETCH_FORCE_MARKET === 'true') return true;
  if (process.env.DATA_FETCH_FORCE_OFF === 'true') return false;
  const { day, hour, minute } = kstDateParts(now);
  if (day === 0 || day === 6) return false;
  const minutes = hour * 60 + minute;
  return minutes >= 9 * 60 && minutes <= 15 * 60 + 30;
}

function isKrxInvestorDetailSafeProbeEndpoint(endpoint: string): boolean {
  return INVESTOR_DETAIL_SAFE_PROBE_ENDPOINTS.has(endpoint);
}

function krxInvestorDetailProbeEnabled(): boolean {
  return process.env.KRX_INVESTOR_DETAIL_ENABLED === 'true';
}

function krxInvestorDetailGuardCooldownKey(input: {
  endpoint: string;
  session: 'CLOSED' | 'INTRADAY';
  tradeDate: string;
}): string {
  return `provider=KRX:module=INVESTOR_DETAIL:endpoint=${input.endpoint}:session=${input.session}:date=${input.tradeDate}`;
}

function activeKrxInvestorDetailGuardCooldown(input: {
  endpoint: string;
  session: 'CLOSED' | 'INTRADAY';
  tradeDate: string;
  now: Date;
}): number {
  const cooldownUntil = krxInvestorDetailGuardCooldown.get(krxInvestorDetailGuardCooldownKey(input)) ?? 0;
  return Math.max(0, cooldownUntil - input.now.getTime());
}

function recordKrxInvestorDetailBadRequestCooldown(input: {
  endpoint: string;
  tradeDate: string;
  now: Date;
}): void {
  krxInvestorDetailGuardCooldown.set(
    krxInvestorDetailGuardCooldownKey({ endpoint: input.endpoint, session: 'INTRADAY', tradeDate: input.tradeDate }),
    input.now.getTime() + INVESTOR_DETAIL_SAFE_PROBE_COOLDOWN_MS,
  );
}

function emitKrxInvestorDetailGuard(input: {
  endpoint: string;
  reason: KrxEndpointGuardReason;
  intradaySession: boolean;
  enabled: boolean;
  now: Date;
}): void {
  const key = `${input.endpoint}:${input.reason}:${input.intradaySession ? 'INTRADAY' : 'CLOSED'}:${input.enabled ? 'ENABLED' : 'DISABLED'}`;
  const state = krxInvestorDetailGuardLogState.get(key);
  const elapsed = state ? input.now.getTime() - state.lastEmittedAt : Number.POSITIVE_INFINITY;
  if (!state || elapsed >= INVESTOR_DETAIL_SAFE_PROBE_COOLDOWN_MS) {
    if (state && state.suppressedCount > 0) {
      logVisibilityEvent({
        visibility: 'SUMMARY',
        category: 'KRX',
        message:
        `[KRX_ENDPOINT_GUARD_SUPPRESSED] endpoint=${input.endpoint}` +
        ` reason=${input.reason}` +
        ` suppressedCount=${state.suppressedCount}` +
        ' executionImpact=NONE',
        summary: { endpoint: input.endpoint, reason: input.reason, suppressedCount: state.suppressedCount, executionImpact: 'NONE' },
        details: { input },
        level: 'info',
        executionImpact: 'NONE',
      });
    }
    logVisibilityEvent({
      visibility: 'DIAGNOSTIC',
      category: 'KRX',
      dedupKey: `KRX_ENDPOINT_GUARDED:${input.reason}:${input.endpoint}:NONE`,
      message:
      `[KRX_ENDPOINT_GUARDED] endpoint=${input.endpoint}` +
      ` reason=${input.reason}` +
      ` intradaySession=${String(input.intradaySession)}` +
      ` enabled=${String(input.enabled)}` +
      ' providerIssue=false marketSignal=false executionImpact=NONE',
      summary: { endpoint: input.endpoint, reason: input.reason, providerIssue: false, marketSignal: false, executionImpact: 'NONE' },
      details: { input },
      level: 'info',
      executionImpact: 'NONE',
    });
    krxInvestorDetailGuardLogState.set(key, { lastEmittedAt: input.now.getTime(), suppressedCount: 0 });
    return;
  }
  state.suppressedCount += 1;
}

// ADR-0502c: ExtractRowsResult 정의는 ./krxClient/types.ts 로 이동.

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every((row) => row && typeof row === 'object' && !Array.isArray(row));
}

function collectArrayCandidates(raw: KrxRawResponse | null): Array<{ path: string; rows: Record<string, unknown>[] }> {
  if (!raw || typeof raw !== 'object') return [];
  const out: Array<{ path: string; rows: Record<string, unknown>[] }> = [];
  const root = raw as Record<string, unknown>;
  const visitKey = (path: string, value: unknown): void => {
    if (isRecordArray(value)) out.push({ path, rows: value });
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      for (const key of INVESTOR_ROW_CANDIDATE_KEYS) {
        if (Object.prototype.hasOwnProperty.call(nested, key) && isRecordArray(nested[key])) {
          out.push({ path: `${path}.${key}`, rows: nested[key] as Record<string, unknown>[] });
        }
      }
    }
  };
  for (const key of INVESTOR_ROW_CANDIDATE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(root, key)) visitKey(key, root[key]);
  }
  for (const [key, value] of Object.entries(root)) visitKey(key, value);
  return out.filter((candidate, index, arr) => arr.findIndex((other) => other.path === candidate.path) === index);
}

/** KRX 응답에서 가장 그럴듯한 row 배열을 추출한다. 스키마 불명 시 첫 배열 사용. */
function extractRowsDetailed(raw: KrxRawResponse | null): ExtractRowsResult {
  const candidates = collectArrayCandidates(raw);
  const preferred = candidates.find((candidate) => INVESTOR_ROW_CANDIDATE_KEYS.some((key) => candidate.path === key && candidate.rows.length > 0))
    ?? candidates.find((candidate) => candidate.rows.length > 0)
    ?? candidates[0]
    ?? null;
  return {
    rows: preferred?.rows ?? [],
    detectedCandidatePaths: candidates.map((candidate) => `${candidate.path}:len=${candidate.rows.length}`),
    selectedRowPath: preferred?.path ?? null,
    firstRowKeys: preferred?.rows[0] ? Object.keys(preferred.rows[0]).slice(0, 40) : [],
  };
}

function extractRows(raw: KrxRawResponse | null): Record<string, unknown>[] {
  return extractRowsDetailed(raw).rows;
}

function rawValueByAliases(row: Record<string, unknown>, aliases: readonly string[]): { key: string | null; value: unknown } {
  for (const key of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return { key, value: row[key] };
  }
  const lowerEntries = new Map(Object.keys(row).map((key) => [key.toLowerCase(), key]));
  for (const alias of aliases) {
    const actual = lowerEntries.get(alias.toLowerCase());
    if (actual) return { key: actual, value: row[actual] };
  }
  return { key: null, value: undefined };
}

function strByAliases(row: Record<string, unknown>, aliases: readonly string[]): { key: string | null; value: string } {
  const hit = rawValueByAliases(row, aliases);
  return { key: hit.key, value: hit.value == null ? '' : String(hit.value).trim() };
}

function numByAliases(row: Record<string, unknown>, aliases: readonly string[]): { key: string | null; value: number } {
  const hit = rawValueByAliases(row, aliases);
  return { key: hit.key, value: toNum(hit.value) };
}

const KRX_INVESTOR_ALIASES = {
  symbol: ['ISU_SRT_CD', 'ISU_CD', 'isuSrtCd', 'isuCd', 'symbol', 'code', 'shortCode', '종목코드'],
  name: ['ISU_ABBRV', 'ISU_NM', 'isuAbrv', 'isuNm', 'name', 'symbolName', '종목명'],
  date: ['TRD_DD', 'BAS_DD', 'trdDd', 'baseDate', 'date', 'sourceDate', '일자', '기준일'],
  investorType: ['INVST_TP_NM', 'INVSTR_TP_NM', 'INVESTOR_TP_NM', 'invstTpNm', 'investorType', 'investor', 'INVST_TP', '투자자구분', '투자자'],
  foreignNetBuy: ['FORN_INVSTR_NETBY_QTY', 'FORN_NETBY_QTY', 'FORN_BUY_SELL_NET_QTY', 'FRGN_NETBY_QTY', 'foreignNetBuy', 'frgnNetBuy', '외국인순매수'],
  institutionNetBuy: ['ORGN_INVSTR_NETBY_QTY', 'ORGN_NETBY_QTY', 'ORG_NETBY_QTY', 'INST_NETBY_QTY', 'institutionNetBuy', 'institutionalNetBuy', 'orgNetBuy', '기관순매수'],
  individualNetBuy: ['INDIV_INVSTR_NETBY_QTY', 'PRVT_NETBY_QTY', 'IDV_NETBY_QTY', 'retailNetBuy', 'individualNetBuy', '개인순매수'],
  netBuyAmount: ['NETBY_TRDVAL', 'NET_BUY_AMT', 'NETBID_TRDVAL', 'netBuyAmount', '순매수거래대금'],
  netBuyVolume: ['NETBY_QTY', 'NET_BUY_QTY', 'NETBID_TRDVOL', 'netBuyVolume', 'netBuyQty', '순매수수량'],
} as const;

function investorBucket(value: string): 'foreign' | 'institution' | 'individual' | null {
  const normalized = value.replace(/\s+/g, '');
  if (/외국인|foreign|foreigner|frgn|forn/i.test(normalized)) return 'foreign';
  if (/기관|institution|orgn|inst/i.test(normalized)) return 'institution';
  if (/개인|individual|retail|prvt|idv/i.test(normalized)) return 'individual';
  return null;
}

// ADR-0502c: NormalizedInvestorRowsResult 정의는 ./krxClient/types.ts 로 이동.

function normalizeKrxInvestorRows(rows: Record<string, unknown>[]): NormalizedInvestorRowsResult {
  const byCode = new Map<string, KrxInvestorRow>();
  const fieldMappings: KrxInvestorTradingDiagnostic['fieldMappings'] = {
    symbol: null,
    date: null,
    investorType: null,
    foreignNetBuy: null,
    institutionNetBuy: null,
    individualNetBuy: null,
    netBuyAmount: null,
    netBuyVolume: null,
  };
  const remember = (field: keyof typeof fieldMappings, key: string | null): void => {
    if (!fieldMappings[field] && key) fieldMappings[field] = key;
  };
  for (const r of rows) {
    const symbol = strByAliases(r, KRX_INVESTOR_ALIASES.symbol);
    remember('symbol', symbol.key);
    const code = normalizeCode(symbol.value);
    if (!code) continue;
    const name = strByAliases(r, KRX_INVESTOR_ALIASES.name).value;
    const existing = byCode.get(code) ?? { code, name, foreignNetBuy: 0, institutionNetBuy: 0, individualNetBuy: 0 };
    if (!existing.name && name) existing.name = name;

    const foreign = numByAliases(r, KRX_INVESTOR_ALIASES.foreignNetBuy);
    const institution = numByAliases(r, KRX_INVESTOR_ALIASES.institutionNetBuy);
    const individual = numByAliases(r, KRX_INVESTOR_ALIASES.individualNetBuy);
    remember('foreignNetBuy', foreign.key);
    remember('institutionNetBuy', institution.key);
    remember('individualNetBuy', individual.key);
    const hasWideField = Boolean(foreign.key || institution.key || individual.key);
    if (hasWideField) {
      existing.foreignNetBuy += foreign.value;
      existing.institutionNetBuy += institution.value;
      existing.individualNetBuy += individual.value;
      byCode.set(code, existing);
      continue;
    }

    const investorType = strByAliases(r, KRX_INVESTOR_ALIASES.investorType);
    remember('investorType', investorType.key);
    const netBuyVolume = numByAliases(r, KRX_INVESTOR_ALIASES.netBuyVolume);
    const netBuyAmount = numByAliases(r, KRX_INVESTOR_ALIASES.netBuyAmount);
    remember('netBuyVolume', netBuyVolume.key);
    remember('netBuyAmount', netBuyAmount.key);
    const netBuy = netBuyVolume.key ? netBuyVolume.value : netBuyAmount.value;
    const bucket = investorBucket(investorType.value);
    if (bucket === 'foreign') existing.foreignNetBuy += netBuy;
    if (bucket === 'institution') existing.institutionNetBuy += netBuy;
    if (bucket === 'individual') existing.individualNetBuy += netBuy;
    if (bucket && (netBuyVolume.key || netBuyAmount.key)) byCode.set(code, existing);
  }
  return { rows: [...byCode.values()], fieldMappings };
}

function classifyInvestorParserStatus(input: {
  raw: KrxRawResponse | null;
  extractedRows: number;
  normalizedRows: number;
  meta: KrxPostMeta | undefined;
  fieldMappings: KrxInvestorTradingDiagnostic['fieldMappings'];
}): KrxInvestorParserStatus {
  if (!input.raw || input.meta?.responseKind === 'EMPTY' || input.meta?.responseKind === 'GATED' || input.meta?.responseKind === 'COOLDOWN' || input.meta?.responseKind === 'HTTP_ERROR') return 'PROVIDER_EMPTY_RESPONSE';
  if (input.extractedRows <= 0) return 'PARSER_KEY_MISMATCH';
  if (input.normalizedRows <= 0 || !input.fieldMappings.symbol || (!input.fieldMappings.foreignNetBuy && !input.fieldMappings.investorType)) return 'PARSER_FIELD_MISMATCH';
  return 'OK';
}

function endpointIssueHintForInvestorParser(input: {
  status: KrxInvestorParserStatus;
  meta: KrxPostMeta | undefined;
  fieldMappings: KrxInvestorTradingDiagnostic['fieldMappings'];
  rawTopLevelKeys: string[];
}): KrxInvestorTradingDiagnostic['endpointIssueHint'] {
  if (input.status === 'OK') return 'NONE';
  if (input.meta?.responseKind === 'GATED') return 'MARKET_CLOSED_NO_PREVIOUS_SAMPLE';
  if (input.meta?.selectedKrxFlowMode === 'OTP_CSV' && input.meta.csvDownloaded !== true) return 'OTP_OR_HEADER_ERROR';
  if (input.meta?.selectedKrxFlowMode === 'OTP_CSV' && input.meta.csvDownloaded === true && (input.meta.csvRowCount ?? 0) === 0) return 'ENDPOINT_PARAMETER_ERROR';
  if (input.meta?.responseKind === 'HTTP_ERROR') return input.meta.httpStatus === 400 ? 'ENDPOINT_PARAMETER_ERROR' : 'OTP_OR_HEADER_ERROR';
  if (input.status === 'PARSER_KEY_MISMATCH') return input.rawTopLevelKeys.length === 0 ? 'OTP_OR_HEADER_ERROR' : 'SCHEMA_KEY_CHANGED';
  if (input.status === 'PARSER_FIELD_MISMATCH') return !input.fieldMappings.symbol ? 'SYMBOL_CODE_FORMAT_ERROR' : 'FIELD_ALIAS_CHANGED';
  return 'ENDPOINT_PARAMETER_ERROR';
}

function buildInvestorTradingDiagnostic(input: {
  raw: KrxRawResponse | null;
  tradeDate: string;
  extract: ExtractRowsResult;
  normalized: NormalizedInvestorRowsResult;
  variant?: KrxInvestorEndpointVariant | null;
  attemptedVariants?: string[];
}): KrxInvestorTradingDiagnostic {
  const variant = input.variant ?? null;
  const bld = variant?.bld ?? BLD_INVESTOR_TRADING;
  // ADR-0502c Phase 2: meta state SSOT 가 ./krxClient/http.ts 로 이동 — getLastKrxPostMeta() 위임.
  const meta = getLastKrxPostMeta(bld);
  const rawTopLevelKeys = input.raw && typeof input.raw === 'object' ? Object.keys(input.raw).slice(0, 40) : [];
  const parserStatus = classifyInvestorParserStatus({
    raw: input.raw,
    extractedRows: input.extract.rows.length,
    normalizedRows: input.normalized.rows.length,
    meta,
    fieldMappings: input.normalized.fieldMappings,
  });
  const endpointIssueHint = endpointIssueHintForInvestorParser({
    status: parserStatus,
    meta,
    fieldMappings: input.normalized.fieldMappings,
    rawTopLevelKeys,
  });
  const contentType = meta?.contentType ?? 'unknown';
  const httpStatus = meta?.httpStatus ?? null;
  const responseKind = meta?.responseKind ?? (input.raw ? 'JSON' : 'EMPTY');
  const summary = [
    variant?.endpoint ?? endpointCodeFromBld(bld),
    `selectedKrxFlowMode=${meta?.selectedKrxFlowMode ?? variant?.mode ?? 'DIRECT_JSON'}`,
    `payloadMode=${meta?.payloadMode ?? variant?.payloadMode ?? 'EXTENDED_VARIANT'}`,
    `routePurpose=${variant?.routePurpose ?? 'UNKNOWN'}`,
    `selectedBld=${bld}`,
    `requiredParamMissing=${variant?.requiredParamMissing ?? 'NONE'}`,
    `shortCodeToIsuCdResolved=${String(variant?.shortCodeToIsuCdResolved ?? false)}`,
    `isuCd=${variant?.isuCd ?? 'NONE'}`,
    `inqTpCd=${variant?.inqTpCd ?? 'NONE'}`,
    `inqVal=${variant?.inqVal ?? 'NONE'}`,
    `detailView=${variant?.detailView ?? 'NONE'}`,
    `variant=${variant?.id ?? 'LEGACY_SINGLE'}`,
    `routeKind=${variant?.routeKind ?? 'UNKNOWN'}`,
    `dateParam=${variant?.dateParam ?? 'UNKNOWN'}`,
    `marketCode=${variant?.marketCode ?? 'UNKNOWN'}`,
    `symbolCode=${variant?.symbolCode ?? 'NONE'}`,
    `otpGenerated=${String(meta?.otpGenerated ?? false)}`,
    `otpLength=${meta?.otpLength ?? 0}`,
    `csvDownloaded=${String(meta?.csvDownloaded ?? false)}`,
    `csvRowCount=${meta?.csvRowCount ?? 0}`,
    `csvColumnKeys=${meta?.csvColumnKeys?.join(',') || 'NONE'}`,
    `csvFailureReason=${meta?.csvFailureReason ?? 'NONE'}`,
    `csvHeaderDetected=${String(meta?.csvHeaderDetected ?? false)}`,
    `csvNoDataReason=${meta?.csvNoDataReason ?? 'NONE'}`,
    `omittedKeys=${meta?.omittedKeys?.join(',') || 'NONE'}`,
    `forbiddenKeysPresent=${meta?.forbiddenKeysPresent?.join(',') || 'NONE'}`,
    `requiredKeysPresent=${meta?.requiredKeysPresent?.join(',') || 'NONE'}`,
    `requiredKeysMissing=${meta?.requiredKeysMissing?.join(',') || 'NONE'}`,
    `sentPayloadKeys=${meta?.sentPayloadKeys?.join(',') || 'NONE'}`,
    `allowedKeys=${meta?.allowedKeys?.join(',') || 'NONE'}`,
    `payloadValidation=${meta?.payloadValidation ?? 'PASS'}`,
    `paramKeys=${variant ? Object.keys(variant.params).join(',') : 'UNKNOWN'}`,
    `attemptedVariants=${input.attemptedVariants?.join('|') || variant?.id || 'LEGACY_SINGLE'}`,
    `contentType=${contentType}`,
    `responseKind=${responseKind}`,
    `httpStatus=${httpStatus ?? 'NONE'}`,
    `consecutiveFailures=${meta?.consecutiveFailures ?? 0}`,
    `cooldownActive=${String(meta?.cooldownActive ?? false)}`,
    `cooldownRemainingMs=${meta?.cooldownRemainingMs ?? 0}`,
    `offHoursSuppressed=${String(meta?.offHoursSuppressed ?? false)}`,
    `diagnosticOnly=${String(meta?.diagnosticOnly ?? false)}`,
    `useForRouter=${String(meta?.useForRouter ?? true)}`,
    `useForGate=${String(meta?.useForGate ?? true)}`,
    `useForLive=${String(meta?.useForLive ?? false)}`,
    `useForShadow=${String(meta?.useForShadow ?? true)}`,
    `rawKeys=${rawTopLevelKeys.join(',') || 'NONE'}`,
    `candidatePaths=${input.extract.detectedCandidatePaths.join(',') || 'NONE'}`,
    `selectedRowPath=${input.extract.selectedRowPath ?? 'NONE'}`,
    `rows=${input.extract.rows.length}`,
    `normalizedRows=${input.normalized.rows.length}`,
    `firstRowKeys=${input.extract.firstRowKeys.join(',') || 'NONE'}`,
    `parserStatus=${parserStatus}`,
    `endpointIssueHint=${endpointIssueHint}`,
  ].join(';');
  return {
    endpoint: variant?.endpoint ?? endpointCodeFromBld(bld),
    bld,
    tradeDate: input.tradeDate,
    selectedKrxFlowMode: meta?.selectedKrxFlowMode ?? variant?.mode ?? 'DIRECT_JSON',
    payloadMode: meta?.payloadMode ?? variant?.payloadMode,
    routePurpose: variant?.routePurpose,
    selectedBld: bld,
    requiredParamMissing: variant?.requiredParamMissing ?? null,
    shortCodeToIsuCdResolved: variant?.shortCodeToIsuCdResolved ?? false,
    isuCd: variant?.isuCd ?? null,
    inqTpCd: variant?.inqTpCd ?? null,
    inqVal: variant?.inqVal ?? null,
    detailView: variant?.detailView ?? null,
    endpointVariant: variant?.id,
    routeKind: variant?.routeKind,
    dateParam: variant?.dateParam,
    marketCode: variant?.marketCode ?? null,
    symbolCode: variant?.symbolCode ?? null,
    symbolRequired: variant?.symbolRequired,
    otpRequired: variant?.otpRequired,
    otpGenerated: meta?.otpGenerated ?? false,
    otpLength: meta?.otpLength ?? 0,
    csvDownloaded: meta?.csvDownloaded ?? false,
    csvRowCount: meta?.csvRowCount ?? 0,
    csvColumnKeys: meta?.csvColumnKeys,
    csvFailureReason: meta?.csvFailureReason,
    csvHeaderDetected: meta?.csvHeaderDetected ?? false,
    csvNoDataReason: meta?.csvNoDataReason,
    omittedKeys: meta?.omittedKeys,
    forbiddenKeysPresent: meta?.forbiddenKeysPresent,
    requiredKeysPresent: meta?.requiredKeysPresent,
    requiredKeysMissing: meta?.requiredKeysMissing,
    sentPayloadKeys: meta?.sentPayloadKeys,
    allowedKeys: meta?.allowedKeys,
    payloadValidation: meta?.payloadValidation,
    parameterKeys: variant ? Object.keys(variant.params) : undefined,
    attemptedVariants: input.attemptedVariants,
    selectedVariant: parserStatus === 'OK' ? variant?.id ?? null : null,
    contentType,
    httpStatus,
    responseKind,
    consecutiveFailures: meta?.consecutiveFailures,
    cooldownActive: meta?.cooldownActive,
    cooldownRemainingMs: meta?.cooldownRemainingMs,
    offHoursSuppressed: meta?.offHoursSuppressed,
    diagnosticOnly: meta?.diagnosticOnly,
    useForRouter: meta?.useForRouter,
    useForGate: meta?.useForGate,
    useForLive: meta?.useForLive,
    useForShadow: meta?.useForShadow,
    rawTopLevelKeys,
    detectedCandidatePaths: input.extract.detectedCandidatePaths,
    selectedRowPath: input.extract.selectedRowPath,
    selectedRowCount: input.extract.rows.length,
    firstRowKeys: input.extract.firstRowKeys,
    normalizedRows: input.normalized.rows.length,
    parserStatus,
    fieldMappings: input.normalized.fieldMappings,
    endpointIssueHint,
    summary,
  };
}

function emptyInvestorFieldMappings(): KrxInvestorTradingDiagnostic['fieldMappings'] {
  return {
    symbol: null,
    date: null,
    investorType: null,
    foreignNetBuy: null,
    institutionNetBuy: null,
    individualNetBuy: null,
    netBuyAmount: null,
    netBuyVolume: null,
  };
}

function buildKrxInvestorDetailGuardDiagnostic(input: {
  variant: KrxInvestorEndpointVariant;
  tradeDate: string;
  attemptedVariants: string[];
  reason: KrxEndpointGuardReason;
  intradaySession: boolean;
  enabled: boolean;
  cooldownRemainingMs?: number;
  httpStatus?: number | null;
}): KrxInvestorTradingDiagnostic {
  const responseKind: KrxInvestorTradingDiagnostic['responseKind'] =
    input.reason === 'BAD_REQUEST_SESSION_OR_PARAM'
      ? (input.httpStatus === 400 ? 'HTTP_ERROR' : 'COOLDOWN')
      : 'GATED';
  const endpointIssueHint: KrxInvestorTradingDiagnostic['endpointIssueHint'] =
    input.reason === 'SESSION_CLOSED_NOT_APPLICABLE'
      ? 'MARKET_CLOSED_NO_PREVIOUS_SAMPLE'
      : 'ENDPOINT_PARAMETER_ERROR';
  const summary = [
    input.variant.endpoint,
    `routedStatus=${input.reason}`,
    `endpointIssueHint=${endpointIssueHint}`,
    `intradaySession=${String(input.intradaySession)}`,
    `enabled=${String(input.enabled)}`,
    'providerIssue=false',
    'marketSignal=false',
    'executionImpact=NONE',
    'scoring=excluded',
    'fallbackAttempted=false',
    'useForRouter=false',
    'useForGate=false',
    'useForLive=false',
    'useForShadow=false',
    `cooldownRemainingMs=${input.cooldownRemainingMs ?? 0}`,
    `httpStatus=${input.httpStatus ?? 'NONE'}`,
    `variant=${input.variant.id}`,
    `attemptedVariants=${input.attemptedVariants.join('|') || input.variant.id}`,
  ].join(';');
  return {
    provider: 'KRX',
    providerIssue: false,
    marketSignal: false,
    executionImpact: 'NONE',
    endpoint: input.variant.endpoint,
    bld: input.variant.bld,
    tradeDate: input.tradeDate,
    selectedKrxFlowMode: input.variant.mode,
    payloadMode: input.variant.payloadMode,
    routePurpose: input.variant.routePurpose,
    selectedBld: input.variant.bld,
    requiredParamMissing: input.variant.requiredParamMissing ?? null,
    shortCodeToIsuCdResolved: input.variant.shortCodeToIsuCdResolved,
    isuCd: input.variant.isuCd,
    inqTpCd: input.variant.inqTpCd ?? null,
    inqVal: input.variant.inqVal ?? null,
    detailView: input.variant.detailView ?? null,
    endpointVariant: input.variant.id,
    routeKind: input.variant.routeKind,
    dateParam: input.variant.dateParam,
    marketCode: input.variant.marketCode,
    symbolCode: input.variant.symbolCode,
    symbolRequired: input.variant.symbolRequired,
    otpRequired: input.variant.otpRequired,
    otpGenerated: false,
    otpLength: 0,
    csvDownloaded: false,
    csvRowCount: 0,
    csvColumnKeys: [],
    csvFailureReason: input.reason,
    csvHeaderDetected: false,
    csvNoDataReason: input.reason,
    omittedKeys: [],
    forbiddenKeysPresent: [],
    requiredKeysPresent: [],
    requiredKeysMissing: input.variant.requiredParamMissing ? [input.variant.requiredParamMissing] : [],
    sentPayloadKeys: [],
    parameterKeys: Object.keys(input.variant.params),
    attemptedVariants: input.attemptedVariants,
    selectedVariant: null,
    contentType: 'empty',
    httpStatus: input.httpStatus ?? null,
    responseKind,
    consecutiveFailures: input.reason === 'BAD_REQUEST_SESSION_OR_PARAM' ? 1 : 0,
    cooldownActive: input.reason === 'BAD_REQUEST_SESSION_OR_PARAM',
    cooldownRemainingMs: input.cooldownRemainingMs ?? 0,
    offHoursSuppressed: input.reason === 'SESSION_CLOSED_NOT_APPLICABLE',
    diagnosticOnly: true,
    useForRouter: false,
    useForGate: false,
    useForLive: false,
    useForShadow: false,
    rawTopLevelKeys: [],
    detectedCandidatePaths: [],
    selectedRowPath: null,
    selectedRowCount: 0,
    firstRowKeys: [],
    normalizedRows: 0,
    parserStatus: 'PROVIDER_EMPTY_RESPONSE',
    fieldMappings: emptyInvestorFieldMappings(),
    endpointIssueHint,
    routedStatus: input.reason,
    endpointIssue: input.reason !== 'SESSION_CLOSED_NOT_APPLICABLE',
    scoring: 'excluded',
    retryable: false,
    fallbackAttempted: false,
    summary,
  };
}

function hasKrxInvestorDetailRequiredParams(variant: KrxInvestorEndpointVariant): boolean {
  if (!variant.bld.trim()) return false;
  if (variant.requiredParamMissing) return false;
  if (!['STK', 'KSQ', 'ALL'].includes(variant.marketCode)) return false;
  const dateKeys = variant.dateParam === 'strtDd/endDd' ? ['strtDd', 'endDd'] : [variant.dateParam];
  if (!dateKeys.every((key) => /^\d{8}$/.test(String(variant.params[key] ?? '')))) return false;
  if (variant.routePurpose === 'SYMBOL_LEVEL') {
    const hasSymbol = variant.symbolCode != null && /^\d{6}$/.test(variant.symbolCode);
    const hasIsuCd = variant.isuCd != null && /^[A-Z]{2}\d{10}$/.test(variant.isuCd);
    if (!hasSymbol && !hasIsuCd) return false;
    if (variant.id.includes('SYMBOL_ISU') && !variant.shortCodeToIsuCdResolved) return false;
  }
  return true;
}

function guardedKrxInvestorDetailDiagnosticForVariant(input: {
  variant: KrxInvestorEndpointVariant;
  tradeDate: string;
  attemptedVariants: string[];
  intradaySession: boolean;
  now: Date;
}): KrxInvestorTradingDiagnostic | null {
  if (!isKrxInvestorDetailSafeProbeEndpoint(input.variant.endpoint)) return null;
  const enabled = krxInvestorDetailProbeEnabled();
  const session = input.intradaySession ? 'INTRADAY' : 'CLOSED';
  const cooldownRemainingMs = activeKrxInvestorDetailGuardCooldown({
    endpoint: input.variant.endpoint,
    session,
    tradeDate: input.tradeDate,
    now: input.now,
  });
  const reason: KrxEndpointGuardReason | null =
    !input.intradaySession
      ? 'SESSION_CLOSED_NOT_APPLICABLE'
      : !enabled
        ? 'ENDPOINT_PARAM_NOT_READY'
        : cooldownRemainingMs > 0
          ? 'BAD_REQUEST_SESSION_OR_PARAM'
          : !hasKrxInvestorDetailRequiredParams(input.variant)
            ? 'ENDPOINT_PARAM_NOT_READY'
            : null;
  if (!reason) return null;
  emitKrxInvestorDetailGuard({
    endpoint: input.variant.endpoint,
    reason,
    intradaySession: input.intradaySession,
    enabled,
    now: input.now,
  });
  return buildKrxInvestorDetailGuardDiagnostic({
    variant: input.variant,
    tradeDate: input.tradeDate,
    attemptedVariants: input.attemptedVariants,
    reason,
    intradaySession: input.intradaySession,
    enabled,
    cooldownRemainingMs,
  });
}

function markKrxInvestorDetailBadRequestDiagnostic(input: {
  diagnostic: KrxInvestorTradingDiagnostic;
  variant: KrxInvestorEndpointVariant;
  tradeDate: string;
  attemptedVariants: string[];
  intradaySession: boolean;
  now: Date;
}): KrxInvestorTradingDiagnostic {
  if (
    !isKrxInvestorDetailSafeProbeEndpoint(input.variant.endpoint) ||
    !input.intradaySession ||
    input.diagnostic.httpStatus !== 400
  ) {
    return input.diagnostic;
  }
  recordKrxInvestorDetailBadRequestCooldown({
    endpoint: input.variant.endpoint,
    tradeDate: input.tradeDate,
    now: input.now,
  });
  emitKrxInvestorDetailGuard({
    endpoint: input.variant.endpoint,
    reason: 'BAD_REQUEST_SESSION_OR_PARAM',
    intradaySession: input.intradaySession,
    enabled: krxInvestorDetailProbeEnabled(),
    now: input.now,
  });
  return {
    ...input.diagnostic,
    providerIssue: false,
    marketSignal: false,
    executionImpact: 'NONE',
    useForRouter: false,
    useForGate: false,
    useForLive: false,
    useForShadow: false,
    endpointIssueHint: 'ENDPOINT_PARAMETER_ERROR',
    routedStatus: 'BAD_REQUEST_SESSION_OR_PARAM',
    endpointIssue: true,
    scoring: 'excluded',
    retryable: false,
    fallbackAttempted: false,
    cooldownActive: true,
    cooldownRemainingMs: INVESTOR_DETAIL_SAFE_PROBE_COOLDOWN_MS,
    attemptedVariants: input.attemptedVariants,
    summary: `${input.diagnostic.summary};routedStatus=BAD_REQUEST_SESSION_OR_PARAM;providerIssue=false;marketSignal=false;executionImpact=NONE;scoring=excluded;retryable=false;cooldownMs=${INVESTOR_DETAIL_SAFE_PROBE_COOLDOWN_MS};useForRouter=false;useForGate=false;useForLive=false;useForShadow=false`,
  };
}

/** "1,234,567" · "-1,234" · "" → number. 실패 시 0. */
function toNum(s: unknown): number {
  if (s == null) return 0;
  const trimmed = String(s).trim();
  if (!trimmed || trimmed === '-') return 0;
  const n = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** KRX 종목코드는 때때로 'A005930' 처럼 A 접두어가 붙는다. 제거 + 6자리 보장. */
function normalizeCode(s: unknown): string {
  if (!s) return '';
  const stripped = String(s).trim().replace(/^[A-Z]/, '');
  return stripped.length === 6 && /^\d{6}$/.test(stripped) ? stripped : '';
}

function endpointCodeFromBld(bld: string): string {
  return bld.split('/').at(-1) ?? bld;
}

function investorTradingBld(endpoint: string): string {
  return `dbms/MDC/STAT/standard/${endpoint}`;
}

// ADR-0502c: compactTradeDate 는 ./krxClient/dateUtils.ts SSOT 로 이동.

function normalizeIsuCd(value: unknown): string {
  const normalized = String(value ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{12}$/.test(normalized) ? normalized : '';
}

// ADR-0502c: KrxIsuCdResolution 정의는 ./krxClient/types.ts 로 이동.

function resolveKrxIsuCdForSymbol(symbolCode: string, explicitIsuCd?: string | null): KrxIsuCdResolution {
  const fromOption = normalizeIsuCd(explicitIsuCd);
  if (fromOption) {
    return { isuCd: fromOption, shortCodeToIsuCdResolved: true, source: 'FETCH_OPTION' };
  }
  if (!symbolCode) {
    return { isuCd: null, shortCodeToIsuCdResolved: false, source: 'NONE' };
  }
  const stockMasterHit = getStockByCode(symbolCode);
  const fromMaster = normalizeIsuCd(stockMasterHit?.isin);
  if (fromMaster) {
    return { isuCd: fromMaster, shortCodeToIsuCdResolved: true, source: 'STOCK_MASTER' };
  }
  return { isuCd: null, shortCodeToIsuCdResolved: false, source: 'NONE' };
}

function investorTradingParams(input: {
  marketCode: 'STK' | 'KSQ' | 'ALL';
  dateParam: NonNullable<KrxInvestorTradingDiagnostic['dateParam']>;
  tradeDate: string;
  symbolCode?: string | null;
  isuCd?: string | null;
  profile?: 'MARKET_INQ' | 'SYMBOL_ISU' | 'LEGACY_TRDVOL';
  trdVolVal?: '1' | '2';
  inqTpCd?: string | null;
  inqVal?: string | null;
  detailView?: string | null;
}): Record<string, string> {
  const profile = input.profile ?? 'LEGACY_TRDVOL';
  const params: Record<string, string> = {};
  if (profile === 'MARKET_INQ') {
    params.inqTpCd = input.inqTpCd ?? '1';
    params.mktId = input.marketCode;
    params.inqVal = input.inqVal ?? '2';
    if (input.detailView != null) params.detailView = input.detailView;
  } else if (profile === 'SYMBOL_ISU') {
    if (input.isuCd) params.isuCd = input.isuCd;
    params.inqVal = input.inqVal ?? '2';
  } else {
    params.searchType = input.symbolCode ? '2' : '1';
    params.mktId = input.marketCode;
    params.trdVolVal = input.trdVolVal ?? '1';
    params.share = '1';
    params.money = '1';
  }
  if (input.dateParam === 'trdDd') params.trdDd = input.tradeDate;
  if (input.dateParam === 'strtDd/endDd') {
    params.strtDd = input.tradeDate;
    params.endDd = input.tradeDate;
  }
  if (input.dateParam === 'basDd') params.basDd = input.tradeDate;
  if (input.dateParam === 'searchDate') params.searchDate = input.tradeDate;
  if (input.symbolCode && profile === 'LEGACY_TRDVOL') {
    params.isuCd = input.symbolCode;
    params.isuCd2 = input.isuCd ?? input.symbolCode;
    params.codeNmisuCd_finder_stkisu0_0 = input.isuCd ?? input.symbolCode;
  }
  return params;
}

function buildInvestorTradingVariants(
  tradeDate: string,
  symbol?: string | null,
  isuCdResolution: KrxIsuCdResolution = { isuCd: null, shortCodeToIsuCdResolved: false, source: 'NONE' },
): KrxInvestorEndpointVariant[] {
  const symbolCode = normalizeCode(symbol);
  const out: KrxInvestorEndpointVariant[] = [];
  const push = (input: {
    mode: KrxInvestorEndpointVariant['mode'];
    payloadMode?: KrxInvestorEndpointVariant['payloadMode'];
    endpoint: string;
    routeKind: KrxInvestorEndpointVariant['routeKind'];
    profile?: 'MARKET_INQ' | 'SYMBOL_ISU' | 'LEGACY_TRDVOL';
    dateParam: KrxInvestorEndpointVariant['dateParam'];
    marketCode: KrxInvestorEndpointVariant['marketCode'];
    symbolCode?: string | null;
    isuCd?: string | null;
    trdVolVal?: '1' | '2';
    inqTpCd?: string | null;
    inqVal?: string | null;
    detailView?: string | null;
  }): void => {
    const normalizedSymbol = input.symbolCode ? normalizeCode(input.symbolCode) : '';
    const symbolRequired = input.routeKind === 'SYMBOL_INVESTOR_FLOW';
    const normalizedIsuCd = normalizeIsuCd(input.isuCd);
    if (symbolRequired && !normalizedSymbol) return;
    if (input.profile === 'SYMBOL_ISU' && !normalizedIsuCd) return;
    const bld = investorTradingBld(input.endpoint);
    const profile = input.profile ?? 'LEGACY_TRDVOL';
    const routePurpose = input.routeKind === 'SYMBOL_INVESTOR_FLOW' ? 'SYMBOL_LEVEL' : 'MARKET_LEVEL';
    const payloadMode = input.payloadMode ?? 'EXTENDED_VARIANT';
    const paramMode = profile === 'SYMBOL_ISU'
      ? `isuCd=${normalizedIsuCd ? 'resolved' : 'missing'}:inqVal=${input.inqVal ?? '2'}`
      : profile === 'MARKET_INQ'
        ? `inqTpCd=${input.inqTpCd ?? '1'}:inqVal=${input.inqVal ?? '2'}:detailView=${input.detailView ?? 'NONE'}`
        : `trdVolVal=${input.trdVolVal ?? '1'}`;
    out.push({
      id: `${input.mode}:${payloadMode}:${input.endpoint}:${input.routeKind}:${input.marketCode}:${input.dateParam}:${paramMode}${normalizedSymbol ? ':symbol' : ''}`,
      mode: input.mode,
      payloadMode,
      endpoint: input.endpoint,
      bld,
      routeKind: input.routeKind,
      routePurpose,
      dateParam: input.dateParam,
      marketCode: input.marketCode,
      symbolCode: normalizedSymbol || null,
      isuCd: normalizedIsuCd || null,
      shortCodeToIsuCdResolved: normalizedIsuCd ? true : (symbolCode ? isuCdResolution.shortCodeToIsuCdResolved : false),
      requiredParamMissing: input.profile === 'SYMBOL_ISU' && !normalizedIsuCd
        ? 'isuCd'
        : symbolRequired && normalizedSymbol && !isuCdResolution.isuCd ? 'isuCd' : null,
      symbolRequired,
      otpRequired: input.mode === 'OTP_CSV',
      trdVolVal: input.trdVolVal,
      inqTpCd: input.inqTpCd ?? null,
      inqVal: input.inqVal ?? null,
      detailView: input.detailView ?? null,
      params: investorTradingParams({
        marketCode: input.marketCode,
        dateParam: input.dateParam,
        tradeDate,
        symbolCode: normalizedSymbol || null,
        isuCd: normalizedIsuCd || null,
        profile,
        trdVolVal: input.trdVolVal,
        inqTpCd: input.inqTpCd,
        inqVal: input.inqVal,
        detailView: input.detailView,
      }),
    });
  };

  if (symbolCode && isuCdResolution.isuCd) {
    push({ mode: 'OTP_CSV', payloadMode: 'MINIMAL_STRICT', endpoint: 'MDCSTAT02401', routeKind: 'SYMBOL_INVESTOR_FLOW', profile: 'SYMBOL_ISU', dateParam: 'strtDd/endDd', marketCode: 'ALL', symbolCode, isuCd: isuCdResolution.isuCd, inqVal: '2' });
  }

  for (const marketCode of ['STK', 'KSQ'] as const) {
    push({ mode: 'OTP_CSV', payloadMode: 'MINIMAL_STRICT', endpoint: 'MDCSTAT02201', routeKind: 'MARKET_INVESTOR_FLOW', profile: 'MARKET_INQ', dateParam: 'trdDd', marketCode, inqTpCd: '1', inqVal: '2' });
  }

  if (symbolCode && isuCdResolution.isuCd) {
    for (const inqVal of ['2', '1'] as const) {
      push({ mode: 'OTP_CSV', payloadMode: 'EXTENDED_VARIANT', endpoint: 'MDCSTAT02401', routeKind: 'SYMBOL_INVESTOR_FLOW', profile: 'SYMBOL_ISU', dateParam: 'strtDd/endDd', marketCode: 'ALL', symbolCode, isuCd: isuCdResolution.isuCd, inqVal });
      push({ mode: 'OTP_CSV', payloadMode: 'EXTENDED_VARIANT', endpoint: 'MDCSTAT02401', routeKind: 'SYMBOL_INVESTOR_FLOW', profile: 'SYMBOL_ISU', dateParam: 'trdDd', marketCode: 'ALL', symbolCode, isuCd: isuCdResolution.isuCd, inqVal });
    }
  }

  for (const marketCode of ['STK', 'KSQ', 'ALL'] as const) {
    push({ mode: 'OTP_CSV', payloadMode: 'EXTENDED_VARIANT', endpoint: 'MDCSTAT02201', routeKind: 'MARKET_INVESTOR_FLOW', profile: 'MARKET_INQ', dateParam: 'trdDd', marketCode, inqTpCd: '1', inqVal: '2', detailView: '1' });
  }
  for (const marketCode of ['STK', 'KSQ'] as const) {
    push({ mode: 'OTP_CSV', payloadMode: 'EXTENDED_VARIANT', endpoint: 'MDCSTAT02201', routeKind: 'MARKET_INVESTOR_FLOW', profile: 'MARKET_INQ', dateParam: 'basDd', marketCode, inqTpCd: '1', inqVal: '2', detailView: '1' });
    push({ mode: 'OTP_CSV', payloadMode: 'EXTENDED_VARIANT', endpoint: 'MDCSTAT02201', routeKind: 'MARKET_INVESTOR_FLOW', profile: 'LEGACY_TRDVOL', dateParam: 'trdDd', marketCode, trdVolVal: '2' });
  }

  if (symbolCode) {
    for (const marketCode of ['STK', 'KSQ'] as const) {
      push({ mode: 'DIRECT_JSON', endpoint: 'MDCSTAT02401', routeKind: 'SYMBOL_INVESTOR_FLOW', profile: 'SYMBOL_ISU', dateParam: 'strtDd/endDd', marketCode, symbolCode, isuCd: isuCdResolution.isuCd, inqVal: '2' });
      push({ mode: 'DIRECT_JSON', endpoint: 'MDCSTAT02203', routeKind: 'SYMBOL_INVESTOR_FLOW', dateParam: 'trdDd', marketCode, symbolCode });
      push({ mode: 'DIRECT_JSON', endpoint: 'MDCSTAT02203', routeKind: 'SYMBOL_INVESTOR_FLOW', dateParam: 'strtDd/endDd', marketCode, symbolCode });
      push({ mode: 'DIRECT_JSON', endpoint: 'MDCSTAT02203', routeKind: 'SYMBOL_INVESTOR_FLOW', dateParam: 'basDd', marketCode, symbolCode });
      push({ mode: 'DIRECT_JSON', endpoint: 'MDCSTAT02203', routeKind: 'SYMBOL_INVESTOR_FLOW', dateParam: 'searchDate', marketCode, symbolCode });
    }
  }
  for (const marketCode of ['STK', 'KSQ', 'ALL'] as const) {
    push({ mode: 'DIRECT_JSON', endpoint: 'MDCSTAT02201', routeKind: 'MARKET_INVESTOR_FLOW', profile: 'MARKET_INQ', dateParam: 'trdDd', marketCode, inqTpCd: '1', inqVal: '2', detailView: '1' });
    push({ mode: 'DIRECT_JSON', endpoint: 'MDCSTAT02201', routeKind: 'MARKET_INVESTOR_FLOW', dateParam: 'strtDd/endDd', marketCode });
  }
  for (const marketCode of ['STK', 'KSQ'] as const) {
    push({ mode: 'DIRECT_JSON', endpoint: 'MDCSTAT02201', routeKind: 'MARKET_INVESTOR_FLOW', dateParam: 'basDd', marketCode });
    push({ mode: 'DIRECT_JSON', endpoint: 'MDCSTAT02201', routeKind: 'MARKET_INVESTOR_FLOW', dateParam: 'searchDate', marketCode });
  }

  const envBld = BLD_INVESTOR_TRADING;
  const envEndpoint = endpointCodeFromBld(envBld);
  if (!out.some((variant) => variant.bld === envBld)) {
    out.push({
      id: `DIRECT_JSON:${envEndpoint}:ENV_FALLBACK:ALL:strtDd/endDd`,
      mode: 'DIRECT_JSON',
      payloadMode: 'EXTENDED_VARIANT',
      endpoint: envEndpoint,
      bld: envBld,
      routeKind: symbolCode ? 'SYMBOL_INVESTOR_FLOW' : 'MARKET_INVESTOR_FLOW',
      routePurpose: symbolCode ? 'SYMBOL_LEVEL' : 'MARKET_LEVEL',
      dateParam: 'strtDd/endDd',
      marketCode: 'ALL',
      symbolCode: symbolCode || null,
      isuCd: null,
      shortCodeToIsuCdResolved: isuCdResolution.shortCodeToIsuCdResolved,
      requiredParamMissing: symbolCode ? 'isuCd' : null,
      symbolRequired: Boolean(symbolCode),
      otpRequired: false,
      trdVolVal: '1',
      params: investorTradingParams({
        marketCode: 'ALL',
        dateParam: 'strtDd/endDd',
        tradeDate,
        symbolCode: symbolCode || null,
      }),
    });
  }

  return out;
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * 투자자별 개별종목 거래실적. 기본값: KST 오늘.
 * KRX 리포트 필드명 (MDCSTAT02203)은 한글 키 — 방어적 다중 키 fallback 적용.
 */
export async function fetchInvestorTrading(date?: string, options: FetchInvestorTradingOptions = {}): Promise<KrxInvestorRow[]> {
  const now = options.now ?? new Date();
  const tradeDate = resolveTradeDate(date, now);
  const symbolCode = normalizeCode(options.symbol);
  const explicitIsuCd = normalizeIsuCd(options.isuCd);
  const cacheKey = `investor:${tradeDate}:${symbolCode || 'ALL'}:${explicitIsuCd || 'AUTO_ISU'}`;
  const cached = getCached<KrxInvestorRow[]>(cacheKey);
  if (cached && !options.allowDisabledAutoFetch) return cached;

  const compactDate = compactTradeDate(tradeDate);
  if (!options.allowDisabledAutoFetch && isKrxAutoFetchDisabled()) {
    const diagnostic = buildKrxAutoDisabledDiagnostic({
      tradeDate: compactDate,
      routePurpose: symbolCode ? 'SYMBOL_LEVEL' : 'MARKET_LEVEL',
      symbolCode: symbolCode || null,
    });
    console.info(`[KRX] skipped: ${krxAutoFetchDisabledReason()} auto fetch disabled endpoint=${diagnostic.endpoint}`);
    setInvestorTradingDiagnostic(compactDate, diagnostic);
    return [];
  }
  const isuCdResolution = resolveKrxIsuCdForSymbol(symbolCode, explicitIsuCd);
  const variants = buildInvestorTradingVariants(compactDate, symbolCode, isuCdResolution);
  const intradaySession = isKrxInvestorDetailIntradaySession(now);
  const attemptedDiagnostics: KrxInvestorTradingDiagnostic[] = [];
  const attemptedVariantIds: string[] = [];
  for (const variant of variants) {
    attemptedVariantIds.push(variant.id);
    const guardedDiagnostic = guardedKrxInvestorDetailDiagnosticForVariant({
      variant,
      tradeDate: compactDate,
      attemptedVariants: [...attemptedVariantIds],
      intradaySession,
      now,
    });
    if (guardedDiagnostic) {
      attemptedDiagnostics.push(guardedDiagnostic);
      continue;
    }
    const raw = variant.mode === 'OTP_CSV'
      ? await krxInvestorOtpCsv(variant, { allowDisabledAutoFetch: options.allowDisabledAutoFetch })
      : await krxPost(variant.bld, variant.params, { bypassTimeWindow: true, allowDisabledAutoFetch: options.allowDisabledAutoFetch, suppressHttpErrorLog: isKrxInvestorDetailSafeProbeEndpoint(variant.endpoint) });
    const extracted = extractRowsDetailed(raw);
    const normalized = normalizeKrxInvestorRows(extracted.rows);
    const rows = symbolCode
      ? normalized.rows.filter((row) => row.code === symbolCode)
      : normalized.rows;
    const diagnostic = markKrxInvestorDetailBadRequestDiagnostic({
      diagnostic: buildInvestorTradingDiagnostic({
        raw,
        tradeDate: compactDate,
        extract: extracted,
        normalized: { ...normalized, rows },
        variant,
        attemptedVariants: [...attemptedVariantIds],
      }),
      variant,
      tradeDate: compactDate,
      attemptedVariants: [...attemptedVariantIds],
      intradaySession,
      now,
    });
    attemptedDiagnostics.push(diagnostic);
    if (rows.length > 0 && diagnostic.parserStatus === 'OK') {
      const selectedDiagnostic = { ...diagnostic, selectedVariant: variant.id, attemptedVariants: [...attemptedVariantIds] };
      setInvestorTradingDiagnostic(compactDate, selectedDiagnostic);
      setCached(cacheKey, rows);
      return rows;
    }
  }

  const bestDiagnostic =
    attemptedDiagnostics.find((diagnostic) => diagnostic.selectedRowCount > 0 && diagnostic.normalizedRows > 0) ??
    attemptedDiagnostics.find((diagnostic) => diagnostic.routedStatus === 'BAD_REQUEST_SESSION_OR_PARAM') ??
    attemptedDiagnostics.find((diagnostic) => diagnostic.responseKind !== 'HTTP_ERROR' && diagnostic.responseKind !== 'COOLDOWN') ??
    attemptedDiagnostics.find((diagnostic) => diagnostic.responseKind === 'HTTP_ERROR') ??
    attemptedDiagnostics.at(-1) ??
    buildInvestorTradingDiagnostic({
      raw: null,
      tradeDate: compactDate,
      extract: extractRowsDetailed(null),
      normalized: normalizeKrxInvestorRows([]),
      attemptedVariants: attemptedVariantIds,
    });
  setInvestorTradingDiagnostic(compactDate, {
    ...bestDiagnostic,
    selectedVariant: null,
    attemptedVariants: attemptedVariantIds,
    summary: `${bestDiagnostic.summary};selectedVariant=NONE;variantCount=${attemptedVariantIds.length}`,
  });
  setCached(cacheKey, []);
  return [];
}

/**
 * ADR-0141 Stage 1: KRX 11분류 투자자별 매매 (시장 단위, 일자별).
 *
 * MDCSTAT02301 (추정) — 11 카테고리 raw 데이터:
 *   금융투자 / 보험 / 투신 / 사모 / 은행 / 기타금융 / 연기금 등 / 기타법인 /
 *   개인 / 외국인 / 기타외국인
 *
 * 본 함수는 *raw 데이터만* 반환 — Passive/Active 매핑 미적용 (ADR-0142 별도 PR).
 * 사용자 명시 *통념 추정 위험* 차단을 위해 매핑 정책은 운영 데이터 누적 후
 * 데이터 기반 검증.
 *
 * - 빈 응답/throw → 빈 배열 (silent degradation 차단은 macroState.fssDetailSource 마커)
 * - 한글 키 다중 fallback (보고서 버전 변동 안전)
 * - 10분 캐시 (다른 KRX 시리즈 정합)
 */
// ADR-0502c: KrxInvestorDetailRow 정의는 ./krxClient/types.ts 로 이동.

export async function fetchInvestorTradingDetail(date?: string): Promise<KrxInvestorDetailRow[]> {
  const tradeDate = resolveTradeDate(date);
  const cacheKey = `investorDetail:${tradeDate}`;
  const cached = getCached<KrxInvestorDetailRow[]>(cacheKey);
  if (cached) return cached;

  try {
    const raw = await krxPost(BLD_INVESTOR_DETAIL, {
      searchType:   '2',         // 2=투자자별 (1=종목별)
      mktId:        'STK',       // STK=KOSPI (KSQ=KOSDAQ, ALL=양시장)
      strtDd:       tradeDate,
      endDd:        tradeDate,
      trdVolVal:    '1',
      share:        '1',
      money:        '1',
      csvxls_isNo:  'false',
    });
    const rows = extractRows(raw);

    const out: KrxInvestorDetailRow[] = [];
    for (const r of rows) {
      // 카테고리명 — 한글 키 (INVSTR_NM / INVSTR_TP_NM / 등) 다중 fallback
      const category = String(
        r.INVSTR_NM ?? r.INVSTR_TP_NM ?? r.INVSTR ?? r.TRDR_NM ?? '',
      ).trim();
      if (!category) continue;

      // 순매수 수량 (주) + 거래대금 (원)
      const netBuyQty = toNum(
        r.NETBY_QTY ?? r.NETBY_TRDVOL ?? r.NETBY_VOLUME ?? 0,
      );
      const netBuyKrw = toNum(
        r.NETBY_TR_PBMN ?? r.NETBY_TRDVAL ?? r.NETBY_AMT ?? 0,
      );

      out.push({ category, netBuyQty, netBuyKrw });
    }

    setCached(cacheKey, out);
    return out;
  } catch (e) {
    console.warn(
      `[KRX:InvestorDetail] ${tradeDate} 조회 실패: ${e instanceof Error ? e.message : e}`,
    );
    return [];
  }
}

/**
 * 상장종목 PER/PBR/배당수익률 스냅샷. MDCSTAT03501.
 */
export async function fetchPerPbr(date?: string): Promise<KrxPerPbrRow[]> {
  const tradeDate = resolveTradeDate(date);
  const cacheKey = `perpbr:${tradeDate}`;
  const cached = getCached<KrxPerPbrRow[]>(cacheKey);
  if (cached) return cached;

  const raw = await krxPost(BLD_PER_PBR, {
    searchType:   '1',
    mktId:        'ALL',
    trdDd:        tradeDate,
    csvxls_isNo:  'false',
  });
  const rows = extractRows(raw);

  const out: KrxPerPbrRow[] = [];
  for (const r of rows) {
    const code = normalizeCode(r.ISU_SRT_CD ?? r.ISU_CD);
    if (!code) continue;
    out.push({
      code,
      name: String(r.ISU_ABBRV ?? r.ISU_NM ?? '').trim(),
      per: toNum(r.PER),
      pbr: toNum(r.PBR),
      dividendYield: toNum(r.DVD_YD),
      eps: toNum(r.EPS),
      bps: toNum(r.BPS),
      close: toNum(r.TDD_CLSPRC ?? r.CLSPRC),
    });
  }
  setCached(cacheKey, out);
  return out;
}

/**
 * 공매도 잔고 상위. MDCSTAT30001.
 */
export async function fetchShortBalance(date?: string): Promise<KrxShortBalanceRow[]> {
  const tradeDate = resolveTradeDate(date);
  const cacheKey = `short:${tradeDate}`;
  const cached = getCached<KrxShortBalanceRow[]>(cacheKey);
  if (cached) return cached;

  const raw = await krxPost(BLD_SHORT_BALANCE, {
    searchType:   '1',
    mktId:        'ALL',
    trdDd:        tradeDate,
    csvxls_isNo:  'false',
  });
  const rows = extractRows(raw);

  const out: KrxShortBalanceRow[] = [];
  for (const r of rows) {
    const code = normalizeCode(r.ISU_SRT_CD ?? r.ISU_CD);
    if (!code) continue;
    out.push({
      code,
      name: String(r.ISU_ABBRV ?? r.ISU_NM ?? '').trim(),
      shortBalance: toNum(r.BAL_QTY),
      shortBalanceValue: toNum(r.BAL_AMT),
      shortRatio: toNum(r.BAL_RTO),
    });
  }
  setCached(cacheKey, out);
  return out;
}

// ── 상태 점검 ────────────────────────────────────────────────────────────────

/** /api/system/krx-status 등 상위 라우터가 사용할 진단 스냅샷. */
export function getKrxStatus(): {
  base: string;
  disabled: boolean;
  cacheKeys: string[];
} {
  return {
    base: KRX_BASE,
    disabled: KRX_DISABLED,
    cacheKeys: listCacheKeys(),
  };
}

// ── 블루프린트 파사드 (경로 A: KRX Open API 인증) ────────────────────────────
// 공개 엔드포인트(위)와 인증 Open API 를 블루프린트 네이밍으로 노출한다.
// 호출자는 fetchKrx* 계열 한 곳만 보면 되고, kisClient.ts 의 getKisToken/kisGet
// 구조와 대칭된다. 실제 HTTP·서킷브레이커 구현은 krxOpenApi.ts 가 담당하므로
// 이 섹션은 얇은 파사드이며 중복 구현이 없다.
//
// 환경변수 계약:
//   KRX_API_KEY      — openapi.krx.co.kr 발급 인증키 (블루프린트 표준)
//   KRX_API_BASE     — 기본 http://data-dbg.krx.co.kr (호스트만 입력해도 됨)
//   KRX_API_DISABLED — true 면 인증 API 호출 없이 즉시 폴백
//
// Yahoo 폴백은 koreanQuoteBridge.ts 가 담당한다 — 이 파사드는 Yahoo 를 직접
// 호출하지 않는다. 대신 `isKrxOpenApiHealthy()` 를 함께 내보내 상위 라우트가
// 폴백 여부를 직접 판단할 수 있게 한다.

export {
  isKrxOpenApiHealthy,
  getKrxOpenApiStatus,
  type KrxStockDailyRow,
  type KrxIndexDailyRow,
};

/**
 * KRX Open API 인증키를 반환한다. 미설정 시 빈 문자열.
 * kisClient.getKisToken 과 포지션을 맞춘 파사드로, 호출자는 존재 여부만 확인하면 된다.
 */
export function getKrxAuthKey(): string {
  return (process.env.KRX_API_KEY ?? process.env.KRX_OPENAPI_AUTH_KEY ?? '').trim();
}

/**
 * KRX Open API 공통 GET 래퍼. 서킷브레이커·타임아웃·AUTH_KEY 헤더를
 * `krxOpenApi.ts` 의 `krxGet` 이 담당한다. 인증 실패·네트워크 실패·쿼터 초과는
 * 모두 null 로 정규화되어 호출자가 Yahoo 폴백을 시도할 수 있다.
 *
 * ADR-0502c Phase 2: 본체는 ./krxClient/http.ts SSOT 로 이동. 호환성 re-export.
 */
export { krxGet } from './krxClient/http.js';

/**
 * 종목별 일별 OHLCV 스냅샷. KOSPI → KOSDAQ 순서로 조회하고 일치하는 종목 1건을 반환.
 * KRX 미응답·미발견 시 null — 상위 레이어(koreanQuoteBridge)가 Yahoo 로 폴백한다.
 *
 * @param code  6자리 단축종목코드 (예: '005930')
 * @param date  YYYYMMDD (미지정 시 최근 영업일)
 */
export async function fetchKrxDailyOhlcv(
  code: string,
  date?: string,
): Promise<KrxStockDailyRow | null> {
  const normalized = String(code ?? '').trim();
  if (!/^\d{6}$/.test(normalized)) return null;

  const kospi = await fetchKospiDailyTrade(date);
  const hitKospi = kospi.find(r => r.code === normalized);
  if (hitKospi) return hitKospi;

  const kosdaq = await fetchKosdaqDailyTrade(date);
  const hitKosdaq = kosdaq.find(r => r.code === normalized);
  return hitKosdaq ?? null;
}

/**
 * 섹터/시장 지수 일별시세. sectorEnergyEngine 의 연료 공급처.
 * KRX 시리즈(/idx/krx_dd_trd)는 KOSPI200·KRX100 및 섹터지수(에너지·반도체·IT 등)를
 * 한 번에 반환하므로 한 번의 호출로 섹터 에너지 계산에 필요한 raw 데이터가 충족된다.
 * 비어있는 응답이면 KOSPI+KOSDAQ 시리즈를 합쳐 대체한다.
 */
export async function fetchKrxSectorIndices(date?: string): Promise<KrxIndexDailyRow[]> {
  const primary = await fetchKrxIndexDaily(date);
  if (primary.length > 0) return primary;

  const [kospi, kosdaq] = await Promise.all([
    fetchKospiIndexDaily(date),
    fetchKosdaqIndexDaily(date),
  ]);
  return [...kospi, ...kosdaq];
}

/**
 * 블루프린트 별칭 — 투자자별 거래실적. KIS VTS 쿼터를 우회해 KRX 공개 소스로 조회.
 * 기존 `fetchInvestorTrading` 을 그대로 재노출.
 */
export const fetchKrxInvestorTrading = fetchInvestorTrading;

/** 블루프린트 별칭 — PER/PBR/배당수익률. Gemini 스크리닝 프롬프트 대체 소스. */
export const fetchKrxPerPbr = fetchPerPbr;

/** 블루프린트 별칭 — 공매도 잔고 상위. enemyCheckClient 의 적색 신호 입력. */
export const fetchKrxShortBalance = fetchShortBalance;

/**
 * 시가총액 스냅샷. 자릿수 오류(억/조 혼동)를 방지하기 위해 원 단위 정수로 반환한다.
 * KOSPI + KOSDAQ 일별매매정보에서 market_cap/상장주식수만 추출.
 */
// ADR-0502c: KrxMarketCapRow 정의는 ./krxClient/types.ts 로 이동.

export async function fetchKrxMarketCap(date?: string): Promise<KrxMarketCapRow[]> {
  const [kospi, kosdaq] = await Promise.all([
    fetchKospiDailyTrade(date),
    fetchKosdaqDailyTrade(date),
  ]);
  const out: KrxMarketCapRow[] = [];
  for (const r of [...kospi, ...kosdaq]) {
    if (!r.code || r.marketCap <= 0) continue;
    out.push({
      code: r.code,
      name: r.name,
      marketCap: r.marketCap,
      listedShares: r.listedShares,
      market: r.market,
    });
  }
  return out;
}
