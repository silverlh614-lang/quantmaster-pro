/**
 * @responsibility 종목 단위 진입 검증 — Gate·RRR·liveGate·failure·corr·sizing·cooldown 평가
 */
import type { ScanCounters } from "./scanDiagnostics.js";
import { registerEntryCandidateSnapshots } from "./scanDiagnostics.js";
import { getSectorByCode } from "../../screener/sectorMap.js";
import { isOpenShadowStatus } from "../entryEngine.js";
import {
  decideProbingSlotBudget,
  buildArmKey,
  type BanditDecision,
} from "../../learning/probingBandit.js";
import { saveWatchlist } from "../../persistence/watchlistRepo.js";
import type { ApprovalQueueState } from "./approvalQueue.js";
import type { RunAutoSignalScanOptions } from "./index.js";
import { conditionResultsTraceToMap, projectGateOutputsToConditionResultsTrace } from "./gateConditionResultTrace.js";

// ADR-0134: barrel exports 복원
// ADR-0188 (lint baseline cleanup): perSymbol/index.ts 의 SSOT 통합 barrel 을 그대로 re-export.
// 이전엔 buyListLoop + intradayLoop 만 re-export 하여 helpers.SymbolExitContext + types.BuyListLoopMutables/
// IntradayLoopMutables/BuyListLoopContext/IntradayLoopContext 가 누락 — entryGates/types.ts +
// approvalQueue/applyApprovalReservation.ts + signalScanner.ts 의 import 경로 단절.
import { evaluateBuyList as executeBuyList } from "./perSymbol/buyListLoop.js";
import { evaluateIntradayList as executeIntradayList } from "./perSymbol/intradayLoop.js";
export * from "./perSymbol/index.js";

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pickNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const n = finiteOrNull(value);
    if (n !== null) return n;
  }
  return null;
}


function normalizeSymbolKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/[^0-9]/g, "");
  return digits.length >= 6 ? digits.slice(-6) : digits || value;
}

function supplyRouterPayloadForSymbol(context: any, symbol: unknown): Record<string, unknown> | undefined {
  const key = normalizeSymbolKey(symbol);
  if (!key) return undefined;
  const source = context?.supplyRouterResult ?? context?.investorFlowRouteResult ?? context?.investorFlowRouter;
  const bySymbol = source?.bySymbol;
  if (!bySymbol || typeof bySymbol !== "object") return undefined;
  const payload = bySymbol[key] ?? bySymbol[String(symbol)];
  return payload && typeof payload === "object" ? payload : undefined;
}

