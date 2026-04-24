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
import { isMarketDataPublished } from '../utils/marketClock.js';

// ── 타입 ─────────────────────────────────────────────────────────────────────

export interface KrxInvestorRow {
  code: string;          // 6자리 종목코드
  name: string;          // 한글 종목명
  foreignNetBuy: number; // 외국인 순매수 수량(주)
  institutionNetBuy: number; // 기관 순매수 수량(주)
  individualNetBuy: number;  // 개인 순매수 수량(주)
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

// ── 캐시 ─────────────────────────────────────────────────────────────────────

interface CacheEntry<T> { data: T; expiresAt: number }
const _cache = new Map<string, CacheEntry<unknown>>();

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
}

// ── ADR-0009: bld 연속 실패 soft cooldown ────────────────────────────────────
// 동일 bld 가 연속 5회 이상 실패 (HTTP 400 등) 하면 1시간 동안 추가 호출을 건너뛴다.
// KRX 공개 통계는 확정 지연·스키마 변경 등으로 한동안 400 을 계속 내는 경우가 있어,
// 방어적으로 호출 횟수 자체를 줄이는 쿨다운을 둔다.
interface BldFailureState {
  consecutiveFailures: number;
  cooldownUntilMs: number;
}
const _bldFailureState = new Map<string, BldFailureState>();
const BLD_FAILURE_THRESHOLD = 5;
const BLD_COOLDOWN_MS = 60 * 60 * 1000; // 1시간

function isBldCooldown(bld: string): boolean {
  const s = _bldFailureState.get(bld);
  if (!s) return false;
  return s.cooldownUntilMs > Date.now();
}

function recordBldFailure(bld: string): void {
  const s = _bldFailureState.get(bld) ?? { consecutiveFailures: 0, cooldownUntilMs: 0 };
  s.consecutiveFailures += 1;
  if (s.consecutiveFailures >= BLD_FAILURE_THRESHOLD) {
    s.cooldownUntilMs = Date.now() + BLD_COOLDOWN_MS;
    console.warn(
      `[KRX] ${bld} 연속 ${s.consecutiveFailures}회 실패 — 1시간 soft cooldown 활성화`,
    );
  }
  _bldFailureState.set(bld, s);
}

function recordBldSuccess(bld: string): void {
  const s = _bldFailureState.get(bld);
  if (!s) return;
  s.consecutiveFailures = 0;
  s.cooldownUntilMs = 0;
  _bldFailureState.set(bld, s);
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

/**
 * KRX POST 요청 1회. 실패 시 null 반환 (호출자가 빈 배열로 변환).
 * - AbortSignal timeout 으로 응답이 없어도 프로세스가 멈추지 않는다.
 * - Content-Type form-urlencoded — KRX 동적 JSON 엔드포인트 요구.
 * - Referer/Origin 헤더 — 일부 bld는 referer 없으면 거부한다.
 */
async function krxPost(
  bld: string,
  params: Record<string, string>,
): Promise<KrxRawResponse | null> {
  if (KRX_DISABLED) return null;
  if (isBldCooldown(bld)) {
    // ADR-0009 soft cooldown — 이미 실패가 누적된 bld 는 쿨다운 동안 skip.
    return null;
  }
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
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': `${KRX_BASE}/contents/MDC/STAT/standard/MDCSTAT0201.cmd`,
        'Origin':  KRX_BASE,
      },
      body,
    });
    if (!res.ok) {
      console.warn(`[KRX] ${bld} HTTP ${res.status}`);
      recordBldFailure(bld);
      return null;
    }
    const text = await res.text();
    if (!text.trim()) {
      recordBldFailure(bld);
      return null;
    }
    try {
      const parsed = JSON.parse(text);
      recordBldSuccess(bld);
      return parsed;
    }
    catch {
      console.warn(`[KRX] ${bld} JSON 파싱 실패 (앞 120자: ${text.slice(0, 120)})`);
      recordBldFailure(bld);
      return null;
    }
  } catch (e) {
    // AbortError 포함 — 네트워크/타임아웃 모두 빈 응답 처리.
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[KRX] ${bld} 네트워크 실패: ${msg}`);
    recordBldFailure(bld);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** KRX 응답에서 가장 그럴듯한 row 배열을 추출한다. 스키마 불명 시 첫 배열 사용. */
function extractRows(raw: KrxRawResponse | null): Record<string, string>[] {
  if (!raw || typeof raw !== 'object') return [];
  // 알려진 후보 키를 먼저 시도.
  const known = ['OutBlock_1', 'output', 'block1', 'list'];
  for (const k of known) {
    const v = (raw as Record<string, unknown>)[k];
    if (Array.isArray(v)) return v as Record<string, string>[];
  }
  // 그 외엔 첫 배열 값을 사용.
  for (const k of Object.keys(raw)) {
    const v = (raw as Record<string, unknown>)[k];
    if (Array.isArray(v)) return v as Record<string, string>[];
  }
  return [];
}

/** "1,234,567" · "-1,234" · "" → number. 실패 시 0. */
function toNum(s: string | undefined | null): number {
  if (s == null) return 0;
  const trimmed = String(s).trim();
  if (!trimmed || trimmed === '-') return 0;
  const n = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** KRX 종목코드는 때때로 'A005930' 처럼 A 접두어가 붙는다. 제거 + 6자리 보장. */
function normalizeCode(s: string | undefined | null): string {
  if (!s) return '';
  const stripped = String(s).trim().replace(/^[A-Z]/, '');
  return stripped.length === 6 && /^\d{6}$/.test(stripped) ? stripped : '';
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * 투자자별 개별종목 거래실적. 기본값: KST 오늘.
 * KRX 리포트 필드명 (MDCSTAT02203)은 한글 키 — 방어적 다중 키 fallback 적용.
 */
export async function fetchInvestorTrading(date?: string): Promise<KrxInvestorRow[]> {
  const tradeDate = resolveTradeDate(date);
  const cacheKey = `investor:${tradeDate}`;
  const cached = getCached<KrxInvestorRow[]>(cacheKey);
  if (cached) return cached;

  const raw = await krxPost(BLD_INVESTOR_TRADING, {
    searchType:   '1',
    mktId:        'ALL',
    trdVolVal:    '1',         // 1=거래량, 2=거래대금
    strtDd:       tradeDate,
    endDd:        tradeDate,
    share:        '1',
    money:        '1',
    csvxls_isNo:  'false',
  });
  const rows = extractRows(raw);

  const out: KrxInvestorRow[] = [];
  for (const r of rows) {
    const code = normalizeCode(r.ISU_SRT_CD ?? r.ISU_CD);
    if (!code) continue;
    out.push({
      code,
      name: String(r.ISU_ABBRV ?? r.ISU_NM ?? '').trim(),
      // FORN_*/ORGN_*/INVSTR_* 키는 보고서 버전에 따라 다소 다르다 — 우선순위별 시도.
      foreignNetBuy: toNum(
        r.FORN_INVSTR_NETBY_QTY ?? r.FORN_NETBY_QTY ?? r.FORN_BUY_SELL_NET_QTY,
      ),
      institutionNetBuy: toNum(
        r.ORGN_INVSTR_NETBY_QTY ?? r.ORGN_NETBY_QTY ?? r.ORG_NETBY_QTY,
      ),
      individualNetBuy: toNum(
        r.INDIV_INVSTR_NETBY_QTY ?? r.PRVT_NETBY_QTY ?? r.IDV_NETBY_QTY,
      ),
    });
  }
  setCached(cacheKey, out);
  return out;
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
