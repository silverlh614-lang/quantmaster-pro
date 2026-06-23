// @responsibility ADR-0588 persistScanResults mid-scan 진단 블록(ADR-0477~0527) byte-equivalent 추출.


import {
  sendTelegramAlert,
  getNoiseCounters,
  logNoiseDetail,
  logNoiseSummary,
  buildEmptyScanRootCauseEventsFromStringsAdr0500,
  safeBuildEmptyScanRootCauseDashboardAdr0500,
  buildWeekendReplayRecordsFromStringsAdr0501,
  safeBuildWeekendReplaySummaryAdr0501,
  appendScanTraces,
  classifyEmptyScanReason,
  describeEmptyScanReason,
  evaluateR3Sanity,
  activateR3SanityBlock,
  evaluateR3ViolationState,
  clearPreflightBlockedScanSummary,
  buildR3NoiseDecision,
  summarizePreBreakoutWaitDecisions,
  buildFreshScanBlockerAttribution,
  buildGate2FreshAttribution,
  buildSectorEnergyDiagnostic,
  buildGate1MinimumSignalForensicAuditAdr0505,
  buildGate1MinimumSignalForensicSummaryAdr0505,
  isGate1MinimumSignalForensicAuditDisabled,
  resolveGate1EvaluationStateAdr0510,
  appendGate1ForensicTrace,
  collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507,
  deriveGateDecisionRouterResult,
  summarizeProvisionalShadowCandidates,
  summarizeCounterfactualShadowLearningCandidates,
  buildGateReclassificationDryRunSummary,
  buildEntryFilterDecomposition,
  buildPositiveScoreStarvationFallbackReport,
  buildPositiveScoreStarvationReport,
  buildGate1ScoreCeilingRepairReport,
  buildPenaltyDeduplicationReport,
  buildRiskDoubleCountAuditReport,
  buildFinalGate1CalibrationAuditReport,
  buildGate1ScoringAlignmentReport,
  buildGate1ScoringAlignmentDryRunGate,
  buildGate1PositiveSourceWiringReport,
  buildGate1DryRunObservationRows,
  buildGate1ThresholdEvidenceSummary,
  resolveGate1ObservationTopNEnv,
  saveGate1DryRunObservationRows,
  summarizeGate1DryRunObservationRows,
  buildInvestorFlowProviderRouteResultAdr0477,
  buildNaverInvestorTrendCollectorResultAdr0481,
  collectNaverInvestorTrendCollectorResultAdr0481,
  buildSemanticNetBuyNormalizationReportAdr0482,
  buildSupplySourceFreshnessReportAdr0483,
  buildSupplyCoverageRecoveryObservationReportAdr0484,
  buildSupplyAdvisoryReadinessReportAdr0485,
  buildSupplyRecoveryRuntimeMountReportAdr0486,
  buildFreshDataSupplyReportAdr0487,
  buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488,
  buildInvestorFlowSampleAcquisitionReportAdr0489,
  recordSupplySnapshotAdr0491,
  readLatestSupplySnapshotBySymbolSourceDomainAdr0491,
  previousTradingDateCandidateAdr0491,
  fetchKisInvestorFlowEvidence,
  fetchInvestorFlowWithPolicy,
  rememberSupplyBySymbolPayloadSnapshot,
  fetchInvestorTrading,
  getLastKrxInvestorTradingDiagnostic,
  DEFAULT_DATA_PROMOTION_STATUS,
  buildGatePassDistribution,
  buildWaitDistribution,
  buildGateScoreCandidateBucketSummary,
  buildGateScoreHealthSummary,
  buildGateDiagnosticCarrySummary,
  buildGateLayerAuditSummary,
  buildPerStageDropoffSummary,
  cacheRawToNaverInvestorTrendPointAdr0481,
  cacheRawToSemanticInputAdr0482,
  buildScanEvaluationResult,
  emitScanDiagnosticBuildFailedWarn,
  emitScanEvaluationWarnings,
  recordScanCase,
  cacheLookupToSemanticInputAdr0482,
  compactTradingDateAdr0505,
  kisEvidenceToSemanticInputAdr0482,
  krxDiagnosticToRouterInputAdr0505,
  krxInvestorRowToRouterRawAdr0505,
  krxInvestorRowToSemanticInputAdr0482,
  normalizeSymbolCodeAdr0505,
  naverCollectorToSemanticInputAdr0482,
  resolveActualSymbolForAdr0477,
  routedKisFlowToAdr0477Raw,
  routedKisFlowToSemanticInputAdr0482,
  logAdrDiagnostic,
  logGateDiagnosticSummary,
  logPreBreakoutNoiseSummary,
  emitInvestorFlowRouterEventAdr0477,
  formatR3StateMessage,
  buildCandidatePool,
  type ShadowCandidateScanTrigger,
  type FrozenQuoteResult,
  type StreakSkipReason,
  type SectorEnergyQualityDiagnostic,
  type ProvisionalShadowSectionInput,
  type CounterfactualShadowSectionInput,
  type CandidateSnapshot,
  type CandidatePoolInputCandidate,
  type CandidatePoolResult,
  type InvestorFlowProviderRouterInput,
  type PerSymbolSupplyInjectionStats,
  type SemanticNetBuyInputPoint,
  type FreshDataSupplyReportInputAdr0487,
  type MacroGateState,
  type ScanSummary,
  type ScanCounters,
  type ScanEvaluationResult,
} from './persistScanResultsDependencies.js';
import { buildCanonicalRuntimeResolutionStep27 } from '../runtimeResolverTraceStep26.js';
import { resolveScoringEffectiveRegime } from './gate0MacroPermissionDecision.js';
import { buildGate1RegimeAwareSurvivorObservation } from '../gate1RegimeAwareSurvivorAdr0546.js';
import { isPreflightDiagnosticScanSummary } from './preflightDiagnosticScanSummary.js';
import { setLastSectorEnergyCanonicalState } from '../sectorEnergyCanonicalStateRef.js';
import {
  buildNoEntryScanSummaryMessage,
  buildNoEntryStreakDiagnostic,
  evaluateNoEntryTelegramDelivery,
  formatNoEntryPipelineFailureDetectedLog,
  formatNoEntryPipelineHealthOkLog,
  formatNoEntryStreakEvaluatedLog,
  formatNoEntryTelegramSentLog,
  formatNoEntryTelegramSuppressedLog,
  formatNoEntryWordingPolicyLogs,
  recordNoEntryTelegramSent,
  type NoEntryStreakDiagnosticInput,
} from './noEntryStreakDiagnostic.js';
import {
  formatScanSummaryCausalArrowAllowedLog,
  formatScanSummaryReasonMappedLog,
  formatScanSummaryWordingPolicyLogs,
  formatScanSummaryZeroReasonSuppressedLog,
  mapScanSummaryDisplayReasons,
} from './scanSummaryReasonMapping.js';
import {
  buildCandidateGateEvaluationViews,
  aggregateCandidateGateEvaluationViews,
  buildCandidateGate2Coverage,
  buildCandidateGate2ConfluenceSnapshot,
  buildCandidateGate3ClosureSnapshot,
} from './candidateGateEvaluationView.js';
import {
  buildCandidateExecutionResolutions,
  aggregateUnifiedExecutionPermission,
} from './candidateExecutionResolution.js';
import {
  finiteNumber,
  countFiniteCandidateMetric,
  firstStringValue,
  nestedRecord,
  collectOfficialSectorIndexTargets,
  watchlistFallbackCandidates,
} from './persistScanResults/helpers.js';
import type { PersistScanResultsOptions } from './persistScanResults/types.js';
import { upsertGate3OutcomeSeeds } from '../../../persistence/gate3OutcomeRepo.js';
import { buildGate3EvidenceScore } from '../../../quant/gate3EvidenceScore.js';
import { buildGate2OutcomeSeeds } from '../../../quant/gate2OutcomeSeed.js';
import { upsertGate2OutcomeSeeds } from '../../../persistence/gate2OutcomeRepo.js';
import { buildGate3EvidenceWarmupStatus } from '../../../quant/gate3EvidenceWarmup.js';
import { buildGate3CompletionScore } from '../../../quant/gate3CompletionScore.js';
import { buildLiveReadinessScore } from '../../../quant/liveReadinessScore.js';
import { rememberGate3FinalizationSummary } from '../../../quant/gate3FinalizationState.js';
import { buildUnifiedForwardOutcomeLabelerStatusForScan } from '../../../learning/unifiedForwardOutcomeLabeler.js';
import { loadKisOfficialSectorIndexMaster } from '../../../sector/SectorIndexMasterProvider.js';
import { buildOfficialSectorIndexMasterCoverage, type OfficialSectorIndexMasterCoverageResult } from '../../../sector/SectorIndexVerifier.js';
import { verifySectorIndexCodeWithKisCurrentPrice } from '../../../sector/KisSectorIndexVerifierAdapter.js';
import { isTradingDay } from '../../../utils/marketDayClassifier.js';
// ADR-0541 — positive score starvation audit supply wiring. The trace builder and
// counter accumulator relocate here from the per-symbol intraday re-check so the
// canonical minSignalScoreTrace.components (built by buildEntryFilterDecomposition)
// can finally supply minSignalComponents for correct CORE_SIGNAL attribution.
import { buildGate1ScoreStarvationTraceFromGateResult } from '../gate1PositiveScoreStarvation.js';
import { accumulatePositiveScoreStarvation } from './scanCounterAccumulators.js';

