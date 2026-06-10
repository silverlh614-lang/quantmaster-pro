// @responsibility Gate1 최소신호점수 분해 집계 리포트와 calibration 시나리오 산출 (advisory-only, executionImpact NONE).

import type { Gate1CandidateTrace } from "../entryFilterDecomposition.js";
import type {
  SignalScoreComponentCode,
  MinimumSignalScoreTrace,
  UnknownDataTreatmentAudit,
  SignalScoreCalibrationScenario,
  SignalScoreCalibrationResult,
  MinSignalScoreDecompositionReport,
} from "./types.js";
import { round1 } from "./scoring.js";

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
