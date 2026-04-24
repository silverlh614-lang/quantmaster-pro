/**
 * @responsibility AI 추천 universe API 클라이언트 — server/routes/aiUniverseRouter.ts 호출 (PR-25-B)
 *
 * 모든 AI 추천 경로(momentum/quantScreen/bear)와 enrichment 가 본 헬퍼를 통해
 * KIS/KRX 비의존 통로를 사용한다. 응답 schema 는 KRX valuation 호환 필드를 유지.
 */

export type AiUniverseMode = 'MOMENTUM' | 'QUANT_SCREEN' | 'BEAR_SCREEN' | 'EARLY_DETECT';

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
