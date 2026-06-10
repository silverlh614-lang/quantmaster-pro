// @responsibility Gate1 신호점수 컴포넌트(PRICE_MOMENTUM/BREAKOUT/VOLUME/TECH_TREND/RS) 계산 순수 함수 — 가중치·페널티 정책 무변경 (advisory-only).

import type { MacroGateState } from "../scanDiagnostics.js";
import type { CandidateEntryTrace } from "../entryFilterDecomposition.js";
import { buildPriceMomentumReversalApplier } from "../reversalMomentumCredit.js";
import type { SignalScoreComponentConfidence } from "./types.js";
import {
  round1,
  round2,
  finite,
  clamp,
  weightedFromNormalized,
  percentReturn,
  normalizeAbsoluteReturn20dTo100,
  normalizeSignalScoreTo100,
  scoreRelativeStrength,
} from "./scoring.js";
import {
  numericTraceValue,
  nestedNumericTraceValue,
  resolveNumericTracePath,
  stringArrayTraceValue,
  positiveReasonProxy,
  BREAKOUT_SOURCE_KEYS,
  breakoutSignalState,
  isBreakoutFired,
  isBreakoutUnavailable,
  breakoutProjectionBreakPoint,
} from "./traceFieldResolver.js";

export function normalizedRelativeStrength(
  trace: CandidateEntryTrace,
  macroGateState?: MacroGateState,
): ReturnType<typeof scoreRelativeStrength> {
  const explicitRelativeStrength = nestedNumericTraceValue(trace, [
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
  ]);
  const marketRelativeReturn = nestedNumericTraceValue(trace, [
    "marketRelativeReturn",
    "kospiRelativeReturn",
    "relativeReturn20d",
    "quote.marketRelativeReturn",
    "quote.kospiRelativeReturn",
    "quote.relativeReturn20d",
    "quoteFeatures.marketRelativeReturn",
    "quoteFeatures.kospiRelativeReturn",
    "quoteFeatures.relativeReturn20d",
    "featurePack.momentum.marketRelativeReturn",
    "featurePack.momentum.kospiRelativeReturn",
    "featurePack.momentum.relativeReturn20d",
    "momentumProjection.marketRelativeReturn",
    "momentumProjection.kospiRelativeReturn",
    "momentumProjection.relativeReturn20d",
    "gateLayerSummary.gate2.externalDataCoverage.benchmark.values.relativeReturn20d",
    "gate2ExternalDataCoverage.benchmark.values.relativeReturn20d",
    "conditionResults.relative_strength.relativeReturn20d",
  ]);
  const return20d = nestedNumericTraceValue(trace, [
    "return20d",
    "quote.return20d",
    "quoteFeatures.return20d",
    "featurePack.momentum.return20d",
    "momentumProjection.return20d",
    "gateLayerSummary.gate2.externalDataCoverage.benchmark.values.stockReturn20d",
    "gate2ExternalDataCoverage.benchmark.values.stockReturn20d",
    "gateLayerSummary.gate3.externalDataCoverage.momentumIndicators.values.return20d",
    "gate3ExternalDataCoverage.momentumIndicators.values.return20d",
  ]);
  const return5d = nestedNumericTraceValue(trace, [
    "return5d",
    "quote.return5d",
    "quoteFeatures.return5d",
    "featurePack.momentum.return5d",
    "momentumProjection.return5d",
    "gateLayerSummary.gate3.externalDataCoverage.momentumIndicators.values.return5d",
    "gate3ExternalDataCoverage.momentumIndicators.values.return5d",
  ]);
  const kospi20dReturn =
    nestedNumericTraceValue(trace, [
      "kospi20dReturn",
      "quote.kospi20dReturn",
      "quoteFeatures.kospi20dReturn",
      "featurePack.momentum.kospi20dReturn",
      "momentumProjection.kospi20dReturn",
      "gateLayerSummary.gate2.externalDataCoverage.benchmark.values.benchmarkReturn20d",
      "gate2ExternalDataCoverage.benchmark.values.benchmarkReturn20d",
      "macroState.kospi20dReturn",
    ]) ??
    ((macroGateState as unknown as Record<string, unknown> | undefined)
      ?.kospi20dReturn as number | undefined);
  const scored = scoreRelativeStrength({
    explicitRelativeStrength,
    marketRelativeReturn,
    return20d,
    return5d,
    kospi20dReturn,
  });
  if (scored.confidence !== "MISSING") return scored;
  const relativeProxyReasons = stringArrayTraceValue(trace, "watchlistReason");
  if (positiveReasonProxy(relativeProxyReasons)) {
    const normalizedScore = 35;
    return {
      rawValue: relativeProxyReasons,
      normalizedScore,
      weightedScore: weightedFromNormalized(normalizedScore, 10),
      maxScore: 10,
      confidence: "DEGRADED",
      providerIssue: false,
      marketSignal: false,
      message:
        "Relative strength uses a low-confidence watchlist reason proxy only; unavailable data is not promoted.",
    };
  }
  return scored;
}

