// @responsibility ADR-0613 Gate1 천장 배선(RS percentile·BREAKOUT OHLCV·positive max→100) flag-gated transform SSOT — flag OFF byte-equivalent, provider/store/now/fetch 0.

import type { CandidateEntryTrace } from "./entryFilterDecomposition.js";
import { nestedNumericTraceValue } from "./minimumSignalScoreTrace/traceFieldResolver.js";
import { weightedFromNormalized, clamp, round1, finite } from "./minimumSignalScoreTrace/scoring.js";
import { resolveBreakoutStructureSource } from "./gate1PositiveSourceWiringAdr0475.js";
import { isGate1PositiveCeilingWiringEnabled } from "../gateConfig.js";

/** RELATIVE_STRENGTH / BREAKOUT_STRUCTURE component scorer 의 공통 산출 형태 (배선 입력/출력). */
export interface CeilingWiringComponentScore {
  rawValue?: unknown;
  normalizedScore: number;
  weightedScore: number;
  maxScore: number;
  confidence: string;
  providerIssue?: boolean;
  marketSignal?: boolean;
  message?: string;
}

const RELATIVE_STRENGTH_MAX_SCORE = 10;
const BREAKOUT_MAX_SCORE = 10;

/** trace 의 ADR-0597 횡단면 percentile(0~100). explicit RS hydration 우선순위 입력. */
function resolveCrossSectionalPercentile(trace: CandidateEntryTrace): number | undefined {
  return nestedNumericTraceValue(trace, [
    "crossSectionalPercentile",
    "totalPercentile",
    "quote.crossSectionalPercentile",
    "quoteFeatures.crossSectionalPercentile",
    "featurePack.momentum.crossSectionalPercentile",
  ]);
}

/** RS explicit 소스 존재 여부 — ADR-0469 dedup: explicit RS 있으면 percentile 미승격. */
function hasExplicitRelativeStrength(trace: CandidateEntryTrace): boolean {
  return (
    nestedNumericTraceValue(trace, [
      "relativeStrengthScore",
      "relativeStrength",
      "rsRankPct",
      "quote.rsRankPct",
      "quote.relativeStrengthScore",
      "quoteFeatures.rsRankPct",
      "quoteFeatures.relativeStrengthScore",
      "featurePack.momentum.rsRankPct",
      "featurePack.momentum.relativeStrengthScore",
      "momentumProjection.rsRankPct",
      "momentumProjection.relativeStrengthScore",
      "conditionResults.relative_strength.score",
      "conditionResults.relative_strength.normalizedScore",
      "marketRelativeReturn",
      "kospiRelativeReturn",
      "relativeReturn20d",
    ]) !== undefined
  );
}

/**
 * (a) WIRE_RS_PERCENTILE_INPUT — flag ON & explicit RS 부재 & percentile 존재 시에만
 * RELATIVE_STRENGTH normalizedScore 를 횡단면 percentile 로 hydration. flag OFF → base 그대로(identity).
 * maxScore 10 무변경. percentile 부재 → base graceful(불변식 #6). ADR-0469 dedup: explicit RS 있으면 미승격.
 */
export function applyRsPercentileWiring(
  base: CeilingWiringComponentScore,
  trace: CandidateEntryTrace,
  forceEnabled = false,
): CeilingWiringComponentScore {
  if (!forceEnabled && !isGate1PositiveCeilingWiringEnabled()) return base;
  // explicit RS 가 이미 소비됐으면(base confidence !== MISSING) 이중계상 회피.
  if (base.confidence !== "MISSING") return base;
  if (hasExplicitRelativeStrength(trace)) return base;
  const percentile = resolveCrossSectionalPercentile(trace);
  if (!finite(percentile)) return base;
  const normalizedScore = clamp(percentile, 0, 100);
  // percentile 이 base 보다 약하면 승격하지 않음(천장 배선은 결손 채움이지 하향 아님).
  if (normalizedScore <= base.normalizedScore) return base;
  return {
    ...base,
    rawValue: { crossSectionalPercentile: normalizedScore, source: "ADR0597_PERCENTILE" },
    normalizedScore,
    weightedScore: weightedFromNormalized(normalizedScore, RELATIVE_STRENGTH_MAX_SCORE),
    maxScore: RELATIVE_STRENGTH_MAX_SCORE,
    confidence: "DEGRADED",
    message:
      "RELATIVE_STRENGTH hydrated from ADR-0597 cross-sectional percentile (ADR-0613); maxScore 10 unchanged.",
  };
}

