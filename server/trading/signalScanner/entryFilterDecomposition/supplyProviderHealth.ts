/**
 * @responsibility ADR-0464 supply provider health classifier.
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
import type { Gate1CandidateTrace, Gate1ConditionTrace, SupplyProviderHealthTrace } from './types.js';

export function classifySupplyProviderHealth(
  input?: Partial<SupplyProviderHealthTrace>,
): SupplyProviderHealthTrace {
  const status = input?.status === "UNKNOWN" ? "MISSING" : input?.status ?? "MISSING";
  const providerIssue = input?.providerIssue ?? status !== "VERIFIED";
  const marketSignal = input?.marketSignal ?? false;
  const gate1Severity =
    input?.gate1Severity ??
    (status === "VERIFIED"
      ? "NONE"
      : "SOFT_FAIL");
  const reason =
    input?.reason ??
    (status === "NO_RECENT_SAMPLE"
      ? ["no recent investor-flow provider sample"]
      : status === "VERIFIED"
        ? ["provider verified"]
        : status === "MISSING"
          ? ["supply context missing/not injected; provider gap, not bearish"]
        : [`supply provider status=${status}`]);
  return {
    status,
    providerName: input?.providerName ?? "investor-flow",
    lastSampleAt: input?.lastSampleAt,
    ageMinutes: input?.ageMinutes,
    expectedMaxAgeMinutes: input?.expectedMaxAgeMinutes ?? 30,
    sampleCountToday: input?.sampleCountToday,
    sampleCountRecent: input?.sampleCountRecent,
    hasInstitutionFlow: input?.hasInstitutionFlow,
    hasForeignFlow: input?.hasForeignFlow,
    hasProgramFlow: input?.hasProgramFlow,
    providerIssue,
    marketSignal,
    gate1Severity,
    investorFlowRouterStatus: input?.investorFlowRouterStatus,
    selectedInvestorFlowProvider: input?.selectedInvestorFlowProvider,
    providerTried: input?.providerTried,
    requestSymbol: input?.requestSymbol,
    candidateSymbol: input?.candidateSymbol,
    quoteSymbol: input?.quoteSymbol,
    providerSymbol: input?.providerSymbol,
    normalizedSymbol: input?.normalizedSymbol,
    providerScope: input?.providerScope,
    routePurpose: input?.routePurpose,
    materialized: input?.materialized,
    usableForRouter: input?.usableForRouter,
    usableForGate: false,
    usableForLive: false,
    usableForShadow: true,
    semanticNetBuyStatus: input?.semanticNetBuyStatus,
    semanticNetBuySignal: input?.semanticNetBuySignal,
    semanticRow: input?.semanticRow,
    actualInvestorRow: input?.actualInvestorRow,
    diagnosticActualInvestorRow: input?.diagnosticActualInvestorRow,
    normalizedInvestorRow: input?.normalizedInvestorRow,
    semanticInvestorRow: input?.semanticInvestorRow,
    supplySemanticRow: input?.supplySemanticRow,
    sanitizedInvestorFlowRows: input?.sanitizedInvestorFlowRows,
    actualInvestorFlowRows: input?.actualInvestorFlowRows,
    actualInvestorFlowRowCount: input?.actualInvestorFlowRowCount,
    actualInvestorFlowRowSourcePath: input?.actualInvestorFlowRowSourcePath,
    actualInvestorFlowFieldKeys: input?.actualInvestorFlowFieldKeys,
    actualInvestorFlowNumericKeys: input?.actualInvestorFlowNumericKeys,
    actualInvestorFlowNumericStringKeys: input?.actualInvestorFlowNumericStringKeys,
    actualInvestorFlowCarried: input?.actualInvestorFlowCarried,
    selectedCandidate: input?.selectedCandidate,
    selectedActualRowPath: input?.selectedActualRowPath,
    selectedActualRowFieldKeys: input?.selectedActualRowFieldKeys,
    selectedActualNumericFieldKeys: input?.selectedActualNumericFieldKeys,
    selectedActualNumericStringFieldKeys: input?.selectedActualNumericStringFieldKeys,
    selectedActualPlaceholderFieldKeys: input?.selectedActualPlaceholderFieldKeys,
    kisRawRowAvailableAtAdapter: input?.kisRawRowAvailableAtAdapter,
    kisNormalizedRowAvailableAtRouter: input?.kisNormalizedRowAvailableAtRouter,
    kisSelectedCandidateCarriesSemanticRow: input?.kisSelectedCandidateCarriesSemanticRow,
    forensicInputCarriesSemanticRow: input?.forensicInputCarriesSemanticRow,
    semanticRowBreakPoint: input?.semanticRowBreakPoint,
    routeCoverage: input?.routeCoverage,
    freshness: input?.freshness,
    diagnostics: input?.diagnostics,
    reason,
  };
}

export function conditionBlocksGate1(c: Gate1ConditionTrace): boolean {
  return (
    !c.passed && (c.severity === "HARD_FAIL" || c.severity === "SOFT_FAIL")
  );
}

export function countByCondition(
  traces: Gate1CandidateTrace[],
  predicate: (condition: Gate1ConditionTrace) => boolean,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const trace of traces) {
    for (const condition of trace.conditions) {
      if (!predicate(condition)) continue;
      out[condition.code] = (out[condition.code] ?? 0) + 1;
    }
  }
  return out;
}

export function canPassIgnoring(
  trace: Gate1CandidateTrace,
  ignore: (condition: Gate1ConditionTrace) => boolean,
): boolean {
  return !trace.conditions.some(
    (condition) => conditionBlocksGate1(condition) && !ignore(condition),
  );
}