export function volumeLiquidityScore(trace: CandidateEntryTrace): {
  rawValue?: unknown;
  normalizedScore: number;
  weightedScore: number;
  confidence: SignalScoreComponentConfidence;
  marketSignal: boolean;
  penaltyApplied: boolean;
  penaltyReason?: string;
  message: string;
} {
  const avgVolume = nestedNumericTraceValue(trace, [
    "avgVolume",
    "quote.avgVolume",
    "quoteFeatures.avgVolume",
  ]);
  const currentVolume = nestedNumericTraceValue(trace, [
    "projectedVolume",
    "volume",
    "quote.projectedVolume",
    "quote.volume",
    "quoteFeatures.projectedVolume",
    "quoteFeatures.volume",
  ]);
  if (avgVolume !== undefined && avgVolume > 0 && currentVolume !== undefined) {
    const ratio = currentVolume / avgVolume;
    const normalizedScore =
      ratio >= 1
        ? clamp(60 + ((ratio - 1) / 0.5) * 40, 0, 100)
        : clamp(((ratio - 0.5) / 0.5) * 60, 0, 100);
    return {
      rawValue: { volume: currentVolume, avgVolume, ratio: round2(ratio) },
      normalizedScore,
      weightedScore: weightedFromNormalized(normalizedScore, 12),
      confidence: "VERIFIED",
      marketSignal: ratio < 0.5,
      penaltyApplied: ratio < 0.5,
      penaltyReason: ratio < 0.5 ? "LIQUIDITY_LOW" : undefined,
      message:
        "Liquidity contribution computed from candidate volume/average-volume ratio.",
    };
  }
  const passed = trace.volumeLiquidityPassed;
  return {
    rawValue: passed,
    normalizedScore: passed === false ? 33.3 : passed === true ? 66.7 : 0,
    weightedScore: passed === false ? 4 : passed === true ? 8 : 0,
    confidence:
      passed === undefined
        ? "MISSING"
        : passed === false
          ? "DEGRADED"
          : "VERIFIED",
    marketSignal: passed === false,
    penaltyApplied: passed === false,
    penaltyReason: passed === false ? "LIQUIDITY_LOW" : undefined,
    message:
      passed === undefined
        ? "Liquidity source missing; contribution is 0 and is not filled with a uniform default."
        : "Liquidity contribution uses pass/fail fallback because volume ratio source is unavailable.",
  };
}