/** trace 의 OHLCV 입력을 ADR-0475 resolveBreakoutStructureSource 인터페이스로 추출. */
function resolveBreakoutOhlcvInput(trace: CandidateEntryTrace) {
  const currentPrice = nestedNumericTraceValue(trace, [
    "currentPrice", "price", "close", "quote.currentPrice", "quote.price", "quote.close",
  ]);
  const high20 = nestedNumericTraceValue(trace, ["high20", "quote.high20", "quoteFeatures.high20"]);
  const high60 = nestedNumericTraceValue(trace, ["high60", "quote.high60", "quoteFeatures.high60"]);
  const high120 = nestedNumericTraceValue(trace, ["high120", "quote.high120", "quoteFeatures.high120"]);
  const volumeRatio = nestedNumericTraceValue(trace, ["volumeRatio", "quote.volumeRatio", "quoteFeatures.volumeRatio"]);
  const ma20 = nestedNumericTraceValue(trace, ["ma20", "sma20", "quote.ma20", "quote.sma20"]);
  const ma60 = nestedNumericTraceValue(trace, ["ma60", "sma60", "quote.ma60", "quote.sma60"]);
  const vcpField = (trace as unknown as Record<string, unknown>).vcpDetected;
  return {
    currentPrice,
    high20,
    high60,
    high120,
    volumeRatio,
    aboveMA20: finite(currentPrice) && finite(ma20) ? currentPrice >= ma20 : undefined,
    aboveMA60: finite(currentPrice) && finite(ma60) ? currentPrice >= ma60 : undefined,
    vcpDetected: typeof vcpField === "boolean" ? vcpField : undefined,
    hasOhlcv: finite(currentPrice) && (finite(high20) || finite(high60)),
  };
}

/**
 * (b) WIRE_BREAKOUT_STRUCTURE — flag ON & 현행 breakout MISSING/0 & OHLCV 존재 시에만
 * ADR-0475 resolveBreakoutStructureSource 결과(0~10)를 normalizedScore(×10)로 hydration.
 * flag OFF → base 그대로(identity). maxScore 10 무변경. OHLCV 부재 → base graceful(불변식 #6).
 * 두 번째 공식 신설 금지 — ADR-0475 함수 재사용.
 */
export function applyBreakoutWiring(
  base: CeilingWiringComponentScore,
  trace: CandidateEntryTrace,
  forceEnabled = false,
): CeilingWiringComponentScore {
  if (!forceEnabled && !isGate1PositiveCeilingWiringEnabled()) return base;
  // 현행이 이미 양수 소스를 소비 중이면(VERIFIED & >0) 무변경.
  if (base.confidence === "VERIFIED" && base.normalizedScore > 0) return base;
  const ohlcv = resolveBreakoutOhlcvInput(trace);
  if (!ohlcv.hasOhlcv) return base;
  const resolved = resolveBreakoutStructureSource({
    symbol: typeof (trace as { symbol?: unknown }).symbol === "string" ? (trace as { symbol: string }).symbol : "ADR0613",
    currentPrice: ohlcv.currentPrice,
    high20: ohlcv.high20,
    high60: ohlcv.high60,
    high120: ohlcv.high120,
    volumeRatio: ohlcv.volumeRatio,
    aboveMA20: ohlcv.aboveMA20,
    aboveMA60: ohlcv.aboveMA60,
    vcpDetected: ohlcv.vcpDetected,
  });
  if (resolved.source !== "OHLCV") return base;
  // ADR-0475 normalizedBreakoutScore 는 0~10 스케일 → 0~100 으로 환산(×10).
  const normalizedScore = clamp(resolved.normalizedBreakoutScore * 10, 0, 100);
  if (normalizedScore <= base.normalizedScore) return base;
  return {
    ...base,
    rawValue: { ...resolved, source: "ADR0475_OHLCV" },
    normalizedScore,
    weightedScore: weightedFromNormalized(normalizedScore, BREAKOUT_MAX_SCORE),
    maxScore: BREAKOUT_MAX_SCORE,
    confidence: "VERIFIED",
    providerIssue: false,
    message:
      "BREAKOUT_STRUCTURE hydrated from ADR-0475 resolveBreakoutStructureSource OHLCV (ADR-0613); maxScore 10 unchanged.",
  };
}

/**
 * (c) NORMALIZE_POSITIVE_MAX_TO_100 — flag ON 시 positive weightedScore 합을
 * ADR-0468 NORMALIZE_TO_100 산식(`positive × (100 / configuredPositiveMax)`)으로 정규화.
 * flag OFF → rawComputed 그대로(identity). penalty 부분 정규화 제외. requiredScore 70 무변경.
 * configuredPositiveMax 는 활성 component 의 maxScore 합(>0 component 의 maxScore 합).
 */
