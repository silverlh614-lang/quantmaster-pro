/**
 * @responsibility ADR-0464 Gate1 candidate trace builder.
 */

import type {
  MacroGateState,
  WaitDistribution,
  GatePassDistribution,
} from "../scanDiagnostics.js";
import {
  buildMinimumSignalScoreTrace,
  buildMinSignalScoreDecompositionReport,
  buildRiskPenaltyTrace,
  buildSignalScoreCalibrationResults,
  buildSoftFailAccumulationTrace,
  buildUnknownDataTreatmentAudit,
  type MinimumSignalScoreTrace,
  type MinSignalScoreDecompositionReport,
  type RiskPenaltyTrace,
  type SignalScoreCalibrationResult,
  type SoftFailAccumulationTrace,
  type UnknownDataTreatmentAudit,
} from "../minimumSignalScoreTrace.js";
import {
  buildEntryDecisionLedgerScoreCeilingRepairSummaryFromScore,
  type EntryDecisionLedgerScoreCeilingRepairSummary,
} from "../gate1ScoreCeilingRepair.js";
import {
  buildEntryDecisionLedgerPenaltyDedupSummaryFromScore,
  type EntryDecisionLedgerPenaltyDedupSummary,
} from "../gate1PenaltyDeduplication.js";
import {
  buildEntryDecisionLedgerRiskDoubleCountSummaryFromScore,
  type EntryDecisionLedgerRiskDoubleCountSummary,
} from "../gate1RiskDoubleCount.js";
import {
  buildEntryDecisionLedgerFinalCalibrationSummaryFromScore,
  type EntryDecisionLedgerFinalCalibrationSummary,
} from "../gate1FinalCalibration.js";
import {
  buildEntryDecisionLedgerPositiveSourceWiringSummaryFromScore,
  type EntryDecisionLedgerPositiveSourceWiringSummary,
} from "../gate1PositiveSourceWiringAdr0475.js";
import {
  resolveWatchlistUpstreamScore,
  type ResolvedWatchlistUpstreamScore,
} from "../watchlistUpstreamScoreResolver.js";
import type { GateConditionResultTrace } from "../gateConditionResultTrace.js";
import type { SanitizedInvestorFlowSemanticRow } from "../../../supply/investorFlowSemanticAvailability.js";
import type {
  CandidateEntryTrace,
  Gate1CandidateTrace,
  Gate1ConditionTrace,
  Gate1DecompositionReport,
  Gate1CounterfactualSurvivorReport,
  SupplyConfluenceState,
  SupplyProviderHealthTrace,
} from './types.js';
import { GATE1_PROVIDER_ISSUE_SOFT_FAIL_ENABLED } from './types.js';
import {
  hasExecutionBlocker,
  isGreenish,
  isRiskOff,
  makeCondition,
} from './sharedHelpers.js';
import {
  canPassIgnoring,
  conditionBlocksGate1,
  countByCondition,
} from './supplyProviderHealth.js';

