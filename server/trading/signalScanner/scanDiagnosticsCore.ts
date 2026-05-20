/**
 * @responsibility 스캔 진단 — ScanSummary·연속 제로 카운트·scan traces 영속화
 *
 * ADR-0001 (개정 2026-04-25) 의 7모듈 중 진단 단계. 기존 signalScanner.ts 의
 * 모듈 전역 상태를 본 파일 내부로 캡슐화한다.
 *
 * 외부 노출 API (barrel re-export 대상):
 *   - ScanSummary 타입
 *   - getLastBuySignalAt() / getLastScanSummary() / getConsecutiveZeroScans()
 *   - setLastBuySignalAt() / createScanCounters() / persistScanResults()
 */

import { sendTelegramAlert } from '../../alerts/telegramClient.js';
import type { ShadowCandidateScanTrigger } from '../marketStateResolver.js';
import { getNoiseCounters, logger, logNoiseDetail, logNoiseSummary } from '../../utils/logger.js';
import {
  buildEmptyScanRootCauseEventsFromStringsAdr0500,
  safeBuildEmptyScanRootCauseDashboardAdr0500,
  type EmptyScanRootCauseDashboardAdr0500,
} from '../../diagnostics/emptyScanRootCauseDashboardAdr0500.js';
import {
  buildWeekendReplayRecordsFromStringsAdr0501,
  safeBuildWeekendReplaySummaryAdr0501,
  type WeekendReplaySummaryAdr0501,
} from '../../diagnostics/weekendReplayAdr0501.js';
import { appendScanTraces, type ScanTrace } from '../scanTracer.js';
import {
  classifyEmptyScanReason,
  describeEmptyScanReason,
  type EmptyScanReason,
} from './emptyScanClassifier.js';
import { evaluateR3Sanity } from './r3SanityCheck.js';
import { activateR3SanityBlock } from '../../persistence/r3SanityBlockRepo.js';
// ADR-0401: R3 Sanity 단계형 state machine — 단일 스캔 1회 위반으로 hard latch 차단.
import {
  evaluateR3ViolationState,
  type R3ViolationStateResult,
} from './r3ViolationStateMachine.js';
import type { WatchlistEntry } from '../../persistence/watchlistRepo.js';
// ADR-0367: buyListLoop 진입 전 preflight 차단 시 진단 SSOT.
import {
  clearPreflightBlockedScanSummary,
  formatPreflightBlockedScanSection,
  getLastPreflightBlockedScanSummary,
} from './preflightBlockedScanSummary.js';
// ADR-0412: Frozen Quote Detector — 입력 데이터 오염 + Holiday-aware streak skip 진단 표시.
import type { FrozenQuoteResult } from './frozenQuoteDetector.js';
import type { StreakSkipReason } from './r3StreakSkipPolicy.js';
// ADR-0448 Phase 0 — R3 Noise Governor compact line + wiring helper + decision type.
import {
  formatR3NoiseGovernorCompactLine,
  type R3NoiseGovernorDecision,
} from './r3NoiseGovernor.js';
import { buildR3NoiseDecision } from './r3NoiseGovernorWiring.js';
// ADR-0449 — Pre-Breakout WAIT Liveness Policy: 7-state 분류 SSOT.
import {
  formatPreBreakoutWaitSummarySection,
  summarizePreBreakoutWaitDecisions,
  type PreBreakoutWaitDecision,
  type PreBreakoutWaitSummary,
} from './preBreakoutWaitPolicy.js';
// ADR-0452 — Shadow Near-Breakout Entry compact section SSOT.
import {
  formatShadowNearBreakoutSection,
  type ShadowNearBreakoutBlockReason,
} from './shadowNearBreakoutEntryPolicy.js';
// ADR-0414 — Price Integrity Checker + Correction Overlay (Stage 1 Read-Only Mode).
// Stage 1: diagnostics only — corrected 값 LIVE 매수 판단 사용 0건 (절대 원칙 #3).
import type { PriceIntegrityStatus } from './priceIntegrityChecker.js';
import type { PriceCorrectionType } from './priceCorrectionEngine.js';
// ADR-0420 — Fresh Scan Blocker Attribution: GATE1_PASS_ZERO 조건별 분해 진단 SSOT.
import {
  type ConditionBlockerBucket,
  type FreshAttributionOutputItem,
  type FreshScanBlockerAttribution,
  accumulateFreshAttribution,
  buildFreshScanBlockerAttribution,
  formatFreshAttributionSection,
} from './freshScanBlockerAttribution.js';
// ADR-0422 — Gate2 / NO_LEADERSHIP fresh attribution: Gate1 생존 후보 → Gate2 분해 진단.
import {
  type Gate2AttributionOutputItem,
  type Gate2BlockerBucket,
  type Gate2FreshAttribution,
  accumulateGate2Attribution,
  buildGate2FreshAttribution,
  buildSectorEnergyDiagnostic,
  formatGate2AttributionSection,
} from './gate2LeadershipAttribution.js';
// ADR-0423 — SectorEnergy 데이터 진실성 진단 (indexCode coverage / symmetry / fallback 분해).
//   `evaluateSectorEnergyQualityDiagnostic` SSOT 결과를 영속 + /scan_blockers 표시.
//   기존 sectorEnergyQuality / validSectorCount / sectorEnergyReasons 와 *책임 분리*
//   (이전 = 단일 라벨 + free-text reasons / 본 진단 = 구조화 reason union + leadershipConfidence).
import {
  type SectorEnergyQualityDiagnostic,
  formatSectorEnergyQualityDiagnosticSection,
} from '../../clients/sectorEnergyQualityDiagnostic.js';
// ADR-0505 — Gate1 Minimum Signal Forensic Audit (사용자 명시 ADR-0502 의미상 후속).
//   diagnostic-only 100-scale score forensic decomposition + supply scope audit +
//   sectorEnergy layer audit + 8 wouldPassIf counterfactuals. executionImpact='NONE'.
import {
  type Gate1MinimumSignalForensicSummaryAdr0505,
  buildGate1MinimumSignalForensicAuditAdr0505,
  buildGate1MinimumSignalForensicSummaryAdr0505,
  formatGate1MinimumSignalForensicSection,
  isGate1MinimumSignalForensicAuditDisabled,
  resolveGate1EvaluationStateAdr0510,
} from './gate1MinimumSignalForensicAuditAdr0505.js';
import { appendGate1ForensicTrace } from '../../persistence/gate1MinimumSignalForensicTraceRepo.js';
// ADR-0507 — Gate1 Forensic Inputs Collector SSOT (ADR-0505 Phase 1 후속).
//   summaryDraft.entryFilterDecomposition.gate1CandidateTraces 로부터 forensic input
//   array 자동 합성 → 호출자 측 collector 신규 0 + dead-code wiring 차단.
//   executionImpact='NONE', liveExecutionAllowed=false (분석/표시 전용).
import { collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507 } from './gate1ForensicInputsCollectorAdr0507.js';
// ADR-0425 — Gate Decision Router (hard block vs soft degrade separation).
//   Router 결과를 ScanSummary 옵셔널 필드로 영속 + /scan_blockers 표시.
//   Gate threshold/weights/order policy 무수정 — decision semantics 분리만.
import {
  type GateDecisionRouterResult,
  deriveGateDecisionRouterResult,
  formatGateDecisionRouterSection,
} from './gateDecisionRouter.js';
// ADR-0426 — R3_EARLY Provisional Shadow Lane.
//   Router SOFT_DEGRADE/WATCH_ONLY 시점 + Gate1 생존자 → provisional shadow 후보 생성.
//   LIVE 매매 본체 0줄 변경, KIS 주문 import 0건. 학습 샘플 보존.
import {
  type ProvisionalShadowCandidate,
  type ProvisionalShadowSectionInput,
  formatProvisionalShadowSection,
  summarizeProvisionalShadowCandidates,
} from './provisionalShadowLane.js';
// ADR-0430 — Counterfactual Shadow Learning Lane.
//   SELL_ONLY/HARD_BLOCK 에서도 학습 표본 보존. ADR-0427 provisional 와 분리.
//   별도 ledger (counterfactual-shadow-learning-ledger.json), virtual account 무관.
import {
  type CounterfactualShadowLearningCandidate,
  type CounterfactualShadowSectionInput,
  formatCounterfactualShadowLearningSection,
  summarizeCounterfactualShadowLearningCandidates,
} from './counterfactualShadowLearningLane.js';
import type { R6ShadowEntryPolicySummary } from './r6ShadowCounterfactualEntryPolicy.js';
// ADR-0436 — Gate Eligibility Split 진단 섹션 (별도 파일, ADR-0133 1500줄 한계).
import { formatGateEligibilitySplitSection } from './gateEligibilitySection.js';
import {
  buildGateReclassificationDryRunSummary,
  formatGateReclassificationDryRunSection,
  type GateReclassificationDryRunResult,
  type GateReclassificationDryRunSummary,
} from '../../learning/gateReclassificationDryRun.js';
import {
  buildEntryFilterDecomposition,
  formatEntryFilterDecompositionSection,
  type CandidateSnapshot,
  type EntryFilterDecomposition,
} from './entryFilterDecomposition.js';
import {
  buildPositiveScoreStarvationFallbackReport,
  buildPositiveScoreStarvationReport,
  formatPositiveScoreStarvationReport,
  type Gate1ScoreStarvationTrace,
  type PositiveScoreStarvationReport,
} from './gate1PositiveScoreStarvation.js';
import {
  buildGate1ScoreCeilingRepairReport,
  formatGate1ScoreCeilingRepairReport,
  type Gate1ScoreCeilingRepairReport,
} from './gate1ScoreCeilingRepair.js';
import {
  buildPenaltyDeduplicationReport,
  formatPenaltyDeduplicationReport,
  type PenaltyDeduplicationReport,
} from './gate1PenaltyDeduplication.js';
import {
  buildRiskDoubleCountAuditReport,
  formatRiskDoubleCountAuditReport,
  type RiskDoubleCountAuditReport,
} from './gate1RiskDoubleCount.js';
import {
  buildFinalGate1CalibrationAuditReport,
  formatFinalGate1CalibrationReport,
  type FinalGate1CalibrationAuditReport,
} from './gate1FinalCalibration.js';
import {
  buildGate1ScoringAlignmentReport,
  formatGate1ScoringAlignmentReport,
  type Gate1ScoringAlignmentReport,
} from './gate1ScoringAlignmentAdr0472.js';
import {
  buildGate1PositiveSourceWiringReport,
  formatGate1PositiveSourceWiringReport,
  type Gate1PositiveSourceWiringReport,
} from './gate1PositiveSourceWiringAdr0475.js';
import {
  buildGate1DryRunObservationRows,
  formatGate1DryRunObservationSummary,
  saveGate1DryRunObservationRows,
  summarizeGate1DryRunObservationRows,
  type Gate1DryRunObservationSummary,
} from './gate1DryRunObservationLedgerAdr0476.js';
import {
  buildInvestorFlowProviderRouteResultAdr0477,
  formatInvestorFlowProviderRouterAdr0477,
  type InvestorFlowProviderRouterInput,
  type InvestorFlowProviderRouteResult,
} from './investorFlowProviderRouterAdr0477.js';
import type { PerSymbolSupplyInjectionStats } from './injectPerSymbolSupplyContext.js';
import {
  buildNaverInvestorTrendCollectorResultAdr0481,
  collectNaverInvestorTrendCollectorResultAdr0481,
  type NaverInvestorTrendRawPoint,
  type NaverInvestorTrendCollectorResult,
} from './naverInvestorTrendCollectorAdr0481.js';
import {
  buildSemanticNetBuyNormalizationReportAdr0482,
  type SemanticNetBuyInputPoint,
  type SemanticNetBuyNormalizationReportAdr0482,
} from './semanticNetBuyNormalizerAdr0482.js';
import {
  buildSupplySourceFreshnessReportAdr0483,
  type SupplySourceFreshnessReportAdr0483,
} from './supplySourceFreshnessAdr0483.js';
import {
  buildSupplyCoverageRecoveryObservationReportAdr0484,
  type SupplyCoverageRecoveryObservationReportAdr0484,
} from './supplyCoverageRecoveryObservationAdr0484.js';
import {
  buildSupplyAdvisoryReadinessReportAdr0485,
  type SupplyAdvisoryReadinessReportAdr0485,
} from './supplyAdvisoryReadinessAdr0485.js';
import {
  buildSupplyRecoveryRuntimeMountReportAdr0486,
  type SupplyRecoveryRuntimeMountReportAdr0486,
} from './supplyRecoveryRuntimeMountAdr0486.js';
import {
  buildFreshDataSupplyReportAdr0487,
  type FreshDataSupplyReportAdr0487,
  type FreshDataSupplyReportInputAdr0487,
} from './freshDataSupplyLayerAdr0487.js';
import {
  buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488,
  type SectorEnergyAndSupplyUnknownPolicyReportAdr0488,
} from './sectorEnergyMasterSupplyUnknownPolicyAdr0488.js';
import {
  buildInvestorFlowSampleAcquisitionReportAdr0489,
  type InvestorFlowSampleAcquisitionReportAdr0489,
} from './investorFlowSampleAcquisitionAdr0489.js';
import {
  recordSupplySnapshotAdr0491,
  readLatestSupplySnapshotBySymbolSourceDomainAdr0491,
  type SupplySnapshotCacheLookupAdr0491,
  type SupplySnapshotReplayResultAdr0491,
} from './supplySnapshotStoreReplayAdr0491.js';
import { previousTradingDateCandidateAdr0491 } from './investorFlowSnapshotKeyNormalizerAdr0491.js';
import { fetchKisInvestorFlowEvidence } from '../../supply/kisInvestorFlowEvidence.js';
import { fetchInvestorFlowWithPolicy } from '../../supply/investorFlowRouter.js';
import { rememberSupplyBySymbolPayloadSnapshot } from '../../supply/investorFlowBySymbolPayloadSnapshot.js';
import type { GateLayerSummary } from '../../quantFilter.js';
import {
  fetchInvestorTrading,
  getLastKrxInvestorTradingDiagnostic,
  type KrxInvestorRow,
  type KrxInvestorTradingDiagnostic,
} from '../../clients/krxClient.js';
import {
  DEFAULT_DATA_PROMOTION_STATUS,
  type MacroGateState,
  type ScanSummary,
} from './scanDiagnostics/scanSummaryTypes.js';
import type { ScanCounters } from './scanDiagnostics/scanCounterTypes.js';
import {
  buildGatePassDistribution,
  buildWaitDistribution,
} from './scanDiagnostics/scanCounterAccumulators.js';
import {
  buildGateScoreCandidateBucketSummary,
  buildGateScoreHealthSummary,
  formatGateScoreCandidateBucketSection,
  formatGateScoreHealthSection,
} from './scanDiagnostics/gateScoreDiagnostics.js';
import {
  buildGateDiagnosticCarrySummary,
  buildGateLayerAuditSummary,
  formatGate1SurvivalAuditSection,
  formatGate2CoverageAuditSection,
} from './scanDiagnostics/gateLayerDiagnostics.js';
import { buildPerStageDropoffSummary } from './scanDiagnostics/pipelineStageDiagnostics.js';
import { scanDiagnosticNumber, scanDiagnosticString } from './scanDiagnostics/macroScanDiagnostics.js';
import {
  cacheRawToNaverInvestorTrendPointAdr0481,
  cacheRawToSemanticInputAdr0482,
} from './scanDiagnostics/supplyDiagnostics.js';
import {
  buildScanEvaluationResult,
  formatScanEvaluationSection,
  type ScanEvaluationResult,
} from './state/scanEvaluationState.js';
import {
  emitScanDiagnosticBuildFailedWarn,
  emitScanEvaluationWarnings,
} from './state/scanDiagnosticSuppressor.js';
import { recordScanCase } from './state/scanCaseRecorder.js';
export { formatGateEligibilitySplitSection } from './gateEligibilitySection.js';

