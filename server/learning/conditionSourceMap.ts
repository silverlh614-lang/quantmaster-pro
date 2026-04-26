// @responsibility 27 조건 COMPUTED/AI 분류 + Tier 분류기 SSOT — 클라 evolutionEngine.ts 동기 사본 (ADR-0054)
//
// 클라이언트 SSOT 원본: `src/services/quant/evolutionEngine.ts`
// 본 파일은 절대 규칙 #3 (서버↔클라 직접 import 금지) 준수를 위한 동기 사본.
// 변경 시 양쪽 동시 수정 의무 — 회귀 테스트가 정합성 자동 검증.

/** 실데이터 기반 (가격/지표 실계산) — 정량 신호 9개. */
export const REAL_DATA_CONDITIONS: number[] = [2, 6, 7, 10, 11, 18, 19, 24, 25];

/** AI 추정 기반 (Gemini 해석) — 정성 신호 18개. */
export const AI_ESTIMATE_CONDITIONS: number[] = [
  1, 3, 4, 5, 8, 9, 12, 13, 14, 15, 16, 17, 20, 21, 22, 23, 26, 27,
];

export type ConditionSource = 'COMPUTED' | 'AI';

/** condition id → source 매핑. 미등록 ID 는 null. */
export function classifyConditionSource(id: number): ConditionSource | null {
  if (REAL_DATA_CONDITIONS.includes(id)) return 'COMPUTED';
  if (AI_ESTIMATE_CONDITIONS.includes(id)) return 'AI';
  return null;
}

// ─── Tier 분류 (ADR-0054 §2.1) ───────────────────────────────────────────

export type ConcordanceTier = 'EXCELLENT' | 'GOOD' | 'NEUTRAL' | 'WEAK' | 'POOR';

export const TIER_THRESHOLDS = {
  EXCELLENT: 8,
  GOOD: 6,
  NEUTRAL: 4,
  WEAK: 2,
} as const;

/**
 * 평균 score → tier. NaN/Infinity → POOR (보수적). 분모 0 도 호출자가 0 으로 전달 → POOR.
 */
export function classifyTier(avgScore: number): ConcordanceTier {
  if (!Number.isFinite(avgScore)) return 'POOR';
  if (avgScore >= TIER_THRESHOLDS.EXCELLENT) return 'EXCELLENT';
  if (avgScore >= TIER_THRESHOLDS.GOOD) return 'GOOD';
  if (avgScore >= TIER_THRESHOLDS.NEUTRAL) return 'NEUTRAL';
  if (avgScore >= TIER_THRESHOLDS.WEAK) return 'WEAK';
  return 'POOR';
}

/**
 * conditionScores 의 지정된 condition id 들의 평균. 빈 배열 또는 모두 NaN → 0.
 */
export function averageScoreFor(
  conditionScores: Record<number, number>,
  ids: number[],
): number {
  let sum = 0;
  let count = 0;
  for (const id of ids) {
    const v = conditionScores[id];
    if (typeof v === 'number' && Number.isFinite(v)) {
      sum += v;
      count += 1;
    }
  }
  if (count === 0) return 0;
  return sum / count;
}

/** 모든 5 tier 의 순회 — UI grid 또는 통계용. */
export const ALL_TIERS: ConcordanceTier[] = ['EXCELLENT', 'GOOD', 'NEUTRAL', 'WEAK', 'POOR'];
