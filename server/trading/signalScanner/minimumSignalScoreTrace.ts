/**
 * @responsibility ADR-0466 Minimum Signal Score Decomposition diagnostics.
 *
 * Counterfactual/advisory-only score tracing for Gate1 minimum signal score.
 * Does not relax thresholds, route orders, or mutate trading state.
 */
import type { MacroGateState } from "./scanDiagnostics.js";
import { resolveWatchlistUpstreamScore } from "./watchlistUpstreamScoreResolver.js";
import type {
  CandidateEntryTrace,
  Gate1CandidateTrace,
  Gate1ConditionTrace,
  SupplyConfluenceState,
  SupplyProviderHealthTrace,
} from "./entryFilterDecomposition.js";

export type SignalScoreComponentCode =
  | "PRICE_MOMENTUM"
  | "VOLUME_LIQUIDITY"
  | "TECHNICAL_TREND"
  | "RELATIVE_STRENGTH"
  | "WATCHLIST_UPSTREAM_SCORE"
  | "BREAKOUT_STRUCTURE"
  | "SUPPLY_CONFLUENCE"
  | "INVESTOR_FLOW"
  | "SECTOR_ENERGY"
  | "MARKET_REGIME"
  | "MACRO_RISK"
  | "DATA_QUALITY"
  | "SESSION_STATUS"
  | "NEWS_OR_CATALYST"
  | "WATCHLIST_PRIORITY"
  | "RISK_PENALTY"
  | "UNKNOWN_DATA_PENALTY"
  | "SOFT_FAIL_PENALTY"
  | "OTHER";

export type SignalScoreComponentConfidence =
  | "VERIFIED"
  | "DEGRADED"
  | "STALE"
  | "UNKNOWN"
  | "MISSING"
  | "DIAGNOSTIC_ONLY";

export interface SignalScoreComponentTrace {
  code: SignalScoreComponentCode;
  rawValue?: unknown;
  normalizedScore: number;
  weight: number;
  weightedScore: number;
  maxScore: number;
  contributionPct: number;
  confidence: SignalScoreComponentConfidence;
  providerIssue: boolean;
  marketSignal: boolean;
  penaltyApplied: boolean;
  penaltyReason?: string;
  message: string;
}

export interface MinimumSignalScoreTrace {
  symbol: string;
  name?: string;
  requiredScore: number;
  actualScore: number;
  scoreGap: number;
  passed: boolean;
  components: SignalScoreComponentTrace[];
  positiveScoreTotal: number;
  penaltyTotal: number;
  unknownPenaltyTotal: number;
  providerIssuePenaltyTotal: number;
  sessionPenaltyTotal: number;
  sectorPenaltyTotal: number;
  riskPenaltyTotal: number;
  softFailPenaltyTotal: number;
  topMissingContributors: string[];
  topPenaltyContributors: string[];
  wouldPassIfUnknownNeutral: boolean;
  wouldPassIfProviderPenaltyRemoved: boolean;
  wouldPassIfSessionPenaltyRemoved: boolean;
  wouldPassIfRiskPenaltyCapped: boolean;
  wouldPassIfSectorPenaltyRemoved: boolean;
  wouldPassIfSoftFailPenaltyRemoved: boolean;
}

export type UnknownDataTreatment =
  | "NEUTRAL"
  | "EXCLUDED_FROM_DENOMINATOR"
  | "ZERO_SCORE"
  | "PENALTY"
  | "BEARISH_EQUIVALENT";

export interface UnknownDataTreatmentAudit {
  symbol: string;
  unknownFields: {
    field: string;
    treatment: UnknownDataTreatment;
    scoreImpact: number;
    allowed: boolean;
    message: string;
  }[];
  hasBearishEquivalentUnknown: boolean;
  totalUnknownScoreImpact: number;
}

export type SoftFailCode =
  | "PROVIDER_UNKNOWN"
  | "SUPPLY_UNKNOWN"
  | "SECTOR_DIAGNOSTIC"
  | "MIN_SIGNAL_GAP"
  | "DATA_STALE"
  | "RISK_PENALTY"
  | "SESSION_SOFT_BLOCK"
  | "LOW_CONFIDENCE"
  | "OTHER";

export interface SoftFailAccumulationTrace {
  symbol: string;
  softFails: {
    code: SoftFailCode;
    weight: number;
    severityScore: number;
    reason: string;
    providerIssue: boolean;
    marketSignal: boolean;
  }[];
  totalSoftFailScore: number;
  softFailThreshold: number;
  failedBySoftAccumulation: boolean;
  wouldPassIfProviderSoftFailsExcluded: boolean;
  wouldPassIfSessionSoftFailsExcluded: boolean;
  wouldPassIfSectorSoftFailsExcluded: boolean;
  wouldPassIfRiskSoftFailsCapped: boolean;
}

export interface RiskPenaltyTrace {
  symbol: string;
  regimeMultiplier: number;
  fomcMultiplier: number;
  sectorMultiplier: number;
  riskMultiplier: number;
  finalKelly: number;
  signalScoreRiskPenalty: number;
  sizingRiskPenalty: number;
  doubleCountWarning: boolean;
  wouldPassIfRiskPenaltyCapped: boolean;
}

export type SignalScoreCalibrationScenario =
  | "UNKNOWN_NEUTRAL"
  | "PROVIDER_PENALTY_REMOVED"
  | "SESSION_PENALTY_REMOVED"
  | "RISK_PENALTY_CAPPED"
  | "SECTOR_PENALTY_REMOVED"
  | "SOFT_FAIL_PENALTY_REMOVED"
  | "MIN_SIGNAL_THRESHOLD_MINUS_5"
  | "MIN_SIGNAL_THRESHOLD_MINUS_10"
  | "R3_EARLY_ADAPTIVE_THRESHOLD";

export interface SignalScoreCalibrationResult {
  scenario: SignalScoreCalibrationScenario;
  hypotheticalSurvivors: number;
  survivorExamples: {
    symbol: string;
    name?: string;
    actualScore: number;
    adjustedScore: number;
    requiredScore: number;
    reason: string[];
  }[];
  executionImpact: "NONE";
}

