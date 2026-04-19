/**
 * fredClient.ts — 서버사이드 FRED(세인트루이스 연준) API 어댑터 (아이디어 11)
 *
 * 이전에는 server/trading/marketDataRefresh.ts 내 private `fetchFred()` 와
 * server/routes/marketDataRouter.ts 의 `/fred` 프록시에 로직이 흩어져 있었다.
 * macroIndexEngine 이 동일한 FRED 시리즈를 구독해야 하므로, 관측값 파싱 · 캐시 ·
 * 타임아웃을 한곳에서 재사용 가능한 클라이언트로 분리한다.
 *
 * 제공 함수:
 *   - fetchFredLatest(seriesId)    — 최신 유효 관측값 (숫자) 또는 null
 *   - fetchFredSnapshot()          — MHS 계산에 필요한 5종 시리즈 병렬 수집
 *
 * 시리즈:
 *   T10Y2Y:        장단기 금리차 (음수 → 침체 6~18개월 선행)
 *   BAMLH0A0HYM2:  US HY 스프레드 (%, 양수 커질수록 신용 스트레스)
 *   SOFR:          달러 단기 기준금리 대용 (%)
 *   STLFSI4:       세인트루이스 금융스트레스 지수 (0 기준)
 *   DCOILWTICO:    WTI 유가 (USD/배럴)
 *
 * 설계 원칙:
 *   - FRED_API_KEY 미설정 / FRED_API_DISABLED=true 시 즉시 null 반환.
 *   - 5분 캐시 TTL — 동일 시리즈 반복 호출에도 API 부하 최소화.
 *   - 실패 시 null · errors 로 축적, throw 하지 않음.
 */

// ── 타입 ─────────────────────────────────────────────────────────────────────

export interface FredSnapshot {
  yieldCurve10y2y: number | null;  // T10Y2Y
  hySpreadPct:     number | null;  // BAMLH0A0HYM2 (%, 예: 3.42)
  sofrPct:         number | null;  // SOFR (%)
  financialStress: number | null;  // STLFSI4
  wtiCrude:        number | null;  // DCOILWTICO
  fetchedAt:       string;
  errors:          string[];
}

// ── 설정 ─────────────────────────────────────────────────────────────────────

const FRED_BASE = process.env.FRED_API_BASE ?? 'https://api.stlouisfed.org';
const FRED_DISABLED = process.env.FRED_API_DISABLED === 'true';
const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

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

export function resetFredCache(): void { _cache.clear(); }

// ── 단건 조회 ────────────────────────────────────────────────────────────────

/**
 * 지정한 FRED 시리즈의 최신 유효 관측값을 숫자로 반환.
 * 최근 5건 중 value 가 '.'(결측) · 빈 문자열이 아닌 첫 번째.
 * FRED_API_KEY 미설정 / 네트워크 실패 / 파싱 실패는 모두 null.
 */
export async function fetchFredLatest(seriesId: string): Promise<number | null> {
  if (FRED_DISABLED) return null;
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return null;
  if (!seriesId || !/^[A-Z0-9_]+$/i.test(seriesId)) return null;

  const cached = getCached<number | null>(seriesId);
  if (cached !== null) return cached;

  const url =
    `${FRED_BASE}/fred/series/observations` +
    `?series_id=${encodeURIComponent(seriesId)}` +
    `&api_key=${encodeURIComponent(apiKey)}` +
    `&file_type=json&sort_order=desc&limit=5`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'GET', signal: ac.signal });
    if (!res.ok) {
      console.warn(`[FRED] ${seriesId} HTTP ${res.status}`);
      setCached(seriesId, null);
      return null;
    }
    const data = await res.json() as { observations?: Array<{ value: string }> };
    const obs = data?.observations ?? [];
    const valid = obs.find(o => o.value && o.value !== '.' && o.value.trim() !== '');
    if (!valid) {
      setCached(seriesId, null);
      return null;
    }
    const n = parseFloat(valid.value);
    if (!Number.isFinite(n)) {
      setCached(seriesId, null);
      return null;
    }
    setCached(seriesId, n);
    return n;
  } catch (e) {
    console.warn(`[FRED] ${seriesId} 요청 실패: ${e instanceof Error ? e.message : e}`);
    setCached(seriesId, null);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── 스냅샷 ───────────────────────────────────────────────────────────────────

/** MHS 계산에 필요한 5종 시리즈를 한번에 수집. 부분 실패 허용. */
export async function fetchFredSnapshot(): Promise<FredSnapshot> {
  const errors: string[] = [];
  const SERIES = {
    T10Y2Y:        'yieldCurve10y2y',
    BAMLH0A0HYM2:  'hySpreadPct',
    SOFR:          'sofrPct',
    STLFSI4:       'financialStress',
    DCOILWTICO:    'wtiCrude',
  } as const;

  const ids = Object.keys(SERIES) as Array<keyof typeof SERIES>;
  const settled = await Promise.allSettled(ids.map(id => fetchFredLatest(id)));

  const snap: FredSnapshot = {
    yieldCurve10y2y: null,
    hySpreadPct:     null,
    sofrPct:         null,
    financialStress: null,
    wtiCrude:        null,
    fetchedAt:       new Date().toISOString(),
    errors,
  };
  settled.forEach((r, i) => {
    const id = ids[i];
    const field = SERIES[id];
    if (r.status === 'fulfilled') {
      (snap as Record<typeof field, number | null>)[field] = r.value;
    } else {
      errors.push(`${id}: ${r.reason instanceof Error ? r.reason.message : String(r.reason).slice(0, 120)}`);
    }
  });
  return snap;
}

export function getFredStatus(): { base: string; hasKey: boolean; disabled: boolean; cacheKeys: string[] } {
  return {
    base: FRED_BASE,
    hasKey: !!process.env.FRED_API_KEY,
    disabled: FRED_DISABLED,
    cacheKeys: Array.from(_cache.keys()),
  };
}
