// @responsibility fredClient 외부 클라이언트 모듈
import { promises as dnsPromises } from 'node:dns';
// .trim() + || → env 에 공백/빈문자열이 들어와도 안전하게 default 로 폴백(릴레이 URL 오타 방어).
const FRED_BASE = process.env.FRED_API_BASE?.trim() || 'https://api.stlouisfed.org';
const FRED_DISABLED = process.env.FRED_API_DISABLED === 'true';
// ADR 0건(hotfix) — FRED 호스트(api.stlouisfed.org) 응답이 배포지에서 8s 초과 hang 하는 사례 대응.
// env FRED_REQUEST_TIMEOUT_MS 로 조정(차단 vs 단순느림 판별·재배포 없이 추가 상향용). 기본 15s.
const REQUEST_TIMEOUT_MS = Number(process.env.FRED_REQUEST_TIMEOUT_MS) > 0
  ? Number(process.env.FRED_REQUEST_TIMEOUT_MS)
  : 15_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_FETCH_ATTEMPTS = 2;
const RETRY_DELAY_MS = 2_000;

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const _cache = new Map<string, CacheEntry<unknown>>();
const _staleCache = new Map<string, unknown>();

export function resetFredCache(): void {
  _cache.clear();
  _staleCache.clear();
}

function getCached<T>(key: string): { hit: boolean; data: T | null } {
  const hit = _cache.get(key);
  if (!hit || hit.expiresAt <= Date.now()) return { hit: false, data: null };
  return { hit: true, data: hit.data as T | null };
}

function setCached<T>(key: string, data: T): void {
  _cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  if (data !== null) _staleCache.set(key, data);
}

