/**
 * @responsibility 계좌 생존 게이지 API 클라이언트 — survivalRouter 호출 (ADR-0050 PR-Z2)
 */

/** 서버 SurvivalSnapshot 동기 사본 (절대 규칙 #3 — 서버↔클라 직접 import 금지). */
export type SurvivalTier = 'OK' | 'WARN' | 'CRITICAL' | 'EMERGENCY';
export type SectorTier = 'OK' | 'WARN' | 'CRITICAL' | 'NA';
export type KellyTier = 'OK' | 'WARN' | 'CRITICAL' | 'CALIBRATING';

export interface DailyLossGauge {
  currentPct: number;
  limitPct: number;
  bufferPct: number;
  tier: SurvivalTier;
}

export interface SectorConcentrationGauge {
  hhi: number;
  topSector: string | null;
  topWeight: number;
  activePositions: number;
  tier: SectorTier;
}

export interface KellyConcordanceGauge {
  ratio: number | null;
  currentAvgKelly: number;
  recommendedKelly: number;
  sampleSize: number;
  tier: KellyTier;
}

export interface SurvivalSnapshot {
  dailyLoss: DailyLossGauge;
  sectorConcentration: SectorConcentrationGauge;
  kellyConcordance: KellyConcordanceGauge;
  overallTier: SurvivalTier;
  capturedAt: string;
}

/** GET /api/account/survival */
export async function fetchAccountSurvival(): Promise<SurvivalSnapshot> {
  const res = await fetch('/api/account/survival');
  if (!res.ok) {
    throw new Error(`fetch /api/account/survival failed: ${res.status}`);
  }
  return (await res.json()) as SurvivalSnapshot;
}
