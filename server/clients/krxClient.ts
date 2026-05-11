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

import {
  krxGet as _openApiGet,
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
import { isMarketDataPublished, isKstWeekend } from '../utils/marketClock.js';
import { getStockByCode } from '../persistence/krxStockMasterRepo.js';

// ── 타입 ─────────────────────────────────────────────────────────────────────

export interface KrxInvestorRow {
  code: string;          // 6자리 종목코드
  name: string;          // 한글 종목명
  foreignNetBuy: number; // 외국인 순매수 수량(주)
  institutionNetBuy: number; // 기관 순매수 수량(주)
  individualNetBuy: number;  // 개인 순매수 수량(주)
}

export type KrxInvestorParserStatus =
  | 'OK'
  | 'PROVIDER_EMPTY_RESPONSE'
  | 'PARSER_KEY_MISMATCH'
  | 'PARSER_FIELD_MISMATCH'
  | 'MARKET_CLOSED_NO_PREVIOUS_SAMPLE';

export interface KrxInvestorTradingDiagnostic {
  endpoint: string;
  bld: string;
  tradeDate: string;
  selectedKrxFlowMode?: 'OTP_CSV' | 'DIRECT_JSON' | 'CACHE_FALLBACK';
  payloadMode?: 'MINIMAL_STRICT' | 'EXTENDED_VARIANT';
  routePurpose?: 'MARKET_LEVEL' | 'SYMBOL_LEVEL';
  selectedBld?: string;
  requiredParamMissing?: string | null;
  shortCodeToIsuCdResolved?: boolean;
  isuCd?: string | null;
  inqTpCd?: string | null;
  inqVal?: string | null;
  detailView?: string | null;
  endpointVariant?: string;
  routeKind?: 'MARKET_INVESTOR_FLOW' | 'SYMBOL_INVESTOR_FLOW';
  dateParam?: 'trdDd' | 'strtDd/endDd' | 'basDd' | 'searchDate';
  marketCode?: string | null;
  symbolCode?: string | null;
  symbolRequired?: boolean;
  otpRequired?: boolean;
  otpGenerated?: boolean;
  otpLength?: number;
  csvDownloaded?: boolean;
  csvRowCount?: number;
  csvColumnKeys?: string[];
  csvFailureReason?: string | null;
  csvHeaderDetected?: boolean;
  csvNoDataReason?: string | null;
  omittedKeys?: string[];
  forbiddenKeysPresent?: string[];
  requiredKeysPresent?: string[];
  requiredKeysMissing?: string[];
  sentPayloadKeys?: string[];
  parameterKeys?: string[];
  attemptedVariants?: string[];
  selectedVariant?: string | null;
  contentType: 'json' | 'html' | 'csv' | 'text' | 'empty' | 'unknown';
  httpStatus: number | null;
  responseKind: 'JSON' | 'HTML' | 'CSV' | 'TEXT' | 'EMPTY' | 'DISABLED' | 'GATED' | 'COOLDOWN' | 'HTTP_ERROR' | 'NETWORK_ERROR';
  consecutiveFailures?: number;
  cooldownActive?: boolean;
  cooldownRemainingMs?: number;
  offHoursSuppressed?: boolean;
  diagnosticOnly?: boolean;
  useForRouter?: boolean;
  useForGate?: boolean;
  useForLive?: boolean;
  useForShadow?: boolean;
  rawTopLevelKeys: string[];
  detectedCandidatePaths: string[];
  selectedRowPath: string | null;
  selectedRowCount: number;
  firstRowKeys: string[];
  normalizedRows: number;
  parserStatus: KrxInvestorParserStatus;
  fieldMappings: Record<'symbol' | 'date' | 'investorType' | 'foreignNetBuy' | 'institutionNetBuy' | 'individualNetBuy' | 'netBuyAmount' | 'netBuyVolume', string | null>;
  endpointIssueHint: 'NONE' | 'ENDPOINT_PARAMETER_ERROR' | 'MARKET_CODE_ERROR' | 'SYMBOL_CODE_FORMAT_ERROR' | 'OTP_OR_HEADER_ERROR' | 'SCHEMA_KEY_CHANGED' | 'FIELD_ALIAS_CHANGED' | 'MARKET_CLOSED_NO_PREVIOUS_SAMPLE';
  summary: string;
}

export interface KrxPerPbrRow {
  code: string;
  name: string;
  per: number;           // 주가수익비율 (음수·NaN 시 0)
  pbr: number;           // 주가순자산비율
  dividendYield: number; // 배당수익률(%)
  eps: number;           // 주당순이익
  bps: number;           // 주당순자산
  close: number;         // 종가
}

export interface KrxShortBalanceRow {
  code: string;
  name: string;
  shortBalance: number;  // 공매도 잔고 수량
  shortBalanceValue: number; // 공매도 잔고 금액
  shortRatio: number;    // 상장주식수 대비 공매도 잔고 비율(%)
}

// ── 설정 ──────────────────────────────────────────────────────────────────────

// KRX_PUBLIC_API_BASE 가 우선. 블루프린트에서 KRX_API_BASE 는 인증 OpenAPI 를 가리키므로,
// 동일한 변수로 두 엔드포인트를 함께 오버라이드할 수 없다. 과거 배포에서 KRX_API_BASE 가
// data.krx.co.kr(공개) 호스트를 담고 있던 경우에만 레거시 호환으로 수용한다.
const _legacyKrxBase = (process.env.KRX_API_BASE ?? '').trim();
const _legacyPublic =
  /data\.krx\.co\.kr(?!.*\/svc\/apis)/.test(_legacyKrxBase) ? _legacyKrxBase : '';
const KRX_BASE =
  (process.env.KRX_PUBLIC_API_BASE ?? _legacyPublic) || 'http://data.krx.co.kr';
const KRX_JSON_PATH = '/comm/bldAttendant/getJsonData.cmd';
const KRX_OTP_PATH = '/comm/fileDn/GenerateOTP/generate.cmd';
const KRX_DOWNLOAD_CSV_PATH = '/comm/fileDn/download_csv/download.cmd';
const KRX_DISABLED = process.env.KRX_API_DISABLED === 'true';
const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 10 * 60 * 1000;

// bld 식별자 — KRX 정보데이터시스템 페이지 내부 키.
// KRX 리뉴얼 시 바뀔 수 있어 환경변수로 오버라이드 가능.
const BLD_INVESTOR_TRADING =
  process.env.KRX_BLD_INVESTOR_TRADING ?? 'dbms/MDC/STAT/standard/MDCSTAT02203';
const BLD_PER_PBR =
  process.env.KRX_BLD_PER_PBR ?? 'dbms/MDC/STAT/standard/MDCSTAT03501';
const BLD_SHORT_BALANCE =
  process.env.KRX_BLD_SHORT_BALANCE ?? 'dbms/MDC/STAT/srt/MDCSTAT30001';

/**
 * ADR-0141 Stage 1: KRX 11분류 투자자별 매매 BLD.
 * default `MDCSTAT02301` 추정 — 운영 환경 첫 호출 시 검증 필수.
 * 미작동 시 `KRX_BLD_INVESTOR_DETAIL` ENV 즉시 override.
 */
const BLD_INVESTOR_DETAIL =
  process.env.KRX_BLD_INVESTOR_DETAIL ?? 'dbms/MDC/STAT/standard/MDCSTAT02301';

// ── 캐시 ─────────────────────────────────────────────────────────────────────

interface CacheEntry<T> { data: T; expiresAt: number }
const _cache = new Map<string, CacheEntry<unknown>>();
const _lastInvestorTradingDiagnostics = new Map<string, KrxInvestorTradingDiagnostic>();

function setInvestorTradingDiagnostic(tradeDate: string, diagnostic: KrxInvestorTradingDiagnostic): void {
  _lastInvestorTradingDiagnostics.set(tradeDate, diagnostic);
}

export function getLastKrxInvestorTradingDiagnostic(date?: string): KrxInvestorTradingDiagnostic | null {
  const tradeDate = date && isValidYyyymmdd(date) ? date : null;
  if (tradeDate) return _lastInvestorTradingDiagnostics.get(tradeDate) ?? null;
  return Array.from(_lastInvestorTradingDiagnostics.values()).at(-1) ?? null;
}


function getCached<T>(key: string): T | null {
  const hit = _cache.get(key);
  if (!hit || hit.expiresAt <= Date.now()) return null;
  return hit.data as T;
}

function setCached<T>(key: string, data: T): void {
  _cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function resetKrxCache(): void {
  _cache.clear();
  _bldFailureState.clear();
  _lastInvestorTradingDiagnostics.clear();
  _lastKrxPostMeta.clear();
}

// ── ADR-0009: bld 연속 실패 soft cooldown ────────────────────────────────────
// 동일 bld 가 연속 5회 이상 실패 (HTTP 400 등) 하면 1시간 동안 추가 호출을 건너뛴다.
// KRX 공개 통계는 확정 지연·스키마 변경 등으로 한동안 400 을 계속 내는 경우가 있어,
// 방어적으로 호출 횟수 자체를 줄이는 쿨다운을 둔다.
interface BldFailureState {
  consecutiveFailures: number;
  cooldownUntilMs: number;
  /** ADR-0259: probe 윈도우 안 마지막 시도 시각 — 30분 안 추가 호출 skip 용. */
  recoveryProbedAt?: number;
}
const _bldFailureState = new Map<string, BldFailureState>();
const BLD_FAILURE_THRESHOLD = 5;
const BLD_KIS_FIRST_QUARANTINE_THRESHOLD = 2;
const BLD_COOLDOWN_MS = 60 * 60 * 1000; // 1시간
const RECOVERY_PROBE_WINDOW_MS = 30 * 60 * 1000; // 30분

function isKisFirstRebuildMode(): boolean {
  return process.env.KIS_FIRST_REBUILD_MODE === 'true';
}

function isBldCooldown(bld: string): boolean {
  const s = _bldFailureState.get(bld);
  if (!s) return false;
  return s.cooldownUntilMs > Date.now();
}

/**
 * ADR-0259 wiring: probe 윈도우 안 추가 호출 skip — cooldown 만료 후 30분 안에는
 * 1회만 시도. 이미 probed 했으면 다음 일반 호출 (윈도우 종료 후) 까지 skip.
 *
 * 시간 분기:
 *   - cooldownUntilMs === 0: 처음부터 cooldown 없음 → false (정상 호출)
 *   - cooldown 활성: false (별도 isBldCooldown 분기에서 처리)
 *   - cooldown 만료 + 30분 윈도우 안: recoveryProbedAt > cooldownUntilMs 이면 true
 *   - 30분 지난 후: false (일반 호출)
 */
function shouldSkipForRecoveryProbe(bld: string): boolean {
  const s = _bldFailureState.get(bld);
  if (!s || s.cooldownUntilMs === 0) return false;
  if (s.cooldownUntilMs > Date.now()) return false;
  const probeWindowEnd = s.cooldownUntilMs + RECOVERY_PROBE_WINDOW_MS;
  if (Date.now() >= probeWindowEnd) return false;
  return (s.recoveryProbedAt ?? 0) >= s.cooldownUntilMs;
}

/** ADR-0259: probe 시도 시점 마킹 — 30분 안 추가 호출 skip 트리거. */
function markRecoveryProbed(bld: string): void {
  const s = _bldFailureState.get(bld);
  if (!s || s.cooldownUntilMs === 0) return;
  if (Date.now() < s.cooldownUntilMs + RECOVERY_PROBE_WINDOW_MS) {
    s.recoveryProbedAt = Date.now();
    _bldFailureState.set(bld, s);
  }
}

function recordBldFailure(bld: string, options: { cooldownThreshold?: number; reason?: string } = {}): BldFailureState {
  const s = _bldFailureState.get(bld) ?? { consecutiveFailures: 0, cooldownUntilMs: 0 };
  s.consecutiveFailures += 1;
  const cooldownThreshold = options.cooldownThreshold ?? BLD_FAILURE_THRESHOLD;
  if (s.consecutiveFailures >= cooldownThreshold) {
    s.cooldownUntilMs = Date.now() + BLD_COOLDOWN_MS;
    console.warn(
      `[KRX] ${bld} 연속 ${s.consecutiveFailures}회 실패 — 1시간 soft cooldown 활성화`,
    );
  }
  _bldFailureState.set(bld, s);
  if (options.reason === 'OFF_HOURS_HTTP400' && s.cooldownUntilMs > Date.now()) {
    console.warn(
      `[KRX] QUARANTINED 1h endpoint=${bld.split('/').at(-1) ?? bld} reason=OFF_HOURS_HTTP400 providerIssue=true marketSignal=false useForRouter=false`,
    );
  }
  return s;
}

function recordBldSuccess(bld: string): void {
  const s = _bldFailureState.get(bld);
  if (!s) return;
  s.consecutiveFailures = 0;
  s.cooldownUntilMs = 0;
  _bldFailureState.set(bld, s);
}

/**
 * ADR-0256: KRX 호출 시간대 게이팅 — 통계 무의미 / 미확정 시간대 호출 차단.
 * 카운터 미누적 (ADR-0251 정합) — 정상 동작 인지 + 외부 호출 부담 절감.
 *
 * 차단 시간대 (KST):
 *   - PRE_DAWN (00:00~05:59): 통계 확정 전, 호출 무의미
 *   - LUNCH_BREAK (11:31~12:59): 매수 차단 구간 (volumeClock 정합)
 *   - POST_CLOSE_PRE_PUBLISH (15:30~17:59): 장 마감 후 통계 미확정
 *
 * ENV `KRX_TIME_WINDOW_GATING_DISABLED=true` → 게이팅 비활성, 모든 시각 호출 허용.
 */
function isKrxTimeWindowGatingDisabled(): boolean {
  return process.env.KRX_TIME_WINDOW_GATING_DISABLED === 'true';
}

export function shouldSkipKrxCallByTimeWindow(now: Date = new Date()):
  { skip: boolean; reason?: 'PRE_DAWN' | 'LUNCH_BREAK' | 'POST_CLOSE_PRE_PUBLISH' } {
  if (isKrxTimeWindowGatingDisabled()) return { skip: false };
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  const totalMin = kst.getUTCHours() * 60 + kst.getUTCMinutes();

  // 새벽 (00:00~05:59) — 통계 확정 전
  if (totalMin < 6 * 60) return { skip: true, reason: 'PRE_DAWN' };

  // 점심 (11:31~12:59) — 매수 차단 구간 (volumeClock 정합)
  if (totalMin >= 11 * 60 + 31 && totalMin <= 12 * 60 + 59) {
    return { skip: true, reason: 'LUNCH_BREAK' };
  }

  // 장 마감 후 ~ 18:00 (15:30~17:59) — KRX 통계 미확정
  if (totalMin >= 15 * 60 + 30 && totalMin < 18 * 60) {
    return { skip: true, reason: 'POST_CLOSE_PRE_PUBLISH' };
  }

  return { skip: false };
}

/**
 * ADR-0259: cooldown 만료 후 30분 이내 → probe mode (1회만 시도).
 * 운영자가 무의미한 재호출을 회피하면서도 회복 감지 가능.
 *
 * cooldownUntilMs > 0 (이전 cooldown 발생) AND now > cooldownUntilMs (만료) AND
 * now < cooldownUntilMs + 30 min (만료 직후 윈도우) → probe 시도.
 */
function isBldInRecoveryProbe(bld: string): boolean {
  const s = _bldFailureState.get(bld);
  if (!s) return false;
  const PROBE_WINDOW_MS = 30 * 60 * 1000;
  return s.cooldownUntilMs > 0
      && Date.now() > s.cooldownUntilMs
      && Date.now() < s.cooldownUntilMs + PROBE_WINDOW_MS;
}

/** 진단 — 외부 노출 (예: /health_full 명령). */
export function getKrxBldFailureStates(): Array<{
  bld: string;
  consecutiveFailures: number;
  cooldownActive: boolean;
  cooldownRemainingMs: number;
  recoveryProbe: boolean;
}> {
  const out: Array<{
    bld: string;
    consecutiveFailures: number;
    cooldownActive: boolean;
    cooldownRemainingMs: number;
    recoveryProbe: boolean;
  }> = [];
  for (const [bld, s] of _bldFailureState.entries()) {
    out.push({
      bld,
      consecutiveFailures: s.consecutiveFailures,
      cooldownActive: s.cooldownUntilMs > Date.now(),
      cooldownRemainingMs: Math.max(0, s.cooldownUntilMs - Date.now()),
      recoveryProbe: isBldInRecoveryProbe(bld),
    });
  }
  return out;
}

// ── 날짜 유틸 ────────────────────────────────────────────────────────────────

/** KST 기준 오늘(YYYYMMDD). 외부 조회 기본값. */
function todayKstYYYYMMDD(): string {
  // UTC → KST(+09) 변환. 런타임 TZ 영향을 받지 않도록 수동 계산.
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const kst = new Date(utcMs + 9 * 60 * 60_000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** YYYYMMDD 형식 검증 — 외부 입력값 방어. */
function isValidYyyymmdd(v: string): boolean {
  return /^\d{8}$/.test(v);
}

/**
 * KST 기준 직전 영업일(YYYYMMDD). 공휴일 캘린더 없이 "토/일 건너뛰기" 만 적용.
 * 입력이 월요일이면 금요일, 주말이면 직전 금요일, 평일이면 전일을 반환.
 * ADR-0009 — KRX 공개 통계가 당일 미확정(18:00 KST 전) 이거나 주말일 때 후퇴용.
 */
function previousBusinessDayYYYYMMDD(now: Date = new Date()): string {
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const kst = new Date(utcMs + 9 * 60 * 60_000);
  // 최대 7일 되돌려서 첫 평일을 찾는다.
  for (let i = 1; i <= 7; i++) {
    const probe = new Date(kst.getTime() - i * 24 * 60 * 60_000);
    const day = probe.getUTCDay();
    if (day >= 1 && day <= 5) {
      const y = probe.getUTCFullYear();
      const m = String(probe.getUTCMonth() + 1).padStart(2, '0');
      const d = String(probe.getUTCDate()).padStart(2, '0');
      return `${y}${m}${d}`;
    }
  }
  // 도달하지 않지만 안전망.
  return todayKstYYYYMMDD();
}

/**
 * ADR-0009 — date 미지정 시 KRX 공개 통계 조회에 쓸 "안전한" 거래일자를 결정한다.
 *   - 수동 date 인자가 유효하면 그대로 존중 (백필/디버깅 경로).
 *   - 그렇지 않고 isMarketDataPublished=false (평일 18:00 이전 또는 DATA_FETCH_FORCE_OFF)
 *     면 직전 영업일로 후퇴.
 *   - 주말 역시 직전 영업일로 후퇴 (오늘이 토/일이면 오늘 날짜는 비영업일이므로).
 *   - 그 외(평일 18:00 이후) 오늘 KST 날짜를 그대로 사용.
 */
function resolveTradeDate(date: string | undefined, now: Date = new Date()): string {
  if (date && isValidYyyymmdd(date)) return date;
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const kst = new Date(utcMs + 9 * 60 * 60_000);
  const day = kst.getUTCDay();
  const isWeekend = day === 0 || day === 6;
  if (isWeekend || !isMarketDataPublished(now)) {
    return previousBusinessDayYYYYMMDD(now);
  }
  return todayKstYYYYMMDD();
}

// ── HTTP 헬퍼 ────────────────────────────────────────────────────────────────

interface KrxRawResponse {
  /** KRX 리포트별 row 키는 가변 (OutBlock_1, output 등). 전부 맵으로 시도. */
  [key: string]: unknown;
}

interface KrxPostMeta {
  contentType: KrxInvestorTradingDiagnostic['contentType'];
  httpStatus: number | null;
  responseKind: KrxInvestorTradingDiagnostic['responseKind'];
  selectedKrxFlowMode?: NonNullable<KrxInvestorTradingDiagnostic['selectedKrxFlowMode']>;
  payloadMode?: NonNullable<KrxInvestorTradingDiagnostic['payloadMode']>;
  otpGenerated?: boolean;
  otpLength?: number;
  csvDownloaded?: boolean;
  csvRowCount?: number;
  csvColumnKeys?: string[];
  csvFailureReason?: string | null;
  csvHeaderDetected?: boolean;
  csvNoDataReason?: string | null;
  omittedKeys?: string[];
  forbiddenKeysPresent?: string[];
  requiredKeysPresent?: string[];
  requiredKeysMissing?: string[];
  sentPayloadKeys?: string[];
  consecutiveFailures?: number;
  cooldownActive?: boolean;
  cooldownRemainingMs?: number;
  offHoursSuppressed?: boolean;
  diagnosticOnly?: boolean;
  useForRouter?: boolean;
  useForGate?: boolean;
  useForLive?: boolean;
  useForShadow?: boolean;
}

interface KrxInvestorEndpointVariant {
  id: string;
  mode: 'OTP_CSV' | 'DIRECT_JSON';
  payloadMode: NonNullable<KrxInvestorTradingDiagnostic['payloadMode']>;
  endpoint: string;
  bld: string;
  routeKind: 'MARKET_INVESTOR_FLOW' | 'SYMBOL_INVESTOR_FLOW';
  routePurpose: 'MARKET_LEVEL' | 'SYMBOL_LEVEL';
  dateParam: NonNullable<KrxInvestorTradingDiagnostic['dateParam']>;
  marketCode: 'STK' | 'KSQ' | 'ALL';
  symbolCode: string | null;
  isuCd: string | null;
  shortCodeToIsuCdResolved: boolean;
  requiredParamMissing: string | null;
  symbolRequired: boolean;
  otpRequired: boolean;
  trdVolVal?: '1' | '2';
  inqTpCd?: string | null;
  inqVal?: string | null;
  detailView?: string | null;
  params: Record<string, string>;
}

export interface FetchInvestorTradingOptions {
  symbol?: string | null;
  isuCd?: string | null;
}

const _lastKrxPostMeta = new Map<string, KrxPostMeta>();

function setKrxPostMeta(bld: string, meta: KrxPostMeta): void {
  _lastKrxPostMeta.set(bld, meta);
}

function krxFailureMeta(bld: string): Pick<KrxPostMeta, 'consecutiveFailures' | 'cooldownActive' | 'cooldownRemainingMs'> {
  const state = _bldFailureState.get(bld);
  return {
    consecutiveFailures: state?.consecutiveFailures ?? 0,
    cooldownActive: Boolean(state && state.cooldownUntilMs > Date.now()),
    cooldownRemainingMs: state ? Math.max(0, state.cooldownUntilMs - Date.now()) : 0,
  };
}

function classifyContentType(header: string | null, text?: string): KrxInvestorTradingDiagnostic['contentType'] {
  const lower = (header ?? '').toLowerCase();
  const trimmed = (text ?? '').trimStart();
  if (!text && !header) return 'unknown';
  if (text !== undefined && trimmed.length === 0) return 'empty';
  if (lower.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  if (lower.includes('html') || /^<!doctype html|<html[\s>]/i.test(trimmed)) return 'html';
  if (lower.includes('csv') || lower.includes('excel') || trimmed.includes('\n') && trimmed.includes(',')) return 'csv';
  if (lower.includes('text')) return 'text';
  return 'unknown';
}

function makeKrxResponseKind(contentType: KrxInvestorTradingDiagnostic['contentType']): KrxPostMeta['responseKind'] {
  if (contentType === 'json') return 'JSON';
  if (contentType === 'html') return 'HTML';
  if (contentType === 'csv') return 'CSV';
  if (contentType === 'empty') return 'EMPTY';
  return 'TEXT';
}

const KRX_OMITTED_PAYLOAD_VALUES = new Set(['', 'NONE', 'UNKNOWN', 'N/A']);

function sanitizeKrxPayload(input: Record<string, unknown>): { payload: Record<string, string>; omittedKeys: string[] } {
  const payload: Record<string, string> = {};
  const omittedKeys: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value == null) {
      omittedKeys.push(key);
      continue;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (KRX_OMITTED_PAYLOAD_VALUES.has(trimmed)) {
        omittedKeys.push(key);
        continue;
      }
      payload[key] = trimmed;
      continue;
    }
    payload[key] = String(value);
  }
  return { payload, omittedKeys };
}

function requiredKrxPayloadKeys(variant: KrxInvestorEndpointVariant): string[] {
  if (variant.routePurpose === 'SYMBOL_LEVEL') {
    const dateKeys = variant.dateParam === 'strtDd/endDd' ? ['strtDd', 'endDd'] : [variant.dateParam];
    return ['bld', 'isuCd', ...dateKeys, 'inqVal'];
  }
  const dateKey = variant.dateParam === 'trdDd' ? 'trdDd' : variant.dateParam;
  return ['bld', 'inqTpCd', dateKey, 'mktId', 'inqVal'];
}

function forbiddenKrxPayloadKeys(variant: KrxInvestorEndpointVariant): string[] {
  const common = ['symbolCode', 'isuCd2', 'codeNmisuCd_finder_stkisu0_0'];
  if (variant.payloadMode !== 'MINIMAL_STRICT') return common;
  if (variant.routePurpose === 'MARKET_LEVEL') {
    return [
      ...common,
      'isuCd',
      'trdVolVal',
      'share',
      'money',
      'detailView',
      'csvxls_isNo',
      'locale',
    ];
  }
  return [
    ...common,
    'mktId',
    'inqTpCd',
    'trdVolVal',
    'share',
    'money',
    'detailView',
    'csvxls_isNo',
    'locale',
  ];
}

function buildKrxOtpPayload(variant: KrxInvestorEndpointVariant): {
  body: string;
  meta: Pick<KrxPostMeta, 'payloadMode' | 'omittedKeys' | 'forbiddenKeysPresent' | 'requiredKeysPresent' | 'requiredKeysMissing' | 'sentPayloadKeys'>;
} {
  const basePayload = variant.payloadMode === 'MINIMAL_STRICT'
    ? {
        name: 'fileDown',
        bld: variant.bld,
        ...variant.params,
      }
    : {
        name: 'fileDown',
        bld: variant.bld,
        url: variant.bld,
        csvxls_isNo: 'false',
        locale: 'ko_KR',
        ...variant.params,
      };
  const { payload, omittedKeys } = sanitizeKrxPayload(basePayload);
  const sentPayloadKeys = Object.keys(payload).sort();
  const requiredKeys = requiredKrxPayloadKeys(variant);
  const forbiddenKeys = forbiddenKrxPayloadKeys(variant);
  const requiredKeysPresent = requiredKeys.filter((key) => payload[key] != null);
  const requiredKeysMissing = requiredKeys.filter((key) => payload[key] == null);
  const forbiddenKeysPresent = forbiddenKeys.filter((key) => payload[key] != null);
  return {
    body: new URLSearchParams(payload).toString(),
    meta: {
      payloadMode: variant.payloadMode,
      omittedKeys: omittedKeys.sort(),
      forbiddenKeysPresent,
      requiredKeysPresent,
      requiredKeysMissing,
      sentPayloadKeys,
    },
  };
}

export const __krxClientTestOnly = {
  sanitizeKrxPayload,
};

const KRX_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function decodeKrxCsv(buffer: ArrayBuffer, contentType: string | null): string {
  const lower = (contentType ?? '').toLowerCase();
  if (lower.includes('utf-8')) return new TextDecoder('utf-8').decode(buffer);
  try {
    return new TextDecoder('euc-kr').decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && quoted && line[i + 1] === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === ',' && !quoted) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

interface ParsedKrxCsv {
  rows: Record<string, unknown>[];
  headers: string[];
  headerDetected: boolean;
  noDataReason: string | null;
}

function parseKrxCsv(text: string): ParsedKrxCsv {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return { rows: [], headers: [], headerDetected: false, noDataReason: 'EMPTY_CSV' };
  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  const headerDetected = headers.length > 0 && headers.some((header) => header.length > 0);
  if (lines.length < 2) {
    return {
      rows: [],
      headers,
      headerDetected,
      noDataReason: headerDetected ? 'HEADER_ONLY' : 'NO_CSV_HEADER',
    };
  }
  const aliasKey = (header: string): string | null => {
    const compact = header.replace(/\s+/g, '');
    if (/종목코드|단축코드/i.test(compact)) return 'ISU_SRT_CD';
    if (/종목명|종목약명/i.test(compact)) return 'ISU_ABBRV';
    if (/일자|기준일/i.test(compact)) return 'TRD_DD';
    if (/투자자구분|투자자/i.test(compact)) return 'INVST_TP_NM';
    if (/외국인/i.test(compact)) return 'FORN_INVSTR_NETBY_QTY';
    if (/기관합계|기관/i.test(compact)) return 'ORGN_INVSTR_NETBY_QTY';
    if (/개인/i.test(compact)) return 'INDIV_INVSTR_NETBY_QTY';
    if (/순매수.*대금|순매수거래대금/i.test(compact)) return 'NETBY_TRDVAL';
    if (/순매수.*수량|순매수.*거래량/i.test(compact)) return 'NETBY_QTY';
    return null;
  };
  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      const value = values[index] ?? '';
      row[header] = value;
      const alias = aliasKey(header);
      if (alias && row[alias] == null) row[alias] = value;
    });
    return row;
  });
  return {
    rows,
    headers,
    headerDetected,
    noDataReason: rows.length > 0 ? null : 'CSV_EMPTY_ROWS',
  };
}

