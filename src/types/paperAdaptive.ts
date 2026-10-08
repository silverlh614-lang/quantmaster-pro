// @responsibility Define autonomous Shadow decision contracts.
import { PAPER_FEATURES, type PaperFeatureKey } from './paperObservationFeatures';
import type { PaperProgramResearchView } from './paperIndicatorProgram';
import type { PaperAutonomyState } from './paperAutonomy';
import { PAPER_INVENTED_FEATURE_CUTS, paperIndicatorFormulaLabel, type PaperIndicatorFormula,
  type PaperInventedFeatureId } from './paperIndicatorFormula';

export type PaperAdaptiveFeatureKey = PaperFeatureKey | PaperInventedFeatureId;
export interface PaperAdaptiveRule {
  feature: PaperAdaptiveFeatureKey; bucket: number; horizon: 1 | 3 | 5;
  /** Preserve the formula and discovery evidence chosen before forward observations. */
  invention?: PaperIndicatorInvention;
}
export interface PaperAdaptiveStats {
  sampleCount: number; dateCount: number; symbolCount: number;
  /** Fresh evaluations may retain IDs; persisted evidence stores their sorted SHA-256 fingerprint. */
  experimentIds?: string[]; experimentIdsDigest?: string;
  meanNetReturnPct: number | null; meanDailyExcessPct: number | null;
}
export interface PaperIndicatorInvention {
  id: PaperInventedFeatureId; formula: PaperIndicatorFormula;
  createdAt: string; discoveryCutoffAt: string;
  rule: { bucket: number; horizon: 1 | 3 | 5 }; training: PaperAdaptiveStats;
  authorship?: { generatedAt: string; model: string; inputDigest: string };
}
export interface PaperIndicatorDiscovery {
  version: 'indicator-discovery-v1'; attemptedIds: PaperInventedFeatureId[];
  round: number; roundStartedAt: string; roundTrainingEndDate: string | null;
  inventions: PaperIndicatorInvention[];
  programAttemptedIds?: PaperInventedFeatureId[];
  programReviews?: Array<{ id: PaperInventedFeatureId; at: string; status: 'REGISTERED' | 'NO_TRAINING_EDGE' | 'REDUNDANT_OR_CONSTANT' | 'RANKED_OUT';
    sampleCount: number; dateCount: number; meanDailyExcessPct: number | null }>;
}
export interface PaperAdaptivePolicy {
  version: 'adaptive-features-v1'; windowEntryDates: number; trainingFraction: number;
  maturityModel?: 'per-horizon-v1';
  /** Connection also needs five validation dates and a passed symbol-permutation check. */
  activationModel?: 'placebo-gated-v1';
  minimumSamples: number; minimumEntryDates: number; activationMarginDailyPct: number;
  replacementMarginDailyPct: number; maxActiveRules: number;
}
export type PaperAdaptiveReason = 'MISSING_INPUT' | 'INSUFFICIENT_TRAINING' | 'INSUFFICIENT_VALIDATION'
  | 'NO_TRAINING_EDGE' | 'NO_VALIDATION_EDGE' | 'PLACEBO_NOT_PASSED' | 'ACTIVE' | 'RANKED_OUT' | 'FORWARD_OBSERVATION' | 'DISCOVERY_RETIRED';
