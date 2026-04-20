/**
 * krxOpenApi.ts — 한국거래소(KRX) Data Marketplace Open API **인증 어댑터**.
 *
 * 기존 `krxClient.ts`는 data.krx.co.kr 의 공개(비인증) JSON 엔드포인트를 사용한다.
 * 이 모듈은 그것과 별개로, KRX가 공식 발급한 AUTH_KEY 를 사용해
 * openapi.krx.co.kr / data-dbg.krx.co.kr 의 **인가된 서비스**만 호출한다.
 *
 * 적용 서비스 (승인 받은 항목만):
 *   - /sto/stk_bydd_trd        — 유가증권(KOSPI) 일별매매정보
 *   - /sto/ksq_bydd_trd        — 코스닥(KOSDAQ) 일별매매정보
 *   - /sto/stk_isu_base_info   — 유가증권 종목기본정보
 *   - /sto/ksq_isu_base_info   — 코스닥 종목기본정보
 *   - /idx/kospi_dd_trd        — KOSPI 시리즈 일별시세정보
 *   - /idx/kosdaq_dd_trd       — KOSDAQ 시리즈 일별시세정보
 *   - /idx/krx_dd_trd          — KRX 시리즈 일별시세정보
 *   - /idx/drvprod_dd_trd      — 파생상품지수 시세정보
 *
 * 설계 원칙:
 *   1. 민감한 외부 쿼터(일 10,000회 제한)를 아끼기 위해 응답은 메모리 캐시(기본 15분).
 *   2. 인증 실패·네트워크 실패·비정상 JSON 은 모두 빈 배열/ null 반환 — throw 하지 않는다.
 *   3. 서킷브레이커(createCircuitBreaker)로 연속 실패 시 일정 시간 호출을 단락.
 *   4. `KRX_OPENAPI_AUTH_KEY` 미설정 또는 `KRX_OPENAPI_DISABLED=true` 이면 즉시 null/[].
 *   5. 호출자는 `isKrxOpenApiHealthy()` 로 상태를 물어 fallback 여부를 결정.
 */

import { createCircuitBreaker, CircuitOpenError } from '../utils/circuitBreaker.js';

// ── 타입 ─────────────────────────────────────────────────────────────────────

/** KOSPI / KOSDAQ 일별매매정보의 단일 종목 행 (stk_bydd_trd · ksq_bydd_trd) */
export interface KrxStockDailyRow {
  baseDate: string;    // YYYYMMDD
  code: string;        // 단축종목코드 (6자리)
  isin: string;        // ISIN 코드
  name: string;        // 한글 종목명
  market: string;      // 시장구분 (KOSPI/KOSDAQ/KOSDAQ GLOBAL 등)
  sector: string;      // 소속부/섹터명 (비어있을 수 있음)
  close: number;       // 종가
  change: number;      // 대비 (전일비)
  changePct: number;   // 등락률(%)
  open: number;        // 시가
  high: number;        // 고가
  low: number;         // 저가
  volume: number;      // 거래량 (주)
  value: number;       // 거래대금 (원)
  marketCap: number;   // 시가총액 (원)
  listedShares: number;// 상장주식수 (주)
}

/** 종목 기본정보 (stk_isu_base_info · ksq_isu_base_info) */
export interface KrxIsuBaseInfoRow {
  code: string;        // 단축종목코드
  isin: string;        // ISIN
  name: string;        // 한글 종목명
  nameEng: string;     // 영문 종목명
  listDate: string;    // 상장일 YYYYMMDD
  market: string;      // 시장구분
  securityType: string;// 주식종류
  parValue: number;    // 액면가
  listedShares: number;// 상장주식수
}

