/**
 * @responsibility ADR-0466 Minimum Signal Score Decomposition diagnostics.
 *
 * Counterfactual/advisory-only score tracing for Gate1 minimum signal score.
 * Does not relax thresholds, route orders, or mutate trading state.
 */
import type { MacroGateState } from "./scanDiagnostics.js";
import { loadTradingSettings } from '../../persistence/tradingSettingsRepo.js';
import { resolveWatchlistUpstreamScore } from "./watchlistUpstreamScoreResolver.js";
import type {
  CandidateEntryTrace,
  Gate1ConditionTrace,
  SupplyConfluenceState,
  SupplyProviderHealthTrace,
} from "./entryFilterDecomposition.js";
import { nestedNumericTraceValue } from "./minimumSignalScoreTrace/traceFieldResolver.js";
import {
  normalizedRelativeStrength,
  volumeLiquidityScore,
  breakoutScore,
  priceMomentumScore,
  technicalTrendScore,
} from "./minimumSignalScoreTrace/componentScorers.js";
import type {
  SignalScoreComponentTrace,
  MinimumSignalScoreTrace,
  UnknownDataTreatment,
  UnknownDataTreatmentAudit,
  SoftFailCode,
  SoftFailAccumulationTrace,
  RiskPenaltyTrace,
} from "./minimumSignalScoreTrace/types.js";
import {
  round1,
  weightedFromNormalized,
} from "./minimumSignalScoreTrace/scoring.js";

export * from "./minimumSignalScoreTrace/types.js";
export {
  normalizeSignalScoreTo100,
  scoreRelativeStrength,
} from "./minimumSignalScoreTrace/scoring.js";
export {
  buildMinSignalScoreDecompositionReport,
  buildSignalScoreCalibrationResults,
} from "./minimumSignalScoreTrace/decompositionReport.js";

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
  const requiredScore = input.trace.minSignalRequiredScore
    ?? loadTradingSettings().buyCondition.minScoreThreshold;
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
  const priceMomentum = priceMomentumScore(input.trace, input.regime);
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
      normalizedScore: (!input.trace.symbol || input.trace.symbol === "UNIVERSE_SUMMARY") ? 0 : 8,
      weight: 1,
      weightedScore: (!input.trace.symbol || input.trace.symbol === "UNIVERSE_SUMMARY") ? 0 : 8,
      maxScore: 8,
      confidence:
        (!input.trace.symbol || input.trace.symbol === "UNIVERSE_SUMMARY") ? "MISSING" : "VERIFIED",
      providerIssue: false,
      marketSignal: false,
      penaltyApplied: (!input.trace.symbol || input.trace.symbol === "UNIVERSE_SUMMARY"),
      penaltyReason:
        (!input.trace.symbol || input.trace.symbol === "UNIVERSE_SUMMARY")
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
              // 불변식 #6: UNKNOWN/UNAVAILABLE 수급(provider 장애·데이터 없음)은 점수
              // 페널티가 아니라 confidence 강등(confidence=UNKNOWN)만 — bearish 로 변환 금지.
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
        ? "SECTOR_ENERGY_DIAGNOSTIC_SCORE_ONLY"
        : undefined,
      message: input.hasSectorEnergyDiagnostic
        ? "SectorEnergy diagnostic penalty is advisory score-only evidence."
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
    // Patch-B: ADR-0467 ADVISORY_SIGNAL 범위 — contributesTo:'ADVISORY_ONLY'.
    // Gate1 hard block 미관여, LIVE 매매 경로 byte-equivalent 보존.
    // 입력 필드 없으면 confidence=MISSING, score=0 (graceful missing).
    component({
      code: "SECTOR_RELATIVE_STRENGTH",
      rawValue: nestedNumericTraceValue(input.trace, [
        "rsRankPct",
        "sectorRelativeReturn20d",
        "featurePack.momentum.rsRankPct",
        "featurePack.momentum.sectorRelativeReturn20d",
        "quoteFeatures.rsRankPct",
        "quoteFeatures.sectorRelativeReturn20d",
      ]),
      normalizedScore: 0,
      weight: 0,
      weightedScore: 0,
      maxScore: 0,
      confidence: (() => {
        const v = nestedNumericTraceValue(input.trace, [
          "rsRankPct",
          "sectorRelativeReturn20d",
          "featurePack.momentum.rsRankPct",
          "featurePack.momentum.sectorRelativeReturn20d",
          "quoteFeatures.rsRankPct",
          "quoteFeatures.sectorRelativeReturn20d",
        ]);
        return v !== undefined ? "DIAGNOSTIC_ONLY" : "MISSING";
      })(),
      providerIssue: false,
      marketSignal: false,
      penaltyApplied: false,
      message:
        "SECTOR_RELATIVE_STRENGTH is advisory-only (ADR-0467); score=0, Gate1 hard block 미관여.",
    }),
    component({
      code: "GHOST_SIGNAL_STRENGTH",
      rawValue: nestedNumericTraceValue(input.trace, [
        "ghostSignalScore",
        "counterfactualScore",
        "ghostLearningScore",
        "shadowLearningScore",
        "featurePack.ghost.score",
        "featurePack.counterfactual.score",
      ]),
      normalizedScore: 0,
      weight: 0,
      weightedScore: 0,
      maxScore: 0,
      confidence: (() => {
        const v = nestedNumericTraceValue(input.trace, [
          "ghostSignalScore",
          "counterfactualScore",
          "ghostLearningScore",
          "shadowLearningScore",
          "featurePack.ghost.score",
          "featurePack.counterfactual.score",
        ]);
        return v !== undefined ? "DIAGNOSTIC_ONLY" : "MISSING";
      })(),
      providerIssue: false,
      marketSignal: false,
      penaltyApplied: false,
      message:
        "GHOST_SIGNAL_STRENGTH is advisory-only (ADR-0467); score=0, Gate1 hard block 미관여.",
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
