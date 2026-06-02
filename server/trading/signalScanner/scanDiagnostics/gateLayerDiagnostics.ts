// @responsibility Gate layer audit diagnostic aggregation.

import type { GateLayerSummary } from '../../../quantFilter.js';
import type { Gate2ExternalDataCoverage, Gate2SourceCoverage } from '../../../quant/gate2Diagnostics.js';
import type { ScanCounters } from './scanCounterTypes.js';
import { incrementCount, topCounts } from './gateScoreDiagnostics.js';
import {
  formatGate2CompactDiagnostic,
  formatGate2BenchmarkCompactDiagnostic,
  formatGate2DartFinancialsCompactDiagnostic,
  formatGate2KisInvestorFlowCompactDiagnostic,
  formatGate2LeaderCycleCompactDiagnostic,
  formatGate2ProgramTradeCompactDiagnostic,
  formatGate2SectorCycleCompactDiagnostic,
} from '../../../quant/gate2Diagnostics.js';
import {
  buildGate3CandidateDetail,
  groupGate3CandidateDetails,
  normalizeGate3CandidateDetailSnapshot,
  withGate3ShadowPolicy,
  type Gate3CandidateDetail,
  type Gate3CandidateDetailGroups,
} from '../../../quant/gate3CandidateDetail.js';
import {
  buildGate3ShadowPolicy,
  emptyGate3ShadowRoutingSummary,
  summarizeGate3ShadowPolicies,
  type Gate3ShadowPolicy,
  type Gate3ShadowPolicyExecutionContext,
  type Gate3ShadowRoutingSummary,
} from '../../../quant/gate3ShadowPolicy.js';
import {
  buildGate3OutcomeSeeds,
  summarizeGate3OutcomeSeeds,
  type Gate3OutcomeSeed,
  type Gate3OutcomeTrackingSummary,
} from '../../../quant/gate3OutcomeSeed.js';
import {
  buildGate3EvidenceScore,
  type Gate3EvidenceScore,
} from '../../../quant/gate3EvidenceScore.js';
import {
  buildGate3EvidenceWarmupStatus,
  type Gate3EvidenceWarmupStatus,
} from '../../../quant/gate3EvidenceWarmup.js';
import {
  buildGate3CompletionScore,
  type Gate3CompletionScore,
} from '../../../quant/gate3CompletionScore.js';
import {
  buildLiveReadinessScore,
  type LiveReadinessScore,
} from '../../../quant/liveReadinessScore.js';

export interface GateLayerAuditSummary {
  gate1PassCount: number;
  gate2PassCount: number;
  gate3PassCount: number;
  strongBuySuppressedByDataUnavailableCount: number;
  topGate1BlockReasons: Array<{ reason: string; count: number }>;
  topGate2BlockReasons: Array<{ reason: string; count: number }>;
  topGate3BlockReasons: Array<{ reason: string; count: number }>;
  gate1Survival?: Gate1SurvivalAuditSummary;
  gate2Coverage?: Gate2CoverageAuditSummary;
  gate3Consolidated?: Gate3ConsolidatedAuditSummary;
}

export interface GateDiagnosticCarrySummary {
  gate1CompactText?: string;
  gate2CompactText?: string;
  gate3CompactText?: string;
  gate1Health?: string;
  gate2Health?: string;
  gate3Health?: string;
  gate1PrimaryIssue?: string;
  gate1OperatorAction?: string;
  gate2PrimaryIssue?: string;
  gate3PrimaryIssue?: string;
  marketSignal: false;
  diagnosticOnly: true;
  source: 'consolidatedDiagnostic';
}

export interface Gate3ConsolidatedAuditSummary {
  samples: number;
  health: Record<string, number>;
  primaryIssue: Record<string, number>;
  compactText: Record<string, number>;
  timingReadiness: Record<string, number>;
  lastTriggerStatus: Record<string, number>;
  priceFreshness: Record<string, number>;
  executionImpact: Record<string, number>;
  priceConfirmationStatus: Record<string, number>;
  volumeConfirmationStatus: Record<string, number>;
  lastTriggerPassCount: number;
  lastTriggerFiredCount: number;
  lastTriggerWaitCount: number;
  lastTriggerThresholdNotMetCount: number;
  lastTriggerDataUnavailableCount: number;
  entryPriceStaleCount: number;
  rrrPassCount: number;
  rrrWatchCount: number;
  rrrFailCount: number;
  rrrMissingCount: number;
  rrrFallbackUsedCount: number;
  priceBreakoutConfirmedCount: number;
  priceNearBreakoutCount: number;
  pricePullbackEntryCount: number;
  priceNotConfirmedCount: number;
  priceOverextendedCount: number;
  volumeConfirmedCount: number;
  volumePartialCount: number;
  volumeDryUpCount: number;
  volumeWeakCount: number;
  volumeSpikeRiskCount: number;
  falseBreakoutHighCount: number;
  executionReadyCount: number;
  candidateDetails: Gate3CandidateDetail[];
  detailsByReadiness: Gate3CandidateDetailGroups;
  shadowPolicies: Gate3ShadowPolicy[];
  shadowRouting: Gate3ShadowRoutingSummary;
  outcomeSeeds: Gate3OutcomeSeed[];
  outcomeTracking: Gate3OutcomeTrackingSummary;
  thresholdEvidence?: Gate3EvidenceScore;
  evidenceWarmup?: Gate3EvidenceWarmupStatus;
  completionScore?: Gate3CompletionScore;
  liveReadinessScore?: LiveReadinessScore;
}