export function breakoutScore(trace: CandidateEntryTrace): {
  rawValue: Record<string, unknown>;
  normalizedScore: number;
  weightedScore: number;
  confidence: SignalScoreComponentConfidence;
  providerIssue: boolean;
  message: string;
} {
  const mappedScore = nestedNumericTraceValue(trace, [
    "breakoutScore",
    "breakoutStructureScore",
    "symbolFeatures.breakoutScore",
    "breakoutTrace.breakoutScore",
    "featurePack.breakout.breakoutScore",
    "featurePack.breakout.score",
  ]);
  if (finite(mappedScore)) {
    const normalizedScore = clamp(mappedScore <= 10 ? mappedScore * 10 : mappedScore, 0, 100);
    return {
      rawValue: { breakoutScore: mappedScore },
      normalizedScore,
      weightedScore: weightedFromNormalized(normalizedScore, 10),
      confidence: "VERIFIED",
      providerIssue: false,
      message:
        normalizedScore === 0
          ? "Breakout structure score is mapped and present, but zero by rule."
          : "Breakout structure score consumed from canonical breakout trace/feature pack.",
    };
  }
  const breakoutStates = BREAKOUT_SOURCE_KEYS.map((key) => ({
    key,
    value: breakoutSignalState(trace, key),
  }));
  const available = breakoutStates.filter(
    (item) => item.value !== undefined && !isBreakoutUnavailable(item.value),
  );
  const breakoutFired = available.filter((item) => isBreakoutFired(item.value));
  const breakoutUnavailable = breakoutStates.filter((item) =>
    isBreakoutUnavailable(item.value),
  );
  const normalizedScore =
    available.length > 0 ? (breakoutFired.length / available.length) * 100 : 0;
  const rawValue = Object.fromEntries(
    breakoutStates
      .filter((item) => item.value !== undefined)
      .map((item) => [item.key, item.value]),
  );
  const projectionBreakPoint = breakoutProjectionBreakPoint(trace);
  if (available.length === 0 && breakoutUnavailable.length === 0 && projectionBreakPoint) {
    return {
      rawValue: {
        ...rawValue,
        projectionBreakPoint,
        zeroReason: "SCORE_ZERO_BUT_COMPONENT_PRESENT",
      },
      normalizedScore: 0,
      weightedScore: 0,
      confidence: "DEGRADED",
      providerIssue: false,
      message:
        `BREAKOUT_STRUCTURE_SCORE_ZERO_BUT_COMPONENT_PRESENT:${projectionBreakPoint}; component projected with zero score for Gate trace alignment.`,
    };
  }
  return {
    rawValue,
    normalizedScore,
    weightedScore: weightedFromNormalized(normalizedScore, 10),
    confidence:
      available.length > 0
        ? "VERIFIED"
        : breakoutUnavailable.length > 0
          ? "UNKNOWN"
          : "MISSING",
    providerIssue: available.length === 0 && breakoutUnavailable.length > 0,
    message:
      available.length > 0
        ? `Breakout structure scored ${breakoutFired.length}/${available.length} available signals: ${breakoutFired.map((item) => item.key).join(", ") || "none"}.`
        : breakoutUnavailable.length > 0
          ? `Breakout structure source unavailable/error for ${breakoutUnavailable.map((item) => item.key).join(", ")}; not promoted to positive.`
          : "Breakout structure condition result missing; contribution is 0.",
  };
}

