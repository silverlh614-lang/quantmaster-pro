// @responsibility ADR-0640 Gate1 분모 정합 — 결손 컴포넌트 maxScore 분모 제외 + requiredScore 비례 축소 순수 함수 SSOT (flag OFF byte-identical, 절대 인상 금지, provider/store/now/fetch 0).

import { round1, clamp } from "./minimumSignalScoreTrace/scoring.js";
import { isGate1DenominatorNormalizationEnabled } from "../gateConfig.js";

/** 결손으로 간주해 가용 분모(available)에서 maxScore 를 제외하는 confidence 집합. */
const MISSING_CONFIDENCES = ["UNKNOWN", "MISSING", "STALE"] as const;

/** requiredScore 축소 하한 비율 — catastrophic 결손에서도 0.7× 미만으로는 내리지 않음. */
const REQUIRED_SCORE_FLOOR_RATIO = 0.7;

/** resolveEffectiveRequiredScore / hypothetical 입력 component 최소 형태 (maxScore·confidence 필수). */
export interface DenominatorNormalizationComponent {
  weightedScore?: number;
  maxScore: number;
  confidence: string;
}

function isMissingConfidence(confidence: string): boolean {
  return (MISSING_CONFIDENCES as readonly string[]).includes(confidence);
}

/** configuredPositiveMax — 활성 positive component(maxScore>0)의 maxScore 합(분모 원형). */
export function computeConfiguredPositiveMax(
  components: ReadonlyArray<DenominatorNormalizationComponent>,
): number {
  return components
    .filter((c) => c.maxScore > 0)
    .reduce((sum, c) => sum + c.maxScore, 0);
}

/** availableMaxScore — maxScore>0 이면서 결손 confidence 가 아닌 component 의 maxScore 합(가용 분모). */
export function computeAvailableMaxScore(
  components: ReadonlyArray<DenominatorNormalizationComponent>,
): number {
  return components
    .filter((c) => c.maxScore > 0 && !isMissingConfidence(c.confidence))
    .reduce((sum, c) => sum + c.maxScore, 0);
}

/**
 * 결손 maxScore 를 분모에서 제외한 가용 분모 비례로 effective requiredScore 산출.
 * flag OFF(force 미지정) → requiredScore 그대로(byte-identical). 결손 없음(available>=configured) →
 * requiredScore 그대로(절대 인상 금지). 결손 시 proportional = required×(available/configured),
 * 하한 floor = required×0.7 로 clamp. 상한은 requiredScore(절대 인상 안 함).
 */
export function resolveEffectiveRequiredScore(
  requiredScore: number,
  components: ReadonlyArray<DenominatorNormalizationComponent>,
  forceEnabled = false,
): number {
  if (!forceEnabled && !isGate1DenominatorNormalizationEnabled()) return requiredScore;
  const configured = computeConfiguredPositiveMax(components);
  const available = computeAvailableMaxScore(components);
  // 분모 결손 없음(또는 비정상) → 무변경. available>=configured 이면 축소 여지 없음(절대 인상 금지).
  if (configured <= 0 || available <= 0 || available >= configured) return requiredScore;
  const proportional = round1(requiredScore * (available / configured));
  const floor = round1(requiredScore * REQUIRED_SCORE_FLOOR_RATIO);
  return clamp(proportional, floor, requiredScore);
}

/** ADR-0640 force-ON 관측 산출 — flag 무관 항상 stamp(actualScore 본체 영향 0, 관측 전용). */
export interface Adr0640DenominatorNormalizationHypothetical {
  denomNormConfiguredPositiveMax: number;
  denomNormAvailableMaxScore: number;
  denomNormEffectiveRequiredScore: number;
  denomNormHypotheticalPassed: boolean;
}

/**
 * flag-ON 가정 하의 분모 정합 hypothetical 을 순수 산출(force-ON 모드).
 * effectiveRequiredScore 는 결손 분모 제외 비례 축소(절대 인상 금지). 관측 전용 — provider/store/now/fetch 0.
 */
export function computeDenominatorNormalizationHypothetical(input: {
  components: ReadonlyArray<DenominatorNormalizationComponent>;
  requiredScore: number;
  actualScore: number;
}): Adr0640DenominatorNormalizationHypothetical {
  const configured = computeConfiguredPositiveMax(input.components);
  const available = computeAvailableMaxScore(input.components);
  const effective = resolveEffectiveRequiredScore(input.requiredScore, input.components, true);
  return {
    denomNormConfiguredPositiveMax: configured,
    denomNormAvailableMaxScore: available,
    denomNormEffectiveRequiredScore: effective,
    denomNormHypotheticalPassed: input.actualScore >= effective,
  };
}
