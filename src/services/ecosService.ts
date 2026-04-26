// @responsibility ecosService 서비스 모듈
/**
 * ECOS (한국은행 경제통계시스템) API 서비스
 *
 * 한국은행 ECOS Open API를 통해 주요 거시경제 지표를 조회합니다.
 * - 기준금리 (BOK Base Rate)
 * - 환율 USD/KRW (Exchange Rate)
 * - M2 통화량 (Broad Money)
 * - GDP 성장률 (GDP Growth)
 * - 수출입 데이터 (Trade Balance)
 *
 * API 문서: https://ecos.bok.or.kr/api/#/
 */

import type {
  EcosRawRow,
  EcosBokRate,
  EcosExchangeRate,
  EcosM2Data,
  EcosGdpData,
  EcosTradeData,
  EcosBankLending,
  EcosMacroSnapshot,
  EcosQueryParams,
} from '../types/quant';
import { safePctChange } from '../utils/safePctChange';

// ─── ECOS 통계표 코드 & 항목 코드 ───────────────────────────────────────────

export const ECOS_STAT = {
  /** 한국은행 기준금리 */
  BOK_RATE: { code: '722Y001', item1: '0101000' },
  /** 원/달러 환율 (매매기준율) */
  USD_KRW: { code: '731Y003', item1: '0000001', item2: '0000003' },
  /** M2 (광의통화, 평잔, 원계열) */
  M2: { code: '101Y003', item1: 'BBGA00' },
  /** 실질 GDP 성장률 (전기 대비) */
  GDP_GROWTH: { code: '111Y002', item1: '10111' },
  /** 수출금액 (통관기준) */
  EXPORT: { code: '403Y003', item1: '000000', item2: '1' },
  /** 수입금액 (통관기준) */
  IMPORT: { code: '403Y003', item1: '000000', item2: '2' },
  /** 예금은행 원화대출금 (잔액, 월말) — bankLendingGrowth 실데이터 소스 */
  BANK_LENDING: { code: '104Y015', item1: 'BBGA00' },
} as const;

// ─── 캐시 설정 ──────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4시간
const CACHE_PREFIX = 'ecos:';

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

const memoryCache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const fullKey = CACHE_PREFIX + key;

  // 1. 메모리 캐시 확인
  const mem = memoryCache.get(fullKey);
  if (mem && mem.expiry > Date.now()) return mem.data as T;

  // 2. localStorage 확인 (브라우저 환경)
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(fullKey);
      if (raw) {
        const parsed: CacheEntry<T> = JSON.parse(raw);
        if (parsed.expiry > Date.now()) {
          memoryCache.set(fullKey, parsed);
          return parsed.data;
        }
        localStorage.removeItem(fullKey);
      }
    } catch { /* ignore */ }
  }

  return null;
}

function setCache<T>(key: string, data: T): void {
  const fullKey = CACHE_PREFIX + key;
  const entry: CacheEntry<T> = { data, expiry: Date.now() + CACHE_TTL_MS };
  memoryCache.set(fullKey, entry as CacheEntry<unknown>);

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(fullKey, JSON.stringify(entry));
    } catch { /* quota exceeded — ignore */ }
  }
}

// ─── 날짜 유틸 ──────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function formatMonth(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatQuarter(d: Date): string {
  const q = Math.ceil((d.getMonth() + 1) / 3);
  return `${d.getFullYear()}Q${q}`;
}

function monthsAgo(n: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
}

// ─── ECOS API 공통 호출 ─────────────────────────────────────────────────────

/**
 * ECOS API 프록시를 통한 통계 데이터 조회
 * 서버 프록시 엔드포인트(/api/ecos)를 사용하여 API 키 노출을 방지합니다.
 */
async function fetchEcosData(params: EcosQueryParams): Promise<EcosRawRow[]> {
  const query = new URLSearchParams({
    statCode: params.statCode,
    period: params.period,
    startDate: params.startDate,
    endDate: params.endDate,
    itemCode1: params.itemCode1,
    ...(params.itemCode2 ? { itemCode2: params.itemCode2 } : {}),
  });

  const res = await fetch(`/api/ecos?${query}`);
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `ECOS API 오류: ${res.status}`);
  }

  const data = await res.json();

  // ECOS 응답 구조: { StatisticSearch: { row: [...] } }
  if (data?.StatisticSearch?.row) {
    return data.StatisticSearch.row as EcosRawRow[];
  }

  // 에러 응답 처리
  if (data?.RESULT?.CODE) {
    const code = data.RESULT.CODE;
    if (code === 'INFO-200') return []; // 데이터 없음
    throw new Error(`ECOS: ${data.RESULT.MESSAGE || code}`);
  }

  return [];
}

// ─── 개별 지표 조회 함수 ────────────────────────────────────────────────────