export interface Gate1SurvivalAuditSummary {
  samples: number;
  quoteFreshness: Record<string, number>;
  quoteCoverageConfidence: Record<string, number>;
  liquidityStatus: Record<string, number>;
  marketSession: Record<string, number>;
  shadowMode: Record<string, number>;
  shadowExecutionImpact: Record<string, number>;
  consolidatedHealth: Record<string, number>;
  consolidatedPrimaryIssue: Record<string, number>;
  consolidatedOperatorAction: Record<string, number>;
  consolidatedExecutionImpact: Record<string, number>;
  consolidatedCompactText: Record<string, number>;
  liveBuyBlockedCount: number;
  shadowAllowedCount: number;
}

export interface Gate2CoverageAuditSummary {
  samples: number;
  inputState: Record<string, number>;
  kisStatus: Record<string, number>;
  dartStatus: Record<string, number>;
  benchmarkStatus: Record<string, number>;
  programTradeStatus: Record<string, number>;
  sectorCycleStatus: Record<string, number>;
  leaderCyclePhase: Record<string, number>;
  primaryIssue: Record<string, number>;
  compactText: Record<string, number>;
  kisFlowCompactText: Record<string, number>;
  dartCompactText: Record<string, number>;
  benchmarkCompactText: Record<string, number>;
  programTradeCompactText: Record<string, number>;
  sectorCycleCompactText: Record<string, number>;
  leaderCycleCompactText: Record<string, number>;
  providerIssueCount: number;
}

export interface GateLayerAuditAccumulator {
  gate1PassCount: number;
  gate2PassCount: number;
  gate3PassCount: number;
  strongBuySuppressedByDataUnavailableCount: number;
  gate1BlockReasons: Record<string, number>;
  gate2BlockReasons: Record<string, number>;
  gate3BlockReasons: Record<string, number>;
  gate1Survival: Gate1SurvivalAuditSummary;
  gate2Coverage: Gate2CoverageAuditSummary;
  gate3Consolidated: Gate3ConsolidatedAuditSummary;
}

export interface GateLayerCandidateMeta {
  symbol?: string;
  name?: string;
  sourceSnapshotId?: string;
  asOf?: string;
}

export interface BuildGateLayerAuditSummaryOptions {
  sourceSnapshotId?: string;
  asOf?: string;
  shadowPolicyContext?: Gate3ShadowPolicyExecutionContext;
  tradeDate?: string;
  gate3SnapshotId?: string;
}

function emptyGate3CandidateGroups(): Gate3CandidateDetailGroups {
  return {
    ready: [],
    wait: [],
    blocked: [],
    dataIncomplete: [],
    detailTruncated: false,
    hiddenReadyCount: 0,
    hiddenWaitCount: 0,
    hiddenBlockedCount: 0,
    hiddenDataIncompleteCount: 0,
  };
}

export function createGateLayerAuditAccumulator(): GateLayerAuditAccumulator {
  return {
    gate1PassCount: 0,
    gate2PassCount: 0,
    gate3PassCount: 0,
    strongBuySuppressedByDataUnavailableCount: 0,
    gate1BlockReasons: {},
    gate2BlockReasons: {},
    gate3BlockReasons: {},
    gate1Survival: {
      samples: 0,
      quoteFreshness: {},
      quoteCoverageConfidence: {},
      liquidityStatus: {},
      marketSession: {},
      shadowMode: {},
      shadowExecutionImpact: {},
      consolidatedHealth: {},
      consolidatedPrimaryIssue: {},
      consolidatedOperatorAction: {},
      consolidatedExecutionImpact: {},
      consolidatedCompactText: {},
      liveBuyBlockedCount: 0,
      shadowAllowedCount: 0,
    },
    gate2Coverage: {
      samples: 0,
      inputState: {},
      kisStatus: {},
      dartStatus: {},
      benchmarkStatus: {},
      programTradeStatus: {},
      sectorCycleStatus: {},
      leaderCyclePhase: {},
      primaryIssue: {},
      compactText: {},
      kisFlowCompactText: {},
      dartCompactText: {},
      benchmarkCompactText: {},
      programTradeCompactText: {},
      sectorCycleCompactText: {},
      leaderCycleCompactText: {},
      providerIssueCount: 0,
    },
    gate3Consolidated: {
      samples: 0,
      health: {},
      primaryIssue: {},
      compactText: {},
      timingReadiness: {},
      lastTriggerStatus: {},
      priceFreshness: {},
      executionImpact: {},
      priceConfirmationStatus: {},
      volumeConfirmationStatus: {},
      lastTriggerPassCount: 0,
      lastTriggerFiredCount: 0,
      lastTriggerWaitCount: 0,
      lastTriggerThresholdNotMetCount: 0,
      lastTriggerDataUnavailableCount: 0,
      entryPriceStaleCount: 0,
      rrrPassCount: 0,
      rrrWatchCount: 0,
      rrrFailCount: 0,
      rrrMissingCount: 0,
      rrrFallbackUsedCount: 0,
      priceBreakoutConfirmedCount: 0,
      priceNearBreakoutCount: 0,
      pricePullbackEntryCount: 0,
      priceNotConfirmedCount: 0,
      priceOverextendedCount: 0,
      volumeConfirmedCount: 0,
      volumePartialCount: 0,
      volumeDryUpCount: 0,
      volumeWeakCount: 0,
      volumeSpikeRiskCount: 0,
      falseBreakoutHighCount: 0,
      executionReadyCount: 0,
      candidateDetails: [],
      detailsByReadiness: emptyGate3CandidateGroups(),
      shadowPolicies: [],
      shadowRouting: emptyGate3ShadowRoutingSummary(),
      outcomeSeeds: [],
      outcomeTracking: summarizeGate3OutcomeSeeds([]),
      thresholdEvidence: buildGate3EvidenceScore([]),
      evidenceWarmup: buildGate3EvidenceWarmupStatus([]),
    },
  };
}

