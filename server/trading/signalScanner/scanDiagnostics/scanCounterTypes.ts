// @responsibility Scan counter public type contracts.

import type { GateReclassificationDryRunResult } from '../../../learning/gateReclassificationDryRun.js';
import type { ScanTrace } from '../../scanTracer.js';
import type { CounterfactualShadowLearningCandidate } from '../counterfactualShadowLearningLane.js';
import type { CandidateSnapshot } from '../entryFilterDecomposition.js';
import type { ConditionBlockerBucket } from '../freshScanBlockerAttribution.js';
import type { Gate1ScoreStarvationTrace } from '../gate1PositiveScoreStarvation.js';
import type { Gate2BlockerBucket } from '../gate2LeadershipAttribution.js';
import type { GateScoreCandidateBucket } from '../gateScoreCandidateBucket.js';
import type { PreBreakoutWaitDecision } from '../preBreakoutWaitPolicy.js';
import type { ProvisionalShadowCandidate } from '../provisionalShadowLane.js';
import type { R6ShadowEntryPolicySummary } from '../r6ShadowCounterfactualEntryPolicy.js';
import type { PipelineStageName, PipelineStageStatus } from './scanSummaryTypes.js';

export interface GateScoreHealthSummary {
  samples: number;
  rawScoreAvg: number;
  availableMaxScoreAvg: number;
  normalizedGateScoreAvg: number;
  unavailableTop: Array<{ condition: string; count: number }>;
  thresholdNotMetTop: Array<{ condition: string; count: number }>;
  providerDegradedTop: Array<{ condition: string; count: number }>;
  diagnosis:
    | 'DATA_UNAVAILABLE_DOMINANT'
    | 'THRESHOLD_NOT_MET_DOMINANT'
    | 'PROVIDER_DEGRADED_DOMINANT'
    | 'MIXED'
    | 'NO_SAMPLES';
}

export interface GateScoreCandidateBucketSummary {
  counts: Record<GateScoreCandidateBucket, number>;
  dataBlockedNearMissTopUnavailable: Array<{ condition: string; count: number }>;
  probingTopConditions: Array<{ condition: string; count: number }>;
  totalNearMissLike: number;
  outcomeLedgerRecorded?: number;
  outcomeLedgerSkipped?: number;
}

export interface GateLayerAuditSummary {
  gate1PassCount: number;
  gate2PassCount: number;
  gate3PassCount: number;
  strongBuySuppressedByDataUnavailableCount: number;
  topGate1BlockReasons: Array<{ reason: string; count: number }>;
  topGate2BlockReasons: Array<{ reason: string; count: number }>;
  topGate3BlockReasons: Array<{ reason: string; count: number }>;
}

export interface GateLayerAuditAccumulator {
  gate1PassCount: number;
  gate2PassCount: number;
  gate3PassCount: number;
  strongBuySuppressedByDataUnavailableCount: number;
  gate1BlockReasons: Record<string, number>;
  gate2BlockReasons: Record<string, number>;
  gate3BlockReasons: Record<string, number>;
}

export interface ScanCounters {
  yahooFails: number;
  gateMisses: number;
  rrrMisses: number;
  entries: number;
  counterfactualRecordedToday: number;
  pendingTraces: ScanTrace[];
  waitDataHold: number;
  waitPreBreakout: number;
  waitGateFail: number;
  waitSizingBlocked: number;
  waitDriftRemove: number;
  waitDriftCorpAction: number;
  waitVolumeDrop: number;
  waitOther: number;
  waitTierRestSuppressed?: number;
  gate1Pass: number;
  gate1Unknown: number;
  gate2Pass: number;
  gate3Pass: number;
  lastTriggerPass: number;
  freshConditionBuckets: Map<string, ConditionBlockerBucket>;
  gate2ConditionBuckets: Map<string, Gate2BlockerBucket>;
  provisionalShadowEligible: number;
  provisionalShadowCreated: number;
  provisionalShadowSkipped: number;
  provisionalShadowSkipReasons: Record<string, number>;
  provisionalShadowCandidates: ProvisionalShadowCandidate[];
  counterfactualShadowEligible: number;
  counterfactualShadowCreated: number;
  counterfactualShadowSkipped: number;
  counterfactualShadowSkipReasons: Record<string, number>;
  counterfactualShadowCandidates: CounterfactualShadowLearningCandidate[];
  r6ShadowEntryPolicy?: R6ShadowEntryPolicySummary;
  liveEligibleCount: number;
  shadowObservableCount: number;
  dataUnavailableBlockedCount: number;
  providerDegradedObservableCount: number;
  trueGateFailCount: number;
  hardRiskBlockedCount: number;
  preBreakoutWaitDecisions: PreBreakoutWaitDecision[];
  preBreakoutPriceDistance: number;
  shadowNearBreakoutCreated?: number;
  shadowNearBreakoutBlocked?: number;
  shadowNearBreakoutBlockReasons?: Partial<Record<string, number>>;
  gateScoreHealthSamples: number;
  gateScoreRawSum: number;
  gateScoreAvailableMaxSum: number;
  gateScoreNormalizedSum: number;
  gateScoreUnavailableCounts: Record<string, number>;
  gateScoreThresholdNotMetCounts: Record<string, number>;
  gateScoreProviderDegradedCounts: Record<string, number>;
  gateLayerAudit: GateLayerAuditAccumulator;
  perStageDropoff: Partial<Record<PipelineStageName, Partial<Record<PipelineStageStatus, number>>>>;
  gateScoreBucketCounts: Record<GateScoreCandidateBucket, number>;
  gateScoreBucketReasonCounts: Record<string, number>;
  dataBlockedNearMissUnavailableCounts: Record<string, number>;
  probingConditionCounts: Record<string, number>;
  nearMissOutcomeLedgerRecorded: number;
  nearMissOutcomeLedgerSkipped: number;
  entryCandidateSnapshots: CandidateSnapshot[];
  gateReclassificationDryRunResults: GateReclassificationDryRunResult[];
  positiveScoreStarvationTraces: Gate1ScoreStarvationTrace[];
}