/**
 * 한국은행 기준금리 조회
 * @param months 조회할 과거 개월 수 (기본 24개월)
 */
export async function getBokRate(months = 24): Promise<EcosBokRate[]> {
  const cacheKey = `bokRate:${months}`;
  const cached = getCached<EcosBokRate[]>(cacheKey);
  if (cached) return cached;

  const rows = await fetchEcosData({
    statCode: ECOS_STAT.BOK_RATE.code,
    period: 'D',
    startDate: formatDate(monthsAgo(months)),
    endDate: formatDate(new Date()),
    itemCode1: ECOS_STAT.BOK_RATE.item1,
  });

  if (rows.length === 0) return [];

  const rates: EcosBokRate[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rate = parseFloat(rows[i].DATA_VALUE);
    if (isNaN(rate)) continue;

    let direction: EcosBokRate['direction'] = 'HOLDING';
    if (i > 0) {
      const prev = parseFloat(rows[i - 1].DATA_VALUE);
      if (!isNaN(prev)) {
        if (rate > prev) direction = 'HIKING';
        else if (rate < prev) direction = 'CUTTING';
      }
    }

    rates.push({
      date: rows[i].TIME,
      rate,
      direction,
    });
  }

  setCache(cacheKey, rates);
  return rates;
}

/**
 * 원/달러 환율 조회
 * @param months 조회할 과거 개월 수 (기본 6개월)
 */
export async function getExchangeRate(months = 6): Promise<EcosExchangeRate[]> {
  const cacheKey = `usdKrw:${months}`;
  const cached = getCached<EcosExchangeRate[]>(cacheKey);
  if (cached) return cached;

  const rows = await fetchEcosData({
    statCode: ECOS_STAT.USD_KRW.code,
    period: 'D',
    startDate: formatDate(monthsAgo(months)),
    endDate: formatDate(new Date()),
    itemCode1: ECOS_STAT.USD_KRW.item1,
    itemCode2: ECOS_STAT.USD_KRW.item2,
  });

  if (rows.length === 0) return [];

  const rates: EcosExchangeRate[] = [];
  for (let i = 0; i < rows.length; i++) {
    const val = parseFloat(rows[i].DATA_VALUE.replace(/,/g, ''));
    if (isNaN(val)) continue;

    let change = 0;
    let changePct = 0;
    if (i > 0) {
      const prev = parseFloat(rows[i - 1].DATA_VALUE.replace(/,/g, ''));
      if (!isNaN(prev) && prev > 0) {
        change = val - prev;
        changePct = (change / prev) * 100;
      }
    }

    rates.push({
      date: rows[i].TIME,
      usdKrw: val,
      change: Math.round(change * 100) / 100,
      changePct: Math.round(changePct * 1000) / 1000,
    });
  }

  setCache(cacheKey, rates);
  return rates;
}

/**
 * M2 통화량(광의통화) 조회
 * @param months 조회할 과거 개월 수 (기본 24개월)
 */
export async function getM2MoneySupply(months = 24): Promise<EcosM2Data[]> {
  const cacheKey = `m2:${months}`;
  const cached = getCached<EcosM2Data[]>(cacheKey);
  if (cached) return cached;

  const rows = await fetchEcosData({
    statCode: ECOS_STAT.M2.code,
    period: 'M',
    startDate: formatMonth(monthsAgo(months)),
    endDate: formatMonth(new Date()),
    itemCode1: ECOS_STAT.M2.item1,
  });

  if (rows.length === 0) return [];

  const result: EcosM2Data[] = [];
  for (let i = 0; i < rows.length; i++) {
    const amount = parseFloat(rows[i].DATA_VALUE.replace(/,/g, ''));
    if (isNaN(amount)) continue;

    // YoY 계산: 12개월 전 데이터와 비교
    let yoyGrowth = 0;
    if (i >= 12) {
      const prev = parseFloat(rows[i - 12].DATA_VALUE.replace(/,/g, ''));
      if (!isNaN(prev) && prev > 0) {
        // ADR-0049: stale prev 시 0 fallback — M2 YoY 매크로 보호.
        yoyGrowth = safePctChange(amount, prev, { label: 'ecosService.m2.yoy' }) ?? 0;
      }
    }

    result.push({
      date: rows[i].TIME,
      amount: Math.round(amount / 10000), // 억원 → 조원 변환 (ECOS 단위 기준)
      yoyGrowth: Math.round(yoyGrowth * 100) / 100,
    });
  }

  setCache(cacheKey, result);
  return result;
}

/**
 * 실질 GDP 성장률 조회
 * @param years 조회할 과거 년수 (기본 5년)
 */
