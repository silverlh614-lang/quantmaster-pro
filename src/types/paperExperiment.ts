// @responsibility Define independent Shadow experiment records.
import type { PaperStrategyScanResult, PaperStrategyView } from './paperStrategy';
import type { PaperResearchView } from './paperResearch';

export interface PaperNewsObservation {
  id: string;
  headline: string;
  observedAt: string;
  source: string;
}

export interface PaperDailyClose {
  tradingDate: string;
  close: number;
  availableAt: string;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
}

export interface PaperObservation {
  symbol: string;
  name: string;
  price: number | null;
  observedAt: string;
  source: string;
  market?: 'KOSPI' | 'KOSDAQ';
  return1dPct: number | null;
  return5dPct: number | null;
  aboveMa20: boolean | null;
  news: PaperNewsObservation[];
  dailyCloses: PaperDailyClose[];
  issue?: string;
}

export interface PaperSnapshot {
  id: string;
  asOf: string;
  tradingDate: string;
  marketOpen: boolean;
  observations: PaperObservation[];
}

export interface PaperCostModel {
  version: string;
  buyFeeRate: number;
  sellFeeRate: number;
  sellTaxRate: number;
  slippageRate: number;
}

export interface PaperOutcome {
  horizon: 1 | 3 | 5;
  tradingDate: string;
  availableAt: string;
  exitPrice: number;
  grossReturnPct: number;
  netReturnPct: number;
  netPnl: number;
}

export interface PaperExperiment {
  id: string;
  strategyVersion: 'shadow-baseline-v1';
  snapshotId: string;
  symbol: string;
  name: string;
  entryAt: string;
  tradingDate: string;
  entryPrice: number;
  quantity: 1;
  entryObservation: PaperObservation;
  costModel: PaperCostModel;
  status: 'OPEN' | 'COMPLETED';
  outcomes: PaperOutcome[];
}

export interface PaperScanResult {
  snapshotId: string;
  asOf: string;
  candidateCount: number;
  observedCount: number;
  openedCount: number;
  completedCount: number;
  missingPriceCount: number;
  marketOpen: boolean;
  issues: string[];
  strategy?: PaperStrategyScanResult;
}

export interface PaperExperimentLedger {
  schemaVersion: 1;
  experiments: PaperExperiment[];
  lastRun: PaperScanResult | null;
}

export interface PaperLearningGroup {
  label: string;
  count: number;
  meanNetReturnPct: number | null;
  winRatePct: number | null;
}

export interface PaperExperimentView {
  mode: 'SHADOW';
  strategyVersion: 'shadow-baseline-v1';
  lastRun: PaperScanResult | null;
  totalCount: number;
  openCount: number;
  completedCount: number;
  outcomes: Array<PaperLearningGroup & { horizon: 1 | 3 | 5 }>;
  groups: PaperLearningGroup[];
  experiments: PaperExperiment[];
  strategy?: PaperStrategyView;
  research?: PaperResearchView;
}
