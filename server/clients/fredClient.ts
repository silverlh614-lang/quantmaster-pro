const FRED_BASE = process.env.FRED_API_BASE ?? 'https://api.stlouisfed.org';
const FRED_DISABLED = process.env.FRED_API_DISABLED === 'true';
const REQUEST_TIMEOUT_MS = 8_000;
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
