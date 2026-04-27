/**
 * @responsibility 조건별 수익률 귀인 fetch (ADR-0035 PR-H)
 */

export interface ClientAttributionConditionStat {
  conditionId: number;
  totalTrades: number;
  winRate: number;
  avgReturn: number;
  avgReturnWhenHigh: number;
  avgReturnWhenLow: number;
}

export interface AttributionStatsResponse {
  stats: ClientAttributionConditionStat[];
  totalRecords: number;
}

export async function fetchAttributionStats(): Promise<AttributionStatsResponse> {
  const res = await fetch('/api/attribution/stats');
  if (!res.ok) {
    throw new Error(`fetch /api/attribution/stats failed: ${res.status}`);
  }
  return await res.json();
}