export function recordLayerBlockReasons(target: Record<string, number>, layer: GateLayerSummary['gate1']): void {
  for (const key of layer.unavailable) incrementCount(target, `DATA_UNAVAILABLE:${key}`);
  for (const key of layer.providerDegraded) incrementCount(target, `PROVIDER_DEGRADED:${key}`);
  for (const key of layer.thresholdNotMet) {
    incrementCount(target, key === 'ma_alignment' ? 'TECHNICAL_TREND_DEATH' : `THRESHOLD_NOT_MET:${key}`);
  }
}

export function accumulateGateLayerSummary(
  counters: ScanCounters,
  summary: GateLayerSummary | null | undefined,
  signalType?: string,
  candidateMeta: GateLayerCandidateMeta = {},
): void {
  if (!summary) return;
  if (summary.gate1.passed) counters.gateLayerAudit.gate1PassCount += 1;
  if (summary.gate2.passed) counters.gateLayerAudit.gate2PassCount += 1;
  if (summary.gate3.passed) counters.gateLayerAudit.gate3PassCount += 1;
  recordLayerBlockReasons(counters.gateLayerAudit.gate1BlockReasons, summary.gate1);
  recordLayerBlockReasons(counters.gateLayerAudit.gate2BlockReasons, summary.gate2);
  recordLayerBlockReasons(counters.gateLayerAudit.gate3BlockReasons, summary.gate3);
  if (signalType === 'STRONG' && summary.finalPath === 'SHADOW_OBSERVABLE' && (
    summary.gate1.unavailable.length > 0 || summary.gate2.unavailable.length > 0 || summary.gate3.unavailable.length > 0
  )) {
    counters.gateLayerAudit.strongBuySuppressedByDataUnavailableCount += 1;
  }
  const survival = summary.gate1.survival;
  if (survival) {
    counters.gateLayerAudit.gate1Survival.samples += 1;
    incrementCount(counters.gateLayerAudit.gate1Survival.quoteFreshness, survival.quoteFreshness.status);
    incrementCount(counters.gateLayerAudit.gate1Survival.quoteCoverageConfidence, survival.kisOfficialQuoteCoverage.confidence);
    incrementCount(counters.gateLayerAudit.gate1Survival.liquidityStatus, survival.liquidityFloor.status);
    incrementCount(counters.gateLayerAudit.gate1Survival.marketSession, survival.marketSessionCompatibility.session);
    incrementCount(counters.gateLayerAudit.gate1Survival.shadowMode, survival.shadowEligibility.mode);
    incrementCount(counters.gateLayerAudit.gate1Survival.shadowExecutionImpact, survival.shadowEligibility.shadowExecutionImpact ?? 'NONE');
    if (!survival.marketSessionCompatibility.liveBuyAllowed) counters.gateLayerAudit.gate1Survival.liveBuyBlockedCount += 1;
    if (survival.marketSessionCompatibility.shadowAllowed || survival.shadowEligibility.allowed) counters.gateLayerAudit.gate1Survival.shadowAllowedCount += 1;
  }
  const consolidated = summary.gate1.consolidatedDiagnostic;
  if (consolidated) {
    incrementCount(counters.gateLayerAudit.gate1Survival.consolidatedHealth, consolidated.health);
    incrementCount(counters.gateLayerAudit.gate1Survival.consolidatedPrimaryIssue, consolidated.primaryIssue ?? 'none');
    incrementCount(counters.gateLayerAudit.gate1Survival.consolidatedOperatorAction, consolidated.operatorAction);
    incrementCount(counters.gateLayerAudit.gate1Survival.consolidatedExecutionImpact, consolidated.executionImpact);
    incrementCount(counters.gateLayerAudit.gate1Survival.consolidatedCompactText, consolidated.compactText);
  }
  const gate2Source = summary.gate2.sourceCoverage as Gate2SourceCoverage | undefined;
  const gate2External = summary.gate2.externalDataCoverage as Gate2ExternalDataCoverage | undefined;
  if (gate2Source && gate2External) {
    counters.gateLayerAudit.gate2Coverage.samples += 1;
    const inputState = gate2Source.allDeclaredInputsAvailable && gate2Source.allExternalDataAvailable ? 'OK' : 'DEGRADED';
    incrementCount(counters.gateLayerAudit.gate2Coverage.inputState, inputState);
    incrementCount(counters.gateLayerAudit.gate2Coverage.kisStatus, gate2External.kisInvestorFlow.status);
    incrementCount(counters.gateLayerAudit.gate2Coverage.dartStatus, gate2External.dartFinancials.status);
    incrementCount(counters.gateLayerAudit.gate2Coverage.benchmarkStatus, gate2External.benchmark.status);
    incrementCount(
      counters.gateLayerAudit.gate2Coverage.programTradeStatus,
      gate2External.programTrade.stockProgram.status !== 'STAGE_NOT_FETCHED'
        ? gate2External.programTrade.stockProgram.status
        : gate2External.programTrade.marketProgram.status,
    );
    incrementCount(counters.gateLayerAudit.gate2Coverage.sectorCycleStatus, gate2External.sectorCycle.status);
    incrementCount(counters.gateLayerAudit.gate2Coverage.leaderCyclePhase, gate2External.leaderCycle.leaderCyclePhase);
    incrementCount(counters.gateLayerAudit.gate2Coverage.primaryIssue, gate2Source.providerIssues[0] ?? gate2Source.missingExternalData[0] ?? 'none');
    const compact = formatGate2CompactDiagnostic({ sourceCoverage: gate2Source, externalDataCoverage: gate2External });
    if (compact) incrementCount(counters.gateLayerAudit.gate2Coverage.compactText, compact);
    const kisFlowCompact = formatGate2KisInvestorFlowCompactDiagnostic(gate2External);
    if (kisFlowCompact) incrementCount(counters.gateLayerAudit.gate2Coverage.kisFlowCompactText, kisFlowCompact);
    const dartCompact = formatGate2DartFinancialsCompactDiagnostic(gate2External);
    if (dartCompact) incrementCount(counters.gateLayerAudit.gate2Coverage.dartCompactText, dartCompact);
    const benchmarkCompact = formatGate2BenchmarkCompactDiagnostic(gate2External);
    if (benchmarkCompact) incrementCount(counters.gateLayerAudit.gate2Coverage.benchmarkCompactText, benchmarkCompact);
    const programTradeCompact = formatGate2ProgramTradeCompactDiagnostic(gate2External);
    if (programTradeCompact) incrementCount(counters.gateLayerAudit.gate2Coverage.programTradeCompactText, programTradeCompact);
    const sectorCycleCompact = formatGate2SectorCycleCompactDiagnostic(gate2External);
    if (sectorCycleCompact) incrementCount(counters.gateLayerAudit.gate2Coverage.sectorCycleCompactText, sectorCycleCompact);
    const leaderCycleCompact = formatGate2LeaderCycleCompactDiagnostic(gate2External);
    if (leaderCycleCompact) incrementCount(counters.gateLayerAudit.gate2Coverage.leaderCycleCompactText, leaderCycleCompact);
    if (
      gate2External.kisInvestorFlow.providerIssue
      || gate2External.dartFinancials.providerIssue
      || gate2External.benchmark.providerIssue
      || gate2External.programTrade.marketProgram.providerIssue
      || gate2External.programTrade.stockProgram.providerIssue
      || gate2External.riskFlow.providerIssue
      || gate2External.sectorCycle.providerIssue
      || gate2External.leaderCycle.providerIssue
    ) {
      counters.gateLayerAudit.gate2Coverage.providerIssueCount += 1;
    }
  }
  const gate3Consolidated = summary.gate3.consolidatedDiagnostic as Record<string, unknown> | undefined;
  if (gate3Consolidated) {
    counters.gateLayerAudit.gate3Consolidated.samples += 1;
    incrementCount(counters.gateLayerAudit.gate3Consolidated.health, String(gate3Consolidated.health ?? 'UNKNOWN'));
    incrementCount(counters.gateLayerAudit.gate3Consolidated.primaryIssue, String(gate3Consolidated.primaryIssue ?? 'none'));
    incrementCount(counters.gateLayerAudit.gate3Consolidated.timingReadiness, String(gate3Consolidated.timingReadiness ?? 'UNKNOWN'));
    const lastTrigger = gate3Consolidated.lastTrigger && typeof gate3Consolidated.lastTrigger === 'object'
      ? gate3Consolidated.lastTrigger as Record<string, unknown>
      : {};
    const entryPriceGuard = gate3Consolidated.entryPriceGuard && typeof gate3Consolidated.entryPriceGuard === 'object'
      ? gate3Consolidated.entryPriceGuard as Record<string, unknown>
      : {};
    const rrrCheck = gate3Consolidated.rrrCheck && typeof gate3Consolidated.rrrCheck === 'object'
      ? gate3Consolidated.rrrCheck as Record<string, unknown>
      : {};
    const timingAlignment = gate3Consolidated.timingAlignment && typeof gate3Consolidated.timingAlignment === 'object'
      ? gate3Consolidated.timingAlignment as Record<string, unknown>
      : {};
    const priceConfirmation = lastTrigger.priceConfirmation && typeof lastTrigger.priceConfirmation === 'object'
      ? lastTrigger.priceConfirmation as Record<string, unknown>
      : {};
    const volumeConfirmationDetail = lastTrigger.volumeConfirmationDetail && typeof lastTrigger.volumeConfirmationDetail === 'object'
      ? lastTrigger.volumeConfirmationDetail as Record<string, unknown>
      : {};
    const lastTriggerStatus = String(lastTrigger.status ?? 'UNKNOWN');
    const priceConfirmationStatus = String(priceConfirmation.status ?? timingAlignment.priceBreakout ?? 'UNKNOWN');
    const volumeConfirmationStatus = String(volumeConfirmationDetail.status ?? timingAlignment.volume ?? 'UNKNOWN');
    incrementCount(counters.gateLayerAudit.gate3Consolidated.lastTriggerStatus, lastTriggerStatus);
    incrementCount(counters.gateLayerAudit.gate3Consolidated.priceFreshness, String(entryPriceGuard.priceFreshness ?? 'UNKNOWN'));
    incrementCount(counters.gateLayerAudit.gate3Consolidated.executionImpact, String(gate3Consolidated.executionImpact ?? lastTrigger.executionImpact ?? 'UNKNOWN'));
    incrementCount(counters.gateLayerAudit.gate3Consolidated.priceConfirmationStatus, priceConfirmationStatus);
    incrementCount(counters.gateLayerAudit.gate3Consolidated.volumeConfirmationStatus, volumeConfirmationStatus);
    if (lastTrigger.fired === true || lastTriggerStatus === 'FIRED') {
      counters.gateLayerAudit.gate3Consolidated.lastTriggerPassCount += 1;
      counters.gateLayerAudit.gate3Consolidated.lastTriggerFiredCount += 1;
    } else {
      counters.gateLayerAudit.gate3Consolidated.lastTriggerWaitCount += 1;
      if (lastTriggerStatus === 'DATA_UNAVAILABLE') counters.gateLayerAudit.gate3Consolidated.lastTriggerDataUnavailableCount += 1;
      if (lastTriggerStatus === 'THRESHOLD_NOT_MET' || lastTriggerStatus === 'SANITY_REJECTED') counters.gateLayerAudit.gate3Consolidated.lastTriggerThresholdNotMetCount += 1;
    }
    if (entryPriceGuard.priceFreshness === 'STALE' || entryPriceGuard.blockReason === 'ENTRY_PRICE_STALE') counters.gateLayerAudit.gate3Consolidated.entryPriceStaleCount += 1;
    if (rrrCheck.status === 'PASS') counters.gateLayerAudit.gate3Consolidated.rrrPassCount += 1;
    if (rrrCheck.status === 'WATCH') counters.gateLayerAudit.gate3Consolidated.rrrWatchCount += 1;
    if (rrrCheck.status === 'FAIL') counters.gateLayerAudit.gate3Consolidated.rrrFailCount += 1;
    if (rrrCheck.status === 'MISSING') counters.gateLayerAudit.gate3Consolidated.rrrMissingCount += 1;
    if (rrrCheck.fallbackUsed === true || rrrCheck.source === 'FALLBACK_PERCENT') counters.gateLayerAudit.gate3Consolidated.rrrFallbackUsedCount += 1;
    if (priceConfirmationStatus === 'BREAKOUT_CONFIRMED' || priceConfirmationStatus === 'CONFIRMED') counters.gateLayerAudit.gate3Consolidated.priceBreakoutConfirmedCount += 1;
    if (priceConfirmationStatus === 'NEAR_BREAKOUT') counters.gateLayerAudit.gate3Consolidated.priceNearBreakoutCount += 1;
    if (priceConfirmationStatus === 'PULLBACK_ENTRY') counters.gateLayerAudit.gate3Consolidated.pricePullbackEntryCount += 1;
    if (priceConfirmationStatus === 'NOT_CONFIRMED') counters.gateLayerAudit.gate3Consolidated.priceNotConfirmedCount += 1;
    if (priceConfirmationStatus === 'OVEREXTENDED') counters.gateLayerAudit.gate3Consolidated.priceOverextendedCount += 1;
    if (volumeConfirmationStatus === 'CONFIRMED') counters.gateLayerAudit.gate3Consolidated.volumeConfirmedCount += 1;
    if (volumeConfirmationStatus === 'PARTIAL') counters.gateLayerAudit.gate3Consolidated.volumePartialCount += 1;
    if (volumeConfirmationStatus === 'DRY_UP') counters.gateLayerAudit.gate3Consolidated.volumeDryUpCount += 1;
    if (volumeConfirmationStatus === 'WEAK') counters.gateLayerAudit.gate3Consolidated.volumeWeakCount += 1;
    if (volumeConfirmationStatus === 'SPIKE_RISK') counters.gateLayerAudit.gate3Consolidated.volumeSpikeRiskCount += 1;
    if (gate3Consolidated.falseBreakoutRisk === 'HIGH') counters.gateLayerAudit.gate3Consolidated.falseBreakoutHighCount += 1;
    if (lastTrigger.executionReady === true) counters.gateLayerAudit.gate3Consolidated.executionReadyCount += 1;
    counters.gateLayerAudit.gate3Consolidated.candidateDetails.push(buildGate3CandidateDetail({
      symbol: candidateMeta.symbol ?? 'UNKNOWN',
      ...(candidateMeta.name ? { name: candidateMeta.name } : {}),
      sourceSnapshotId: candidateMeta.sourceSnapshotId ?? 'SOURCE_SNAPSHOT_PENDING',
      asOf: candidateMeta.asOf ?? new Date().toISOString(),
      consolidatedDiagnostic: gate3Consolidated,
    }));
    if (typeof gate3Consolidated.compactText === 'string' && gate3Consolidated.compactText.length > 0) {
      incrementCount(counters.gateLayerAudit.gate3Consolidated.compactText, gate3Consolidated.compactText);
    }
  }
}