let _lastBuySignalAt = 0;
let _consecutiveZeroScans = 0;
let _lastScanSummary: ScanSummary | null = null;

export function getLastBuySignalAt(): number { return _lastBuySignalAt; }
export function getLastScanSummary(): ScanSummary | null { return _lastScanSummary; }
export function getConsecutiveZeroScans(): number { return _consecutiveZeroScans; }

export function setLastBuySignalAt(ts: number): void { _lastBuySignalAt = ts; }

function compactTradingDateAdr0505(date: string): string {
  return date.replace(/[^0-9]/g, '');
}

function normalizeSymbolCodeAdr0505(symbol: string | null | undefined): string {
  const digits = String(symbol ?? '').replace(/[^0-9]/g, '');
  if (digits.length >= 6) return digits.slice(-6);
  return digits.padStart(6, '0');
}

function isPseudoWatchlistSymbolAdr0520(value: unknown): boolean {
  return typeof value === 'string' && /^WATCHLIST_\d+$/i.test(value);
}

function normalizeActualSymbolForAdr0477(value: unknown): string | null {
  if (isPseudoWatchlistSymbolAdr0520(value)) return null;
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const withoutPrefix = raw.replace(/^[A-Z]/, '');
  const digits = withoutPrefix.replace(/[^0-9]/g, '');
  return digits.length === 6 ? digits : null;
}

