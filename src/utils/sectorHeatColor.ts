// @responsibility 섹터 에너지 점수 → 4단계 히트 톤 분류 (ADR-0022 PR-E)

export type SectorHeatTone = 'HOT' | 'WARM' | 'COOL' | 'COLD';

/**
 * 섹터 에너지 점수 (0-100) 를 히트맵 4단계 톤으로 분류.
 *   HOT: ≥ 70  (적/오렌지 — Leading)
 *   WARM: ≥ 50 (황 — Above Average)
 *   COOL: ≥ 30 (청 — Below Average)
 *   COLD: < 30 (진청 — Lagging)
 *
 * NaN/Infinity → COLD (안전 fallback).
 */
export function classifySectorHeat(score: number | null | undefined): SectorHeatTone {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 'COLD';
  if (score >= 70) return 'HOT';
  if (score >= 50) return 'WARM';
  if (score >= 30) return 'COOL';
  return 'COLD';
}

/** Tailwind 색상 클래스 매핑. */
export const SECTOR_HEAT_CSS: Record<SectorHeatTone, string> = {
  HOT:  'bg-red-500/30 border-red-500/40 text-red-200',
  WARM: 'bg-amber-500/30 border-amber-500/40 text-amber-200',
  COOL: 'bg-cyan-500/20 border-cyan-500/30 text-cyan-200',
  COLD: 'bg-blue-500/20 border-blue-500/30 text-blue-200',
};
