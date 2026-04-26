// @responsibility ecosClient 외부 클라이언트 모듈
/**
 * ecosClient.ts — 서버사이드 한국은행 ECOS OpenAPI 어댑터 (아이디어 11)
 *
 * 기존 src/services/ecosService.ts 는 브라우저 전용으로 `/api/ecos` 프록시를
 * 경유한다. 서버사이드 macroIndexEngine 은 Gemini 의존 없이 로컬에서 MHS를
 * 계산해야 하므로, 같은 ECOS 호출을 서버에서 직접 수행하는 어댑터가 필요하다.
 *
 * 제공 함수:
 *   - fetchLatestBokRate()         — 기준금리 최신값 + 방향(인상/동결/인하)
 *   - fetchLatestM2Yoy()           — M2 광의통화 YoY(%)
 *   - fetchLatestGdpGrowth()       — 실질 GDP 성장률 (최근 분기)
 *   - fetchLatestExportGrowth()    — 수출 YoY 3M 이동평균(%)
 *   - fetchLatestBankLendingYoy()  — 예금은행 원화대출 YoY(%)
 *   - fetchLatestUsdKrw()          — 원/달러 환율 최신값
 *   - fetchEcosSnapshot()          — 위 6개 병렬 수집 + 부분 실패 허용
 *
 * 설계 원칙:
 *   - ECOS_API_KEY 미설정 시 전부 null 반환 (throw 없음).
 *   - 실패·이상 응답은 null 로 흡수 — macroIndexEngine 이 기본값을 사용.
 *   - 10분 메모리 캐시 TTL, ECOS_API_DISABLED=true 면 네트워크 호출 없이 null.
 */

// ── 타입 ─────────────────────────────────────────────────────────────────────

export interface EcosRawRow {
  TIME:        string;
  DATA_VALUE:  string;
  STAT_CODE?:  string;
  STAT_NAME?:  string;
  ITEM_CODE1?: string;
  ITEM_NAME1?: string;
  UNIT_NAME?:  string;
}

export type BokRateDirection = 'HIKING' | 'HOLDING' | 'CUTTING';

export interface BokRateLatest {
  date: string;
  rate: number;
  direction: BokRateDirection;
}

export interface EcosSnapshot {
  bokRate:           BokRateLatest | null;
  m2YoyPct:          number | null;
  nominalGdpGrowth:  number | null;   // 실질 GDP QoQ(%) — snapshotToMacroFields 와 동일 시맨틱
  exportGrowth3mAvg: number | null;
  bankLendingYoyPct: number | null;
  usdKrw:            number | null;
  fetchedAt:         string;
  /** 소스별 실패 메시지(진단). 빈 배열이면 모두 성공. */
  errors: string[];
}

// ── 설정 ─────────────────────────────────────────────────────────────────────

const ECOS_BASE = process.env.ECOS_API_BASE ?? 'https://ecos.bok.or.kr';
const ECOS_DISABLED = process.env.ECOS_API_DISABLED === 'true';
const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 10 * 60 * 1000;

/** ECOS 통계코드 + item code 매핑 — 클라이언트 ecosService.ts 와 1:1 동일. */
export const ECOS_STAT = {
  BOK_RATE:     { code: '722Y001', item1: '0101000' },
  USD_KRW:      { code: '731Y003', item1: '0000001', item2: '0000003' },
  M2:           { code: '101Y003', item1: 'BBGA00' },
  GDP_GROWTH:   { code: '111Y002', item1: '10111' },
  EXPORT:       { code: '403Y003', item1: '000000', item2: '1' },
  BANK_LENDING: { code: '104Y015', item1: 'BBGA00' },
} as const;

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

export function resetEcosCache(): void { _cache.clear(); }

// ── 날짜 유틸 (KST) ──────────────────────────────────────────────────────────

function nowKst(): Date {
  const n = new Date();
  return new Date(n.getTime() + n.getTimezoneOffset() * 60_000 + 9 * 60 * 60_000);
}

