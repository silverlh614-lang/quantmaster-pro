// @responsibility Define independent Shadow experiment records.
import type { PaperStrategyScanResult, PaperStrategyView } from './paperStrategy';
import type { PaperResearchView } from './paperResearch';
import type { PaperInvestorFlow, PaperInvestorFlowSnapshot, PaperInvestorFlowStudy } from './paperInvestorFlow';
import type { PaperDisclosureStatus, PaperNewsFacts, PaperNewsFactsStudy } from './paperNewsFacts';
import type { PaperObservationFeatures, PaperFeatureCoverage, PaperFeatureStudy } from './paperObservationFeatures';

export const PAPER_OBSERVATION_ISSUE_LABELS: Record<string, string> = {
  CURRENT_QUOTE_UNAVAILABLE: '현재가 응답 없음',
  CURRENT_QUOTE_INVALID_PRICE: '응답에 유효한 현재가 없음',
  CURRENT_QUOTE_SYMBOL_MISMATCH: '응답 종목 코드 불일치',
  CURRENT_QUOTE_TIME_INVALID: '현재가 조회 시각 오류',
  CURRENT_QUOTE_STALE: '이번 수집 이전의 현재가',
};

export interface PaperCollectionProgress {
  startedAt: string;
  lastProgressAt: string;
  completed: number;
  total: number;
}

export interface PaperNewsObservation {
  id: string;
  headline: string;
  observedAt: string;
  source: string;
  assessment?: PaperNewsAssessment;
  facts?: PaperNewsFacts;
}

export type PaperNewsDirection = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED' | 'UNKNOWN';
export type PaperNewsGroup = PaperNewsDirection | 'NO_NEWS';

export interface PaperNewsAssessment {
  version: 'headline-rules-v1';
  method: 'DISCLOSURE_TITLE_RULES';
  assessedAt: string;
  direction: PaperNewsDirection;
  reason: string;
}

export interface PaperNewsSummary {
  asOf: string;
  lookbackHours: number;
  direction: PaperNewsGroup;
  counts: Record<PaperNewsDirection, number>;
  totalCount: number;
  evidence: Array<Pick<PaperNewsObservation, 'id' | 'headline' | 'source' | 'observedAt'> & {
    direction: PaperNewsDirection; reason: string; facts?: PaperNewsFacts;
  }>;
}

export interface PaperNewsStudy {
  version: 'headline-rules-v1';
  lookbackHours: number;
  groups: Array<{
    direction: PaperNewsGroup;
    observationCount: number;
    entryDateCount: number;
    outcomes: Array<PaperLearningGroup & { horizon: 1 | 3 | 5 }>;
  }>;
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
  investorFlow?: PaperInvestorFlow;
  features?: PaperObservationFeatures;
  issue?: string;
}

export interface PaperSnapshot {
  id: string;
  asOf: string;
  tradingDate: string;
  marketOpen: boolean;
  observations: PaperObservation[];
  disclosures?: PaperDisclosureStatus;
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
  durationMs?: number;
  candidateCount: number;
  observedCount: number;
  openedCount: number;
  completedCount: number;
  missingPriceCount: number;
  marketOpen: boolean;
  issues: string[];
  investorFlow?: PaperInvestorFlowSnapshot;
  featureCoverage?: PaperFeatureCoverage;
  disclosures?: PaperDisclosureStatus;
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
  collection?: PaperCollectionProgress;
  totalCount: number;
  openCount: number;
  completedCount: number;
  outcomes: Array<PaperLearningGroup & { horizon: 1 | 3 | 5 }>;
  groups: PaperLearningGroup[];
  newsStudy?: PaperNewsStudy;
  newsFactsStudy?: PaperNewsFactsStudy;
  investorFlowStudy?: PaperInvestorFlowStudy;
  featureStudy?: PaperFeatureStudy;
  experiments: PaperExperiment[];
  strategy?: PaperStrategyView;
  research?: PaperResearchView;
}

/** Compact landing payload; detailed ledgers are fetched only on their page. */
export interface PaperOverviewView extends Omit<PaperExperimentView, 'experiments' | 'groups' | 'strategy' | 'research'> {
  strategy?: Omit<PaperStrategyView, 'trades' | 'latestDecisions'> & {
    decisionCounts: Record<'BUY' | 'WAIT' | 'HOLD' | 'EXIT', number>;
    waitingReasons: Array<{ code: string; label: string; count: number }>;
  };
  research?: Pick<PaperResearchView, 'asOf' | 'symbols' | 'sampleCount' | 'learningSampleCount' | 'newsCount' | 'seriesCount' | 'firstDate' | 'lastDate' | 'error'> & {
    features: Array<Pick<NonNullable<PaperResearchView['featureStudies']>[number], 'feature' | 'label' | 'status' | 'matchedDifferencePct' | 'testCount' | 'testSymbolCount' | 'testDateCount'>>;
  };
}
