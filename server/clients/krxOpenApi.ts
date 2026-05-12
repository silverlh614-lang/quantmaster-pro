// @responsibility krxOpenApi 외부 클라이언트 모듈
/**
 * krxOpenApi.ts — 한국거래소(KRX) Data Marketplace Open API 인증 어댑터.
 * ADR-0364: official openapi.krx.co.kr 이 특정 endpoint 에서 404를 반환할 수 있으므로
 * runtime primary base 실패 시 data-dbg 후보까지 자동 fallback 한다.
 */

import { createCircuitBreaker, CircuitOpenError } from '../utils/circuitBreaker.js';
import { isKrxTradingDay, previousKrxTradingDay } from '../calendar/krxTradingCalendar.js';

export interface KrxStockDailyRow {
  baseDate: string;
  code: string;
  isin: string;
  name: string;
  market: string;
  sector: string;
  close: number;
  change: number;
  changePct: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  value: number;
  marketCap: number;
  listedShares: number;
}

export interface KrxIsuBaseInfoRow {
  code: string;
  isin: string;
  name: string;
  nameEng: string;
  listDate: string;
  market: string;
  securityType: string;
  parValue: number;
  listedShares: number;
}

export interface KrxIndexDailyRow {
  baseDate: string;
  indexCode: string;
  indexName: string;
  close: number;
  change: number;
  changePct: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  value: number;
  marketCap: number;
  /**
   * ADR-0424: indexCode 출처 분류 (옵셔널, 후방호환).
   *
   * `'RAW'` (default) — KRX OpenAPI IDX_IND_CD 직접. HIGH confidence.
   * `'NAME_LOOKUP'`   — KRX 가 indexName 만 제공 + SECTOR_INDEX_MASTER alias 매칭으로 backfill.
   *                     HIGH confidence (KRX 공식 표준 이름 1:1 매핑).
   * `'ALIAS_EXPANSION'` — ADR-0447: normalize 후 SECTOR_INDEX_MASTER alias 확장 매칭으로
   *                       backfill (예: `"음식료·담배"` → CONSUMER_RETAIL). HIGH confidence —
   *                       정확 1:1 매핑만 인정 (ambiguous 자동 차단).
   * `'STOCK_DAILY_DERIVED'` — STOCK_DAILY fallback 입력에서 sectorName 매칭으로 합성.
   *                            LOW confidence — leadership confidence 격하 의무.
   *
   * 부재 시 caller 측 default = 'RAW' (raw KRX 응답 그대로).
   */
  indexCodeSource?: 'RAW' | 'NAME_LOOKUP' | 'ALIAS_EXPANSION' | 'STOCK_DAILY_DERIVED';
}

const DEFAULT_BASE = 'https://data-dbg.krx.co.kr/svc/apis';
const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 15 * 60 * 1000;

function normalizeBaseUrl(base: string): string {
  const cleaned = base.trim().replace(/\/+$/u, '');
  return /\/svc\/apis$/iu.test(cleaned) ? cleaned : `${cleaned}/svc/apis`;
}

function readPrimaryBaseUrl(): string {
  const legacy = process.env.KRX_OPENAPI_BASE?.trim();
  if (legacy) return normalizeBaseUrl(legacy);
  const canonical = process.env.KRX_API_BASE?.trim();
  if (canonical) return normalizeBaseUrl(canonical);
  return DEFAULT_BASE;
}

function readBaseUrl(): string {
  return readPrimaryBaseUrl();
}

function readBaseUrlCandidates(): string[] {
  if (process.env.KRX_OPENAPI_BASE_FALLBACK_DISABLED === 'true') return [readPrimaryBaseUrl()];
  return Array.from(new Set([
    readPrimaryBaseUrl(),
    'https://data-dbg.krx.co.kr/svc/apis',
    'http://data-dbg.krx.co.kr/svc/apis',
    'https://openapi.krx.co.kr/svc/apis',
  ].map(normalizeBaseUrl)));
}

function readAuthKey(): string {
  const canonical = (process.env.KRX_API_KEY ?? '').trim();
  if (canonical) return canonical;
  return (process.env.KRX_OPENAPI_AUTH_KEY ?? '').trim();
}

function readDisabled(): boolean {
  return process.env.KRX_OPENAPI_DISABLED === 'true' || process.env.KRX_API_DISABLED === 'true';
}

function isKrxAutoFetchDisabled(): boolean {
  return process.env.KIS_ONLY_REBUILD_MODE === 'true' || process.env.KIS_FIRST_REBUILD_MODE === 'true' || process.env.KRX_AUTO_FETCH_DISABLED === 'true';
}

export function isKrxOpenApiAutoFetchDisabled(): boolean {
  return isKrxAutoFetchDisabled();
}