function objectFieldAdr0477(input: unknown, key: string): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const value = (input as Record<string, unknown>)[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function resolveActualSymbolForAdr0477(snapshot: CandidateSnapshot | undefined): string | null {
  const record = snapshot as unknown as Record<string, unknown> | undefined;
  const quote = objectFieldAdr0477(record, 'quote');
  const selectedCandidate = objectFieldAdr0477(record, 'selectedCandidate');
  const candidates = [
    record?.actualSymbol,
    record?.stockCode,
    record?.code,
    record?.iscd,
    record?.symbolCode,
    quote?.symbol,
    quote?.code,
    quote?.stockCode,
    selectedCandidate?.symbol,
    selectedCandidate?.code,
    selectedCandidate?.stockCode,
    snapshot?.symbol,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeActualSymbolForAdr0477(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function krxInvestorRowToRouterRawAdr0505(input: {
  row: KrxInvestorRow;
  sourceDate: string;
  status: 'VERIFIED' | 'STALE';
}): Record<string, unknown> {
  return {
    code: normalizeSymbolCodeAdr0505(input.row.code),
    sourceDate: input.sourceDate,
    foreignNetBuy: input.row.foreignNetBuy,
    institutionNetBuy: input.row.institutionNetBuy,
    individualNetBuy: input.row.individualNetBuy,
    status: input.status,
  };
}

function krxInvestorRowToSemanticInputAdr0482(input: {
  row: KrxInvestorRow;
  sourceDate: string;
  status: 'VERIFIED' | 'STALE';
}): SemanticNetBuyInputPoint {
  return {
    code: normalizeSymbolCodeAdr0505(input.row.code),
    provider: 'KRX',
    sourceDate: input.sourceDate,
    rawForeignNetBuy: input.row.foreignNetBuy,
    rawInstitutionNetBuy: input.row.institutionNetBuy,
    rawIndividualNetBuy: input.row.individualNetBuy,
    unit: 'SHARES',
    status: input.status,
    sourceAgeTradingDays: input.status === 'STALE' ? 1 : 0,
    diagnostics: ['KRX_INVESTOR_FLOW previousTradingDate sample consumed by ADR-0482 as SHADOW_ONLY input.'],
  };
}


function kisEvidenceToSemanticInputAdr0482(input: {
  code: string;
  evidence: Awaited<ReturnType<typeof fetchKisInvestorFlowEvidence>> | null;
}): SemanticNetBuyInputPoint | null {
  const data = input.evidence?.data;
  const sample = input.evidence?.sample;
  if (!data || sample?.sourceKind !== 'INVESTOR_TRADE_BY_STOCK_DAILY') return null;
  return {
    code: input.code,
    provider: 'KIS',
    sourceDate: data.tradingDate ?? sample.sourceDate ?? null,
    rawForeignNetBuy: data.foreignNetBuy,
    rawInstitutionNetBuy: data.institutionalNetBuy,
    rawIndividualNetBuy: data.individualNetBuy,
    unit: 'SHARES',
    status: sample.confidence === 'VERIFIED' ? 'VERIFIED' : 'PARTIAL',
    sourceAgeTradingDays: 0,
    providerSemanticCapable: true,
    diagnostics: [
      'inputSource=KIS_INVESTOR_TRADE_BY_STOCK_DAILY',
      'sourceKind=INVESTOR_TRADE_BY_STOCK_DAILY',
      'confidence=VERIFIED',
      'usableForSignal=true',
      'usableForExecution=false',
      'executionImpact=NONE',
    ],
  };
}

function routedKisFlowToSemanticInputAdr0482(input: {
  code: string;
  routeResult: Awaited<ReturnType<typeof fetchInvestorFlowWithPolicy>> | null;
}): SemanticNetBuyInputPoint | null {
  const data = input.routeResult?.source === 'KIS_API' && input.routeResult.status === 'OK'
    ? input.routeResult.data
    : null;
  if (!data) return null;
  return {
    code: input.code,
    provider: 'KIS',
    sourceDate: data.tradingDate ?? null,
    rawForeignNetBuy: data.foreignNetBuy,
    rawInstitutionNetBuy: data.institutionalNetBuy,
    rawIndividualNetBuy: data.individualNetBuy,
    unit: 'SHARES',
    status: 'VERIFIED',
    sourceAgeTradingDays: 0,
    providerSemanticCapable: true,
    diagnostics: [
      'inputSource=KIS_INVESTOR_TRADE_BY_STOCK_DAILY',
      'sourceKind=INVESTOR_TRADE_BY_STOCK_DAILY',
      'confidence=VERIFIED',
      'usableForSignal=true',
      'usableForExecution=false',
      'executionImpact=NONE',
      'selectedBy=INVESTOR_FLOW_POLICY_ROUTER',
    ],
  };
}

function routedKisFlowToAdr0477Raw(input: {
  code: string;
  routeResult: Awaited<ReturnType<typeof fetchInvestorFlowWithPolicy>> | null;
}): Record<string, unknown> | null {
  const data = input.routeResult?.source === 'KIS_API' && input.routeResult.status === 'OK'
    ? input.routeResult.data
    : null;
  if (!data) return null;
  return {
    code: input.code,
    sourceDate: data.tradingDate ?? null,
    foreignNetBuy: data.foreignNetBuy,
    institutionNetBuy: data.institutionalNetBuy,
    individualNetBuy: data.individualNetBuy,
    status: 'VERIFIED',
    provider: 'KIS_API',
    actualInvestorRow: data.actualInvestorRow ?? null,
    normalizedInvestorRow: data.normalizedInvestorRow ?? null,
    semanticInvestorRow: data.semanticInvestorRow ?? null,
    supplySemanticRow: data.supplySemanticRow ?? null,
    actualInvestorFlowRows: data.actualInvestorFlowRows ?? [],
    actualInvestorFlowRowCount: data.actualInvestorFlowRowCount ?? data.actualInvestorFlowRows?.length ?? 0,
    actualInvestorFlowRowSourcePath: data.actualInvestorFlowRowSourcePath ?? null,
    actualInvestorFlowFieldKeys: data.actualInvestorFlowFieldKeys ?? [],
    actualInvestorFlowNumericKeys: data.actualInvestorFlowNumericKeys ?? [],
    actualInvestorFlowNumericStringKeys: data.actualInvestorFlowNumericStringKeys ?? [],
    actualInvestorFlowCarried: data.actualInvestorFlowCarried ?? false,
  };
}

function cacheLookupToSemanticInputAdr0482(input: {
  code: string;
  lookup: SupplySnapshotCacheLookupAdr0491 | null | undefined;
}): SemanticNetBuyInputPoint | null {
  const lookup = input.lookup;
  if (!lookup || (lookup.status !== 'CACHE_HIT' && lookup.status !== 'CACHE_STALE_HIT' && lookup.status !== 'STALE_HIT')) return null;
  const latest = lookup.snapshot?.latestInvestorFlowSample;
  const cacheRaw = lookup.cacheRaw ?? (latest ? {
    sourceDate: latest.dataDate,
    foreignNetBuy: latest.foreignNetBuy,
    institutionNetBuy: latest.institutionNetBuy,
    retailNetBuy: latest.retailNetBuy,
    status: lookup.status === 'CACHE_STALE_HIT' || lookup.status === 'STALE_HIT' ? 'STALE' : latest.status,
  } : null);
  const sourceDate = scanDiagnosticString(cacheRaw?.sourceDate);
  if (!sourceDate) return null;
  return {
    code: input.code,
    provider: 'CACHE',
    sourceDate,
    rawForeignNetBuy: scanDiagnosticNumber(cacheRaw?.foreignNetBuy),
    rawInstitutionNetBuy: scanDiagnosticNumber(cacheRaw?.institutionNetBuy),
    rawProgramNetBuy: scanDiagnosticNumber(cacheRaw?.programNetBuy),
    rawIndividualNetBuy: scanDiagnosticNumber(cacheRaw?.retailNetBuy),
    unit: 'KRW',
    status: lookup.stale || lookup.status === 'CACHE_STALE_HIT' || lookup.status === 'STALE_HIT' ? 'STALE' : 'VERIFIED',
    sourceAgeTradingDays: lookup.stale || lookup.status === 'CACHE_STALE_HIT' || lookup.status === 'STALE_HIT' ? 4 : 0,
    diagnostics: [`ADR-0491 ${lookup.status} sanitized CACHE fallback consumed by ADR-0482 as SHADOW_ONLY input; raw payload not persisted.`],
  };
}

function krxDiagnosticToRouterInputAdr0505(
  diagnostic: KrxInvestorTradingDiagnostic | null,
  previousTradingDateCandidate: string,
): NonNullable<InvestorFlowProviderRouterInput['krxInvestorDiagnosticAdr0505']> | null {
  if (!diagnostic) return null;
  return {
    parserStatus: diagnostic.parserStatus,
    endpointIssueHint: diagnostic.endpointIssueHint,
    endpoint: diagnostic.endpoint,
    bld: diagnostic.bld,
    tradeDate: diagnostic.tradeDate,
    previousTradingDateCandidate,
    selectedKrxFlowMode: diagnostic.selectedKrxFlowMode,
    payloadMode: diagnostic.payloadMode,
    routePurpose: diagnostic.routePurpose,
    selectedBld: diagnostic.selectedBld,
    requiredParamMissing: diagnostic.requiredParamMissing,
    shortCodeToIsuCdResolved: diagnostic.shortCodeToIsuCdResolved,
    isuCd: diagnostic.isuCd,
    inqTpCd: diagnostic.inqTpCd,
    inqVal: diagnostic.inqVal,
    detailView: diagnostic.detailView,
    endpointVariant: diagnostic.endpointVariant,
    dateParam: diagnostic.dateParam,
    marketCode: diagnostic.marketCode,
    symbolCode: diagnostic.symbolCode,
    parameterKeys: diagnostic.parameterKeys,
    attemptedVariants: diagnostic.attemptedVariants,
    selectedVariant: diagnostic.selectedVariant,
    otpGenerated: diagnostic.otpGenerated,
    otpLength: diagnostic.otpLength,
    csvDownloaded: diagnostic.csvDownloaded,
    csvRowCount: diagnostic.csvRowCount,
    csvColumnKeys: diagnostic.csvColumnKeys,
    csvFailureReason: diagnostic.csvFailureReason,
    csvHeaderDetected: diagnostic.csvHeaderDetected,
    csvNoDataReason: diagnostic.csvNoDataReason,
    omittedKeys: diagnostic.omittedKeys,
    forbiddenKeysPresent: diagnostic.forbiddenKeysPresent,
    requiredKeysPresent: diagnostic.requiredKeysPresent,
    requiredKeysMissing: diagnostic.requiredKeysMissing,
    sentPayloadKeys: diagnostic.sentPayloadKeys,
    contentType: diagnostic.contentType,
    httpStatus: diagnostic.httpStatus,
    responseKind: diagnostic.responseKind,
    consecutiveFailures: diagnostic.consecutiveFailures,
    cooldownActive: diagnostic.cooldownActive,
    cooldownRemainingMs: diagnostic.cooldownRemainingMs,
    offHoursSuppressed: diagnostic.offHoursSuppressed,
    diagnosticOnly: diagnostic.diagnosticOnly,
    useForRouter: diagnostic.useForRouter,
    useForGate: diagnostic.useForGate,
    useForLive: diagnostic.useForLive,
    useForShadow: diagnostic.useForShadow,
    rawTopLevelKeys: diagnostic.rawTopLevelKeys,
    detectedCandidatePaths: diagnostic.detectedCandidatePaths,
    selectedRowPath: diagnostic.selectedRowPath,
    selectedRowCount: diagnostic.selectedRowCount,
    firstRowKeys: diagnostic.firstRowKeys,
    normalizedRows: diagnostic.normalizedRows,
    fieldMappings: diagnostic.fieldMappings,
    summary: diagnostic.summary,
  };
}

function naverCollectorToSemanticInputAdr0482(result: NaverInvestorTrendCollectorResult): SemanticNetBuyInputPoint | null {
  const candidate = result.semanticNetBuyCandidate;
  if (!candidate) return null;
  return {
    code: result.code,
    provider: 'NAVER',
    sourceDate: candidate.sourceDate,
    rawForeignNetBuy: candidate.foreignNetBuy,
    rawInstitutionNetBuy: candidate.institutionNetBuy,
    rawProgramNetBuy: candidate.programNetBuy,
    unit: 'KRW',
    status: candidate.status,
    sourceAgeTradingDays: result.freshness.sourceAgeTradingDays,
    diagnostics: ['ADR-0481 NAVER collector candidate consumed by ADR-0482.'],
  };
}

export function formatScanBlockersMessage(summary: ScanSummary | null): string {
  // ADR-0367: 직전 스캔이 buyListLoop 진입 전 preflight 차단됐으면 preflight blocked scan 을 우선 표시.
  // persistScanResults 가 _lastScanSummary 를 채울 때 clearPreflightBlockedScanSummary 로 stale 제거되므로
  // _lastPreflightBlockedScanSummary 가 non-null 이면 항상 "직전 스캔 = preflight 차단" 을 의미한다.
  const preflightBlocked = getLastPreflightBlockedScanSummary();
  if (preflightBlocked) {
    return formatPreflightBlockedScanSection(preflightBlocked);
  }
  if (!summary) {
    return '📊 <b>[매수 차단 사유]</b>\n━━━━━━━━━━━━━━━━\n진단 데이터 없음 (스캔 미실행).';
  }

  const wd = summary.waitDistribution;
  const mg = summary.macroGateState;
  const lines: string[] = [];
  lines.push(`📊 <b>[매수 차단 사유 분포]</b> 직전 스캔 (${summary.time})`);
  lines.push('━━━━━━━━━━━━━━━━');

  if (mg) {
    lines.push('');
    lines.push('🛑 <b>거시 게이트:</b>');
    lines.push(`  • emergencyStop: ${mg.emergencyStop ? '<b>ON ⚠️</b>' : 'off'}`);
    lines.push(`  • autoTradeEnabled: ${mg.autoTradeEnabled ? 'on' : '<b>OFF ⚠️</b>'}`);
    lines.push(`  • 레짐: ${mg.regime} (Kelly ×${mg.kellyMultiplierFromRegime.toFixed(2)})`);
    if (mg.macroRegimeRaw || mg.macroRegimeEffective) lines.push(`  • raw/effective: ${mg.macroRegimeRaw ?? 'UNKNOWN'} → ${mg.macroRegimeEffective ?? mg.regime}`);
    if (mg.r6RecoveryStatus) lines.push(`  • r6RecoveryStatus: ${mg.r6RecoveryStatus}`);
    if (mg.activeR6Triggers) lines.push(`  • activeR6Triggers: [${mg.activeR6Triggers.join(',') || 'none'}]`);
    if (mg.r6ShockLatch !== undefined) lines.push(`  • r6ShockLatch: ${mg.r6ShockLatch}`);
    if (mg.recoveryBlockedReason) lines.push(`  • recoveryBlockedReason: ${mg.recoveryBlockedReason}`);
    if (mg.liveEntryAllowed !== undefined) lines.push(`  • liveEntryAllowed: ${mg.liveEntryAllowed}`);
    if (mg.liveExitAllowed !== undefined) lines.push(`  • liveExitAllowed: ${mg.liveExitAllowed}`);
    if (mg.shadowBuyAllowed !== undefined) lines.push(`  • shadowBuyAllowed: ${mg.shadowBuyAllowed}`);
    if (mg.shadowSellAllowed !== undefined) lines.push(`  • shadowSellAllowed: ${mg.shadowSellAllowed}`);
    if (mg.shadowLearningAllowed !== undefined) lines.push(`  • shadowLearningAllowed: ${mg.shadowLearningAllowed}`);
    if (mg.counterfactualAllowed !== undefined) lines.push(`  • counterfactualAllowed: ${mg.counterfactualAllowed}`);
    if (mg.brokerOrderAllowed !== undefined) lines.push(`  • brokerOrderAllowed: ${mg.brokerOrderAllowed}`);
    lines.push(`  • FOMC: ${mg.fomcPhase} (Kelly ×${mg.fomcKellyMultiplier.toFixed(2)}) → 결합 ×${mg.finalKellyMultiplier.toFixed(2)}`);
    if (mg.vixGatingActive) lines.push(`  • VIX 게이팅: <b>ON ⚠️</b>`);
    if (mg.bearDefenseMode) lines.push(`  • bearDefenseMode: <b>ON ⚠️</b>`);
    if (mg.mhsBelow30) lines.push(`  • MHS<30: <b>ON ⚠️</b>`);
    if (mg.diagnosticLiveEntryBlocked) {
      lines.push(`  • liveEntryBlocked: <b>${mg.liveEntryBlockedReason ?? 'DIAGNOSTIC_ONLY'}</b> (diagnostics continue)`);
    }
    if (mg.sellOnlyMode) {
      lines.push(`  • SELL_ONLY: <b>ON ⚠️</b> (점심/장외 시간대)`);
      lines.push('  marketSession note: SELL_ONLY/장외 구간의 Gate1 zero survivor는 live-entry evaluation이 아니라 order-blocked diagnostic입니다. BUY_ALLOWED 정규장 fresh scan과 분리해 해석하십시오.');
      lines.push('  shadow note: Shadow/Counterfactual snapshot preserved; liveExecutionAllowed=false, executionImpact=NONE.');
    }
    if (mg.watchlistEmpty) lines.push(`  • 워치리스트: <b>0개 ⚠️</b>`);
  }

  const scanEvaluationSection = formatScanEvaluationSection(summary.scanEvaluation);
  if (scanEvaluationSection) {
    lines.push('');
    lines.push(scanEvaluationSection);
  }

  if (summary.sectorEnergyQuality !== undefined) {
    lines.push('');
    lines.push('🌐 <b>섹터 에너지 데이터 품질:</b>');
    // ADR-0396 (= 사용자 명시 ADR-0371): 5단계 union — DEGRADED 신규 마커 추가.
    const qualityIcon =
      summary.sectorEnergyQuality === 'OK' ? '✅'
      : summary.sectorEnergyQuality === 'PARTIAL' ? '🟡'
      : summary.sectorEnergyQuality === 'STALE' ? '🟠'
      : summary.sectorEnergyQuality === 'DEGRADED' ? '🔶'
      : '❌';
    lines.push(`  • dataQuality: ${qualityIcon} <b>${summary.sectorEnergyQuality}</b>`);
    if (summary.validSectorCount !== undefined) {
      lines.push(`  • validSectorCount: ${summary.validSectorCount}/12`);
    }
    if (summary.sectorEnergyReasons && summary.sectorEnergyReasons.length > 0) {
      lines.push(`  • reasons: ${summary.sectorEnergyReasons.slice(0, 3).join('; ')}`);
    }
    // ADR-0396: FAILED 외 DEGRADED 도 DATA_INVALID 후보 (emptyScanClassifier wiring 정합).
    if (summary.sectorEnergyQuality === 'FAILED' || summary.sectorEnergyQuality === 'DEGRADED') {
      lines.push(`  • <i>${summary.sectorEnergyQuality} → emptyScanReason DATA_INVALID 자동 가중 (ADR-0127/0396)</i>`);
    }
  }

  lines.push('');
  lines.push(`📋 <b>종목별 차단</b> (후보 ${summary.candidates}개):`);
  lines.push(`  • 진입: <b>${summary.entries}개</b>`);
  if (wd) {
    if (wd.dataHold > 0) lines.push(`  • DATA_HOLD: ${wd.dataHold}개 ⚠️`);
    if (wd.gateFail > 0) lines.push(`  • Gate 재검증 미달: ${wd.gateFail}개`);
    if (wd.preBreakout > 0) lines.push(`  • Pre-breakout WAIT: ${wd.preBreakout}개`);
    if (wd.sizingBlocked > 0) lines.push(`  • Sizing BLOCKED: ${wd.sizingBlocked}개 ⚠️`);
    if (wd.volumeDrop > 0) lines.push(`  • 거래량 급감: ${wd.volumeDrop}개`);
    if (wd.driftRemove > 0) lines.push(`  • Drift REMOVE: ${wd.driftRemove}개`);
    if (wd.corpAction > 0) lines.push(`  • Corporate Action: ${wd.corpAction}개`);
    if (wd.other > 0) lines.push(`  • 기타: ${wd.other}개`);
  } else {
    lines.push(`  • Gate 미달: ${summary.gateMisses}개 (waitDistribution 미수집)`);
    lines.push(`  • Yahoo 실패: ${summary.yahooFails}개`);
    lines.push(`  • RRR 미달: ${summary.rrrMisses}개`);
  }

  // ADR-0412 — Frozen Quote 진단 + R3 streak skip 라인 (R3 state machine 노출 *전*).
  if (summary.perSymbolSupplyInjection) {
    const s = summary.perSymbolSupplyInjection;
    lines.push('');
    lines.push('📊 <b>Per-Symbol Supply Injection</b>');
    lines.push(`  candidates: ${s.totalCandidates}`);
    lines.push(`  requested: ${s.requestedSymbols}`);
    lines.push(`  injected: ${s.injected}`);
    lines.push(`  verified: ${s.verified}`);
    lines.push(`  degraded: ${s.degraded}`);
    lines.push(`  stale: ${s.stale}`);
    lines.push(`  missing: ${s.missing}`);
    lines.push(`  unknown: ${s.unknown}`);
    lines.push(`  routerConnected: ${s.routerConnected}`);
    lines.push(`  gateContextConnected: ${s.gateContextConnected}`);
  }

  const frozenSection = formatFrozenQuoteSection(summary.frozenQuote);
  if (frozenSection) {
    lines.push(frozenSection);
  }
  const streakSkipLine = formatR3StreakSkipLine(summary.r3StreakSkipped);
  if (streakSkipLine) {
    lines.push('');
    lines.push(streakSkipLine);
  }

  // ADR-0414 — Price Integrity + Correction Overlay (Stage 1 Read-Only).
  // 진단 only — corrected 값 LIVE 매수 판단 사용 0건 (절대 원칙 #3).
  const priceIntegritySection = formatPriceIntegritySection(summary.priceIntegrity);
  if (priceIntegritySection) {
    lines.push(priceIntegritySection);
  }
  const priceCorrectionSection = formatPriceCorrectionOverlaySection(summary.priceCorrection);
  if (priceCorrectionSection) {
    lines.push(priceCorrectionSection);
  }

  // ADR-0401 — R3 Sanity state machine 결과 노출 (CLEAN 외 분기에서만).
  if (summary.r3ViolationState && summary.r3ViolationState.state !== 'CLEAN') {
    const r3 = summary.r3ViolationState;
    const stateIcon: Record<typeof r3.state, string> = {
      CLEAN: '✅',
      WARNING: '🟡',
      ELEVATED: '🟠',
      SHADOW_ONLY: '⚫️',
      HARD_BLOCK: '🚨',
    };
    lines.push('');
    lines.push(`${stateIcon[r3.state]} <b>R3 Sanity 단계 (ADR-0401):</b> ${r3.state}`);
    lines.push(
      `  • 누적 ${r3.consecutiveCount}회 / 임계 hard ${r3.profile.hardBlockAt} (regime ${r3.regime})`,
    );
    if (r3.guardReasons.length > 0) {
      lines.push(`  • guard 활성: ${r3.guardReasons.slice(0, 2).join('; ')}`);
    }
    if (r3.state === 'HARD_BLOCK') {
      lines.push('  • <code>/r3_unblock</code> 으로 해제');
    } else if (r3.state === 'SHADOW_ONLY') {
      lines.push('  • ephemeral — 다음 정상 스캔 시 자동 회복');
    }
  }

  lines.push('');
  if (summary.emptyScanReason) {
    const desc = describeEmptyScanReason(summary.emptyScanReason);
    const forensic = summary.gate1MinimumSignalForensicAdr0505;
    const supplyAvailable = forensic?.supplySemanticAvailable ?? 0;
    const supplyTotal = forensic?.totalCandidates ?? summary.candidates ?? 0;
    const supplyAvailabilityRate = supplyTotal > 0 ? supplyAvailable / supplyTotal : 0;
    if (summary.emptyScanReason === 'NO_LEADERSHIP' && supplyTotal > 0 && supplyAvailabilityRate < 0.3) {
      lines.push('💡 <b>빈스캔 원인 (ADR-0119):</b> DEGRADED_SCAN');
      lines.push(`  • 표면상 NO_LEADERSHIP이나, 수급 semantic row ${supplyAvailable}/${supplyTotal}으로 리더십 판정 신뢰도 낮음`);
      lines.push('  • leadership diagnosis confidence: LOW');
      lines.push('  • 우선 조치: Supply Semantic Row Carry 복구 필요');
    } else {
      lines.push(`💡 <b>빈스캔 원인 (ADR-0119):</b> ${summary.emptyScanReason}`);
      lines.push(`  • ${desc.label}`);
      lines.push(`  • ${desc.advice}`);
      if (supplyTotal > 0) lines.push(`  • supplySemantic availability: ${supplyAvailable}/${supplyTotal}`);
    }
  } else if (summary.entries > 0) {
    lines.push(`✅ <b>매수 발생:</b> ${summary.entries}개 (분류 대상 아님)`);
  } else {
    lines.push('💡 <b>빈스캔 원인:</b> 분류 데이터 부족 (waitDistribution 미수집)');
  }

  // ADR-0420 — Fresh Scan Blocker Attribution (GATE1_PASS_ZERO 상세) 노출.
  // gate1Pass=0 + candidates>0 시점에만 노출 (formatFreshAttributionSection 내부 필터).
  // last 7 days /gate_audit 와 *분리* (사용자 명시 핵심 불변식 #4).
  const freshSection = formatFreshAttributionSection(summary.freshConditionAttribution);
  if (freshSection) {
    lines.push('');
    lines.push(freshSection);
  }

  // ADR-0422 — Gate2 / NO_LEADERSHIP fresh attribution 노출.
  // gate1Pass>0 + gate2Pass=0 시점에만 노출 (formatGate2AttributionSection 내부 필터).
  // gate1Pass=0 시점은 ADR-0420 GATE1_PASS_ZERO 분석이 우선 (책임 분리).
  const gate2Section = formatGate2AttributionSection(summary.freshGate2Attribution);
  if (gate2Section) {
    lines.push('');
    lines.push(gate2Section);
  }

  // ADR-0505 — Gate1 Minimum Signal Forensic Audit compact section.
  // 사용자 명시 ADR-0502 의미상 후속 (INDEX SSOT 정합 0505 재할당).
  // 100-scale minimum signal score 부결 원인을 component 단위로 분해 — positive
  // starvation vs penalty accumulation 구분. ADR-0420 fresh attribution 과 *책임 분리*
  // (ADR-0420 = 조건별 status 분해 / ADR-0505 = 100점형 점수 component 분해).
  // summary 부재 또는 totalCandidates=0 시 미노출 (formatter 내부 필터, 잡음 차단).
  const gate1ForensicSection = formatGate1MinimumSignalForensicSection(
    summary.gate1MinimumSignalForensicAdr0505,
  );
  if (gate1ForensicSection) {
    lines.push('');
    lines.push(gate1ForensicSection);
  }

  // ADR-452c — Gate Score Health visibility (diagnostic-only).
  // Gate attribution 근처에 raw/available/normalized score health 를 노출한다.
  // normalizedGateScore 는 표시만 하며 live decision 에 사용하지 않는다.
  const gateScoreHealthSection = formatGateScoreHealthSection(summary.gateScoreHealth);
  if (gateScoreHealthSection) {
    lines.push('');
    lines.push(gateScoreHealthSection);
  }

  // ADR-452d — Gate near-miss buckets (diagnostic-only, executionImpact NONE).
  // DATA_BLOCKED_NEAR_MISS / PROBING / SHADOW_ONLY 는 실매수 승격 없이 운영 진단에만 노출한다.
  const gateScoreBucketSection = formatGateScoreCandidateBucketSection(summary.gateScoreCandidateBuckets);
  if (gateScoreBucketSection) {
    lines.push('');
    lines.push(gateScoreBucketSection);
  }

  // ADR-458 — Approved Gate Reclassification Dry-Run (shadow-only, executionImpact NONE).
  const gate1SurvivalSection = formatGate1SurvivalAuditSection(summary.gateLayerAudit?.gate1Survival);
  if (gate1SurvivalSection) {
    lines.push('');
    lines.push(gate1SurvivalSection);
  }
  const gate2CoverageSection = formatGate2CoverageAuditSection(summary.gateLayerAudit?.gate2Coverage);
  if (gate2CoverageSection) {
    lines.push('');
    lines.push(gate2CoverageSection);
  }

  const gateReclassificationDryRunSection = formatGateReclassificationDryRunSection(summary.gateReclassificationDryRun);
  if (gateReclassificationDryRunSection) {
    lines.push('');
    lines.push(gateReclassificationDryRunSection);
  }

  const positiveStarvationSection = formatPositiveScoreStarvationReport(summary.positiveScoreStarvation);
  if (positiveStarvationSection) {
    lines.push('');
    lines.push(positiveStarvationSection);
  }

  const scoreCeilingRepairSection = formatGate1ScoreCeilingRepairReport(summary.scoreCeilingRepair);
  if (scoreCeilingRepairSection) {
    lines.push('');
    lines.push(scoreCeilingRepairSection);
  }

  const penaltyDeduplicationSection = formatPenaltyDeduplicationReport(summary.penaltyDeduplication);
  if (penaltyDeduplicationSection) {
    lines.push('');
    lines.push(penaltyDeduplicationSection);
  }

  const riskDoubleCountSection = formatRiskDoubleCountAuditReport(summary.riskDoubleCount);
  if (riskDoubleCountSection) {
    lines.push('');
    lines.push(riskDoubleCountSection);
  }

  const finalGate1CalibrationSection = formatFinalGate1CalibrationReport(summary.finalGate1Calibration);
  if (finalGate1CalibrationSection) {
    lines.push('');
    lines.push(finalGate1CalibrationSection);
  }

  try {
    const gate1ScoringAlignmentSection = formatGate1ScoringAlignmentReport(summary.gate1ScoringAlignment);
    if (gate1ScoringAlignmentSection) {
      lines.push('');
      lines.push(gate1ScoringAlignmentSection);
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.formatGate1ScoringAlignmentReport', error: e });
  }

  try {
    const positiveSourceWiringSection = formatGate1PositiveSourceWiringReport(summary.gate1PositiveSourceWiring);
    if (positiveSourceWiringSection) {
      lines.push('');
      lines.push(positiveSourceWiringSection);
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.formatGate1PositiveSourceWiringReport', error: e });
  }

  // ADR-0423 — SectorEnergy 데이터 진실성 진단 (indexCode coverage / symmetry / fallback 분해).
  // 기존 sectorEnergyQuality 라벨만으로는 SECTOR_DATA_STALE_DOMINANT 의 *진짜 원인* 인식 불가.
  // 본 섹션은 reasons 분해 + leadershipConfidence 차단 결정 + operatorAction 안내.
  // ADR-0422 Gate2 섹션의 sectorEnergy 표시(요약) 와 *책임 분리* — 본 섹션은 *원인 분해 상세*.
  try {
    const investorFlowRouterSection = formatInvestorFlowProviderRouterAdr0477(summary.investorFlowProviderRouter);
    if (investorFlowRouterSection) {
      lines.push('');
      lines.push(investorFlowRouterSection);
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.formatInvestorFlowProviderRouterAdr0477', error: e });
  }

  try {
    const dryRunObservationSection = formatGate1DryRunObservationSummary(summary.gate1DryRunObservationLedger);
    if (dryRunObservationSection) {
      lines.push('');
      lines.push(dryRunObservationSection);
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.formatGate1DryRunObservationSummary', error: e });
  }

  const sectorEnergySection = formatSectorEnergyQualityDiagnosticSection(summary.sectorEnergyQualityDiagnostic);
  if (sectorEnergySection) {
    lines.push('');
    lines.push(sectorEnergySection);
  }

  // ADR-0425 — Gate Decision Router (hard block vs soft degrade separation).
  // 사용자 §F — Router 결과 (severity / lanes / reasons / operatorMessage) 노출.
  // Gate threshold 변경 0 — decision semantics 분리만. Shadow/Watch 학습 후보 보존.
  const routerSection = formatGateDecisionRouterSection(summary.gateDecisionRouter);
  if (routerSection) {
    lines.push('');
    lines.push(routerSection);
  }

  // ADR-0436 — Gate Eligibility Split (LIVE_ELIGIBLE vs SHADOW_OBSERVABLE).
  // 사용자 §5 — 실매수 후보 vs 학습/관측 후보 분리 표시. shadowObservableCount=undefined
  // 시 미노출 (ENV OFF 또는 ADR-0436 미작동 — 후방호환). 부재 시 진단 메시지 무영향.
  const gateEligibilitySection = formatGateEligibilitySplitSection(summary);
  if (gateEligibilitySection) {
    lines.push('');
    lines.push(gateEligibilitySection);
  }

  // ADR-0426 — R3_EARLY Provisional Shadow Lane.
  // 사용자 §E — eligible / created / topReasons / dominantLabel 노출.
  // R3_EARLY + Gate1 생존자 + SOFT_DEGRADE 시점에 학습 샘플 보존 lane.
  // LIVE 매매 본체 영향 0 — 후보 metadata 만 영속.
  const provisionalSection = formatProvisionalShadowSection(summary.provisionalShadowLane);
  if (provisionalSection) {
    lines.push('');
    lines.push(provisionalSection);
  }

  // ADR-0430 — Counterfactual Shadow Learning Lane.
  // SELL_ONLY/HARD_BLOCK 시점 학습 표본 분리 표시. ADR-0427 provisional 다음 노출.
  // 매매 정책 변경 0건 — 학습 ledger 진단만.
  if (summary.r6ShadowEntryPolicy) {
    const r6 = summary.r6ShadowEntryPolicy;
    lines.push('');
    lines.push('Shadow Learning:');
    lines.push(`  candidateEvaluated=${r6.candidateEvaluated}`);
    lines.push(`  accumulatingCandidates=${r6.accumulatingCandidates}`);
    lines.push(`  shadowBuySignals=${r6.shadowBuySignals}`);
    lines.push(`  r6CounterfactualEntries=${r6.r6CounterfactualEntries}`);
    lines.push(`  noShadowEntryReason=${r6.noShadowEntryReason ?? 'N/A'}`);
    lines.push('  liveNewBuyAllowed=false realOrderAllowed=false strongBuyAllowed=false');
    lines.push('  executionImpact=NONE');
  }

  const counterfactualSection = formatCounterfactualShadowLearningSection(
    summary.counterfactualShadowLearning,
  );
  if (counterfactualSection) {
    lines.push('');
    lines.push(counterfactualSection);
  }

  // ADR-0464 — Entry Filter Conservatism Decomposition.
  const entryFilterSection = formatEntryFilterDecompositionSection(summary.entryFilterDecomposition);
  if (entryFilterSection) {
    lines.push('');
    lines.push(entryFilterSection);
  }

  // ADR-0448 Phase 0 — R3 Noise Governor compact line.
  //   Gate1 통과 0건 시점의 cause 분류 (TRUE_GATE1_ZERO / SELL_ONLY / LUNCH_BREAK /
  //   DATA_UNAVAILABLE / SECTOR_ENERGY_DIAGNOSTIC_BLOCKED / PROVIDER_DEGRADED /
  //   SHADOW_OBSERVABLE_EXISTS / UNKNOWN) + streakImpact (0/1) + liveBlockPreserved=true.
  //   부재 시 미노출 (gate1Pass>0 또는 ENV DISABLED — 후방호환).
  if (summary.r3NoiseDecision) {
    lines.push('');
    lines.push(formatR3NoiseGovernorCompactLine(summary.r3NoiseDecision));
  }

  // ADR-0449 — Pre-Breakout WAIT 7-state compact summary.
  //   Pre-breakout WAIT 후보 분류 (retryEligible / cooldown / shadowOnly / rejected /
  //   priceTooFar / volumeWeak / gateRecheckFailed) + topReasons + failCountProtected.
  //   부재 시 미노출 (decisions 빈 배열 — 후방호환).
  if (summary.preBreakoutWaitSummary) {
    const section = formatPreBreakoutWaitSummarySection(summary.preBreakoutWaitSummary);
    if (section) {
      lines.push('');
      lines.push(section);
    }
  }

  // ADR-0452 — Shadow Near-Breakout Entry compact section.
  //   Live WAIT 후보 중 near-breakout 학습 가치가 큰 후보를 Shadow 가상 진입으로 기록한 결과.
  //   created/blocked + topBlock + executionImpact: NONE 라인.
  //   부재 또는 created+blocked=0 시 미노출 (잡음 차단 — 후방호환).
  if (
    (summary.shadowNearBreakoutCreated ?? 0) > 0 ||
    (summary.shadowNearBreakoutBlocked ?? 0) > 0
  ) {
    const section = formatShadowNearBreakoutSection({
      created: summary.shadowNearBreakoutCreated ?? 0,
      blocked: summary.shadowNearBreakoutBlocked ?? 0,
      blockReasons:
        (summary.shadowNearBreakoutBlockReasons as Partial<
          Record<ShadowNearBreakoutBlockReason, number>
        >) ?? {},
    });
    if (section) {
      lines.push('');
      lines.push(section);
    }
  }

  return lines.join('\n');
}


const GATE1_DRY_RUN_ADR_CODES = new Set([
  'ADR-0467',
  'ADR-0468',
  'ADR-0469',
  'ADR-0470',
  'ADR-0471',
  'ADR-0472',
  'ADR-0475',
  'ADR-0476',
]);
const GATE1_DRY_RUN_LUNCH_RATE_LIMIT_MS = 15 * 60 * 1000;
const gate1DryRunLogLastEmittedAt = new Map<string, number>();

export interface AdrDiagnosticPayload {
  adrCode?: string;
  dryRun?: boolean;
  engineMode?: string;
  executionImpact?: 'NONE' | string;
  liveExecutionAllowed?: boolean;
  session?: string;
  reason?: string;
  issueClass?: string;
  providerIssue?: boolean;
  marketSignal?: boolean;
  deferred?: boolean;
  [key: string]: unknown;
}

export interface AdrDiagnosticLogOptions {
  nowMs?: number;
  rateLimitMs?: number;
  recordShadowCase?: () => void;
  logger?: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
}

function currentKstSession(nowMs = Date.now()): 'LUNCH_GUARD' | 'REGULAR' {
  const kst = new Date(nowMs + 9 * 60 * 60_000);
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return minutes >= 11 * 60 + 30 && minutes < 13 * 60 ? 'LUNCH_GUARD' : 'REGULAR';
}

function adrCodeFromEvent(event: string, payload: AdrDiagnosticPayload): string {
  return payload.adrCode ?? event.match(/ADR-\d{4}/)?.[0] ?? 'ADR-UNKNOWN';
}

function normalizeAdrDiagnosticPayload(event: string, payload: AdrDiagnosticPayload): AdrDiagnosticPayload {
  const adrCode = adrCodeFromEvent(event, payload);
  const gate1Diagnostic = GATE1_DRY_RUN_ADR_CODES.has(adrCode);
  return {
    ...payload,
    adrCode,
    ...(gate1Diagnostic
      ? {
          issueClass: payload.issueClass ?? 'GATE1_DIAGNOSTIC',
          providerIssue: payload.providerIssue ?? false,
          marketSignal: payload.marketSignal ?? false,
          executionImpact: payload.executionImpact ?? 'NONE',
          deferred: payload.deferred ?? true,
        }
      : {}),
  };
}

function isNonImpactAdrDiagnostic(payload: AdrDiagnosticPayload): boolean {
  return payload.dryRun === true
    || payload.engineMode === 'SHADOW_ONLY'
    || payload.executionImpact === 'NONE'
    || payload.liveExecutionAllowed === false;
}

export function resetAdrDiagnosticLogRateLimiterForTest(): void {
  gate1DryRunLogLastEmittedAt.clear();
}

export function logAdrDiagnostic(
  event: string,
  payload: AdrDiagnosticPayload = {},
  options: AdrDiagnosticLogOptions = {},
): boolean {
  const activeLogger = options.logger ?? logger;
  const nowMs = options.nowMs ?? Date.now();
  const normalized = normalizeAdrDiagnosticPayload(event, payload);
  options.recordShadowCase?.();

  const adrCode = adrCodeFromEvent(event, normalized);
  const session = normalized.session ?? currentKstSession(nowMs);
  const reason = String(normalized.reason ?? normalized.issueClass ?? 'UNSPECIFIED');
  const nonImpact = isNonImpactAdrDiagnostic(normalized);

  if (GATE1_DRY_RUN_ADR_CODES.has(adrCode) && session === 'LUNCH_GUARD' && nonImpact) {
    const key = `${adrCode}:${session}:${reason}`;
    const rateLimitMs = options.rateLimitMs ?? GATE1_DRY_RUN_LUNCH_RATE_LIMIT_MS;
    const lastEmittedAt = gate1DryRunLogLastEmittedAt.get(key) ?? 0;
    if (lastEmittedAt > 0 && nowMs - lastEmittedAt < rateLimitMs) {
      return false;
    }
    gate1DryRunLogLastEmittedAt.set(key, nowMs);
  }

  if (nonImpact) {
    if (GATE1_DRY_RUN_ADR_CODES.has(adrCode)) {
      logNoiseDetail({
        category: 'GATE1_DIAGNOSTIC_DRY_RUN',
        message: event,
        payload: { ...normalized, session, reason },
        loggerOverride: activeLogger,
      });
      return true;
    }
    activeLogger.debug(event, { ...normalized, session, reason });
    return true;
  }

  activeLogger.warn(event, { ...normalized, session, reason });
  return true;
}




export type InvestorFlowRouterEngineMode = 'NORMAL' | 'SHADOW_ONLY' | 'SELL_ONLY' | 'OBSERVE_ONLY' | string;
export type InvestorFlowRouterConfidence = 'VERIFIED' | 'DEGRADED' | 'MISSING' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' | string;

export interface InvestorFlowRouterEmissionState {
  engineMode: InvestorFlowRouterEngineMode;
  status: string;
  signal: string;
  selectedProvider: string;
  executionImpact: 'NONE' | string;
  liveExecutionAllowed: boolean;
  confidence?: InvestorFlowRouterConfidence | null;
  previousSelectedProvider?: string | null;
  previousConfidence?: InvestorFlowRouterConfidence | null;
  providerIssue?: boolean;
  marketSignal?: boolean;
  shadowLearning?: boolean;
}

export interface InvestorFlowRouterEmissionOptions {
  nowMs?: number;
  detailTtlMs?: number;
  summaryTtlMs?: number;
  logger?: Pick<Console, 'debug' | 'info' | 'warn'>;
}

export interface InvestorFlowRouterEmissionResult {
  emitted: boolean;
  adr0477: boolean;
  observation: boolean;
  summaryEmitted: boolean;
  reasonCodes: string[];
  dedupKey: string;
  marketSignal: boolean;
  providerIssue: boolean;
  executionImpact: string;
  suppressedCount: number;
  shadowLearning: boolean;
}

const INVESTOR_FLOW_OBSERVATION_DETAIL_TTL_MS = 300 * 1000;
const INVESTOR_FLOW_OBSERVATION_SUMMARY_TTL_MS = 900 * 1000;
const investorFlowObservationLastDetailAt = new Map<string, number>();
const investorFlowObservationLastSummaryAt = new Map<string, number>();
const investorFlowObservationSuppressedCount = new Map<string, number>();
let lastInvestorFlowRouterSelectedProvider: string | null = null;
let lastInvestorFlowRouterConfidence: InvestorFlowRouterConfidence | null = null;

function normalizeInvestorFlowRouterConfidenceForEmission(confidence: InvestorFlowRouterConfidence | null | undefined): 'VERIFIED' | 'DEGRADED' | 'MISSING' | 'UNKNOWN' {
  if (confidence === 'VERIFIED' || confidence === 'HIGH' || confidence === 'MEDIUM') return 'VERIFIED';
  if (confidence === 'DEGRADED' || confidence === 'LOW') return 'DEGRADED';
  if (confidence === 'MISSING' || confidence === 'NONE') return 'MISSING';
  return 'UNKNOWN';
}

function hasInvestorFlowProviderIssueForEmission(state: InvestorFlowRouterEmissionState): boolean {
  if (state.providerIssue === true) return true;
  return new Set([
    'DEGRADED',
    'MISSING',
    'FAILED',
    'DATA_UNAVAILABLE',
    'NOT_WIRED',
    'ERROR',
    'PROVIDER_ERROR',
    'PROVIDER_EMPTY_RESPONSE',
    'CACHE_EMPTY',
    'EMPTY',
    'PARSE_ERROR',
    'PARSER_KEY_MISMATCH',
    'PARSER_FIELD_MISMATCH',
    'QUARANTINED',
  ]).has(state.status);
}

function hasInvestorFlowMarketSignalForEmission(state: InvestorFlowRouterEmissionState): boolean {
  if (state.marketSignal === true) return true;
  return state.signal === 'BULLISH' || state.signal === 'BEARISH';
}

function investorFlowRouterDedupKey(state: InvestorFlowRouterEmissionState): string {
  return `ADR-0477:${state.engineMode}:${state.status}:${state.signal}:${state.selectedProvider}:${state.executionImpact}:${state.liveExecutionAllowed}`;
}

function isNoActionInvestorFlowObservation(state: InvestorFlowRouterEmissionState): boolean {
  return state.status === 'OBSERVING'
    && state.signal === 'UNKNOWN'
    && state.executionImpact === 'NONE'
    && state.liveExecutionAllowed === false
    && (state.engineMode === 'SHADOW_ONLY' || state.engineMode === 'SELL_ONLY' || state.engineMode === 'OBSERVE_ONLY')
    && (state.selectedProvider === 'CACHE' || state.selectedProvider === 'NONE');
}

function buildInvestorFlowAdr0477ReasonCodes(state: InvestorFlowRouterEmissionState, providerIssue: boolean, marketSignal: boolean): string[] {
  const reasons: string[] = [];
  if (state.executionImpact !== 'NONE') reasons.push('ADR_0477_EXECUTION_IMPACT');
  if (marketSignal) reasons.push('ADR_0477_SIGNAL_CHANGED');
  if (providerIssue) reasons.push('ADR_0477_PROVIDER_DEGRADED');
  if (state.status === 'DEGRADED' || state.status === 'MISSING' || state.status === 'FAILED') reasons.push('ADR_0477_PROVIDER_DEGRADED');
  if (state.signal === 'BULLISH' || state.signal === 'BEARISH') reasons.push('ADR_0477_SIGNAL_CHANGED');
  if (state.previousSelectedProvider && state.previousSelectedProvider !== state.selectedProvider) reasons.push('ADR_0477_PROVIDER_CHANGED');
  const previousConfidence = normalizeInvestorFlowRouterConfidenceForEmission(state.previousConfidence);
  const confidence = normalizeInvestorFlowRouterConfidenceForEmission(state.confidence);
  if (previousConfidence === 'VERIFIED' && (confidence === 'DEGRADED' || confidence === 'MISSING')) reasons.push('ADR_0477_CONFIDENCE_DROPPED');
  if (state.liveExecutionAllowed === true && (state.signal === 'UNKNOWN' || state.selectedProvider === 'NONE')) reasons.push('ADR_0477_LIVE_EXECUTION_INCONSISTENCY');
  return Array.from(new Set(reasons));
}

export function resetInvestorFlowRouterEmissionPolicyForTest(): void {
  investorFlowObservationLastDetailAt.clear();
  investorFlowObservationLastSummaryAt.clear();
  investorFlowObservationSuppressedCount.clear();
  lastInvestorFlowRouterSelectedProvider = null;
  lastInvestorFlowRouterConfidence = null;
}

export function emitInvestorFlowRouterEventAdr0477(
  inputState: InvestorFlowRouterEmissionState,
  options: InvestorFlowRouterEmissionOptions = {},
): InvestorFlowRouterEmissionResult {
  const activeLogger = options.logger ?? logger;
  const nowMs = options.nowMs ?? Date.now();
  const previousSelectedProvider = inputState.previousSelectedProvider ?? lastInvestorFlowRouterSelectedProvider;
  const previousConfidence = inputState.previousConfidence ?? lastInvestorFlowRouterConfidence;
  const state: InvestorFlowRouterEmissionState = {
    ...inputState,
    previousSelectedProvider,
    previousConfidence,
    executionImpact: inputState.engineMode === 'SHADOW_ONLY' ? 'NONE' : inputState.executionImpact,
    shadowLearning: inputState.engineMode === 'SHADOW_ONLY' ? true : inputState.shadowLearning,
  };
  const marketSignal = hasInvestorFlowMarketSignalForEmission(state);
  const providerIssue = hasInvestorFlowProviderIssueForEmission(state);
  const dedupKey = investorFlowRouterDedupKey(state);
  lastInvestorFlowRouterSelectedProvider = state.selectedProvider;
  lastInvestorFlowRouterConfidence = state.confidence ?? null;

  if (isNoActionInvestorFlowObservation(state)) {
    const detailTtlMs = options.detailTtlMs ?? INVESTOR_FLOW_OBSERVATION_DETAIL_TTL_MS;
    const summaryTtlMs = options.summaryTtlMs ?? INVESTOR_FLOW_OBSERVATION_SUMMARY_TTL_MS;
    const lastDetailAt = investorFlowObservationLastDetailAt.get(dedupKey) ?? 0;
    const lastSummaryAt = investorFlowObservationLastSummaryAt.get(dedupKey) ?? 0;
    let emitted = false;
    let summaryEmitted = false;

    if (lastDetailAt === 0 || nowMs - lastDetailAt >= detailTtlMs) {
      investorFlowObservationLastDetailAt.set(dedupKey, nowMs);
      if (lastSummaryAt === 0) investorFlowObservationLastSummaryAt.set(dedupKey, nowMs);
      activeLogger.debug(
        `[InvestorFlowRouterObservation] ` +
        `engineMode=${state.engineMode} status=${state.status} signal=${state.signal} ` +
        `selectedProvider=${state.selectedProvider} executionImpact=NONE ` +
        `liveExecutionAllowed=false marketSignal=false providerIssue=false action=NO_ACTION_NORMAL`,
      );
      emitted = true;
    } else {
      investorFlowObservationSuppressedCount.set(dedupKey, (investorFlowObservationSuppressedCount.get(dedupKey) ?? 0) + 1);
    }

    const suppressedCount = investorFlowObservationSuppressedCount.get(dedupKey) ?? 0;
    if (suppressedCount > 0 && (lastSummaryAt === 0 || nowMs - lastSummaryAt >= summaryTtlMs)) {
      investorFlowObservationLastSummaryAt.set(dedupKey, nowMs);
      activeLogger.info(
        `[InvestorFlowRouterObservationSummary] ` +
        `suppressedCount=${suppressedCount} ` +
        `lastState=${state.engineMode}/${state.status}/${state.signal}/${state.selectedProvider} ` +
        `executionImpact=NONE marketSignal=false providerIssue=false action=NO_ACTION_NORMAL`,
      );
      investorFlowObservationSuppressedCount.set(dedupKey, 0);
      summaryEmitted = true;
      emitted = true;
    }

    return {
      emitted,
      adr0477: false,
      observation: true,
      summaryEmitted,
      reasonCodes: [],
      dedupKey,
      marketSignal: false,
      providerIssue: false,
      executionImpact: 'NONE',
      suppressedCount,
      shadowLearning: state.shadowLearning ?? false,
    };
  }

  const reasonCodes = buildInvestorFlowAdr0477ReasonCodes(state, providerIssue, marketSignal);
  if (reasonCodes.length === 0) {
    activeLogger.debug(
      `[InvestorFlowRouterObservation] ` +
      `engineMode=${state.engineMode} status=${state.status} signal=${state.signal} ` +
      `selectedProvider=${state.selectedProvider} executionImpact=${state.executionImpact} ` +
      `liveExecutionAllowed=${state.liveExecutionAllowed} marketSignal=${marketSignal} ` +
      `providerIssue=${providerIssue} action=NO_ACTION_NORMAL`,
    );
    return {
      emitted: true,
      adr0477: false,
      observation: true,
      summaryEmitted: false,
      reasonCodes: [],
      dedupKey,
      marketSignal,
      providerIssue,
      executionImpact: state.executionImpact,
      suppressedCount: 0,
      shadowLearning: state.shadowLearning ?? false,
    };
  }

  const message = `[ADR-0477] InvestorFlowProviderRouter emitted ` +
    `reasonCode=${reasonCodes.join(',')} engineMode=${state.engineMode} status=${state.status} ` +
    `signal=${state.signal} selectedProvider=${state.selectedProvider} ` +
    `executionImpact=${state.executionImpact} liveExecutionAllowed=${state.liveExecutionAllowed} ` +
    `marketSignal=${marketSignal} providerIssue=${providerIssue}`;
  if (state.executionImpact !== 'NONE' || providerIssue || state.liveExecutionAllowed === true) activeLogger.warn(message);
  else activeLogger.info(message);

  return {
    emitted: true,
    adr0477: true,
    observation: false,
    summaryEmitted: false,
    reasonCodes,
    dedupKey,
    marketSignal,
    providerIssue,
    executionImpact: state.executionImpact,
    suppressedCount: 0,
    shadowLearning: state.shadowLearning ?? false,
  };
}

export interface GateDiagnosticSummaryInput {
  session: string;
  dryRuns: number;
  candidates: number;
  deferred: number;
  executionImpact: 'NONE' | string;
}

export function formatGateDiagnosticSummary(summary: GateDiagnosticSummaryInput): string {
  return `[GateDiagnosticSummary] session=${summary.session} dryRuns=${summary.dryRuns} candidates=${summary.candidates} deferred=${summary.deferred} executionImpact=${summary.executionImpact}`;
}

export function logGateDiagnosticSummary(
  summary: GateDiagnosticSummaryInput,
  target: Pick<Console, 'info'> = logger,
): void {
  target.info(formatGateDiagnosticSummary(summary));
}

export interface PreBreakoutNoiseSummaryInput {
  scanned: number;
  wait: number;
  approaching: number;
  gateFail: number;
  ready: number;
  rejected: number;
  priceDistance?: number;
}

export function formatPreBreakoutNoiseSummary(summary: PreBreakoutNoiseSummaryInput): string {
  const priceDistance = summary.priceDistance === undefined ? '' : ` priceDistance=${summary.priceDistance}`;
  return `[PreBreakoutSummary] scanned=${summary.scanned} wait=${summary.wait} approaching=${summary.approaching} gateFail=${summary.gateFail} ready=${summary.ready} rejected=${summary.rejected}${priceDistance}`;
}

export function logPreBreakoutNoiseSummary(
  summary: PreBreakoutNoiseSummaryInput,
  logger: Pick<Console, 'info'> = console,
): void {
  logger.info(formatPreBreakoutNoiseSummary(summary));
}
export interface PersistScanResultsOptions {
  sellOnly?: boolean;
  buyListLength: number;
  intradayBuyListLength: number;
  swingListLength: number;
  catalystListLength: number;
  momentumListLength: number;
  perSymbolSupplyInjection?: PerSymbolSupplyInjectionStats;
  candidateSnapshots?: CandidateSnapshot[];
  watchlistRefreshedAt?: string;
  watchlistSource?: string;
  macroGateState?: MacroGateState;
  scanEvaluation?: ScanEvaluationResult;
  candidateScanTrigger?: ShadowCandidateScanTrigger;
  sectorEnergyQuality?: 'OK' | 'PARTIAL' | 'STALE' | 'DEGRADED' | 'FAILED';
  validSectorCount?: number;
  sectorEnergyReasons?: string[];
  /**
   * ADR-0401 — R3 Sanity state machine 의 marketDataFreshness 입력 (옵셔널).
   * 부재 시 'FRESH' 가정 (정상 운영 시 기본 — guards 무영향).
   */
  marketDataFreshness?: 'FRESH' | 'STALE' | 'EXPIRED';
  /**
   * ADR-0401 — volumeClock 진입 허용 여부 (옵셔널).
   * 부재 시 true 가정 (preflight non-abort 경로 도달 = 정상 시간대 추론).
   */
  volumeClockAllowsEntry?: boolean;
  /**
   * ADR-0412 — Frozen Quote Detector 결과 (옵셔널).
   * 호출자 (signalScanner/index.ts) 가 후보 평가 후 합성하여 전달.
   * 부재 시 ScanSummary.frozenQuote 미영속 + R3 guard `frozenQuoteDataQuality=undefined`.
   */
  frozenQuote?: FrozenQuoteResult;
  /**
   * ADR-0423 — SectorEnergy 데이터 진실성 진단 (옵셔널, 후방호환).
   * 호출자 (signalScanner/index.ts 또는 sectorEnergyProvider build site) 가 합성하여 전달.
   * 부재 시 ScanSummary.sectorEnergyQualityDiagnostic 미영속 — 기존 sectorEnergyQuality 라벨만 영속.
   */
  sectorEnergyQualityDiagnostic?: SectorEnergyQualityDiagnostic;
  /**
   * ADR-0412 — R3 streak +1 skip 결정 (옵셔널).
   * 호출자가 `evaluateStreakIncrementAllowed` 결과 그대로 전달.
   * `skipped=true` 시 R3 state machine 분기에서 streak 갱신 호출 자체 skip
   * (영속 무영향 + 24h decay 보존).
   */
  r3StreakSkipped?: { skipped: boolean; reason?: StreakSkipReason };
  /**
   * ADR-0505 — Gate1 Minimum Signal Forensic Audit 입력 (옵셔널, 후방호환).
   *
   * 호출자 (signalScanner/index.ts 또는 entryFilterDecomposition) 가 후보 평가
   * 시 buildMinimumSignalScoreTrace 결과 + 부수 메타 (candidate entry trace /
   * supplyProviderHealth / kisFlow / sectorEnergyImpact) 를 모아 전달.
   *
   * 부재 시 ScanSummary.gate1MinimumSignalForensicAdr0505 미영속 — 기존 ADR-0466
   * positiveScoreStarvation 보고만 유지 (회귀 안전).
   *
   * 본 PR 단계는 dead-code wiring — 호출자 측 입력 collector 는 후속 PR (Phase 1
   * 정합). ENV `GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED=true` 1줄 우회.
   */
  gate1ForensicInputs?: ReadonlyArray<{
    trace: import('./minimumSignalScoreTrace.js').MinimumSignalScoreTrace;
    candidate?: import('./entryFilterDecomposition.js').CandidateEntryTrace;
    supplyProviderHealth?: Partial<
      import('./entryFilterDecomposition.js').SupplyProviderHealthTrace
    >;
    supplyConfluence?: import('./entryFilterDecomposition.js').SupplyConfluenceState;
    kisFlow?: {
      symbol?: string | null;
      foreignNetBuy?: number | null;
      institutionalNetBuy?: number | null;
      programNetBuy?: number | null;
      semanticAvailable?: boolean;
    };
    quoteSymbol?: string | null;
    sectorEnergyImpact?: import(
      '../../clients/sectorEnergyExecutionImpact.js'
    ).SectorEnergyExecutionImpactResult;
  }>;
}

export async function persistScanResults(
  counters: ScanCounters,
  options: PersistScanResultsOptions,
): Promise<void> {
  // ADR-0366: sellOnly 시간대에도 scan summary는 반드시 저장한다.
  // 매수 trace 영속/침묵 알림/R3 sanity side-effect만 sellOnly에서 생략한다.
  if (!options.sellOnly && counters.pendingTraces.length > 0) {
    appendScanTraces(counters.pendingTraces);
  }

  const kstNow = new Date(Date.now() + 9 * 3_600_000);
  const timeLabel = kstNow.toISOString().slice(11, 16) + ' KST';
  const totalCandidates = options.buyListLength + options.intradayBuyListLength;
  const gateLayerAudit = buildGateLayerAuditSummary(counters);
  const scanEvaluation = options.scanEvaluation ?? buildScanEvaluationResult({
    asOf: kstNow.toISOString(),
    counters,
    totalCandidates,
    sellOnly: options.sellOnly,
    marketSessionState: options.macroGateState?.sellOnlyMode ? 'SELL_ONLY' : 'BUY_ALLOWED',
    engineMode: options.macroGateState?.engineMode,
    effectiveRegime: options.macroGateState?.macroRegimeEffective ?? options.macroGateState?.regime,
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
  const summaryDraft: ScanSummary = {
    time: timeLabel,
    candidates: totalCandidates,
    trackB: options.buyListLength,
    swing: options.swingListLength,
    catalyst: options.catalystListLength,
    momentum: options.momentumListLength,
    yahooFails: counters.yahooFails,
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
    positiveScoreStarvation: buildPositiveScoreStarvationReport({
      traces: counters.positiveScoreStarvationTraces,
      timestamp: kstNow.toISOString(),
      forDate: kstNow.toISOString().slice(0, 10),
      regime: options.macroGateState?.regime ?? 'UNKNOWN',
      marketSession: options.macroGateState?.sellOnlyMode ? 'SELL_ONLY' : 'BUY_ALLOWED',
    }),
  };

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
          sellOnly: macroGate.sellOnlyMode || options.sellOnly,
          r4Neutral: r4LiveEntryBlocked,
          r5Caution: r5LiveEntryBlocked,
          r6Defense: macroGate.bearDefenseMode || macroGate.regime === 'R6_DEFENSE',
          vixBlock: macroGate.vixGatingActive,
          fomcBlock: macroGate.fomcPhase === 'DAY',
        }
      : { sellOnly: options.sellOnly },
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
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.buildEntryFilterDecomposition', error: e });
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
        marketSession: options.macroGateState?.sellOnlyMode ? 'SELL_ONLY' : 'BUY_ALLOWED',
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
      marketSession: options.macroGateState?.sellOnlyMode ? 'SELL_ONLY' : 'BUY_ALLOWED',
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
      marketSession: options.macroGateState?.sellOnlyMode ? 'SELL_ONLY' : 'BUY_ALLOWED',
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
      marketSession: macro?.sellOnlyMode ? 'SELL_ONLY' : 'BUY_ALLOWED',
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
      marketSession: macro?.sellOnlyMode ? 'SELL_ONLY' : 'BUY_ALLOWED',
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
      marketSession: macro?.sellOnlyMode ? 'SELL_ONLY' : 'BUY_ALLOWED',
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
      marketSession: macro?.sellOnlyMode ? 'SELL_ONLY' : 'BUY_ALLOWED',
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
    const sellOnlyOrClosed = options.macroGateState?.sellOnlyMode ?? options.sellOnly ?? false;
    const supplySnapshotCacheLookupAdr0491 = readLatestSupplySnapshotBySymbolSourceDomainAdr0491({
      symbol: firstSymbol,
      source: 'NAVER_INVESTOR_TREND',
      domain: 'SUPPLY',
      tradingDate: todayKst,
    });
    const cacheRaw = supplySnapshotCacheLookupAdr0491.cacheRaw;
    const krxTradeDate = compactTradingDateAdr0505(previousTradingDateCandidate);
    let previousTradingDayKrxRaw: Record<string, unknown> | null = null;
    let krxSemanticInputAdr0482: SemanticNetBuyInputPoint | null = null;
    let krxInvestorDiagnosticAdr0505: InvestorFlowProviderRouterInput['krxInvestorDiagnosticAdr0505'] = null;
    try {
      const krxInvestorRows = await fetchInvestorTrading(krxTradeDate, { symbol: firstSymbol });
      krxInvestorDiagnosticAdr0505 = krxDiagnosticToRouterInputAdr0505(
        getLastKrxInvestorTradingDiagnostic(krxTradeDate),
        previousTradingDateCandidate,
      );
      const normalizedFirstSymbol = normalizeSymbolCodeAdr0505(firstSymbol);
      const krxHit = krxInvestorRows.find((row) => normalizeSymbolCodeAdr0505(row.code) === normalizedFirstSymbol) ?? null;
      if (krxHit) {
        previousTradingDayKrxRaw = krxInvestorRowToRouterRawAdr0505({
          row: krxHit,
          sourceDate: previousTradingDateCandidate,
          status: 'STALE',
        });
        krxSemanticInputAdr0482 = krxInvestorRowToSemanticInputAdr0482({
          row: krxHit,
          sourceDate: previousTradingDateCandidate,
          status: 'STALE',
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
        previousTradingDateCandidate,
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
        summary: `KRX_SYMBOL_INVESTOR_FLOW fetch failed for previousTradingDateCandidate=${previousTradingDateCandidate}; error=${error instanceof Error ? error.message : String(error)}`,
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
      engineMode: options.macroGateState?.sellOnlyMode || options.sellOnly ? 'SELL_ONLY' : investorFlowProviderRouter.policyPromotionMode,
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
    const rows = buildGate1DryRunObservationRows({
      now: kstNow,
      forDate: kstNow.toISOString().slice(0, 10),
      candidateSnapshots: observationSnapshots,
      finalGate1Calibration: summaryDraft.finalGate1Calibration,
      gate1PositiveSourceWiring: summaryDraft.gate1PositiveSourceWiring,
      investorFlowProviderRouter: summaryDraft.investorFlowProviderRouter,
      naverInvestorTrendAdr0481: summaryDraft.naverInvestorTrendAdr0481,
      semanticNetBuyNormalizationAdr0482: summaryDraft.semanticNetBuyNormalizationAdr0482,
      sellOnly: options.macroGateState?.sellOnlyMode ?? options.sellOnly ?? false,
      sectorEnergyDiagnosticOnly: options.sectorEnergyQuality !== undefined && options.sectorEnergyQuality !== 'OK',
      providerIssue: observationSnapshots.some((item) => item.supplyProviderHealth?.providerIssue === true),
      marketSignal: observationSnapshots.some((item) => item.supplyProviderHealth?.marketSignal === true),
    });
    await saveGate1DryRunObservationRows(rows);
    summaryDraft.gate1DryRunObservationLedger = summarizeGate1DryRunObservationRows(rows, rows.length);
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
      session: options.macroGateState?.sellOnlyMode || options.sellOnly ? 'SELL_ONLY' : 'REGULAR',
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
    summaryDraft.sectorEnergySupplyUnknownAdr0488 = buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({
      generatedAt: kstNow.toISOString(),
      sectorEnergyDiagnosticAdr0474: summaryDraft.sectorEnergyQualityDiagnostic as unknown as Record<string, unknown> | null,
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
    await saveGate1DryRunObservationRows(buildGate1DryRunObservationRows({
      now: kstNow,
      forDate: kstNow.toISOString().slice(0, 10),
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
    const effectiveForensicInputs =
      options.gate1ForensicInputs && options.gate1ForensicInputs.length > 0
        ? options.gate1ForensicInputs
        : collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({
            gate1CandidateTraces: summaryDraft.entryFilterDecomposition?.gate1CandidateTraces,
            candidateTraces: summaryDraft.entryFilterDecomposition?.candidateTraces,
            supplyProviderHealth: summaryDraft.entryFilterDecomposition?.supplyProviderHealth,
            supplyRouterResult: summaryDraft.investorFlowProviderRouter,
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
        sellOnlyMode: summaryDraft.macroGateState?.sellOnlyMode === true,
        orderBlocked: (((summaryDraft.waitDistribution as Record<string, number> | undefined)?.orderBlocked ?? 0) > 0),
      });
      if (forensicSummary.evaluationState === 'NOT_EVALUATED_SELL_ONLY') {
        forensicSummary.sourcePathDistribution = {
          ...(forensicSummary.sourcePathDistribution ?? {}),
          ENTRY_FILTER_GATE1_CANDIDATE_TRACE: 0,
          ENTRY_FILTER_CANDIDATE_TRACE: 0,
          WATCHLIST_CANDIDATE: 0,
          PREFLIGHT_UNIVERSE_SNAPSHOT: 0,
          SELL_ONLY_DIAGNOSTIC_SNAPSHOT: forensicSummary.totalCandidates,
          UNKNOWN: 0,
        };
      }
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
  try {
    const rootCauseInputs: Array<{ source: 'SCAN_BLOCKER'; reason: string | null; message?: string; count?: number }> = [];
    if (summaryDraft.emptyScanReason) {
      rootCauseInputs.push({ source: 'SCAN_BLOCKER', reason: summaryDraft.emptyScanReason, message: describeEmptyScanReason(summaryDraft.emptyScanReason).label });
    }
    if (summaryDraft.macroGateState?.sellOnlyMode) rootCauseInputs.push({ source: 'SCAN_BLOCKER', reason: 'SELL_ONLY', count: 1 });
    if (summaryDraft.macroGateState?.bearDefenseMode || summaryDraft.macroGateState?.vixGatingActive || summaryDraft.macroGateState?.mhsBelow30) {
      rootCauseInputs.push({ source: 'SCAN_BLOCKER', reason: 'MACRO_RISK_OFF', count: 1 });
    }
    if (summaryDraft.waitDistribution?.sizingBlocked) rootCauseInputs.push({ source: 'SCAN_BLOCKER', reason: 'SIZING', count: summaryDraft.waitDistribution.sizingBlocked });
    if (summaryDraft.waitDistribution?.gateFail) rootCauseInputs.push({ source: 'SCAN_BLOCKER', reason: 'THRESHOLD', count: summaryDraft.waitDistribution.gateFail });
    if (summaryDraft.yahooFails > 0) rootCauseInputs.push({ source: 'SCAN_BLOCKER', reason: 'PROVIDER_ERROR', count: summaryDraft.yahooFails });
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

  _lastScanSummary = summaryDraft;
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

  logNoiseSummary({ session: options.macroGateState?.sellOnlyMode || options.sellOnly ? 'SELL_ONLY' : 'REGULAR', executionImpact: 'NONE' });

  if (options.sellOnly) {
    // sellOnly는 매수 금지 운영 상태일 뿐, /scan_blockers 진단 데이터는 유지한다.
    return;
  }

  if (counters.entries === 0 && _lastScanSummary.candidates > 0) {
    _consecutiveZeroScans++;
  } else {
    _consecutiveZeroScans = 0;
  }

  if (_consecutiveZeroScans >= 3) {
    _consecutiveZeroScans = 0;
    await sendTelegramAlert(
      `📊 <b>[스캔 요약]</b> ${timeLabel}\n` +
      `총 후보: ${_lastScanSummary.candidates}개 | SWING: ${_lastScanSummary.swing}개 | CATALYST: ${_lastScanSummary.catalyst}개 | MOMENTUM: ${_lastScanSummary.momentum}개\n` +
      `- Yahoo 실패: ${counters.yahooFails}개 → 진입 보류\n` +
      `- Gate 미달: ${counters.gateMisses}개\n` +
      `- RRR 미달: ${counters.rrrMisses}개\n` +
      `- 진입 성공: 0개\n` +
      `⚠️ 3회 연속 진입 없음 — 파이프라인 점검 필요`,
      {
        category: 'scan_empty',
        noiseEvent: {
          eventType: 'SCAN_EMPTY',
          channel: 'CH4_JOURNAL',
          consecutiveFailures: 3,
          executionImpact: 'NONE',
          dedupeHint: 'zero_entry_scan',
        },
      },
    ).catch(console.error);
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

/**
 * ADR-0401 — 5단계 state 별 메시지 빌더 SSOT.
 * 본문은 ADR-0120 의 r3SanityCheck 메시지 그대로 + state 헤더 + 누적 count + guard 사유.
 */
function formatR3StateMessage(state: R3ViolationStateResult, baseMessage: string): string {
  const stateHeader: Record<R3ViolationStateResult['state'], string> = {
    CLEAN: '✅ <b>[R3 Sanity — CLEAN]</b>',
    WARNING: '🟡 <b>[R3 Sanity — WARNING]</b>',
    ELEVATED: '🟠 <b>[R3 Sanity — ELEVATED]</b>',
    SHADOW_ONLY: '⚫️ <b>[R3 Sanity — SHADOW_ONLY (신규 진입 차단, 학습 유지)]</b>',
    HARD_BLOCK: '🚨 <b>[R3 Sanity — HARD_BLOCK (영속 latch 활성)]</b>',
  };
  const lines: string[] = [];
  lines.push(stateHeader[state.state]);
  lines.push(
    `누적 ${state.consecutiveCount}회 (임계: warning ${state.profile.warningAt}/elevated ${state.profile.elevatedAt}/` +
      `shadow ${state.profile.shadowOnlyAt}/hard ${state.profile.hardBlockAt}, regime=${state.regime})`,
  );
  if (state.guardReasons.length > 0) {
    lines.push(`hardBlock guards 활성: ${state.guardReasons.slice(0, 3).join('; ')}`);
  }
  lines.push('');
  lines.push(baseMessage);
  if (state.state === 'HARD_BLOCK') {
    lines.push('');
    lines.push('해제: <code>/r3_unblock</code> (텔레그램, ADR-0195) 또는 ENV ACK (ADR-0120)');
  } else if (state.state === 'SHADOW_ONLY') {
    lines.push('');
    lines.push('<i>다음 정상 스캔 (위반 없음 또는 24h decay) 시 자동 회복 — 영속 latch 없음 (ADR-0401).</i>');
  }
  return lines.join('\n');
}

// ─── ADR-0118 §"진단 추정" 확장 — TECHNICAL_PROVIDER_DEGRADED 운영자 노출 ───
/**
 * ADR-0411 의 Yahoo↔KIS 괴리 KIS recovery 종목 마커 (`technicalProviderDegraded=true`)
 * 를 운영자가 `/scan_blockers` 1 명령으로 즉시 인지하도록 표면화. 시계열 evaluator
 * 14개 PROVIDER_DEGRADED 강등 → score=0 자연 진입 차단 상태 가시화.
 *
 * ENV `SCAN_BLOCKERS_PROVIDER_DEGRADED_DISABLED=true` 시 섹션 미노출 (default ON).
 * ADR-0157 정확 비교 의무 정합.
 */
const TECHNICAL_PROVIDER_DEGRADED_TOP_N = 5;

export function isScanBlockersProviderDegradedDisabled(): boolean {
  return process.env.SCAN_BLOCKERS_PROVIDER_DEGRADED_DISABLED === 'true';
}

function formatKstHm(iso: string | undefined): string | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  const kst = new Date(ts + 9 * 3_600_000);
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mm = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * TECHNICAL_PROVIDER_DEGRADED 종목 섹션 SSOT 빌더.
 *
 * 입력: WatchlistEntry 배열 (호출자 책임 — `loadWatchlist()` 결과 그대로).
 * 출력: 섹션 string 또는 null.
 *
 * null 반환 조건:
 *   - ENV `SCAN_BLOCKERS_PROVIDER_DEGRADED_DISABLED=true`
 *   - degraded 종목 0건
 *
 * 정렬: `technicalProviderDegradedAt` 내림차순 (최신 먼저), 부재 시 `addedAt` fallback,
 * 잘못된 ISO 도 안전 fallback (정렬 후순위).
 *
 * Top N 기본 5, 초과 시 "외 M개" 라벨.
 */
export function formatTechnicalProviderDegradedSection(
  entries: ReadonlyArray<WatchlistEntry>,
  options: { topN?: number } = {},
): string | null {
  if (isScanBlockersProviderDegradedDisabled()) return null;

  const degraded = entries.filter((e) => e.technicalProviderDegraded === true);
  if (degraded.length === 0) return null;

  const topN = Math.max(1, options.topN ?? TECHNICAL_PROVIDER_DEGRADED_TOP_N);

  const sorted = [...degraded].sort((a, b) => {
    const aIso = a.technicalProviderDegradedAt ?? a.addedAt;
    const bIso = b.technicalProviderDegradedAt ?? b.addedAt;
    const aTs = Date.parse(aIso);
    const bTs = Date.parse(bIso);
    const aValid = Number.isFinite(aTs);
    const bValid = Number.isFinite(bTs);
    if (!aValid && !bValid) return 0;
    if (!aValid) return 1; // invalid → after valid
    if (!bValid) return -1;
    return bTs - aTs; // desc
  });

  const shown = sorted.slice(0, topN);
  const remaining = degraded.length - shown.length;

  const lines: string[] = [];
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━');
  lines.push('⚠️ <b>[기술 데이터 PROVIDER_DEGRADED]</b>');
  lines.push('Yahoo↔KIS 괴리로 시계열 evaluator 강등 (ADR-0411)');
  lines.push('');
  lines.push(`대상 ${degraded.length}개${remaining > 0 ? ` — Top ${topN}` : ''}:`);
  for (const entry of shown) {
    const tsLabel = formatKstHm(entry.technicalProviderDegradedAt);
    lines.push(`  • ${entry.code} ${entry.name}${tsLabel ? ` (${tsLabel} KST)` : ''}`);
  }
  if (remaining > 0) {
    lines.push(`  • 외 ${remaining}개`);
  }
  lines.push('');
  lines.push('영향:');
  lines.push('  • 신규 진입 자연 차단 (시계열 evaluator score=0)');
  lines.push('  • 학습 데이터 계속 수집');
  lines.push('  • WATCHLIST_HOLD — universe 보존');

  return lines.join('\n');
}

// ─── ADR-0412 — Frozen Quote Detector + R3 Streak Skip 표시 ───
/**
 * Frozen Quote 섹션 SSOT 빌더 — `/scan_blockers` 메시지 추가용.
 *
 * dataQuality === 'OK' 시 null (간결성 — 정상 시 미노출).
 * 사용자 명시 정책:
 *   - "매수 차단" 표현 금지 (frozen quote 는 데이터 품질 진단, 매수 차단 아님)
 *   - "결함" / "에러" 표현 금지 — "데이터 품질 문제" 로 분류
 */
export function formatFrozenQuoteSection(fq: FrozenQuoteResult | undefined | null): string | null {
  if (!fq) return null;
  if (fq.dataQuality === 'OK') return null;

  const icon = fq.dataQuality === 'STALE' ? '🔴' : '🟠';
  const label = fq.dataQuality === 'STALE' ? 'STALE' : 'SUSPECT';
  const ratioPct = (fq.frozenRatio * 100).toFixed(1);
  const lines: string[] = [];
  lines.push('');
  lines.push(`${icon} <b>[Frozen Quote — 데이터 품질 진단]</b>`);
  lines.push(
    `  • dataQuality: <b>${label}</b> (${ratioPct}%, ${fq.frozenCount}/${fq.comparableCount} 종목)`,
  );
  lines.push(`  • 사유: ${fq.reason}`);
  if (fq.symbols.length > 0) {
    lines.push(`  • 영향 종목: ${fq.symbols.slice(0, 5).join(', ')}${fq.symbols.length > 5 ? ` 외 ${fq.symbols.length - 5}개` : ''}`);
  }
  lines.push('');
  lines.push('영향 (ADR-0412):');
  lines.push('  • R3 hard block 누적 제외 (입력 데이터 오염 — guard 활성)');
  lines.push('  • Shadow learning 유지 — 학습 데이터 보존');
  lines.push('  • <i>가격 데이터 품질 문제 — 다음 스캔 시 자동 회복 가능</i>');

  return lines.join('\n');
}

/**
 * R3 Streak Skip 라인 빌더 — `/scan_blockers` 메시지 추가용.
 *
 * `skipped=false` 시 null (정상 누적 — 미노출).
 * 사용자 명시:
 *   - "R3 hard block 누적 제외" 표현 사용 (매수 차단 아님)
 */
export function formatR3StreakSkipLine(skip: { skipped: boolean; reason?: string } | undefined | null): string | null {
  if (!skip || !skip.skipped) return null;

  const reasonLabels: Record<string, string> = {
    KRX_NON_TRADING_DAY: 'KRX_NON_TRADING_DAY (휴장일/주말)',
    VOLUME_CLOCK_CLOSED: 'VOLUME_CLOCK_CLOSED (점심·장외 시간대)',
    EMERGENCY_STOP: 'EMERGENCY_STOP (운영자 비상정지)',
    MANUAL_BLOCK_NEW_BUY: 'MANUAL_BLOCK_NEW_BUY (운영자 수동 가드)',
    SELL_ONLY_MODE: 'SELL_ONLY_MODE (운영자 정책 차단)',
    R6_DEFENSE_REGIME: 'R6_DEFENSE_REGIME (블랙스완 방어)',
    VIX_BLOCK: 'VIX_BLOCK (VIX 게이팅)',
    FOMC_BLOCK: 'FOMC_BLOCK (FOMC 게이팅)',
    BLOCKED_DAY_SCAN: 'BLOCKED_DAY_SCAN (거시 게이트)',
    DATA_STARVED_SCAN: 'DATA_STARVED_SCAN (MTAS/DART 결손)',
    FROZEN_QUOTE_STALE: 'FROZEN_QUOTE_STALE (입력 데이터 오염)',
  };
  const label = skip.reason ? (reasonLabels[skip.reason] ?? skip.reason) : '미상';

  return `⏸ <b>[R3 Streak]</b> R3 hard block 누적 제외 — ${label} (ADR-0412/0419)`;
}

// ─── ADR-0414 — Price Integrity Checker + Correction Overlay (Stage 1 Read-Only) ───
/**
 * Price Integrity 섹션 SSOT 빌더 — `/scan_blockers` 메시지 추가용 (Stage 1 Read-Only).
 *
 * 모든 status === 'OK' 시 null (간결성 — 정상 시 미노출).
 *
 * 사용자 명시 정책:
 *   - "매수 차단" 표현 **금지** — Stage 1 Read-Only, 진단 only.
 *   - "결함" / "에러" 표현 **금지** — "데이터 품질 문제" (ADR-0412 정합).
 *   - Stage 1 표기 — "관측 + 검증" 명시.
 */
export function formatPriceIntegritySection(
  pi:
    | {
        totalSamples: number;
        statusCounts: Record<PriceIntegrityStatus, number>;
        topAffected: Array<{ symbol: string; status: PriceIntegrityStatus }>;
      }
    | undefined
    | null,
): string | null {
  if (!pi) return null;
  if (pi.totalSamples <= 0) return null;
  // OK 외 status 카운트 합산 — 모두 0 시 미노출
  const affectedTotal =
    (pi.statusCounts.SUSPECT ?? 0) +
    (pi.statusCounts.STALE ?? 0) +
    (pi.statusCounts.FROZEN_QUOTE ?? 0) +
    (pi.statusCounts.PRICE_BASE_MISMATCH ?? 0) +
    (pi.statusCounts.REVERSE_GAP_SUSPECT ?? 0) +
    (pi.statusCounts.FAILED ?? 0);
  if (affectedTotal === 0) return null;

  const lines: string[] = [];
  lines.push('');
  lines.push('🔍 <b>[Price Integrity — Stage 1 관측]</b>');
  lines.push(
    `  • 표본 ${pi.totalSamples}개 / 영향 ${affectedTotal}개 (OK 외)`,
  );
  // 분포 상위 표기 — 0건 status 미노출
  const orderedStatuses: ReadonlyArray<PriceIntegrityStatus> = [
    'PRICE_BASE_MISMATCH',
    'STALE',
    'REVERSE_GAP_SUSPECT',
    'SUSPECT',
    'FROZEN_QUOTE',
    'FAILED',
  ];
  for (const s of orderedStatuses) {
    const c = pi.statusCounts[s] ?? 0;
    if (c > 0) {
      lines.push(`  • ${s}: ${c}개`);
    }
  }
  if (pi.topAffected.length > 0) {
    const top = pi.topAffected.slice(0, 5);
    const top5 = top.map((t) => `${t.symbol}(${t.status})`).join(', ');
    const remain = pi.topAffected.length - top.length;
    lines.push(
      `  • 영향 종목 Top: ${top5}${remain > 0 ? ` 외 ${remain}개` : ''}`,
    );
  }
  lines.push('');
  lines.push('영향 (ADR-0414, Stage 1):');
  lines.push('  • 데이터 품질 진단 — 매수 차단 아님');
  lines.push('  • <i>관측 + 검증 단계 — 의사결정 변경 0건</i>');

  return lines.join('\n');
}

/**
 * Price Correction Overlay 섹션 SSOT 빌더 — `/scan_blockers` 메시지 추가용 (Stage 1 Read-Only).
 *
 * `correctionType` 분포 + averageConfidence + DROP_GAP_CALCULATION 카운트 노출.
 * `correctionType === 'NONE'` 만 있을 시 null (정상 — 미노출).
 *
 * **Stage 1 정책 명시** — corrected 값 LIVE 매수 판단 사용 0건 (절대 원칙 #3).
 */
export function formatPriceCorrectionOverlaySection(
  pc:
    | {
        totalSamples: number;
        correctionTypeCounts: Record<PriceCorrectionType, number>;
        averageConfidence: number;
        dropGapCalculationCount: number;
        shadowOnlySuggestedCount: number;
      }
    | undefined
    | null,
): string | null {
  if (!pc) return null;
  if (pc.totalSamples <= 0) return null;
  const noneCount = pc.correctionTypeCounts.NONE ?? 0;
  const totalNonNone = pc.totalSamples - noneCount;
  if (totalNonNone <= 0) return null;

  const lines: string[] = [];
  lines.push('');
  lines.push('🛠 <b>[Price Correction Overlay — Stage 1 Read-Only]</b>');
  lines.push(
    `  • 표본 ${pc.totalSamples}개 / 보정 후보 ${totalNonNone}개 (NONE 제외)`,
  );
  lines.push(
    `  • 평균 confidence: ${pc.averageConfidence.toFixed(3)}`,
  );
  // 분포 상위 표기 — 0건 type 미노출, NONE 마지막
  const orderedTypes: ReadonlyArray<PriceCorrectionType> = [
    'USE_KIS_CURRENT',
    'USE_KRX_PREV_CLOSE',
    'USE_RECENT_DAILY_CLOSE',
    'DROP_GAP_CALCULATION',
    'SHADOW_ONLY',
  ];
  for (const t of orderedTypes) {
    const c = pc.correctionTypeCounts[t] ?? 0;
    if (c > 0) {
      lines.push(`  • ${t}: ${c}개`);
    }
  }
  if (pc.dropGapCalculationCount > 0) {
    lines.push(
      `  • <i>DROP_GAP_CALCULATION ${pc.dropGapCalculationCount}건 — 사용자 명시: 틀린 gap 계산보다 gap 미사용 우월</i>`,
    );
  }
  if (pc.shadowOnlySuggestedCount > 0) {
    lines.push(
      `  • SHADOW_ONLY ${pc.shadowOnlySuggestedCount}건 — 보정 불가, Shadow learning 만`,
    );
  }
  lines.push('');
  lines.push('영향 (ADR-0414, Stage 1):');
  lines.push('  • <b>corrected 값 LIVE 매수 판단 사용 0건</b> (절대 원칙 #3)');
  lines.push('  • 관측 + 검증만 — 의사결정 변경은 Stage 2/3 후속 PR');

  return lines.join('\n');
}

// ADR-0436 — Gate Eligibility Split 진단 섹션은 별도 파일로 분리 (ADR-0133 1500줄 한계).
//   `formatGateEligibilitySplitSection` SSOT 는 server/trading/signalScanner/gateEligibilitySection.ts
//   에서 import + re-export 하여 외부 호출자 (scanBlockers.cmd 등) 무수정 호환.
