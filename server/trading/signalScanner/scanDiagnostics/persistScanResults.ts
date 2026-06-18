/**
 * @responsibility ScanSummary persistence assembly with last-scan runtime state.
 * ADR-0001 scan diagnostics core split.
 */

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
import { buildGate1CrossSectionalShadowReportAdr0597 } from '../gate1CrossSectionalShadowScoreAdr0597.js';
import {
  buildGate1EligibilityShadowReportAdr0609,
  GATE1_ELIGIBILITY_COMPONENT_CODES,
} from '../gate1EligibilityShadowScoreAdr0609.js';
import { hydrateGate2InvestorFlowAdr0601 } from './gate2InvestorFlowHydrationAdr0601.js';
import { hydrateGate2SectorCycleAdr0601 } from './gate2SectorCycleHydrationAdr0601.js';
import { hydrateGate2SoxSemiAxisAdr0605 } from './gate2SoxSemiAxisAdr0605.js';
import { appendGate2SoxObservation } from './gate2SoxObservationLedgerAdr0605.js';
import { accumulatePositiveScoreStarvation } from './scanCounterAccumulators.js';
import { persistMidScanDiagnosticBlocksAdr0588 } from './persistScanResultsMidBlocks.js';
// ADR-0623 Stage 2a — PriceIntegrity/PriceCorrection diagnostics 집계 reduce 용 status/type union (타입 전용).
import type { PriceIntegrityStatus } from '../priceIntegrityChecker.js';
import type { PriceCorrectionType } from '../priceCorrectionEngine.js';
let _lastBuySignalAt = 0;
let _consecutiveZeroScans = 0;
let _lastScanSummary: ScanSummary | null = null;

export function getLastBuySignalAt(): number { return _lastBuySignalAt; }
export function getLastScanSummary(): ScanSummary | null { return _lastScanSummary; }
export function getConsecutiveZeroScans(): number { return _consecutiveZeroScans; }

/**
 * Patch: preflight HARD_BLOCK 경로에서 minimal diagnostic ScanSummary 를 영속한다 (display-only).
 * 실제 스캔 summary 는 절대 clobber 하지 않는다 — _lastScanSummary 가 null 이거나 직전 값이 본인(preflight diagnostic)일 때만 교체.
 * 정상 persistScanResults 1회가 들어오면 그 값이 우선되고 clearPreflightBlockedScanSummary 가 stale 을 제거한다.
 */
export function setPreflightDiagnosticScanSummaryIfAbsent(summary: ScanSummary): void {
  if (_lastScanSummary !== null && !isPreflightDiagnosticScanSummary(_lastScanSummary)) return;
  _lastScanSummary = summary;
  setLastSectorEnergyCanonicalState(summary.sectorEnergySupplyUnknownAdr0488?.sectorEnergyCanonicalState);
}

export function setLastBuySignalAt(ts: number): void { _lastBuySignalAt = ts; }

export type { PersistScanResultsOptions };