export function buildGate1CandidateTrace(input: {
  trace: CandidateEntryTrace;
  regime: string;
  marketSession: string;
  macroGateState?: MacroGateState;
  supplyProviderHealth: SupplyProviderHealthTrace;
  supplyConfluenceState: SupplyConfluenceState;
  gate1SoftFailThreshold: number;
}): Gate1CandidateTrace {
  const {
    trace,
    regime,
    marketSession,
    macroGateState,
    supplyProviderHealth,
    supplyConfluenceState,
  } = input;
  const conditions: Gate1ConditionTrace[] = [];
  const hasGate1Blocker = trace.blockers.some((b) => b.category === "GATE1");
  const hasSectorEnergyDiagnostic = trace.blockers.some(
    (b) => b.category === "SECTOR_ENERGY",
  );
  conditions.push(
    makeCondition({
      code: "MARKET_REGIME_PASS",
      passed: !macroGateState?.emergencyStop,
      severity: macroGateState?.emergencyStop ? "HARD_FAIL" : "INFO",
      message: macroGateState?.emergencyStop
        ? "Emergency stop blocks Gate1 execution eligibility."
        : "Market regime did not hard-block Gate1 signal eligibility.",
      providerIssue: false,
      marketSignal: Boolean(macroGateState?.emergencyStop),
      executionBlocking: Boolean(macroGateState?.emergencyStop),
      learningBlocking: false,
      value: regime,
      source: "macroGateState",
    }),
  );
  conditions.push(
    makeCondition({
      code: "TRADING_SESSION_PASS",
      passed: true,
      severity: "INFO",
      message: "Trading session is metadata only; Gate1 signal eligibility remains data-driven.",
      providerIssue: false,
      marketSignal: false,
      executionBlocking: false,
      learningBlocking: false,
      value: marketSession,
      expected: "NORMAL",
      source: "macroGateState.sellOnlyMode",
    }),
  );
  conditions.push(
    makeCondition({
      code: "AUTO_TRADE_ENABLED_PASS",
      passed: macroGateState?.autoTradeEnabled !== false,
      severity:
        macroGateState?.autoTradeEnabled === false ? "HARD_FAIL" : "INFO",
      message:
        macroGateState?.autoTradeEnabled === false
          ? "Auto-trade disabled by operator."
          : "Auto-trade control is enabled or unavailable.",
      providerIssue: false,
      marketSignal: false,
      executionBlocking: macroGateState?.autoTradeEnabled === false,
      learningBlocking: false,
      value: macroGateState?.autoTradeEnabled,
      expected: true,
      source: "macroGateState.autoTradeEnabled",
    }),
  );
  conditions.push(
    makeCondition({
      code: "WATCHLIST_VALID_PASS",
      passed: trace.symbol !== "UNIVERSE_SUMMARY",
      severity: trace.symbol === "UNIVERSE_SUMMARY" ? "SOFT_FAIL" : "INFO",
      message:
        trace.symbol === "UNIVERSE_SUMMARY"
          ? "No watchlist row was available for this universe summary."
          : "Watchlist candidate row exists.",
      providerIssue: false,
      marketSignal: false,
      executionBlocking: trace.symbol === "UNIVERSE_SUMMARY",
      learningBlocking: false,
      source: "entryFilterDecomposition",
    }),
  );
  conditions.push(
    makeCondition({
      code: "PRICE_DATA_FRESH_PASS",
      passed: trace.blockers.every((b) => b.code !== "PRICE_DATA_STALE"),
      severity: trace.blockers.some((b) => b.code === "PRICE_DATA_STALE")
        ? "HARD_FAIL"
        : "INFO",
      message: trace.blockers.some((b) => b.code === "PRICE_DATA_STALE")
        ? "Price data stale/missing."
        : "No price freshness blocker was recorded.",
      providerIssue: false,
      marketSignal: false,
      executionBlocking: trace.blockers.some(
        (b) => b.code === "PRICE_DATA_STALE",
      ),
      learningBlocking: false,
      source: "entryBlockers",
    }),
  );
  conditions.push(
    makeCondition({
      code: "VOLUME_LIQUIDITY_PASS",
      passed: trace.blockers.every((b) => b.code !== "LIQUIDITY_LOW"),
      severity: trace.blockers.some((b) => b.code === "LIQUIDITY_LOW")
        ? "HARD_FAIL"
        : "INFO",
      message: trace.blockers.some((b) => b.code === "LIQUIDITY_LOW")
        ? "Absolute liquidity minimum failed."
        : "No absolute liquidity blocker was recorded.",
      providerIssue: false,
      marketSignal: trace.blockers.some((b) => b.code === "LIQUIDITY_LOW"),
      executionBlocking: trace.blockers.some((b) => b.code === "LIQUIDITY_LOW"),
      learningBlocking: false,
      source: "entryBlockers",
    }),
  );
  const supplyProviderPassed = supplyProviderHealth.status === "VERIFIED";
  const supplySeverity =
    supplyProviderHealth.gate1Severity === "NONE"
      ? "INFO"
      : supplyProviderHealth.gate1Severity;
  conditions.push(
    makeCondition({
      code: "SUPPLY_PROVIDER_HEALTH_PASS",
      passed: supplyProviderPassed,
      severity: supplySeverity,
      message: supplyProviderHealth.reason.join("; "),
      providerIssue: supplyProviderHealth.providerIssue,
      marketSignal: supplyProviderHealth.marketSignal,
      executionBlocking: supplyProviderHealth.gate1Severity === "HARD_FAIL",
      learningBlocking: false,
      value: supplyProviderHealth.status,
      expected: "VERIFIED",
      source: supplyProviderHealth.providerName,
    }),
  );
  conditions.push(
    makeCondition({
      code: "INVESTOR_FLOW_SAMPLE_PASS",
      passed:
        supplyProviderHealth.status === "VERIFIED" ||
        (supplyProviderHealth.sampleCountRecent ?? 0) > 0,
      severity:
        supplyProviderHealth.status === "NO_RECENT_SAMPLE" ||
        supplyProviderHealth.status === "EMPTY"
          ? "SOFT_FAIL"
          : supplySeverity,
      message:
        supplyProviderHealth.status === "NO_RECENT_SAMPLE"
          ? "Investor-flow sample is missing/too old; classify as provider issue, not bearish supply."
          : "Investor-flow sample status recorded.",
      providerIssue: supplyProviderHealth.providerIssue,
      marketSignal: false,
      executionBlocking: false,
      learningBlocking: false,
      value: {
        lastSampleAt: supplyProviderHealth.lastSampleAt ?? "unknown",
        ageMinutes: supplyProviderHealth.ageMinutes,
        expectedMaxAgeMinutes: supplyProviderHealth.expectedMaxAgeMinutes,
      },
      expected: { sampleCountRecent: ">0" },
      source: supplyProviderHealth.providerName,
    }),
  );
  conditions.push(
    makeCondition({
      code: "SUPPLY_CONFLUENCE_PASS",
      passed:
        supplyConfluenceState !== "BEARISH" &&
        supplyConfluenceState !== "UNAVAILABLE" &&
        supplyConfluenceState !== "UNKNOWN",
      severity:
        supplyConfluenceState === "BEARISH"
          ? "HARD_FAIL"
          : supplyConfluenceState === "UNKNOWN" ||
              supplyConfluenceState === "UNAVAILABLE"
            ? "SOFT_FAIL"
            : "INFO",
      message:
        supplyConfluenceState === "BEARISH"
          ? "Supply confluence is bearish from actual flow data."
          : supplyConfluenceState === "UNKNOWN" ||
              supplyConfluenceState === "UNAVAILABLE"
            ? "Supply confluence is unknown/unavailable, not bearish; confidence downgrade only."
            : "Supply confluence is not bearish.",
      providerIssue:
        supplyConfluenceState === "UNKNOWN" ||
        supplyConfluenceState === "UNAVAILABLE",
      marketSignal: supplyConfluenceState === "BEARISH",
      executionBlocking: supplyConfluenceState === "BEARISH",
      learningBlocking: false,
      value: supplyConfluenceState,
      expected: "BULLISH_OR_NEUTRAL",
      source: "supplyConfluenceState",
    }),
  );
  conditions.push(
    makeCondition({
      code: "SECTOR_ENERGY_CONFIDENCE_PASS",
      passed: !hasSectorEnergyDiagnostic,
      severity: hasSectorEnergyDiagnostic ? "DIAGNOSTIC_ONLY" : "INFO",
      message: hasSectorEnergyDiagnostic
        ? "SectorEnergy degraded is diagnostic evidence only per ADR-0462."
        : "No SectorEnergy confidence diagnostic blocker recorded.",
      providerIssue: hasSectorEnergyDiagnostic,
      marketSignal: false,
      executionBlocking: false,
      learningBlocking: false,
      value: trace.sectorEnergyState,
      source: "sectorEnergyQuality",
    }),
  );
  conditions.push(
    makeCondition({
      code: "RISK_BLOCK_PASS",
      passed: !macroGateState?.emergencyStop,
      severity: macroGateState?.emergencyStop ? "HARD_FAIL" : "INFO",
      message: macroGateState?.emergencyStop
        ? "Severe risk block active."
        : "No severe risk block active.",
      providerIssue: false,
      marketSignal: Boolean(macroGateState?.emergencyStop),
      executionBlocking: Boolean(macroGateState?.emergencyStop),
      learningBlocking: false,
      source: "macroGateState",
    }),
  );
  const minSignalScoreTrace = buildMinimumSignalScoreTrace({
    trace,
    hasGate1Blocker,
    regime,
    marketSession,
    macroGateState,
    supplyProviderHealth,
    supplyConfluenceState,
    hasSectorEnergyDiagnostic,
  });
  conditions.push(
    makeCondition({
      code: "MIN_SIGNAL_SCORE_PASS",
      passed: minSignalScoreTrace.passed,
      severity: minSignalScoreTrace.passed ? "INFO" : "SOFT_FAIL",
      message: minSignalScoreTrace.passed
        ? `Minimum signal score passed: actual ${minSignalScoreTrace.actualScore} / required ${minSignalScoreTrace.requiredScore}.`
        : `Minimum signal score failed: actual ${minSignalScoreTrace.actualScore} / required ${minSignalScoreTrace.requiredScore}, gap ${minSignalScoreTrace.scoreGap}.`,
      providerIssue: false,
      marketSignal: false,
      executionBlocking: false,
      learningBlocking: false,
      value: {
        actualScore: minSignalScoreTrace.actualScore,
        requiredScore: minSignalScoreTrace.requiredScore,
        scoreGap: minSignalScoreTrace.scoreGap,
      },
      expected: { requiredScore: minSignalScoreTrace.requiredScore },
      source: "ADR-0466_minimumSignalScoreTrace",
    }),
  );
  conditions.push(
    makeCondition({
      code: "DUPLICATE_POSITION_PASS",
      passed: true,
      severity: "NOT_APPLICABLE",
      message:
        "No duplicate-position blocker was provided to ADR-0465 decomposition.",
      providerIssue: false,
      marketSignal: false,
      executionBlocking: false,
      learningBlocking: false,
      source: "entryFilterDecomposition",
    }),
  );
  conditions.push(
    makeCondition({
      code: "SIZING_PRECHECK_PASS",
      passed: !trace.blockers.some((b) => b.category === "KELLY_SIZING"),
      severity: trace.blockers.some((b) => b.category === "KELLY_SIZING")
        ? "SOFT_FAIL"
        : "INFO",
      message: trace.blockers.some((b) => b.category === "KELLY_SIZING")
        ? "Sizing precheck below minimum."
        : "Sizing precheck did not block before Gate1 decomposition.",
      providerIssue: false,
      marketSignal: false,
      executionBlocking: trace.blockers.some(
        (b) => b.category === "KELLY_SIZING",
      ),
      learningBlocking: false,
      source: "kellySizingTrace",
    }),
  );
  const hardFailCount = conditions.filter(
    (c) => !c.passed && c.severity === "HARD_FAIL",
  ).length;
  const softFailCount = conditions.filter(
    (c) => !c.passed && c.severity === "SOFT_FAIL",
  ).length;
  const diagnosticOnlyCount = conditions.filter(
    (c) => !c.passed && c.severity === "DIAGNOSTIC_ONLY",
  ).length;
  const primaryFail =
    conditions.find((c) => !c.passed && c.severity === "HARD_FAIL") ??
    conditions.find((c) => !c.passed && c.providerIssue) ??
    conditions.find((c) => !c.passed && c.severity === "SOFT_FAIL") ??
    conditions.find((c) => !c.passed);
  const wouldPassIfProviderIssueSoftened = canPassIgnoring(
    { conditions } as Gate1CandidateTrace,
    (c) =>
      c.providerIssue ||
      c.code === "TRADING_SESSION_PASS" ||
      c.code === "MIN_SIGNAL_SCORE_PASS",
  );
  const wouldPassIfSupplySampleIgnored = canPassIgnoring(
    { conditions } as Gate1CandidateTrace,
    (c) =>
      c.code === "SUPPLY_PROVIDER_HEALTH_PASS" ||
      c.code === "INVESTOR_FLOW_SAMPLE_PASS" ||
      c.code === "SUPPLY_CONFLUENCE_PASS" ||
      c.code === "TRADING_SESSION_PASS",
  );
  const wouldPassIfSectorEnergyIgnored = canPassIgnoring(
    { conditions } as Gate1CandidateTrace,
    (c) =>
      c.code === "SECTOR_ENERGY_CONFIDENCE_PASS" ||
      c.code === "TRADING_SESSION_PASS",
  );
  const wouldPassIfTimeWindowIgnored = canPassIgnoring(
    { conditions } as Gate1CandidateTrace,
    (c) => c.code === "TRADING_SESSION_PASS",
  );
  const softFailAccumulationTrace = buildSoftFailAccumulationTrace({
    symbol: trace.symbol,
    conditions,
    minSignalScoreTrace,
    threshold: input.gate1SoftFailThreshold,
  });
  const riskPenaltyTrace = buildRiskPenaltyTrace({
    symbol: trace.symbol,
    macroGateState,
    minSignalScoreTrace,
  });
  return {
    symbol: trace.symbol,
    name: trace.name,
    regime,
    marketSession,
    gate1Passed:
      trace.gate1Passed === true ||
      (!hasGate1Blocker &&
        hardFailCount === 0 &&
        softFailCount < input.gate1SoftFailThreshold),
    hardFailCount,
    softFailCount,
    diagnosticOnlyCount,
    primaryFailCode: primaryFail?.code,
    conditions,
    wouldPassIfProviderIssueSoftened,
    wouldPassIfSupplySampleIgnored,
    wouldPassIfSectorEnergyIgnored,
    wouldPassIfTimeWindowIgnored,
    minSignalScoreTrace,
    unknownDataTreatmentAudit:
      buildUnknownDataTreatmentAudit(minSignalScoreTrace),
    softFailAccumulationTrace,
    riskPenaltyTrace,
    symbolFeatures: trace.symbolFeatures,
    conditionResultsTrace: trace.conditionResultsTrace,
    conditionResults: trace.conditionResults,
    conditionKeys: trace.conditionKeys,
    gateRawScore: trace.gateRawScore,
    normalizedGateScore: trace.normalizedGateScore,
    availableMaxScore: trace.availableMaxScore,
    calibrationTags: [
      ...(minSignalScoreTrace.scoreGap < 0
        ? ["CASE_MIN_SIGNAL_SCORE_GAP"]
        : []),
      ...(minSignalScoreTrace.unknownPenaltyTotal < 0
        ? ["CASE_UNKNOWN_DATA_PENALTY"]
        : []),
      ...(softFailAccumulationTrace.failedBySoftAccumulation
        ? ["CASE_SOFT_FAIL_ACCUMULATION"]
        : []),
      ...(riskPenaltyTrace.doubleCountWarning
        ? ["CASE_RISK_PENALTY_DOUBLE_COUNT_WARNING"]
        : []),
      ...(regime === "R3_EARLY" &&
      minSignalScoreTrace.scoreGap < 0 &&
      minSignalScoreTrace.scoreGap >= -10
        ? ["CASE_R3_EARLY_ADAPTIVE_THRESHOLD_CANDIDATE"]
        : []),
    ],
    executionImpact: "NONE",
  };
}