export interface MinSignalScoreDecompositionReport {
  timestamp: string;
  forDate: string;
  regime: string;
  marketSession: string;
  totalCandidates: number;
  minSignalFailed: number;
  requiredScoreAvg: number;
  actualScoreAvg: number;
  actualScoreMin: number;
  actualScoreMax: number;
  avgScoreGap: number;
  topScoreDeficits: {
    code: SignalScoreComponentCode;
    avgImpact: number;
    affectedCount: number;
  }[];
  topPenaltyContributors: {
    code: SignalScoreComponentCode;
    avgPenalty: number;
    affectedCount: number;
  }[];
  unknownTreatmentWarnings: number;
  wouldPassIfUnknownNeutral: number;
  wouldPassIfProviderPenaltyRemoved: number;
  wouldPassIfSessionPenaltyRemoved: number;
  wouldPassIfRiskPenaltyCapped: number;
  wouldPassIfSoftFailPenaltyRemoved: number;
  recommendedAction:
    | "NO_ACTION"
    | "DIAGNOSTIC_ONLY"
    | "FIX_UNKNOWN_TREATMENT"
    | "REMOVE_SESSION_FROM_SIGNAL_SCORE"
    | "CAP_RISK_PENALTY"
    | "REVIEW_MIN_SIGNAL_THRESHOLD"
    | "REVIEW_SOFT_FAIL_ACCUMULATION";
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toFiniteNumber(value: unknown): number | undefined {
  if (finite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function normalizeSignalScoreTo100(
  score: number | null | undefined,
): number {
  if (score == null || !Number.isFinite(score)) return 0;
  if (score >= 0 && score <= 10) return score * 10;
  if (score > 10 && score <= 27) return (score / 27) * 100;
  if (score > 27 && score <= 100) return score;
  if (score > 100) return 100;
  return 0;
}

function weightedFromNormalized(
  normalizedScore: number,
  maxScore: number,
): number {
  return round1((clamp(normalizedScore, 0, 100) / 100) * maxScore);
}

function numericTraceValue(
  trace: CandidateEntryTrace,
  keys: readonly string[],
): number | undefined {
  const record = trace as unknown as Record<string, unknown>;
  const symbolFeatures =
    record.symbolFeatures && typeof record.symbolFeatures === "object"
      ? (record.symbolFeatures as Record<string, unknown>)
      : undefined;
  for (const key of keys) {
    const direct = record[key];
    if (finite(direct)) return direct;
    const feature = symbolFeatures?.[key];
    if (finite(feature)) return feature;
  }
  return undefined;
}

function nestedNumericTraceValue(
  trace: CandidateEntryTrace,
  paths: readonly string[],
): number | undefined {
  return resolveNumericTracePath(trace, paths).value;
}

function resolveNumericTracePath(
  trace: CandidateEntryTrace,
  paths: readonly string[],
): { value: number | undefined; sourcePath?: string } {
  const root = trace as unknown as Record<string, unknown>;
  const expandedPaths = paths.flatMap((path) =>
    path.includes(".") ? [path] : [`symbolFeatures.${path}`, path],
  );
  for (const path of expandedPaths) {
    const value = path.split(".").reduce<unknown>((current, part) => {
      if (current && typeof current === "object")
        return (current as Record<string, unknown>)[part];
      return undefined;
    }, root);
    const numeric = toFiniteNumber(value);
    if (numeric !== undefined) return { value: numeric, sourcePath: path };
  }
  return { value: undefined };
}

function stringArrayTraceValue(
  trace: CandidateEntryTrace,
  key: string,
): string[] | undefined {
  const value = (trace as unknown as Record<string, unknown>)[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function positiveReasonProxy(reasons: readonly string[] | undefined): boolean {
  return (reasons ?? []).some((reason) =>
    /momentum|leader|leading|relative|rs|강세|주도주/i.test(reason),
  );
}

const BREAKOUT_SOURCE_KEYS = [
  "breakout_momentum",
  "turtle_high",
  "volume_breakout",
  "volume_surge",
  "vcp",
  "trend_acceleration",
] as const;

function breakoutSignalState(trace: CandidateEntryTrace, key: string): unknown {
  const record = trace as unknown as Record<string, unknown>;
  const direct = record[key];
  if (direct !== undefined) return direct;
  const signals = record.breakoutSignals;
  if (signals && typeof signals === "object")
    return (signals as Record<string, unknown>)[key];
  const conditionResults = record.conditionResults;
  if (conditionResults && typeof conditionResults === "object")
    return (conditionResults as Record<string, unknown>)[key];
  const conditionKeys = record.conditionKeys;
  if (
    Array.isArray(conditionKeys) &&
    conditionKeys.some(
      (item) =>
        typeof item === "string" && item.toLowerCase() === key.toLowerCase(),
    )
  )
    return true;
  return undefined;
}

function isBreakoutFired(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string")
    return /^(FIRED|PASS|PASSED|TRUE)$/i.test(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      record.fired === true ||
      record.passed === true ||
      isBreakoutFired(record.status) ||
      isBreakoutFired(record.result)
    );
  }
  return false;
}

function isBreakoutUnavailable(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string")
    return /^(UNAVAILABLE|ERROR|MISSING|UNKNOWN)$/i.test(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      isBreakoutUnavailable(record.status) ||
      isBreakoutUnavailable(record.result) ||
      record.error === true
    );
  }
  return false;
}

function normalizeRelativeReturn20dTo100(value: number): number {
  const percentValue = Math.abs(value) <= 1 ? value * 100 : value;
  return clamp(((percentValue + 10) / 20) * 100, 0, 100);
}

function normalizeAbsoluteReturn20dTo100(value: number): number {
  const percentValue = Math.abs(value) <= 1 ? value * 100 : value;
  return clamp(((percentValue + 10) / 30) * 100, 0, 100);
}

function percentReturn(value: number): number {
  return Math.abs(value) <= 1 ? value * 100 : value;
}

export function scoreRelativeStrength(input: {
  return20d?: number;
  return5d?: number;
  kospi20dReturn?: number;
  explicitRelativeStrength?: number;
  marketRelativeReturn?: number;
}): {
  rawValue?: unknown;
  normalizedScore: number;
  weightedScore: number;
  maxScore: 10;
  confidence: SignalScoreComponentConfidence;
  providerIssue: boolean;
  marketSignal: boolean;
  message: string;
} {
  if (finite(input.explicitRelativeStrength)) {
    const normalizedScore = normalizeSignalScoreTo100(
      input.explicitRelativeStrength,
    );
    return {
      rawValue: input.explicitRelativeStrength,
      normalizedScore,
      weightedScore: weightedFromNormalized(normalizedScore, 10),
      maxScore: 10,
      confidence: "VERIFIED",
      providerIssue: false,
      marketSignal: false,
      message:
        "Relative strength component imported from explicit candidate ranking/source.",
    };
  }

  if (finite(input.marketRelativeReturn)) {
    const relativeReturn20d = percentReturn(input.marketRelativeReturn);
    const normalizedScore = normalizeRelativeReturn20dTo100(relativeReturn20d);
    return {
      rawValue: { relativeReturn20d },
      normalizedScore,
      weightedScore: weightedFromNormalized(normalizedScore, 10),
      maxScore: 10,
      confidence: "VERIFIED",
      providerIssue: false,
      marketSignal: false,
      message:
        "Relative strength component computed from explicit market-relative return.",
    };
  }

  if (finite(input.return20d)) {
    const return20d = percentReturn(input.return20d);
    const kospi20dReturn = finite(input.kospi20dReturn)
      ? percentReturn(input.kospi20dReturn)
      : undefined;
    const relativeReturn20d =
      kospi20dReturn === undefined ? return20d : return20d - kospi20dReturn;
    const normalizedScore =
      kospi20dReturn === undefined
        ? normalizeAbsoluteReturn20dTo100(return20d)
        : normalizeRelativeReturn20dTo100(relativeReturn20d);
    return {
      rawValue: { return20d, kospi20dReturn, relativeReturn20d },
      normalizedScore,
      weightedScore: weightedFromNormalized(normalizedScore, 10),
      maxScore: 10,
      confidence: "VERIFIED",
      providerIssue: false,
      marketSignal: false,
      message:
        kospi20dReturn === undefined
          ? "Relative strength component computed from candidate 20-day return because KOSPI 20-day return is unavailable."
          : "Relative strength component computed from candidate 20-day return minus KOSPI 20-day return.",
    };
  }

  if (finite(input.return5d)) {
    const return5d = percentReturn(input.return5d);
    const normalizedScore = clamp(((return5d + 5) / 15) * 100, 0, 100);
    return {
      rawValue: { return5d },
      normalizedScore,
      weightedScore: weightedFromNormalized(normalizedScore, 10),
      maxScore: 10,
      confidence: "DEGRADED",
      providerIssue: false,
      marketSignal: false,
      message:
        "Relative strength component computed from short-horizon 5-day return fallback.",
    };
  }

  return {
    normalizedScore: 0,
    weightedScore: 0,
    maxScore: 10,
    confidence: "MISSING",
    providerIssue: false,
    marketSignal: false,
    message:
      "Relative strength source missing; contribution is 0 and is not treated as provider or bearish penalty.",
  };
}

function normalizedRelativeStrength(
  trace: CandidateEntryTrace,
  macroGateState?: MacroGateState,
): ReturnType<typeof scoreRelativeStrength> {
  const explicitRelativeStrength = nestedNumericTraceValue(trace, [
    "relativeStrengthScore",
    "relativeStrength",
    "rsRankPct",
    "conditionResults.relative_strength.score",
    "conditionResults.relative_strength.normalizedScore",
  ]);
  const marketRelativeReturn = nestedNumericTraceValue(trace, [
    "marketRelativeReturn",
    "kospiRelativeReturn",
    "relativeReturn20d",
    "conditionResults.relative_strength.relativeReturn20d",
  ]);
  const return20d = nestedNumericTraceValue(trace, [
    "return20d",
    "quote.return20d",
  ]);
  const return5d = nestedNumericTraceValue(trace, [
    "return5d",
    "quote.return5d",
  ]);
  const kospi20dReturn =
    nestedNumericTraceValue(trace, [
      "kospi20dReturn",
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

function volumeLiquidityScore(trace: CandidateEntryTrace): {
  rawValue?: unknown;
  normalizedScore: number;
  weightedScore: number;
  confidence: SignalScoreComponentConfidence;
  marketSignal: boolean;
  penaltyApplied: boolean;
  penaltyReason?: string;
  message: string;
} {
  const avgVolume = numericTraceValue(trace, ["avgVolume"]);
  const currentVolume = numericTraceValue(trace, ["projectedVolume", "volume"]);
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

function breakoutScore(trace: CandidateEntryTrace): {
  rawValue: Record<string, unknown>;
  normalizedScore: number;
  weightedScore: number;
  confidence: SignalScoreComponentConfidence;
  providerIssue: boolean;
  message: string;
} {
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

function priceMomentumScore(trace: CandidateEntryTrace): {
  rawValue?: unknown;
  normalizedScore: number;
  weightedScore: number;
  confidence: SignalScoreComponentConfidence;
  message: string;
} {
  const return5d = nestedNumericTraceValue(trace, [
    "return5d",
    "quote.return5d",
  ]);
  const return20d = nestedNumericTraceValue(trace, [
    "return20d",
    "quote.return20d",
  ]);
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
      rawValue: { return5d: r5, return20d: r20 },
      normalizedScore,
      weightedScore: weightedFromNormalized(normalizedScore, 20),
      confidence: "VERIFIED",
      message:
        "Price momentum computed from candidate return5d/return20d features; gateScore is not used as actualScore override.",
    };
  }
  const normalizedScore = normalizeSignalScoreTo100(gateScore);
  return {
    rawValue: gateScore,
    normalizedScore,
    weightedScore: weightedFromNormalized(normalizedScore, 20),
    confidence: gateScore === undefined ? "MISSING" : "DEGRADED",
    message:
      gateScore === undefined
        ? "Price momentum source missing; contribution is 0."
        : "Price momentum uses low-confidence gateScore fallback only as a component source.",
  };
}

function technicalTrendScore(trace: CandidateEntryTrace): {
  rawValue?: unknown;
  normalizedScore: number;
  weightedScore: number;
  confidence: SignalScoreComponentConfidence;
  message: string;
} {
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

function component(
  input: Omit<SignalScoreComponentTrace, "contributionPct">,
): SignalScoreComponentTrace {
  return {
    ...input,
    contributionPct:
      input.maxScore === 0
        ? 0
        : round1((input.weightedScore / input.maxScore) * 100),
  };
}

export function buildMinimumSignalScoreTrace(input: {
  trace: CandidateEntryTrace;
  hasGate1Blocker: boolean;
  regime: string;
  marketSession: string;
  macroGateState?: MacroGateState;
  supplyProviderHealth: SupplyProviderHealthTrace;
  supplyConfluenceState: SupplyConfluenceState;
  hasSectorEnergyDiagnostic: boolean;
}): MinimumSignalScoreTrace {
  const requiredScore = input.trace.minSignalRequiredScore ?? 70;
  const riskMultiplier =
    input.macroGateState?.finalKellyMultiplier !== undefined
      ? input.macroGateState.finalKellyMultiplier /
        Math.max(
          0.000001,
          (input.macroGateState.kellyMultiplierFromRegime || 1) *
            (input.macroGateState.fomcKellyMultiplier || 1),
        )
      : 1;
  const uncappedRiskPenalty =
    riskMultiplier < 0.8 ? -round1((0.8 - riskMultiplier) * 15) : 0;
  const riskPenalty = Math.max(-3, uncappedRiskPenalty);
  const supplyUnknown =
    input.supplyConfluenceState === "UNKNOWN" ||
    input.supplyConfluenceState === "UNAVAILABLE";
  const supplyBearish = input.supplyConfluenceState === "BEARISH";
  const investorUnknown = input.supplyProviderHealth.status !== "VERIFIED";
  const supplyProviderUnknownRootSeen = supplyUnknown || investorUnknown;
  const investorUnknownPenalty =
    investorUnknown && supplyUnknown ? 0 : investorUnknown ? -8 : 8;
  const softFailPenalty =
    input.hasGate1Blocker && !supplyProviderUnknownRootSeen ? -5 : 0;
  const resolvedWatchlistScore = resolveWatchlistUpstreamScore(input.trace);
  const watchlistNormalizedScore = resolvedWatchlistScore.normalized100;
  const watchlistWeightedScore = weightedFromNormalized(
    watchlistNormalizedScore,
    10,
  );
  const relativeStrength = normalizedRelativeStrength(
    input.trace,
    input.macroGateState,
  );
  const relativeWeightedScore = relativeStrength.weightedScore;
  const breakout = breakoutScore(input.trace);
  const volumeLiquidity = volumeLiquidityScore(input.trace);
  const priceMomentum = priceMomentumScore(input.trace);
  const technicalTrend = technicalTrendScore(input.trace);
  const components: SignalScoreComponentTrace[] = [
    component({
      code: "PRICE_MOMENTUM",
      rawValue: priceMomentum.rawValue,
      normalizedScore: priceMomentum.normalizedScore,
      weight: 1,
      weightedScore: priceMomentum.weightedScore,
      maxScore: 20,
      confidence:
        input.trace.priceDataFresh === false
          ? "STALE"
          : priceMomentum.confidence,
      providerIssue: false,
      marketSignal: false,
      penaltyApplied: input.trace.priceDataFresh === false,
      penaltyReason:
        input.trace.priceDataFresh === false ? "PRICE_DATA_STALE" : undefined,
      message: priceMomentum.message,
    }),
    component({
      code: "VOLUME_LIQUIDITY",
      rawValue: volumeLiquidity.rawValue,
      normalizedScore: volumeLiquidity.normalizedScore,
      weight: 1,
      weightedScore: volumeLiquidity.weightedScore,
      maxScore: 12,
      confidence: volumeLiquidity.confidence,
      providerIssue: false,
      marketSignal: volumeLiquidity.marketSignal,
      penaltyApplied: volumeLiquidity.penaltyApplied,
      penaltyReason: volumeLiquidity.penaltyReason,
      message: volumeLiquidity.message,
    }),
    component({
      code: "TECHNICAL_TREND",
      rawValue: technicalTrend.rawValue,
      normalizedScore: technicalTrend.normalizedScore,
      weight: 1,
      weightedScore: technicalTrend.weightedScore,
      maxScore: 14,
      confidence: technicalTrend.confidence,
      providerIssue: false,
      marketSignal: false,
      penaltyApplied: false,
      message: technicalTrend.message,
    }),
    component({
      code: "RELATIVE_STRENGTH",
      rawValue: relativeStrength.rawValue,
      normalizedScore: relativeStrength.normalizedScore,
      weight: 1,
      weightedScore: relativeWeightedScore,
      maxScore: 10,
      confidence: relativeStrength.confidence,
      providerIssue: relativeStrength.providerIssue,
      marketSignal: false,
      penaltyApplied: false,
      message: relativeStrength.message,
    }),
    component({
      code: "WATCHLIST_UPSTREAM_SCORE",
      rawValue: resolvedWatchlistScore,
      normalizedScore: watchlistNormalizedScore,
      weight: 1,
      weightedScore: watchlistWeightedScore,
      maxScore: 10,
      confidence: resolvedWatchlistScore.confidence,
      providerIssue: false,
      marketSignal: false,
      penaltyApplied: false,
      message:
        resolvedWatchlistScore.confidence === "MISSING"
          ? "WATCHLIST_SCORE_MISSING"
          : resolvedWatchlistScore.message,
    }),
    component({
      code: "BREAKOUT_STRUCTURE",
      rawValue: breakout.rawValue,
      normalizedScore: breakout.normalizedScore,
      weight: 1,
      weightedScore: breakout.weightedScore,
      maxScore: 10,
      confidence: breakout.confidence,
      providerIssue: breakout.providerIssue,
      marketSignal: false,
      penaltyApplied: false,
      message: breakout.message,
    }),
    component({
      code: "WATCHLIST_PRIORITY",
      normalizedScore: input.trace.symbol === "UNIVERSE_SUMMARY" ? 0 : 8,
      weight: 1,
      weightedScore: input.trace.symbol === "UNIVERSE_SUMMARY" ? 0 : 8,
      maxScore: 8,
      confidence:
        input.trace.symbol === "UNIVERSE_SUMMARY" ? "MISSING" : "VERIFIED",
      providerIssue: false,
      marketSignal: false,
      penaltyApplied: input.trace.symbol === "UNIVERSE_SUMMARY",
      penaltyReason:
        input.trace.symbol === "UNIVERSE_SUMMARY"
          ? "WATCHLIST_MISSING"
          : undefined,
      message: "Watchlist row priority contribution.",
    }),
    component({
      code: "SUPPLY_CONFLUENCE",
      rawValue: input.supplyConfluenceState,
      normalizedScore:
        input.supplyConfluenceState === "BULLISH"
          ? 8
          : input.supplyConfluenceState === "NEUTRAL"
            ? 4
            : 0,
      weight: 1,
      weightedScore:
        input.supplyConfluenceState === "BULLISH"
          ? 8
          : input.supplyConfluenceState === "NEUTRAL"
            ? 4
            : supplyBearish
              ? -10
              : supplyUnknown
                ? -10
                : 0,
      maxScore: 8,
      confidence: supplyUnknown ? "UNKNOWN" : "VERIFIED",
      providerIssue: supplyUnknown,
      marketSignal: supplyBearish,
      penaltyApplied: supplyUnknown || supplyBearish,
      penaltyReason: supplyBearish
        ? "ACTUAL_BEARISH_SUPPLY"
        : supplyUnknown
          ? "UNKNOWN_SUPPLY_CONFLUENCE_CONFIDENCE_PENALTY_NOT_BEARISH"
          : undefined,
      message: supplyUnknown
        ? "UNKNOWN supply confluence is penalized for confidence only; it is not bearish-equivalent."
        : "Supply confluence contribution.",
    }),
    component({
      code: "INVESTOR_FLOW",
      rawValue: input.supplyProviderHealth.status,
      normalizedScore: investorUnknown ? 0 : 8,
      weight: 1,
      weightedScore: investorUnknownPenalty,
      maxScore: 8,
      confidence: investorUnknown
        ? input.supplyProviderHealth.status === "NO_RECENT_SAMPLE"
          ? "STALE"
          : "UNKNOWN"
        : "VERIFIED",
      providerIssue: investorUnknown,
      marketSignal: false,
      penaltyApplied: investorUnknownPenalty < 0,
      penaltyReason:
        investorUnknownPenalty < 0
          ? "PROVIDER_ISSUE_INVESTOR_FLOW_UNKNOWN_NOT_MARKET_WEAKNESS"
          : undefined,
      message:
        investorUnknown && supplyUnknown
          ? "Investor-flow UNKNOWN shares SUPPLY_PROVIDER_UNKNOWN root cause with supply confluence; diagnostic-only to avoid duplicate signal-score penalty."
          : investorUnknown
            ? "Investor-flow UNKNOWN/STALE is provider issue, not market bearishness."
            : "Investor-flow sample verified.",
    }),
    component({
      code: "SECTOR_ENERGY",
      rawValue: input.trace.sectorEnergyState,
      normalizedScore: input.hasSectorEnergyDiagnostic ? 0 : 2,
      weight: 1,
      weightedScore: input.hasSectorEnergyDiagnostic ? -2 : 2,
      maxScore: 2,
      confidence: input.hasSectorEnergyDiagnostic
        ? "DIAGNOSTIC_ONLY"
        : "VERIFIED",
      providerIssue: input.hasSectorEnergyDiagnostic,
      marketSignal: false,
      penaltyApplied: input.hasSectorEnergyDiagnostic,
      penaltyReason: input.hasSectorEnergyDiagnostic
        ? "SECTOR_ENERGY_DIAGNOSTIC_STRONG_BUY_ONLY"
        : undefined,
      message: input.hasSectorEnergyDiagnostic
        ? "SectorEnergy diagnostic penalty is advisory/STRONG_BUY_ONLY scoped."
        : "SectorEnergy confidence verified.",
    }),
    component({
      code: "MARKET_REGIME",
      rawValue: input.regime,
      normalizedScore: input.macroGateState?.emergencyStop ? 0 : 6,
      weight: 1,
      weightedScore: input.macroGateState?.emergencyStop ? -6 : 6,
      maxScore: 6,
      confidence: "VERIFIED",
      providerIssue: false,
      marketSignal: Boolean(input.macroGateState?.emergencyStop),
      penaltyApplied: Boolean(input.macroGateState?.emergencyStop),
      penaltyReason: input.macroGateState?.emergencyStop
        ? "EMERGENCY_STOP"
        : undefined,
      message:
        "Market regime contribution; emergency stop is the hard risk signal.",
    }),
    component({
      code: "SESSION_STATUS",
      rawValue: input.marketSession,
      normalizedScore: 0,
      weight: 0,
      weightedScore: 0,
      maxScore: 0,
      confidence:
        input.marketSession === "SELL_ONLY" ? "DIAGNOSTIC_ONLY" : "VERIFIED",
      providerIssue: false,
      marketSignal: false,
      penaltyApplied: false,
      message:
        "Session status is execution eligibility only; SELL_ONLY must not reduce signal score.",
    }),
    component({
      code: "RISK_PENALTY",
      rawValue: { riskMultiplier, uncappedRiskPenalty },
      normalizedScore: riskPenalty,
      weight: 1,
      weightedScore: riskPenalty,
      maxScore: 0,
      confidence: riskPenalty < 0 ? "DIAGNOSTIC_ONLY" : "VERIFIED",
      providerIssue: false,
      marketSignal: riskPenalty < 0,
      penaltyApplied: riskPenalty < 0,
      penaltyReason:
        riskPenalty < 0
          ? "REGIME_RISK_SIGNAL_SCORE_CAPPED_SIZING_PRIMARY"
          : undefined,
      message:
        "Regime risk primarily applied at Kelly sizing; signal penalty capped to avoid double count.",
    }),
    component({
      code: "SOFT_FAIL_PENALTY",
      rawValue: {
        hasGate1Blocker: input.hasGate1Blocker,
        supplyProviderUnknownRootSeen,
      },
      normalizedScore: softFailPenalty,
      weight: 1,
      weightedScore: softFailPenalty,
      maxScore: 0,
      confidence:
        input.hasGate1Blocker && supplyProviderUnknownRootSeen
          ? "DIAGNOSTIC_ONLY"
          : softFailPenalty < 0
            ? "DEGRADED"
            : "VERIFIED",
      providerIssue: input.hasGate1Blocker && supplyProviderUnknownRootSeen,
      marketSignal: false,
      penaltyApplied: softFailPenalty < 0,
      penaltyReason:
        softFailPenalty < 0 ? "LEGACY_GATE1_SOFT_FAIL_ACCUMULATION" : undefined,
      message:
        input.hasGate1Blocker && supplyProviderUnknownRootSeen
          ? "Soft-fail aggregate shares SUPPLY_PROVIDER_UNKNOWN root cause and is diagnostic-only to avoid duplicate signal-score penalty."
          : "Legacy Gate1 aggregate soft fail penalty is separated from hard risk.",
    }),
  ];
  const computedScore = round1(
    components.reduce((sum, c) => sum + c.weightedScore, 0),
  );
  const actualScore = computedScore;
  const positiveScoreTotal = round1(
    components
      .filter((c) => c.weightedScore > 0)
      .reduce((sum, c) => sum + c.weightedScore, 0),
  );
  const penaltyTotal = round1(
    components
      .filter((c) => c.weightedScore < 0)
      .reduce((sum, c) => sum + c.weightedScore, 0),
  );
  const unknownPenaltyTotal = round1(
    components
      .filter(
        (c) =>
          c.penaltyApplied &&
          ["UNKNOWN", "MISSING", "STALE"].includes(c.confidence),
      )
      .reduce((sum, c) => sum + c.weightedScore, 0),
  );
  const providerIssuePenaltyTotal = round1(
    components
      .filter((c) => c.providerIssue && c.weightedScore < 0)
      .reduce((sum, c) => sum + c.weightedScore, 0),
  );
  const sessionPenaltyTotal = round1(
    components
      .filter((c) => c.code === "SESSION_STATUS" && c.weightedScore < 0)
      .reduce((sum, c) => sum + c.weightedScore, 0),
  );
  const sectorPenaltyTotal = round1(
    components
      .filter((c) => c.code === "SECTOR_ENERGY" && c.weightedScore < 0)
      .reduce((sum, c) => sum + c.weightedScore, 0),
  );
  const riskPenaltyTotal = round1(
    components
      .filter((c) => c.code === "RISK_PENALTY" && c.weightedScore < 0)
      .reduce((sum, c) => sum + c.weightedScore, 0),
  );
  const softFailPenaltyTotal = round1(
    components
      .filter((c) => c.code === "SOFT_FAIL_PENALTY" && c.weightedScore < 0)
      .reduce((sum, c) => sum + c.weightedScore, 0),
  );
  const scoreGap = round1(actualScore - requiredScore);
  const passAt = (delta: number) =>
    round1(actualScore - delta) >= requiredScore;
  return {
    symbol: input.trace.symbol,
    name: input.trace.name,
    requiredScore,
    actualScore: round1(actualScore),
    scoreGap,
    passed: actualScore >= requiredScore,
    components,
    positiveScoreTotal,
    penaltyTotal,
    unknownPenaltyTotal,
    providerIssuePenaltyTotal,
    sessionPenaltyTotal,
    sectorPenaltyTotal,
    riskPenaltyTotal,
    softFailPenaltyTotal,
    topMissingContributors: components
      .filter((c) =>
        ["UNKNOWN", "MISSING", "STALE", "DIAGNOSTIC_ONLY"].includes(
          c.confidence,
        ),
      )
      .map((c) => c.code)
      .slice(0, 5),
    topPenaltyContributors: components
      .filter((c) => c.weightedScore < 0)
      .sort((a, b) => a.weightedScore - b.weightedScore)
      .map((c) => c.code)
      .slice(0, 5),
    wouldPassIfUnknownNeutral: passAt(unknownPenaltyTotal),
    wouldPassIfProviderPenaltyRemoved: passAt(providerIssuePenaltyTotal),
    wouldPassIfSessionPenaltyRemoved: passAt(sessionPenaltyTotal),
    wouldPassIfRiskPenaltyCapped: passAt(Math.min(riskPenaltyTotal, -3)),
    wouldPassIfSectorPenaltyRemoved: passAt(sectorPenaltyTotal),
    wouldPassIfSoftFailPenaltyRemoved: passAt(softFailPenaltyTotal),
  };
}

export function buildUnknownDataTreatmentAudit(
  trace: MinimumSignalScoreTrace,
): UnknownDataTreatmentAudit {
  const unknownFields = trace.components
    .filter((c) =>
      ["UNKNOWN", "MISSING", "STALE", "DIAGNOSTIC_ONLY"].includes(c.confidence),
    )
    .map((c) => {
      const treatment: UnknownDataTreatment =
        c.marketSignal && c.providerIssue
          ? "BEARISH_EQUIVALENT"
          : c.weightedScore < 0
            ? "PENALTY"
            : c.weightedScore === 0
              ? "NEUTRAL"
              : "EXCLUDED_FROM_DENOMINATOR";
      return {
        field: c.code,
        treatment,
        scoreImpact: c.weightedScore,
        allowed: treatment !== "BEARISH_EQUIVALENT",
        message:
          treatment === "BEARISH_EQUIVALENT"
            ? `${c.code} UNKNOWN is being treated as bearish-equivalent; audit warning required.`
            : `${c.code} ${c.confidence} treatment=${treatment}; providerIssue=${c.providerIssue}, marketSignal=${c.marketSignal}.`,
      };
    });
  return {
    symbol: trace.symbol,
    unknownFields,
    hasBearishEquivalentUnknown: unknownFields.some(
      (f) => f.treatment === "BEARISH_EQUIVALENT",
    ),
    totalUnknownScoreImpact: round1(
      unknownFields.reduce((sum, f) => sum + f.scoreImpact, 0),
    ),
  };
}

function softFailCodeForCondition(
  condition: Gate1ConditionTrace,
  minTrace: MinimumSignalScoreTrace,
): SoftFailCode {
  if (condition.code === "MIN_SIGNAL_SCORE_PASS") return "MIN_SIGNAL_GAP";
  if (condition.code === "TRADING_SESSION_PASS") return "SESSION_SOFT_BLOCK";
  if (condition.code === "SUPPLY_CONFLUENCE_PASS") return "SUPPLY_UNKNOWN";
  if (
    condition.code === "SUPPLY_PROVIDER_HEALTH_PASS" ||
    condition.code === "INVESTOR_FLOW_SAMPLE_PASS"
  )
    return "PROVIDER_UNKNOWN";
  if (condition.code === "SECTOR_ENERGY_CONFIDENCE_PASS")
    return "SECTOR_DIAGNOSTIC";
  if (condition.code === "PRICE_DATA_FRESH_PASS") return "DATA_STALE";
  if (condition.code === "RISK_BLOCK_PASS") return "RISK_PENALTY";
  return "OTHER";
}

export function buildSoftFailAccumulationTrace(input: {
  symbol: string;
  conditions: Gate1ConditionTrace[];
  minSignalScoreTrace: MinimumSignalScoreTrace;
  threshold: number;
}): SoftFailAccumulationTrace {
  const softFails = input.conditions
    .filter(
      (c) =>
        !c.passed &&
        (c.severity === "SOFT_FAIL" || c.severity === "DIAGNOSTIC_ONLY"),
    )
    .map((c) => ({
      code: softFailCodeForCondition(c, input.minSignalScoreTrace),
      weight: c.severity === "DIAGNOSTIC_ONLY" ? 0.5 : 1,
      severityScore: c.severity === "DIAGNOSTIC_ONLY" ? 0.5 : 1,
      reason: c.message,
      providerIssue: c.providerIssue,
      marketSignal: c.marketSignal,
    }));
  const totalSoftFailScore = round1(
    softFails.reduce((sum, f) => sum + f.weight * f.severityScore, 0),
  );
  const without = (predicate: (code: SoftFailCode) => boolean) =>
    round1(
      softFails
        .filter((f) => !predicate(f.code))
        .reduce((sum, f) => sum + f.weight * f.severityScore, 0),
    ) < input.threshold;
  return {
    symbol: input.symbol,
    softFails,
    totalSoftFailScore,
    softFailThreshold: input.threshold,
    failedBySoftAccumulation: totalSoftFailScore >= input.threshold,
    wouldPassIfProviderSoftFailsExcluded: without(
      (code) => code === "PROVIDER_UNKNOWN" || code === "SUPPLY_UNKNOWN",
    ),
    wouldPassIfSessionSoftFailsExcluded: without(
      (code) => code === "SESSION_SOFT_BLOCK",
    ),
    wouldPassIfSectorSoftFailsExcluded: without(
      (code) => code === "SECTOR_DIAGNOSTIC",
    ),
    wouldPassIfRiskSoftFailsCapped: without((code) => code === "RISK_PENALTY"),
  };
}

export function buildRiskPenaltyTrace(input: {
  symbol: string;
  macroGateState?: MacroGateState;
  minSignalScoreTrace: MinimumSignalScoreTrace;
}): RiskPenaltyTrace {
  const regimeMultiplier = input.macroGateState?.kellyMultiplierFromRegime ?? 1;
  const fomcMultiplier = input.macroGateState?.fomcKellyMultiplier ?? 1;
  const sectorMultiplier = 1;
  const riskMultiplier =
    input.macroGateState?.finalKellyMultiplier !== undefined
      ? input.macroGateState.finalKellyMultiplier /
        Math.max(0.000001, regimeMultiplier * fomcMultiplier)
      : 1;
  const finalKelly =
    regimeMultiplier * fomcMultiplier * sectorMultiplier * riskMultiplier;
  const signalScoreRiskPenalty = input.minSignalScoreTrace.riskPenaltyTotal;
  const sizingRiskPenalty =
    riskMultiplier < 1 ? round1((1 - riskMultiplier) * 100) : 0;
  return {
    symbol: input.symbol,
    regimeMultiplier,
    fomcMultiplier,
    sectorMultiplier,
    riskMultiplier,
    finalKelly,
    signalScoreRiskPenalty,
    sizingRiskPenalty,
    doubleCountWarning: signalScoreRiskPenalty < 0 && sizingRiskPenalty > 0,
    wouldPassIfRiskPenaltyCapped:
      input.minSignalScoreTrace.wouldPassIfRiskPenaltyCapped,
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return round1(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function buildMinSignalScoreDecompositionReport(input: {
  nowIso: string;
  forDate: string;
  regime: string;
  marketSession: string;
  traces: Gate1CandidateTrace[];
}): MinSignalScoreDecompositionReport {
  const minTraces = input.traces
    .map((t) => t.minSignalScoreTrace)
    .filter((t): t is MinimumSignalScoreTrace => Boolean(t));
  const penaltyByCode = new Map<
    SignalScoreComponentCode,
    { total: number; count: number }
  >();
  const deficitByCode = new Map<
    SignalScoreComponentCode,
    { total: number; count: number }
  >();
  for (const trace of minTraces) {
    for (const c of trace.components) {
      if (c.weightedScore < 0) {
        const current = penaltyByCode.get(c.code) ?? { total: 0, count: 0 };
        current.total += c.weightedScore;
        current.count += 1;
        penaltyByCode.set(c.code, current);
      }
      if (c.confidence !== "VERIFIED" || c.weightedScore <= 0) {
        const current = deficitByCode.get(c.code) ?? { total: 0, count: 0 };
        current.total += c.weightedScore;
        current.count += 1;
        deficitByCode.set(c.code, current);
      }
    }
  }
  const unknownTreatmentWarnings = input.traces
    .map((t) => t.unknownDataTreatmentAudit)
    .filter((a): a is UnknownDataTreatmentAudit => Boolean(a))
    .filter((a) => a.hasBearishEquivalentUnknown).length;
  const sessionPenaltyCount = minTraces.filter(
    (t) => t.sessionPenaltyTotal < 0,
  ).length;
  const riskDoubleCountWarnings = input.traces.filter(
    (t) => t.riskPenaltyTrace?.doubleCountWarning,
  ).length;
  const softAccumulationFailures = input.traces.filter(
    (t) => t.softFailAccumulationTrace?.failedBySoftAccumulation,
  ).length;
  return {
    timestamp: input.nowIso,
    forDate: input.forDate,
    regime: input.regime,
    marketSession: input.marketSession,
    totalCandidates: minTraces.length,
    minSignalFailed: minTraces.filter((t) => !t.passed).length,
    requiredScoreAvg: average(minTraces.map((t) => t.requiredScore)),
    actualScoreAvg: average(minTraces.map((t) => t.actualScore)),
    actualScoreMin:
      minTraces.length > 0
        ? Math.min(...minTraces.map((t) => t.actualScore))
        : 0,
    actualScoreMax:
      minTraces.length > 0
        ? Math.max(...minTraces.map((t) => t.actualScore))
        : 0,
    avgScoreGap: average(minTraces.map((t) => t.scoreGap)),
    topScoreDeficits: Array.from(deficitByCode.entries())
      .map(([code, value]) => ({
        code,
        avgImpact: round1(value.total / value.count),
        affectedCount: value.count,
      }))
      .sort(
        (a, b) =>
          a.avgImpact - b.avgImpact || b.affectedCount - a.affectedCount,
      )
      .slice(0, 5),
    topPenaltyContributors: Array.from(penaltyByCode.entries())
      .map(([code, value]) => ({
        code,
        avgPenalty: round1(value.total / value.count),
        affectedCount: value.count,
      }))
      .sort(
        (a, b) =>
          a.avgPenalty - b.avgPenalty || b.affectedCount - a.affectedCount,
      )
      .slice(0, 5),
    unknownTreatmentWarnings,
    wouldPassIfUnknownNeutral: minTraces.filter(
      (t) => t.wouldPassIfUnknownNeutral,
    ).length,
    wouldPassIfProviderPenaltyRemoved: minTraces.filter(
      (t) => t.wouldPassIfProviderPenaltyRemoved,
    ).length,
    wouldPassIfSessionPenaltyRemoved: minTraces.filter(
      (t) => t.wouldPassIfSessionPenaltyRemoved,
    ).length,
    wouldPassIfRiskPenaltyCapped: minTraces.filter(
      (t) => t.wouldPassIfRiskPenaltyCapped,
    ).length,
    wouldPassIfSoftFailPenaltyRemoved: minTraces.filter(
      (t) => t.wouldPassIfSoftFailPenaltyRemoved,
    ).length,
    recommendedAction:
      unknownTreatmentWarnings > 0
        ? "FIX_UNKNOWN_TREATMENT"
        : sessionPenaltyCount > 0
          ? "REMOVE_SESSION_FROM_SIGNAL_SCORE"
          : riskDoubleCountWarnings > 0
            ? "CAP_RISK_PENALTY"
            : softAccumulationFailures > 0
              ? "REVIEW_SOFT_FAIL_ACCUMULATION"
              : minTraces.some((t) => !t.passed)
                ? "REVIEW_MIN_SIGNAL_THRESHOLD"
                : "NO_ACTION",
  };
}

export function buildSignalScoreCalibrationResults(input: {
  regime: string;
  traces: Gate1CandidateTrace[];
}): SignalScoreCalibrationResult[] {
  const minTraces = input.traces
    .map((t) => t.minSignalScoreTrace)
    .filter((t): t is MinimumSignalScoreTrace => Boolean(t));
  const scenarioDelta = (
    trace: MinimumSignalScoreTrace,
    scenario: SignalScoreCalibrationScenario,
  ): { adjustedScore: number; reason: string[] } => {
    switch (scenario) {
      case "UNKNOWN_NEUTRAL":
        return {
          adjustedScore: round1(trace.actualScore - trace.unknownPenaltyTotal),
          reason: ["UNKNOWN_NEUTRAL_ADVISORY_ONLY"],
        };
      case "PROVIDER_PENALTY_REMOVED":
        return {
          adjustedScore: round1(
            trace.actualScore - trace.providerIssuePenaltyTotal,
          ),
          reason: ["PROVIDER_PENALTY_REMOVED_ADVISORY_ONLY"],
        };
      case "SESSION_PENALTY_REMOVED":
        return {
          adjustedScore: round1(trace.actualScore - trace.sessionPenaltyTotal),
          reason: ["SESSION_PENALTY_REMOVED_ADVISORY_ONLY"],
        };
      case "RISK_PENALTY_CAPPED":
        return {
          adjustedScore: round1(
            trace.actualScore - Math.min(trace.riskPenaltyTotal, -3),
          ),
          reason: ["RISK_PENALTY_CAPPED_ADVISORY_ONLY"],
        };
      case "SECTOR_PENALTY_REMOVED":
        return {
          adjustedScore: round1(trace.actualScore - trace.sectorPenaltyTotal),
          reason: ["SECTOR_PENALTY_REMOVED_ADVISORY_ONLY"],
        };
      case "SOFT_FAIL_PENALTY_REMOVED":
        return {
          adjustedScore: round1(trace.actualScore - trace.softFailPenaltyTotal),
          reason: ["SOFT_FAIL_PENALTY_REMOVED_ADVISORY_ONLY"],
        };
      case "MIN_SIGNAL_THRESHOLD_MINUS_5":
        return {
          adjustedScore: trace.actualScore,
          reason: ["THRESHOLD_MINUS_5_ADVISORY_ONLY"],
        };
      case "MIN_SIGNAL_THRESHOLD_MINUS_10":
        return {
          adjustedScore: trace.actualScore,
          reason: ["THRESHOLD_MINUS_10_ADVISORY_ONLY"],
        };
      case "R3_EARLY_ADAPTIVE_THRESHOLD":
        return {
          adjustedScore: trace.actualScore,
          reason: ["R3_EARLY_ADAPTIVE_THRESHOLD_ADVISORY_ONLY"],
        };
    }
  };
  const requiredFor = (
    trace: MinimumSignalScoreTrace,
    scenario: SignalScoreCalibrationScenario,
  ): number => {
    if (scenario === "MIN_SIGNAL_THRESHOLD_MINUS_5")
      return trace.requiredScore - 5;
    if (scenario === "MIN_SIGNAL_THRESHOLD_MINUS_10")
      return trace.requiredScore - 10;
    if (scenario === "R3_EARLY_ADAPTIVE_THRESHOLD")
      return input.regime === "R3_EARLY"
        ? trace.requiredScore - 7
        : trace.requiredScore;
    return trace.requiredScore;
  };
  const scenarios: SignalScoreCalibrationScenario[] = [
    "UNKNOWN_NEUTRAL",
    "PROVIDER_PENALTY_REMOVED",
    "SESSION_PENALTY_REMOVED",
    "RISK_PENALTY_CAPPED",
    "SECTOR_PENALTY_REMOVED",
    "SOFT_FAIL_PENALTY_REMOVED",
    "MIN_SIGNAL_THRESHOLD_MINUS_5",
    "MIN_SIGNAL_THRESHOLD_MINUS_10",
    "R3_EARLY_ADAPTIVE_THRESHOLD",
  ];
  return scenarios.map((scenario) => {
    const survivors = minTraces
      .map((trace) => ({
        trace,
        ...scenarioDelta(trace, scenario),
        required: requiredFor(trace, scenario),
      }))
      .filter((x) => x.adjustedScore >= x.required);
    return {
      scenario,
      hypotheticalSurvivors: survivors.length,
      survivorExamples: survivors.slice(0, 5).map((x) => ({
        symbol: x.trace.symbol,
        name: x.trace.name,
        actualScore: x.trace.actualScore,
        adjustedScore: x.adjustedScore,
        requiredScore: x.required,
        reason: x.reason,
      })),
      executionImpact: "NONE",
    };
  });
}
