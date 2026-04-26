/**
 * @responsibility 추천 이력·통계 API 클라이언트 — recommendationsRouter 호출 (ADR-0019 PR-B)
 */

/** 서버 `RecommendationRecord` 동기 사본 (절대 규칙 #3 — 서버↔클라 직접 import 금지). */
export interface ClientRecommendationRecord {
  id: string;
  stockCode: string;
  stockName: string;
  signalTime: string;
  priceAtRecommend: number;
  stopLoss: number;
  targetPrice: number;
  kellyPct: number;
  gateScore: number;
  signalType: 'STRONG_BUY' | 'BUY';
  conditionKeys?: string[];
  entryRegime?: string;
  status: 'PENDING' | 'WIN' | 'LOSS' | 'EXPIRED';
  actualReturn?: number;
  resolvedAt?: string;
  lateWin?: boolean;
  expiredAt?: string;
  return60d?: number;
  return90d?: number;
}

export interface ClientMonthlyStats {
  month: string;
  total: number;
  wins: number;
  losses: number;
  expired: number;
  winRate: number;
  avgReturn: number;
  strongBuyWinRate: number;
  sampleSufficient: boolean;
  compoundReturn: number;
  profitFactor: number | null;
}

export interface RecommendationHistoryResponse {
  total: number;
  limit: number;
  records: ClientRecommendationRecord[];
}

export interface RecommendationStatsResponse {
  monthly: ClientMonthlyStats;
  totalCount: number;
  pendingCount: number;
}

/** GET /api/recommendations/history?limit=N */
export async function fetchRecommendationHistory(limit = 100): Promise<RecommendationHistoryResponse> {
  const res = await fetch(`/api/recommendations/history?limit=${encodeURIComponent(limit)}`);
  if (!res.ok) {
    throw new Error(`fetch /api/recommendations/history failed: ${res.status}`);
  }
  return await res.json();
}

/** GET /api/recommendations/stats */
export async function fetchRecommendationStats(): Promise<RecommendationStatsResponse> {
  const res = await fetch('/api/recommendations/stats');
  if (!res.ok) {
    throw new Error(`fetch /api/recommendations/stats failed: ${res.status}`);
  }
  return await res.json();
}

// ─── PR-M: 일별 시계열 ─────────────────────────────────────────────────────

export interface ClientDailyTimeseriesPoint {
  date: string;
  total: number;
  wins: number;
  losses: number;
  pending: number;
  expired: number;
  winRate: number | null;
  avgReturn: number | null;
}

export interface RecommendationTimeseriesResponse {
  days: number;
  series: ClientDailyTimeseriesPoint[];
}

export async function fetchRecommendationTimeseries(days = 7): Promise<RecommendationTimeseriesResponse> {
  const res = await fetch(`/api/recommendations/timeseries?days=${encodeURIComponent(days)}`);
  if (!res.ok) {
    throw new Error(`fetch /api/recommendations/timeseries failed: ${res.status}`);
  }
  return await res.json();
}
