/**
 * @responsibility AI 추천 universe API 클라이언트 — server/routes/aiUniverseRouter.ts 호출 (PR-25-B)
 *
 * 모든 AI 추천 경로(momentum/quantScreen/bear)와 enrichment 가 본 헬퍼를 통해
 * KIS/KRX 비의존 통로를 사용한다. 응답 schema 는 KRX valuation 호환 필드를 유지.
 */

/**
 * 서버 `server/services/aiUniverseTypes.ts::AiUniverseMode` 와 1:1 동기 사본.
 * PR-39 부터 `SMALL_MID_CAP` 정규값 추가 — 서버가 universe 발굴 단계에서
 * KOSDAQ·중소형 성장주 우선 후보를 반환.
 */
export type AiUniverseMode = 'MOMENTUM' | 'QUANT_SCREEN' | 'BEAR_SCREEN' | 'EARLY_DETECT' | 'SMALL_MID_CAP';

export interface AiUniverseSnapshotItem {
  code: string;
  name: string;
  per: number;
  pbr: number;
  marketCap: number;
  marketCapDisplay: string;
}

export interface AiUniverseValuation {
  code: string;
  name: string;
  per: number;
  pbr: number;
  eps: number;
  bps: number;
  marketCap: number;
  marketCapDisplay: string;
  dividendYield: number;
  foreignerOwnRatio: number;
  closePrice?: number;
  changeRate?: number;
  found: boolean;
  source: string;
}

/**
 * 서버 AiUniverseService 가 계산한 우선순위 단일 값. 클라이언트는 이 값으로
 * "AI 추천 버튼을 눌렀는데 아무것도 나오지 않음" 에 대한 사용자 안내를 결정한다.
 *
 * ADR-0016 (PR-37) 에서 5-Tier fallback 구조 도입 — Tier 2/3/4 사유 신규 3값 추가.
 * 서버 `server/services/aiUniverseTypes.ts::AiUniverseSourceStatus` 와 1:1 동기 사본.
 */
export type AiUniverseSourceStatus =
  /** Tier 1 — Google CSE 매칭 성공 (snapshot 갱신 권한) */
  | 'GOOGLE_OK'
  /** Tier 2 — 직전 정상 universe 디스크 스냅샷 (≤ 7일) */
  | 'FALLBACK_SNAPSHOT'
  /** Tier 3 — Yahoo OHLCV 정량 스크리너 */
  | 'FALLBACK_QUANT'
  /** Tier 4 — Naver Finance 모바일 단독 (펀더멘털 only, 뉴스·촉매 없음) */
  | 'FALLBACK_NAVER'
  /** Tier 5 — 하드코딩 KOSPI/KOSDAQ leader seed (최후 보루) */
  | 'FALLBACK_SEED'
  /** GOOGLE_SEARCH_API_KEY/CX 미설정 — Tier 2~5 로 자동 진행 */
  | 'NOT_CONFIGURED'
  /** google_search bucket 일일 한도 초과 — Tier 2~5 로 진행 */
  | 'BUDGET_EXCEEDED'
  /** HTTP / fetch 오류 — Tier 2~5 로 진행 */
  | 'ERROR'
  /** Google 결과는 있었으나 KRX 마스터 매칭 0건 (or 마스터 비어있음) */
  | 'NO_MATCHES';

/**
 * 시장 데이터 모드 5분류 (ADR-0016 §2). 서버 `MarketDataMode` 와 동기 사본.
 * UI 라벨 + universe 정책 분기에 사용. 클라이언트 단독 판정은 `useMarketMode` hook.
 */
export type MarketDataMode =
  | 'LIVE_TRADING_DAY'
  | 'AFTER_MARKET'
  | 'WEEKEND_CACHE'
  | 'HOLIDAY_CACHE'
  | 'DEGRADED';