function pad2(n: number): string { return String(n).padStart(2, '0'); }

function formatDateYYYYMMDD(d: Date): string {
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}

function formatMonthYYYYMM(d: Date): string {
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}`;
}

function formatQuarter(d: Date): string {
  const q = Math.ceil((d.getUTCMonth() + 1) / 3);
  return `${d.getUTCFullYear()}Q${q}`;
}

function addMonths(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
}

// ── HTTP 호출 ────────────────────────────────────────────────────────────────

/**
 * ECOS REST 호출. 실패는 전부 빈 배열 반환. throw 하지 않는다.
 *   URL 형식: /api/StatisticSearch/{KEY}/json/kr/1/1000/{code}/{period}/{start}/{end}/{item1}(/{item2})
 */
async function fetchEcos(
  statCode: string,
  period: 'D' | 'M' | 'Q',
  startDate: string,
  endDate: string,
  itemCode1: string,
  itemCode2?: string,
): Promise<EcosRawRow[]> {
  if (ECOS_DISABLED) return [];
  const apiKey = process.env.ECOS_API_KEY;
  if (!apiKey) return [];

  const i2 = itemCode2 ? `/${itemCode2}` : '';
  const url =
    `${ECOS_BASE}/api/StatisticSearch/${apiKey}/json/kr/1/1000/` +
    `${statCode}/${period}/${startDate}/${endDate}/${itemCode1}${i2}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: ac.signal,
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) {
      console.warn(`[ECOS] ${statCode} HTTP ${res.status}`);
      return [];
    }
    const data = await res.json() as {
      StatisticSearch?: { row?: EcosRawRow[] };
      RESULT?: { CODE?: string; MESSAGE?: string };
    };
    if (data?.StatisticSearch?.row && Array.isArray(data.StatisticSearch.row)) {
      return data.StatisticSearch.row;
    }
    if (data?.RESULT?.CODE && data.RESULT.CODE !== 'INFO-200') {
      console.warn(`[ECOS] ${statCode} RESULT=${data.RESULT.CODE} ${data.RESULT.MESSAGE ?? ''}`);
    }
    return [];
  } catch (e) {
    console.warn(`[ECOS] ${statCode} 요청 실패: ${e instanceof Error ? e.message : e}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function toNumStripComma(s: string | undefined | null): number {
  if (!s) return NaN;
  const n = Number(String(s).trim().replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

// ── 개별 지표 fetcher ────────────────────────────────────────────────────────

/** 최근 6개월 BOK 기준금리 → 최신 레코드 + direction 추론. */
export async function fetchLatestBokRate(): Promise<BokRateLatest | null> {
  const cached = getCached<BokRateLatest | null>('bokRate');
  if (cached !== null) return cached;

  const end = nowKst();
  const start = addMonths(end, -6);
  const rows = await fetchEcos(
    ECOS_STAT.BOK_RATE.code, 'D',
    formatDateYYYYMMDD(start), formatDateYYYYMMDD(end),
    ECOS_STAT.BOK_RATE.item1,
  );
  if (rows.length === 0) {
    setCached('bokRate', null);
    return null;
  }
  // 마지막(최신) 레코드 + 이전 레코드와 비교해 방향 결정.
  const sorted = [...rows].sort((a, b) => a.TIME.localeCompare(b.TIME));
  const last = sorted[sorted.length - 1];
  const rate = toNumStripComma(last.DATA_VALUE);
  if (!Number.isFinite(rate)) {
    setCached('bokRate', null);
    return null;
  }
  let direction: BokRateDirection = 'HOLDING';
  for (let i = sorted.length - 2; i >= 0; i--) {
    const prev = toNumStripComma(sorted[i].DATA_VALUE);
    if (!Number.isFinite(prev)) continue;
    if (rate > prev) { direction = 'HIKING';  break; }
    if (rate < prev) { direction = 'CUTTING'; break; }
  }
  const latest: BokRateLatest = { date: last.TIME, rate, direction };
  setCached('bokRate', latest);
  return latest;
}

/** 최근 13개월 M2 → 최신월 YoY(%). */
export async function fetchLatestM2Yoy(): Promise<number | null> {
  const cached = getCached<number | null>('m2');
  if (cached !== null) return cached;

  const end = nowKst();
  const start = addMonths(end, -15);   // 여유있게 14~15개월
  const rows = await fetchEcos(
    ECOS_STAT.M2.code, 'M',
    formatMonthYYYYMM(start), formatMonthYYYYMM(end),
    ECOS_STAT.M2.item1,
  );
  if (rows.length < 13) {
    setCached('m2', null);
    return null;
  }
  const sorted = [...rows].sort((a, b) => a.TIME.localeCompare(b.TIME));
  const latest = toNumStripComma(sorted[sorted.length - 1].DATA_VALUE);
  const yearAgo = toNumStripComma(sorted[sorted.length - 1 - 12].DATA_VALUE);
  if (!Number.isFinite(latest) || !Number.isFinite(yearAgo) || yearAgo <= 0) {
    setCached('m2', null);
    return null;
  }
  const yoy = parseFloat((((latest - yearAgo) / yearAgo) * 100).toFixed(2));
  setCached('m2', yoy);
  return yoy;
}

/** 최근 3년치 GDP QoQ — 최신 분기 실질 GDP 성장률 반환. */
export async function fetchLatestGdpGrowth(): Promise<number | null> {
  const cached = getCached<number | null>('gdp');
  if (cached !== null) return cached;

  const end = nowKst();
  const startYear = end.getUTCFullYear() - 3;
  const rows = await fetchEcos(
    ECOS_STAT.GDP_GROWTH.code, 'Q',
    `${startYear}Q1`, formatQuarter(end),
    ECOS_STAT.GDP_GROWTH.item1,
  );
  if (rows.length === 0) {
    setCached('gdp', null);
    return null;
  }
  const sorted = [...rows].sort((a, b) => a.TIME.localeCompare(b.TIME));
  const latest = toNumStripComma(sorted[sorted.length - 1].DATA_VALUE);
  if (!Number.isFinite(latest)) {
    setCached('gdp', null);
    return null;
  }
  const rounded = parseFloat(latest.toFixed(2));
  setCached('gdp', rounded);
  return rounded;
}

/** 최근 15개월 수출 → 최신 3개월 YoY 평균(%). */
export async function fetchLatestExportGrowth3mAvg(): Promise<number | null> {
  const cached = getCached<number | null>('export');
  if (cached !== null) return cached;

  const end = nowKst();
  const start = addMonths(end, -15);
  const rows = await fetchEcos(
    ECOS_STAT.EXPORT.code, 'M',
    formatMonthYYYYMM(start), formatMonthYYYYMM(end),
    ECOS_STAT.EXPORT.item1,
    ECOS_STAT.EXPORT.item2,
  );
  if (rows.length < 13) {
    setCached('export', null);
    return null;
  }
  const sorted = [...rows].sort((a, b) => a.TIME.localeCompare(b.TIME));
  // 최근 3개월 각각의 YoY 평균
  const yoys: number[] = [];
  for (let i = sorted.length - 3; i < sorted.length; i++) {
    if (i < 12) continue;
    const cur = toNumStripComma(sorted[i].DATA_VALUE);
    const prev = toNumStripComma(sorted[i - 12].DATA_VALUE);
    if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev <= 0) continue;
    yoys.push(((cur - prev) / prev) * 100);
  }
  if (yoys.length === 0) {
    setCached('export', null);
    return null;
  }
  const avg = parseFloat((yoys.reduce((s, v) => s + v, 0) / yoys.length).toFixed(2));
  setCached('export', avg);
  return avg;
}

/** 최근 15개월 원화대출 → 최신월 YoY(%). */
export async function fetchLatestBankLendingYoy(): Promise<number | null> {
  const cached = getCached<number | null>('bankLending');
  if (cached !== null) return cached;

  const end = nowKst();
  const start = addMonths(end, -15);
  const rows = await fetchEcos(
    ECOS_STAT.BANK_LENDING.code, 'M',
    formatMonthYYYYMM(start), formatMonthYYYYMM(end),
    ECOS_STAT.BANK_LENDING.item1,
  );
  if (rows.length < 13) {
    setCached('bankLending', null);
    return null;
  }
  const sorted = [...rows].sort((a, b) => a.TIME.localeCompare(b.TIME));
  const cur = toNumStripComma(sorted[sorted.length - 1].DATA_VALUE);
  const prev = toNumStripComma(sorted[sorted.length - 1 - 12].DATA_VALUE);
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev <= 0) {
    setCached('bankLending', null);
    return null;
  }
  const yoy = parseFloat((((cur - prev) / prev) * 100).toFixed(2));
  setCached('bankLending', yoy);
  return yoy;
}

/** 최근 6개월 일별 원/달러 → 최신값. */
export async function fetchLatestUsdKrw(): Promise<number | null> {
  const cached = getCached<number | null>('usdKrw');
  if (cached !== null) return cached;

  const end = nowKst();
  const start = addMonths(end, -6);
  const rows = await fetchEcos(
    ECOS_STAT.USD_KRW.code, 'D',
    formatDateYYYYMMDD(start), formatDateYYYYMMDD(end),
    ECOS_STAT.USD_KRW.item1, ECOS_STAT.USD_KRW.item2,
  );
  if (rows.length === 0) {
    setCached('usdKrw', null);
    return null;
  }
  const sorted = [...rows].sort((a, b) => a.TIME.localeCompare(b.TIME));
  const last = toNumStripComma(sorted[sorted.length - 1].DATA_VALUE);
  if (!Number.isFinite(last) || last <= 0) {
    setCached('usdKrw', null);
    return null;
  }
  const rounded = parseFloat(last.toFixed(2));
  setCached('usdKrw', rounded);
  return rounded;
}

// ── 통합 스냅샷 ─────────────────────────────────────────────────────────────

/**
 * 6개 ECOS 지표를 병렬 수집해 EcosSnapshot 으로 반환.
 * 부분 실패는 errors 에 축적 + 해당 필드만 null. 전체 실패해도 throw 하지 않는다.
 */
export async function fetchEcosSnapshot(): Promise<EcosSnapshot> {
  const errors: string[] = [];
  const [bokR, m2R, gdpR, expR, lendR, fxR] = await Promise.allSettled([
    fetchLatestBokRate(),
    fetchLatestM2Yoy(),
    fetchLatestGdpGrowth(),
    fetchLatestExportGrowth3mAvg(),
    fetchLatestBankLendingYoy(),
    fetchLatestUsdKrw(),
  ]);

  const pick = <T>(r: PromiseSettledResult<T>, label: string): T | null => {
    if (r.status === 'fulfilled') return r.value;
    errors.push(`${label}: ${r.reason instanceof Error ? r.reason.message : String(r.reason).slice(0, 120)}`);
    return null;
  };

  return {
    bokRate:           pick(bokR,  'bokRate'),
    m2YoyPct:          pick(m2R,   'm2'),
    nominalGdpGrowth:  pick(gdpR,  'gdp'),
    exportGrowth3mAvg: pick(expR,  'export'),
    bankLendingYoyPct: pick(lendR, 'bankLending'),
    usdKrw:            pick(fxR,   'usdKrw'),
    fetchedAt:         new Date().toISOString(),
    errors,
  };
}

/** 진단용 — ECOS_API_KEY 유무·베이스 URL·비활성 플래그 노출. */
export function getEcosStatus(): { base: string; hasKey: boolean; disabled: boolean; cacheKeys: string[] } {
  return {
    base: ECOS_BASE,
    hasKey: !!process.env.ECOS_API_KEY,
    disabled: ECOS_DISABLED,
    cacheKeys: Array.from(_cache.keys()),
  };
}