export function buildGateLayerAuditSummary(
  counters: ScanCounters,
  options: BuildGateLayerAuditSummaryOptions = {},
): GateLayerAuditSummary {
  const survival = counters.gateLayerAudit.gate1Survival;
  const gate2Coverage = counters.gateLayerAudit.gate2Coverage;
  const gate3DetailsWithoutPolicy = counters.gateLayerAudit.gate3Consolidated.candidateDetails.map(detail =>
    normalizeGate3CandidateDetailSnapshot(detail, options),
  );
  const shadowPolicies = gate3DetailsWithoutPolicy.map(detail =>
    buildGate3ShadowPolicy(detail, options.shadowPolicyContext),
  );
  const gate3Details = gate3DetailsWithoutPolicy.map((detail, index) =>
    withGate3ShadowPolicy(detail, shadowPolicies[index]),
  );
  const outcomeSeeds = buildGate3OutcomeSeeds(gate3Details, shadowPolicies, {
    asOf: options.asOf,
    tradeDate: options.tradeDate ?? options.asOf?.slice(0, 10),
    gate3SnapshotId: options.gate3SnapshotId ?? (options.sourceSnapshotId ? `${options.sourceSnapshotId}:gate3` : undefined),
    // counterfacture_gate Phase F — ROC 레짐 stratify 용 regime stamp(gate3 evidence 와 동일 소스).
    regime: options.shadowPolicyContext?.macroRegime ?? options.shadowPolicyContext?.effectiveRegime ?? undefined,
  });
  const outcomeTracking = summarizeGate3OutcomeSeeds(outcomeSeeds, {
    tradeDate: options.tradeDate ?? options.asOf?.slice(0, 10),
    seedCreatedToday: outcomeSeeds.length,
  });
  const thresholdEvidence = buildGate3EvidenceScore(outcomeSeeds);
  const gate3Consolidated = {
    ...counters.gateLayerAudit.gate3Consolidated,
    candidateDetails: gate3Details,
    detailsByReadiness: groupGate3CandidateDetails(gate3Details),
    shadowPolicies,
    shadowRouting: summarizeGate3ShadowPolicies(shadowPolicies),
    outcomeSeeds,
    outcomeTracking,
    thresholdEvidence,
    evidenceWarmup: buildGate3EvidenceWarmupStatus(outcomeSeeds, {
      outcomeTracking,
      thresholdEvidenceSampleSize: thresholdEvidence.sampleSize,
      duplicateSuppressed: outcomeTracking.duplicateSuppressed,
      ...(options.asOf ? { now: new Date(options.asOf) } : {}),
    }),
  };
  gate3Consolidated.completionScore = buildGate3CompletionScore(gate3Consolidated, {
    sourceSnapshotId: options.sourceSnapshotId,
    gate3SourceSnapshotId: options.sourceSnapshotId,
    asOf: options.asOf,
    engineMode: options.shadowPolicyContext?.engineMode,
    macroRegime: options.shadowPolicyContext?.macroRegime ?? options.shadowPolicyContext?.effectiveRegime,
  });
  gate3Consolidated.liveReadinessScore = buildLiveReadinessScore({
    gate3Completion: gate3Consolidated.completionScore,
    policy: {
      allowsLive: options.shadowPolicyContext?.livePolicyAllowed,
      shadowOnlyMode: options.shadowPolicyContext?.shadowOnlyMode,
      sellOnlyMode: options.shadowPolicyContext?.sellOnlyMode,
      r6DefenseMode: options.shadowPolicyContext?.macroRegime === 'R6_DEFENSE'
        || options.shadowPolicyContext?.effectiveRegime === 'R6_DEFENSE'
        || options.shadowPolicyContext?.riskOverride === 'R6_DEFENSE',
      brokerLiveOrderAllowed: options.shadowPolicyContext?.brokerLiveOrderAllowed,
    },
    shadowAllowed: true,
    counterfactualAllowed: gate3Consolidated.shadowRouting.counterfactualAllowedCount === gate3Consolidated.candidateDetails.length,
  });
  return {
    gate1PassCount: counters.gateLayerAudit.gate1PassCount,
    gate2PassCount: counters.gateLayerAudit.gate2PassCount,
    gate3PassCount: counters.gateLayerAudit.gate3PassCount,
    strongBuySuppressedByDataUnavailableCount: counters.gateLayerAudit.strongBuySuppressedByDataUnavailableCount,
    topGate1BlockReasons: topCounts(counters.gateLayerAudit.gate1BlockReasons).map(({ condition, count }) => ({ reason: condition, count })),
    topGate2BlockReasons: topCounts(counters.gateLayerAudit.gate2BlockReasons).map(({ condition, count }) => ({ reason: condition, count })),
    topGate3BlockReasons: topCounts(counters.gateLayerAudit.gate3BlockReasons).map(({ condition, count }) => ({ reason: condition, count })),
    ...(survival.samples > 0 ? { gate1Survival: { ...survival } } : {}),
    ...(gate2Coverage.samples > 0 ? { gate2Coverage: { ...gate2Coverage } } : {}),
    ...(counters.gateLayerAudit.gate3Consolidated.samples > 0
      ? { gate3Consolidated }
      : {}),
  };
}

