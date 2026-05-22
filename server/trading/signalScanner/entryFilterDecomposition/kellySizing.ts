/**
 * @responsibility ADR-0464 Kelly sizing trace builder.
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
import type { KellySizingTrace } from './types.js';

export function createKellySizingTrace(input: {
  symbol: string;
  kellyRaw: number;
  regimeMultiplier: number;
  fomcMultiplier: number;
  sectorMultiplier?: number;
  riskMultiplier?: number;
  minPositionThreshold?: number;
  finalPositionSize?: number;
}): KellySizingTrace {
  const sectorMultiplier = input.sectorMultiplier ?? 1;
  const riskMultiplier = input.riskMultiplier ?? 1;
  const finalKelly =
    input.kellyRaw *
    input.regimeMultiplier *
    input.fomcMultiplier *
    sectorMultiplier *
    riskMultiplier;
  const minPositionThreshold = input.minPositionThreshold ?? 0.01;
  const finalPositionSize = input.finalPositionSize ?? finalKelly;
  const blockedBySizing = false;
  const sizingTooLow = finalKelly < minPositionThreshold || finalPositionSize <= 0;
  return {
    symbol: input.symbol,
    kellyRaw: input.kellyRaw,
    regimeMultiplier: input.regimeMultiplier,
    fomcMultiplier: input.fomcMultiplier,
    sectorMultiplier,
    riskMultiplier,
    finalKelly,
    minPositionThreshold,
    finalPositionSize,
    blockedBySizing,
    reason: sizingTooLow ? "SIZING_ADVISORY_LOW" : undefined,
  };
}