export async function getGdpGrowth(years = 5): Promise<EcosGdpData[]> {
  const cacheKey = `gdp:${years}`;
  const cached = getCached<EcosGdpData[]>(cacheKey);
  if (cached) return cached;

  const startDate = `${new Date().getFullYear() - years}Q1`;
  const endDate = formatQuarter(new Date());

  const rows = await fetchEcosData({
    statCode: ECOS_STAT.GDP_GROWTH.code,
    period: 'Q',
    startDate,
    endDate,
    itemCode1: ECOS_STAT.GDP_GROWTH.item1,
  });

  if (rows.length === 0) return [];

  const result: EcosGdpData[] = rows
    .filter(r => !isNaN(parseFloat(r.DATA_VALUE)))
    .map((r, i, arr) => {
      const growth = parseFloat(r.DATA_VALUE);
      // YoY: 4분기 전 데이터와 비교
      let yoyGrowth = 0;
      if (i >= 4) {
        const prev = parseFloat(arr[i - 4].DATA_VALUE);
        if (!isNaN(prev)) yoyGrowth = growth - prev; // 이미 증가율이므로 차이
      }
      return {
        quarter: r.TIME,
        realGdpGrowth: Math.round(growth * 100) / 100,
        yoyGrowth: Math.round(yoyGrowth * 100) / 100,
      };
    });

  setCache(cacheKey, result);
  return result;
}

/**
 * 수출입 데이터 조회 (통관 기준)
 * @param months 조회할 과거 개월 수 (기본 24개월)
 */
export async function getTradeData(months = 24): Promise<EcosTradeData[]> {
  const cacheKey = `trade:${months}`;
  const cached = getCached<EcosTradeData[]>(cacheKey);
  if (cached) return cached;

  const start = formatMonth(monthsAgo(months));
  const end = formatMonth(new Date());

  // 수출/수입 데이터를 병렬로 조회
  const [exportRows, importRows] = await Promise.all([
    fetchEcosData({
      statCode: ECOS_STAT.EXPORT.code,
      period: 'M',
      startDate: start,
      endDate: end,
      itemCode1: ECOS_STAT.EXPORT.item1,
      itemCode2: ECOS_STAT.EXPORT.item2,
    }),
    fetchEcosData({
      statCode: ECOS_STAT.IMPORT.code,
      period: 'M',
      startDate: start,
      endDate: end,
      itemCode1: ECOS_STAT.IMPORT.item1,
      itemCode2: ECOS_STAT.IMPORT.item2,
    }),
  ]);

  // 시점 기준으로 수출/수입 매칭
  const importMap = new Map(importRows.map(r => [r.TIME, r]));

  const result: EcosTradeData[] = [];
  for (let i = 0; i < exportRows.length; i++) {
    const expVal = parseFloat(exportRows[i].DATA_VALUE.replace(/,/g, ''));
    const impRow = importMap.get(exportRows[i].TIME);
    const impVal = impRow ? parseFloat(impRow.DATA_VALUE.replace(/,/g, '')) : 0;

    if (isNaN(expVal)) continue;

    // YoY 수출 증가율
    let exportGrowthYoY = 0;
    if (i >= 12) {
      const prevExp = parseFloat(exportRows[i - 12].DATA_VALUE.replace(/,/g, ''));
      if (!isNaN(prevExp) && prevExp > 0) {
        exportGrowthYoY = safePctChange(expVal, prevExp, { label: 'ecosService.export.yoy' }) ?? 0;
      }
    }

    result.push({
      date: exportRows[i].TIME,
      exports: Math.round(expVal),
      imports: Math.round(impVal),
      tradeBalance: Math.round(expVal - impVal),
      exportGrowthYoY: Math.round(exportGrowthYoY * 100) / 100,
    });
  }

  setCache(cacheKey, result);
  return result;
}

/**
 * 예금은행 원화대출금 조회 (ECOS 104Y015)
 * YoY 증가율 → MacroEnvironment.bankLendingGrowth 실데이터 소스
 * @param months 조회할 과거 개월 수 (기본 14개월 — YoY 계산에 13개월치 필요)
 */
export async function getBankLendingGrowth(months = 14): Promise<EcosBankLending[]> {
  const cacheKey = `bankLending:${months}`;
  const cached = getCached<EcosBankLending[]>(cacheKey);
  if (cached) return cached;

  const rows = await fetchEcosData({
    statCode: ECOS_STAT.BANK_LENDING.code,
    period: 'M',
    startDate: formatMonth(monthsAgo(months)),
    endDate: formatMonth(new Date()),
    itemCode1: ECOS_STAT.BANK_LENDING.item1,
  });

  if (rows.length === 0) return [];

  const result: EcosBankLending[] = [];
  for (let i = 0; i < rows.length; i++) {
    const balance = parseFloat(rows[i].DATA_VALUE.replace(/,/g, ''));
    if (isNaN(balance)) continue;

    // YoY 계산: 12개월 전 잔액 대비 증가율
    let yoyGrowth = 0;
    if (i >= 12) {
      const prev = parseFloat(rows[i - 12].DATA_VALUE.replace(/,/g, ''));
      if (!isNaN(prev) && prev > 0) {
        yoyGrowth = safePctChange(balance, prev, { label: 'ecosService.bankLending.yoy' }) ?? 0;
      }
    }

    result.push({
      date: rows[i].TIME,
      balance: Math.round(balance / 10000), // 억원 → 조원
      yoyGrowth: Math.round(yoyGrowth * 100) / 100,
    });
  }

  setCache(cacheKey, result);
  return result;
}