export function priceMomentumScore(trace: CandidateEntryTrace, regime?: string): {
  rawValue?: unknown;
  normalizedScore: number;
  weightedScore: number;
  confidence: SignalScoreComponentConfidence;
  message: string;
} {
  // ADR-0594: risk-on 국면 한정 오늘 단일일 강세(changePercent) bounded 양수 가산(SSOT 격리).
  // flag OFF / non-risk-on / changePercent 부재 → bonus 0 (byte-equivalent).
  const todayChangePercent = resolveNumericTracePath(trace, [
    "changePercent", "quote.changePercent", "quoteFeatures.changePercent", "prdy_ctrt", "quote.prdy_ctrt",
  ]).value;
  const { credit: reversalCredit, apply: applyReversalCredit, diagnostic: reversalDiagnostic } =
    buildPriceMomentumReversalApplier(todayChangePercent, regime);
  // resolveNumericTracePath 사용으로 first-match sourcePath 를 진단에 노출한다.
  // value 동작은 nestedNumericTraceValue 와 100% 동일(같은 우선순위·같은 first-match 결과).
  const return5dResolution = resolveNumericTracePath(trace, [
    "return5d",
    "quote.return5d",
    "quoteFeatures.return5d",
    "featurePack.momentum.return5d",
    "momentumProjection.return5d",
    "gateLayerSummary.gate3.externalDataCoverage.momentumIndicators.values.return5d",
    "gate3ExternalDataCoverage.momentumIndicators.values.return5d",
  ]);
  const return20dResolution = resolveNumericTracePath(trace, [
    "return20d",
    "quote.return20d",
    "quoteFeatures.return20d",
    "featurePack.momentum.return20d",
    "momentumProjection.return20d",
    "gateLayerSummary.gate2.externalDataCoverage.benchmark.values.stockReturn20d",
    "gate2ExternalDataCoverage.benchmark.values.stockReturn20d",
    "gateLayerSummary.gate3.externalDataCoverage.momentumIndicators.values.return20d",
    "gate3ExternalDataCoverage.momentumIndicators.values.return20d",
  ]);
  const return5d = return5dResolution.value;
  const return20d = return20dResolution.value;
  const gateScore = numericTraceValue(trace, ["gateScore"]);
  if (finite(return5d) || finite(return20d)) {
    const r5 = finite(return5d) ? percentReturn(return5d) : undefined;
    const r20 = finite(return20d) ? percentReturn(return20d) : undefined;
    const r5Score =
      r5 === undefined ? undefined : clamp(((r5 + 5) / 15) * 100, 0, 100);
    const r20Score =
      r20 === undefined ? undefined : normalizeAbsoluteReturn20dTo100(r20);
    const values = [r5Score, r20Score].filter(finite);
    const normalizedScore =
      values.reduce((sum, value) => sum + value, 0) / values.length;
    return {
      // 진단(behavior-neutral): resolved sourcePath + value 노출(H1 MISSING vs H2 오염값 판별, 점수 영향 0).
      rawValue: {
        return5d: r5,
        return20d: r20,
        return5dSourcePath: return5dResolution.sourcePath,
        return5dResolved: return5dResolution.value,
        return20dSourcePath: return20dResolution.sourcePath,
        return20dResolved: return20dResolution.value,
        ...reversalDiagnostic,
      },
      normalizedScore,
      weightedScore: applyReversalCredit(weightedFromNormalized(normalizedScore, 20)),
      confidence: "VERIFIED",
      message: reversalCredit.applied
        ? `Price momentum computed from candidate return5d/return20d features; reversal momentum credit +${round1(reversalCredit.bonus)} applied (${reversalCredit.reason}), clamped to maxScore 20.`
        : "Price momentum computed from candidate return5d/return20d features; gateScore is not used as actualScore override.",
    };
  }
  const normalizedScore = normalizeSignalScoreTo100(gateScore);
  return {
    rawValue: { gateScore, ...reversalDiagnostic },
    normalizedScore,
    weightedScore: applyReversalCredit(weightedFromNormalized(normalizedScore, 20)),
    confidence: gateScore === undefined ? "MISSING" : "DEGRADED",
    message: reversalCredit.applied
      ? `Price momentum reversal momentum credit +${round1(reversalCredit.bonus)} applied (${reversalCredit.reason}) over ${gateScore === undefined ? "missing" : "gateScore fallback"} base, clamped to maxScore 20.`
      : gateScore === undefined
        ? "Price momentum source missing; contribution is 0."
        : "Price momentum uses low-confidence gateScore fallback only as a component source.",
  };
}