function getStale<T>(key: string): T | null {
  return (_staleCache.get(key) as T | undefined) ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFredApiKey(): string | null {
  if (FRED_DISABLED) return null;
  const apiKey = process.env.FRED_API_KEY?.trim();
  if (!apiKey) return null;
  return apiKey;
}

export async function fetchFredLatest(seriesId: string): Promise<number | null> {
  const apiKey = getFredApiKey();
  if (!apiKey) return null;
  if (!seriesId || !/^[A-Z0-9_]+$/i.test(seriesId)) return null;

  const cached = getCached<number>(seriesId);
  if (cached.hit) return cached.data;

  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const url = new URL('/fred/series/observations', FRED_BASE);
      url.searchParams.set('series_id', seriesId);
      url.searchParams.set('api_key', apiKey);
      url.searchParams.set('file_type', 'json');
      url.searchParams.set('sort_order', 'desc');
      url.searchParams.set('limit', '12');

      // URL → string 으로 변환 후 fetch — 테스트 mock 이 첫 인자를 string 으로 가정해
      // url.includes() 패턴 분기를 사용하는 케이스 호환. native fetch 는 둘 다 수용.
      const res = await fetch(url.toString(), { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const json = (await res.json()) as {
        observations?: Array<{ value?: string }>;
      };
      const observations = Array.isArray(json?.observations) ? json.observations : [];
      for (const obs of observations) {
        const value = obs?.value;
        if (value && value !== '.') {
          const parsed = Number(value);
          if (Number.isFinite(parsed)) {
            setCached(seriesId, parsed);
            return parsed;
          }
        }
      }

      setCached(seriesId, null);
      return null;
    } catch (e) {
      const isTimeout = e instanceof Error && e.name === 'AbortError';
      const tag = isTimeout ? '[FRED-TIMEOUT]' : '[FRED-ERROR]';
      const message = e instanceof Error ? e.message : String(e);

      if (attempt < MAX_FETCH_ATTEMPTS - 1) {
        console.warn(`${tag} ${seriesId}: ${message} (retrying)`);
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      const stale = getStale<number>(seriesId);
      console.warn(`${tag} ${seriesId}: ${message}${stale !== null ? ' (using stale cache)' : ''}`);
      if (stale !== null) {
        _cache.set(seriesId, { data: stale, expiresAt: Date.now() + 60_000 });
        return stale;
      }
      setCached(seriesId, null);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  const stale = getStale<number>(seriesId);
  if (stale !== null) {
    _cache.set(seriesId, { data: stale, expiresAt: Date.now() + 60_000 });
    return stale;
  }
  setCached(seriesId, null);
  return null;
}

export interface FredSnapshot {
  yieldCurve10y2y: number | null;
  hySpreadPct: number | null;
  sofrPct: number | null;
  financialStress: number | null;
  wtiCrude: number | null;
  fetchedAt: string;
  errors: string[];
}

export async function fetchFredSnapshot(): Promise<FredSnapshot> {
  const ids = [
    ['yieldCurve10y2y', 'T10Y2Y'],
    ['hySpreadPct', 'BAMLH0A0HYM2'],
    ['sofrPct', 'SOFR'],
    ['financialStress', 'STLFSI4'],
    ['wtiCrude', 'DCOILWTICO'],
  ] as const;

  const settled = await Promise.allSettled(ids.map(([, seriesId]) => fetchFredLatest(seriesId)));

  const snapshot: FredSnapshot = {
    yieldCurve10y2y: null,
    hySpreadPct: null,
    sofrPct: null,
    financialStress: null,
    wtiCrude: null,
    fetchedAt: new Date().toISOString(),
    errors: [],
  };

  settled.forEach((result, idx) => {
    const [field, seriesId] = ids[idx];
    if (result.status === 'fulfilled') {
      snapshot[field] = result.value;
      if (result.value === null) snapshot.errors.push(seriesId);
      return;
    }

    snapshot.errors.push(seriesId);
  });

  return snapshot;
}

// ── 진단 프로브 (read-only, executionImpact=NONE) ─────────────────────────────
// 단발 테스트 호출로 키/HTTP/timeout 실패 사유를 인밴드 노출한다. API 키는 절대 출력하지 않는다.

export interface FredProbeResult {
  source: 'FRED';
  hasKey: boolean;
  disabled: boolean;
  base: string;
  seriesId: string;
  dnsV4: string[];
  dnsV6: string[];
  dnsError: string | null;
  reachedNetwork: boolean;
  httpStatus: number | null;
  ok: boolean | null;
  observationCount: number | null;
  sampleValue: string | null;
  errorBody: string | null;
  error: string | null;
  elapsedMs: number;
}

/** host A/AAAA 해석(짧은 타임아웃) — DNS-OK-but-TCP-blocked vs DNS 문제 판별용. */
async function resolveDnsBrief(host: string, timeoutMs = 4_000): Promise<{ v4: string[]; v6: string[]; dnsError: string | null }> {
  const cap = <T>(p: Promise<T>): Promise<T | null> =>
    Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))]);
  try {
    const [v4, v6] = await Promise.all([cap(dnsPromises.resolve4(host)), cap(dnsPromises.resolve6(host))]);
    return { v4: v4 ?? [], v6: v6 ?? [], dnsError: null };
  } catch (e) {
    return { v4: [], v6: [], dnsError: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * FRED 단발 프로브 — fred=false 원인(키 거부 HTTP400 / rate-limit 429 / network timeout / disabled)을 판별.
 * 키는 응답·에러 본문에서 redact 후 반환. 호출 시 1회 실데이터 fetch(quota 미미).
 */
export async function probeFred(seriesId = 'T10Y2Y'): Promise<FredProbeResult> {
  const apiKey = process.env.FRED_API_KEY?.trim();
  const base: FredProbeResult = {
    source: 'FRED', hasKey: !!apiKey, disabled: FRED_DISABLED, base: FRED_BASE, seriesId,
    dnsV4: [], dnsV6: [], dnsError: null,
    reachedNetwork: false, httpStatus: null, ok: null,
    observationCount: null, sampleValue: null, errorBody: null, error: null, elapsedMs: 0,
  };
  if (FRED_DISABLED) return { ...base, error: 'FRED_API_DISABLED=true' };
  if (!apiKey) return { ...base, error: 'FRED_API_KEY 미설정' };

  // FRED_API_BASE 가 잘못된 URL(프로토콜 누락·따옴표·placeholder·오타)이면 new URL 이 동기 throw —
  // 진단 명령 자체가 조용히 죽지 않도록 가드해 CONFIG 오류를 인밴드 보고한다.
  // (FRED_BASE 에는 api_key 가 포함되지 않으므로 값 출력 안전.)
  let parsedBase: URL;
  try {
    parsedBase = new URL(FRED_BASE);
  } catch {
    return { ...base, error: `BAD_FRED_API_BASE (URL 파싱 실패 — https:// 포함·따옴표/오타 확인): ${FRED_BASE}` };
  }

  // DNS 해석(배포지 관점) — fetch hang 시에도 "resolve 됐는데 TCP 막힘"인지 확인.
  const dns = await resolveDnsBrief(parsedBase.hostname);
  base.dnsV4 = dns.v4; base.dnsV6 = dns.v6; base.dnsError = dns.dnsError;

  const url = new URL('/fred/series/observations', parsedBase);
  url.searchParams.set('series_id', seriesId);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('sort_order', 'desc');
  url.searchParams.set('limit', '1');

  const redact = (s: string): string => s.split(apiKey).join('***');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    const elapsedMs = Date.now() - started;
    const text = await res.text();
    if (res.ok) {
      let observationCount: number | null = null;
      let sampleValue: string | null = null;
      try {
        const j = JSON.parse(text) as { observations?: Array<{ value?: string }> };
        const obs = Array.isArray(j?.observations) ? j.observations : [];
        observationCount = obs.length;
        sampleValue = obs[0]?.value ?? null;
      } catch { /* SDS-ignore: probe 응답 파싱 실패는 null 로 보고(비치명) */ }
      return { ...base, reachedNetwork: true, httpStatus: res.status, ok: true, observationCount, sampleValue, elapsedMs };
    }
    return { ...base, reachedNetwork: true, httpStatus: res.status, ok: false, errorBody: redact(text).slice(0, 240), elapsedMs };
  } catch (e) {
    const elapsedMs = Date.now() - started;
    const isTimeout = e instanceof Error && e.name === 'AbortError';
    return { ...base, reachedNetwork: false, error: isTimeout ? `TIMEOUT(${REQUEST_TIMEOUT_MS}ms)` : redact(e instanceof Error ? e.message : String(e)), elapsedMs };
  } finally {
    clearTimeout(timer);
  }
}
