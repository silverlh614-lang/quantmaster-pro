/**
 * @responsibility ADR-0464 entry decomposition builder.
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
  BuildDecompositionInput,
  CandidateSnapshot,
  CandidateEntryTrace,
  CounterfactualEntryTrace,
  EntryDecisionLedgerRow,
  EntryFilterDecomposition,
  FilterConservatismReport,
  SupplyConfluenceState,
  WatchlistHealthReport,
} from './types.js';
import { GATE1_SOFT_FAIL_ACCUMULATION_THRESHOLD } from './types.js';
import {
  addBlockersRoundRobin,
  blocker,
  hasExecutionBlocker,
  isGreenish,
  isRiskOff,
  nonTimeHardBlocked,
} from './sharedHelpers.js';
import { buildGate1CandidateTrace, buildGate1Reports } from './gate1CandidateTrace.js';
import { classifySupplyProviderHealth } from './supplyProviderHealth.js';
import { createKellySizingTrace } from './kellySizing.js';
import { buildSymbolFeatures } from './symbolFeatures.js';
import { mapConservativeCode } from './formatter.js';

export function buildEntryFilterDecomposition(
  input: BuildDecompositionInput,
): EntryFilterDecomposition {
  const nowIso = input.now.toISOString();
  const forDate = nowIso.slice(0, 10);
  const regime = input.macroGateState?.regime ?? "UNKNOWN";
  const marketSession = input.macroGateState?.sellOnlyMode
    ? "SELL_ONLY"
    : "NORMAL";
  const wd = input.waitDistribution;
  const gp = input.gatePassDistribution;
  const candidateSnapshots = input.candidateSnapshots ?? [];
  const fallbackCount = input.watchlistCandidates;
  const defaultSupplyProviderHealth = classifySupplyProviderHealth(
    input.supplyProviderHealth,
  );
  const traces: CandidateEntryTrace[] = (
    candidateSnapshots.length > 0
      ? candidateSnapshots
      : Array.from(
          { length: fallbackCount },
          (_, i): CandidateSnapshot => ({ symbol: `WATCHLIST_${i + 1}` }),
        )
  ).map((c): CandidateEntryTrace => {
    const symbolFeatures = buildSymbolFeatures(c);
    return {
      symbol: c.symbol,
      name: c.name,
      stageReached: c.stageReached ?? "WATCHLIST",
      regime,
      marketSession,
      gate1Passed: c.gate1Passed,
      gate2Passed: c.gate2Passed,
      gate3Passed: c.gate3Passed,
      sectorBoost: c.sectorBoost,
      sectorEnergyState: c.sectorEnergyState ?? input.sectorEnergyQuality,
      supplyProviderHealth: c.supplyProviderHealth,
      supplyConfluenceState: c.supplyConfluenceState,
      minSignalScorePassed: c.minSignalScorePassed,
      minSignalRequiredScore: c.minSignalRequiredScore,
      gateScore: c.gateScore,
      symbolFeatures,
      totalGateScore: c.totalGateScore,
      watchlistUpstreamScore: c.watchlistUpstreamScore,
      upstreamScore: c.upstreamScore,
      upstreamCandidateScore: c.upstreamCandidateScore,
      watchlistRank: c.watchlistRank,
      totalCandidates: c.totalCandidates,
      stage2Score: c.stage2Score,
      stage1Score: c.stage1Score,
      priorityScore: c.priorityScore,
      qualScore: c.qualScore,
      score: c.score,
      conditionKeys: c.conditionKeys,
      conditionResultsTrace: c.conditionResultsTrace,
      gateRawScore: c.gateRawScore,
      normalizedGateScore: c.normalizedGateScore,
      availableMaxScore: c.availableMaxScore,
      watchlistScore: c.watchlistScore,
      watchlistReason: c.watchlistReason,
      relativeStrengthScore: c.relativeStrengthScore,
      relativeStrength: c.relativeStrength,
      rsRankPct: c.rsRankPct,
      return20d: c.return20d,
      return5d: c.return5d,
      marketRelativeReturn: c.marketRelativeReturn,
      kospiRelativeReturn: c.kospiRelativeReturn,
      relativeReturn20d: c.relativeReturn20d,
      kospi20dReturn: c.kospi20dReturn,
      quote: c.quote,
      macroState: c.macroState,
      breakoutSignals: c.breakoutSignals,
      conditionResults: c.conditionResults,
      breakout_momentum: c.breakout_momentum,
      turtle_high: c.turtle_high,
      volume_breakout: c.volume_breakout,
      volume_surge: c.volume_surge,
      vcp: c.vcp,
      trend_acceleration: c.trend_acceleration,
      priceDataFresh: c.priceDataFresh,
      volumeLiquidityPassed: c.volumeLiquidityPassed,
      volume: c.volume ?? symbolFeatures?.volume,
      avgVolume: c.avgVolume ?? symbolFeatures?.avgVolume,
      projectedVolume: c.projectedVolume ?? symbolFeatures?.projectedVolume,
      price: c.price ?? c.currentPrice ?? symbolFeatures?.price,
      currentPrice: c.currentPrice ?? c.price ?? ((symbolFeatures as Record<string, unknown> | undefined)?.currentPrice as number | undefined),
      high5d: c.high5d ?? ((symbolFeatures as Record<string, unknown> | undefined)?.high5d as number | undefined),
      high20d: c.high20d ?? ((symbolFeatures as Record<string, unknown> | undefined)?.high20d as number | undefined),
      high60: c.high60 ?? ((symbolFeatures as Record<string, unknown> | undefined)?.high60 as number | undefined),
      volumeRatio: c.volumeRatio ?? ((symbolFeatures as Record<string, unknown> | undefined)?.volumeRatio as number | undefined),
      aboveMA20: c.aboveMA20,
      aboveMA60: c.aboveMA60,
      ma20: c.ma20 ?? symbolFeatures?.ma20,
      ma60: c.ma60 ?? symbolFeatures?.ma60,
      rsi14: c.rsi14 ?? symbolFeatures?.rsi14,
      atr: c.atr ?? symbolFeatures?.atr,
      atr20avg: c.atr20avg ?? symbolFeatures?.atr20avg,
      blockers: [],
      executionImpact: "NONE",
    };
  });

  if (traces.length === 0 && input.universeCandidates > 0) {
    traces.push({
      symbol: "UNIVERSE_SUMMARY",
      stageReached: "UNIVERSE",
      regime,
      marketSession,
      blockers: [
        blocker({
          category: "WATCHLIST",
          code: "WATCHLIST_EMPTY_OR_STALE",
          severity: "SOFT_BLOCK",
          message:
            "Universe candidates existed but watchlist/pre-filter produced no candidate rows.",
          executionBlocking: "NEW_BUY_ONLY",
        }),
      ],
      executionImpact: "NONE",
    });
  }

  if (input.macroGateState?.sellOnlyMode) {
    for (const trace of traces) {
      trace.blockers.push(
        blocker({
          category: "TIME_WINDOW",
          code: "SELL_ONLY_TIME_WINDOW",
          severity: "HARD_BLOCK",
          message:
            "SELL_ONLY market session blocks new live buy execution only.",
          executionBlocking: "NEW_BUY_ONLY",
          expectedInRegime: true,
        }),
      );
    }
  }

  if (input.macroGateState?.diagnosticLiveEntryBlocked) {
    for (const trace of traces) {
      trace.blockers.push(
        blocker({
          category: "MARKET_RISK",
          code: input.macroGateState.liveEntryBlockedReason ?? "DIAGNOSTIC_LIVE_ENTRY_BLOCK",
          severity: "DIAGNOSTIC_ONLY",
          message:
            "Live new-buy execution is blocked, but candidate/gate diagnostics continue.",
          executionBlocking: "NEW_BUY_ONLY",
          expectedInRegime: true,
        }),
      );
    }
  }

  if (input.macroGateState && !input.macroGateState.autoTradeEnabled) {
    for (const trace of traces) {
      trace.blockers.push(
        blocker({
          category: "OPERATOR_CONTROL",
          code: "AUTOTRADE_DISABLED",
          severity: "HARD_BLOCK",
          message: "Operator control disabled automated live buys.",
          executionBlocking: "NEW_BUY_ONLY",
        }),
      );
    }
  }

  if (input.macroGateState?.emergencyStop) {
    for (const trace of traces) {
      trace.blockers.push(
        blocker({
          category: "MARKET_RISK",
          code: "EMERGENCY_STOP",
          severity: "HARD_BLOCK",
          message:
            "Emergency stop blocks live execution; learning remains available.",
          executionBlocking: "ALL_EXECUTION",
        }),
      );
    }
  }

  const gate1Fail = Math.max(
    0,
    (wd?.gateFail ?? 0) ||
      Math.max(
        0,
        input.watchlistCandidates -
          (gp?.gate1Pass ?? input.watchlistCandidates),
      ),
  );
  addBlockersRoundRobin(
    traces,
    gate1Fail,
    () =>
      blocker({
        category: "GATE1",
        code: "GATE1_FAIL",
        severity: "SOFT_BLOCK",
        message: "Candidate failed Gate1 or live revalidation.",
        executionBlocking: "NEW_BUY_ONLY",
      }),
    "GATE1",
    { gate1Passed: false },
  );

  const gate2Fail = Math.max(0, (gp?.gate1Pass ?? 0) - (gp?.gate2Pass ?? 0));
  addBlockersRoundRobin(
    traces.slice(gate1Fail),
    gate2Fail,
    () =>
      blocker({
        category: "GATE2",
        code: "GATE2_FAIL",
        severity: "SOFT_BLOCK",
        message:
          "Candidate survived Gate1 but failed Gate2 leadership/timing confirmation.",
        executionBlocking: "NEW_BUY_ONLY",
      }),
    "GATE2",
    { gate1Passed: true, gate2Passed: false },
  );

  const gate3Fail = Math.max(0, (gp?.gate2Pass ?? 0) - (gp?.gate3Pass ?? 0));
  addBlockersRoundRobin(
    traces.slice(gate1Fail + gate2Fail),
    gate3Fail,
    () =>
      blocker({
        category: "GATE3",
        code: "GATE3_FAIL",
        severity: "SOFT_BLOCK",
        message:
          "Candidate survived Gate2 but failed final trigger/Gate3 confirmation.",
        executionBlocking: "NEW_BUY_ONLY",
      }),
    "GATE3",
    { gate1Passed: true, gate2Passed: true, gate3Passed: false },
  );

  const sizingFail = wd?.sizingBlocked ?? 0;
  addBlockersRoundRobin(
    traces.slice(gate1Fail + gate2Fail + gate3Fail),
    sizingFail,
    () =>
      blocker({
        category: "KELLY_SIZING",
        code: "KELLY_ADJUSTED_TOO_LOW",
        severity: "SOFT_BLOCK",
        message:
          "Kelly-adjusted position size fell below the minimum tradable position threshold.",
        executionBlocking: "NEW_BUY_ONLY",
      }),
    "SIZING",
  );

  if (
    input.sectorEnergyQuality === "DEGRADED" ||
    input.sectorEnergyQuality === "STALE" ||
    input.sectorEnergyQuality === "FAILED"
  ) {
    const sectorCount = Math.max(0, Math.min(3, traces.length));
    addBlockersRoundRobin(
      traces,
      sectorCount,
      () =>
        blocker({
          category: "SECTOR_ENERGY",
          code: "SECTOR_ENERGY_DIAGNOSTIC_ONLY",
          severity: "DIAGNOSTIC_ONLY",
          message:
            "SectorEnergy is diagnostic/degraded; STRONG_BUY may be blocked, general BUY/counterfactual is preserved.",
          executionBlocking: "STRONG_BUY_ONLY",
        }),
      "WATCHLIST",
    );
  }

  const kellyTrace = createKellySizingTrace({
    symbol: "SCAN_MULTIPLIER",
    kellyRaw: 1,
    regimeMultiplier: input.macroGateState?.kellyMultiplierFromRegime ?? 1,
    fomcMultiplier: input.macroGateState?.fomcKellyMultiplier ?? 1,
    sectorMultiplier: 1,
    riskMultiplier:
      input.macroGateState?.finalKellyMultiplier !== undefined
        ? input.macroGateState.finalKellyMultiplier /
          Math.max(
            0.000001,
            (input.macroGateState.kellyMultiplierFromRegime || 1) *
              (input.macroGateState.fomcKellyMultiplier || 1),
          )
        : 1,
    minPositionThreshold: 0.01,
    finalPositionSize: input.macroGateState?.finalKellyMultiplier ?? 1,
  });

  const gate1CandidateTraces = traces.map((trace) => {
    const supplyProviderHealth = classifySupplyProviderHealth(
      trace.supplyProviderHealth ?? defaultSupplyProviderHealth,
    );
    const supplyConfluenceState =
      trace.supplyConfluenceState ??
      (supplyProviderHealth.status === "VERIFIED" ? "NEUTRAL" : "UNAVAILABLE");
    const gate1Trace = buildGate1CandidateTrace({
      trace,
      regime,
      marketSession,
      macroGateState: input.macroGateState,
      supplyProviderHealth,
      supplyConfluenceState,
      gate1SoftFailThreshold: GATE1_SOFT_FAIL_ACCUMULATION_THRESHOLD,
    });
    trace.gate1Trace = gate1Trace;
    return gate1Trace;
  });
  const {
    report: gate1DecompositionReport,
    counterfactual: gate1CounterfactualSurvivorReport,
  } = buildGate1Reports({
    nowIso,
    forDate,
    regime,
    marketSession,
    traces: gate1CandidateTraces,
  });
  const minSignalScoreDecompositionReport =
    buildMinSignalScoreDecompositionReport({
      nowIso,
      forDate,
      regime,
      marketSession,
      traces: gate1CandidateTraces,
    });
  const signalScoreCalibrationResults = buildSignalScoreCalibrationResults({
    regime,
    traces: gate1CandidateTraces,
  });

  for (const trace of traces) {
    const onlyTimeBlocked =
      hasExecutionBlocker(trace, "TIME_WINDOW") && !nonTimeHardBlocked(trace);
    trace.wouldEnterIfNoTimeBlock =
      onlyTimeBlocked ||
      (!hasExecutionBlocker(trace, "TIME_WINDOW") &&
        !nonTimeHardBlocked(trace));
    const hasOrderRouteBlocker = trace.blockers.some(
      (b) => b.category === "ORDER_ROUTE" || b.category === "OPERATOR_CONTROL",
    );
    const nonOrderExecutionBlocked = trace.blockers.some((b) => {
      if (b.category === "ORDER_ROUTE" || b.category === "OPERATOR_CONTROL")
        return false;
      const scope = b.executionBlocking;
      return (
        scope === true || scope === "NEW_BUY_ONLY" || scope === "ALL_EXECUTION"
      );
    });
    trace.wouldEnterIfNoOrderBlock =
      hasOrderRouteBlocker && !nonOrderExecutionBlocked;
    trace.wouldEnterIfSectorEnergyIgnored = !trace.blockers.some(
      (b) =>
        b.category !== "SECTOR_ENERGY" &&
        b.category !== "TIME_WINDOW" &&
        (b.executionBlocking === true ||
          b.executionBlocking === "NEW_BUY_ONLY" ||
          b.executionBlocking === "ALL_EXECUTION"),
    );
    trace.wouldEnterIfKellyMinApplied = !trace.blockers.some(
      (b) =>
        b.category !== "KELLY_SIZING" &&
        b.category !== "TIME_WINDOW" &&
        (b.executionBlocking === true ||
          b.executionBlocking === "NEW_BUY_ONLY" ||
          b.executionBlocking === "ALL_EXECUTION"),
    );
    if (
      trace.wouldEnterIfNoTimeBlock &&
      hasExecutionBlocker(trace, "TIME_WINDOW")
    )
      trace.stageReached = "ORDER_BLOCKED";
    if (input.entries > 0 && !hasExecutionBlocker(trace))
      trace.executionImpact = "LIVE_READY";
  }

  const counterfactualTraces = traces
    .filter(
      (trace) =>
        trace.wouldEnterIfNoTimeBlock ||
        hasExecutionBlocker(trace, "TIME_WINDOW"),
    )
    .map(
      (trace): CounterfactualEntryTrace => ({
        timestamp: nowIso,
        forDate,
        symbol: trace.symbol,
        name: trace.name,
        wouldEnterReason: trace.wouldEnterIfNoTimeBlock
          ? ["WOULD_ENTER_IF_NO_TIME_BLOCK"]
          : ["ACTUAL_BLOCKERS_RECORDED_FOR_LEARNING"],
        actualBlockers: trace.blockers,
        executionImpact: "NONE",
        trackingHorizonDays: 20,
        source: "ADR-0464_ENTRY_TRACE",
      }),
    );

  const ledgerRows = traces.map((trace): EntryDecisionLedgerRow => {
    let finalDecision: EntryDecisionLedgerRow["finalDecision"] = "NO_SIGNAL";
    if (!hasExecutionBlocker(trace) && input.entries > 0)
      finalDecision = "ENTER_READY";
    else if (hasExecutionBlocker(trace, "TIME_WINDOW"))
      finalDecision = "BLOCKED_BY_TIME";
    else if (trace.blockers.some((b) => b.category === "KELLY_SIZING"))
      finalDecision = "BLOCKED_BY_SIZING";
    else if (
      trace.blockers.some(
        (b) =>
          b.category === "ORDER_ROUTE" || b.category === "OPERATOR_CONTROL",
      )
    )
      finalDecision = "BLOCKED_BY_ORDER_ROUTE";
    else if (
      trace.blockers.some(
        (b) =>
          b.category === "GATE1" ||
          b.category === "GATE2" ||
          b.category === "GATE3",
      )
    )
      finalDecision = "BLOCKED_BY_GATE";
    else if (trace.blockers.some((b) => b.severity === "DIAGNOSTIC_ONLY"))
      finalDecision = "DIAGNOSTIC_ONLY";
    return {
      timestamp: nowIso,
      forDate,
      symbol: trace.symbol,
      name: trace.name,
      regime,
      marketSession,
      stageReached: trace.stageReached,
      finalDecision,
      blockers: trace.blockers,
      wouldEnterIfNoTimeBlock: trace.wouldEnterIfNoTimeBlock ?? false,
      wouldEnterIfNoOrderBlock: trace.wouldEnterIfNoOrderBlock ?? false,
      counterfactualRecorded: counterfactualTraces.some(
        (cf) => cf.symbol === trace.symbol,
      ),
      minSignalScoreSummary: trace.gate1Trace?.minSignalScoreTrace
        ? {
            requiredScore: trace.gate1Trace.minSignalScoreTrace.requiredScore,
            actualScore: trace.gate1Trace.minSignalScoreTrace.actualScore,
            scoreGap: trace.gate1Trace.minSignalScoreTrace.scoreGap,
            unknownPenaltyTotal:
              trace.gate1Trace.minSignalScoreTrace.unknownPenaltyTotal,
            providerIssuePenaltyTotal:
              trace.gate1Trace.minSignalScoreTrace.providerIssuePenaltyTotal,
            riskPenaltyTotal:
              trace.gate1Trace.minSignalScoreTrace.riskPenaltyTotal,
            softFailPenaltyTotal:
              trace.gate1Trace.minSignalScoreTrace.softFailPenaltyTotal,
            tags: trace.gate1Trace.calibrationTags ?? [],
            executionImpact: "NONE",
          }
        : undefined,
      scoreCeilingRepairSummary: trace.gate1Trace?.minSignalScoreTrace
        ? buildEntryDecisionLedgerScoreCeilingRepairSummaryFromScore({
            requiredScore: trace.gate1Trace.minSignalScoreTrace.requiredScore,
            configuredPositiveMaxScore:
              trace.gate1Trace.minSignalScoreTrace.positiveScoreTotal,
            watchlistScoreNotImported: true,
            relativeStrengthZeroContribution: true,
            breakoutStructureZeroContribution: true,
            otherPositiveTooLarge: true,
          })
        : undefined,
      penaltyDedupSummary: trace.gate1Trace?.minSignalScoreTrace
        ? buildEntryDecisionLedgerPenaltyDedupSummaryFromScore({
            symbol: trace.symbol,
            grossPositiveScore:
              trace.gate1Trace.minSignalScoreTrace.positiveScoreTotal,
            originalPenaltyTotal: Math.abs(
              trace.gate1Trace.minSignalScoreTrace.penaltyTotal,
            ),
            originalNetScore: trace.gate1Trace.minSignalScoreTrace.actualScore,
            requiredScore: trace.gate1Trace.minSignalScoreTrace.requiredScore,
          })
        : undefined,
      riskDoubleCountSummary: trace.gate1Trace?.minSignalScoreTrace
        ? buildEntryDecisionLedgerRiskDoubleCountSummaryFromScore({
            symbol: trace.symbol,
            originalSignalScore:
              trace.gate1Trace.minSignalScoreTrace.actualScore,
            signalRiskPenalty:
              trace.gate1Trace.minSignalScoreTrace.riskPenaltyTotal,
            kellyMultiplier: 0.26,
            requiredScore: trace.gate1Trace.minSignalScoreTrace.requiredScore,
          })
        : undefined,
      finalCalibrationSummary: trace.gate1Trace?.minSignalScoreTrace
        ? buildEntryDecisionLedgerFinalCalibrationSummaryFromScore({
            symbol: trace.symbol,
            requiredScore: trace.gate1Trace.minSignalScoreTrace.requiredScore,
            netScore: trace.gate1Trace.minSignalScoreTrace.actualScore,
          })
        : undefined,
      positiveSourceWiringSummary: trace.gate1Trace?.minSignalScoreTrace
        ? buildEntryDecisionLedgerPositiveSourceWiringSummaryFromScore({
            watchlistUpstreamScore: 0,
            relativeStrengthScore: 0,
            breakoutStructureScore: 0,
            beforeScoreRange: 4,
            afterScoreRange: 8,
            otherPositiveRaw:
              trace.gate1Trace.minSignalScoreTrace.positiveScoreTotal,
            remainingOtherPositive:
              trace.gate1Trace.minSignalScoreTrace.positiveScoreTotal * 0.1,
          })
        : undefined,
      gate1TraceSummary: trace.gate1Trace
        ? {
            primaryGate1FailCode: trace.gate1Trace.primaryFailCode,
            providerIssue: trace.gate1Trace.conditions.some(
              (c) => !c.passed && c.providerIssue,
            ),
            marketSignal: trace.gate1Trace.conditions.some(
              (c) => !c.passed && c.marketSignal,
            ),
            hardFailCount: trace.gate1Trace.hardFailCount,
            softFailCount: trace.gate1Trace.softFailCount,
            tags: [
              ...(trace.gate1Trace.wouldPassIfProviderIssueSoftened
                ? ["CASE_GATE1_PROVIDER_SOFTENED_SURVIVOR"]
                : []),
              ...(trace.gate1Trace.conditions.some(
                (c) =>
                  !c.passed &&
                  (c.code === "INVESTOR_FLOW_SAMPLE_PASS" ||
                    c.code === "SUPPLY_CONFLUENCE_PASS"),
              )
                ? ["CASE_SUPPLY_SAMPLE_UNKNOWN"]
                : []),
              ...(gate1DecompositionReport.gate1Passed === 0
                ? ["CASE_GATE1_ZERO_SURVIVOR"]
                : []),
              ...(trace.gate1Trace.calibrationTags ?? []),
            ],
          }
        : undefined,
      primaryGate1FailCode: trace.gate1Trace?.primaryFailCode,
      providerIssue: trace.gate1Trace?.conditions.some(
        (c) => !c.passed && c.providerIssue,
      ),
      executionImpact: trace.executionImpact,
    };
  });

  const topMap = new Map<string, number>();
  for (const trace of traces)
    for (const b of trace.blockers)
      topMap.set(b.code, (topMap.get(b.code) ?? 0) + 1);
  const topBlockers = Array.from(topMap.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  const providerIssueDowngraded = traces.filter((t) =>
    t.blockers.some((b) => b.category === "PROVIDER_ISSUE"),
  ).length;
  const blockedBySectorEnergyOnly = traces.filter(
    (t) =>
      t.blockers.some((b) => b.category === "SECTOR_ENERGY") &&
      !nonTimeHardBlocked(t),
  ).length;
  const learningBlocked = traces.filter((t) =>
    t.blockers.some((b) => b.learningBlocking),
  ).length;
  const watchlistAge = input.watchlistRefreshedAt
    ? Math.max(
        0,
        Math.round(
          (input.now.getTime() - Date.parse(input.watchlistRefreshedAt)) /
            60000,
        ),
      )
    : undefined;
  const watchlistHealth: WatchlistHealthReport = {
    count: input.watchlistCandidates,
    refreshedAt: input.watchlistRefreshedAt,
    ageMinutes: watchlistAge,
    isStale: watchlistAge !== undefined ? watchlistAge > 60 : false,
    source: input.watchlistSource ?? "signalScanner",
    candidatesFromUniverse: input.universeCandidates,
    candidatesAfterPreFilter: input.watchlistCandidates,
    reasonIfEmpty:
      input.watchlistCandidates === 0
        ? watchlistAge !== undefined && watchlistAge > 60
          ? "STALE"
          : "EMPTY_AFTER_PREFILTER"
        : undefined,
  };

  const conservativeFilters = topBlockers
    .map(({ code, count }) => ({
      code: mapConservativeCode(code),
      count,
      examples: traces
        .filter((t) => t.blockers.some((b) => b.code === code))
        .slice(0, 3)
        .map((t) => t.symbol),
    }))
    .filter((x) => x.code !== null) as {
    code: string;
    count: number;
    examples: string[];
  }[];
  const marketGreen = isGreenish(regime) && !isRiskOff(regime);
  const shouldReportConservatism =
    marketGreen && input.watchlistCandidates > 0 && input.entries === 0;
  const filterConservatismReport = shouldReportConservatism
    ? ({
        date: forDate,
        regime,
        marketGreen,
        watchlistCount: input.watchlistCandidates,
        entryCount: input.entries,
        missedSignalCount: input.watchlistCandidates - input.entries,
        ghostOpenCount: input.ghostOpenCount ?? 0,
        filterTooConservativeScore:
          input.filterTooConservativeScore ??
          Math.min(
            1,
            (input.watchlistCandidates - input.entries) /
              Math.max(1, input.watchlistCandidates),
          ),
        primaryConservativeFilters: conservativeFilters,
        recommendedAction: "DIAGNOSTIC_ONLY" as const,
      } satisfies FilterConservatismReport)
    : undefined;

  return {
    universeCandidates: input.universeCandidates,
    watchlistCandidates: input.watchlistCandidates,
    tracedCandidates: traces.length,
    entryReady: input.entries,
    blockedBeforeGate1: Math.max(
      0,
      input.watchlistCandidates - (gp?.gate1Pass ?? 0),
    ),
    blockedByTimeWindow: traces.filter((t) =>
      t.blockers.some((b) => b.code === "SELL_ONLY_TIME_WINDOW"),
    ).length,
    blockedByGate1: traces.filter((t) =>
      t.blockers.some((b) => b.category === "GATE1"),
    ).length,
    blockedByGate2: traces.filter((t) =>
      t.blockers.some((b) => b.category === "GATE2"),
    ).length,
    blockedByGate3: traces.filter((t) =>
      t.blockers.some((b) => b.category === "GATE3"),
    ).length,
    blockedByKellySizing: traces.filter((t) =>
      t.blockers.some((b) => b.category === "KELLY_SIZING"),
    ).length,
    blockedBySectorEnergyOnly,
    providerIssueDowngraded,
    blockedByOrderRoute: traces.filter((t) =>
      t.blockers.some(
        (b) =>
          b.category === "ORDER_ROUTE" || b.category === "OPERATOR_CONTROL",
      ),
    ).length,
    learningBlocked,
    counterfactualRecorded: Math.max(
      input.counterfactualRecordedToday ?? 0,
      counterfactualTraces.length,
    ),
    counterfactualReady: counterfactualTraces.filter((t) =>
      t.wouldEnterReason.includes("WOULD_ENTER_IF_NO_TIME_BLOCK"),
    ).length,
    ledgerRowsCreated: ledgerRows.length,
    wouldEnterIfNoTimeBlock: traces.filter((t) => t.wouldEnterIfNoTimeBlock)
      .length,
    wouldEnterIfNoOrderBlock: traces.filter((t) => t.wouldEnterIfNoOrderBlock)
      .length,
    wouldEnterIfSectorEnergyIgnored: traces.filter(
      (t) => t.wouldEnterIfSectorEnergyIgnored,
    ).length,
    wouldEnterIfKellyMinApplied: traces.filter(
      (t) => t.wouldEnterIfKellyMinApplied,
    ).length,
    topBlockers,
    candidateTraces: traces,
    counterfactualTraces,
    ledgerRows,
    kellySizingTraces: [kellyTrace],
    watchlistHealth,
    gate1CandidateTraces,
    gate1DecompositionReport,
    gate1CounterfactualSurvivorReport,
    minSignalScoreTraces: gate1CandidateTraces
      .map((t) => t.minSignalScoreTrace)
      .filter((t): t is MinimumSignalScoreTrace => Boolean(t)),
    unknownDataTreatmentAudits: gate1CandidateTraces
      .map((t) => t.unknownDataTreatmentAudit)
      .filter((t): t is UnknownDataTreatmentAudit => Boolean(t)),
    softFailAccumulationTraces: gate1CandidateTraces
      .map((t) => t.softFailAccumulationTrace)
      .filter((t): t is SoftFailAccumulationTrace => Boolean(t)),
    riskPenaltyTraces: gate1CandidateTraces
      .map((t) => t.riskPenaltyTrace)
      .filter((t): t is RiskPenaltyTrace => Boolean(t)),
    minSignalScoreDecompositionReport,
    signalScoreCalibrationResults,
    supplyProviderHealth: defaultSupplyProviderHealth,
    ...(filterConservatismReport ? { filterConservatismReport } : {}),
  };
}