export function technicalTrendScore(trace: CandidateEntryTrace): {
  rawValue?: unknown;
  normalizedScore: number;
  weightedScore: number;
  confidence: SignalScoreComponentConfidence;
  message: string;
} {
  const mappedTechnicalTrendScore = numericTraceValue(trace, ["technicalTrendScore", "featurePack.technicalTrendScore", "symbolFeatures.technicalTrendScore", "conditionResults.technicalTrendScore"]);
  if (finite(mappedTechnicalTrendScore)) {
    const normalizedMapped = clamp(mappedTechnicalTrendScore <= 10 ? mappedTechnicalTrendScore * 10 : mappedTechnicalTrendScore, 0, 100);
    const zeroReason = normalizedMapped === 0 ? 'FEATURE_PRESENT_BUT_ZERO_BY_RULE' : 'SCORE_COMPONENT_NOT_MAPPED';
    return {
      rawValue: { technicalTrendScore: mappedTechnicalTrendScore },
      normalizedScore: normalizedMapped,
      weightedScore: weightedFromNormalized(normalizedMapped, 14),
      confidence: 'VERIFIED',
      message: normalizedMapped === 0 ? `TECHNICAL_TREND_${zeroReason}` : 'Technical trend uses SSOT technicalTrendScore mapping.',
    };
  }
  const technicalTrendObjectPresent = Boolean(
    nestedNumericTraceValue(trace, ["technicalTrend.slope20d"])
    ?? nestedNumericTraceValue(trace, ["technicalTrend.rsi14"])
    ?? nestedNumericTraceValue(trace, ["conditionResults.technicalTrend.slope20d"])
    ?? nestedNumericTraceValue(trace, ["symbolFeatures.technicalTrend.slope20d"]),
  );
  const priceField = resolveNumericTracePath(trace, ["price", "currentPrice", "close", "quote.price", "quote.currentPrice", "quote.close", "symbolFeatures.price", "symbolFeatures.currentPrice", "conditionResults.price", "technicalIndicators.price", "technicalTrend.price"]);
  const ma20Field = resolveNumericTracePath(trace, ["ma20", "sma20", "quote.ma20", "quote.sma20", "symbolFeatures.ma20", "symbolFeatures.sma20", "conditionResults.ma20", "conditionResults.sma20", "technicalIndicators.ma20", "technicalIndicators.sma20", "technicalTrend.ma20"]);
  const ma60Field = resolveNumericTracePath(trace, ["ma60", "sma60", "quote.ma60", "quote.sma60", "symbolFeatures.ma60", "symbolFeatures.sma60", "conditionResults.ma60", "conditionResults.sma60", "technicalIndicators.ma60", "technicalIndicators.sma60", "technicalTrend.ma60"]);
  const rsi14Field = resolveNumericTracePath(trace, ["rsi14", "rsi", "quote.rsi14", "quote.rsi", "symbolFeatures.rsi14", "symbolFeatures.rsi", "conditionResults.rsi14", "conditionResults.rsi", "technicalIndicators.rsi14", "technicalIndicators.rsi", "technicalTrend.rsi14"]);
  const atrField = resolveNumericTracePath(trace, ["atr", "atr14", "quote.atr", "symbolFeatures.atr", "conditionResults.atr", "technicalIndicators.atr"]);
  const price = priceField.value;
  const ma20 = ma20Field.value;
  const ma60 = ma60Field.value;
  const rsi14 = rsi14Field.value;
  const atr = atrField.value;
  const atr20avg = numericTraceValue(trace, ["atr20avg"]);
  const scores: number[] = [];
  if (finite(price) && finite(ma20) && ma20 > 0)
    scores.push(price >= ma20 ? 100 : clamp((price / ma20) * 80, 0, 80));
  if (finite(price) && finite(ma60) && ma60 > 0)
    scores.push(price >= ma60 ? 100 : clamp((price / ma60) * 80, 0, 80));
  if (finite(rsi14))
    scores.push(
      rsi14 >= 45 && rsi14 <= 70
        ? 100
        : rsi14 >= 35 && rsi14 < 45
          ? 70
          : rsi14 > 70 && rsi14 <= 80
            ? 70
            : 30,
    );
  if (finite(atr) && finite(atr20avg) && atr20avg > 0)
    scores.push(
      atr <= atr20avg ? 85 : clamp(85 - (atr / atr20avg - 1) * 50, 30, 85),
    );
  if (scores.length === 0) {
    const nestedPresentTopMissing =
      !finite(numericTraceValue(trace, ["price"])) &&
      (finite(nestedNumericTraceValue(trace, ["quote.price"])) || finite(nestedNumericTraceValue(trace, ["symbolFeatures.price"])));
    const missingFields = [
      !finite(price) ? "TECH_MISSING_PRICE" : null,
      !finite(ma20) ? "TECH_MISSING_MA20" : null,
      !finite(ma60) ? "TECH_MISSING_MA60" : null,
      !finite(rsi14) ? "TECH_MISSING_RSI14" : null,
      !finite(atr) ? "TECH_MISSING_ATR" : null,
      !technicalTrendObjectPresent ? "TECH_MISSING_TREND_OBJECT" : null,
    ].filter(Boolean).join(",");
    const sourceMap = `sourceMap=price:${priceField.sourcePath ?? "-"},ma20:${ma20Field.sourcePath ?? "-"},ma60:${ma60Field.sourcePath ?? "-"},rsi14:${rsi14Field.sourcePath ?? "-"}`;
    return {
      normalizedScore: 0,
      weightedScore: 0,
      confidence: "MISSING",
      message:
        nestedPresentTopMissing
          ? `TECH_NESTED_PRESENT_TOP_LEVEL_MISSING:${missingFields};${sourceMap}`
          : `TECH_FIELD_PATH_MISMATCH_OR_MISSING:${missingFields};${sourceMap}`,
    };
  }
  const normalizedScore =
    scores.reduce((sum, value) => sum + value, 0) / scores.length;
  return {
    rawValue: { price, ma20, ma60, rsi14, atr, atr20avg },
    normalizedScore,
    weightedScore: weightedFromNormalized(normalizedScore, 14),
    confidence: "VERIFIED",
    message:
      "Technical trend computed from candidate price/MA/RSI/ATR features.",
  };
}