export interface MidScanDiagnosticBlocksContextAdr0588 {
  kstNow: Date;
  timeLabel: string;
  totalCandidates: number;
  sourceSnapshotId: string;
  scanCandidateSnapshots: ScanCounters['entryCandidateSnapshots'];
  scanEvaluation: ReturnType<typeof buildScanEvaluationResult>;
  gateLayerAudit: ReturnType<typeof buildGateLayerAuditSummary>;
  summaryDraft: ScanSummary;
  counters: ScanCounters;
  options: PersistScanResultsOptions;
}


// ADR-0588 — persistScanResults god 함수에서 추출. 판단/진단 로직·실행 순서·영속 인자 전부 보존(byte-equivalent).
// summaryDraft 는 참조 전달되어 동일 객체를 변형 → 호출자(persistScanResults) 의 canonical 영속이 모든 변형을 관찰.
export async function persistMidScanDiagnosticBlocksAdr0588(ctx: MidScanDiagnosticBlocksContextAdr0588): Promise<void> {
  const { kstNow, timeLabel, totalCandidates, sourceSnapshotId, scanCandidateSnapshots, scanEvaluation, gateLayerAudit, summaryDraft, counters, options } = ctx;
  // ADR-0477: investor-flow provider router wiring. This sits before the
  // ADR-0473/0465 supply diagnostics conceptually, but is built from already
  // available scan context only. It never fetches, routes orders, or mutates
  // live Gate/Kelly policy.
  try {
    const observationSnapshots = options.candidateSnapshots ?? counters.entryCandidateSnapshots;
    const firstResolvableSnapshot = observationSnapshots.find((snapshot) => resolveActualSymbolForAdr0477(snapshot) !== null);
    const firstSnapshot = firstResolvableSnapshot ?? observationSnapshots[0];
    const traceSymbol = firstSnapshot?.symbol ?? 'UNIVERSE';
    const firstSymbol = resolveActualSymbolForAdr0477(firstSnapshot) ?? traceSymbol;
    if (firstSymbol !== traceSymbol) {
      console.info(`[ADR-0477] resolved pseudo/candidate symbol traceSymbol=${traceSymbol} actualSymbol=${firstSymbol} executionImpact=NONE`);
    }
    const todayKst = kstNow.toISOString().slice(0, 10);
    const previousTradingDateCandidate = previousTradingDateCandidateAdr0491(todayKst);
    const sellOnlyOrClosed = false;
    const supplySnapshotCacheLookupAdr0491 = readLatestSupplySnapshotBySymbolSourceDomainAdr0491({
      symbol: firstSymbol,
      source: 'NAVER_INVESTOR_TREND',
      domain: 'SUPPLY',
      tradingDate: todayKst,
    });
    const cacheRaw = supplySnapshotCacheLookupAdr0491.cacheRaw;
    // Try today first during market hours; fall back to previous trading day on empty response.
    const krxTodayDate = compactTradingDateAdr0505(todayKst);
    const krxPrevDate = compactTradingDateAdr0505(previousTradingDateCandidate);
    let krxTradeDate = sellOnlyOrClosed ? krxPrevDate : krxTodayDate;
    let krxSourceDate: string = sellOnlyOrClosed ? previousTradingDateCandidate : todayKst;
    let krxDataStatus: 'VERIFIED' | 'STALE' = sellOnlyOrClosed ? 'STALE' : 'VERIFIED';
    let previousTradingDayKrxRaw: Record<string, unknown> | null = null;
    let krxSemanticInputAdr0482: SemanticNetBuyInputPoint | null = null;
    let krxInvestorDiagnosticAdr0505: InvestorFlowProviderRouterInput['krxInvestorDiagnosticAdr0505'] = null;
    try {
      let krxInvestorRows = await fetchInvestorTrading(krxTradeDate, { symbol: firstSymbol });
      // If today yielded no rows during market hours, fall back to previous trading day.
      if (krxInvestorRows.length === 0 && !sellOnlyOrClosed) {
        krxTradeDate = krxPrevDate;
        krxSourceDate = previousTradingDateCandidate;
        krxDataStatus = 'STALE';
        krxInvestorRows = await fetchInvestorTrading(krxTradeDate, { symbol: firstSymbol });
      }
      krxInvestorDiagnosticAdr0505 = krxDiagnosticToRouterInputAdr0505(
        getLastKrxInvestorTradingDiagnostic(krxTradeDate),
        krxSourceDate,
      );
      const normalizedFirstSymbol = normalizeSymbolCodeAdr0505(firstSymbol);
      const krxHit = krxInvestorRows.find((row) => normalizeSymbolCodeAdr0505(row.code) === normalizedFirstSymbol) ?? null;
      if (krxHit) {
        previousTradingDayKrxRaw = krxInvestorRowToRouterRawAdr0505({
          row: krxHit,
          sourceDate: krxSourceDate,
          status: krxDataStatus,
        });
        krxSemanticInputAdr0482 = krxInvestorRowToSemanticInputAdr0482({
          row: krxHit,
          sourceDate: krxSourceDate,
          status: krxDataStatus,
        });
      } else if (krxInvestorDiagnosticAdr0505?.parserStatus === 'OK') {
        krxInvestorDiagnosticAdr0505 = {
          ...krxInvestorDiagnosticAdr0505,
          parserStatus: 'PARSER_FIELD_MISMATCH',
          endpointIssueHint: 'SYMBOL_CODE_FORMAT_ERROR',
          summary: `${krxInvestorDiagnosticAdr0505.summary}; targetSymbol=${normalizedFirstSymbol}; symbolMatch=false`,
        };
      }
    } catch (error) {
      /* SDS-ignore: KRX parser probe error is converted to diagnostic-only metadata; executionImpact=NONE. */
      krxInvestorDiagnosticAdr0505 = {
        parserStatus: 'PROVIDER_EMPTY_RESPONSE',
        endpointIssueHint: 'ENDPOINT_PARAMETER_ERROR',
        endpoint: 'MDCSTAT02401',
        bld: 'dbms/MDC/STAT/standard/MDCSTAT02401',
        tradeDate: krxTradeDate,
        previousTradingDateCandidate: krxSourceDate,
        selectedKrxFlowMode: 'DIRECT_JSON',
        payloadMode: 'EXTENDED_VARIANT',
        routePurpose: 'SYMBOL_LEVEL',
        selectedBld: 'dbms/MDC/STAT/standard/MDCSTAT02401',
        requiredParamMissing: null,
        shortCodeToIsuCdResolved: false,
        isuCd: null,
        inqTpCd: null,
        inqVal: null,
        detailView: null,
        endpointVariant: 'MDCSTAT02401:SYMBOL_INVESTOR_FLOW:UNKNOWN:UNKNOWN',
        dateParam: 'UNKNOWN',
        marketCode: 'UNKNOWN',
        symbolCode: normalizeSymbolCodeAdr0505(firstSymbol),
        parameterKeys: [],
        attemptedVariants: [],
        selectedVariant: null,
        otpGenerated: false,
        otpLength: 0,
        csvDownloaded: false,
        csvRowCount: 0,
        csvColumnKeys: [],
        csvFailureReason: 'NETWORK_ERROR',
        csvHeaderDetected: false,
        csvNoDataReason: 'NETWORK_ERROR',
        omittedKeys: [],
        forbiddenKeysPresent: [],
        requiredKeysPresent: [],
        requiredKeysMissing: ['bld'],
        sentPayloadKeys: [],
        contentType: 'unknown',
        httpStatus: null,
        responseKind: 'NETWORK_ERROR',
        rawTopLevelKeys: [],
        detectedCandidatePaths: [],
        selectedRowPath: null,
        selectedRowCount: 0,
        firstRowKeys: [],
        normalizedRows: 0,
        fieldMappings: {
          symbol: null,
          date: null,
          investorType: null,
          foreignNetBuy: null,
          institutionNetBuy: null,
          individualNetBuy: null,
          netBuyAmount: null,
          netBuyVolume: null,
        },
        summary: `KRX_SYMBOL_INVESTOR_FLOW fetch failed for tradeDate=${krxTradeDate} sourceDate=${krxSourceDate}; error=${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const cachedNaverPoint = cacheRawToNaverInvestorTrendPointAdr0481(cacheRaw);
    let naverInvestorTrendAdr0481 = await collectNaverInvestorTrendCollectorResultAdr0481({
      code: firstSymbol,
      requestedDays: 5,
      rawPoints: null,
      nonTradingDay: sellOnlyOrClosed,
      sourceAgeTradingDays: sellOnlyOrClosed ? 1 : 0,
      tradingDateCandidates: sellOnlyOrClosed
        ? [previousTradingDateCandidate, todayKst]
        : [todayKst, previousTradingDateCandidate],
    });
    if (!naverInvestorTrendAdr0481.materializationDiagnostics.sampleMaterialized && cachedNaverPoint) {
      naverInvestorTrendAdr0481 = buildNaverInvestorTrendCollectorResultAdr0481({
        code: firstSymbol,
        requestedDays: 5,
        rawPoints: [cachedNaverPoint],
        nonTradingDay: sellOnlyOrClosed,
        sourceAgeTradingDays: supplySnapshotCacheLookupAdr0491.stale || sellOnlyOrClosed ? 4 : 0,
      });
    }
    summaryDraft.naverInvestorTrendAdr0481 = naverInvestorTrendAdr0481;
    const cacheSemanticInputAdr0482 = cacheLookupToSemanticInputAdr0482({
      code: firstSymbol,
      lookup: supplySnapshotCacheLookupAdr0491,
    }) ?? cacheRawToSemanticInputAdr0482({ code: firstSymbol, cacheRaw, stale: supplySnapshotCacheLookupAdr0491.stale });
    const kisInvestorFlowEvidence = await fetchKisInvestorFlowEvidence(firstSymbol, kstNow).catch(() => null);
    const routedInvestorFlowAdr0477 = kisInvestorFlowEvidence?.data
      ? null
      : await fetchInvestorFlowWithPolicy(firstSymbol, kstNow, { krxAutoFetchDisabled: true }).catch(() => null);
    const routedKisRawAdr0477 = routedKisFlowToAdr0477Raw({
      code: firstSymbol,
      routeResult: routedInvestorFlowAdr0477,
    });
    if (!kisInvestorFlowEvidence?.data && routedKisRawAdr0477) {
      console.info(
        `[ADR-0477] InvestorFlowProviderRouter reused policy router KIS_API status=VERIFIED symbol=${firstSymbol} reason=KIS_POLICY_ROUTER_VERIFIED_FALLBACK executionImpact=NONE`,
      );
    }
    const kisSemanticInputAdr0482 = kisEvidenceToSemanticInputAdr0482({ code: firstSymbol, evidence: kisInvestorFlowEvidence })
      ?? routedKisFlowToSemanticInputAdr0482({
        code: firstSymbol,
        routeResult: routedInvestorFlowAdr0477,
      });
    const semanticInputs = [
      kisSemanticInputAdr0482,
      naverCollectorToSemanticInputAdr0482(naverInvestorTrendAdr0481),
      krxSemanticInputAdr0482,
      cacheSemanticInputAdr0482,
    ].filter((item): item is SemanticNetBuyInputPoint => Boolean(item));
    const semanticNetBuyNormalizationAdr0482 = buildSemanticNetBuyNormalizationReportAdr0482({
      code: firstSymbol,
      generatedAt: kstNow.toISOString(),
      inputs: semanticInputs,
    });
    summaryDraft.semanticNetBuyNormalizationAdr0482 = semanticNetBuyNormalizationAdr0482;
    const investorFlowProviderRouter = buildInvestorFlowProviderRouteResultAdr0477({
      code: firstSymbol,
      collectedAt: kstNow.toISOString(),
      naverCollectorWired: true,
      naverCollectorResultAdr0481: naverInvestorTrendAdr0481,
      semanticNetBuyNormalizationAdr0482,
      cacheRaw: null,
      previousTradingDayCacheRaw: null,
      previousTradingDayKrxRaw,
      krxInvestorDiagnosticAdr0505,
      kisInvestorRaw: kisInvestorFlowEvidence?.data ? {
        code: firstSymbol,
        sourceDate: kisInvestorFlowEvidence.data.tradingDate ?? kisInvestorFlowEvidence.sample?.sourceDate ?? null,
        foreignNetBuy: kisInvestorFlowEvidence.data.foreignNetBuy,
        institutionNetBuy: kisInvestorFlowEvidence.data.institutionalNetBuy,
        individualNetBuy: kisInvestorFlowEvidence.data.individualNetBuy,
        status: kisInvestorFlowEvidence.sample?.confidence === 'VERIFIED' ? 'VERIFIED' : 'PARTIAL',
        ...(kisInvestorFlowEvidence.sample?.actualInvestorFlowRowCarrier ? { actualInvestorFlowRowCarrier: kisInvestorFlowEvidence.sample.actualInvestorFlowRowCarrier } : {}),
      } : routedKisRawAdr0477,
      kisTriedForInvestorFlow: true,
      nonTradingDay: sellOnlyOrClosed,
      sourceAgeTradingDays: naverInvestorTrendAdr0481.freshness.sourceAgeTradingDays,
      cacheAgeTradingDays: null,
      marketProgramStatus: 'ACCEPTED_EMPTY',
      fssSourceAgeTradingDays: 5,
      supplySnapshotCacheLookupAdr0491,
    });
    summaryDraft.investorFlowProviderRouter = investorFlowProviderRouter;
    rememberSupplyBySymbolPayloadSnapshot({
      routeResult: investorFlowProviderRouter as unknown as { selectedProvider?: string; bySymbol?: Record<string, Record<string, unknown>> },
      tradeDate: kstNow.toISOString().slice(0, 10),
      capturedAt: kstNow.toISOString(),
    });
    summaryDraft.supplySourceFreshnessAdr0483 = buildSupplySourceFreshnessReportAdr0483({
      now: kstNow,
      sources: [
        {
          source: 'NAVER',
          cacheUpdatedAt: null,
          sourceDate: naverInvestorTrendAdr0481.freshness.lastSourceDate,
          providerStatus: naverInvestorTrendAdr0481.status === 'DATA_AVAILABLE' ? 'OK' : naverInvestorTrendAdr0481.status === 'STALE' ? 'STALE' : 'EMPTY',
        },
        {
          source: 'SEMANTIC_NETBUY',
          cacheUpdatedAt: null,
          sourceDate: semanticNetBuyNormalizationAdr0482.selectedSample?.sourceDate ?? semanticNetBuyNormalizationAdr0482.samples[0]?.sourceDate ?? null,
          providerStatus: semanticNetBuyNormalizationAdr0482.selectedSample
            ? 'OK'
            : semanticNetBuyNormalizationAdr0482.status === 'STALE'
              ? 'STALE'
              : semanticNetBuyNormalizationAdr0482.samples.length > 0
                ? 'STALE'
                : 'EMPTY',
        },
        {
          source: 'KRX',
          cacheUpdatedAt: null,
          sourceDate: previousTradingDayKrxRaw ? previousTradingDateCandidate : null,
          providerStatus: previousTradingDayKrxRaw
            ? 'STALE'
            : krxInvestorDiagnosticAdr0505?.parserStatus === 'PROVIDER_EMPTY_RESPONSE' || krxInvestorDiagnosticAdr0505?.parserStatus === 'PARSER_KEY_MISMATCH' || krxInvestorDiagnosticAdr0505?.parserStatus === 'PARSER_FIELD_MISMATCH'
              ? 'ERROR'
              : 'EMPTY',
        },
        {
          source: 'CACHE',
          cacheUpdatedAt: null,
          sourceDate: cacheSemanticInputAdr0482?.sourceDate ?? null,
          providerStatus: cacheSemanticInputAdr0482
            ? (supplySnapshotCacheLookupAdr0491.stale ? 'STALE' : 'OK')
            : 'EMPTY',
        },
        {
          source: 'FSS',
          cacheUpdatedAt: null,
          sourceDate: null,
          providerStatus: investorFlowProviderRouter.providerStatuses.FSS === 'STALE' ? 'STALE' : 'UNKNOWN',
        },
      ],
    });
    if (process.env.KIS_FIRST_REBUILD_MODE === 'true') {
      logNoiseDetail({
        category: 'KIS_FIRST_LEGACY_DIAGNOSTIC',
        message: `[KIS_FIRST] Legacy diagnostic lane compact summary ` +
          `(ADR-0467/0468/0469/0470/0471/0472/0475/0476/0477 observed, ` +
          `usedForCurrentGate=false, executionImpact=${investorFlowProviderRouter.executionImpact}, ` +
          `selectedProvider=${investorFlowProviderRouter.selectedProvider}, fallbackProvider=${investorFlowProviderRouter.fallbackProvider ?? 'NONE'})`,
      });
    }
    emitInvestorFlowRouterEventAdr0477({
      engineMode: investorFlowProviderRouter.policyPromotionMode,
      status: investorFlowProviderRouter.status,
      signal: investorFlowProviderRouter.signal,
      selectedProvider: investorFlowProviderRouter.selectedProvider,
      executionImpact: investorFlowProviderRouter.executionImpact,
      liveExecutionAllowed: investorFlowProviderRouter.liveExecutionAllowed,
      confidence: investorFlowProviderRouter.selectedConfidence,
      providerIssue: false,
      marketSignal: investorFlowProviderRouter.signal === 'BULLISH' || investorFlowProviderRouter.signal === 'BEARISH',
      shadowLearning: true,
    });
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.buildInvestorFlowProviderRouteResultAdr0477', error: e });
  }

  // ADR-0476: dry-run and near-miss observation ledger. This stores only compact
  // observation rows for 1D/3D/5D tracking and never changes live execution.
  try {
    const observationSnapshots = options.candidateSnapshots ?? counters.entryCandidateSnapshots;
    // ADR-0520 — DRY_RUN scoring-alignment observation. Observation-only (executionImpact=NONE),
    // always recorded like the other ADR-0476 sources (no ENV toggle). The live Gate1 curve is
    // never read or mutated — only the per-candidate frozen actualScore traces and ADR-0472 report.
    const scoringAlignmentDryRunAdr0520 = buildGate1ScoringAlignmentDryRunGate({
      traces: counters.positiveScoreStarvationTraces,
      alignmentReport: summaryDraft.gate1ScoringAlignment,
    });
    // ADR-0531 정합(patch): counterfactual 관측 row 의 regime/effectiveRegime 는 scoring SSOT
    // (resolveScoringEffectiveRegime)로 통일한다. 폐기된 bare macroRegimeEffective(legacy R6-recovery
    // transition machine)는 stale 시 R6_DEFENSE 를 누출 → 아래 RegimeAwareSurvivor 와 불일치했다.
    // 비-R6·genuine R6 에선 동일값(byte-equivalent), stale-R6 누출만 raw 로 차단. rawRegime 은 불변.
    const scoringEffectiveRegime = resolveScoringEffectiveRegime(options.macroGateState);
    // 점수 스케일 정합(2026-06-11 리뷰 §4 처방): 관측 행 점수를 snapshot.gateScore(27조건 0~10
    // 스케일)가 아닌 canonical 최소신호 점수(ADR-0541 starvation trace, requiredScore=70 동일
    // 스케일)로 기록 — 55~70/70+ 밴드·NEAR_MISS 가 비로소 충전 가능 (ADR-0546 증거 잠금 해소).
    // ADR-0597 — 횡단면 percentile shadow 를 같은 map 으로 동반 주입 (관측 전용, 판정 미소비).
    // ADR-0609 — 상수블록 eligibility shadow 판정(eligible/marketOnlyPassed/percentilePassed)을
    // 같은 map 으로 동반 stamp (관측 전용, Gate 판정·정렬·entry·Kelly 미소비 — 소비처 0).
    const crossSectionalBySymbol = new Map(
      (summaryDraft.gate1CrossSectionalShadowAdr0597?.scores ?? []).map((score) => [score.symbol, score]),
    );
    const eligibilityBySymbol = new Map(
      (summaryDraft.gate1EligibilityShadowAdr0609?.judgments ?? []).map((judgment) => [judgment.symbol, judgment]),
    );
    const minSignalScoreBySymbol = Object.fromEntries(
      counters.positiveScoreStarvationTraces
        .filter((trace) => Number.isFinite(trace.actualScore))
        .map((trace) => {
          const crossSectional = crossSectionalBySymbol.get(trace.symbol);
          const eligibility = eligibilityBySymbol.get(trace.symbol);
          return [trace.symbol, {
            actualScore: trace.actualScore,
            requiredScore: trace.requiredScore,
            ...(crossSectional ? {
              totalPercentile: crossSectional.totalPercentile,
              ...(crossSectional.marketBlockScore !== null ? { marketBlockScore: crossSectional.marketBlockScore } : {}),
              ...(crossSectional.marketBlockPercentile !== null ? { marketBlockPercentile: crossSectional.marketBlockPercentile } : {}),
            } : {}),
            ...(eligibility ? {
              eligible: eligibility.eligible,
              ...(eligibility.marketOnlyPassed !== null ? { marketOnlyPassed: eligibility.marketOnlyPassed } : {}),
              percentilePassed: eligibility.percentilePassed,
            } : {}),
          }];
        }),
    );
    const rows = buildGate1DryRunObservationRows({
      now: kstNow,
      forDate: kstNow.toISOString().slice(0, 10),
      sourceSnapshotId,
      scanId: sourceSnapshotId,
      candidateSetId: `candidateSet:${sourceSnapshotId}:${observationSnapshots.length}`,
      minSignalScoreBySymbol,
      topN: resolveGate1ObservationTopNEnv(),
      regime: scoringEffectiveRegime,
      rawRegime: options.macroGateState?.macroRegimeRaw ?? options.macroGateState?.regime ?? 'UNKNOWN',
      effectiveRegime: scoringEffectiveRegime,
      displayRegime: options.macroGateState?.displayRegime ?? options.macroGateState?.engineMode ?? 'UNKNOWN',
      engineMode: options.macroGateState?.engineMode ?? 'UNKNOWN',
      policyView: options.macroGateState?.finalExecutionPolicy ?? options.macroGateState?.engineMode ?? 'UNKNOWN',
      marketSession: options.macroGateState?.engineMode ?? 'BUY_ALLOWED',
      marketSessionState: scanEvaluation.marketSessionState,
      candidateSnapshots: observationSnapshots,
      finalGate1Calibration: summaryDraft.finalGate1Calibration,
      gate1PositiveSourceWiring: summaryDraft.gate1PositiveSourceWiring,
      scoringAlignmentDryRunAdr0520,
      investorFlowProviderRouter: summaryDraft.investorFlowProviderRouter,
      naverInvestorTrendAdr0481: summaryDraft.naverInvestorTrendAdr0481,
      semanticNetBuyNormalizationAdr0482: summaryDraft.semanticNetBuyNormalizationAdr0482,
      sellOnly: false,
      sectorEnergyDiagnosticOnly: options.sectorEnergyQuality !== undefined && options.sectorEnergyQuality !== 'OK',
      providerIssue: observationSnapshots.some((item) => item.supplyProviderHealth?.providerIssue === true),
      marketSignal: observationSnapshots.some((item) => item.supplyProviderHealth?.marketSignal === true),
    });
    await saveGate1DryRunObservationRows(rows);
    summaryDraft.gate1DryRunObservationLedger = summarizeGate1DryRunObservationRows(rows, rows.length);
    summaryDraft.gate1ThresholdEvidence = buildGate1ThresholdEvidenceSummary(rows);
    // ADR-0546 Phase2 prep — regime 인식 임계로 추가 통과할 후보 관측 (섀도 전용, flag OFF 불변).
    summaryDraft.gate1RegimeAwareSurvivor = buildGate1RegimeAwareSurvivorObservation(
      rows,
      scoringEffectiveRegime,
    );
    logAdrDiagnostic(
      `[ADR-0476] Gate1DryRunObservation rows emitted`,
      {
        adrCode: 'ADR-0476',
        dryRun: true,
        executionImpact: summaryDraft.gate1DryRunObservationLedger.executionImpact,
        liveExecutionAllowed: summaryDraft.gate1DryRunObservationLedger.liveExecutionAllowed,
        rows: rows.length,
        reason: 'GATE1_DRY_RUN_OBSERVATION_ROWS',
      },
    );
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.buildGate1DryRunObservation', error: e });
  }

  {
    const noiseCounters = getNoiseCounters();
    logGateDiagnosticSummary({
      session: 'REGULAR',
      dryRuns: noiseCounters.gateDiagnostics,
      candidates: summaryDraft.candidates,
      deferred: noiseCounters.gateDiagnostics,
      executionImpact: 'NONE',
    });
  }

  // ADR-0484/0485/0486/0487/0488: persist supply recovery/readiness/mount/fresh-data/UNKNOWN
  // evidence into ScanSummary before Runtime Pipeline Audit reads it.
  // ScanSummary before Runtime Pipeline Audit reads it. Diagnostic-only.
  try {
    summaryDraft.investorFlowSampleAdr0489 = buildInvestorFlowSampleAcquisitionReportAdr0489({
      generatedAt: kstNow.toISOString(),
      providerIssue: summaryDraft.investorFlowProviderRouter?.status === 'PROVIDER_ERROR',
      samples: summaryDraft.naverInvestorTrendAdr0481 ? [{
        symbol: 'NAVER_INVESTOR_TREND',
        provider: 'NAVER',
        sourceDate: summaryDraft.naverInvestorTrendAdr0481.semanticNetBuyCandidate?.sourceDate ?? summaryDraft.naverInvestorTrendAdr0481.freshness.lastSourceDate,
        status: summaryDraft.naverInvestorTrendAdr0481.status === 'PROVIDER_ERROR' ? 'PROVIDER_ERROR' : 'DATA_UNAVAILABLE',
      }] : [],
      diagnostics: ['ADR-0496 ScanSummary diagnostic sample seed; no raw provider payload persisted.'],
    });
    const supplyCoverageRecoveryAdr0484 = buildSupplyCoverageRecoveryObservationReportAdr0484({
      scanSummary: summaryDraft,
      investorFlowProviderRouterAdr0477: summaryDraft.investorFlowProviderRouter,
      naverInvestorTrendAdr0481: summaryDraft.naverInvestorTrendAdr0481,
      semanticNetBuyNormalizationAdr0482: summaryDraft.semanticNetBuyNormalizationAdr0482,
      supplySourceFreshnessAdr0483: summaryDraft.supplySourceFreshnessAdr0483,
      gate1DryRunObservationLedgerAdr0476: summaryDraft.gate1DryRunObservationLedger,
      timestamp: kstNow.toISOString(),
      persist: false,
    });
    summaryDraft.supplyCoverageRecoveryAdr0484 = supplyCoverageRecoveryAdr0484;
    const supplyAdvisoryReadinessAdr0485 = buildSupplyAdvisoryReadinessReportAdr0485({
      generatedAt: kstNow.toISOString(),
      supplyCoverageRecoveryAdr0484,
      gate1DryRunObservationRowsAdr0476: [],
    });
    summaryDraft.supplyAdvisoryReadinessAdr0485 = supplyAdvisoryReadinessAdr0485;
    summaryDraft.supplyRecoveryRuntimeMountAdr0486 = buildSupplyRecoveryRuntimeMountReportAdr0486({
      generatedAt: kstNow.toISOString(),
      naverInvestorTrendAdr0481: summaryDraft.naverInvestorTrendAdr0481,
      semanticNetBuyNormalizationAdr0482: summaryDraft.semanticNetBuyNormalizationAdr0482,
      supplySourceFreshnessAdr0483: summaryDraft.supplySourceFreshnessAdr0483,
      supplyCoverageRecoveryAdr0484,
      supplyAdvisoryReadinessAdr0485,
      investorFlowProviderRouterAdr0477: summaryDraft.investorFlowProviderRouter,
      compactOutput: [
        'ADR-0484 SupplyRecovery mounted in ScanSummary',
        'ADR-0485 SupplyReadiness mounted in ScanSummary',
        'ADR-0486 RuntimeMount mounted in ScanSummary',
      ],
      detailRegistryEntries: [
        { adr: '0481', adrTraceHint: '/adr_trace 0481', commandHint: '/supply_health_detail' },
        { adr: '0482', adrTraceHint: '/adr_trace 0482', commandHint: '/supply_health_detail' },
        { adr: '0483', adrTraceHint: '/adr_trace 0483', commandHint: '/supply_health_detail' },
        { adr: '0484', adrTraceHint: '/adr_trace 0484', commandHint: '/supply_health_detail' },
        { adr: '0485', adrTraceHint: '/adr_trace 0485', commandHint: '/supply_health_detail' },
        { adr: '0486', adrTraceHint: '/adr_trace 0486', commandHint: '/supply_health_detail' },
      ],
      runtimePipelineAuditEvidence: `ADR-0485 readinessAuditEvidence=${supplyAdvisoryReadinessAdr0485.status} ADR-0486 supplyRecoveryMount=mounted`,
    });
    summaryDraft.freshDataSupplyAdr0487 = buildFreshDataSupplyReportAdr0487({
      generatedAt: kstNow.toISOString(),
      sectorEnergyDiagnosticAdr0474: summaryDraft.sectorEnergyQualityDiagnostic as unknown as Record<string, unknown> | null,
      naverInvestorTrendAdr0481: summaryDraft.naverInvestorTrendAdr0481 as unknown as Record<string, unknown>,
      semanticNetBuyNormalizationAdr0482: summaryDraft.semanticNetBuyNormalizationAdr0482 as unknown as Record<string, unknown>,
      supplySourceFreshnessAdr0483: summaryDraft.supplySourceFreshnessAdr0483 as unknown as FreshDataSupplyReportInputAdr0487['supplySourceFreshnessAdr0483'],
      supplyCoverageRecoveryAdr0484: supplyCoverageRecoveryAdr0484 as unknown as Record<string, unknown>,
      supplyAdvisoryReadinessAdr0485: supplyAdvisoryReadinessAdr0485 as unknown as Record<string, unknown>,
      investorFlowProviderRouterAdr0477: summaryDraft.investorFlowProviderRouter,
      supplyCoverageReportAdr0496: summaryDraft.investorFlowSampleAdr0489.adr0496SupplyCoverage,
    });
    let officialSectorIndexMaster: OfficialSectorIndexMasterCoverageResult | null = null;
    const officialSectorTargets = collectOfficialSectorIndexTargets(
      options.candidateSnapshots ?? counters.entryCandidateSnapshots,
      summaryDraft.sectorEnergyQualityDiagnostic,
    );
    const officialSectorProvider = await loadKisOfficialSectorIndexMaster({ writeCache: true });
    // 휴장/주말엔 KIS 업종지수 현재가 세션이 없어 verify 가 0/실패로 false-alarm 을 낸다.
    // 라이브 verify 를 건너뛰고 SECTOR_INDEX_MARKET_CLOSED 로 분류한다 (promotionAllowed 결정은 동일, executionImpact=NONE).
    const sectorIndexMarketClosed = !isTradingDay(kstNow.toISOString().slice(0, 10));
    officialSectorIndexMaster = await buildOfficialSectorIndexMasterCoverage({
      provider: officialSectorProvider,
      targets: officialSectorTargets,
      verifyIndexCode: verifySectorIndexCodeWithKisCurrentPrice,
      marketClosed: sectorIndexMarketClosed,
    });
    summaryDraft.sectorEnergySupplyUnknownAdr0488 = buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({
      generatedAt: kstNow.toISOString(),
      sectorEnergyDiagnosticAdr0474: summaryDraft.sectorEnergyQualityDiagnostic as unknown as Record<string, unknown> | null,
      officialSectorIndexMaster,
      freshDataSupplyAdr0487: summaryDraft.freshDataSupplyAdr0487,
      finalGate1CalibrationAdr0471: summaryDraft.finalGate1Calibration,
      penaltyDeduplicationAdr0469: summaryDraft.penaltyDeduplication,
      candidateSnapshots: options.candidateSnapshots ?? counters.entryCandidateSnapshots,
      providerIssue: (options.candidateSnapshots ?? counters.entryCandidateSnapshots).some((item) => item.supplyProviderHealth?.providerIssue === true),
      marketSignal: (options.candidateSnapshots ?? counters.entryCandidateSnapshots).some((item) => item.supplyProviderHealth?.marketSignal === true),
      providerStatus: summaryDraft.investorFlowProviderRouter?.status ?? summaryDraft.naverInvestorTrendAdr0481?.status ?? 'UNKNOWN',
      currentSupplySignal: summaryDraft.investorFlowProviderRouter?.signal ?? 'UNKNOWN',
    });
    summaryDraft.supplySnapshotStoreAdr0491 = recordSupplySnapshotAdr0491({
      scanId: `scan-${kstNow.toISOString()}`,
      recordedAt: kstNow.toISOString(),
      tradingDate: kstNow.toISOString().slice(0, 10),
      freshDataSupplyAdr0487: summaryDraft.freshDataSupplyAdr0487,
      sectorEnergySupplyUnknownAdr0488: summaryDraft.sectorEnergySupplyUnknownAdr0488,
      investorFlowSampleAdr0489: summaryDraft.investorFlowSampleAdr0489,
      supplyCoverageReportAdr0496: summaryDraft.investorFlowSampleAdr0489.adr0496SupplyCoverage,
      diagnostics: ['Recorded from ScanSummary diagnostics only; replay is not used by live Gate decisions.'],
    });
    // ADR-0531 정합(patch): 위 블록과 동일 — counterfactual 관측 regime 을 scoring SSOT 로 통일.
    const supplyRecoveryScoringRegime = resolveScoringEffectiveRegime(options.macroGateState);
    await saveGate1DryRunObservationRows(buildGate1DryRunObservationRows({
      now: kstNow,
      forDate: kstNow.toISOString().slice(0, 10),
      sourceSnapshotId,
      scanId: sourceSnapshotId,
      candidateSetId: `candidateSet:${sourceSnapshotId}:${(options.candidateSnapshots ?? counters.entryCandidateSnapshots).length}`,
      regime: supplyRecoveryScoringRegime,
      rawRegime: options.macroGateState?.macroRegimeRaw ?? options.macroGateState?.regime ?? 'UNKNOWN',
      effectiveRegime: supplyRecoveryScoringRegime,
      displayRegime: options.macroGateState?.displayRegime ?? options.macroGateState?.engineMode ?? 'UNKNOWN',
      engineMode: options.macroGateState?.engineMode ?? 'UNKNOWN',
      policyView: options.macroGateState?.finalExecutionPolicy ?? options.macroGateState?.engineMode ?? 'UNKNOWN',
      marketSession: options.macroGateState?.engineMode ?? 'BUY_ALLOWED',
      marketSessionState: scanEvaluation.marketSessionState,
      supplyRecoveryRuntimeMountAdr0486: summaryDraft.supplyRecoveryRuntimeMountAdr0486,
      freshDataSupplyAdr0487: summaryDraft.freshDataSupplyAdr0487,
      sectorEnergySupplyUnknownAdr0488: summaryDraft.sectorEnergySupplyUnknownAdr0488,
      supplySnapshotStoreAdr0491: summaryDraft.supplySnapshotStoreAdr0491,
    }));
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.buildSupplyRecoveryFreshDataUnknownReports', error: e });
  }

  // ADR-0505 — Gate1 Minimum Signal Forensic Audit summary build + per-symbol detail
  // trace persist. Diagnostic-only — executionImpact='NONE' literal type 강제.
  // ENV `GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED=true` 1줄 우회 (ADR-0157 정확 비교).
  //
  // ADR-0507 Phase 1 — caller 가 options.gate1ForensicInputs 를 전달하지 않으면
  // summaryDraft.entryFilterDecomposition 결과로부터 자동 합성 (`collectGate1ForensicInputs
  // FromEntryFilterDecompositionAdr0507` SSOT 위임). 본 wiring 이후 운영 환경의
  // SUMMARY_FIELD_MISSING 결함이 EMITTED 로 자연 전환.
  try {
    // WIRE_SELECTED_CANDIDATE_ACTUAL_ROW — 후보 전체 aggregate carry map 을 forensic collector
    // 의 supplyRouterResult.bySymbol 에 merge. firstSymbol router payload(full KIS evidence, 더
    // 풍부)가 충돌 시 우선하고, carry map 이 나머지 후보를 채운다. 이로써 per-candidate actual
    // row 가 snapshot retention/freshness 에 비의존적으로 결정론적 carry 된다. DIAGNOSTIC_ONLY.
    const supplyRouterResultForForensic = (() => {
      const carryBySymbol = options.investorFlowBySymbolCarry;
      if (!carryBySymbol || Object.keys(carryBySymbol).length === 0) {
        return summaryDraft.investorFlowProviderRouter;
      }
      const baseRouter = (summaryDraft.investorFlowProviderRouter ?? {}) as Record<string, unknown>;
      const routerBySymbol = baseRouter.bySymbol && typeof baseRouter.bySymbol === 'object'
        ? (baseRouter.bySymbol as Record<string, Record<string, unknown>>)
        : {};
      return { ...baseRouter, bySymbol: { ...carryBySymbol, ...routerBySymbol } };
    })();
    const effectiveForensicInputs =
      options.gate1ForensicInputs && options.gate1ForensicInputs.length > 0
        ? options.gate1ForensicInputs
        : collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({
            gate1CandidateTraces: summaryDraft.entryFilterDecomposition?.gate1CandidateTraces,
            candidateTraces: summaryDraft.entryFilterDecomposition?.candidateTraces,
            supplyProviderHealth: summaryDraft.entryFilterDecomposition?.supplyProviderHealth,
            supplyRouterResult: supplyRouterResultForForensic,
            tradeDate: kstNow.toISOString().slice(0, 10),
            now: kstNow.toISOString(),
          });
    if (
      !isGate1MinimumSignalForensicAuditDisabled() &&
      effectiveForensicInputs &&
      effectiveForensicInputs.length > 0
    ) {
      const audits = effectiveForensicInputs.map((input) =>
        buildGate1MinimumSignalForensicAuditAdr0505(input),
      );
      const forensicSummary = buildGate1MinimumSignalForensicSummaryAdr0505(audits);
      const buyListLoopEntered = Boolean(summaryDraft.entryFilterDecomposition?.gate1CandidateTraces?.length);
      forensicSummary.buyListLoopEntered = buyListLoopEntered;
      forensicSummary.perSymbolEvaluationEntered = buyListLoopEntered;
      forensicSummary.evaluationState = resolveGate1EvaluationStateAdr0510({
        totalCandidates: forensicSummary.totalCandidates,
        traceWithQuoteCount: forensicSummary.traceWithQuoteCount ?? forensicSummary.candidateTraceHasQuote ?? 0,
        traceWithSymbolFeaturesCount: forensicSummary.traceWithSymbolFeaturesCount ?? forensicSummary.candidateTraceHasSymbolFeatures ?? 0,
        traceWithConditionResultsCount: forensicSummary.traceWithConditionResultsCount ?? forensicSummary.candidateTraceHasConditionResults ?? 0,
        minSignalScoreTraceAvailableCount: forensicSummary.minSignalScoreTraceAvailableCount,
        buyListLoopEntered,
        gateEvaluationOutputAvailableCount: forensicSummary.gateEvaluationOutputAvailableCount,
        sellOnlyMode: false,
        orderBlocked: (((summaryDraft.waitDistribution as Record<string, number> | undefined)?.orderBlocked ?? 0) > 0),
      });
      summaryDraft.gate1MinimumSignalForensicAdr0505 = forensicSummary;

      // 종목별 detail trace 별도 영속 (FIFO 200 + 7일 TTL).
      // 영속 throw 는 try/catch 격리 — scan 흐름 절대 차단 안 함.
      const scanIdLabel = `${kstNow.toISOString().slice(0, 10)}:${timeLabel}`;
      appendGate1ForensicTrace(scanIdLabel, kstNow.toISOString(), audits);
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.buildGate1MinimumSignalForensicAuditAdr0505', error: e });
  }

  // ADR-0500 — Empty Scan Root Cause Dashboard snapshot. Diagnostic-only aggregation;
  // no scan decision, stage, order path, or persisted provider data mutation.
  const canonicalRuntimeResolutionForRootCause = buildCanonicalRuntimeResolutionStep27(summaryDraft);

  try {
    const rootCauseInputs: Array<{ source: 'SCAN_BLOCKER'; reason: string | null; message?: string; count?: number }> = [];
    if (summaryDraft.emptyScanReason) {
      rootCauseInputs.push({ source: 'SCAN_BLOCKER', reason: summaryDraft.emptyScanReason, message: describeEmptyScanReason(summaryDraft.emptyScanReason).label });
    }
    if (summaryDraft.macroGateState?.bearDefenseMode || summaryDraft.macroGateState?.vixGatingActive || summaryDraft.macroGateState?.mhsBelow30) {
      rootCauseInputs.push({ source: 'SCAN_BLOCKER', reason: 'MACRO_RISK_OFF', count: 1 });
    }
    if (canonicalRuntimeResolutionForRootCause.sizing.hardBlockCount > 0) {
      rootCauseInputs.push({
        source: 'SCAN_BLOCKER',
        reason: 'SIZING',
        count: canonicalRuntimeResolutionForRootCause.sizing.hardBlockCount,
      });
    }
    if (summaryDraft.waitDistribution?.gateFail) rootCauseInputs.push({ source: 'SCAN_BLOCKER', reason: 'THRESHOLD', count: summaryDraft.waitDistribution.gateFail });
    if (summaryDraft.quoteFails > 0) rootCauseInputs.push({ source: 'SCAN_BLOCKER', reason: 'PROVIDER_ERROR', count: summaryDraft.quoteFails });
    if (summaryDraft.sectorEnergyQuality && summaryDraft.sectorEnergyQuality !== 'OK') {
      rootCauseInputs.push({ source: 'SCAN_BLOCKER', reason: 'SECTOR_ENERGY', count: 1, message: summaryDraft.sectorEnergyQuality });
    }
    if ((summaryDraft.positiveScoreStarvation?.totalCandidates ?? 0) > 0) {
      rootCauseInputs.push({ source: 'SCAN_BLOCKER', reason: 'SCORE_STARVATION', count: summaryDraft.positiveScoreStarvation?.totalCandidates });
    }
    if (summaryDraft.entries === 0 || rootCauseInputs.length > 0) {
      summaryDraft.emptyScanRootCause = safeBuildEmptyScanRootCauseDashboardAdr0500({
        scanId: `scan-${kstNow.toISOString()}`,
        at: kstNow.toISOString(),
        events: buildEmptyScanRootCauseEventsFromStringsAdr0500(rootCauseInputs),
        totalEmptyScans: summaryDraft.entries === 0 ? 1 : 0,
      });
      summaryDraft.weekendReplaySummaryAdr0501 = safeBuildWeekendReplaySummaryAdr0501({
        records: buildWeekendReplayRecordsFromStringsAdr0501(rootCauseInputs.map((input) => ({
          source: 'SCAN_SUMMARY',
          reason: input.reason,
          message: input.message,
          scanId: `scan-${kstNow.toISOString()}`,
          replayMode: 'LATEST',
        }))),
        replayMode: 'LATEST',
        generatedAt: kstNow.toISOString(),
        totalScans: 1,
        totalSymbols: summaryDraft.candidates,
      });
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.buildEmptyScanRootCauseWeekendReplay', error: e });
  }

  summaryDraft.canonicalRuntimeResolution = canonicalRuntimeResolutionForRootCause;

  // ADR-0526 Phase 1a — per-candidate Gate0/1/2/3 판단 정본 View 도출·영속 (가산만, 무위험).
  // entryFilterDecomposition / gateLayerAudit / meta 가 모두 세팅된 *후* 도출 — 정본 입력 정합.
  // 결정론적(네트워크/캐시/더미 시각 없음). 이 View 를 읽는 소비자는 1b 전까지 0 — 화면 무변화.
  // 빌드 실패가 ScanSummary 영속을 차단해서는 안 됨 — try/catch 격리.
  try {
    const candidateGateViews = buildCandidateGateEvaluationViews(summaryDraft);
    if (candidateGateViews.length > 0) {
      summaryDraft.candidateGateViews = candidateGateViews;
      // gate2Coverage(표시용 보조 axis 지표)를 confluence 정본에서 1회 도출해 aggregate 에 carry —
      // formatter 가 buildGate2ConfluenceSummary 를 재실행하지 않도록 함(ADR-0526 §Decision.5).
      summaryDraft.candidateGateAggregate = aggregateCandidateGateEvaluationViews(
        candidateGateViews,
        buildCandidateGate2Coverage(summaryDraft),
      );
      // gate2 confluence / gate3 closure 정본 스냅샷(스캔-시점, 캐시 미사용) 영속 — full-mode formatter read 용.
      summaryDraft.candidateGate2Confluence = buildCandidateGate2ConfluenceSnapshot(summaryDraft);
      summaryDraft.candidateGate3Closure = buildCandidateGate3ClosureSnapshot(summaryDraft);
      // counterfacture_gate Phase G — Gate2 confluence outcome seed 영속(forward-return 성숙 대상, executionImpact=NONE).
      const gate2Confluence = summaryDraft.candidateGate2Confluence;
      if (gate2Confluence) {
        try {
          const gate2PriceBySymbol = new Map<string, number>();
          for (const snap of scanCandidateSnapshots) {
            const px = snap.price ?? snap.currentPrice;
            if (typeof px === 'number' && Number.isFinite(px) && px > 0) gate2PriceBySymbol.set(snap.symbol, px);
          }
          upsertGate2OutcomeSeeds(buildGate2OutcomeSeeds(gate2Confluence.results, gate2PriceBySymbol, {
            sourceSnapshotId,
            tradeDate: kstNow.toISOString().slice(0, 10),
            asOf: kstNow.toISOString(),
            // ADR-0531 정합: Gate2 counterfactual outcome seed regime 도 scoring SSOT 로 통일(stale-R6 누출 차단).
            // macroGateState 부재 시 기존 undefined 계약 보존 → byte-equivalent(비-R6·genuine R6 동일값).
            regime: options.macroGateState ? resolveScoringEffectiveRegime(options.macroGateState) : undefined,
          }));
        } catch (e) {
          emitScanDiagnosticBuildFailedWarn({ sourcePath: 'counterfactureGate.gate2OutcomeCapture', error: e });
        }
      }
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.buildCandidateGateEvaluationViews', error: e });
  }

  // ADR-0648 W5 — 눌림목 레인 force-ON hypothetical shadow 관측 집계. flag 무관 상시 산출 —
  // 추격 대비 눌림목 분포를 stamp(추격 FIRED·과열 거부·눌림목 단독). try/catch 격리(불변식 #1·#2 무정지),
  // marketSignal=false·executionImpact=NONE. live entry-selection 무영향 — 관측 ledger 행에만 기록.
  try {
    const { buildPullbackLaneShadowStamp, buildPullbackLaneShadowSummary } =
      await import('../../../quant/conditions/pullbackLaneShadowObservationAdr0648.js');
    const stamps = scanCandidateSnapshots.map((snap) => buildPullbackLaneShadowStamp({
      price: snap.price ?? snap.currentPrice,
      high5d: snap.high5d,
      high20d: snap.high20d,
      ma20: snap.ma20,
      volume: snap.volume,
      avgVolume: snap.avgVolume,
    }));
    if (stamps.length > 0) {
      summaryDraft.pullbackLaneShadowAdr0648 = buildPullbackLaneShadowSummary(stamps);

      // ADR-0650 §D1 — 영속 seam. flag ON 일 때만 per-candidate stamp 를 forward-return 성숙
      // 대상 관측 row 로 굳힌다. flag OFF=byte-equivalent(row append 0). 위 stamp *집계*는 flag
      // 무관 force-ON 유지(현 동작 무변경). 영속 실패가 스캔 진행을 막지 않도록 inner try/catch
      // 격리(불변식 #1). executionImpact=NONE — 진입 selection·Gate 판정·주문 무관.
      try {
        const { isPullbackLaneForwardObservationEnabled } = await import('../../gateConfig.js');
        if (isPullbackLaneForwardObservationEnabled()) {
          const { upsertObservation, buildObservationRowFromStamp } =
            await import('../../../persistence/pullbackLaneObservationRepo.js');
          const asOf = kstNow.toISOString();
          for (let i = 0; i < scanCandidateSnapshots.length; i += 1) {
            const snap = scanCandidateSnapshots[i];
            const stamp = stamps[i];
            if (!snap || !stamp || !snap.symbol) continue;
            // entryLane/entryRrr 는 snapshot 에서 가용 시만 carry — 없으면 undefined(계약 정합).
            const snapRecord = snap as unknown as Record<string, unknown>;
            const entryLane = snapRecord.entryLane === 'PULLBACK' ? 'PULLBACK' : undefined;
            const rawRrr = snapRecord.entryRrr ?? snapRecord.rrr;
            const entryRrr = typeof rawRrr === 'number' && Number.isFinite(rawRrr) ? rawRrr : undefined;
            upsertObservation(buildObservationRowFromStamp(stamp, {
              scanId: sourceSnapshotId,
              symbol: snap.symbol,
              asOf,
              entryLane,
              entryRrr,
            }));
          }
        }
      } catch (e) {
        emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.pullbackLaneObservationPersist.adr0650', error: e });
      }
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.pullbackLaneShadowAdr0648', error: e });
  }

  // ADR-0527 Phase 2a — per-candidate 통합 실행허가 정본 도출·영속 (가산만, 무위험).
  // Phase1 candidateGateViews 가 세팅된 *후* 도출 — gate quality 정본 입력 정합.
  // A(resolveExecutionPermission) 는 LIVE 와 byte-equivalent, B 라벨은 실제 스캔 시각(더미 1970 의존 0)으로 산출.
  // 소비자(formatter)는 Phase 2b 전까지 0 → 화면 무변화. 빌드 실패가 ScanSummary 영속을 차단하지 않도록 try/catch 격리.
  try {
    const executionResolutions = buildCandidateExecutionResolutions(summaryDraft);
    if (executionResolutions.length > 0) {
      summaryDraft.candidateExecutionResolutions = executionResolutions;
      summaryDraft.executionResolutionAggregate = aggregateUnifiedExecutionPermission(executionResolutions);
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.buildCandidateExecutionResolutions', error: e });
  }

  try {
    summaryDraft.unifiedOutcomeLabeler = buildUnifiedForwardOutcomeLabelerStatusForScan();
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.buildUnifiedForwardOutcomeLabelerStatusForScan', error: e });
  }

}