function mergeSupplyProviderHealth(w: any, context: any): Record<string, unknown> | undefined {
  const supplyContext = w.preflight?.supplyContext ?? w.supplyContext;
  if (supplyContext && typeof supplyContext === "object") {
    return {
      ...(w.supplyProviderHealth ?? {}),
      status: supplyContext.supplyProviderHealth === "MISSING" ? "MISSING" : supplyContext.supplyProviderHealth,
      providerName: supplyContext.provider === "NONE" ? "investor-flow" : supplyContext.provider,
      lastSampleAt: supplyContext.fetchedAt,
      sampleCountRecent: supplyContext.supplyProviderHealth === "VERIFIED" ? 1 : 0,
      hasForeignFlow: supplyContext.foreignNetBuyAmount !== undefined,
      hasInstitutionFlow: supplyContext.institutionNetBuyAmount !== undefined,
      hasProgramFlow: supplyContext.programNetBuyAmount !== undefined,
      providerIssue: supplyContext.providerIssue,
      marketSignal: supplyContext.marketSignal,
      gate1Severity: supplyContext.supplyProviderHealth === "VERIFIED" ? "NONE" : "SOFT_FAIL",
      requestSymbol: supplyContext.symbol,
      candidateSymbol: supplyContext.symbol,
      normalizedSymbol: supplyContext.symbol,
      providerScope: "SYMBOL_LEVEL",
      routePurpose: "BUY_CANDIDATE_PREFLIGHT",
      materialized: supplyContext.supplyProviderHealth === "VERIFIED",
      usableForRouter: supplyContext.supplyProviderHealth === "VERIFIED",
      usableForGate: false,
      usableForLive: false,
      usableForShadow: true,
      semanticNetBuyStatus: supplyContext.rawStatus,
      semanticNetBuySignal: supplyContext.supplySignal === "UNUSABLE" ? "UNKNOWN" : supplyContext.supplySignal,
      diagnostics: [
        `perSymbolSupplyContext=${supplyContext.supplyProviderHealth}`,
        `executionImpact=${supplyContext.executionImpact}`,
      ],
      reason: [
        supplyContext.supplyProviderHealth === "VERIFIED"
          ? "per-symbol investor-flow verified"
          : `per-symbol investor-flow ${String(supplyContext.supplyProviderHealth).toLowerCase()}: ${supplyContext.rawStatus ?? "n/a"}`,
      ],
    };
  }
  const payload = supplyRouterPayloadForSymbol(context, w.code);
  if (!payload) return w.supplyProviderHealth;
  return {
    ...(w.supplyProviderHealth ?? {}),
    actualInvestorRow: payload.actualInvestorRow,
    normalizedInvestorRow: payload.normalizedInvestorRow,
    semanticInvestorRow: payload.semanticInvestorRow,
    supplySemanticRow: payload.supplySemanticRow ?? payload.semanticInvestorRow,
    actualInvestorFlowRows: payload.actualInvestorFlowRows,
    actualInvestorFlowRowCount: payload.actualInvestorFlowRowCount,
    actualInvestorFlowRowSourcePath: payload.actualInvestorFlowRowSourcePath,
    actualInvestorFlowFieldKeys: payload.actualInvestorFlowFieldKeys,
    actualInvestorFlowNumericKeys: payload.actualInvestorFlowNumericKeys,
    actualInvestorFlowNumericStringKeys: payload.actualInvestorFlowNumericStringKeys,
    actualInvestorFlowCarried: payload.actualInvestorFlowCarried,
    selectedCandidate: {
      actualInvestorRow: payload.actualInvestorRow,
      normalizedInvestorRow: payload.normalizedInvestorRow,
      semanticInvestorRow: payload.semanticInvestorRow,
      supplySemanticRow: payload.supplySemanticRow ?? payload.semanticInvestorRow,
      actualInvestorFlowRows: payload.actualInvestorFlowRows,
      actualInvestorFlowRowCount: payload.actualInvestorFlowRowCount,
      actualInvestorFlowRowSourcePath: payload.actualInvestorFlowRowSourcePath,
      actualInvestorFlowFieldKeys: payload.actualInvestorFlowFieldKeys,
      actualInvestorFlowNumericKeys: payload.actualInvestorFlowNumericKeys,
      actualInvestorFlowNumericStringKeys: payload.actualInvestorFlowNumericStringKeys,
      actualInvestorFlowCarried: payload.actualInvestorFlowCarried,
    },
  };
}

function buildSafeQuoteFeatures(w: any): Record<string, unknown> {
  const q = w.quote && typeof w.quote === "object" ? w.quote : {};
  const sf = w.symbolFeatures && typeof w.symbolFeatures === "object" ? w.symbolFeatures : {};
  return {
    symbol: typeof q.symbol === "string" ? q.symbol : w.code,
    code: typeof q.code === "string" ? q.code : w.code,
    price: pickNumber(q.price, q.currentPrice, sf.price, sf.currentPrice, w.entryPrice),
    changePercent: pickNumber(q.changePercent, sf.changePercent),
    return5d: pickNumber(q.return5d, sf.return5d, w.return5d),
    return20d: pickNumber(q.return20d, sf.return20d, w.return20d),
    high5d: pickNumber(q.high5d, sf.high5d),
    high20d: pickNumber(q.high20d, q.high20, sf.high20d, sf.high20),
    high20: pickNumber(q.high20, q.high20d, sf.high20, sf.high20d),
    high60: pickNumber(q.high60, sf.high60),
    volume: pickNumber(q.volume, sf.volume),
    avgVolume: pickNumber(q.avgVolume, sf.avgVolume),
    ma5: pickNumber(q.ma5, sf.ma5),
    ma20: pickNumber(q.ma20, sf.ma20),
    ma60: pickNumber(q.ma60, sf.ma60),
    rsi14: pickNumber(q.rsi14, sf.rsi14),
    atr: pickNumber(q.atr, sf.atr),
    atr20avg: pickNumber(q.atr20avg, sf.atr20avg),
    bbWidthCurrent: pickNumber(q.bbWidthCurrent, sf.bbWidthCurrent),
    bbWidth20dAvg: pickNumber(q.bbWidth20dAvg, sf.bbWidth20dAvg),
    vol5dAvg: pickNumber(q.vol5dAvg, sf.vol5dAvg),
    vol20dAvg: pickNumber(q.vol20dAvg, sf.vol20dAvg),
  };
}