// ─── 통합 매크로 스냅샷 ─────────────────────────────────────────────────────

/**
 * 모든 ECOS 지표를 한 번에 조회하여 매크로 스냅샷 반환
 * Gate 0 (MacroEnvironment) 평가에 직접 사용 가능
 */
export async function getMacroSnapshot(): Promise<EcosMacroSnapshot> {
  const cacheKey = 'macroSnapshot';
  const cached = getCached<EcosMacroSnapshot>(cacheKey);
  if (cached) return cached;

  const [bokRates, exchangeRates, m2Data, gdpData, tradeData, bankLendingData] = await Promise.allSettled([
    getBokRate(6),
    getExchangeRate(3),
    getM2MoneySupply(13), // 13개월 → YoY 계산 가능
    getGdpGrowth(2),
    getTradeData(13),
    getBankLendingGrowth(14), // 14개월 → 최신 1개 YoY 계산 가능
  ]);

  const snapshot: EcosMacroSnapshot = {
    bokRate: bokRates.status === 'fulfilled' && bokRates.value.length > 0
      ? bokRates.value[bokRates.value.length - 1]
      : null,
    exchangeRate: exchangeRates.status === 'fulfilled' && exchangeRates.value.length > 0
      ? exchangeRates.value[exchangeRates.value.length - 1]
      : null,
    m2: m2Data.status === 'fulfilled' && m2Data.value.length > 0
      ? m2Data.value[m2Data.value.length - 1]
      : null,
    gdp: gdpData.status === 'fulfilled' && gdpData.value.length > 0
      ? gdpData.value[gdpData.value.length - 1]
      : null,
    trade: tradeData.status === 'fulfilled' && tradeData.value.length > 0
      ? tradeData.value[tradeData.value.length - 1]
      : null,
    bankLending: bankLendingData.status === 'fulfilled' && bankLendingData.value.length > 0
      ? bankLendingData.value[bankLendingData.value.length - 1]
      : null,
    fetchedAt: new Date().toISOString(),
  };

  setCache(cacheKey, snapshot);
  return snapshot;
}

// ─── MacroEnvironment 변환 헬퍼 ─────────────────────────────────────────────

/**
 * ECOS 스냅샷을 기존 MacroEnvironment 인터페이스 필드로 변환
 * quantEngine.ts의 computeGate0()에 직접 주입 가능한 부분 값을 반환합니다.
 *
 * 반환되지 않는 필드(vkospi, samsungIri, vix 등)는 기존 AI/Yahoo 소스에서 보완 필요
 */
export function snapshotToMacroFields(snapshot: EcosMacroSnapshot): Partial<{
  bokRateDirection: 'HIKING' | 'HOLDING' | 'CUTTING';
  m2GrowthYoY: number;
  nominalGdpGrowth: number;
  exportGrowth3mAvg: number;
  usdKrw: number;
  bankLendingGrowth: number; // 104Y015 실데이터
}> {
  const fields: ReturnType<typeof snapshotToMacroFields> = {};

  if (snapshot.bokRate) {
    fields.bokRateDirection = snapshot.bokRate.direction;
  }

  if (snapshot.m2) {
    fields.m2GrowthYoY = snapshot.m2.yoyGrowth;
  }

  if (snapshot.gdp) {
    fields.nominalGdpGrowth = snapshot.gdp.realGdpGrowth;
  }

  if (snapshot.trade) {
    fields.exportGrowth3mAvg = snapshot.trade.exportGrowthYoY;
  }

  if (snapshot.exchangeRate) {
    fields.usdKrw = snapshot.exchangeRate.usdKrw;
  }

  if (snapshot.bankLending) {
    fields.bankLendingGrowth = snapshot.bankLending.yoyGrowth;
  }

  return fields;
}

// ─── 캐시 관리 ──────────────────────────────────────────────────────────────

/** ECOS 캐시 전체 초기화 */
export function clearEcosCache(): void {
  // 메모리 캐시 삭제
  for (const key of memoryCache.keys()) {
    if (key.startsWith(CACHE_PREFIX)) memoryCache.delete(key);
  }

  // localStorage 캐시 삭제
  if (typeof window !== 'undefined') {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(CACHE_PREFIX)) keysToRemove.push(k);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  }
}
