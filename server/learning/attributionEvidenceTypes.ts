// @responsibility Attribution Evidence Ledger shared types.

import type {
  ExitPath,
  TradeOutcome,
  WinRateBucket,
} from '../trading/canonicalTradeOutcomeResolver.js';

export type AttributionSampleSource =
  | 'LIVE'
  | 'SHADOW'
  | 'COUNTERFACTUAL'
  | 'DIAGNOSTIC'
  | 'BLOCKED';

export type AttributionEligibility =
  | 'CORE_ELIGIBLE'
  | 'CANDIDATE_ONLY'
  | 'SHADOW_ONLY'
  | 'COUNTERFACTUAL_ONLY'
  | 'DIAGNOSTIC_ONLY'
  | 'EXCLUDED';

export type AttributionOutcomeStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'EXPIRED'
  | 'INVALID'
  | 'QUARANTINED';

export type AttributionExecutionStatus =
  | 'EXECUTED'
  | 'PAPER_FILLED'
  | 'NOT_EXECUTED'
  | 'BLOCKED'
  | 'SKIPPED'
  | 'REJECTED';

export type DataConfidence =
  | 'VERIFIED'
  | 'DEGRADED'
  | 'STALE'
  | 'MISSING'
  | 'AI_ESTIMATED'
  | 'UNKNOWN';

export type EngineMode =
  | 'NORMAL'
  | 'DEGRADED'
  | 'SELL_ONLY'
  | 'SHADOW_ONLY'
  | 'OBSERVE_ONLY'
  | 'R6_DEFENSE';

export type AttributionWinLoss =
  | 'WIN'
  | 'LOSS'
  | 'BREAKEVEN'
  | 'PARTIAL_WIN'
  | 'PENDING'
  | 'INVALID';

export type AttributionExecutionImpact =
  | 'NONE'
  | 'NEW_BUY_BLOCKED_ONLY'
  | 'EXIT_ALLOWED'
  | 'LIVE_ORDER_BLOCKED';

export interface AttributionEvidenceRecord {
  evidenceId: string;
  tradeDate: string;
  symbol: string;
  stockName?: string;

  regime: string;
  conditionKeys: string[];

  source: AttributionSampleSource;
  eligibility: AttributionEligibility;
  outcomeStatus: AttributionOutcomeStatus;
  executionStatus: AttributionExecutionStatus;

  engineMode: EngineMode;
  dataConfidence: DataConfidence;

  signalId?: string;
  positionId?: string;
  orderId?: string;
  shadowPositionId?: string;
  counterfactualId?: string;

  entryPrice?: number;
  exitPrice?: number;
  /** Patch 2 gap (d): counterfactual/shadow 손절·목표가 메타 (옵셔널, append-only). */
  stopPrice?: number;
  targetPrice?: number;
  entryTime?: string;
  exitTime?: string;

  returnPct?: number;
  returnR?: number;
  maxFavorableExcursionR?: number;
  maxAdverseExcursionR?: number;

  winLoss?: AttributionWinLoss;
  canonicalOutcome?: TradeOutcome;
  winRateBucket?: WinRateBucket;
  exitPath?: ExitPath;
  learningTags?: string[];

  blockedReason?: string;
  providerIssue?: boolean;
  providerName?: string;
  marketSignal?: boolean;
  executionImpact?: AttributionExecutionImpact;

  createdAt: string;
  updatedAt: string;

  auditTags: string[];
}

export interface AttributionBuckets {
  coreEligible: AttributionEvidenceRecord[];
  candidateOnly: AttributionEvidenceRecord[];
  shadowOnly: AttributionEvidenceRecord[];
  counterfactualOnly: AttributionEvidenceRecord[];
  diagnosticOnly: AttributionEvidenceRecord[];
  excluded: AttributionEvidenceRecord[];
  pending: AttributionEvidenceRecord[];
}

export interface AttributionBucketSummary {
  total: number;
  coreEligible: number;
  candidateOnly: number;
  shadowOnly: number;
  counterfactualOnly: number;
  diagnosticOnly: number;
  pending: number;
  excluded: number;
}
