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
import { extractGateLayerQuoteFeatureValues } from './gatePositiveFeatureMaterializer.js';
// Patch-MARKET-PROGRAM-CARRY-WIRING-001 — Branch A wiring: PREFLIGHT_ABORT_DIAGNOSTIC
// + RUNTIME_DIAGNOSTIC 의 persistNormalSupplyPreview 호출에 marketProgramFlow 4 필드
// carry SSOT 위임. 호출자 측 inline ENV 검사 0건 (SSOT 헬퍼 위임 의무).
import { buildMarketProgramFlowCarryPayload } from './marketProgramCarryWiringPolicy.js';
import type { ShadowCandidateScanTrigger } from '../marketStateResolver.js';
import { getSectorLeadershipScore } from '../../../src/services/quant/sectorEnergyEngine.js';
import { getSectorByCode } from '../../screener/sectorMap.js';
import { injectPerSymbolPriceContext } from './injectPerSymbolPriceContext.js';
import { injectPerSymbolDartContext } from './injectPerSymbolDartContext.js';
import { collectUnifiedSnapshot } from '../symbolDataCollector.js';
import { buildScanEvaluationId } from './state/scanEvaluationState.js';

// ─── Feature flag: USE_UNIFIED_SOURCE_SNAPSHOT ───────────────────────────────
// true 시 buyListLoop 전에 SymbolDataCollector로 종목당 1회 일괄 수집.
// false(기본) 시 기존 per-gate 개별 fetch 경로 100% 유지 — executionImpact=NONE.
const USE_UNIFIED_SNAPSHOT = process.env.USE_UNIFIED_SOURCE_SNAPSHOT === 'true';

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
  const featurePack = w.featurePack && typeof w.featurePack === 'object' ? w.featurePack : {};
  const momentum = featurePack.momentum && typeof featurePack.momentum === 'object' ? featurePack.momentum : {};
  const momentumProjection = w.momentumProjection && typeof w.momentumProjection === 'object' ? w.momentumProjection : {};
  const gateLayerFeatures = extractGateLayerQuoteFeatureValues(w);
  return {
    symbol: typeof q.symbol === 'string' ? q.symbol : w.code,
    code: typeof q.code === 'string' ? q.code : w.code,
    price: pickNumber(q.price, q.currentPrice, sf.price, sf.currentPrice, gateLayerFeatures.price, w.entryPrice),
    changePercent: pickNumber(q.changePercent, sf.changePercent),
    return5d: pickNumber(q.return5d, sf.return5d, w.return5d, momentum.return5d, momentumProjection.return5d, gateLayerFeatures.return5d),
    return20d: pickNumber(q.return20d, sf.return20d, w.return20d, momentum.return20d, momentumProjection.return20d, gateLayerFeatures.return20d),
    relativeReturn20d: pickNumber(q.relativeReturn20d, sf.relativeReturn20d, w.relativeReturn20d, momentum.relativeReturn20d, momentumProjection.relativeReturn20d, gateLayerFeatures.relativeReturn20d),
    marketRelativeReturn: pickNumber(q.marketRelativeReturn, sf.marketRelativeReturn, w.marketRelativeReturn, momentum.marketRelativeReturn, momentumProjection.marketRelativeReturn, gateLayerFeatures.marketRelativeReturn),
    kospiRelativeReturn: pickNumber(q.kospiRelativeReturn, sf.kospiRelativeReturn, w.kospiRelativeReturn, momentum.kospiRelativeReturn, momentumProjection.kospiRelativeReturn, gateLayerFeatures.kospiRelativeReturn),
    kospi20dReturn: pickNumber(q.kospi20dReturn, sf.kospi20dReturn, w.kospi20dReturn, momentum.kospi20dReturn, momentumProjection.kospi20dReturn, gateLayerFeatures.kospi20dReturn),
    rsRankPct: pickNumber(q.rsRankPct, sf.rsRankPct, w.rsRankPct, momentum.rsRankPct, momentumProjection.rsRankPct),
    high5d: pickNumber(q.high5d, sf.high5d, gateLayerFeatures.high5d),
    high20d: pickNumber(q.high20d, q.high20, sf.high20d, sf.high20, gateLayerFeatures.high20d),
    high20: pickNumber(q.high20, q.high20d, sf.high20, sf.high20d, gateLayerFeatures.high20),
    high60: pickNumber(q.high60, sf.high60, gateLayerFeatures.high60),
    high60d: pickNumber(q.high60d, sf.high60d, gateLayerFeatures.high60d),
    volume: pickNumber(q.volume, sf.volume, gateLayerFeatures.volume),
    avgVolume: pickNumber(q.avgVolume, sf.avgVolume, gateLayerFeatures.avgVolume),
    avgVolume20d: pickNumber(q.avgVolume20d, sf.avgVolume20d, gateLayerFeatures.avgVolume20d),
    volumeRatio: pickNumber(q.volumeRatio, sf.volumeRatio, gateLayerFeatures.volumeRatio),
    ma5: pickNumber(q.ma5, sf.ma5),
    ma20: pickNumber(q.ma20, sf.ma20, gateLayerFeatures.ma20),
    ma60: pickNumber(q.ma60, sf.ma60, gateLayerFeatures.ma60),
    rsi14: pickNumber(q.rsi14, sf.rsi14, gateLayerFeatures.rsi14),
    atr: pickNumber(q.atr, sf.atr, gateLayerFeatures.atr),
    atr20avg: pickNumber(q.atr20avg, sf.atr20avg, gateLayerFeatures.atr20avg),
    bbWidthCurrent: pickNumber(q.bbWidthCurrent, sf.bbWidthCurrent, gateLayerFeatures.bbWidthCurrent),
    bbWidth20dAvg: pickNumber(q.bbWidth20dAvg, sf.bbWidth20dAvg),
    vol5dAvg: pickNumber(q.vol5dAvg, sf.vol5dAvg),
    vol20dAvg: pickNumber(q.vol20dAvg, sf.vol20dAvg),
  };
}

function hasFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function buildDiagnosticCondition(
  key: string,
  status: 'PASS' | 'FAIL' | 'WAIT' | 'UNAVAILABLE' | 'DIAGNOSTIC_ONLY',
  reason: string,
  sourcePath: string,
): Record<string, unknown> {
  return {
    key,
    status,
    scoreImpact: 0,
    confidenceImpact: status === 'UNAVAILABLE' ? -0.01 : 0,
    reason,
    sourcePath,
    dataStatus: status === 'UNAVAILABLE' ? 'MISSING' : 'VERIFIED',
    marketSignal: false,
    providerIssue: false,
    executionImpact: 'NONE',
  };
}

function buildConditionResultsSkeleton(w: any): Record<string, unknown> {
  const quote = buildSafeQuoteFeatures(w);
  const hasMomentum = hasFiniteNumber(quote.return5d) || hasFiniteNumber(quote.return20d);
  const hasRs = hasFiniteNumber(w.relativeStrengthScore) || hasFiniteNumber(quote.rsRankPct) || hasFiniteNumber(quote.relativeReturn20d);
  const hasBreakout = hasFiniteNumber(w.breakoutScore) || hasFiniteNumber(quote.high5d) || hasFiniteNumber(quote.high20d);
  const hasMaAlignment = hasFiniteNumber(quote.ma20) && hasFiniteNumber(quote.ma60) && hasFiniteNumber(quote.price);
  const hasVolumeLiquidity = hasFiniteNumber(quote.volume) && (hasFiniteNumber(quote.avgVolume20d) || hasFiniteNumber(quote.volumeRatio));
  return {
    price_momentum: buildDiagnosticCondition('PRICE_MOMENTUM', hasMomentum ? 'WAIT' : 'UNAVAILABLE', hasMomentum ? 'DIAGNOSTIC_MOMENTUM_PROJECTED' : 'QUOTE_FEATURE_FIELD_MISSING', 'buildConditionResultsSkeleton'),
    relative_strength: buildDiagnosticCondition('RELATIVE_STRENGTH', hasRs ? 'WAIT' : 'UNAVAILABLE', hasRs ? 'DIAGNOSTIC_RS_PROJECTED' : 'QUOTE_FEATURE_FIELD_MISSING', 'buildConditionResultsSkeleton'),
    breakout_structure: buildDiagnosticCondition('BREAKOUT_STRUCTURE', hasBreakout ? 'WAIT' : 'UNAVAILABLE', hasBreakout ? 'DIAGNOSTIC_BREAKOUT_PROJECTED' : 'QUOTE_FEATURE_FIELD_MISSING', 'buildConditionResultsSkeleton'),
    ma_alignment: buildDiagnosticCondition('MA_ALIGNMENT', hasMaAlignment ? 'WAIT' : 'UNAVAILABLE', hasMaAlignment ? 'DIAGNOSTIC_MA_PENDING' : 'QUOTE_FEATURE_FIELD_MISSING', 'buildConditionResultsSkeleton'),
    volume_liquidity: buildDiagnosticCondition('VOLUME_LIQUIDITY', hasVolumeLiquidity ? 'WAIT' : 'UNAVAILABLE', hasVolumeLiquidity ? 'DIAGNOSTIC_VOLUME_PENDING' : 'QUOTE_FEATURE_FIELD_MISSING', 'buildConditionResultsSkeleton'),
    watchlist_score: buildDiagnosticCondition('WATCHLIST_SCORE', hasFiniteNumber(w.watchlistPriorityScore ?? w.watchlistScore) ? 'WAIT' : 'UNAVAILABLE', hasFiniteNumber(w.watchlistPriorityScore ?? w.watchlistScore) ? 'DIAGNOSTIC_WATCHLIST_PROJECTED' : 'WATCHLIST_SCORE_MISSING', 'buildConditionResultsSkeleton'),
    supply_semantic: buildDiagnosticCondition('SUPPLY_SEMANTIC', 'DIAGNOSTIC_ONLY', 'ACTUAL_INVESTOR_ROW_NOT_CARRIED', 'buildConditionResultsSkeleton'),
  };
}