function topKey(counts: Record<string, number>): string {
  const [top] = topCounts(counts);
  return top ? `${top.condition}:${top.count}` : 'none';
}

function topLabel(counts: Record<string, number>): string {
  const [top] = topCounts(counts);
  return top ? top.condition : 'none';
}

function topCarryLabel(counts: Record<string, number> | undefined): string | undefined {
  if (!counts) return undefined;
  const top = topLabel(counts);
  return top === 'none' ? undefined : top;
}

function extractToken(text: string, key: string): string | undefined {
  const match = new RegExp(`\\b${key}=([^|\\s]+)`, 'u').exec(text);
  return match?.[1]?.trim();
}

function sanitizeGate1PolicyPollution(text: string | undefined): string | undefined {
  if (!text) return undefined;
  if (!text.includes('LIVE_BLOCKED_ONLY')) return text;
  const inputs = extractToken(text, 'inputs') ?? 'UNKNOWN';
  const quote = extractToken(text, 'quote') ?? 'UNKNOWN';
  const tradable = extractToken(text, 'tradable') ?? 'UNKNOWN';
  const liquidity = extractToken(text, 'liquidity') ?? 'UNKNOWN';
  const gateStatus = inputs === 'OK' && quote === 'VERIFIED' && tradable === 'TRADABLE' && liquidity === 'PASS'
    ? 'OK'
    : 'DATA_INCOMPLETE';
  return [
    `gateStatus=${gateStatus}`,
    'sessionAgnostic=true',
    `inputs=${inputs}`,
    `quote=${quote}`,
    `tradable=${tradable}`,
    `liquidity=${liquidity}`,
    'technicalStatus=UNKNOWN',
    'dataIssues=none',
  ].join(' | ');
}

