/**
 * @responsibility Quant×Qual Concordance API 클라이언트 — /api/attribution/concordance (ADR-0054 PR-Z6)
 */

/** 서버 ConcordanceTier 동기 사본. */
export type ConcordanceTier = 'EXCELLENT' | 'GOOD' | 'NEUTRAL' | 'WEAK' | 'POOR';

export const ALL_CONCORDANCE_TIERS: ConcordanceTier[] = ['EXCELLENT', 'GOOD', 'NEUTRAL', 'WEAK', 'POOR'];

export interface ConcordanceCell {
  quantTier: ConcordanceTier;
  qualTier: ConcordanceTier;
  sampleCount: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgReturnPct: number | null;
}

export interface ConcordanceStats {
  sampleCount: number;
  winRate: number | null;
  avgReturnPct: number | null;
}

export interface ConcordanceMatrix {
  cells: ConcordanceCell[];
  diagonalStats: ConcordanceStats;
  offDiagonalStats: ConcordanceStats;
  totalSamples: number;
  capturedAt: string;
}

/** GET /api/attribution/concordance */
export async function fetchAttributionConcordance(): Promise<ConcordanceMatrix> {
  const res = await fetch('/api/attribution/concordance');
  if (!res.ok) {
    throw new Error(`fetch /api/attribution/concordance failed: ${res.status}`);
  }
  return (await res.json()) as ConcordanceMatrix;
}