export async function persistScanResults(
  counters: ScanCounters,
  options: PersistScanResultsOptions,
): Promise<void> {
  // ADR-0366: sellOnly 시간대에도 scan summary는 반드시 저장한다.
  // 매수 trace 영속/침묵 알림/R3 sanity side-effect만 sellOnly에서 생략한다.
  if (counters.pendingTraces.length > 0) {
    appendScanTraces(counters.pendingTraces);
  }

  const kstNow = new Date(Date.now() + 9 * 3_600_000);
  const timeLabel = kstNow.toISOString().slice(11, 16) + ' KST';
  const totalCandidates = options.buyListLength + options.intradayBuyListLength;
  const scanCandidateSnapshots = options.candidateSnapshots ?? counters.entryCandidateSnapshots;
  const scanEvaluation = options.scanEvaluation ?? buildScanEvaluationResult({
    // ADR-0528 a1/a2: 호출자 scan-start scanAsOf 우선 → scanEvaluation.scanId 가
    // context.sourceSnapshotId 와 동일값(byte-identical). 부재 시 kstNow 자연 fallback.
    asOf: options.scanAsOf ?? kstNow.toISOString(),
    counters,
    totalCandidates,
    sellOnly: false,
    marketSessionState: 'BUY_ALLOWED',
    engineMode: options.macroGateState?.engineMode === 'SELL_ONLY' ? 'NORMAL' : options.macroGateState?.engineMode,
    // ADR-0531 정합: bare macroRegimeEffective 제거(파일 전역 일관). buildScanEvaluationResult 가
    // buildCanonicalRegimeDiagnostics 로 재정규화(leak-block 이미 수행)하므로 byte-identical.
    effectiveRegime: options.macroGateState ? resolveScoringEffectiveRegime(options.macroGateState) : undefined,
    macroGateState: options.macroGateState,
    volumeClockAllowsEntry: options.volumeClockAllowsEntry,
    sourcePath: 'scanDiagnosticsCore.persistScanResults',
    diagnostics: {
      buyListLength: options.buyListLength,
      intradayBuyListLength: options.intradayBuyListLength,
      swingListLength: options.swingListLength,
      catalystListLength: options.catalystListLength,
      momentumListLength: options.momentumListLength,
    },
  });
  const sourceSnapshotId =
    (scanEvaluation as { scanId?: string }).scanId ??
    options.macroGateState?.regimeSnapshotId ??
    `scan-eval:${kstNow.toISOString()}`;
  const scanAsOf = kstNow.toISOString();
  const gateLayerAudit = buildGateLayerAuditSummary(counters, {
    sourceSnapshotId,
    asOf: scanAsOf,
    tradeDate: scanAsOf.slice(0, 10),
    gate3SnapshotId: `${sourceSnapshotId}:gate3`,
    shadowPolicyContext: {
      livePolicyAllowed: options.macroGateState
        ? options.macroGateState.liveEntryAllowed !== false
          && options.macroGateState.brokerOrderAllowed !== false
          && options.macroGateState.brokerLiveOrderAllowed !== false
        : undefined,
      engineMode: options.macroGateState?.engineMode,
      macroRegime: options.macroGateState?.regime,
      // ADR-0531 정합: bare macroRegimeEffective 제거. 소비자(gateLayerDiagnostics:481/509)가 macroRegime(정본)
      // 우선이라 본 effectiveRegime fallback 은 prod 무영향(byte-identical) — 일관성/미래 누출 방지.
      effectiveRegime: options.macroGateState ? resolveScoringEffectiveRegime(options.macroGateState) : undefined,
      riskOverride: options.macroGateState?.riskOverride,
      sellOnlyMode: options.sellOnly === true || options.macroGateState?.sellOnlyMode === true,
      shadowOnlyMode: options.macroGateState?.engineMode === 'SHADOW_ONLY',
      brokerLiveOrderAllowed: options.macroGateState?.brokerLiveOrderAllowed,
    },
  });
  if (gateLayerAudit.gate3Consolidated?.outcomeSeeds.length) {
    const result = upsertGate3OutcomeSeeds(gateLayerAudit.gate3Consolidated.outcomeSeeds, {
      tradeDate: scanAsOf.slice(0, 10),
    });
    gateLayerAudit.gate3Consolidated.outcomeTracking = result.summary;
    gateLayerAudit.gate3Consolidated.thresholdEvidence = buildGate3EvidenceScore(result.seeds);
    gateLayerAudit.gate3Consolidated.evidenceWarmup = buildGate3EvidenceWarmupStatus(result.seeds, {
      now: new Date(scanAsOf),
      outcomeTracking: result.summary,
      thresholdEvidenceSampleSize: gateLayerAudit.gate3Consolidated.thresholdEvidence.sampleSize,
      duplicateSuppressed: result.summary.duplicateSuppressed,
    });
    gateLayerAudit.gate3Consolidated.completionScore = buildGate3CompletionScore(gateLayerAudit.gate3Consolidated, {
      sourceSnapshotId,
      gate3SourceSnapshotId: sourceSnapshotId,
      asOf: scanAsOf,
      engineMode: options.macroGateState?.engineMode,
      // ADR-0531 정합: bare macroRegimeEffective 제거(context.macroRegime 은 buildGate3CompletionScore 미사용 — byte-identical).
      macroRegime: options.macroGateState ? resolveScoringEffectiveRegime(options.macroGateState) : undefined,
    });
    gateLayerAudit.gate3Consolidated.liveReadinessScore = buildLiveReadinessScore({
      gate3Completion: gateLayerAudit.gate3Consolidated.completionScore,
      policy: {
        allowsLive: options.macroGateState
          ? options.macroGateState.liveEntryAllowed !== false
            && options.macroGateState.brokerOrderAllowed !== false
            && options.macroGateState.brokerLiveOrderAllowed !== false
          : undefined,
        shadowOnlyMode: options.macroGateState?.engineMode === 'SHADOW_ONLY',
        sellOnlyMode: options.sellOnly === true || options.macroGateState?.sellOnlyMode === true,
        // 폐기된 macroRegimeEffective(legacy R6 transition machine, notUsedForDecision)는 제외한다 —
        // 정본 regime/riskOverride 만으로 R6 방어를 판정해 livePolicy R6_DEFENSE 오라벨을 차단한다.
        r6DefenseMode: options.macroGateState?.riskOverride === 'R6_DEFENSE'
          || options.macroGateState?.regime === 'R6_DEFENSE',
        brokerLiveOrderAllowed: options.macroGateState?.brokerLiveOrderAllowed,
      },
      shadowAllowed: true,
      counterfactualAllowed: gateLayerAudit.gate3Consolidated.shadowRouting.counterfactualAllowedCount === gateLayerAudit.gate3Consolidated.candidateDetails.length,
    });
    rememberGate3FinalizationSummary(gateLayerAudit.gate3Consolidated);
  }
  const summaryDraft: ScanSummary = {
    time: timeLabel,
    candidates: totalCandidates,
    trackB: options.buyListLength,
    swing: options.swingListLength,
    catalyst: options.catalystListLength,
    momentum: options.momentumListLength,
    quoteFails: counters.quoteFails,
    gateMisses: counters.gateMisses,
    rrrMisses: counters.rrrMisses,
    entries: counters.entries,
    ...(options.candidateScanTrigger ? { candidateScanTrigger: options.candidateScanTrigger } : {}),
    waitDistribution: buildWaitDistribution(counters),
    ...(options.macroGateState ? { macroGateState: options.macroGateState } : {}),
    scanEvaluation,
    gatePassDistribution: buildGatePassDistribution(counters),
    ...(options.sectorEnergyQuality !== undefined
      ? {
          sectorEnergyQuality: options.sectorEnergyQuality,
          validSectorCount: options.validSectorCount,
          sectorEnergyReasons: options.sectorEnergyReasons,
        }
      : {}),
    // ADR-0412 — Frozen Quote 진단 + R3 streak skip 영속 (옵셔널, 후방호환).
    ...(options.frozenQuote ? { frozenQuote: options.frozenQuote } : {}),
    ...(options.r3StreakSkipped ? { r3StreakSkipped: options.r3StreakSkipped } : {}),
    // ADR-0423 — SectorEnergy 데이터 진실성 진단 영속 (옵셔널, 후방호환).
    ...(options.sectorEnergyQualityDiagnostic
      ? { sectorEnergyQualityDiagnostic: options.sectorEnergyQualityDiagnostic }
      : {}),
    ...(options.perSymbolSupplyInjection
      ? { perSymbolSupplyInjection: options.perSymbolSupplyInjection }
      : {}),
    // ADR-0436 — Gate Eligibility Split 6 카운터 propagate (counters → ScanSummary).
    // 옵셔널 후방호환 — 0 이어도 명시 영속하여 진단 가시화 보장.
    liveEligibleCount: counters.liveEligibleCount,
    shadowObservableCount: counters.shadowObservableCount,
    dataUnavailableBlockedCount: counters.dataUnavailableBlockedCount,
    providerDegradedObservableCount: counters.providerDegradedObservableCount,
    trueGateFailCount: counters.trueGateFailCount,
    hardRiskBlockedCount: counters.hardRiskBlockedCount,
    // ADR-452c — diagnostic-only score health summary.
    gateScoreHealth: buildGateScoreHealthSummary(counters),
    // ADR-452d — diagnostic-only near-miss bucket summary (executionImpact NONE).
    gateScoreCandidateBuckets: buildGateScoreCandidateBucketSummary(counters),
    gateLayerAudit,
    gateDiagnostics: buildGateDiagnosticCarrySummary(gateLayerAudit),
    dataPromotionStatus: DEFAULT_DATA_PROMOTION_STATUS,
    perStageDropoffSummary: buildPerStageDropoffSummary(counters),
    // ADR-458 — dry-run only approved reclassification impact summary.
    gateReclassificationDryRun: buildGateReclassificationDryRunSummary(counters.gateReclassificationDryRunResults),
    // ADR-0541 — positiveScoreStarvation report build relocated below (option A):
    // it now runs AFTER the entryFilterDecomposition accumulation loop populates
    // counters.positiveScoreStarvationTraces with canonical minSignalComponents,
    // immediately before the ADR-0467 fallback. Initializing it here (pre-loop)
    // would always see empty traces and force the fallback path.
  };

  try {
    const fallbackCandidates = watchlistFallbackCandidates();
    const priorCandidates = (_lastScanSummary?.candidatePool?.candidateSnapshots ?? []) as unknown as CandidatePoolInputCandidate[];
    summaryDraft.candidatePool = options.candidatePool ?? buildCandidatePool({
      sourceSnapshotId,
      asOf: kstNow.toISOString(),
      ttlSec: options.macroGateState?.regimeSnapshotTtlSec ?? 300,
      totalUniverseCount: Math.max(
        totalCandidates,
        scanCandidateSnapshots.length,
        fallbackCandidates.length,
      ),
      existingWatchlist: options.candidatePoolSourceCandidates ?? (scanCandidateSnapshots as unknown as CandidatePoolInputCandidate[]),
      previousDayTopRankedCandidates: priorCandidates,
      openShadowWatchlist: priorCandidates,
      fallbackBroadUniverse: fallbackCandidates,
      liveOrderAllowed: options.macroGateState?.liveEntryAllowed === true && options.macroGateState?.brokerOrderAllowed !== false,
      runtimeLabels: {
        sellOnly: options.sellOnly === true || options.macroGateState?.sellOnlyMode === true,
        // 정본 regime 만 사용 — 폐기 macroRegimeEffective(notUsedForDecision) 제외.
        r6Defense:
          options.macroGateState?.regime === 'R6_DEFENSE',
        kellyZero: (options.macroGateState?.finalKellyMultiplier ?? 1) <= 0,
        providerIssue: scanCandidateSnapshots.some((item) => item.supplyProviderHealth?.providerIssue === true),
        staleData:
          options.marketDataFreshness === 'STALE' ||
          options.marketDataFreshness === 'EXPIRED' ||
          scanCandidateSnapshots.some((item) => item.priceDataFresh === false),
        shadowOnly: options.macroGateState?.engineMode === 'SHADOW_ONLY',
      },
      zeroSurvivorSignals: {
        gateEntryCandidates: totalCandidates,
        watchlistImported: totalCandidates,
        rsScoreUsable: countFiniteCandidateMetric(scanCandidateSnapshots, ['relativeStrengthScore', 'rsRankPct']),
        breakoutScoreUsable: countFiniteCandidateMetric(scanCandidateSnapshots, ['breakoutScore']),
      },
    });
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.buildCandidatePool', error: e });
  }

  // ADR-0420 — Fresh Scan Blocker Attribution build + persist (옵셔널, 후방호환).
  // candidates>0 시점에만 build (의미 있는 분해). 빈 buckets 도 NO_CANDIDATES/UNKNOWN
  // diagnosis 자동 분류 — 정상 운영 메시지에 잡음 추가 안 함.
  recordScanCase(scanEvaluation);
  emitScanEvaluationWarnings(scanEvaluation);

  if (counters.freshConditionBuckets.size > 0) {
    const candidates = options.buyListLength + options.intradayBuyListLength;
    const scanIdLabel = `${kstNow.toISOString().slice(0, 10)}:${timeLabel}`;
    summaryDraft.freshConditionAttribution = buildFreshScanBlockerAttribution({
      buckets: Array.from(counters.freshConditionBuckets.values()),
      candidates,
      entries: counters.entries,
      gate1Pass: counters.gate1Pass,
      gate2Pass: counters.gate2Pass,
      gate3Pass: counters.gate3Pass,
      lastTriggerPass: counters.lastTriggerPass,
      scanId: scanIdLabel,
      scannedAtKst: timeLabel,
    });
  }

  // ADR-0422 — Gate2 / NO_LEADERSHIP fresh attribution build + persist.
  // gate1Pass>0 시점에만 build — Gate1 생존자가 있는 스캔만 Gate2 진단 의미. NO_LEADERSHIP
  // 분류 (gate1Pass>0 && gate2Pass=0) 시 /scan_blockers 에 자동 노출.
  // sectorEnergy STALE 진단은 macroGateState 또는 ScanSummary 의 sectorEnergyQuality 에서 발췌.
  if (counters.gate1Pass > 0) {
    const candidates = options.buyListLength + options.intradayBuyListLength;
    const scanIdLabel = `${kstNow.toISOString().slice(0, 10)}:${timeLabel}`;
    const sectorEnergyDiag = options.sectorEnergyQualityDiagnostic
      ? buildSectorEnergyDiagnostic({
          dataQuality: options.sectorEnergyQualityDiagnostic.dataQuality,
          validSectorCount: options.sectorEnergyQualityDiagnostic.validSectorCount,
          expectedSectorCount: options.sectorEnergyQualityDiagnostic.expectedSectorCount,
          reasons: options.sectorEnergyQualityDiagnostic.reasons,
          indexCodeCoverage: options.sectorEnergyQualityDiagnostic.indexCodeCoverage,
          officialIndexCoverage: options.sectorEnergyQualityDiagnostic.officialIndexCoverage,
          internalGroupedSnapshotCoverage: options.sectorEnergyQualityDiagnostic.internalGroupedSnapshotCoverage,
          internalGroupedValidSectorCount: options.sectorEnergyQualityDiagnostic.internalGroupedValidSectorCount,
          internalGroupedExpectedSectorCount: options.sectorEnergyQualityDiagnostic.internalGroupedExpectedSectorCount,
          internalProxyCoverage: options.sectorEnergyQualityDiagnostic.internalProxyCoverage,
          stockBasketCoverage: options.sectorEnergyQualityDiagnostic.stockBasketCoverage,
          selectedSectorEnergySourceTier: options.sectorEnergyQualityDiagnostic.selectedSectorEnergySourceTier,
          leadershipConfidence: options.sectorEnergyQualityDiagnostic.leadershipConfidence,
          promotionAllowed: options.sectorEnergyQualityDiagnostic.promotionAllowed,
          sectorBoostAllowed: options.sectorEnergyQualityDiagnostic.promotionAllowed === true,
          strongBuyAllowed: options.sectorEnergyQualityDiagnostic.promotionAllowed === true,
          shadowLeadershipAllowed: options.sectorEnergyQualityDiagnostic.shadowLeadershipAllowed,
          counterfactualAllowed: options.sectorEnergyQualityDiagnostic.counterfactualAllowed,
          reasonCodes: options.sectorEnergyQualityDiagnostic.reasonCodes,
        })
      : options.sectorEnergyQuality !== undefined
        ? buildSectorEnergyDiagnostic({
            dataQuality: options.sectorEnergyQuality,
            validSectorCount: options.validSectorCount,
            expectedSectorCount: 12,
            reasons: options.sectorEnergyReasons,
          })
        : undefined;
    const blockReasons = options.macroGateState
      ? {
          gateRecheckMiss: counters.waitGateFail,
          preBreakoutWait: counters.waitPreBreakout,
          sizingBlocked: counters.waitSizingBlocked,
          driftRemove: counters.waitDriftRemove + counters.waitDriftCorpAction,
        }
      : {
          gateRecheckMiss: counters.waitGateFail,
          preBreakoutWait: counters.waitPreBreakout,
          sizingBlocked: counters.waitSizingBlocked,
          driftRemove: counters.waitDriftRemove + counters.waitDriftCorpAction,
        };
    summaryDraft.freshGate2Attribution = buildGate2FreshAttribution({
      buckets: Array.from(counters.gate2ConditionBuckets.values()),
      candidates,
      gate1Pass: counters.gate1Pass,
      gate2Pass: counters.gate2Pass,
      gate3Pass: counters.gate3Pass,
      entries: counters.entries,
      lastTriggerPass: counters.lastTriggerPass,
      blockReasons,
      ...(sectorEnergyDiag ? { sectorEnergy: sectorEnergyDiag } : {}),
      scanId: scanIdLabel,
      scannedAtKst: timeLabel,
    });
  }

  const emptyReason = classifyEmptyScanReason(summaryDraft);
  if (emptyReason) summaryDraft.emptyScanReason = emptyReason;

  // ADR-0425 — Gate Decision Router 자동 합성 (옵셔널, 후방호환).
  // 위 attribution / sectorEnergy / blockReasons 모두 영속된 *후* 합성 — input 정합 보장.
  // riskFlags 는 macroGateState 에서 발췌 (emergencyStop / sellOnly / r6Defense / VIX / FOMC).
  const macroGate = options.macroGateState;
  const liveEntryBlockedReason = `${macroGate?.liveEntryBlockedReason ?? ''}`.toUpperCase();
  const r4LiveEntryBlocked =
    macroGate?.diagnosticLiveEntryBlocked === true &&
    liveEntryBlockedReason.includes('R4_NEUTRAL');
  const r5LiveEntryBlocked =
    macroGate?.diagnosticLiveEntryBlocked === true &&
    liveEntryBlockedReason.includes('R5_CAUTION');
  const routerInput = {
    regime: macroGate?.regime,
    gate1Pass: counters.gate1Pass,
    gate2Pass: counters.gate2Pass,
    gate3Pass: counters.gate3Pass,
    lastTriggerPass: counters.lastTriggerPass,
    entries: counters.entries,
    ...(summaryDraft.freshConditionAttribution
      ? { freshAttribution: summaryDraft.freshConditionAttribution }
      : {}),
    ...(summaryDraft.freshGate2Attribution
      ? { gate2Attribution: summaryDraft.freshGate2Attribution }
      : {}),
    ...(options.sectorEnergyQualityDiagnostic
      ? { sectorEnergyDiagnostic: options.sectorEnergyQualityDiagnostic }
      : {}),
    blockReasons: {
      gateRecheckMiss: counters.waitGateFail,
      preBreakoutWait: counters.waitPreBreakout,
      sizingBlocked: counters.waitSizingBlocked,
      driftRemove: counters.waitDriftRemove + counters.waitDriftCorpAction,
    },
    riskFlags: macroGate
      ? {
          emergencyStop: macroGate.emergencyStop,
          sellOnly: false,
          r4Neutral: r4LiveEntryBlocked,
          r5Caution: r5LiveEntryBlocked,
          r6Defense: false,
          vixBlock: macroGate.vixGatingActive,
          fomcBlock: macroGate.fomcPhase === 'DAY',
        }
      : { sellOnly: false },
  };
  try {
    summaryDraft.gateDecisionRouter = deriveGateDecisionRouterResult(routerInput);
  } catch (e) {
    // Router 실패가 ScanSummary 영속을 차단해서는 안 됨 — try/catch 격리.
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.deriveGateDecisionRouterResult', error: e });
  }

  // ADR-0427 — Provisional Shadow Lane 카운터 → ScanSummary 합성 (옵셔널, 후방호환).
  // buyListLoop 가 후보별 영속 결과를 ScanCounters 에 누적 → 본 시점에서 합산.
  // 카운터 0 이어도 noEligibleReason 으로 운영자에게 *왜 0 인가* 표시 가능.
  try {
    const candidates = counters.provisionalShadowCandidates ?? [];
    const eligible = counters.provisionalShadowEligible ?? 0;
    const created = counters.provisionalShadowCreated ?? 0;
    const skipped = counters.provisionalShadowSkipped ?? 0;
    if (eligible > 0 || created > 0 || skipped > 0) {
      const summary = summarizeProvisionalShadowCandidates(candidates);
      summaryDraft.provisionalShadowLane = {
        ...summary,
        eligible,
        created,
      };
      // skipped 정보는 별도 필드 노출 — formatter 가 표시.
      (summaryDraft.provisionalShadowLane as ProvisionalShadowSectionInput & {
        skipped?: number;
        skipReasons?: Record<string, number>;
      }).skipped = skipped;
      (summaryDraft.provisionalShadowLane as ProvisionalShadowSectionInput & {
        skipped?: number;
        skipReasons?: Record<string, number>;
      }).skipReasons = counters.provisionalShadowSkipReasons;
    } else {
      // eligible=0 시 noEligibleReason 합성 (HARD_BLOCK / no Gate1 survivor / true weakness)
      const router = summaryDraft.gateDecisionRouter;
      let reason: string | undefined;
      if (router?.severity === 'HARD_BLOCK') {
        const top = router.reasons?.[0];
        reason = top ? `HARD_BLOCK / ${top}` : 'HARD_BLOCK';
      } else if (router?.severity === 'TRUE_WEAKNESS') {
        reason = 'TRUE_WEAKNESS — Shadow 학습도 차단';
      } else if ((counters.gate1Pass ?? 0) === 0) {
        reason = 'no Gate1 survivor';
      } else if (routerInput.regime !== 'R3_EARLY') {
        reason = `regime=${routerInput.regime ?? 'UNKNOWN'} — R3_EARLY 외 차단`;
      }
      if (reason !== undefined) {
        summaryDraft.provisionalShadowLane = {
          eligible: 0,
          created: 0,
          noEligibleReason: reason,
        };
      }
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.summarizeProvisionalShadowCandidates', error: e });
  }

  // ADR-0430 — Counterfactual Shadow Learning Lane 카운터 → ScanSummary 합성.
  // SELL_ONLY/HARD_BLOCK 시점 학습 표본. ADR-0427 provisional 와 분리.
  // virtual account 무영향, KIS 주문 함수 import 0건.
  try {
    const cfCandidates = counters.counterfactualShadowCandidates ?? [];
    const cfEligible = counters.counterfactualShadowEligible ?? 0;
    const cfCreated = counters.counterfactualShadowCreated ?? 0;
    const cfSkipped = counters.counterfactualShadowSkipped ?? 0;
    if (cfEligible > 0 || cfCreated > 0 || cfSkipped > 0) {
      const cfSummary = summarizeCounterfactualShadowLearningCandidates(cfCandidates);
      summaryDraft.counterfactualShadowLearning = {
        ...cfSummary,
        eligible: cfEligible,
        created: cfCreated,
      };
      (summaryDraft.counterfactualShadowLearning as CounterfactualShadowSectionInput & {
        skipped?: number;
        skipReasons?: Record<string, number>;
      }).skipped = cfSkipped;
      (summaryDraft.counterfactualShadowLearning as CounterfactualShadowSectionInput & {
        skipped?: number;
        skipReasons?: Record<string, number>;
      }).skipReasons = counters.counterfactualShadowSkipReasons;
    } else {
      // eligible=0 — 학습 lane 도 비어있는 사유 합성.
      const router = summaryDraft.gateDecisionRouter;
      let cfReason: string | undefined;
      if (process.env.COUNTERFACTUAL_SHADOW_LEARNING_DISABLED === 'true') {
        cfReason = 'disabled (ENV COUNTERFACTUAL_SHADOW_LEARNING_DISABLED=true)';
      } else if ((counters.gate1Pass ?? 0) === 0) {
        cfReason = 'no Gate1 survivor';
      } else if (routerInput.regime !== 'R3_EARLY') {
        cfReason = `regime=${routerInput.regime ?? 'UNKNOWN'} — R3_EARLY 외 비활성`;
      } else if (router?.severity === 'TRUE_WEAKNESS') {
        cfReason = 'TRUE_WEAKNESS — 학습 표본 오염 차단';
      } else if (
        router?.severity === 'SOFT_DEGRADE' ||
        router?.severity === 'WATCH_ONLY' ||
        router?.severity === 'REDUCED_ENTRY_CANDIDATE' ||
        router?.severity === 'FULL_ENTRY_CANDIDATE'
      ) {
        cfReason = `${router.severity} — Provisional/Normal path 우선 (counterfactual 불필요)`;
      } else {
        cfReason = 'no candidate';
      }
      if (cfReason !== undefined) {
        summaryDraft.counterfactualShadowLearning = {
          eligible: 0,
          created: 0,
          noEligibleReason: cfReason,
        };
      }
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.summarizeCounterfactualShadowLearningCandidates', error: e });
  }

  // ADR-0449 — Pre-Breakout WAIT 7-state summary 합성 (옵셔널 후방호환).
  //   buyListLoop 가 후보별 evaluatePreBreakoutWait 결과를 counters.preBreakoutWaitDecisions
  //   에 push → 본 시점에서 합산. decisions 빈 배열 시 summary 미영속 (운영자 noise 차단).
  //   try/catch 격리 — 합성 실패가 ScanSummary 영속을 차단하지 않음.
  if (counters.r6ShadowEntryPolicy) {
    summaryDraft.r6ShadowEntryPolicy = counters.r6ShadowEntryPolicy;
  }

  try {
    if (counters.preBreakoutWaitDecisions.length > 0) {
      summaryDraft.preBreakoutWaitSummary = summarizePreBreakoutWaitDecisions({
        decisions: counters.preBreakoutWaitDecisions,
      });
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.summarizePreBreakoutWaitDecisions', error: e });
  }

  // ADR-0452 — Shadow Near-Breakout Entry counters propagate (옵셔널 후방호환).
  //   buyListLoop 두 WAIT site 가 evaluateShadowNearBreakoutEntry 결과를 carry-over.
  //   created+blocked=0 시 미영속 (운영자 noise 차단). HTML 안전 — counter 만 영속.
  if ((counters.shadowNearBreakoutCreated ?? 0) > 0 || (counters.shadowNearBreakoutBlocked ?? 0) > 0) {
    summaryDraft.shadowNearBreakoutCreated = counters.shadowNearBreakoutCreated ?? 0;
    summaryDraft.shadowNearBreakoutBlocked = counters.shadowNearBreakoutBlocked ?? 0;
    summaryDraft.shadowNearBreakoutBlockReasons = counters.shadowNearBreakoutBlockReasons ?? {};
  }

  // ADR-0601 — Gate2 Supply 축 KIS 네이티브 hydration. decomposition 이전에 후보 스냅샷의
  // kisInvestorFlow 결손을 단일통로 evidence 로 보충한다 (일중 캐시·상한·실패 격리, 진단 차선).
  try {
    summaryDraft.gate2InvestorFlowHydrationAdr0601 = await hydrateGate2InvestorFlowAdr0601({
      candidateSnapshots: options.candidateSnapshots ?? counters.entryCandidateSnapshots,
      now: kstNow,
    });
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.hydrateGate2InvestorFlowAdr0601', error: e });
  }

  // ADR-0601 D4 — Gate2 Sector 축 KIS 네이티브 hydration. 종목 마스터 업종코드→업종지수 일봉(r20)으로
  // sectorCycle 결손을 보충한다 (업종코드 단위 일캐시·상한·실패 격리, 진단 차선).
  try {
    summaryDraft.gate2SectorCycleHydrationAdr0601 = await hydrateGate2SectorCycleAdr0601({
      candidateSnapshots: options.candidateSnapshots ?? counters.entryCandidateSnapshots,
      benchmarkReturn20d: options.macroGateState?.kospi20dReturn ?? null,
      now: kstNow,
    });
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.hydrateGate2SectorCycleAdr0601', error: e });
  }

  // ADR-0605 — 반도체 후보의 잔존 sectorCycle 결손을 SOX 글로벌 proxy 로 보충 (default OFF,
  // 본 모듈 KIS fetch 0 — macroState 일배치 수집 재사용, buildSectorAxis 최대 62 자연 캡).
  try {
    summaryDraft.gate2SoxSemiAxisAdr0605 = hydrateGate2SoxSemiAxisAdr0605({
      candidateSnapshots: options.candidateSnapshots ?? counters.entryCandidateSnapshots,
    });
    const soxObservation = summaryDraft.gate2SoxSemiAxisAdr0605.observation;
    // ADR-0605 — 관측 추세 누적(flag 무관 매 스캔 1행). ledger 쓰기 격리(불변식 #1, /* SDS-ignore */ try/catch).
    if (soxObservation) appendGate2SoxObservation({ observation: soxObservation, scanId: sourceSnapshotId, now: kstNow });
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.hydrateGate2SoxSemiAxisAdr0605', error: e });
  }

  // ADR-0464 — Entry Filter Conservatism Decomposition.
  // Diagnostic-only: execution gates/thresholds are not modified. Build failures are
  // isolated so ledger/reporting problems cannot shut down the trading engine.
  try {
    const candidateSnapshots = options.candidateSnapshots ?? counters.entryCandidateSnapshots;
    summaryDraft.entryFilterDecomposition = buildEntryFilterDecomposition({
      now: kstNow,
      universeCandidates: Math.max(
        options.buyListLength + options.intradayBuyListLength,
        candidateSnapshots.length,
      ),
      watchlistCandidates: options.buyListLength + options.intradayBuyListLength,
      entries: counters.entries,
      waitDistribution: summaryDraft.waitDistribution,
      gatePassDistribution: summaryDraft.gatePassDistribution,
      macroGateState: summaryDraft.macroGateState,
      candidateSnapshots,
      counterfactualRecordedToday: counters.counterfactualRecordedToday,
      sectorEnergyQuality: options.sectorEnergyQuality,
      watchlistRefreshedAt: options.watchlistRefreshedAt,
      watchlistSource: options.watchlistSource,
    });
    const entryFilter = summaryDraft.entryFilterDecomposition;
    if (entryFilter) {
      const gate1HardSurvivorSymbols = new Set(
        entryFilter.gate1CandidateTraces
          .filter((trace) => trace.gate1Passed && trace.hardFailCount === 0 && trace.softFailCount === 0)
          .map((trace) => trace.symbol),
      );
      const gate2PendingPreserved = entryFilter.candidateTraces.filter((trace) =>
        gate1HardSurvivorSymbols.has(trace.symbol) &&
        trace.gate2Passed !== true,
      ).length;
      const minSignal = entryFilter.minSignalScoreDecompositionReport;
      const minSignalLivePass = Math.max(0, minSignal.totalCandidates - minSignal.minSignalFailed);
      if (gate1HardSurvivorSymbols.size > 0 || minSignalLivePass > 0) {
        summaryDraft.gate2SoftLeadershipLane = {
          gate1HardSurvivors: gate1HardSurvivorSymbols.size,
          minSignalLivePass,
          gate2PendingPreserved,
          labels: [
            'GATE1_HARD_SURVIVOR_GATE2_PENDING',
            'GATE1_PASS_PRE_BREAKOUT_WAIT',
            'R3_PROVISIONAL_LEADER_GATE2_NOT_CONFIRMED',
          ],
          shadowObservablePreserved: gate2PendingPreserved > 0,
          watchPreserved: gate2PendingPreserved > 0,
          counterfactualRecorded: gate2PendingPreserved > 0,
          executionImpact: 'NONE',
        };
        if (gate2PendingPreserved > 0) {
          summaryDraft.shadowObservableCount = Math.max(summaryDraft.shadowObservableCount ?? 0, gate2PendingPreserved);
        }
      }
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.buildEntryFilterDecomposition', error: e });
  }

  // ADR-0541 — positive score starvation audit supply wiring (relocated from the
  // per-symbol intraday re-check). entryFilterDecomposition has now built each
  // candidate's canonical minSignalScoreTrace, whose `components` carry the
  // authoritative CORE_SIGNAL weightedScores (PRICE_MOMENTUM etc.). Supplying them
  // as minSignalComponents lets buildGate1ScoreStarvationTraceFromGateResult attribute
  // those contributions from the canonical source instead of estimating them from
  // Gate2-level outputs (which leaked into OTHER_POSITIVE).
  //
  // Scale (§6.4): minSignalScoreTrace.requiredScore / actualScore / components are all
  // ABSOLUTE 0~100-scale values (component maxScores sum to ~84+). gateRawScore is a
  // separate ~0~15 raw-gate scale. The consumer multiplies requiredScore and rawScore
  // by scoreScale but uses component weightedScores raw. To keep every figure coherent
  // on the 0~100 scale (and avoid double scaling), we pass scoreScale:1 and source both
  // requiredScore and rawScore from minSignalScoreTrace (NOT gateRawScore).
  //
  // Build failures are isolated here so a diagnostic problem can never stop the trading
  // engine (invariants #1/#2). Silent catch is forbidden — failures emit a warning.
  // ADR-0609 — 상수 블록 컴포넌트(WATCHLIST_PRIORITY/MARKET_REGIME/INVESTOR_FLOW)는 ADR-0597
  // InputRow.positiveComponents(AUDITED_POSITIVE_FEATURES 한정)에 포함되지 않으므로, 여기
  // canonical minSignal.components 에서 직접 보충해 eligibility shadow 판정에 공급한다 (fetch 0).
  const eligibilityComponentsBySymbol = new Map<
    string,
    Array<{ code: string; weightedScore: number; providerIssue?: boolean }>
  >();
  const eligibilityComponentCodeSet = new Set<string>(Object.values(GATE1_ELIGIBILITY_COMPONENT_CODES));
  try {
    const entryFilter = summaryDraft.entryFilterDecomposition;
    if (entryFilter && entryFilter.gate1CandidateTraces.length > 0) {
      for (const g1 of entryFilter.gate1CandidateTraces) {
        const minSignal = g1.minSignalScoreTrace;
        if (!minSignal) continue;
        if (g1.symbol) {
          eligibilityComponentsBySymbol.set(
            g1.symbol,
            minSignal.components
              .filter((c) => eligibilityComponentCodeSet.has(c.code) && Number.isFinite(c.weightedScore))
              .map((c) => ({ code: c.code, weightedScore: c.weightedScore, providerIssue: c.providerIssue })),
          );
        }
        const trace = buildGate1ScoreStarvationTraceFromGateResult({
          symbol: g1.symbol,
          name: g1.name,
          // ABSOLUTE 0~100 scale; scoreScale:1 leaves it unscaled (no double scaling).
          requiredScore: minSignal.requiredScore,
          gateResult: {
            // Canonical actualScore from the min-signal trace (0~100), coherent with
            // the component weightedScores below — NOT the 0~15 gateRawScore.
            rawScore: minSignal.actualScore,
            availableMaxScore: g1.availableMaxScore,
            normalizedGateScore: g1.normalizedGateScore,
          },
          // ADR-0541 supply: canonical CORE_SIGNAL contributions. Used raw by the
          // consumer (no scaling), so they stay on the 0~100 scale.
          minSignalComponents: minSignal.components.map((c) => ({
            code: c.code,
            weightedScore: c.weightedScore,
            maxScore: c.maxScore,
            confidence: c.confidence,
            message: c.message,
          })),
          watchlistScore: minSignal.components.find((c) => c.code === 'WATCHLIST_UPSTREAM_SCORE')?.weightedScore,
          upstreamScore: minSignal.components.find((c) => c.code === 'WATCHLIST_UPSTREAM_SCORE')?.weightedScore,
          scoreScale: 1,
        });
        accumulatePositiveScoreStarvation(counters, trace);
      }
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.accumulatePositiveScoreStarvationAdr0541', error: e });
  }

  // ADR-0597 — Gate1 횡단면 percentile shadow 보조점수 (관측 전용, Gate 판정 미소비).
  // canonical 점수(위 ADR-0541 traces)에서 스캔 내 상대 순위를 산출해 ScanSummary 와
  // 관측 ledger(midBlocks 의 minSignalScoreBySymbol 경유)에 기록만 한다. 실패는 격리(불변식 #1/#2).
  try {
    const crossSectional = buildGate1CrossSectionalShadowReportAdr0597(
      counters.positiveScoreStarvationTraces.map((trace) => ({
        symbol: trace.symbol,
        name: trace.name,
        actualScore: trace.actualScore,
        positiveComponents: trace.positiveComponents,
      })),
    );
    summaryDraft.gate1CrossSectionalShadowAdr0597 = crossSectional;
    if (crossSectional.candidates > 0) {
      console.info(
        `[ADR-0597] Gate1 cross-sectional shadow — candidates=${crossSectional.candidates} ` +
          `totalMedian=${crossSectional.totalScoreMedian} marketBlockMedian=${crossSectional.marketBlockMedian} ` +
          `top=${crossSectional.topSymbols.join(',')} executionImpact=NONE`,
      );
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.buildGate1CrossSectionalShadowAdr0597', error: e });
  }

  // ADR-0609 — Gate1 상수블록 eligibility shadow 판정 (Phase 0, 관측 전용·LIVE 점수 미소비).
  // ADR-0597 산출물(marketBlockScore/totalPercentile) + 상수 블록 컴포넌트(위 map)로 적격성/
  // market-only/percentile 판정만 산출해 ScanSummary 와 관측 ledger 에 기록한다. 통과 판정·
  // 정렬·requiredScore 0 접촉 (소비처 0). 실패는 격리(불변식 #1 — 스캔 본체 중단 금지).
  try {
    const crossSectionalScores = summaryDraft.gate1CrossSectionalShadowAdr0597?.scores ?? [];
    if (crossSectionalScores.length > 0) {
      const eligibilityShadow = buildGate1EligibilityShadowReportAdr0609(
        crossSectionalScores.map((score) => ({
          symbol: score.symbol,
          name: score.name,
          marketBlockScore: score.marketBlockScore,
          totalPercentile: score.totalPercentile,
          eligibilityComponents: eligibilityComponentsBySymbol.get(score.symbol),
        })),
      );
      summaryDraft.gate1EligibilityShadowAdr0609 = eligibilityShadow;
      if (eligibilityShadow.candidates > 0) {
        console.info(
          `[ADR-0609] Gate1 eligibility shadow — candidates=${eligibilityShadow.candidates} ` +
            `eligible=${eligibilityShadow.eligibleCount} degraded=${eligibilityShadow.eligibilityDegradedCount} ` +
            `marketOnlyPass=${eligibilityShadow.marketOnlyPassCount} percentilePass=${eligibilityShadow.percentilePassCount} ` +
            `executionImpact=NONE`,
        );
      }
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.buildGate1EligibilityShadowAdr0609', error: e });
  }

  // ADR-0541 (option A) — build the canonical PositiveScoreStarvationReport from the
  // freshly-accumulated traces, immediately before the ADR-0467 fallback. If the
  // accumulation loop produced no traces (entryFilter absent / build failed), the
  // report's totalCandidates is 0 and the fallback below takes over (guard preserved).
  try {
    summaryDraft.positiveScoreStarvation = buildPositiveScoreStarvationReport({
      traces: counters.positiveScoreStarvationTraces,
      timestamp: kstNow.toISOString(),
      forDate: kstNow.toISOString().slice(0, 10),
      regime: options.macroGateState?.regime ?? 'UNKNOWN',
      marketSession: 'BUY_ALLOWED',
    });
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.buildPositiveScoreStarvationReportAdr0541', error: e });
  }

  // ADR-0467 fallback: when the scan stopped before buyListLoop, Gate1 score
  // samples are absent, but ADR-0466 still exposes enough min-score telemetry to
  // show the positive-score starvation section in /scan_blockers.
  try {
    if ((summaryDraft.positiveScoreStarvation?.totalCandidates ?? 0) <= 0) {
      const fallback = buildPositiveScoreStarvationFallbackReport({
        minSignalScoreReport: summaryDraft.entryFilterDecomposition?.minSignalScoreDecompositionReport,
        timestamp: kstNow.toISOString(),
        forDate: kstNow.toISOString().slice(0, 10),
        regime: options.macroGateState?.regime ?? 'UNKNOWN',
        marketSession: 'BUY_ALLOWED',
      });
      if (fallback) {
        summaryDraft.positiveScoreStarvation = fallback;
        logAdrDiagnostic(
          `[ADR-0467] fallback PositiveScoreStarvationReport emitted from ADR-0466 min-signal telemetry`,
          {
            adrCode: 'ADR-0467',
            dryRun: true,
            executionImpact: 'NONE',
            candidates: fallback.totalCandidates,
            gateScoreHealthSamples: counters.gateScoreHealthSamples,
            reason: counters.gateScoreHealthSamples === 0 ? 'GATE_SCORE_HEALTH_SAMPLES_EMPTY' : 'POSITIVE_SCORE_STARVATION_FALLBACK',
          },
        );
      }
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.buildPositiveScoreStarvationFallbackReport', error: e });
  }

  // ADR-0468: score ceiling repair remains dry-run/advisory only. It consumes the
  // ADR-0467 starvation report, including the ADR-0466 fallback path, so
  // BEFORE_BUYLIST_LOOP scans still surface the broken score ceiling.
  try {
    const repair = buildGate1ScoreCeilingRepairReport({
      positiveStarvationReport: summaryDraft.positiveScoreStarvation,
      traces: counters.positiveScoreStarvationTraces,
      timestamp: kstNow.toISOString(),
      forDate: kstNow.toISOString().slice(0, 10),
      regime: options.macroGateState?.regime ?? 'UNKNOWN',
      marketSession: 'BUY_ALLOWED',
    });
    if (repair) {
      summaryDraft.scoreCeilingRepair = repair;
      logAdrDiagnostic(
        `[ADR-0468] Gate1ScoreCeilingRepair dry-run emitted`,
        {
          adrCode: 'ADR-0468',
          dryRun: true,
          executionImpact: repair.executionImpact,
          candidates: repair.totalCandidates,
          requiredReachableBefore: repair.scoreCeilingRepairAudit.requiredReachableBefore,
          reason: 'GATE1_SCORE_CEILING_REPAIR_DRY_RUN',
        },
      );
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.buildGate1ScoreCeilingRepairReport', error: e });
  }

  // ADR-0469: root-cause penalty deduplication is advisory only. It checks
  // whether supply provider UNKNOWN is charged through multiple penalty lanes.
  try {
    const dedup = buildPenaltyDeduplicationReport({
      positiveStarvationReport: summaryDraft.positiveScoreStarvation,
      scoreCeilingRepairReport: summaryDraft.scoreCeilingRepair,
      traces: counters.positiveScoreStarvationTraces,
      timestamp: kstNow.toISOString(),
      forDate: kstNow.toISOString().slice(0, 10),
      regime: options.macroGateState?.regime ?? 'UNKNOWN',
      marketSession: 'BUY_ALLOWED',
      riskMultiplier: options.macroGateState?.finalKellyMultiplier ?? 0.38,
    });
    if (dedup) {
      summaryDraft.penaltyDeduplication = dedup;
      logAdrDiagnostic(
        `[ADR-0469] PenaltyDeduplication dry-run emitted`,
        {
          adrCode: 'ADR-0469',
          dryRun: true,
          executionImpact: dedup.executionImpact,
          candidates: dedup.totalCandidates,
          duplicateGroups: dedup.duplicateGroups.length,
          reason: 'PENALTY_DEDUPLICATION_DRY_RUN',
        },
      );
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.buildPenaltyDeduplicationReport', error: e });
  }

  // ADR-0470: risk placement split is dry-run only. It compares Gate1 signal
  // risk against Kelly sizing risk without changing live policy.
  try {
    const macro = options.macroGateState;
    const riskDoubleCount = buildRiskDoubleCountAuditReport({
      positiveStarvationReport: summaryDraft.positiveScoreStarvation,
      scoreCeilingRepairReport: summaryDraft.scoreCeilingRepair,
      penaltyDeduplicationReport: summaryDraft.penaltyDeduplication,
      traces: counters.positiveScoreStarvationTraces,
      timestamp: kstNow.toISOString(),
      forDate: kstNow.toISOString().slice(0, 10),
      regime: macro?.regime ?? 'UNKNOWN',
      marketSession: 'BUY_ALLOWED',
      regimeMultiplier: macro?.kellyMultiplierFromRegime ?? 0.7,
      fomcMultiplier: macro?.fomcKellyMultiplier ?? 1,
      sectorMultiplier: 1,
      combinedKellyMultiplier: macro?.finalKellyMultiplier ?? 0.26,
    });
    if (riskDoubleCount) {
      summaryDraft.riskDoubleCount = riskDoubleCount;
      logAdrDiagnostic(
        `[ADR-0470] RiskDoubleCount dry-run emitted`,
        {
          adrCode: 'ADR-0470',
          dryRun: true,
          executionImpact: riskDoubleCount.executionImpact,
          candidates: riskDoubleCount.totalCandidates,
          doubleCountCandidates: riskDoubleCount.doubleCountCandidates,
          reason: 'RISK_DOUBLE_COUNT_DRY_RUN',
        },
      );
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.buildRiskDoubleCountAuditReport', error: e });
  }

  // ADR-0471: final diagnostic calibration layer. No threshold or live policy is
  // changed here; it only emits unknown-policy and shadow-observation guidance.
  try {
    const macro = options.macroGateState;
    const finalGate1Calibration = buildFinalGate1CalibrationAuditReport({
      positiveStarvationReport: summaryDraft.positiveScoreStarvation,
      scoreCeilingRepairReport: summaryDraft.scoreCeilingRepair,
      penaltyDeduplicationReport: summaryDraft.penaltyDeduplication,
      riskDoubleCountReport: summaryDraft.riskDoubleCount,
      timestamp: kstNow.toISOString(),
      forDate: kstNow.toISOString().slice(0, 10),
      regime: macro?.regime ?? 'UNKNOWN',
      marketSession: 'BUY_ALLOWED',
      providerHealth: 'UNKNOWN',
    });
    if (finalGate1Calibration) {
      summaryDraft.finalGate1Calibration = finalGate1Calibration;
      logAdrDiagnostic(
        `[ADR-0471] FinalGate1Calibration dry-run emitted`,
        {
          adrCode: 'ADR-0471',
          dryRun: true,
          executionImpact: finalGate1Calibration.executionImpact,
          liveExecutionAllowed: finalGate1Calibration.liveExecutionAllowed,
          candidates: finalGate1Calibration.candidates,
          recommendedPolicy: finalGate1Calibration.thresholdSweep.recommendedUnknownPolicy,
          reason: 'FINAL_GATE1_CALIBRATION_DRY_RUN',
        },
      );
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.buildFinalGate1CalibrationAuditReport', error: e });
  }

  // ADR-0472: component-set alignment and policy promotion candidate. This is
  // SHADOW_ONLY and never mutates live Gate1 scoring or order routing.
  try {
    const macro = options.macroGateState;
    const gate1ScoringAlignment = buildGate1ScoringAlignmentReport({
      positiveStarvationReport: summaryDraft.positiveScoreStarvation,
      scoreCeilingRepairReport: summaryDraft.scoreCeilingRepair,
      penaltyDeduplicationReport: summaryDraft.penaltyDeduplication,
      riskDoubleCountReport: summaryDraft.riskDoubleCount,
      finalGate1CalibrationReport: summaryDraft.finalGate1Calibration,
      timestamp: kstNow.toISOString(),
      forDate: kstNow.toISOString().slice(0, 10),
      regime: macro?.regime ?? 'UNKNOWN',
      marketSession: 'BUY_ALLOWED',
      providerHealthStatus: 'UNKNOWN',
      unknownPolicyActive: true,
    });
    if (gate1ScoringAlignment) {
      summaryDraft.gate1ScoringAlignment = gate1ScoringAlignment;
      logAdrDiagnostic(
        `[ADR-0472] Gate1ScoringAlignment SHADOW_ONLY dry-run emitted`,
        {
          adrCode: 'ADR-0472',
          dryRun: true,
          engineMode: 'SHADOW_ONLY',
          executionImpact: gate1ScoringAlignment.executionImpact,
          componentSetAligned: gate1ScoringAlignment.componentSetAligned,
          missingComponents: gate1ScoringAlignment.missingComponents,
          reason: gate1ScoringAlignment.missingComponents.join('|') || 'COMPONENT_SET_ALIGNED',
        },
      );
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.buildGate1ScoringAlignmentReport', error: e });
  }

  // ADR-0475: positive source resolver dry-run for watchlist upstream score,
  // relative strength, breakout structure, and OTHER_POSITIVE decomposition.
  // This never mutates live Gate1 scoring, thresholds, or order routing.
  try {
    const macro = options.macroGateState;
    const gate1PositiveSourceWiring = buildGate1PositiveSourceWiringReport({
      positiveStarvationReport: summaryDraft.positiveScoreStarvation,
      scoreCeilingRepairReport: summaryDraft.scoreCeilingRepair,
      penaltyDeduplicationReport: summaryDraft.penaltyDeduplication,
      riskDoubleCountReport: summaryDraft.riskDoubleCount,
      gate1ScoringAlignmentReport: summaryDraft.gate1ScoringAlignment,
      traces: counters.positiveScoreStarvationTraces,
      timestamp: kstNow.toISOString(),
      forDate: kstNow.toISOString().slice(0, 10),
      regime: macro?.regime ?? 'UNKNOWN',
      marketSession: 'BUY_ALLOWED',
    });
    if (gate1PositiveSourceWiring) {
      summaryDraft.gate1PositiveSourceWiring = gate1PositiveSourceWiring;
      logAdrDiagnostic(
        `[ADR-0475] Gate1PositiveSourceWiring SHADOW_ONLY dry-run emitted`,
        {
          adrCode: 'ADR-0475',
          dryRun: true,
          engineMode: 'SHADOW_ONLY',
          executionImpact: gate1PositiveSourceWiring.executionImpact,
          liveExecutionAllowed: gate1PositiveSourceWiring.liveExecutionAllowed,
          candidates: gate1PositiveSourceWiring.totalCandidates,
          afterRange: gate1PositiveSourceWiring.afterDryRunScoreRange,
          reason: 'GATE1_POSITIVE_SOURCE_WIRING_DRY_RUN',
        },
      );
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.buildGate1PositiveSourceWiringReport', error: e });
  }

  await persistMidScanDiagnosticBlocksAdr0588({
    kstNow, timeLabel, totalCandidates, sourceSnapshotId, scanCandidateSnapshots,
    scanEvaluation, gateLayerAudit, summaryDraft, counters, options,
  });

  // ADR-0623 Stage 2a — PriceIntegrity/PriceCorrection diagnostics 집계 채움 (Seam A reduce).
  //   buyListLoop 가 후보별 표본을 counters.priceIntegritySamples/.priceCorrectionSamples 에 push →
  //   본 시점에서 ScanSummary.priceIntegrity/.priceCorrection 형태로 reduce. 표본 없으면 미영속
  //   (byte-equivalent). corrected 값은 LIVE/Shadow 의사결정에 미사용 — 진단 표시 전용.
  //   try/catch 격리 — 집계 실패가 ScanSummary 영속을 차단하지 않음 (불변식 #1).
  try {
    const piSamples = counters.priceIntegritySamples ?? [];
    if (piSamples.length > 0) {
      const statusCounts: Record<PriceIntegrityStatus, number> = {
        OK: 0, SUSPECT: 0, STALE: 0, FROZEN_QUOTE: 0,
        PRICE_BASE_MISMATCH: 0, REVERSE_GAP_SUSPECT: 0, FAILED: 0,
      };
      const topAffected: Array<{ symbol: string; status: PriceIntegrityStatus }> = [];
      for (const s of piSamples) {
        statusCounts[s.status] = (statusCounts[s.status] ?? 0) + 1;
        if (s.status !== 'OK' && topAffected.length < 20) {
          topAffected.push({ symbol: s.symbol, status: s.status });
        }
      }
      summaryDraft.priceIntegrity = {
        totalSamples: piSamples.length,
        statusCounts,
        topAffected,
      };
    }
    const pcSamples = counters.priceCorrectionSamples ?? [];
    if (pcSamples.length > 0) {
      const correctionTypeCounts: Record<PriceCorrectionType, number> = {
        NONE: 0, USE_KIS_CURRENT: 0, USE_KRX_PREV_CLOSE: 0,
        USE_RECENT_DAILY_CLOSE: 0, DROP_GAP_CALCULATION: 0, SHADOW_ONLY: 0,
      };
      let confidenceSum = 0;
      let dropGapCalculationCount = 0;
      let shadowOnlySuggestedCount = 0;
      for (const s of pcSamples) {
        correctionTypeCounts[s.correctionType] = (correctionTypeCounts[s.correctionType] ?? 0) + 1;
        confidenceSum += Number.isFinite(s.confidence) ? s.confidence : 0;
        if (s.correctionType === 'DROP_GAP_CALCULATION') dropGapCalculationCount += 1;
        if (s.correctionType === 'SHADOW_ONLY') shadowOnlySuggestedCount += 1;
      }
      summaryDraft.priceCorrection = {
        totalSamples: pcSamples.length,
        correctionTypeCounts,
        averageConfidence: confidenceSum / pcSamples.length,
        dropGapCalculationCount,
        shadowOnlySuggestedCount,
      };
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.buildPriceIntegrityCorrectionAdr0623', error: e });
  }

  _lastScanSummary = summaryDraft;
  setLastSectorEnergyCanonicalState(summaryDraft.sectorEnergySupplyUnknownAdr0488?.sectorEnergyCanonicalState);
  // ADR-0367: 정상 ScanSummary 영속 1회가 "직전 스캔 = preflight 차단" 의미를 무효화한다.
  clearPreflightBlockedScanSummary();

  logPreBreakoutNoiseSummary({
    scanned: summaryDraft.candidates,
    wait: counters.waitPreBreakout,
    approaching: summaryDraft.preBreakoutWaitSummary?.retryEligible ?? 0,
    gateFail: counters.waitGateFail,
    ready: counters.entries,
    rejected: counters.gateMisses + counters.rrrMisses,
    priceDistance: counters.preBreakoutPriceDistance,
  });

  logNoiseSummary({ session: 'REGULAR', executionImpact: 'NONE' });

  if (counters.entries === 0 && _lastScanSummary.candidates > 0) {
    _consecutiveZeroScans++;
  } else {
    _consecutiveZeroScans = 0;
  }

  if (_consecutiveZeroScans >= 3) {
    const noEntryStreakCount = _consecutiveZeroScans;
    _consecutiveZeroScans = 0;
    const macro = _lastScanSummary.macroGateState;
    const finalExecutionPolicy = macro?.finalExecutionPolicy ?? '';
    const session = macro?.canonicalSession ?? macro?.displaySession ?? 'REGULAR';
    const sessionUpper = session.toUpperCase();
    const shadowOnly = [
      macro?.displayRegime,
      macro?.riskOverride,
      macro?.engineMode,
      finalExecutionPolicy,
    ].includes('SHADOW_ONLY') || finalExecutionPolicy === 'SHADOW_AND_DIAGNOSTIC_ONLY';
    const noEntryInput: NoEntryStreakDiagnosticInput = {
      tradeDate: kstNow.toISOString().slice(0, 10),
      scanCycleId: `scan-${kstNow.toISOString()}`,
      timeLabel,
      noEntryStreakCount,
      candidateCount: _lastScanSummary.candidates,
      swingCount: _lastScanSummary.swing,
      catalystCount: _lastScanSummary.catalyst,
      momentumCount: _lastScanSummary.momentum,
      quoteFailCount: counters.quoteFails,
      gateMissCount: counters.gateMisses,
      rrrFailCount: counters.rrrMisses,
      preBreakoutWaitCount: counters.waitPreBreakout,
      gateEvaluatedCount:
        counters.gateMisses +
        counters.rrrMisses +
        counters.entries +
        counters.waitGateFail +
        counters.waitPreBreakout +
        counters.gate1Pass +
        counters.gate1Unknown,
      gate3EvaluatedCount: counters.gate3Pass + counters.rrrMisses + counters.lastTriggerPass,
      entryTimingNotReadyCount: counters.gate3Pass > 0 && counters.lastTriggerPass === 0 ? counters.gate3Pass : 0,
      priceNotConfirmedCount: counters.waitDataHold,
      gate2LeadershipNotConfirmedCount: counters.gate1Pass > 0 && counters.gate2Pass === 0 ? counters.gate1Pass : 0,
      gate1ThresholdMissCount: counters.waitGateFail || counters.gateMisses,
      dataFreshnessStale:
        options.marketDataFreshness === 'STALE' ||
        options.marketDataFreshness === 'EXPIRED' ||
        macro?.sourceFreshness === 'STALE',
      providerIssue: macro?.providerIssue === true,
      providerFailureWithExecutionImpact:
        macro?.providerIssue === true &&
        macro?.providerIssueIsolated === false &&
        macro?.usableForLiveOrder === false,
      policyBlocked: macro?.emergencyStop === true || finalExecutionPolicy === 'LIVE_BLOCKED',
      shadowOnly,
      liveDisabled:
        !shadowOnly &&
        (macro?.liveEntryAllowed === false ||
          macro?.brokerLiveOrderAllowed === false ||
          macro?.brokerOrderAllowed === false),
      // volumeClock ALWAYS-ON 정합: 시초가(09:00~09:30 OPENING)는 매수 차단 guard 가 아니라
      // 점수 감점 구간이다. 따라서 opening 을 no-entry guard 로 라벨하지 않는다 (진단 false-positive
      // 억제 제거). 실제 차단 세션은 sessionGuardActive(PRE_MARKET/POST_MARKET/CLOSED/HOLIDAY)만 표시.
      openingGuardActive: false,
      sessionGuardActive: ['PRE_MARKET', 'POST_MARKET', 'CLOSED', 'HOLIDAY'].includes(sessionUpper),
      slotLimit: counters.waitSizingBlocked > 0 && counters.waitSizingBlocked >= _lastScanSummary.candidates,
      scanCompleted: true,
      shadowLearningAllowed: macro?.shadowLearningAllowed !== false,
      counterfactualAllowed: macro?.counterfactualAllowed !== false,
      counterfactualRecorded:
        counters.counterfactualRecordedToday > 0 ||
        (_lastScanSummary.counterfactualShadowLearning?.created ?? 0) > 0 ||
        _lastScanSummary.gate2SoftLeadershipLane?.counterfactualRecorded === true,
      forceScanCompleted: true,
      // ADR-0531 정합: no-entry streak 표시 regime 도 폐기 bare macroRegimeEffective 대신 scoring
      // resolver 의 stale-R6 누출 차단 결과 사용(비-R6·genuine R6 동일값, byte-equivalent).
      regime: resolveScoringEffectiveRegime(macro),
      session,
      now: kstNow,
    };
    const noEntryDiagnostic = buildNoEntryStreakDiagnostic(noEntryInput);
    const noEntryDelivery = evaluateNoEntryTelegramDelivery(noEntryDiagnostic);
    const summaryReasonMapping = mapScanSummaryDisplayReasons({
      scanCycleId: noEntryDiagnostic.scanCycleId,
      providerFailureCount: counters.quoteFails,
      providerFailureExecutionImpact: noEntryDiagnostic.dominantNoEntryReason === 'PROVIDER_FAILURE_WITH_EXECUTION_IMPACT'
        ? noEntryDiagnostic.executionImpact
        : 'NONE',
      providerFailureCausedEntryHold: noEntryDiagnostic.dominantNoEntryReason === 'PROVIDER_FAILURE_WITH_EXECUTION_IMPACT',
      dominantNoEntryReason: noEntryDiagnostic.dominantNoEntryReason,
      gateMissCount: counters.gateMisses,
      rrrFailCount: counters.rrrMisses,
      actionRequired: noEntryDiagnostic.actionRequired,
      executionImpact: noEntryDiagnostic.executionImpact,
    });
    _lastScanSummary.noEntryStreakDiagnostic = noEntryDiagnostic;
    console.log(formatNoEntryStreakEvaluatedLog(noEntryDiagnostic));
    for (const line of formatNoEntryWordingPolicyLogs(noEntryDiagnostic)) {
      console.log(line);
    }
    console.log(formatScanSummaryReasonMappedLog(summaryReasonMapping));
    for (const line of formatScanSummaryWordingPolicyLogs(summaryReasonMapping)) {
      console.log(line);
    }
    for (const reason of summaryReasonMapping.suppressedZeroCountReasons) {
      console.log(formatScanSummaryZeroReasonSuppressedLog(summaryReasonMapping, reason));
    }
    if (summaryReasonMapping.causalArrowAllowed) {
      console.log(formatScanSummaryCausalArrowAllowedLog(summaryReasonMapping));
    }
    console.log(
      noEntryDiagnostic.pipelineFailureDetected
        ? formatNoEntryPipelineFailureDetectedLog(noEntryDiagnostic)
        : formatNoEntryPipelineHealthOkLog(noEntryDiagnostic),
    );
    if (!noEntryDelivery.shouldSend) {
      console.log(formatNoEntryTelegramSuppressedLog(noEntryDiagnostic, noEntryDelivery));
    } else {
      const messageId = await sendTelegramAlert(
        buildNoEntryScanSummaryMessage(noEntryDiagnostic, noEntryInput, summaryReasonMapping),
        {
          priority: 'HIGH',
          tier: 'T1_ALARM',
          category: 'no_entry_streak',
          dedupeKey: noEntryDiagnostic.dedupKey,
          cooldownMs: 15 * 60 * 1000,
          notificationSeverity: 'ACTION_REQUIRED',
          notificationEventType: 'NO_ENTRY_STREAK',
          tradeDate: noEntryDiagnostic.tradeDate,
          regime: noEntryDiagnostic.regime,
          stateBucket: noEntryDiagnostic.noEntryStreakBucket,
          normalizedReason: noEntryDiagnostic.dominantNoEntryReason,
          executionImpact: noEntryDiagnostic.executionImpact,
          marketSignal: false,
          providerIssue: noEntryDiagnostic.providerIssue,
          kisImpact: 'NONE',
          actionRequired: true,
          tradeEvent: false,
          diagnosticOnly: false,
          notificationOnly: true,
          noiseEvent: {
            eventType: 'SCAN_EMPTY',
            channel: 'CH4_JOURNAL',
            consecutiveFailures: noEntryStreakCount,
            executionImpact: noEntryDiagnostic.executionImpact,
            dedupeHint: 'zero_entry_scan',
          },
        },
      ).catch((error) => {
        console.error(error);
        return undefined;
      });
      if (messageId !== undefined) {
        recordNoEntryTelegramSent(noEntryDiagnostic);
        console.log(formatNoEntryTelegramSentLog(noEntryDiagnostic));
      }
    }
  }

  // ADR-0401 — R3 Violation 5단계 state machine wiring.
  // 단일 스캔 1회 위반 → hard latch 즉시 활성화하던 결함 차단. profile + guards +
  // streak decay 평가 후 state.action='HARD_BLOCK_LATCH' 일 때만 activateR3SanityBlock.
  //
  // ADR-0412 — Holiday/blocked-day/frozen quote 시 streak skip:
  //   - r3StreakSkipped.skipped=true 시 evaluateR3ViolationState 자체 호출 skip
  //     → 영속 streak 무영향 + 24h decay 보존.
  //   - frozenQuoteDataQuality (옵셔널) 를 R3 guard 6번째로 전달 → STALE/SUSPECT 시
  //     hardBlockAllowed=false → SHADOW_ONLY cap.
  try {
    const sanity = evaluateR3Sanity(_lastScanSummary);
    const skipStreak = options.r3StreakSkipped?.skipped === true;
    // ADR-0436 — shadowObservable > 0 시 GATE1_PASS_ZERO streak 누적 차단.
    // 사용자 명시 §7 — *"실매수 후보 0 ≠ 학습/관측 후보 0"*. DATA_UNAVAILABLE/
    // PROVIDER_DEGRADED 우세 시 학습 후보 존재 = 시스템 결함 아님 → R3 sanity 평가 자체 skip.
    //
    // sanity.violation 직접 분기 회피 (state machine 캡슐화 보존, ADR-0401 절대 원칙 #8).
    // GATE1_PASS_ZERO 조건 — R3 + entries=0 + gate1Pass<1 — 을 ScanSummary 직접 검사로 도출.
    const isGate1Zero =
      _lastScanSummary.gatePassDistribution !== undefined &&
      _lastScanSummary.gatePassDistribution.gate1Pass < 1 &&
      _lastScanSummary.candidates >= 1;
    const shadowObservablePresent = (_lastScanSummary.shadowObservableCount ?? 0) > 0;
    const dataUnavailableDominant = isGate1Zero && shadowObservablePresent;

    // ADR-0448 Phase 0 — R3 Noise Governor wiring (helper 위임).
    const r3NoiseDecision = isGate1Zero
      ? buildR3NoiseDecision({ summary: _lastScanSummary, options, kstNow })
      : undefined;
    if (r3NoiseDecision) _lastScanSummary.r3NoiseDecision = r3NoiseDecision;
    const noiseGovernorSkip = r3NoiseDecision?.streakImpact === 0;

    if (sanity.violation !== 'NONE' && !skipStreak && !dataUnavailableDominant && !noiseGovernorSkip) {
      const regime = _lastScanSummary.macroGateState?.regime ?? '';
      const guards = {
        candidates: _lastScanSummary.candidates,
        sectorEnergyDataQuality: _lastScanSummary.sectorEnergyQuality,
        marketDataFreshness: options.marketDataFreshness ?? 'FRESH',
        volumeClockAllowsEntry: options.volumeClockAllowsEntry ?? true,
        // GatePassDistribution 산출 정상 — _lastScanSummary.gatePassDistribution 존재 +
        // sanity.violation !== 'GATE_PASS_DATA_MISSING' (별도 분기에서 hardBlock 차단됨).
        gatePassDistributionFresh:
          _lastScanSummary.gatePassDistribution !== undefined &&
          sanity.violation !== 'GATE_PASS_DATA_MISSING',
        // ADR-0412 — 6번째 guard. options.frozenQuote 부재 시 undefined (legacy 호환).
        frozenQuoteDataQuality: options.frozenQuote?.dataQuality,
      };
      const scanId = `${kstNow.toISOString().slice(0, 10)}:${timeLabel}`;
      const stateResult = evaluateR3ViolationState({
        violation: sanity.violation,
        regime,
        scanId,
        guards,
      });

      _lastScanSummary.r3ViolationState = stateResult;

      // HARD_BLOCK_LATCH 일 때만 영속 latch 생성 (ADR-0120 정합).
      if (stateResult.action === 'HARD_BLOCK_LATCH') {
        activateR3SanityBlock({
          violation: sanity.violation,
          regime,
          message: sanity.message,
        });
      }

      // 상태별 텔레그램 알림 — dedupeKey 에 state + count 포함하여 단계 전이 시 정상 발송.
      if (stateResult.action !== 'NONE' && sanity.message) {
        const stateLabel = stateResult.state.toLowerCase();
        const kstDate = kstNow.toISOString().slice(0, 10);
        const dedupeKey = `r3_sanity:${stateLabel}:${kstDate}:${stateResult.consecutiveCount}`;
        const message = formatR3StateMessage(stateResult, sanity.message);
        await sendTelegramAlert(message, {
          priority: 'HIGH',
          category: 'r3_sanity',
          dedupeKey,
          cooldownMs: 24 * 3_600_000,
        } as Parameters<typeof sendTelegramAlert>[1]).catch(console.error);
      }
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.evaluateR3ViolationState', error: e });
  }
}