export function buildGateDiagnosticCarrySummary(
  summary: GateLayerAuditSummary,
): GateDiagnosticCarrySummary {
  const gate1CompactText = sanitizeGate1PolicyPollution(topCarryLabel(summary.gate1Survival?.consolidatedCompactText));
  const gate2CompactText = topCarryLabel(summary.gate2Coverage?.compactText);
  const gate3CompactText = topCarryLabel(summary.gate3Consolidated?.compactText);
  const rawGate1Health = topCarryLabel(summary.gate1Survival?.consolidatedHealth);
  const gate1Health = rawGate1Health === 'BLOCKED_LIVE_ONLY' || rawGate1Health === 'LIVE_BLOCKED_ONLY'
    ? 'OK'
    : rawGate1Health;
  const gate2Health = topCarryLabel(summary.gate2Coverage?.inputState);
  const gate3Health = topCarryLabel(summary.gate3Consolidated?.health);
  const gate1PrimaryIssue = topCarryLabel(summary.gate1Survival?.consolidatedPrimaryIssue);
  const gate1OperatorAction = topCarryLabel(summary.gate1Survival?.consolidatedOperatorAction);
  const gate2PrimaryIssue = topCarryLabel(summary.gate2Coverage?.primaryIssue);
  const gate3PrimaryIssue = topCarryLabel(summary.gate3Consolidated?.primaryIssue);

  return {
    ...(gate1CompactText ? { gate1CompactText } : {}),
    ...(gate2CompactText ? { gate2CompactText } : {}),
    ...(gate3CompactText ? { gate3CompactText } : {}),
    ...(gate1Health ? { gate1Health } : {}),
    ...(gate2Health ? { gate2Health } : {}),
    ...(gate3Health ? { gate3Health } : {}),
    ...(gate1PrimaryIssue ? { gate1PrimaryIssue } : {}),
    ...(gate1OperatorAction ? { gate1OperatorAction } : {}),
    ...(gate2PrimaryIssue ? { gate2PrimaryIssue } : {}),
    ...(gate3PrimaryIssue ? { gate3PrimaryIssue } : {}),
    marketSignal: false,
    diagnosticOnly: true,
    source: 'consolidatedDiagnostic',
  };
}

