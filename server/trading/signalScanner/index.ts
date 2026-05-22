/**
 * @responsibility 자동 신호 스캔 오케스트레이터 — preflight→후보→평가→주문→승인→진단 6단계 조율
 *
 * ADR-0001 (개정 2026-04-25) 의 7모듈 구조 진입점. 본 파일은 기존
 * `server/trading/signalScanner.ts` 의 `runAutoSignalScan` 본체를 6단계 조율
 * 코드(200줄 이내 목표) 로 축약하여 받아들이는 위치다.
 *
 * Phase 2 (스캐폴딩) 단계에서는 시그니처만 정의하고 구현은 후속 Phase 3 에서
 * 단계별로 채워진다. 외부 importer 9개의 import 경로(`server/trading/signalScanner.js`)
 * 는 barrel 로 유지되며 본 파일은 그 barrel 의 단일 진입 export 만 담당한다.
 */

import { runPreflight } from './preflight.js';
import { selectCandidates } from './candidateSelect.js';
import { evaluateMainCandidates, evaluateIntradayCandidates } from './perSymbolEvaluation.js';
import { createApprovalQueueState, flushApprovalQueue } from './approvalQueue.js';
import { dispatchApprovedBuy } from './orderDispatch.js';
import { createScanCounters, persistScanResults } from './scanDiagnostics.js';
import { attachPreflightBlockedPerSymbolSupplyInjection } from './preflightBlockedScanSummary.js';
import { conditionResultsTraceToMap, projectGateOutputsToConditionResultsTrace } from './gateConditionResultTrace.js';
import {
  createDefaultInvestorFlowRouter,
  injectPerSymbolSupplyContext,
  type PerSymbolSupplyInjectionStats,
} from './injectPerSymbolSupplyContext.js';
import {
  deriveNormalSupplyPreviewEngineMode,
  persistNormalSupplyPreview,
} from './normalSupplyPreview.js';
import { applyR6ShadowCounterfactualEntries } from './r6ShadowCounterfactualEntryPolicy.js';
// Patch-MARKET-PROGRAM-CARRY-WIRING-001 — Branch A wiring: PREFLIGHT_ABORT_DIAGNOSTIC
// + RUNTIME_DIAGNOSTIC 의 persistNormalSupplyPreview 호출에 marketProgramFlow 4 필드
// carry SSOT 위임. 호출자 측 inline ENV 검사 0건 (SSOT 헬퍼 위임 의무).
import { buildMarketProgramFlowCarryPayload } from './marketProgramCarryWiringPolicy.js';
import type { ShadowCandidateScanTrigger } from '../marketStateResolver.js';

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pickNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const n = finiteOrNull(value);
    if (n !== null) return n;
  }
  return null;
}