export function applyPositiveMaxNormalization(
  rawComputed: number,
  components: ReadonlyArray<{ weightedScore: number; maxScore: number }>,
  forceEnabled = false,
): number {
  if (!forceEnabled && !isGate1PositiveCeilingWiringEnabled()) return rawComputed;
  const positiveTotal = components
    .filter((c) => c.weightedScore > 0)
    .reduce((sum, c) => sum + c.weightedScore, 0);
  const penaltyTotal = components
    .filter((c) => c.weightedScore < 0)
    .reduce((sum, c) => sum + c.weightedScore, 0);
  const configuredPositiveMax = components
    .filter((c) => c.maxScore > 0)
    .reduce((sum, c) => sum + c.maxScore, 0);
  if (configuredPositiveMax <= 0 || positiveTotal <= 0) return rawComputed;
  const normalizedPositive = positiveTotal * (100 / configuredPositiveMax);
  return round1(normalizedPositive + penaltyTotal);
}

/** ADR-0613 관측 ledger hypothetical delta — flag 무관 항상 산출(force-ON 가정). */
export interface Adr0613CeilingWiringHypothetical {
  ceilingWiringRsPercentileDelta: number;
  ceilingWiringBreakoutDelta: number;
  ceilingWiringNormalizeDelta: number;
  ceilingWiringHypotheticalActualScore: number;
  ceilingWiringHypotheticalPassed: boolean;
}

/**
 * flag-ON 가정 하의 hypothetical delta/score/passed 를 순수 산출(force-ON 모드).
 * base* 는 현행(flag OFF) 산출. trace/components 로 force-ON wrapper 를 재실행해 delta 계산.
 * 관측 전용 — actualScore/passed 본체에 영향 0. provider/store/now/fetch 0.
 */
export function computeCeilingWiringHypothetical(input: {
  relativeStrengthBase: CeilingWiringComponentScore;
  breakoutBase: CeilingWiringComponentScore;
  trace: CandidateEntryTrace;
  rawComputed: number;
  components: ReadonlyArray<{ weightedScore: number; maxScore: number }>;
  requiredScore: number;
}): Adr0613CeilingWiringHypothetical {
  const rsHydrated = applyRsPercentileWiring(input.relativeStrengthBase, input.trace, true);
  const breakoutHydrated = applyBreakoutWiring(input.breakoutBase, input.trace, true);
  const rsDelta = round1(rsHydrated.weightedScore - input.relativeStrengthBase.weightedScore);
  const breakoutDelta = round1(breakoutHydrated.weightedScore - input.breakoutBase.weightedScore);
  // hypothetical components: RS/BREAKOUT 의 hydrated weightedScore 를 반영한 합.
  const hydratedComputed = round1(input.rawComputed + rsDelta + breakoutDelta);
  // normalize 는 hydrated positive 합 기준으로 산출 — RS/BREAKOUT delta 를 positive 합에 반영.
  const normalized = applyPositiveMaxNormalization(
    hydratedComputed,
    rebuildHydratedComponents(input.components, rsDelta, breakoutDelta),
    true,
  );
  const normalizeDelta = round1(normalized - hydratedComputed);
  const hypotheticalActualScore = round1(normalized);
  return {
    ceilingWiringRsPercentileDelta: rsDelta,
    ceilingWiringBreakoutDelta: breakoutDelta,
    ceilingWiringNormalizeDelta: normalizeDelta,
    ceilingWiringHypotheticalActualScore: hypotheticalActualScore,
    ceilingWiringHypotheticalPassed: hypotheticalActualScore >= input.requiredScore,
  };
}

/** RS/BREAKOUT delta 를 component 합에 반영한 가상 component 배열(정규화 입력용). */
function rebuildHydratedComponents(
  components: ReadonlyArray<{ weightedScore: number; maxScore: number }>,
  rsDelta: number,
  breakoutDelta: number,
): Array<{ weightedScore: number; maxScore: number }> {
  // delta 는 positive 합에만 가산 — 가상의 추가 positive component 로 모델링(maxScore 0: 분모 무변경).
  const extra: Array<{ weightedScore: number; maxScore: number }> = [];
  if (rsDelta !== 0) extra.push({ weightedScore: rsDelta, maxScore: 0 });
  if (breakoutDelta !== 0) extra.push({ weightedScore: breakoutDelta, maxScore: 0 });
  return [...components.map((c) => ({ weightedScore: c.weightedScore, maxScore: c.maxScore })), ...extra];
}