function buildConditionResultsTrace(w: any): Record<string, unknown> | undefined {
  if (w.conditionResults && typeof w.conditionResults === "object") return w.conditionResults;
  const projected = conditionResultsTraceToMap(
    w.conditionResultsTrace ?? projectGateOutputsToConditionResultsTrace(w.gateEvaluation?.outputs),
  );
  return projected;
}

function buildConditionResultsTraceArray(w: any) {
  return Array.isArray(w.conditionResultsTrace)
    ? w.conditionResultsTrace
    : projectGateOutputsToConditionResultsTrace(w.gateEvaluation?.outputs);
}


export async function evaluateMainCandidates(
  candidates: any,
  context: any,
  counters: ScanCounters,
  queueState: ApprovalQueueState,
): Promise<void> {
  const { buyList, swingList } = candidates;
  const {
    watchlist,
    shadows,
    shadowMode,
    totalAssets,
    effectiveMaxPositions,
    regime,
    regimeConfig,
    macroState,
    vixGating,
    fomcProximity,
    kellyMultiplier,
    accountKellyMultiplier,
    sellOnlyExc,
    volumeClock,
    conditionWeights,
    supplyHealthSnapshot,
    positionFullDiagnosticOnly,
    liveEntryBlockedReason,
  } = context;

  // Patch-SUPPLY-DIAG-ACCURACY (silent UNKNOWN 차단): preflight context 가 종목별
  // 투자자수급 라우터 결과(supplyRouterResult/investorFlowRouteResult/investorFlowRouter)를
  // 전혀 담지 않으면 mergeSupplyProviderHealth 가 모든 후보에 대해 w.supplyProviderHealth(=UNKNOWN)
  // 를 그대로 반환 → 전 후보 supplyConfluence/investorFlow UNKNOWN 페널티. 이전엔 이게 조용히
  // 발생했다. 1회성 진단 로그로 표면화한다 (executionImpact=NONE, 매매 결정 무변경).
  if (
    !buyList.some((w: any) => w.preflight?.supplyContext || w.supplyContext) &&
    !context?.supplyRouterResult &&
    !context?.investorFlowRouteResult &&
    !context?.investorFlowRouter
  ) {
    console.warn(
      `[AutoTrade/SupplyHealth] preflight context 에 투자자수급 라우터 결과 없음 — ` +
        `buyList ${Array.isArray(buyList) ? buyList.length : 0}개 후보 전부 ` +
        `supplyProviderHealth=UNKNOWN 으로 디폴트됨 (per-symbol investor-flow 미페치, ` +
        `SUPPLY_PROVIDER_UNKNOWN_PENALTY 근본 원인). executionImpact=NONE`,
    );
  }

  registerEntryCandidateSnapshots(
    counters,
    buyList.map((w: any) => ({
      symbol: w.code,
      name: w.name,
      stageReached: "WATCHLIST" as const,
      gateScore: w.gateScore,
      totalGateScore: w.totalGateScore ?? w.gateScore,
      stage1Score: w.stage1Score,
      stage2Score: w.stage2Score,
      watchlistScore: w.watchlistPriorityScore ?? w.watchlistScore,
      watchlistUpstreamScore: w.watchlistUpstreamScore,
      upstreamScore: w.upstreamScore ?? w.upstreamCandidateScore,
      priorityScore: w.watchlistPriorityScore ?? w.priorityScore,
      qualScore: w.qualScore,
      score: w.score,
      conditionKeys: w.conditionKeys ?? w.gateEvaluation?.conditionKeys,
      conditionResultsTrace: buildConditionResultsTraceArray(w),
      gateRawScore: w.gateRawScore ?? w.gateEvaluation?.rawScore ?? w.gateScore,
      normalizedGateScore: w.normalizedGateScore ?? w.gateEvaluation?.normalizedGateScore,
      availableMaxScore: w.availableMaxScore ?? w.gateEvaluation?.availableMaxScore,
      upstreamCandidateScore: w.upstreamCandidateScore,
      watchlistRank: w.watchlistRank,
      totalCandidates: w.totalCandidates,
      watchlistReason: w.watchlistReason ?? w.reason,
      relativeStrengthScore: w.relativeStrengthScore ?? w.symbolFeatures?.relativeStrengthScore,
      relativeStrength: w.relativeStrength ?? w.symbolFeatures?.relativeStrength,
      rsRankPct: w.rsRankPct ?? w.symbolFeatures?.rsRankPct,
      marketRelativeReturn: w.marketRelativeReturn ?? w.symbolFeatures?.marketRelativeReturn,
      relativeReturn20d: w.relativeReturn20d ?? w.symbolFeatures?.relativeReturn20d,
      kospiRelativeReturn: w.kospiRelativeReturn ?? w.symbolFeatures?.kospiRelativeReturn,
      quote: buildSafeQuoteFeatures(w),
      conditionResults: buildConditionResultsTrace(w),
      breakoutSignals: w.breakoutSignals,
      breakout_momentum: w.breakout_momentum ?? (buildConditionResultsTrace(w) as any)?.breakout_momentum,
      turtle_high: w.turtle_high ?? (buildConditionResultsTrace(w) as any)?.turtle_high,
      volume_breakout: w.volume_breakout ?? (buildConditionResultsTrace(w) as any)?.volume_breakout,
      volume_surge: w.volume_surge ?? (buildConditionResultsTrace(w) as any)?.volume_surge,
      vcp: w.vcp ?? (buildConditionResultsTrace(w) as any)?.vcp,
      trend_acceleration: w.trend_acceleration ?? (buildConditionResultsTrace(w) as any)?.trend_acceleration,
      symbolFeatures: {
        ...(w.symbolFeatures ?? {}),
        gateScore: w.symbolFeatures?.gateScore ?? w.gateScore,
        stage1Score: w.symbolFeatures?.stage1Score ?? w.stage1Score,
        stage2Score: w.symbolFeatures?.stage2Score ?? w.stage2Score,
        totalGateScore:
          w.symbolFeatures?.totalGateScore ?? w.totalGateScore ?? w.gateScore,
        watchlistPriorityScore:
          w.symbolFeatures?.watchlistPriorityScore ?? w.watchlistPriorityScore,
        sector: w.symbolFeatures?.sector ?? w.sector,
      },
      return20d: w.return20d ?? w.symbolFeatures?.return20d ?? w.quote?.return20d,
      return5d: w.return5d ?? w.symbolFeatures?.return5d ?? w.quote?.return5d,
      volume: w.symbolFeatures?.volume ?? w.quote?.volume,
      avgVolume: w.symbolFeatures?.avgVolume ?? w.quote?.avgVolume,
      projectedVolume: w.symbolFeatures?.projectedVolume,
      price: w.symbolFeatures?.price ?? w.entryPrice ?? w.quote?.price ?? w.quote?.currentPrice,
      currentPrice: w.symbolFeatures?.currentPrice ?? w.quote?.currentPrice ?? w.entryPrice,
      high5d: w.symbolFeatures?.high5d ?? w.quote?.high5d,
      high20d: w.symbolFeatures?.high20d ?? w.quote?.high20d,
      high60: w.symbolFeatures?.high60 ?? w.quote?.high60,
      volumeRatio: w.symbolFeatures?.volumeRatio ?? w.quote?.volumeRatio,
      aboveMA20: w.symbolFeatures?.aboveMA20,
      aboveMA60: w.symbolFeatures?.aboveMA60,
      ma20: w.symbolFeatures?.ma20 ?? w.quote?.ma20,
      ma60: w.symbolFeatures?.ma60 ?? w.quote?.ma60,
      rsi14: w.symbolFeatures?.rsi14,
      atr: w.symbolFeatures?.atr,
      atr20avg: w.symbolFeatures?.atr20avg,
      kospi20dReturn: w.symbolFeatures?.kospi20dReturn,
      gate1Passed: w.gateEvaluation?.gate1Passed,
      gate2Passed: w.gateEvaluation?.gate2Passed,
      gate3Passed: w.gateEvaluation?.gate3Passed,
      supplyProviderHealth: mergeSupplyProviderHealth(w, context),
    })),
  );

  const _banditCandidateArms: string[] = [];
  for (const w of buyList) {
    const sig = (w.gateScore ?? 0) >= 9 ? "STRONG_BUY" : "BUY";
    _banditCandidateArms.push(
      buildArmKey({ signalType: sig, profileType: w.profileType ?? null }),
    );
  }
  _banditCandidateArms.push("PROBING:X");
  const banditDecision: BanditDecision =
    decideProbingSlotBudget(_banditCandidateArms);
  if (banditDecision.budget > 1) {
    console.log(
      `[AutoTrade/Bandit] PROBING 동적 예산 ×${banditDecision.budget} (base 1) — ${banditDecision.rationale}`,
    );
  }

  for (const s of shadows) {
    if (!isOpenShadowStatus(s.status) || s.watchlistSource === "INTRADAY")
      continue;
    const sec = getSectorByCode(s.stockCode) || "미분류";
    const val = s.shadowEntryPrice * s.quantity;
    queueState.currentSectorValue.set(
      sec,
      (queueState.currentSectorValue.get(sec) ?? 0) + val,
    );
  }

  let watchlistMutated = false;
  const _reservedSlotsBox = { value: queueState.reservedSlots };
  const _probingReservedSlotsBox = { value: queueState.probingReservedSlots };
  const _orderableCashBox = { value: queueState.orderableCash };
  const _watchlistMutatedBox = { value: watchlistMutated };

  await executeBuyList({
    buyList,
    swingList,
    watchlist,
    shadows,
    shadowMode,
    totalAssets,
    effectiveMaxPositions,
    regime,
    regimeConfig,
    macroState,
    vixGating,
    fomcProximity,
    kellyMultiplier,
    accountKellyMultiplier,
    banditDecision,
    sellOnlyExc,
    volumeClock,
    conditionWeights,
    supplyHealthSnapshot,
    positionFullDiagnosticOnly,
    liveEntryBlockedReason,
    scanCounters: counters,
    mutables: {
      liveBuyQueue: queueState.liveBuyQueue,
      reservedSlots: _reservedSlotsBox,
      probingReservedSlots: _probingReservedSlotsBox,
      reservedTiers: queueState.reservedTiers,
      reservedIsMomentum: queueState.reservedIsMomentum,
      reservedBudgets: queueState.reservedBudgets,
      reservedSectorValues: queueState.reservedSectorValues,
      pendingSectorValue: queueState.pendingSectorValue,
      currentSectorValue: queueState.currentSectorValue,
      orderableCash: _orderableCashBox,
      watchlistMutated: _watchlistMutatedBox,
    },
  });

  queueState.reservedSlots = _reservedSlotsBox.value;
  queueState.probingReservedSlots = _probingReservedSlotsBox.value;
  queueState.orderableCash = _orderableCashBox.value;
  queueState.watchlistMutated = _watchlistMutatedBox.value;
}

export async function evaluateIntradayCandidates(
  candidates: any,
  context: any,
  counters: ScanCounters,
  queueState: ApprovalQueueState,
  options?: RunAutoSignalScanOptions,
): Promise<void> {
  const { intradayList: intradayBuyList } = candidates;
  const {
    watchlist,
    shadows,
    shadowMode,
    totalAssets,
    accountKellyMultiplier,
    kellyMultiplier,
    regime,
    regimeConfig,
    macroState,
    conditionWeights,
    supplyHealthSnapshot,
  } = context;

  const intradayMutables = {
    orderableCash: { value: queueState.orderableCash },
  };
  await executeIntradayList({
    intradayBuyList,
    shadows,
    shadowMode,
    totalAssets,
    accountKellyMultiplier,
    kellyMultiplier,
    regime,
    regimeConfig,
    macroState,
    conditionWeights,
    supplyHealthSnapshot,
    options: options ?? {},
    scanCounters: counters,
    mutables: intradayMutables,
  });
  queueState.orderableCash = intradayMutables.orderableCash.value;

  if (queueState.watchlistMutated) {
    saveWatchlist(watchlist);
  }
}
