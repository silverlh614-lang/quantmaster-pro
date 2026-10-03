// @responsibility Define frozen observed-exit policies with prospective comparison evidence.
export type PaperExitProfileId = 'RESPONSIVE' | 'BALANCED' | 'PATIENT';
export type PaperAdaptiveExitReason = 'ADAPTIVE_STOP_LOSS' | 'ADAPTIVE_TRAILING_STOP' | 'ADAPTIVE_SIGNAL_LOST';

export interface PaperExitProfile {
  id: PaperExitProfileId;
  stopLossPct: number;
  trailingArmPct: number;
  trailingDrawdownPct: number;
  signalFailureCount: number;
  signalFailureMinutes: number;
}

export interface PaperExitLearningStats {
  sampleCount: number;
  dateCount: number;
  tradeIdsDigest: string;
  meanNetReturnPct: number | null;
  meanBaselineNetReturnPct: number | null;
  meanAdvantagePct: number | null;
}

export interface PaperExitLearningCandidate {
  profile: PaperExitProfile;
  training: PaperExitLearningStats;
  validation: PaperExitLearningStats;
}

export interface PaperExitLearningState {
  version: 'observed-exit-learning-v1';
  evaluatedAt: string;
  cutoffAt: string;
  validationStartDate: string | null;
  completedTradeCount: number;
  completedDateCount: number;
  candidates: PaperExitLearningCandidate[];
  selectedProfileId: PaperExitProfileId | null;
  reason: 'INSUFFICIENT_TRAINING' | 'INSUFFICIENT_VALIDATION' | 'NO_TRAINING_EDGE' | 'NO_VALIDATION_EDGE' | 'FORWARD_VALIDATED';
}

export interface PaperAdaptiveExitPolicy {
  version: 'observed-exit-v1';
  origin: 'EXPLORATION_DEFAULT' | 'FORWARD_LEARNED';
  selectedAt: string;
  profile: PaperExitProfile;
  evidence: {
    cutoffAt: string;
    validationStartDate: string;
    training: PaperExitLearningStats;
    validation: PaperExitLearningStats;
  } | null;
}

export interface PaperAdaptiveExitOutcome {
  reason: PaperAdaptiveExitReason | 'D5_BENCHMARK';
  snapshotId: string;
  effectiveAt: string;
  observedAt: string;
  recordedAt: string;
  price: number;
  grossReturnPct: number;
  netReturnPct: number;
  netPnl: number;
  /** D5 comparisons use entry net return as a neutral value; this is a trigger statistic only for observed exits. */
  peakNetReturnPct: number;
  signalFailureCount: number;
  signalFailureStartedAt: string | null;
}

/** Three fixed candidate slots keep storage independent of the number of quotes. */
export interface PaperAdaptiveExitResearch {
  version: 'observed-exit-research-v1';
  startedAt: string;
  watchUntilDate: string;
  watchUntilAt: string;
  lastObservedAt: string | null;
  lastRecordedAt: string | null;
  quoteCount: number;
  peakNetReturnPct: number;
  lastFeatureKey: string | null;
  lastFeatureAsOf: string | null;
  signalFailureCount: number;
  signalFailureStartedAt: string | null;
  outcomes: Partial<Record<PaperExitProfileId, PaperAdaptiveExitOutcome>>;
  baseline: PaperAdaptiveExitOutcome | null;
  completedAt: string | null;
}