/** A connected rule keeps a looser chance limit so one day's permutation draw does not flip it. */
export const PAPER_ACTIVATION_GATE = Object.freeze({ minimumValidationDates: 5, maxChancePct: 10, retainedMaxChancePct: 20 });
export interface PaperAdaptiveCandidate {
  rule: PaperAdaptiveRule; training: PaperAdaptiveStats; validation: PaperAdaptiveStats;
  active: boolean; reason: PaperAdaptiveReason;
}
export interface PaperAdaptiveEvidence {
  cutoffAt: string; evaluatedAt: string; validationStartDate: string;
  policy: PaperAdaptivePolicy; candidate: PaperAdaptiveCandidate;
}
export interface PaperExplorationTrial {
  id: string; registeredAt: string; candidate: PaperAdaptiveCandidate;
}
export interface PaperExplorationEvidence extends Omit<PaperAdaptiveEvidence, 'validationStartDate'> {
  validationStartDate: string | null; trialId: string; registeredAt: string;
}
export interface PaperAdaptiveHorizonSamples {
  horizon: 1 | 3 | 5; matureSampleCount: number; matureDateCount: number;
  trainingSampleCount: number; trainingDateCount: number;
  validationSampleCount: number; validationDateCount: number;
}
/** The same validation repeated after pairing each stock's features with another stock's returns; gates connection. */
export interface PaperAdaptivePlacebo {
  version: 'symbol-permutation-v1'; permutations: number;
  /** Candidates that passed validation before the chance check and ranking. */
  passedCount: number; shuffledMeanPassedCount: number; shuffledHighPassedCount: number;
  /** Share of runs, the real one included, passing at least as many candidates. */
  chancePct: number;
  /** Per passed rule: share of runs whose best chance pass reached the same daily excess. */
  rules: Array<{ feature: PaperAdaptiveFeatureKey; bucket: number; horizon: 1 | 3 | 5; chancePct: number }>;
}
export interface PaperAdaptiveState {
  /** Read-only generator status, projected by the view layer rather than used in decisions. */
  programResearch?: PaperProgramResearchView;
  policy: PaperAdaptivePolicy; tradingDate: string; evaluatedAt: string; cutoffAt: string;
  windowStartDate: string | null; validationStartDate: string | null;
  matureSampleCount: number; matureDateCount: number;
  horizonSamples?: PaperAdaptiveHorizonSamples[];
  candidates: PaperAdaptiveCandidate[];
  discovery?: PaperIndicatorDiscovery;
  exploration?: { version: 'shadow-exploration-v1'; sequence: number; rules: PaperExplorationTrial[]; autonomy?: PaperAutonomyState };
  placebo?: PaperAdaptivePlacebo;
  changes: Array<{ at: string; feature: PaperAdaptiveFeatureKey; from: PaperAdaptiveRule | null;
    to: PaperAdaptiveRule | null; reason: PaperAdaptiveReason }>;
}
export const PAPER_ADAPTIVE_REASON_LABELS: Record<PaperAdaptiveReason, string> = {
  MISSING_INPUT: '학습에 쓸 지표 표본 없음', INSUFFICIENT_TRAINING: '학습 표본 누적 중',
  INSUFFICIENT_VALIDATION: '후반 확인 표본 누적 중', NO_TRAINING_EDGE: '학습 구간 우위 없음',
  NO_VALIDATION_EDGE: '후반 확인 성과 부족', PLACEBO_NOT_PASSED: '무작위 대조 미통과', ACTIVE: '매수 판단에 연결', RANKED_OUT: '다른 지표 우선 사용',
  FORWARD_OBSERVATION: '발명 이후 성과 관측 중',
  DISCOVERY_RETIRED: '발명 지표 연구 종료',
};
/** Stored chance share of a passed rule, matched by feature, range and holding period. */
export function paperPlaceboChance(state: Pick<PaperAdaptiveState, 'placebo'>, rule: PaperAdaptiveRule): number | null {
  return state.placebo?.rules.find(item => item.feature === rule.feature && item.bucket === rule.bucket
    && item.horizon === rule.horizon)?.chancePct ?? null;
}
export function paperAdaptiveFeatureLabel(rule: PaperAdaptiveRule): string {
  if (rule.invention?.formula.version === 'feature-program-v1') return `AI 발명 · ${rule.invention.formula.title}`;
  return rule.invention ? `발명 · ${paperIndicatorFormulaLabel(rule.invention.formula)}`
    : PAPER_FEATURES[rule.feature as PaperFeatureKey]?.label ?? '발명 지표';
}
export function paperAdaptiveRuleLabel(rule: PaperAdaptiveRule): string {
  const definition = rule.invention ? { cuts: PAPER_INVENTED_FEATURE_CUTS, unit: '' }
    : PAPER_FEATURES[rule.feature as PaperFeatureKey];
  if (!definition) return `${paperAdaptiveFeatureLabel(rule)} · D${rule.horizon}`;
  const cuts: readonly number[] = definition.cuts;
  const lower = cuts[rule.bucket - 1], upper = cuts[rule.bucket];
  const range = lower === undefined ? `${upper}${definition.unit} 미만`
    : upper === undefined ? `${lower}${definition.unit} 이상` : `${lower} 이상 ${upper}${definition.unit} 미만`;
  return `${paperAdaptiveFeatureLabel(rule)} · ${range} · D${rule.horizon}`;
}