export function buildGate1Reports(input: {
  nowIso: string;
  forDate: string;
  regime: string;
  marketSession: string;
  traces: Gate1CandidateTrace[];
}): {
  report: Gate1DecompositionReport;
  counterfactual: Gate1CounterfactualSurvivorReport;
} {
  const { traces } = input;
  const primaryMap = new Map<string, { count: number; examples: string[] }>();
  for (const trace of traces) {
    if (!trace.primaryFailCode) continue;
    const current = primaryMap.get(trace.primaryFailCode) ?? {
      count: 0,
      examples: [],
    };
    current.count += 1;
    if (current.examples.length < 3) current.examples.push(trace.symbol);
    primaryMap.set(trace.primaryFailCode, current);
  }
  const actualGate1Survivors = traces.filter((t) => t.gate1Passed).length;
  const counterfactual: Gate1CounterfactualSurvivorReport = {
    totalCandidates: traces.length,
    actualGate1Survivors,
    ifProviderIssueSoftened: traces.filter(
      (t) => t.wouldPassIfProviderIssueSoftened,
    ).length,
    ifSupplySampleIgnored: traces.filter(
      (t) => t.wouldPassIfSupplySampleIgnored,
    ).length,
    ifSectorEnergyIgnored: traces.filter(
      (t) => t.wouldPassIfSectorEnergyIgnored,
    ).length,
    ifTimeWindowIgnored: traces.filter((t) => t.wouldPassIfTimeWindowIgnored)
      .length,
    ifSoftFailsIgnoredOnly: traces.filter((t) => t.hardFailCount === 0).length,
    candidateExamples: traces
      .filter(
        (t) =>
          t.wouldPassIfProviderIssueSoftened ||
          t.wouldPassIfSupplySampleIgnored,
      )
      .slice(0, 5)
      .map((t) => ({
        symbol: t.symbol,
        name: t.name,
        actualPrimaryFail: t.primaryFailCode ?? "UNKNOWN_GATE1_CONDITION",
        counterfactualPassReason: [
          ...(t.wouldPassIfProviderIssueSoftened
            ? ["CASE_GATE1_PROVIDER_SOFTENED_SURVIVOR"]
            : []),
          ...(t.wouldPassIfSupplySampleIgnored
            ? ["CASE_SUPPLY_SAMPLE_UNKNOWN"]
            : []),
        ],
      })),
  };
  const providerIssueCount = Object.values(
    countByCondition(traces, (c) => !c.passed && c.providerIssue),
  ).reduce((a, b) => a + b, 0);
  const marketSignalCount = Object.values(
    countByCondition(traces, (c) => !c.passed && c.marketSignal),
  ).reduce((a, b) => a + b, 0);
  const report: Gate1DecompositionReport = {
    timestamp: input.nowIso,
    forDate: input.forDate,
    regime: input.regime,
    marketSession: input.marketSession,
    totalCandidates: traces.length,
    gate1Passed: actualGate1Survivors,
    gate1Failed: traces.length - actualGate1Survivors,
    hardFailDistribution: countByCondition(
      traces,
      (c) => !c.passed && c.severity === "HARD_FAIL",
    ),
    softFailDistribution: countByCondition(
      traces,
      (c) => !c.passed && c.severity === "SOFT_FAIL",
    ),
    providerIssueDistribution: countByCondition(
      traces,
      (c) => !c.passed && c.providerIssue,
    ),
    marketSignalDistribution: countByCondition(
      traces,
      (c) => !c.passed && c.marketSignal,
    ),
    wouldPassIfProviderIssueSoftened: counterfactual.ifProviderIssueSoftened,
    wouldPassIfSupplySampleIgnored: counterfactual.ifSupplySampleIgnored,
    wouldPassIfSectorEnergyIgnored: counterfactual.ifSectorEnergyIgnored,
    topPrimaryFailCodes: Array.from(primaryMap.entries())
      .map(([code, value]) => ({
        code,
        count: value.count,
        examples: value.examples,
      }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    recommendedAction:
      providerIssueCount > 0 && providerIssueCount >= marketSignalCount
        ? GATE1_PROVIDER_ISSUE_SOFT_FAIL_ENABLED
          ? "REPAIR_PROVIDER_HEALTH"
          : "RECLASSIFY_PROVIDER_ISSUE_AS_SOFT_FAIL"
        : marketSignalCount > 0
          ? "REVIEW_GATE1_THRESHOLDS"
          : "DIAGNOSTIC_ONLY",
  };
  return { report, counterfactual };
}
