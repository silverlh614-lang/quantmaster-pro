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
 *   3. KRX_API_BASE 환경변수로 프라이빗 라우팅(사내 프록시 등) 가능.
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

const KRX_BASE = process.env.KRX_API_BASE ?? 'http://data.krx.co.kr';
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

export function resetKrxCache(): void { _cache.clear(); }

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
      return null;
    }
    const text = await res.text();
    if (!text.trim()) return null;
    try { return JSON.parse(text); }
    catch {
      console.warn(`[KRX] ${bld} JSON 파싱 실패 (앞 120자: ${text.slice(0, 120)})`);
      return null;
    }
  } catch (e) {
    // AbortError 포함 — 네트워크/타임아웃 모두 빈 응답 처리.
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[KRX] ${bld} 네트워크 실패: ${msg}`);
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
  const tradeDate = date && isValidYyyymmdd(date) ? date : todayKstYYYYMMDD();
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
  const tradeDate = date && isValidYyyymmdd(date) ? date : todayKstYYYYMMDD();
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
  const tradeDate = date && isValidYyyymmdd(date) ? date : todayKstYYYYMMDD();
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
