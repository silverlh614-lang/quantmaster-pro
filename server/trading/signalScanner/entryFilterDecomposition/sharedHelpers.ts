/**
 * @responsibility ADR-0464 entry filter helper primitives.
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
import type {
  CandidateEntryStage,
  CandidateEntryTrace,
  EntryBlocker,
  EntryBlockerCategory,
  Gate1CandidateTrace,
  Gate1ConditionTrace,
} from './types.js';

export function blocker(
  input: Omit<EntryBlocker, "learningBlocking"> & {
    learningBlocking?: boolean;
  },
): EntryBlocker {
  return { ...input, learningBlocking: input.learningBlocking ?? false };
}

export function addBlockersRoundRobin(
  traces: CandidateEntryTrace[],
  count: number,
  make: (idx: number) => EntryBlocker,
  stage: CandidateEntryStage,
  gatePatch?: Partial<CandidateEntryTrace>,
): void {
  if (traces.length === 0) return;
  for (let i = 0; i < Math.min(count, traces.length); i += 1) {
    const trace = traces[i % traces.length];
    trace.blockers.push(make(i));
    trace.stageReached = stage;
    Object.assign(trace, gatePatch ?? {});
  }
}

export function hasExecutionBlocker(
  trace: CandidateEntryTrace,
  category?: EntryBlockerCategory,
): boolean {
  return trace.blockers.some((b) => {
    const scope = b.executionBlocking;
    const blocks =
      scope === true || scope === "NEW_BUY_ONLY" || scope === "ALL_EXECUTION";
    return blocks && (category === undefined || b.category === category);
  });
}

export function nonTimeHardBlocked(trace: CandidateEntryTrace): boolean {
  return trace.blockers.some((b) => {
    if (b.category === "TIME_WINDOW") return false;
    const scope = b.executionBlocking;
    return (
      scope === true || scope === "NEW_BUY_ONLY" || scope === "ALL_EXECUTION"
    );
  });
}

export function isRiskOff(regime: string): boolean {
  return ["CRISIS", "RISK_OFF", "R6_DEFENSE", "R5_CAUTION"].includes(regime);
}

export function isGreenish(regime: string): boolean {
  return ["GREEN", "R1_TURBO", "R2_BULL", "R3_EARLY", "FOMC_NORMAL"].includes(
    regime,
  );
}

export function makeCondition(input: Gate1ConditionTrace): Gate1ConditionTrace {
  return { ...input, learningBlocking: input.learningBlocking ?? false };
}
