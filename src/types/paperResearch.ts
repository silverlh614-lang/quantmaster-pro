// @responsibility Define the historical research contract.
import type { PaperCostModel, PaperOutcome } from './paperExperiment';
import type { PaperStrategyCohort, PaperStrategyHorizon } from './paperStrategy';

export interface ResearchSeries {
  id: string;
  symbol: string;
  source: 'KIS_SNAPSHOT' | 'ARCHIVED_CHART';
  retrievedAt: string;
  closes: Array<{ date: string; close: number }>;
}

export interface ResearchNews {
  id: string;
  symbol: string;
  observedAt: string;
  headline: string;
  source: string;
}

export interface ResearchInventory {
  file: string;
  records: number;
  status: 'FOUND' | 'MISSING' | 'ERROR';
  issue?: string;
}

export interface ResearchArchive {
  schemaVersion: 1;
  series: ResearchSeries[];
  news: ResearchNews[];
  inventory: ResearchInventory[];
}

export interface HistoricalPaperSample {
  id: string;
  model: 'HISTORICAL_CLOSE_TO_CLOSE';
  symbol: string;
  tradingDate: string;
  entryAt: string;
  entryPrice: number;
  aboveMa20: boolean;
  cohort: PaperStrategyCohort | null;
  newsIds: string[];
  seriesId: string;
  source: ResearchSeries['source'];
  reconstructedAt: string;
  costModel: PaperCostModel;
  outcomes: PaperOutcome[];
}

export interface ResearchGroupResult {
  group: string;
  count: number;
  entryDates: number;
  horizons: Array<{ horizon: PaperStrategyHorizon; meanNetReturnPct: number; winRatePct: number }>;
}

export interface PaperResearchView {
  asOf: string;
  symbols: number;
  seriesCount: number;
  newsCount: number;
  sampleCount: number;
  learningSampleCount: number;
  firstDate: string | null;
  lastDate: string | null;
  skipped: Record<string, number>;
  inventory: ResearchInventory[];
  groups: ResearchGroupResult[];
  validation: Array<{
    group: string;
    splitDate: string;
    trainingCount: number;
    testCount: number;
    selectedHorizon: PaperStrategyHorizon;
    testMeanNetReturnPct: number | null;
    testWinRatePct: number | null;
  }>;
  notes: string[];
  error?: string;
}
