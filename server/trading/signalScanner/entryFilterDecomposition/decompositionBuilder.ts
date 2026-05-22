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

function pickNumericWithSource(
  pairs: Array<{ value: unknown; source: string }>,
): { value: number | undefined; source?: string } {
  for (const pair of pairs) {
    if (typeof pair.value === 'number' && Number.isFinite(pair.value)) return { value: pair.value, source: pair.source };
  }
  return { value: undefined };
}
import { mapConservativeCode } from './formatter.js';

export function buildEntryFilterDecomposition(
  input: BuildDecompositionInput,
): EntryFilterDecomposition {
  const nowIso = input.now.toISOString();
  const forDate = nowIso.slice(0, 10);
  const regime = input.macroGateState?.regime ?? "UNKNOWN";
  const marketSession = "NORMAL";
  const wd = input.waitDistribution;
  const gp = input.gatePassDistribution;
  const candidateSnapshots = input.candidateSnapshots ?? [];
  const fallbackCount = input.watchlistCandidates;
  const usePlaceholderRows = candidateSnapshots.length === 0 && fallbackCount > 0;
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
    const candidateRecord = c as unknown as Record<string, unknown>;
    const symbolFeaturesRecord = c.symbolFeatures as unknown as Record<string, unknown> | undefined;
    const symbolFeatures = buildSymbolFeatures(c);
    const quote = (c.quote as Record<string, unknown> | undefined) ?? undefined;
    const conditionResults = (c.conditionResults as Record<string, unknown> | undefined) ?? undefined;
    const technicalIndicators = (c.technicalIndicators as Record<string, unknown> | undefined) ?? undefined;
    const resolvedPrice = pickNumericWithSource([
      { value: c.price, source: 'price' }, { value: c.currentPrice, source: 'currentPrice' }, { value: quote?.price, source: 'quote.price' }, { value: quote?.currentPrice, source: 'quote.currentPrice' }, { value: quote?.close, source: 'quote.close' }, { value: c.symbolFeatures?.price, source: 'symbolFeatures.price' }, { value: conditionResults?.price, source: 'conditionResults.price' }, { value: technicalIndicators?.price, source: 'technicalIndicators.price' },
    ]);
    const resolvedMa20 = pickNumericWithSource([
      { value: c.ma20, source: 'ma20' }, { value: candidateRecord.sma20, source: 'sma20' }, { value: quote?.ma20, source: 'quote.ma20' }, { value: quote?.sma20, source: 'quote.sma20' }, { value: c.symbolFeatures?.ma20, source: 'symbolFeatures.ma20' }, { value: symbolFeaturesRecord?.sma20, source: 'symbolFeatures.sma20' }, { value: conditionResults?.ma20, source: 'conditionResults.ma20' }, { value: conditionResults?.sma20, source: 'conditionResults.sma20' }, { value: technicalIndicators?.ma20, source: 'technicalIndicators.ma20' }, { value: technicalIndicators?.sma20, source: 'technicalIndicators.sma20' },
    ]);
    const resolvedMa60 = pickNumericWithSource([
      { value: c.ma60, source: 'ma60' }, { value: candidateRecord.sma60, source: 'sma60' }, { value: quote?.ma60, source: 'quote.ma60' }, { value: quote?.sma60, source: 'quote.sma60' }, { value: c.symbolFeatures?.ma60, source: 'symbolFeatures.ma60' }, { value: symbolFeaturesRecord?.sma60, source: 'symbolFeatures.sma60' }, { value: conditionResults?.ma60, source: 'conditionResults.ma60' }, { value: conditionResults?.sma60, source: 'conditionResults.sma60' }, { value: technicalIndicators?.ma60, source: 'technicalIndicators.ma60' }, { value: technicalIndicators?.sma60, source: 'technicalIndicators.sma60' },
    ]);
    const resolvedRsi14 = pickNumericWithSource([
      { value: c.rsi14, source: 'rsi14' }, { value: candidateRecord.rsi, source: 'rsi' }, { value: quote?.rsi14, source: 'quote.rsi14' }, { value: quote?.rsi, source: 'quote.rsi' }, { value: c.symbolFeatures?.rsi14, source: 'symbolFeatures.rsi14' }, { value: symbolFeaturesRecord?.rsi, source: 'symbolFeatures.rsi' }, { value: conditionResults?.rsi14, source: 'conditionResults.rsi14' }, { value: conditionResults?.rsi, source: 'conditionResults.rsi' }, { value: technicalIndicators?.rsi14, source: 'technicalIndicators.rsi14' }, { value: technicalIndicators?.rsi, source: 'technicalIndicators.rsi' },
    ]);
    const resolvedAtr = pickNumericWithSource([
      { value: c.atr, source: 'atr' }, { value: candidateRecord.atr14, source: 'atr14' }, { value: quote?.atr, source: 'quote.atr' }, { value: quote?.atr14, source: 'quote.atr14' }, { value: c.symbolFeatures?.atr, source: 'symbolFeatures.atr' }, { value: symbolFeaturesRecord?.atr14, source: 'symbolFeatures.atr14' }, { value: conditionResults?.atr, source: 'conditionResults.atr' }, { value: conditionResults?.atr14, source: 'conditionResults.atr14' }, { value: technicalIndicators?.atr, source: 'technicalIndicators.atr' }, { value: technicalIndicators?.atr14, source: 'technicalIndicators.atr14' },
    ]);
    const resolvedAtr20avg = pickNumericWithSource([{ value: c.atr20avg, source: 'atr20avg' }, { value: quote?.atr20avg, source: 'quote.atr20avg' }, { value: c.symbolFeatures?.atr20avg, source: 'symbolFeatures.atr20avg' }, { value: conditionResults?.atr20avg, source: 'conditionResults.atr20avg' }, { value: technicalIndicators?.atr20avg, source: 'technicalIndicators.atr20avg' }]);
    const sourceMap: Record<string, string> = {};
    if (resolvedPrice.source) sourceMap.price = resolvedPrice.source;
    if (resolvedMa20.source) sourceMap.ma20 = resolvedMa20.source;
    if (resolvedMa60.source) sourceMap.ma60 = resolvedMa60.source;
    if (resolvedRsi14.source) sourceMap.rsi14 = resolvedRsi14.source;
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
      technicalIndicators: c.technicalIndicators,
      technicalFieldSourceMap: sourceMap,
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
      price: resolvedPrice.value ?? symbolFeatures?.price ?? undefined,
      currentPrice: c.currentPrice ?? c.price ?? ((symbolFeatures as Record<string, unknown> | undefined)?.currentPrice as number | undefined),
      high5d: c.high5d ?? ((symbolFeatures as Record<string, unknown> | undefined)?.high5d as number | undefined),
      high20d: c.high20d ?? ((symbolFeatures as Record<string, unknown> | undefined)?.high20d as number | undefined),
      high60: c.high60 ?? ((symbolFeatures as Record<string, unknown> | undefined)?.high60 as number | undefined),
      volumeRatio: c.volumeRatio ?? ((symbolFeatures as Record<string, unknown> | undefined)?.volumeRatio as number | undefined),
      aboveMA20: c.aboveMA20,
      aboveMA60: c.aboveMA60,
      ma20: resolvedMa20.value ?? symbolFeatures?.ma20 ?? undefined,
      ma60: resolvedMa60.value ?? symbolFeatures?.ma60 ?? undefined,
      rsi14: resolvedRsi14.value ?? symbolFeatures?.rsi14 ?? undefined,
      atr: resolvedAtr.value ?? symbolFeatures?.atr ?? undefined,
      atr20avg: resolvedAtr20avg.value ?? symbolFeatures?.atr20avg ?? undefined,
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

  // Step-29 RS wiring cleanup:
  // If rsRankPct / relativeStrengthScore are missing but relativeReturn20d is available,
  // compute cross-sectional percentile rank and map it to a deterministic score curve.
  const rsUniverse = traces
    .map((t) => ({ trace: t, rr20: typeof t.relativeReturn20d === 'number' && Number.isFinite(t.relativeReturn20d) ? t.relativeReturn20d : null }))
    .filter((row): row is { trace: typeof traces[number]; rr20: number } => row.rr20 !== null)
    .sort((a, b) => b.rr20 - a.rr20);
  const denom = Math.max(1, rsUniverse.length - 1);
  rsUniverse.forEach((row, index) => {
    const pct = rsUniverse.length <= 1 ? 100 : ((denom - index) / denom) * 100;
    if (!Number.isFinite(row.trace.rsRankPct as number)) row.trace.rsRankPct = Math.max(0, Math.min(100, Number(pct.toFixed(1))));
    if (!Number.isFinite(row.trace.relativeStrengthScore as number)) {
      const p = row.trace.rsRankPct ?? 0;
      row.trace.relativeStrengthScore = p >= 90 ? 10 : p >= 80 ? 8 : p >= 60 ? 5 : p >= 50 ? 2 : 0;
    }
  });

  const diagnosticBlockReason = String(input.macroGateState?.liveEntryBlockedReason ?? '').toUpperCase();
  const removedPolicyDiagnosticBlock = diagnosticBlockReason.includes('SELL_ONLY') || diagnosticBlockReason.includes('R6_DEFENSE');
  if (input.macroGateState?.diagnosticLiveEntryBlocked && !removedPolicyDiagnosticBlock) {
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

  // ADR patch: Kelly/sizing is advisory-only and must not be an entry hard block.
  // Keep telemetry via wait distribution and Kelly trace while removing execution blockers.
  const sizingFail = wd?.sizingBlocked ?? 0;
  if (sizingFail > 0) {
    const advisoryTag = 'SIZING_ADVISORY_LOW';
    for (const trace of traces.slice(gate1Fail + gate2Fail + gate3Fail, gate1Fail + gate2Fail + gate3Fail + sizingFail)) {
      trace.notes = Array.isArray(trace.notes) ? trace.notes : [];
      if (!trace.notes.includes(advisoryTag)) trace.notes.push(advisoryTag);
    }
  }

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
            "SectorEnergy is diagnostic/degraded; high-conviction evidence is score/diagnostic only.",
          executionBlocking: "NONE",
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
    blockedByTimeWindow: 0,
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