/** 지수 일별시세 (kospi_dd_trd · kosdaq_dd_trd · krx_dd_trd · drvprod_dd_trd) */
export interface KrxIndexDailyRow {
  baseDate: string;
  indexCode: string;   // 지수코드
  indexName: string;   // 지수명
  close: number;       // 종가
  change: number;      // 대비
  changePct: number;   // 등락률(%)
  open: number;        // 시가
  high: number;        // 고가
  low: number;         // 저가
  volume: number;      // 거래량
  value: number;       // 거래대금
  marketCap: number;   // 시가총액 (주식 지수 한정)
}

// ── 설정 ──────────────────────────────────────────────────────────────────────

const DEFAULT_BASE = 'https://data-dbg.krx.co.kr/svc/apis';
const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 15 * 60 * 1000;

function readBaseUrl(): string {
  return (process.env.KRX_OPENAPI_BASE ?? DEFAULT_BASE).replace(/\/+$/, '');
}
function readAuthKey(): string {
  return (process.env.KRX_OPENAPI_AUTH_KEY ?? '').trim();
}
function readDisabled(): boolean {
  return process.env.KRX_OPENAPI_DISABLED === 'true';
}

// 엔드포인트 경로 — KRX가 구조를 바꿀 경우 env로 오버라이드 가능.
const EP = {
  kospiDailyTrade:   process.env.KRX_OPENAPI_EP_STK_BYDD ?? 'sto/stk_bydd_trd',
  kosdaqDailyTrade:  process.env.KRX_OPENAPI_EP_KSQ_BYDD ?? 'sto/ksq_bydd_trd',
  kospiBaseInfo:     process.env.KRX_OPENAPI_EP_STK_BASE ?? 'sto/stk_isu_base_info',
  kosdaqBaseInfo:    process.env.KRX_OPENAPI_EP_KSQ_BASE ?? 'sto/ksq_isu_base_info',
  kospiIndexDaily:   process.env.KRX_OPENAPI_EP_KOSPI_IDX ?? 'idx/kospi_dd_trd',
  kosdaqIndexDaily:  process.env.KRX_OPENAPI_EP_KOSDAQ_IDX ?? 'idx/kosdaq_dd_trd',
  krxIndexDaily:     process.env.KRX_OPENAPI_EP_KRX_IDX ?? 'idx/krx_dd_trd',
  derivIndexDaily:   process.env.KRX_OPENAPI_EP_DRV_IDX ?? 'idx/drvprod_dd_trd',
} as const;

// ── 서킷브레이커 ──────────────────────────────────────────────────────────────

const breaker = createCircuitBreaker({
  name: 'krx-openapi',
  failureThreshold: 5,
  windowMs: 60_000,
  cooldownMs: 5 * 60_000, // 5분 — 쿼터 보호를 위해 기본 서킷보다 길게.
});

// ── 캐시 ─────────────────────────────────────────────────────────────────────

interface CacheEntry<T> { data: T; expiresAt: number }
const _cache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | null {
  const hit = _cache.get(key);
  if (!hit || hit.expiresAt <= Date.now()) return null;
  return hit.data as T;
}
function cacheSet<T>(key: string, data: T): void {
  _cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}
export function resetKrxOpenApiCache(): void { _cache.clear(); }

// ── 유틸 ─────────────────────────────────────────────────────────────────────

