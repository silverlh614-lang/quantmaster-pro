// @responsibility Define the empirical Shadow strategy contract.
import type { PaperCostModel, PaperNewsSummary, PaperObservation } from './paperExperiment';
import type { PaperInvestorFlow } from './paperInvestorFlow';
import type { PaperAdaptiveEvidence, PaperAdaptiveState, PaperExplorationEvidence } from './paperAdaptive';
import type { PaperAdaptiveExitOutcome, PaperAdaptiveExitPolicy, PaperAdaptiveExitResearch, PaperExitLearningState } from './paperAdaptiveExit';

export type PaperStrategyVersion = 'news-trend-v1' | 'news-trend-v2' | 'adaptive-features-v1';

export type PaperStrategyHorizon = 1 | 3 | 5;
export type PaperStrategyCohort =
  | 'NEWS_RECENT_ABOVE_MA20'
  | 'NEWS_RECENT_BELOW_MA20'
  | 'NEWS_ABSENT_ABOVE_MA20'
  | 'NEWS_ABSENT_BELOW_MA20';

export interface PaperStrategyPolicy {
  version: PaperStrategyVersion;
  newsLookbackHours: number;
  minimumSamples: number;
  minimumEntryDates: number;
  horizonSelection: 'MEAN_NET_RETURN_PER_DAY' | 'FORWARD_VALIDATED_FEATURE';
  exitModel: 'SCHEDULED_CLOSE' | 'ADAPTIVE_OBSERVED';
}

export interface PaperStrategyHorizonEvidence {
  horizon: PaperStrategyHorizon;
  count: number;
  meanNetReturnPct: number | null;
  meanDailyNetReturnPct: number | null;
  winRatePct: number | null;
}

export interface PaperStrategyEvidence {
  cutoffAt: string;
  cohort: PaperStrategyCohort;
  sampleCount: number;
  entryDateCount: number;
  /** SHA-256 of the sorted evidence sample IDs; the IDs follow from the append-only baseline ledger and cutoff (ADR-0680). */
  experimentIdsDigest: string;
  horizons: PaperStrategyHorizonEvidence[];
  selectedHorizon: PaperStrategyHorizon | null;
  historicalSampleCount?: number;
  baselineSampleCount?: number;
}

export type PaperStrategyReasonCode =
  | 'ADAPTIVE_FEATURE_SELECTED'
  | 'ADAPTIVE_EXPLORATION_SELECTED'
  | 'ADAPTIVE_NO_ACTIVE_RULE'
  | 'ADAPTIVE_FEATURE_UNAVAILABLE'
  | 'ADAPTIVE_RULE_NOT_MATCHED'
  | 'POSITIVE_COHORT_EXPECTANCY'
  | 'INSUFFICIENT_MATURE_SAMPLES'
  | 'INSUFFICIENT_ENTRY_DATES'
  | 'NON_POSITIVE_EXPECTANCY'
  | 'TREND_UNKNOWN'
  | 'MARKET_CLOSED'
  | 'CURRENT_PRICE_UNAVAILABLE'
  | 'OBSERVATION_TIME_INVALID'
  | 'ALREADY_ENTERED_TODAY'
  | 'HORIZON_PENDING'
  | 'ADAPTIVE_EXIT_HOLD'
  | 'ADAPTIVE_EXIT_QUOTE_UNAVAILABLE'
  | 'ADAPTIVE_STOP_LOSS'
  | 'ADAPTIVE_TRAILING_STOP'
  | 'ADAPTIVE_SIGNAL_LOST'
  | 'SCHEDULED_CLOSE_UNAVAILABLE'
  | 'SCHEDULED_CLOSE_REACHED';

export interface PaperStrategyDecision {
  snapshotId: string;
  decisionAt: string;
  symbol: string;
  name: string;
  action: 'BUY' | 'WAIT' | 'HOLD' | 'EXIT';
  reasonCode: PaperStrategyReasonCode;
  reason: string;
  cohort: PaperStrategyCohort | null;
  evidence: PaperStrategyEvidence | null;
  adaptiveEvidence?: PaperAdaptiveEvidence;
  explorationEvidence?: PaperExplorationEvidence;
  tradeId: string | null;
  newsSummary?: PaperNewsSummary;
  investorFlow?: PaperInvestorFlow;
}

export interface PaperStrategyExit {
  model: 'SCHEDULED_CLOSE' | 'ADAPTIVE_OBSERVED';
  snapshotId: string;
  effectiveAt: string;
  observedAt: string;
  decisionAt: string;
  price: number;
  grossReturnPct: number;
  netReturnPct: number;
  netPnl: number;
  decision: PaperStrategyDecision;
  observedTrigger?: PaperAdaptiveExitOutcome;
  observedQuote?: {
    source: string; price: number; observedAt: string;
    ruleValue: number | null; ruleMatches: boolean | null; ruleConnected: boolean | null; featureAsOf: string | null;
  };
}