const EP = {
  kospiDailyTrade: process.env.KRX_OPENAPI_EP_STK_BYDD ?? 'sto/stk_bydd_trd',
  kosdaqDailyTrade: process.env.KRX_OPENAPI_EP_KSQ_BYDD ?? 'sto/ksq_bydd_trd',
  kospiBaseInfo: process.env.KRX_OPENAPI_EP_STK_BASE ?? 'sto/stk_isu_base_info',
  kosdaqBaseInfo: process.env.KRX_OPENAPI_EP_KSQ_BASE ?? 'sto/ksq_isu_base_info',
  kospiIndexDaily: process.env.KRX_OPENAPI_EP_KOSPI_IDX ?? 'idx/kospi_dd_trd',
  kosdaqIndexDaily: process.env.KRX_OPENAPI_EP_KOSDAQ_IDX ?? 'idx/kosdaq_dd_trd',
  krxIndexDaily: process.env.KRX_OPENAPI_EP_KRX_IDX ?? 'idx/krx_dd_trd',
  derivIndexDaily: process.env.KRX_OPENAPI_EP_DRV_IDX ?? 'idx/drvprod_dd_trd',
} as const;

const breaker = createCircuitBreaker({
  name: 'krx-openapi',
  failureThreshold: 5,
  windowMs: 60_000,
  cooldownMs: 5 * 60_000,
});

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

export function resetKrxOpenApiCache(): void {
  _cache.clear();
}

function recentBusinessDayKst(): string {
  return recentBusinessDaysKst(1)[0];
}

export function isKrxTradingCalendarLegacy(): boolean {
  return process.env.KRX_TRADING_CALENDAR_LEGACY === 'true';
}

export function recentBusinessDaysKst(count: number, now = new Date()): string[] {
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const kst = new Date(utcMs + 9 * 60 * 60_000);
  kst.setUTCDate(kst.getUTCDate() - 1);

  const useLegacy = isKrxTradingCalendarLegacy();
  const out: string[] = [];
  let safety = 0;
  while (out.length < Math.max(1, count) && safety < 60) {
    safety += 1;
    const y = kst.getUTCFullYear();
    const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
    const d = String(kst.getUTCDate()).padStart(2, '0');
    const dateKey = `${y}-${m}-${d}`;
    const yyyymmdd = `${y}${m}${d}`;
    const accept = useLegacy
      ? (kst.getUTCDay() !== 0 && kst.getUTCDay() !== 6)
      : isKrxTradingDay(dateKey);
    if (accept) out.push(yyyymmdd);
    kst.setUTCDate(kst.getUTCDate() - 1);
  }
  return out;
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
  const stripped = String(s).trim().replace(/^[A-Z]/u, '');
  return /^\d{6}$/.test(stripped) ? stripped : '';
}

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