/**
 * KRX POST 요청 1회. 실패 시 null 반환 (호출자가 빈 배열로 변환).
 * - AbortSignal timeout 으로 응답이 없어도 프로세스가 멈추지 않는다.
 * - Content-Type form-urlencoded — KRX 동적 JSON 엔드포인트 요구.
 * - Referer/Origin 헤더 — 일부 bld는 referer 없으면 거부한다.
 */
async function krxPost(
  bld: string,
  params: Record<string, string>,
  options: { bypassTimeWindow?: boolean } = {},
): Promise<KrxRawResponse | null> {
  if (KRX_DISABLED) {
    setKrxPostMeta(bld, { contentType: 'empty', httpStatus: null, responseKind: 'DISABLED' });
    return null;
  }

  // ADR-0256: 시간대 게이팅 — 통계 무의미 / 미확정 시간대 호출 차단.
  // 카운터 미누적 (ADR-0251 정합).
  const gating = options.bypassTimeWindow ? { skip: false as const } : shouldSkipKrxCallByTimeWindow();
  if (gating.skip) {
    console.debug(`[KRX] ${bld} 시간대 게이팅 스킵 (${gating.reason}, ADR-0256)`);
    setKrxPostMeta(bld, { contentType: 'empty', httpStatus: null, responseKind: 'GATED' });
    return null;
  }

  if (isBldCooldown(bld)) {
    // ADR-0009 soft cooldown — 이미 실패가 누적된 bld 는 쿨다운 동안 skip.
    setKrxPostMeta(bld, { contentType: 'empty', httpStatus: null, responseKind: 'COOLDOWN', ...krxFailureMeta(bld), diagnosticOnly: isKisFirstRebuildMode(), useForRouter: !isKisFirstRebuildMode(), useForGate: !isKisFirstRebuildMode(), useForLive: false, useForShadow: true });
    return null;
  }

  // ADR-0259 wiring: probe 윈도우 (cooldown 만료 후 30분) 안 추가 호출 skip.
  // 1회만 시도 → 성공 시 recordBldSuccess 가 cooldownUntilMs=0 으로 reset →
  // 이후 호출은 정상 동작. 실패 시 markRecoveryProbed 마킹된 상태 유지 →
  // 다음 30분 윈도우 안 호출은 skip (또 실패해서 cooldown 재발 방지).
  if (shouldSkipForRecoveryProbe(bld)) {
    console.debug(`[KRX] ${bld} probe 윈도우 안 추가 호출 skip (ADR-0259)`);
    setKrxPostMeta(bld, { contentType: 'empty', httpStatus: null, responseKind: 'COOLDOWN', ...krxFailureMeta(bld), diagnosticOnly: isKisFirstRebuildMode(), useForRouter: !isKisFirstRebuildMode(), useForGate: !isKisFirstRebuildMode(), useForLive: false, useForShadow: true });
    return null;
  }

  // probe 윈도우 안 첫 시도 시점 마킹 — 다음 호출은 skip.
  markRecoveryProbed(bld);

  const body = new URLSearchParams({ bld, ...params }).toString();

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${KRX_BASE}${KRX_JSON_PATH}`, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': KRX_USER_AGENT,
        'Referer': `${KRX_BASE}/contents/MDC/STAT/standard/MDCSTAT0201.cmd`,
        'Origin':  KRX_BASE,
      },
      body,
    });
    if (!res.ok) {
      // 주말 KRX 400 — resolveTradeDate 가 직전 영업일로 후퇴해도 bld 별 간헐 400.
      // 정보 가치 0 + cooldown 오염 방지를 위해 silent return (recordBldFailure 도 생략).
      if (res.status === 400 && isKstWeekend()) {
        setKrxPostMeta(bld, { contentType: 'empty', httpStatus: res.status, responseKind: 'HTTP_ERROR' });
        return null;
      }
      // ADR-0251: 평일 off-hours (장 시작 전 / 점심 / 마감 후 통계 미확정 창)
      // 의 400 은 정상 동작 — 카운터 미누적 (주말과 동일 정책). 사용자 5/6
      // 보고: 점심시간 KRX 400 누적이 cooldown 트리거하던 결함 차단.
      if (res.status === 400 && !isMarketDataPublished()) {
        const kisFirst = isKisFirstRebuildMode();
        if (kisFirst) {
          recordBldFailure(bld, { cooldownThreshold: BLD_KIS_FIRST_QUARANTINE_THRESHOLD, reason: 'OFF_HOURS_HTTP400' });
        }
        console.debug(`[KRX] ${bld} HTTP 400 (off-hours fallback — suppressed, ADR-0251)`);
        setKrxPostMeta(bld, { contentType: 'empty', httpStatus: res.status, responseKind: 'HTTP_ERROR', ...krxFailureMeta(bld), offHoursSuppressed: true, diagnosticOnly: kisFirst, useForRouter: !kisFirst, useForGate: !kisFirst, useForLive: false, useForShadow: true });
        return null;
      }
      console.warn(`[KRX] ${bld} HTTP ${res.status}`);
      setKrxPostMeta(bld, { contentType: 'empty', httpStatus: res.status, responseKind: 'HTTP_ERROR' });
      recordBldFailure(bld);
      return null;
    }
    const text = await res.text();
    const contentType = classifyContentType(res.headers?.get?.('content-type') ?? null, text);
    if (!text.trim()) {
      setKrxPostMeta(bld, { contentType, httpStatus: res.status, responseKind: 'EMPTY' });
      recordBldFailure(bld);
      return null;
    }
    try {
      const parsed = JSON.parse(text);
      setKrxPostMeta(bld, { contentType, httpStatus: res.status, responseKind: 'JSON' });
      recordBldSuccess(bld);
      return parsed;
    }
    catch {
      console.warn(`[KRX] ${bld} JSON 파싱 실패 (앞 120자: ${text.slice(0, 120)})`);
      setKrxPostMeta(bld, { contentType, httpStatus: res.status, responseKind: makeKrxResponseKind(contentType) });
      recordBldFailure(bld);
      return null;
    }
  } catch (e) {
    // AbortError 포함 — 네트워크/타임아웃 모두 빈 응답 처리.
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[KRX] ${bld} 네트워크 실패: ${msg}`);
    setKrxPostMeta(bld, { contentType: 'unknown', httpStatus: null, responseKind: 'NETWORK_ERROR' });
    recordBldFailure(bld);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function krxInvestorOtpCsv(
  variant: KrxInvestorEndpointVariant,
): Promise<KrxRawResponse | null> {
  const { body: otpBody, meta: payloadMeta } = buildKrxOtpPayload(variant);
  if (KRX_DISABLED) {
    setKrxPostMeta(variant.bld, {
      ...payloadMeta,
      contentType: 'empty',
      httpStatus: null,
      responseKind: 'DISABLED',
      selectedKrxFlowMode: 'OTP_CSV',
      otpGenerated: false,
      otpLength: 0,
      csvDownloaded: false,
      csvRowCount: 0,
      csvColumnKeys: [],
      csvFailureReason: 'KRX_API_DISABLED',
      csvHeaderDetected: false,
      csvNoDataReason: 'KRX_API_DISABLED',
    });
    return null;
  }

  try {
    const otpRes = await fetch(`${KRX_BASE}${KRX_OTP_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/plain, */*',
        'User-Agent': KRX_USER_AGENT,
        'Referer': `${KRX_BASE}/contents/MDC/MDI/mdiLoader`,
        'Origin': KRX_BASE,
      },
      body: otpBody,
    });
    if (!otpRes.ok) {
      setKrxPostMeta(variant.bld, {
        ...payloadMeta,
        contentType: 'text',
        httpStatus: otpRes.status,
        responseKind: 'HTTP_ERROR',
        selectedKrxFlowMode: 'OTP_CSV',
        otpGenerated: false,
        otpLength: 0,
        csvDownloaded: false,
        csvRowCount: 0,
        csvColumnKeys: [],
        csvFailureReason: `OTP_HTTP_${otpRes.status}`,
        csvHeaderDetected: false,
        csvNoDataReason: `OTP_HTTP_${otpRes.status}`,
      });
      return null;
    }
    const otp = (await otpRes.text()).trim();
    const otpGenerated = otp.length > 0 && !/^<!doctype html|<html[\s>]/i.test(otp);
    if (!otpGenerated) {
      setKrxPostMeta(variant.bld, {
        ...payloadMeta,
        contentType: otp.length > 0 ? 'html' : 'empty',
        httpStatus: otpRes.status,
        responseKind: otp.length > 0 ? 'HTML' : 'EMPTY',
        selectedKrxFlowMode: 'OTP_CSV',
        otpGenerated: false,
        otpLength: otp.length,
        csvDownloaded: false,
        csvRowCount: 0,
        csvColumnKeys: [],
        csvFailureReason: otp.length > 0 ? 'OTP_HTML_OR_SESSION_REQUIRED' : 'OTP_EMPTY',
        csvHeaderDetected: false,
        csvNoDataReason: otp.length > 0 ? 'OTP_HTML_OR_SESSION_REQUIRED' : 'OTP_EMPTY',
      });
      return null;
    }

    const csvRes = await fetch(`${KRX_BASE}${KRX_DOWNLOAD_CSV_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/csv, application/octet-stream, text/plain, */*',
        'User-Agent': KRX_USER_AGENT,
        'Referer': `${KRX_BASE}/contents/MDC/MDI/mdiLoader`,
        'Origin': KRX_BASE,
      },
      body: new URLSearchParams({ code: otp }).toString(),
    });
    if (!csvRes.ok) {
      setKrxPostMeta(variant.bld, {
        ...payloadMeta,
        contentType: 'text',
        httpStatus: csvRes.status,
        responseKind: 'HTTP_ERROR',
        selectedKrxFlowMode: 'OTP_CSV',
        otpGenerated: true,
        otpLength: otp.length,
        csvDownloaded: false,
        csvRowCount: 0,
        csvColumnKeys: [],
        csvFailureReason: `CSV_HTTP_${csvRes.status}`,
        csvHeaderDetected: false,
        csvNoDataReason: `CSV_HTTP_${csvRes.status}`,
      });
      return null;
    }
    const arrayBuffer = await csvRes.arrayBuffer();
    const contentType = csvRes.headers?.get?.('content-type') ?? null;
    const text = decodeKrxCsv(arrayBuffer, contentType);
    const parsed = parseKrxCsv(text);
    const rows = parsed.rows.map((row) => {
      if (variant.routePurpose !== 'SYMBOL_LEVEL' || !variant.symbolCode) return row;
      return {
        ...row,
        ISU_SRT_CD: row.ISU_SRT_CD ?? variant.symbolCode,
        ISU_CD: row.ISU_CD ?? variant.isuCd ?? undefined,
      };
    });
    const columnKeys = rows[0] ? Object.keys(rows[0]).slice(0, 40) : parsed.headers.slice(0, 40);
    const responseKind = makeKrxResponseKind(classifyContentType(contentType, text));
    const csvNoDataReason = rows.length > 0
      ? null
      : parsed.headerDetected ? 'CSV_NO_DATA_FOR_DATE' : 'PARAMETER_MISMATCH';
    setKrxPostMeta(variant.bld, {
      ...payloadMeta,
      contentType: classifyContentType(contentType, text),
      httpStatus: csvRes.status,
      responseKind,
      selectedKrxFlowMode: 'OTP_CSV',
      otpGenerated: true,
      otpLength: otp.length,
      csvDownloaded: true,
      csvRowCount: rows.length,
      csvColumnKeys: columnKeys,
      csvFailureReason: csvNoDataReason,
      csvHeaderDetected: parsed.headerDetected,
      csvNoDataReason,
    });
    if (rows.length > 0) recordBldSuccess(variant.bld);
    return { csv: rows };
  } catch (error) {
    setKrxPostMeta(variant.bld, {
      ...payloadMeta,
      contentType: 'unknown',
      httpStatus: null,
      responseKind: 'NETWORK_ERROR',
      selectedKrxFlowMode: 'OTP_CSV',
      otpGenerated: false,
      otpLength: 0,
      csvDownloaded: false,
      csvRowCount: 0,
      csvColumnKeys: [],
      csvFailureReason: error instanceof Error ? error.message.slice(0, 80) : String(error).slice(0, 80),
      csvHeaderDetected: false,
      csvNoDataReason: 'NETWORK_ERROR',
    });
    return null;
  }
}

const INVESTOR_ROW_CANDIDATE_KEYS = ['OutBlock_1', 'output', 'output1', 'output2', 'data', 'csv', 'list', 'rows', 'result', 'block1'] as const;

interface ExtractRowsResult {
  rows: Record<string, unknown>[];
  detectedCandidatePaths: string[];
  selectedRowPath: string | null;
  firstRowKeys: string[];
}

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

interface NormalizedInvestorRowsResult {
  rows: KrxInvestorRow[];
  fieldMappings: KrxInvestorTradingDiagnostic['fieldMappings'];
}

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
  const meta = _lastKrxPostMeta.get(bld);
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

function compactTradeDate(date: string): string {
  return date.replace(/[^0-9]/g, '');
}

function normalizeIsuCd(value: unknown): string {
  const normalized = String(value ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{12}$/.test(normalized) ? normalized : '';
}

interface KrxIsuCdResolution {
  isuCd: string | null;
  shortCodeToIsuCdResolved: boolean;
  source: 'FETCH_OPTION' | 'STOCK_MASTER' | 'NONE';
}

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
  const tradeDate = resolveTradeDate(date);
  const symbolCode = normalizeCode(options.symbol);
  const explicitIsuCd = normalizeIsuCd(options.isuCd);
  const cacheKey = `investor:${tradeDate}:${symbolCode || 'ALL'}:${explicitIsuCd || 'AUTO_ISU'}`;
  const cached = getCached<KrxInvestorRow[]>(cacheKey);
  if (cached) return cached;

  const compactDate = compactTradeDate(tradeDate);
  const isuCdResolution = resolveKrxIsuCdForSymbol(symbolCode, explicitIsuCd);
  const variants = buildInvestorTradingVariants(compactDate, symbolCode, isuCdResolution);
  const attemptedDiagnostics: KrxInvestorTradingDiagnostic[] = [];
  const attemptedVariantIds: string[] = [];
  for (const variant of variants) {
    attemptedVariantIds.push(variant.id);
    const raw = variant.mode === 'OTP_CSV'
      ? await krxInvestorOtpCsv(variant)
      : await krxPost(variant.bld, variant.params, { bypassTimeWindow: true });
    const extracted = extractRowsDetailed(raw);
    const normalized = normalizeKrxInvestorRows(extracted.rows);
    const rows = symbolCode
      ? normalized.rows.filter((row) => row.code === symbolCode)
      : normalized.rows;
    const diagnostic = buildInvestorTradingDiagnostic({
      raw,
      tradeDate: compactDate,
      extract: extracted,
      normalized: { ...normalized, rows },
      variant,
      attemptedVariants: [...attemptedVariantIds],
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
export interface KrxInvestorDetailRow {
  /** 카테고리 한글명 raw 보존 (예: "금융투자", "외국인") */
  category: string;
  /** 순매수 수량 (주, 양수=순매수) */
  netBuyQty: number;
  /** 순매수 거래대금 (원) */
  netBuyKrw: number;
}

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
    cacheKeys: Array.from(_cache.keys()),
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
 */
export function krxGet(
  endpoint: string,
  params: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  return _openApiGet(endpoint, params) as Promise<Record<string, unknown> | null>;
}

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
export interface KrxMarketCapRow {
  code: string;
  name: string;
  marketCap: number;    // 원 단위 (KRX MKTCAP 원본)
  listedShares: number; // 주 단위
  market: string;       // 'KOSPI' | 'KOSDAQ' | …
}

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