export function formatGate1SurvivalAuditSection(summary: Gate1SurvivalAuditSummary | null | undefined): string | null {
  if (!summary || summary.samples <= 0) return null;
  return [
    '<b>Gate1 Survival Diagnostic</b>',
    `  samples: ${summary.samples}`,
    `  quoteFreshness: ${topKey(summary.quoteFreshness)}`,
    `  quoteCoverageConfidence: ${topKey(summary.quoteCoverageConfidence)}`,
    `  liquidityFloor: ${topKey(summary.liquidityStatus)}`,
    `  marketSession: ${topKey(summary.marketSession)}`,
    `  shadowMode: ${topKey(summary.shadowMode)}`,
    `  shadowExecutionImpact: ${topKey(summary.shadowExecutionImpact)}`,
    `  consolidatedHealth: ${topKey(summary.consolidatedHealth)}`,
    `  primaryIssue: ${topKey(summary.consolidatedPrimaryIssue)}`,
    `  operatorAction: ${topKey(summary.consolidatedOperatorAction)}`,
    `  consolidatedExecutionImpact: ${topKey(summary.consolidatedExecutionImpact)}`,
    `  compactText: ${topLabel(summary.consolidatedCompactText)}`,
    `  liveBuyBlockedOnly/advisory: ${summary.liveBuyBlockedCount}`,
    `  shadowAllowed: ${summary.shadowAllowedCount}`,
    '  executionImpact: NONE for shadow; scoringImpact: NONE',
  ].join('\n');
}