export interface AiUniverseDiscoverResult {
  mode: AiUniverseMode;
  candidates: Array<{
    code: string;
    name: string;
    market: string;
    sector?: string;
    discoveredFrom: string[];
    snapshot: AiUniverseValuation | null;
  }>;
  fetchedAt: number;
  diagnostics: {
    googleQueries: number;
    googleHits: number;
    masterMisses: number;
    enrichSucceeded: number;
    enrichFailed: number;
    budgetExceeded: boolean;
    /** 서버에서 계산된 경로 상태 — 구버전 서버와의 호환을 위해 optional. */
    sourceStatus?: AiUniverseSourceStatus;
    /** Google 매칭 0건 → seed universe 로 대체되었는지. */
    fallbackUsed?: boolean;
    /** 응답 시점의 시장 모드 (ADR-0016) — 구버전 호환 optional. */
    marketMode?: MarketDataMode;
    /** Tier 2 (snapshot) / Tier 3 (Yahoo stale) 응답의 거래일 기준. YYYY-MM-DD KST. */
    tradingDateRef?: string | null;
    /** Tier 2 사용 시 snapshot 노화일. Tier 1/3/4/5 는 null. */
    snapshotAgeDays?: number | null;
    /** 폴백 사슬 시도 순서 — 운영자 진단용. */
    tierAttempts?: AiUniverseSourceStatus[];
  };
}

/**
 * `GET /api/health/ai-universe` 응답 (ADR-0016 §7). mode 별 snapshot 노화 + 전체
 * stockMaster health + 외부 source 상태를 한 번에 노출. 운영자가 텔레그램 명령
 * (PR-36 패턴) 또는 향후 운영자 페이지에서 즉시 진단 가능하도록 설계.
 */
export interface AiUniverseHealth {
  marketMode: MarketDataMode;
  snapshots: Record<AiUniverseMode, {
    tradingDate: string;
    ageDays: number;
    sourceStatus: AiUniverseSourceStatus;
  } | null>;
  masterHealth: {
    overall: number;
    krx: number;
    naver: number;
    shadow: number;
    seed: number;
  };
  sources: {
    google: 'configured' | 'not_configured' | 'budget_exceeded' | 'error';
    naver: 'active' | 'negative_cache' | 'error';
    yahoo: 'open' | 'gated_weekend' | 'gated_offhours' | 'error';
  };
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

/**
 * mode 별 AI 추천 universe 발굴.
 */
export async function discoverAiUniverse(
  mode: AiUniverseMode,
  options: { maxCandidates?: number; enrich?: boolean } = {},
): Promise<AiUniverseDiscoverResult | null> {
  const params = new URLSearchParams({ mode });
  if (options.maxCandidates) params.set('maxCandidates', String(options.maxCandidates));
  if (options.enrich === false) params.set('enrich', '0');
  return getJson<AiUniverseDiscoverResult>(`/api/ai-universe/discover?${params.toString()}`);
}

/**
 * 단일 종목 enrichment — 기존 `/api/krx/valuation` 의 drop-in 대체.
 */
export async function fetchAiUniverseSnapshot(code: string): Promise<AiUniverseValuation | null> {
  if (!/^\d{6}$/.test(code)) return null;
  return getJson<AiUniverseValuation>(`/api/ai-universe/snapshot?code=${code}`);
}

/**
 * 다중 종목 enrichment — momentumRecommendations 의 prefetch 패턴.
 */
export async function fetchAiUniverseSnapshots(codes: string[]): Promise<AiUniverseSnapshotItem[]> {
  const filtered = codes.filter((c) => /^\d{6}$/.test(c));
  if (filtered.length === 0) return [];
  const result = await getJson<{ items: AiUniverseSnapshotItem[] }>(
    `/api/ai-universe/snapshots?codes=${filtered.join(',')}`,
  );
  return result?.items ?? [];
}

/**
 * AI universe Health endpoint 호출. 서버가 신규 router 마운트 후에만 200,
 * 그 이전엔 null. UI 노출 페이지는 후속 PR.
 */
export async function fetchAiUniverseHealth(): Promise<AiUniverseHealth | null> {
  return getJson<AiUniverseHealth>(`/api/health/ai-universe`);
}