function buildConditionResultsTrace(w: any): Record<string, unknown> {
  if (w.conditionResults && typeof w.conditionResults === 'object') return w.conditionResults;
  const projected = conditionResultsTraceToMap(
    w.conditionResultsTrace ?? projectGateOutputsToConditionResultsTrace(w.gateEvaluation?.outputs),
  );
  return projected ?? buildConditionResultsSkeleton(w);
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

function buildCandidateSnapshotSsot(w: any, macro?: { kospi20dReturn?: number; programNetBuyAmount?: number }) {
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
    quoteFeatures: buildSafeQuoteFeatures(w),
    featurePack: w.featurePack,
    momentumProjection: w.momentumProjection,
    breakoutTrace: w.breakoutTrace,
    gateLayerSummary: w.gateLayerSummary,
    gate2ExternalDataCoverage: w.gate2ExternalDataCoverage ?? w.gateLayerSummary?.gate2?.externalDataCoverage,
    gate3ExternalDataCoverage: w.gate3ExternalDataCoverage ?? w.gateLayerSummary?.gate3?.externalDataCoverage,
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
    relativeStrengthScore: w.relativeStrengthScore ?? w.symbolFeatures?.relativeStrengthScore ?? w.featurePack?.momentum?.relativeStrengthScore ?? w.momentumProjection?.relativeStrengthScore,
    rsRankPct: w.rsRankPct ?? w.symbolFeatures?.rsRankPct ?? w.featurePack?.momentum?.rsRankPct ?? w.momentumProjection?.rsRankPct,
    relativeStrength: w.relativeStrength ?? w.symbolFeatures?.relativeStrength,
    return20d: w.return20d ?? w.symbolFeatures?.return20d ?? w.quote?.return20d ?? w.featurePack?.momentum?.return20d ?? w.momentumProjection?.return20d,
    return5d: w.return5d ?? w.symbolFeatures?.return5d ?? w.quote?.return5d ?? w.featurePack?.momentum?.return5d ?? w.momentumProjection?.return5d,
    marketRelativeReturn: w.marketRelativeReturn ?? w.symbolFeatures?.marketRelativeReturn ?? w.quote?.marketRelativeReturn ?? w.featurePack?.momentum?.marketRelativeReturn ?? w.momentumProjection?.marketRelativeReturn,
    kospiRelativeReturn: w.kospiRelativeReturn ?? w.symbolFeatures?.kospiRelativeReturn ?? w.quote?.kospiRelativeReturn ?? w.featurePack?.momentum?.kospiRelativeReturn ?? w.momentumProjection?.kospiRelativeReturn,
    relativeReturn20d: w.relativeReturn20d ?? w.symbolFeatures?.relativeReturn20d ?? w.quote?.relativeReturn20d ?? w.featurePack?.momentum?.relativeReturn20d ?? w.momentumProjection?.relativeReturn20d,
    breakoutScore: w.breakoutScore ?? w.symbolFeatures?.breakoutScore ?? w.breakoutTrace?.breakoutScore ?? w.featurePack?.breakout?.breakoutScore,
    trendScore: w.trendScore ?? w.symbolFeatures?.trendScore,
    investorFlow: w.investorFlow,
    kospi20dReturn: w.kospi20dReturn ?? w.symbolFeatures?.kospi20dReturn ?? w.quote?.kospi20dReturn ?? w.featurePack?.momentum?.kospi20dReturn ?? w.momentumProjection?.kospi20dReturn ?? macro?.kospi20dReturn,
    // P2-B: index return explicit alias — featureHydrationAudit rsIndexFallbackUsed fires when
    // candidate has kospi20dReturn but not indexReturn20d. Aliasing eliminates the false-positive.
    // executionImpact=NONE (diagnostic-only field, no gate pass/fail logic touched).
    indexReturn20d: w.indexReturn20d ?? w.symbolFeatures?.indexReturn20d ?? w.quote?.indexReturn20d ?? w.kospi20dReturn ?? w.symbolFeatures?.kospi20dReturn ?? w.quote?.kospi20dReturn ?? w.featurePack?.momentum?.kospi20dReturn ?? w.momentumProjection?.kospi20dReturn ?? macro?.kospi20dReturn,
    // P2-A: market-level program net buy fallback — wired as diagnostic-only candidate field when
    // no per-symbol stock-level program data is available (Naver/KIS per-symbol both return null).
    // macroState.programNetBuyAmount is KOSPI-aggregate, NOT per-stock — used purely for
    // programFlowDiagnostics visibility, not for supply signal evaluation.
    // executionImpact=NONE (candidateMapper.extractStockProgramFlow reads supplyContext records).
    programNetBuyAmount: w.programNetBuyAmount ?? w.supplyContext?.programNetBuyAmount ?? (macro?.programNetBuyAmount != null ? macro.programNetBuyAmount : undefined),
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
        ...(Array.isArray(preflightResult.context?.watchlist)
          ? { candidatePoolSourceCandidates: preflightResult.context.watchlist }
          : {}),
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

  // ADR-0528 a1/a2 완결: scan-cycle 단일 canonical id 확립 (log-only carry).
  // scan-start 에서 KST asOf 1회 산출 → buildScanEvaluationId 로 canonical id 생성.
  // 동일 scanAsOf 를 (a) context.sourceSnapshotId(→ buyList ctx → a1/a2 POSITION_POLICY 로그)
  // (b) persistScanResults 의 scanEvaluation.scanId build 양쪽에 thread → 두 값 byte-identical 보장.
  // 신규 id 포맷·UUID·scan_${Date.now()} 금지 — 소비자 fallback(scanEvaluation.scanId) 과 동일값만 허용.
  // 결정 로직·실행·storage 키 0 변경 (log enrichment 전용, 불변식 #5/#8 영역 외).
  const scanAsOf = new Date(Date.now() + 9 * 3_600_000).toISOString();
  preflightResult.context.sourceSnapshotId = buildScanEvaluationId(scanAsOf);

  // 2. Candidate Select (관심종목 3섹션 및 Intraday 후보군 선정)
  const candidates = await selectCandidates(preflightResult.context, options);

  // 2.1 Unified Source Snapshot (feature flag: USE_UNIFIED_SOURCE_SNAPSHOT=true)
  // OFF 시 기존 per-gate 경로 100% 유지 — executionImpact=NONE.
  let unifiedSnapshot: import('../sourceSnapshot/unifiedSourceSnapshot.js').UnifiedSourceSnapshot | undefined;
  if (USE_UNIFIED_SNAPSHOT) {
    const candidateSymbols: string[] = [
      ...candidates.buyList.map((c: any) => c.code ?? c.symbol).filter(Boolean),
      ...candidates.intradayList.map((c: any) => c.code ?? c.symbol).filter(Boolean),
    ];
    const uniqueSymbols = [...new Set(candidateSymbols)] as string[];
    if (uniqueSymbols.length > 0) {
      try {
        unifiedSnapshot = await collectUnifiedSnapshot(uniqueSymbols, { scanCycleId: `scan_${Date.now()}` });
      } catch (err) {
        // 수집 실패는 기존 경로 차단 금지 — 불변식 #1 Trading Engine 항상 생존
        console.warn(
          '[UNIFIED_SNAPSHOT] collectUnifiedSnapshot 실패; 기존 경로 유지',
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  let perSymbolSupplyInjection: PerSymbolSupplyInjectionStats | undefined;
  // WIRE_SELECTED_CANDIDATE_ACTUAL_ROW — per-scan 6-digit 키 aggregate investor-flow map.
  // forensic collector 로 직접 thread(snapshot retention/freshness 비의존) → 결정론적 carry.
  let investorFlowBySymbolCarry: Record<string, Record<string, unknown>> | undefined;
  try {
    const injected = await injectPerSymbolSupplyContext({
      candidates: candidates.buyList,
      investorFlowRouter: createDefaultInvestorFlowRouter(),
      snapshotData: unifiedSnapshot?.perSymbol,
    });
    candidates.buyList = injected.candidates;
    candidates.mainList = injected.candidates;
    perSymbolSupplyInjection = injected.stats;
    investorFlowBySymbolCarry = injected.investorFlowBySymbol;
    if (Array.isArray(candidates.intradayList) && candidates.intradayList.length > 0) {
      const intradayInjected = await injectPerSymbolSupplyContext({
        candidates: candidates.intradayList,
        investorFlowRouter: createDefaultInvestorFlowRouter(),
        snapshotData: unifiedSnapshot?.perSymbol,
      });
      candidates.intradayList = intradayInjected.candidates;
      // intraday 후보 row 도 forensic carry map 에 합류(buyList 우선, 미존재 키만 보강).
      investorFlowBySymbolCarry = { ...intradayInjected.investorFlowBySymbol, ...investorFlowBySymbolCarry };
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

  // 2.5. Per-Symbol Price Context (volume + return5d/20d — snapshotData 있으면 KIS fetch 우회)
  try {
    const priceInjected = await injectPerSymbolPriceContext(
      candidates.buyList as Record<string, unknown>[],
      { snapshotData: unifiedSnapshot?.perSymbol },
    );
    candidates.buyList = priceInjected.candidates as typeof candidates.buyList;
    candidates.mainList = priceInjected.candidates as typeof candidates.mainList;
    if (Array.isArray(candidates.intradayList) && candidates.intradayList.length > 0) {
      const intradayPrice = await injectPerSymbolPriceContext(
        candidates.intradayList as Record<string, unknown>[],
        { snapshotData: unifiedSnapshot?.perSymbol },
      );
      candidates.intradayList = intradayPrice.candidates as typeof candidates.intradayList;
    }
  } catch (error) {
    console.warn(
      '[PER_SYMBOL_PRICE_CONTEXT_INJECTION] failed before evaluation; continuing',
      error instanceof Error ? error.message : String(error),
    );
  }

  // 2.6. Per-Symbol DART Context (ADR-0529 — collector 가 채운 정본 DART 슬롯 carry, fetch 0)
  // snapshotData 부재 시 no-op → read site 가 기존 getGate2DartFinancialsForEvaluation fallback (회귀 0).
  try {
    injectPerSymbolDartContext(
      candidates.buyList as Record<string, unknown>[],
      { snapshotData: unifiedSnapshot?.perSymbol },
    );
    if (Array.isArray(candidates.intradayList) && candidates.intradayList.length > 0) {
      injectPerSymbolDartContext(
        candidates.intradayList as Record<string, unknown>[],
        { snapshotData: unifiedSnapshot?.perSymbol },
      );
    }
  } catch (error) {
    console.warn(
      '[PER_SYMBOL_DART_CONTEXT_INJECTION] failed before evaluation; continuing',
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
        // P2-A: market-level program net buy amount carry (억원) — diagnostic-only fallback.
        programNetBuyAmount?: number;
      }
    | undefined;
  await persistScanResults(counters, {
    sellOnly: options?.sellOnly,
    // ADR-0528 a1/a2: scan-start scanAsOf 를 thread → scanEvaluation.scanId 가
    // context.sourceSnapshotId(= buildScanEvaluationId(scanAsOf)) 와 byte-identical 보장.
    scanAsOf,
    ...candidates.lengths,
    ...(perSymbolSupplyInjection ? { perSymbolSupplyInjection } : {}),
    ...(investorFlowBySymbolCarry && Object.keys(investorFlowBySymbolCarry).length > 0 ? { investorFlowBySymbolCarry } : {}),
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
    candidatePoolSourceCandidates: [
      ...(Array.isArray(preflightResult.context?.watchlist) ? preflightResult.context.watchlist : []).map((w: any) => ({
        ...w,
        sectorLeadershipScore: getSectorLeadershipScore(
          w.sector ?? getSectorByCode(w.code),
          (preflightResult.context?.macroState as any)?.sectorEnergyResult ?? null,
        ),
      })),
      ...candidates.buyList.map((w: any) => ({
        ...w,
        sectorLeadershipScore: getSectorLeadershipScore(
          w.sector ?? getSectorByCode(w.code),
          (preflightResult.context?.macroState as any)?.sectorEnergyResult ?? null,
        ),
      })),
      ...candidates.intradayList.map((w: any) => ({
        ...w,
        sectorLeadershipScore: getSectorLeadershipScore(
          w.sector ?? getSectorByCode(w.code),
          (preflightResult.context?.macroState as any)?.sectorEnergyResult ?? null,
        ),
      })),
    ],
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
        quoteFeatures: buildSafeQuoteFeatures(w),
        featurePack: w.featurePack,
        momentumProjection: w.momentumProjection,
        breakoutTrace: w.breakoutTrace,
        gateLayerSummary: w.gateLayerSummary,
        gate2ExternalDataCoverage: w.gate2ExternalDataCoverage ?? w.gateLayerSummary?.gate2?.externalDataCoverage,
        gate3ExternalDataCoverage: w.gate3ExternalDataCoverage ?? w.gateLayerSummary?.gate3?.externalDataCoverage,
        symbolFeatures: {
          ...(w.symbolFeatures ?? {}),
          return5d: w.symbolFeatures?.return5d ?? w.return5d ?? w.quote?.return5d ?? w.featurePack?.momentum?.return5d ?? w.momentumProjection?.return5d,
          return20d: w.symbolFeatures?.return20d ?? w.return20d ?? w.quote?.return20d ?? w.featurePack?.momentum?.return20d ?? w.momentumProjection?.return20d,
          relativeReturn20d: w.symbolFeatures?.relativeReturn20d ?? w.relativeReturn20d ?? w.quote?.relativeReturn20d ?? w.featurePack?.momentum?.relativeReturn20d ?? w.momentumProjection?.relativeReturn20d,
          marketRelativeReturn: w.symbolFeatures?.marketRelativeReturn ?? w.marketRelativeReturn ?? w.quote?.marketRelativeReturn ?? w.featurePack?.momentum?.marketRelativeReturn ?? w.momentumProjection?.marketRelativeReturn,
          kospiRelativeReturn: w.symbolFeatures?.kospiRelativeReturn ?? w.kospiRelativeReturn ?? w.quote?.kospiRelativeReturn ?? w.featurePack?.momentum?.kospiRelativeReturn ?? w.momentumProjection?.kospiRelativeReturn,
          rsRankPct: w.symbolFeatures?.rsRankPct ?? w.rsRankPct ?? w.featurePack?.momentum?.rsRankPct ?? w.momentumProjection?.rsRankPct,
          relativeStrengthScore: w.symbolFeatures?.relativeStrengthScore ?? w.relativeStrengthScore ?? w.featurePack?.momentum?.relativeStrengthScore ?? w.momentumProjection?.relativeStrengthScore,
          breakoutScore: w.symbolFeatures?.breakoutScore ?? w.breakoutScore ?? w.breakoutTrace?.breakoutScore ?? w.featurePack?.breakout?.breakoutScore,
        },
        relativeStrengthScore: w.relativeStrengthScore ?? w.symbolFeatures?.relativeStrengthScore ?? w.featurePack?.momentum?.relativeStrengthScore ?? w.momentumProjection?.relativeStrengthScore,
        relativeStrength: w.relativeStrength ?? w.symbolFeatures?.relativeStrength,
        rsRankPct: w.rsRankPct ?? w.symbolFeatures?.rsRankPct ?? w.featurePack?.momentum?.rsRankPct ?? w.momentumProjection?.rsRankPct,
        marketRelativeReturn: w.marketRelativeReturn ?? w.symbolFeatures?.marketRelativeReturn ?? w.quote?.marketRelativeReturn ?? w.featurePack?.momentum?.marketRelativeReturn ?? w.momentumProjection?.marketRelativeReturn,
        kospiRelativeReturn: w.kospiRelativeReturn ?? w.symbolFeatures?.kospiRelativeReturn ?? w.quote?.kospiRelativeReturn ?? w.featurePack?.momentum?.kospiRelativeReturn ?? w.momentumProjection?.kospiRelativeReturn,
        relativeReturn20d: w.relativeReturn20d ?? w.symbolFeatures?.relativeReturn20d ?? w.quote?.relativeReturn20d ?? w.featurePack?.momentum?.relativeReturn20d ?? w.momentumProjection?.relativeReturn20d,
        return20d: w.return20d ?? w.symbolFeatures?.return20d ?? w.quote?.return20d ?? w.featurePack?.momentum?.return20d ?? w.momentumProjection?.return20d,
        return5d: w.return5d ?? w.symbolFeatures?.return5d ?? w.quote?.return5d ?? w.featurePack?.momentum?.return5d ?? w.momentumProjection?.return5d,
        kospi20dReturn: w.kospi20dReturn ?? w.symbolFeatures?.kospi20dReturn ?? w.quote?.kospi20dReturn ?? w.featurePack?.momentum?.kospi20dReturn ?? w.momentumProjection?.kospi20dReturn ?? macro?.kospi20dReturn,
        // P2-B: explicit indexReturn20d alias — eliminates rsIndexFallbackUsed false-positive.
        indexReturn20d: w.indexReturn20d ?? w.symbolFeatures?.indexReturn20d ?? w.quote?.indexReturn20d ?? w.kospi20dReturn ?? w.symbolFeatures?.kospi20dReturn ?? w.quote?.kospi20dReturn ?? w.featurePack?.momentum?.kospi20dReturn ?? w.momentumProjection?.kospi20dReturn ?? macro?.kospi20dReturn,
        // P2-A: market-level program net buy fallback for diagnostic visibility.
        programNetBuyAmount: w.programNetBuyAmount ?? w.supplyContext?.programNetBuyAmount ?? (macro?.programNetBuyAmount != null ? macro.programNetBuyAmount : undefined),
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
        quoteFeatures: buildSafeQuoteFeatures(w),
        featurePack: w.featurePack,
        momentumProjection: w.momentumProjection,
        breakoutTrace: w.breakoutTrace,
        gateLayerSummary: w.gateLayerSummary,
        gate2ExternalDataCoverage: w.gate2ExternalDataCoverage ?? w.gateLayerSummary?.gate2?.externalDataCoverage,
        gate3ExternalDataCoverage: w.gate3ExternalDataCoverage ?? w.gateLayerSummary?.gate3?.externalDataCoverage,
        symbolFeatures: {
          ...(w.symbolFeatures ?? {}),
          return5d: w.symbolFeatures?.return5d ?? w.return5d ?? w.quote?.return5d ?? w.featurePack?.momentum?.return5d ?? w.momentumProjection?.return5d,
          return20d: w.symbolFeatures?.return20d ?? w.return20d ?? w.quote?.return20d ?? w.featurePack?.momentum?.return20d ?? w.momentumProjection?.return20d,
          relativeReturn20d: w.symbolFeatures?.relativeReturn20d ?? w.relativeReturn20d ?? w.quote?.relativeReturn20d ?? w.featurePack?.momentum?.relativeReturn20d ?? w.momentumProjection?.relativeReturn20d,
          marketRelativeReturn: w.symbolFeatures?.marketRelativeReturn ?? w.marketRelativeReturn ?? w.quote?.marketRelativeReturn ?? w.featurePack?.momentum?.marketRelativeReturn ?? w.momentumProjection?.marketRelativeReturn,
          kospiRelativeReturn: w.symbolFeatures?.kospiRelativeReturn ?? w.kospiRelativeReturn ?? w.quote?.kospiRelativeReturn ?? w.featurePack?.momentum?.kospiRelativeReturn ?? w.momentumProjection?.kospiRelativeReturn,
          rsRankPct: w.symbolFeatures?.rsRankPct ?? w.rsRankPct ?? w.featurePack?.momentum?.rsRankPct ?? w.momentumProjection?.rsRankPct,
          relativeStrengthScore: w.symbolFeatures?.relativeStrengthScore ?? w.relativeStrengthScore ?? w.featurePack?.momentum?.relativeStrengthScore ?? w.momentumProjection?.relativeStrengthScore,
          breakoutScore: w.symbolFeatures?.breakoutScore ?? w.breakoutScore ?? w.breakoutTrace?.breakoutScore ?? w.featurePack?.breakout?.breakoutScore,
        },
        relativeStrengthScore: w.relativeStrengthScore ?? w.symbolFeatures?.relativeStrengthScore ?? w.featurePack?.momentum?.relativeStrengthScore ?? w.momentumProjection?.relativeStrengthScore,
        relativeStrength: w.relativeStrength ?? w.symbolFeatures?.relativeStrength,
        rsRankPct: w.rsRankPct ?? w.symbolFeatures?.rsRankPct ?? w.featurePack?.momentum?.rsRankPct ?? w.momentumProjection?.rsRankPct,
        marketRelativeReturn: w.marketRelativeReturn ?? w.symbolFeatures?.marketRelativeReturn ?? w.quote?.marketRelativeReturn ?? w.featurePack?.momentum?.marketRelativeReturn ?? w.momentumProjection?.marketRelativeReturn,
        kospiRelativeReturn: w.kospiRelativeReturn ?? w.symbolFeatures?.kospiRelativeReturn ?? w.quote?.kospiRelativeReturn ?? w.featurePack?.momentum?.kospiRelativeReturn ?? w.momentumProjection?.kospiRelativeReturn,
        relativeReturn20d: w.relativeReturn20d ?? w.symbolFeatures?.relativeReturn20d ?? w.quote?.relativeReturn20d ?? w.featurePack?.momentum?.relativeReturn20d ?? w.momentumProjection?.relativeReturn20d,
        return20d: w.return20d ?? w.symbolFeatures?.return20d ?? w.quote?.return20d ?? w.featurePack?.momentum?.return20d ?? w.momentumProjection?.return20d,
        return5d: w.return5d ?? w.symbolFeatures?.return5d ?? w.quote?.return5d ?? w.featurePack?.momentum?.return5d ?? w.momentumProjection?.return5d,
        kospi20dReturn: w.kospi20dReturn ?? w.symbolFeatures?.kospi20dReturn ?? w.quote?.kospi20dReturn ?? w.featurePack?.momentum?.kospi20dReturn ?? w.momentumProjection?.kospi20dReturn ?? macro?.kospi20dReturn,
        // P2-B: explicit indexReturn20d alias — eliminates rsIndexFallbackUsed false-positive.
        indexReturn20d: w.indexReturn20d ?? w.symbolFeatures?.indexReturn20d ?? w.quote?.indexReturn20d ?? w.kospi20dReturn ?? w.symbolFeatures?.kospi20dReturn ?? w.quote?.kospi20dReturn ?? w.featurePack?.momentum?.kospi20dReturn ?? w.momentumProjection?.kospi20dReturn ?? macro?.kospi20dReturn,
        // P2-A: market-level program net buy fallback for diagnostic visibility.
        programNetBuyAmount: w.programNetBuyAmount ?? w.supplyContext?.programNetBuyAmount ?? (macro?.programNetBuyAmount != null ? macro.programNetBuyAmount : undefined),
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
