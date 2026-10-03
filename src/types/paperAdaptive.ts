// @responsibility Define autonomous Shadow decision contracts.
import { PAPER_FEATURES, type PaperFeatureKey } from './paperObservationFeatures';

export interface PaperAdaptiveRule { feature: PaperFeatureKey; bucket: number; horizon: 1 | 3 | 5 }
export interface PaperAdaptiveStats {
  sampleCount: number; dateCount: number; symbolCount: number;
  /** Fresh evaluations may retain IDs; persisted evidence stores their sorted SHA-256 fingerprint. */
  experimentIds?: string[]; experimentIdsDigest?: string;
  meanNetReturnPct: number | null; meanDailyExcessPct: number | null;
}
export interface PaperAdaptivePolicy {
  version: 'adaptive-features-v1'; windowEntryDates: number; trainingFraction: number;
  minimumSamples: number; minimumEntryDates: number; activationMarginDailyPct: number;
  replacementMarginDailyPct: number; maxActiveRules: number;
}
export type PaperAdaptiveReason = 'MISSING_INPUT' | 'INSUFFICIENT_TRAINING' | 'INSUFFICIENT_VALIDATION'
  | 'NO_TRAINING_EDGE' | 'NO_VALIDATION_EDGE' | 'ACTIVE' | 'RANKED_OUT';
export interface PaperAdaptiveCandidate {
  rule: PaperAdaptiveRule; training: PaperAdaptiveStats; validation: PaperAdaptiveStats;
  active: boolean; reason: PaperAdaptiveReason;
}
export interface PaperAdaptiveEvidence {
  cutoffAt: string; evaluatedAt: string; validationStartDate: string;
  policy: PaperAdaptivePolicy; candidate: PaperAdaptiveCandidate;
}
export interface PaperAdaptiveState {
  policy: PaperAdaptivePolicy; tradingDate: string; evaluatedAt: string; cutoffAt: string;
  windowStartDate: string | null; validationStartDate: string | null;
  matureSampleCount: number; matureDateCount: number;
  candidates: PaperAdaptiveCandidate[];
  changes: Array<{ at: string; feature: PaperFeatureKey; from: PaperAdaptiveRule | null;
    to: PaperAdaptiveRule | null; reason: PaperAdaptiveReason }>;
}
export const PAPER_ADAPTIVE_REASON_LABELS: Record<PaperAdaptiveReason, string> = {
  MISSING_INPUT: '당시 지표 자료 없음', INSUFFICIENT_TRAINING: '학습 표본 누적 중',
  INSUFFICIENT_VALIDATION: '후반 확인 표본 누적 중', NO_TRAINING_EDGE: '학습 구간 우위 없음',
  NO_VALIDATION_EDGE: '후반 확인 성과 부족', ACTIVE: '매수 판단에 연결', RANKED_OUT: '다른 지표 우선 사용',
};
export function paperAdaptiveRuleLabel(rule: PaperAdaptiveRule): string {
  const definition = PAPER_FEATURES[rule.feature];
  const cuts: readonly number[] = definition.cuts;
  const lower = cuts[rule.bucket - 1], upper = cuts[rule.bucket];
  const range = lower === undefined ? `${upper}${definition.unit} 미만`
    : upper === undefined ? `${lower}${definition.unit} 이상` : `${lower} 이상 ${upper}${definition.unit} 미만`;
  return `${definition.label} · ${range} · D${rule.horizon}`;
}
