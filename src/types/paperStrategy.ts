// @responsibility Define the empirical Shadow strategy contract.
import type { PaperCostModel, PaperNewsSummary, PaperObservation } from './paperExperiment';
import type { PaperInvestorFlow } from './paperInvestorFlow';

export type PaperStrategyHorizon = 1 | 3 | 5;
export type PaperStrategyCohort =
  | 'NEWS_RECENT_ABOVE_MA20'
  | 'NEWS_RECENT_BELOW_MA20'
  | 'NEWS_ABSENT_ABOVE_MA20'
  | 'NEWS_ABSENT_BELOW_MA20';

export interface PaperStrategyPolicy {
  version: 'news-trend-v1' | 'news-trend-v2';
  newsLookbackHours: number;
  minimumSamples: number;
  minimumEntryDates: number;
  horizonSelection: 'MEAN_NET_RETURN_PER_DAY';
  exitModel: 'SCHEDULED_CLOSE';
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
  experimentIds: string[];
  horizons: PaperStrategyHorizonEvidence[];
  selectedHorizon: PaperStrategyHorizon | null;
  historicalSampleCount?: number;
  baselineSampleCount?: number;
}

export type PaperStrategyReasonCode =
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
  tradeId: string | null;
  newsSummary?: PaperNewsSummary;
  investorFlow?: PaperInvestorFlow;
}

export interface PaperStrategyExit {
  model: 'SCHEDULED_CLOSE';
  snapshotId: string;
  effectiveAt: string;
  observedAt: string;
  decisionAt: string;
  price: number;
  grossReturnPct: number;
  netReturnPct: number;
  netPnl: number;
  decision: PaperStrategyDecision;
}

export interface PaperStrategyTrade {
  id: string;
  strategyVersion: 'news-trend-v1' | 'news-trend-v2';
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
}

export interface PaperStrategyPerformance {
  closedCount: number;
  meanNetReturnPct: number | null;
  winRatePct: number | null;
  totalNetPnl: number | null;
}

export interface PaperStrategyView {
  strategyVersion: 'news-trend-v1' | 'news-trend-v2';
  mode: 'SHADOW';
  policy: PaperStrategyPolicy;
  totalCount: number;
  openCount: number;
  performance: PaperStrategyPerformance;
  lastRun: PaperStrategyScanResult | null;
  latestDecisions: PaperStrategyDecision[];
  trades: PaperStrategyTrade[];
  error?: string;
}
