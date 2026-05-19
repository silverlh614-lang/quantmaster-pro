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
  };
}

export function recordLayerBlockReasons(target: Record<string, number>, layer: GateLayerSummary['gate1']): void {
  for (const key of layer.unavailable) incrementCount(target, `DATA_UNAVAILABLE:${key}`);
  for (const key of layer.providerDegraded) incrementCount(target, `PROVIDER_DEGRADED:${key}`);
  for (const key of layer.thresholdNotMet) incrementCount(target, `THRESHOLD_NOT_MET:${key}`);
}

export function accumulateGateLayerSummary(
  counters: ScanCounters,
  summary: GateLayerSummary | null | undefined,
  signalType?: string,
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
}

export function buildGateLayerAuditSummary(counters: ScanCounters): GateLayerAuditSummary {
  const survival = counters.gateLayerAudit.gate1Survival;
  const gate2Coverage = counters.gateLayerAudit.gate2Coverage;
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