async function krxGetFromBase(
  base: string,
  endpoint: string,
  params: Record<string, string>,
  authKey: string,
): Promise<KrxOpenApiResponse> {
  const url = new URL(`${base}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { AUTH_KEY: authKey, Accept: 'application/json' },
      signal: ac.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      const preview = text.slice(0, 80).replace(/\s+/g, ' ');
      throw new Error(`HTTP_${res.status}${preview ? `:${preview}` : ''}`);
    }
    if (!text.trim()) throw new Error('EMPTY_BODY');
    try {
      return JSON.parse(text) as KrxOpenApiResponse;
    } catch {
      throw new Error(`JSON_PARSE:${text.slice(0, 120)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function krxGet(endpoint: string, params: Record<string, string>): Promise<KrxOpenApiResponse | null> {
  if (isKrxAutoFetchDisabled()) {
    console.info(`[KRX] skipped: KIS_ONLY_OR_FIRST_REBUILD auto fetch disabled endpoint=${endpoint}`);
    return null;
  }
  if (readDisabled()) return null;
  const authKey = readAuthKey();
  if (!authKey) return null;

  try {
    return await breaker.exec(async () => {
      const bases = readBaseUrlCandidates();
      let lastError: Error | null = null;
      for (const base of bases) {
        try {
          const raw = await krxGetFromBase(base, endpoint, params, authKey);
          if (base !== bases[0]) {
            console.warn(`[KRX-OPEN] ${endpoint} primary=${bases[0]} 실패 후 fallback base=${base} 성공`);
          }
          return raw;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          lastError = e instanceof Error ? e : new Error(msg);
          console.warn(`[KRX-OPEN] ${endpoint} base=${base} 실패: ${msg}`);
        }
      }
      throw lastError ?? new Error('ALL_BASES_FAILED');
    });
  } catch (e) {
    if (e instanceof CircuitOpenError) return null;
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[KRX-OPEN] ${endpoint} 전체 base 실패: ${msg}`);
    return null;
  }
}

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

function previousBusinessDayYyyymmdd(yyyymmdd: string): string | null {
  if (!isValidYyyymmdd(yyyymmdd)) return null;
  const y = yyyymmdd.slice(0, 4);
  const m = yyyymmdd.slice(4, 6);
  const d = yyyymmdd.slice(6, 8);
  const noonKst = new Date(`${y}-${m}-${d}T03:00:00.000Z`);
  if (!Number.isFinite(noonKst.getTime())) return null;
  const prev = previousKrxTradingDay(noonKst);
  return /^\d{4}-\d{2}-\d{2}$/.test(prev) ? prev.replace(/-/g, '') : null;
}

export function isKrxAutoRetryOnEmptyDisabled(): boolean {
  return process.env.KRX_AUTO_RETRY_ON_EMPTY_DISABLED === 'true';
}

async function fetchStockDaily(endpoint: string, cachePrefix: string, date?: string, retryDepth = 0): Promise<KrxStockDailyRow[]> {
  const basDd = date && isValidYyyymmdd(date) ? date : recentBusinessDayKst();
  const key = `${cachePrefix}:${basDd}`;
  const hit = cacheGet<KrxStockDailyRow[]>(key);
  if (hit) return hit;
  const raw = await krxGet(endpoint, { basDd });
  const out = extractRows(raw).map(mapStockDailyRow).filter((r): r is KrxStockDailyRow => Boolean(r));
  if (out.length === 0 && !isKrxAutoRetryOnEmptyDisabled() && retryDepth < 5) {
    const prev = previousBusinessDayYyyymmdd(basDd);
    if (prev && prev !== basDd) return fetchStockDaily(endpoint, cachePrefix, prev, retryDepth + 1);
  }
  if (out.length > 0) cacheSet(key, out);
  return out;
}

export function fetchKospiDailyTrade(date?: string): Promise<KrxStockDailyRow[]> {
  return fetchStockDaily(EP.kospiDailyTrade, 'kospi-bydd', date);
}

export function fetchKosdaqDailyTrade(date?: string): Promise<KrxStockDailyRow[]> {
  return fetchStockDaily(EP.kosdaqDailyTrade, 'kosdaq-bydd', date);
}

async function fetchIsuBaseInfo(endpoint: string, cachePrefix: string, date?: string): Promise<KrxIsuBaseInfoRow[]> {
  const basDd = date && isValidYyyymmdd(date) ? date : recentBusinessDayKst();
  const key = `${cachePrefix}:${basDd}`;
  const hit = cacheGet<KrxIsuBaseInfoRow[]>(key);
  if (hit) return hit;
  const raw = await krxGet(endpoint, { basDd });
  const out = extractRows(raw).map(mapIsuBaseInfoRow).filter((r): r is KrxIsuBaseInfoRow => Boolean(r));
  if (out.length > 0) cacheSet(key, out);
  return out;
}

export function fetchKospiBaseInfo(date?: string): Promise<KrxIsuBaseInfoRow[]> {
  return fetchIsuBaseInfo(EP.kospiBaseInfo, 'kospi-base', date);
}

export function fetchKosdaqBaseInfo(date?: string): Promise<KrxIsuBaseInfoRow[]> {
  return fetchIsuBaseInfo(EP.kosdaqBaseInfo, 'kosdaq-base', date);
}

export function getKrxOpenApiEndpointPath(kind: 'kospiBaseInfo' | 'kosdaqBaseInfo'): string {
  return EP[kind];
}

async function fetchIndexDaily(endpoint: string, cachePrefix: string, date?: string, retryDepth = 0): Promise<KrxIndexDailyRow[]> {
  const basDd = date && isValidYyyymmdd(date) ? date : recentBusinessDayKst();
  const key = `${cachePrefix}:${basDd}`;
  const hit = cacheGet<KrxIndexDailyRow[]>(key);
  if (hit) return hit;
  const raw = await krxGet(endpoint, { basDd });
  const out = extractRows(raw).map(mapIndexDailyRow).filter((r): r is KrxIndexDailyRow => Boolean(r));
  if (out.length === 0 && !isKrxAutoRetryOnEmptyDisabled() && retryDepth < 5) {
    const prev = previousBusinessDayYyyymmdd(basDd);
    if (prev && prev !== basDd) return fetchIndexDaily(endpoint, cachePrefix, prev, retryDepth + 1);
  }
  if (out.length > 0) cacheSet(key, out);
  return out;
}

export function fetchKospiIndexDaily(date?: string): Promise<KrxIndexDailyRow[]> {
  return fetchIndexDaily(EP.kospiIndexDaily, 'kospi-idx', date);
}

export function fetchKosdaqIndexDaily(date?: string): Promise<KrxIndexDailyRow[]> {
  return fetchIndexDaily(EP.kosdaqIndexDaily, 'kosdaq-idx', date);
}

export function fetchKrxIndexDaily(date?: string): Promise<KrxIndexDailyRow[]> {
  return fetchIndexDaily(EP.krxIndexDaily, 'krx-idx', date);
}

export function fetchDerivativesIndexDaily(date?: string): Promise<KrxIndexDailyRow[]> {
  return fetchIndexDaily(EP.derivIndexDaily, 'drv-idx', date);
}

export function isKrxOpenApiHealthy(): boolean {
  if (isKrxAutoFetchDisabled()) return false;
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
    enabled: !readDisabled() && !isKrxAutoFetchDisabled(),
    authKeyConfigured: readAuthKey().length > 0,
    circuitState: stats.state,
    failures: stats.failures,
    cacheKeys: Array.from(_cache.keys()),
    base: readBaseUrl(),
  };
}

export function _resetKrxOpenApiBreaker(): void {
  breaker.reset();
}
