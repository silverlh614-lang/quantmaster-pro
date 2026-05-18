// @responsibility Scan counter mutation helpers.

import type { GateReclassificationDryRunResult } from '../../../learning/gateReclassificationDryRun.js';
import type { CandidateSnapshot } from '../entryFilterDecomposition.js';
import {
  accumulateFreshAttribution,
  type FreshAttributionOutputItem,
} from '../freshScanBlockerAttribution.js';
import type { Gate1ScoreStarvationTrace } from '../gate1PositiveScoreStarvation.js';
import {
  accumulateGate2Attribution,
  type Gate2AttributionOutputItem,
} from '../gate2LeadershipAttribution.js';
import type { GatePassDistribution, WaitDistribution } from './scanSummaryTypes.js';
import type { ScanCounters } from './scanCounterTypes.js';

export function accumulateFreshConditionOutputs(
  counters: ScanCounters,
  outputs: FreshAttributionOutputItem[],
): void {
  accumulateFreshAttribution(counters.freshConditionBuckets, outputs);
}

export function accumulateGate2ConditionOutputs(
  counters: ScanCounters,
  outputs: Gate2AttributionOutputItem[],
): void {
  accumulateGate2Attribution(counters.gate2ConditionBuckets, outputs);
}

export function accumulateGateEligibility(
  counters: ScanCounters,
  result: { liveEligible: boolean; shadowObservable: boolean; liveBlockReasons: string[]; dataUnavailableReasons: string[]; degradedProviderReasons: string[] },
): void {
  if (result.liveEligible) {
    counters.liveEligibleCount += 1;
  }
  if (result.shadowObservable) {
    counters.shadowObservableCount += 1;
  }
  if (result.dataUnavailableReasons.length > 0) {
    counters.dataUnavailableBlockedCount += 1;
  }
  if (result.degradedProviderReasons.length > 0) {
    counters.providerDegradedObservableCount += 1;
  }
  if (
    result.liveBlockReasons.includes('MACRO_BLOCK') ||
    result.liveBlockReasons.includes('RISK_BLOCK')
  ) {
    counters.hardRiskBlockedCount += 1;
  }
  if (
    result.liveBlockReasons.includes('TRUE_GATE_FAIL') ||
    result.liveBlockReasons.includes('INSUFFICIENT_SCORE')
  ) {
    counters.trueGateFailCount += 1;
  }
}

export function registerEntryCandidateSnapshots(
  counters: ScanCounters,
  snapshots: CandidateSnapshot[],
): void {
  counters.entryCandidateSnapshots.push(...snapshots);
}

export function buildGatePassDistribution(counters: ScanCounters): GatePassDistribution {
  return {
    gate1Pass: counters.gate1Pass,
    gate2Pass: counters.gate2Pass,
    gate3Pass: counters.gate3Pass,
    lastTriggerPass: counters.lastTriggerPass,
    gate1Unknown: counters.gate1Unknown,
  };
}

export function buildWaitDistribution(counters: ScanCounters): WaitDistribution {
  return {
    dataHold: counters.waitDataHold,
    preBreakout: counters.waitPreBreakout,
    gateFail: counters.waitGateFail,
    sizingBlocked: counters.waitSizingBlocked,
    driftRemove: counters.waitDriftRemove,
    corpAction: counters.waitDriftCorpAction,
    volumeDrop: counters.waitVolumeDrop,
    other: counters.waitOther,
  };
}

export function accumulateGateReclassificationDryRun(
  counters: ScanCounters,
  result: GateReclassificationDryRunResult | null | undefined,
): void {
  if (!result || result.dryRunDecision === 'NO_CHANGE') return;
  counters.gateReclassificationDryRunResults.push(result);
}

export function accumulatePositiveScoreStarvation(
  counters: ScanCounters,
  trace: Gate1ScoreStarvationTrace | null | undefined,
): void {
  if (trace) counters.positiveScoreStarvationTraces.push(trace);
}