function buildSafeQuoteFeatures(w: any): Record<string, unknown> {
  const q = w.quote && typeof w.quote === 'object' ? w.quote : {};
  const sf = w.symbolFeatures && typeof w.symbolFeatures === 'object' ? w.symbolFeatures : {};
  return {
    symbol: typeof q.symbol === 'string' ? q.symbol : w.code,
    code: typeof q.code === 'string' ? q.code : w.code,
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
  if (w.conditionResults && typeof w.conditionResults === 'object') return w.conditionResults;
  return conditionResultsTraceToMap(
    w.conditionResultsTrace ?? projectGateOutputsToConditionResultsTrace(w.gateEvaluation?.outputs),
  );
}

function buildConditionResultsTraceArray(w: any) {
  return Array.isArray(w.conditionResultsTrace)
    ? w.conditionResultsTrace
    : projectGateOutputsToConditionResultsTrace(w.gateEvaluation?.outputs);
}

function toHydrationState(value: unknown): 'HYDRATED' | 'MISSING' | 'UNAVAILABLE' {
  if (value === null) return 'UNAVAILABLE';
  if (value === undefined) return 'MISSING';
  return 'HYDRATED';
}

function buildCandidateSnapshotSsot(w: any, macro?: { kospi20dReturn?: number }) {
  const conditionResults = buildConditionResultsTrace(w);
  const gate1Pass = w.gate1Result?.pass === true || w.gateEvaluation?.passed === true;
  const gate2Pass = w.gate2Result?.pass === true;
  const gate3Pass = w.gate3Result?.pass === true;
  return {
    supplyProviderHealth: w.supplyProviderHealth,
    symbol: w.code,
    name: w.name,
    market: w.market ?? 'KRX',
    stageReached: 'WATCHLIST' as const,
    quote: buildSafeQuoteFeatures(w),
    symbolFeatures: w.symbolFeatures,
    conditionResults,
    supplyContext: w.supplyContext,
    sectorContext: w.sectorContext,
    financialContext: w.financialContext,
    riskContext: w.riskContext,
    gate1Result: w.gate1Result ?? { pass: gate1Pass },
    gate2Result: w.gate2Result ?? { pass: gate2Pass },
    gate3Result: w.gate3Result ?? { pass: gate3Pass },
    entryScore: w.entryScore ?? w.score ?? w.gateScore,
    entryDecision: w.entryDecision ?? (w.approved ? 'APPROVED' : 'REJECTED'),
    sourcePath: 'NORMAL_SCAN_PIPELINE',
    snapshotId: `${w.code}:${Date.now()}`,
    asOf: new Date().toISOString(),
    diagnosticOnly: false,
    shadowObservableAllowed: true,
    shadowExecutionAllowed: w.shadowExecutionAllowed ?? true,
    liveExecutionAllowed: w.liveExecutionAllowed ?? false,
    realOrderAllowed: w.realOrderAllowed ?? false,
    executionImpact: w.liveExecutionAllowed ? 'LIVE_ALLOWED' : 'SHADOW_ONLY',
    quoteHydrated: toHydrationState(w.quote),
    symbolFeaturesHydrated: toHydrationState(w.symbolFeatures),
    conditionResultsHydrated: toHydrationState(conditionResults),
    supplyContextHydrated: toHydrationState(w.supplyContext),
    sectorContextHydrated: toHydrationState(w.sectorContext),
    financialContextHydrated: toHydrationState(w.financialContext),
    riskContextHydrated: toHydrationState(w.riskContext),
    price: w.symbolFeatures?.price ?? w.entryPrice ?? w.quote?.price ?? w.quote?.currentPrice,
    currentPrice: w.symbolFeatures?.currentPrice ?? w.quote?.currentPrice ?? w.entryPrice,
    volume: w.symbolFeatures?.volume ?? w.quote?.volume,
    volumeRatio: w.symbolFeatures?.volumeRatio ?? w.quote?.volumeRatio,
    turnover: w.turnover ?? w.quote?.turnover,
    ma20: w.symbolFeatures?.ma20 ?? w.quote?.ma20,
    ma60: w.symbolFeatures?.ma60 ?? w.quote?.ma60,
    rsi14: w.symbolFeatures?.rsi14 ?? w.quote?.rsi14,
    atr: w.symbolFeatures?.atr ?? w.quote?.atr,
    atr20avg: w.symbolFeatures?.atr20avg ?? w.quote?.atr20avg,
    relativeStrength: w.relativeStrength ?? w.symbolFeatures?.relativeStrength,
    breakoutScore: w.breakoutScore ?? w.symbolFeatures?.breakoutScore,
    trendScore: w.trendScore ?? w.symbolFeatures?.trendScore,
    investorFlow: w.investorFlow,
    kospi20dReturn: w.kospi20dReturn ?? w.symbolFeatures?.kospi20dReturn ?? macro?.kospi20dReturn,
  };
}

async function collectPreflightAbortDiagnostics(
  preflightResult: any,
  options?: RunAutoSignalScanOptions,
  counters?: ReturnType<typeof createScanCounters>,
): Promise<PerSymbolSupplyInjectionStats | undefined> {
  const context = preflightResult?.context;
  if (!Array.isArray(context?.watchlist) || context.watchlist.length === 0) {
    return undefined;
  }

  try {
    const diagnosticCandidates = await selectCandidates(context, options);
    const injected = await injectPerSymbolSupplyContext({
      candidates: diagnosticCandidates.buyList,
      investorFlowRouter: createDefaultInvestorFlowRouter(),
    });
    attachPreflightBlockedPerSymbolSupplyInjection(injected.stats);
    const preview = persistNormalSupplyPreview({
      engineMode: deriveNormalSupplyPreviewEngineMode({
        sellOnly: options?.sellOnly,
        blockedBy: preflightResult?.blockedBy,
        preflightDecision: preflightResult?.preflightDecision,
        macroGateState: preflightResult?.diagnosticData?.macroGateState ?? preflightResult?.context?.macroGateState,
        liveEntryBlockedReason: preflightResult?.context?.liveEntryBlockedReason,
      }),
      source: 'PREFLIGHT_ABORT_DIAGNOSTIC',
      reason: preflightResult?.preflightDecision ?? preflightResult?.blockedBy ?? 'PRE_FLIGHT_BLOCK',
      preflightDecision: preflightResult?.preflightDecision,
      candidates: injected.candidates,
      supplyInjection: injected.stats,
      // Patch-MARKET-PROGRAM-CARRY-WIRING-001 — Branch A: macroState 4 필드 (programNetBuyAmount/
      // programArbitrageNetBuy/programFetchedAt/programSource) carry SSOT. ENV disabled / macroState
      // 부재 시 undefined 자연 fallback. diagnostic-only path (executionImpact='NONE' literal).
      marketProgramFlow: buildMarketProgramFlowCarryPayload(preflightResult?.context?.macroState),
      marketProgramCarrySource: preflightResult?.context?.macroState,
    });
    if (counters) {
      counters.r6ShadowEntryPolicy = applyR6ShadowCounterfactualEntries({
        preview,
        rawCandidates: injected.candidates,
        macroGateState: preflightResult?.diagnosticData?.macroGateState ?? preflightResult?.context?.macroGateState,
        shadowScanAllowed: true,
      });
    }
    console.info('[AutoTrade/Diagnostics] preflight-blocked supply diagnostics collected', {
      blockedBy: preflightResult?.preflightDecision ?? preflightResult?.blockedBy ?? 'PRE_FLIGHT_BLOCK',
      buyList: injected.stats.totalCandidates,
      requestedSymbols: injected.stats.requestedSymbols,
      verified: injected.stats.verified,
      degraded: injected.stats.degraded,
      stale: injected.stats.stale,
      missing: injected.stats.missing,
      unknown: injected.stats.unknown,
    });
    return injected.stats;
  } catch (error) {
    console.warn(
      '[AutoTrade/Diagnostics] preflight-blocked supply diagnostics failed; live block preserved',
      error instanceof Error ? error.message : String(error),
    );
    return undefined;
  }
}


export interface RunAutoSignalScanOptions {
  sellOnly?: boolean;
  forceBuyCodes?: string[];
  candidateScanTrigger?: ShadowCandidateScanTrigger;
}

export interface RunAutoSignalScanResult {
  positionFull?: boolean;
}

/**
 * 자동 신호 스캔 진입점. Phase 3 마이그레이션 전에는 호출 시 throw 하며,
 * 기존 `server/trading/signalScanner.ts` 의 동일 export 가 활성 경로다.
 */
export async function runAutoSignalScan(
  options?: RunAutoSignalScanOptions,
): Promise<RunAutoSignalScanResult> {
  const counters = createScanCounters();

  // 1. Preflight (거시/시스템 환경 평가 및 게이팅)
  const preflightResult = await runPreflight(options);
  if (preflightResult.shouldAbortEngine || preflightResult.shouldAbort) {
    const preflightAbortSupplyInjection = await collectPreflightAbortDiagnostics(preflightResult, options, counters);
    if (!preflightResult.skipPersist) {
      // ADR-0187: preflight abort 경로도 sectorEnergy meta carry-over (정상 경로와 정합).
      // ADR-0423: sectorEnergyQualityDiagnostic 도 함께 carry-over (옵셔널, 후방호환).
      const abortMacro = preflightResult.context?.macroState as
        | {
            sectorEnergyDataQuality?: 'OK' | 'PARTIAL' | 'STALE' | 'FAILED';
            sectorEnergyValidSectorCount?: number;
            sectorEnergyReasons?: string[];
            sectorEnergyQualityDiagnostic?: import('../../clients/sectorEnergyQualityDiagnostic.js').SectorEnergyQualityDiagnostic;
            kospi20dReturn?: number;
          }
        | undefined;
      await persistScanResults(counters, {
        sellOnly: options?.sellOnly,
        ...preflightResult.diagnosticData,
        ...(options?.candidateScanTrigger ? { candidateScanTrigger: options.candidateScanTrigger } : {}),
        ...(preflightAbortSupplyInjection ? { perSymbolSupplyInjection: preflightAbortSupplyInjection } : {}),
        ...(abortMacro?.sectorEnergyDataQuality !== undefined ? {
          sectorEnergyQuality: abortMacro.sectorEnergyDataQuality,
          validSectorCount: abortMacro.sectorEnergyValidSectorCount,
          sectorEnergyReasons: abortMacro.sectorEnergyReasons,
        } : {}),
        ...(abortMacro?.sectorEnergyQualityDiagnostic !== undefined
          ? { sectorEnergyQualityDiagnostic: abortMacro.sectorEnergyQualityDiagnostic }
          : {}),
      });
    }
    return { positionFull: preflightResult.positionFull };
  }

  // 2. Candidate Select (관심종목 3섹션 및 Intraday 후보군 선정)
  const candidates = await selectCandidates(preflightResult.context, options);
  let perSymbolSupplyInjection: PerSymbolSupplyInjectionStats | undefined;
  try {
    const injected = await injectPerSymbolSupplyContext({
      candidates: candidates.buyList,
      investorFlowRouter: createDefaultInvestorFlowRouter(),
    });
    candidates.buyList = injected.candidates;
    candidates.mainList = injected.candidates;
    perSymbolSupplyInjection = injected.stats;
    if (Array.isArray(candidates.intradayList) && candidates.intradayList.length > 0) {
      const intradayInjected = await injectPerSymbolSupplyContext({
        candidates: candidates.intradayList,
        investorFlowRouter: createDefaultInvestorFlowRouter(),
      });
      candidates.intradayList = intradayInjected.candidates;
    }
    const normalSupplyPreviewAllowed =
      options?.sellOnly === true ||
      preflightResult.context?.optSellOnly === true ||
      preflightResult.context?.macroDiagnosticOnly === true ||
      preflightResult.context?.diagnosticOnlyLiveBlock === true ||
      preflightResult.macroGateState?.sellOnlyMode === true ||
      preflightResult.macroGateState?.diagnosticLiveEntryBlocked === true;
    if (normalSupplyPreviewAllowed) {
      const preview = persistNormalSupplyPreview({
        engineMode: deriveNormalSupplyPreviewEngineMode({
          sellOnly: options?.sellOnly,
          macroGateState: preflightResult.macroGateState,
          liveEntryBlockedReason: preflightResult.context?.liveEntryBlockedReason,
        }),
        source: 'RUNTIME_DIAGNOSTIC',
        reason: preflightResult.context?.liveEntryBlockedReason ?? 'diagnostic live-entry block',
        candidates: injected.candidates,
        supplyInjection: injected.stats,
        // Patch-MARKET-PROGRAM-CARRY-WIRING-001 — Branch A: macroState 4 필드 (programNetBuyAmount/
        // programArbitrageNetBuy/programFetchedAt/programSource) carry SSOT. ENV disabled / macroState
        // 부재 시 undefined 자연 fallback. diagnostic-only path (executionImpact='NONE' literal).
        marketProgramFlow: buildMarketProgramFlowCarryPayload(preflightResult.context?.macroState),
        marketProgramCarrySource: preflightResult.context?.macroState,
      });
      counters.r6ShadowEntryPolicy = applyR6ShadowCounterfactualEntries({
        preview,
        rawCandidates: injected.candidates,
        macroGateState: preflightResult.macroGateState,
        shadowScanAllowed: true,
      });
    }
  } catch (error) {
    console.warn(
      '[PER_SYMBOL_SUPPLY_CONTEXT_INJECTION] failed before evaluation; continuing',
      error instanceof Error ? error.message : String(error),
    );
  }

  // 3. Per-Symbol Evaluation (매수 조건 검증, 큐/포지션/가용현금 상태관리 공유)
  const queueState = createApprovalQueueState(preflightResult.context.orderableCash);
  await evaluateMainCandidates(candidates, preflightResult.context, counters, queueState);

  // 4. Approval Queue (승인 일괄 처리 및 실패한 가용 현금 롤백)
  const approvedTasks = await flushApprovalQueue(queueState);

  // 4.5. Intraday Evaluation (장중 스캔은 환불된 현금을 반영한 후 평가)
  await evaluateIntradayCandidates(candidates, preflightResult.context, counters, queueState, options);

  // 5. Order Dispatch (실 KIS 주문 발송 및 알림)
  if (!preflightResult.shouldAbortLiveOrder) {
    await dispatchApprovedBuy(approvedTasks, preflightResult.context);
  }

  // 6. Diagnostics (스캔 이력, 차단 사유 통계 및 영속화)
  // ADR-0187: macroState.sectorEnergy* 3 필드 carry-over → ScanSummary.sectorEnergyQuality/
  // validSectorCount/sectorEnergyReasons 영속 → /scan_blockers 메시지의 §"섹터 에너지 데이터
  // 품질" 섹션 활성. 이전엔 macroState 영속만 있고 read 호출자 0건 (silent dead-read).
  // ADR-0423: sectorEnergyQualityDiagnostic 도 함께 carry-over.
  const macro = preflightResult.context?.macroState as
    | {
        sectorEnergyDataQuality?: 'OK' | 'PARTIAL' | 'STALE' | 'FAILED';
        sectorEnergyValidSectorCount?: number;
        sectorEnergyReasons?: string[];
        sectorEnergyQualityDiagnostic?: import('../../clients/sectorEnergyQualityDiagnostic.js').SectorEnergyQualityDiagnostic;
        kospi20dReturn?: number;
      }
    | undefined;
  await persistScanResults(counters, {
    sellOnly: options?.sellOnly,
    ...candidates.lengths,
    ...(perSymbolSupplyInjection ? { perSymbolSupplyInjection } : {}),
    ...(options?.candidateScanTrigger ? { candidateScanTrigger: options.candidateScanTrigger } : {}),
    macroGateState: preflightResult.macroGateState,
    ...(macro?.sectorEnergyDataQuality !== undefined ? {
      sectorEnergyQuality: macro.sectorEnergyDataQuality,
      validSectorCount: macro.sectorEnergyValidSectorCount,
      sectorEnergyReasons: macro.sectorEnergyReasons,
    } : {}),
    ...(macro?.sectorEnergyQualityDiagnostic !== undefined
      ? { sectorEnergyQualityDiagnostic: macro.sectorEnergyQualityDiagnostic }
      : {}),
    candidateSnapshots: [
      ...candidates.buyList.map((w: any) => ({
        ...buildCandidateSnapshotSsot(w, macro),
        // ADR-0517 (Patch ADR-P0-SUPPLY-WIRE) — buyListLoop 가 KIS actual investor flow 를
        // 종목별 fetch 후 stock.supplyProviderHealth 에 매핑한 결과를 forensic collector 로 propagate.
        // 본 필드 누락 시 mergeSupplyProviderHealth fallback 의 w.supplyProviderHealth 가
        // candidate snapshot 에 도달하지 못해 forensic semanticAvailable=0/N 결함 재발.
        supplyProviderHealth: w.supplyProviderHealth,
        symbol: w.code,
        name: w.name,
        stageReached: 'WATCHLIST' as const,
        gateScore: w.gateScore,
        totalGateScore: w.totalGateScore ?? w.gateScore,
        stage1Score: w.stage1Score,
        stage2Score: w.stage2Score,
        watchlistScore: w.watchlistPriorityScore ?? w.watchlistScore,
        upstreamCandidateScore: w.upstreamCandidateScore,
        watchlistRank: w.watchlistRank,
        totalCandidates: w.totalCandidates,
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
        watchlistReason: w.watchlistReason ?? w.reason,
        symbolFeatures: w.symbolFeatures,
        relativeStrengthScore: w.relativeStrengthScore ?? w.symbolFeatures?.relativeStrengthScore,
        relativeStrength: w.relativeStrength ?? w.symbolFeatures?.relativeStrength,
        rsRankPct: w.rsRankPct ?? w.symbolFeatures?.rsRankPct,
        marketRelativeReturn: w.marketRelativeReturn ?? w.symbolFeatures?.marketRelativeReturn,
        relativeReturn20d: w.relativeReturn20d ?? w.symbolFeatures?.relativeReturn20d,
        return20d: w.return20d ?? w.symbolFeatures?.return20d ?? w.quote?.return20d,
        return5d: w.return5d ?? w.symbolFeatures?.return5d ?? w.quote?.return5d,
        kospi20dReturn: w.kospi20dReturn ?? w.symbolFeatures?.kospi20dReturn ?? macro?.kospi20dReturn,
        quote: buildSafeQuoteFeatures(w),
        price: w.symbolFeatures?.price ?? w.entryPrice ?? w.quote?.price ?? w.quote?.currentPrice,
        currentPrice: w.symbolFeatures?.currentPrice ?? w.quote?.currentPrice ?? w.entryPrice,
        high5d: w.symbolFeatures?.high5d ?? w.quote?.high5d,
        high20d: w.symbolFeatures?.high20d ?? w.quote?.high20d,
        high60: w.symbolFeatures?.high60 ?? w.quote?.high60,
        volume: w.symbolFeatures?.volume ?? w.quote?.volume,
        avgVolume: w.symbolFeatures?.avgVolume ?? w.quote?.avgVolume,
        volumeRatio: w.symbolFeatures?.volumeRatio ?? w.quote?.volumeRatio,
        ma20: w.symbolFeatures?.ma20 ?? w.quote?.ma20,
        ma60: w.symbolFeatures?.ma60 ?? w.quote?.ma60,
        aboveMA20: w.symbolFeatures?.aboveMA20,
        aboveMA60: w.symbolFeatures?.aboveMA60,
        conditionResults: buildConditionResultsTrace(w),
        breakoutSignals: w.breakoutSignals,
        breakout_momentum: w.breakout_momentum ?? (buildConditionResultsTrace(w) as any)?.breakout_momentum,
        turtle_high: w.turtle_high ?? (buildConditionResultsTrace(w) as any)?.turtle_high,
        volume_breakout: w.volume_breakout ?? (buildConditionResultsTrace(w) as any)?.volume_breakout,
        volume_surge: w.volume_surge ?? (buildConditionResultsTrace(w) as any)?.volume_surge,
        vcp: w.vcp ?? (buildConditionResultsTrace(w) as any)?.vcp,
        trend_acceleration: w.trend_acceleration ?? (buildConditionResultsTrace(w) as any)?.trend_acceleration,
      })),
      ...candidates.intradayList.map((w: any) => ({
        ...buildCandidateSnapshotSsot(w, macro),
        // ADR-0517: intradayLoop 가 매핑한 supplyProviderHealth 를 forensic collector 로 propagate.
        supplyProviderHealth: w.supplyProviderHealth,
        symbol: w.code,
        name: w.name,
        stageReached: 'WATCHLIST' as const,
        gateScore: w.gateScore,
        totalGateScore: w.totalGateScore ?? w.gateScore,
        stage1Score: w.stage1Score,
        stage2Score: w.stage2Score,
        watchlistScore: w.watchlistPriorityScore ?? w.watchlistScore,
        upstreamCandidateScore: w.upstreamCandidateScore,
        watchlistRank: w.watchlistRank,
        totalCandidates: w.totalCandidates,
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
        watchlistReason: w.watchlistReason ?? w.reason,
        symbolFeatures: w.symbolFeatures,
        relativeStrengthScore: w.relativeStrengthScore ?? w.symbolFeatures?.relativeStrengthScore,
        relativeStrength: w.relativeStrength ?? w.symbolFeatures?.relativeStrength,
        rsRankPct: w.rsRankPct ?? w.symbolFeatures?.rsRankPct,
        marketRelativeReturn: w.marketRelativeReturn ?? w.symbolFeatures?.marketRelativeReturn,
        relativeReturn20d: w.relativeReturn20d ?? w.symbolFeatures?.relativeReturn20d,
        return20d: w.return20d ?? w.symbolFeatures?.return20d ?? w.quote?.return20d,
        return5d: w.return5d ?? w.symbolFeatures?.return5d ?? w.quote?.return5d,
        kospi20dReturn: w.kospi20dReturn ?? w.symbolFeatures?.kospi20dReturn ?? macro?.kospi20dReturn,
        quote: buildSafeQuoteFeatures(w),
        price: w.symbolFeatures?.price ?? w.entryPrice ?? w.quote?.price ?? w.quote?.currentPrice,
        currentPrice: w.symbolFeatures?.currentPrice ?? w.quote?.currentPrice ?? w.entryPrice,
        high5d: w.symbolFeatures?.high5d ?? w.quote?.high5d,
        high20d: w.symbolFeatures?.high20d ?? w.quote?.high20d,
        high60: w.symbolFeatures?.high60 ?? w.quote?.high60,
        volume: w.symbolFeatures?.volume ?? w.quote?.volume,
        avgVolume: w.symbolFeatures?.avgVolume ?? w.quote?.avgVolume,
        volumeRatio: w.symbolFeatures?.volumeRatio ?? w.quote?.volumeRatio,
        ma20: w.symbolFeatures?.ma20 ?? w.quote?.ma20,
        ma60: w.symbolFeatures?.ma60 ?? w.quote?.ma60,
        aboveMA20: w.symbolFeatures?.aboveMA20,
        aboveMA60: w.symbolFeatures?.aboveMA60,
        conditionResults: buildConditionResultsTrace(w),
        breakoutSignals: w.breakoutSignals,
        breakout_momentum: w.breakout_momentum ?? (buildConditionResultsTrace(w) as any)?.breakout_momentum,
        turtle_high: w.turtle_high ?? (buildConditionResultsTrace(w) as any)?.turtle_high,
        volume_breakout: w.volume_breakout ?? (buildConditionResultsTrace(w) as any)?.volume_breakout,
        volume_surge: w.volume_surge ?? (buildConditionResultsTrace(w) as any)?.volume_surge,
        vcp: w.vcp ?? (buildConditionResultsTrace(w) as any)?.vcp,
        trend_acceleration: w.trend_acceleration ?? (buildConditionResultsTrace(w) as any)?.trend_acceleration,
      })),
    ],
    watchlistSource: 'signalScanner.selectCandidates',
  });

  return { positionFull: false };
}