export function formatGate2CoverageAuditSection(summary: Gate2CoverageAuditSummary | null | undefined): string | null {
  if (!summary || summary.samples <= 0) return null;
  return [
    '<b>Gate2 Wiring Diagnostic</b>',
    `  samples: ${summary.samples}`,
    `  inputState: ${topKey(summary.inputState)}`,
    `  KIS: ${topKey(summary.kisStatus)}`,
    `  DART: ${topKey(summary.dartStatus)}`,
    `  Benchmark: ${topKey(summary.benchmarkStatus)}`,
    `  ProgramTrade: ${topKey(summary.programTradeStatus)}`,
    `  SectorCycle: ${topKey(summary.sectorCycleStatus)}`,
    `  LeaderCycle: ${topKey(summary.leaderCyclePhase)}`,
    `  primaryIssue: ${topKey(summary.primaryIssue)}`,
    `  providerIssueCount: ${summary.providerIssueCount}`,
    `  compactText: ${topLabel(summary.compactText)}`,
    `  kisFlow: ${topLabel(summary.kisFlowCompactText)}`,
    `  dart: ${topLabel(summary.dartCompactText)}`,
    `  benchmark: ${topLabel(summary.benchmarkCompactText)}`,
    `  programTrade: ${topLabel(summary.programTradeCompactText)}`,
    `  sectorCycle: ${topLabel(summary.sectorCycleCompactText)}`,
    `  leaderCycle: ${topLabel(summary.leaderCycleCompactText)}`,
    '  marketSignal: false; diagnosticOnly: true',
  ].join('\n');
}

export function formatGate3TimingReadinessAuditSection(summary: Gate3ConsolidatedAuditSummary | null | undefined): string | null {
  if (!summary || summary.samples <= 0) return null;
  return [
    '<b>Gate3 Timing Readiness</b>',
    `  evaluated: ${summary.samples}/${summary.samples}`,
    `  readiness: ${topKey(summary.timingReadiness)}`,
    `  lastTriggerPass: ${summary.lastTriggerPassCount}`,
    `  lastTriggerFired: ${summary.lastTriggerFiredCount}`,
    `  lastTriggerWait: ${summary.lastTriggerWaitCount}`,
    `  lastTriggerThresholdNotMet: ${summary.lastTriggerThresholdNotMetCount}`,
    `  lastTriggerDataUnavailable: ${summary.lastTriggerDataUnavailableCount}`,
    `  entryPriceFresh: ${topKey(summary.priceFreshness)}`,
    `  entryPriceStaleBlocked: ${summary.entryPriceStaleCount}`,
    `  priceBreakoutConfirmed: ${summary.priceBreakoutConfirmedCount}`,
    `  priceNearBreakout: ${summary.priceNearBreakoutCount}`,
    `  pricePullbackEntry: ${summary.pricePullbackEntryCount}`,
    `  priceNotConfirmed: ${summary.priceNotConfirmedCount}`,
    `  priceOverextended: ${summary.priceOverextendedCount}`,
    `  volumeConfirmed: ${summary.volumeConfirmedCount}`,
    `  volumePartial: ${summary.volumePartialCount}`,
    `  volumeDryUp: ${summary.volumeDryUpCount}`,
    `  volumeWeak: ${summary.volumeWeakCount}`,
    `  volumeSpikeRisk: ${summary.volumeSpikeRiskCount}`,
    `  rrrPass: ${summary.rrrPassCount}`,
    `  rrrWatch: ${summary.rrrWatchCount}`,
    `  rrrFail: ${summary.rrrFailCount}`,
    `  rrrMissing: ${summary.rrrMissingCount}`,
    `  rrrFallbackUsed: ${summary.rrrFallbackUsedCount}`,
    `  falseBreakoutHigh: ${summary.falseBreakoutHighCount}`,
    `  executionReady: ${summary.executionReadyCount}`,
    `  executionImpact: ${topKey(summary.executionImpact)}`,
    `  compactText: ${topLabel(summary.compactText)}`,
    '  marketSignal=false; shadowLearning=true; counterfactualRecorded=true',
  ].join('\n');
}