/** KST 기준 최근 영업일 YYYYMMDD — 주말이면 직전 평일, 그 외 하루 전. */
function recentBusinessDayKst(): string {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const kst = new Date(utcMs + 9 * 60 * 60_000);
  // 하루 전부터 시작 (당일 데이터는 장마감 후 KRX 반영까지 지연).
  kst.setUTCDate(kst.getUTCDate() - 1);
  while (kst.getUTCDay() === 0 || kst.getUTCDay() === 6) {
    kst.setUTCDate(kst.getUTCDate() - 1);
  }
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function isValidYyyymmdd(v: string): boolean {
  return /^\d{8}$/.test(v);
}

function toNum(s: string | number | undefined | null): number {
  if (s == null) return 0;
  if (typeof s === 'number') return Number.isFinite(s) ? s : 0;
  const trimmed = String(s).trim();
  if (!trimmed || trimmed === '-') return 0;
  const n = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function toStr(s: string | number | undefined | null): string {
  if (s == null) return '';
  return String(s).trim();
}

function normalizeCode(s: string | undefined | null): string {
  if (!s) return '';
  const stripped = String(s).trim().replace(/^[A-Z]/, '');
  return /^\d{6}$/.test(stripped) ? stripped : '';
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

interface KrxOpenApiResponse {
  OutBlock_1?: Record<string, string | number>[];
  output?: Record<string, string | number>[];
  [key: string]: unknown;
}

function extractRows(raw: KrxOpenApiResponse | null): Record<string, string | number>[] {
  if (!raw || typeof raw !== 'object') return [];
  if (Array.isArray(raw.OutBlock_1)) return raw.OutBlock_1;
  if (Array.isArray(raw.output)) return raw.output;
  for (const v of Object.values(raw)) {
    if (Array.isArray(v)) return v as Record<string, string | number>[];
  }
  return [];
}

/**
 * KRX OpenAPI GET 호출. 성공 시 JSON, 실패 시 null.
 * - 서킷브레이커로 감싸 연속 실패를 단락시킨다.
 * - AbortSignal 타임아웃으로 hung 호출 방지.
 * - AUTH_KEY 미설정·DISABLED 플래그 시 즉시 null.
 */
async function krxGet(
  endpoint: string,
  params: Record<string, string>,
): Promise<KrxOpenApiResponse | null> {
  if (readDisabled()) return null;
  const authKey = readAuthKey();
  if (!authKey) return null;

  const url = new URL(`${readBaseUrl()}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await breaker.exec(async () => {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'AUTH_KEY': authKey,
          'Accept': 'application/json',
        },
        signal: ac.signal,
      });
      if (!res.ok) {
        // 인증 오류(401/403)는 스팸이 되므로 1회만 명확히 로깅.
        if (res.status === 401 || res.status === 403) {
          console.warn(`[KRX-OPEN] ${endpoint} 인증 실패 HTTP ${res.status} — AUTH_KEY 확인 필요`);
        } else {
          console.warn(`[KRX-OPEN] ${endpoint} HTTP ${res.status}`);
        }
        throw new Error(`HTTP_${res.status}`);
      }
      const text = await res.text();
      if (!text.trim()) throw new Error('EMPTY_BODY');
      try {
        return JSON.parse(text) as KrxOpenApiResponse;
      } catch {
        console.warn(`[KRX-OPEN] ${endpoint} JSON 파싱 실패 (앞 120자: ${text.slice(0, 120)})`);
        throw new Error('JSON_PARSE');
      }
    });
  } catch (e) {
    if (e instanceof CircuitOpenError) {
      // 서킷 OPEN — 호출하지 않고 즉시 null. 로그는 서킷브레이커가 담당.
      return null;
    }
    const msg = e instanceof Error ? e.message : String(e);
    // 타임아웃/네트워크 에러는 WARN (에러는 서킷브레이커가 누적 판단).
    console.warn(`[KRX-OPEN] ${endpoint} 실패: ${msg}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── 매퍼 ─────────────────────────────────────────────────────────────────────

function mapStockDailyRow(r: Record<string, string | number>): KrxStockDailyRow | null {
  const code = normalizeCode(toStr(r.ISU_SRT_CD ?? r.ISU_CD));
  if (!code) return null;
  return {
    baseDate: toStr(r.BAS_DD),
    code,
    isin: toStr(r.ISU_CD),
    name: toStr(r.ISU_NM ?? r.ISU_ABBRV),
    market: toStr(r.MKT_NM),
    sector: toStr(r.SECT_TP_NM),
    close: toNum(r.TDD_CLSPRC),
    change: toNum(r.CMPPREVDD_PRC),
    changePct: toNum(r.FLUC_RT),
    open: toNum(r.TDD_OPNPRC),
    high: toNum(r.TDD_HGPRC),
    low: toNum(r.TDD_LWPRC),
    volume: toNum(r.ACC_TRDVOL),
    value: toNum(r.ACC_TRDVAL),
    marketCap: toNum(r.MKTCAP),
    listedShares: toNum(r.LIST_SHRS),
  };
}

function mapIsuBaseInfoRow(r: Record<string, string | number>): KrxIsuBaseInfoRow | null {
  const code = normalizeCode(toStr(r.ISU_SRT_CD ?? r.SHORT_CODE ?? r.ISU_CD));
  if (!code) return null;
  return {
    code,
    isin: toStr(r.ISU_CD),
    name: toStr(r.ISU_NM ?? r.ISU_ABBRV),
    nameEng: toStr(r.ISU_ENG_NM),
    listDate: toStr(r.LIST_DD),
    market: toStr(r.MKT_TP_NM),
    securityType: toStr(r.SECUGRP_NM ?? r.SECT_TP_NM),
    parValue: toNum(r.PARVAL),
    listedShares: toNum(r.LIST_SHRS),
  };
}

function mapIndexDailyRow(r: Record<string, string | number>): KrxIndexDailyRow | null {
  const indexName = toStr(r.IDX_NM);
  if (!indexName) return null;
  return {
    baseDate: toStr(r.BAS_DD),
    indexCode: toStr(r.IDX_IND_CD),
    indexName,
    close: toNum(r.CLSPRC_IDX),
    change: toNum(r.CMPPREVDD_IDX),
    changePct: toNum(r.FLUC_RT),
    open: toNum(r.OPNPRC_IDX),
    high: toNum(r.HGPRC_IDX),
    low: toNum(r.LWPRC_IDX),
    volume: toNum(r.ACC_TRDVOL),
    value: toNum(r.ACC_TRDVAL),
    marketCap: toNum(r.MKTCAP),
  };
}

// ── 공개 API : 주식 ──────────────────────────────────────────────────────────

async function fetchStockDaily(
  endpoint: string,
  cachePrefix: string,
  date?: string,
): Promise<KrxStockDailyRow[]> {
  const basDd = date && isValidYyyymmdd(date) ? date : recentBusinessDayKst();
  const key = `${cachePrefix}:${basDd}`;
  const hit = cacheGet<KrxStockDailyRow[]>(key);
  if (hit) return hit;

  const raw = await krxGet(endpoint, { basDd });
  const rows = extractRows(raw);
  const out: KrxStockDailyRow[] = [];
  for (const r of rows) {
    const mapped = mapStockDailyRow(r);
    if (mapped) out.push(mapped);
  }
  // 빈 결과는 캐시하지 않는다 (일시 장애 시 스팸 방지).
  if (out.length > 0) cacheSet(key, out);
  return out;
}

/** 유가증권(KOSPI) 일별매매정보. */
export function fetchKospiDailyTrade(date?: string): Promise<KrxStockDailyRow[]> {
  return fetchStockDaily(EP.kospiDailyTrade, 'kospi-bydd', date);
}

/** 코스닥(KOSDAQ) 일별매매정보. */
export function fetchKosdaqDailyTrade(date?: string): Promise<KrxStockDailyRow[]> {
  return fetchStockDaily(EP.kosdaqDailyTrade, 'kosdaq-bydd', date);
}

async function fetchIsuBaseInfo(
  endpoint: string,
  cachePrefix: string,
  date?: string,
): Promise<KrxIsuBaseInfoRow[]> {
  const basDd = date && isValidYyyymmdd(date) ? date : recentBusinessDayKst();
  const key = `${cachePrefix}:${basDd}`;
  const hit = cacheGet<KrxIsuBaseInfoRow[]>(key);
  if (hit) return hit;

  const raw = await krxGet(endpoint, { basDd });
  const rows = extractRows(raw);
  const out: KrxIsuBaseInfoRow[] = [];
  for (const r of rows) {
    const mapped = mapIsuBaseInfoRow(r);
    if (mapped) out.push(mapped);
  }
  if (out.length > 0) cacheSet(key, out);
  return out;
}

/** 유가증권 종목기본정보 (상장일·액면가·상장주식수). */
export function fetchKospiBaseInfo(date?: string): Promise<KrxIsuBaseInfoRow[]> {
  return fetchIsuBaseInfo(EP.kospiBaseInfo, 'kospi-base', date);
}

/** 코스닥 종목기본정보. */
export function fetchKosdaqBaseInfo(date?: string): Promise<KrxIsuBaseInfoRow[]> {
  return fetchIsuBaseInfo(EP.kosdaqBaseInfo, 'kosdaq-base', date);
}

// ── 공개 API : 지수 ──────────────────────────────────────────────────────────

async function fetchIndexDaily(
  endpoint: string,
  cachePrefix: string,
  date?: string,
): Promise<KrxIndexDailyRow[]> {
  const basDd = date && isValidYyyymmdd(date) ? date : recentBusinessDayKst();
  const key = `${cachePrefix}:${basDd}`;
  const hit = cacheGet<KrxIndexDailyRow[]>(key);
  if (hit) return hit;

  const raw = await krxGet(endpoint, { basDd });
  const rows = extractRows(raw);
  const out: KrxIndexDailyRow[] = [];
  for (const r of rows) {
    const mapped = mapIndexDailyRow(r);
    if (mapped) out.push(mapped);
  }
  if (out.length > 0) cacheSet(key, out);
  return out;
}

/** KOSPI 시리즈 일별시세정보. */
export function fetchKospiIndexDaily(date?: string): Promise<KrxIndexDailyRow[]> {
  return fetchIndexDaily(EP.kospiIndexDaily, 'kospi-idx', date);
}

/** KOSDAQ 시리즈 일별시세정보. */
export function fetchKosdaqIndexDaily(date?: string): Promise<KrxIndexDailyRow[]> {
  return fetchIndexDaily(EP.kosdaqIndexDaily, 'kosdaq-idx', date);
}

/** KRX 시리즈 일별시세정보 (통합 지수). */
export function fetchKrxIndexDaily(date?: string): Promise<KrxIndexDailyRow[]> {
  return fetchIndexDaily(EP.krxIndexDaily, 'krx-idx', date);
}

/** 파생상품지수 시세정보. */
export function fetchDerivativesIndexDaily(date?: string): Promise<KrxIndexDailyRow[]> {
  return fetchIndexDaily(EP.derivIndexDaily, 'drv-idx', date);
}

// ── 상태 / 진단 ──────────────────────────────────────────────────────────────

/**
 * KRX OpenAPI 호출이 현재 가능한 상태인지. 호출자(fallback 판단)가 사용.
 * - AUTH_KEY 없음 → false
 * - DISABLED=true → false
 * - 서킷 OPEN   → false
 */
export function isKrxOpenApiHealthy(): boolean {
  if (readDisabled()) return false;
  if (!readAuthKey()) return false;
  return breaker.state !== 'OPEN';
}

export function getKrxOpenApiStatus(): {
  enabled: boolean;
  authKeyConfigured: boolean;
  circuitState: string;
  failures: number;
  cacheKeys: string[];
  base: string;
} {
  const stats = breaker.getStats();
  return {
    enabled: !readDisabled(),
    authKeyConfigured: readAuthKey().length > 0,
    circuitState: stats.state,
    failures: stats.failures,
    cacheKeys: Array.from(_cache.keys()),
    base: readBaseUrl(),
  };
}

/** 테스트 전용 — 서킷 리셋. */
export function _resetKrxOpenApiBreaker(): void {
  breaker.reset();
}