/** A sampled price is not the market's exact high, low, or an executable sell signal. */
export interface PaperTradeMeasurementPoint {
  snapshotId: string;
  kind: 'ENTRY' | 'QUOTE' | 'SCHEDULED_CLOSE' | 'ADAPTIVE_EXIT';
  effectiveAt: string;
  observedAt: string;
  recordedAt: string;
  price: number;
  source: string;
  netReturnPct: number;
  netPnl: number;
  action: 'BUY' | 'HOLD' | 'EXIT';
  reasonCode: PaperStrategyReasonCode;
  ruleValue: number | null;
  ruleMatches: boolean | null;
  ruleConnected: boolean | null;
  featureAsOf: string | null;
}

export interface PaperTradeMeasurement {
  version: 'observed-trade-path-v1';
  startedAt: string;
  fromEntry: boolean;
  pointCount: number;
  latest: PaperTradeMeasurementPoint;
  highest: PaperTradeMeasurementPoint;
  lowest: PaperTradeMeasurementPoint;
}

export interface PaperTradeMeasurementRow extends PaperTradeMeasurementPoint {
  tradeId: string;
  entrySnapshotId: string;
}

export interface PaperTradeMeasurementHistory {
  lastRecordedAt: string | null;
  failedBatchCount: number | null;
  /** Conservative storage confirmation gap; null when the status cannot be read. */
  unrecordedPointCount: number | null;
  error?: string;
}

export interface PaperStrategyTrade {
  id: string;
  strategyVersion: PaperStrategyVersion;
  symbol: string;
  name: string;
  status: 'OPEN' | 'CLOSED';
  entrySnapshotId: string;
  entryAt: string;
  tradingDate: string;
  entryPrice: number;
  quantity: 1;
  entryObservation: PaperObservation;
  entryDecision: PaperStrategyDecision;
  policy: PaperStrategyPolicy;
  costModel: PaperCostModel;
  horizon: PaperStrategyHorizon;
  scheduledExitDate: string;
  scheduledExitAt: string;
  exit: PaperStrategyExit | null;
  exitPolicy?: PaperAdaptiveExitPolicy;
  exitResearch?: PaperAdaptiveExitResearch;
  measurement?: PaperTradeMeasurement;
  morningRecommendation?: import('./paperMorning').PaperMorningTradeReference;
}

export interface PaperStrategyScanResult {
  snapshotId: string;
  asOf: string;
  openedCount: number;
  closedCount: number;
  waitingCount: number;
  holdingCount: number;
  error?: string;
}

export interface PaperStrategyLedger {
  schemaVersion: 1;
  trades: PaperStrategyTrade[];
  latestDecisions: PaperStrategyDecision[];
  lastRun: PaperStrategyScanResult | null;
  lastMarketSession?: PaperStrategySessionSummary;
  adaptive?: PaperAdaptiveState;
  exitLearning?: PaperExitLearningState;
}

/** The latest completed intraday decision counts survive subsequent off-hours scans. */
export interface PaperStrategySessionSummary {
  tradingDate: string;
  snapshotId: string;
  asOf: string;
  decisionCount: number;
  reasonCounts: Partial<Record<PaperStrategyReasonCode, number>>;
}

export interface PaperStrategyPerformance {
  closedCount: number;
  meanNetReturnPct: number | null;
  winRatePct: number | null;
  totalNetPnl: number | null;
}

/** Same-day selectivity research; display only, never a decision input. */
export interface PaperStrategySelection {
  dateCount: number;
  candidateCount: number;
  boughtCount: number;
  heldCount: number;
  notBoughtCount: number;
  selectionRatePct: number | null;
  cohorts: Array<{ cohort: PaperStrategyCohort; candidateCount: number; boughtCount: number }>;
  comparison: {
    groupCount: number;
    strategyTradeCount: number;
    unselectedCount: number;
    strategyMeanPct: number | null;
    unselectedMeanPct: number | null;
    baselineMeanPct: number | null;
    differencePct: number | null;
  };
}

export interface PaperStrategyView {
  strategyVersion: PaperStrategyVersion;
  mode: 'SHADOW';
  policy: PaperStrategyPolicy;
  totalCount: number;
  openCount: number;
  performance: PaperStrategyPerformance;
  performanceByVersion?: Partial<Record<PaperStrategyVersion, PaperStrategyPerformance>>;
  performanceByPurpose?: Record<'VALIDATED' | 'EXPLORATION', PaperStrategyPerformance & { openCount: number }>;
  lastRun: PaperStrategyScanResult | null;
  lastMarketSession?: PaperStrategySessionSummary;
  adaptive?: PaperAdaptiveState;
  exitLearning?: PaperExitLearningState;
  latestDecisions: PaperStrategyDecision[];
  trades: PaperStrategyTrade[];
  selection?: PaperStrategySelection;
  measurementHistory?: PaperTradeMeasurementHistory;
  error?: string;
}
