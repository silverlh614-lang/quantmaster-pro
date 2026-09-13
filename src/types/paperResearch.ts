// @responsibility Define the historical research contract.
import type { PaperCostModel, PaperOutcome } from './paperExperiment';
import type { PaperStrategyCohort, PaperStrategyHorizon } from './paperStrategy';

export interface ResearchBar {
  date: string;
  close: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
}

export interface ResearchSeries {
  id: string;
  symbol: string;
  source: 'KIS_SNAPSHOT' | 'ARCHIVED_CHART';
  retrievedAt: string;
  market?: 'KOSPI' | 'KOSDAQ';
  closes: ResearchBar[];
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
  features?: ResearchFeatures;
}

export interface ResearchFeatures {
  return5dPct: number | null;
  volumeRatio20d: number | null;
  relativeReturn20dPct: number | null;
  extensionMa20Pct: number | null;
  distanceHigh20dPct: number | null;
  atr14Pct: number | null;
  priceSetup: string | null;
  benchmarkSeriesId: string | null;
}

export interface ResearchFeatureStudy {
  feature: keyof Omit<ResearchFeatures, 'benchmarkSeriesId'>;
  label: string;
  availableCount: number;
  missingCount: number;
  splitDate: string | null;
  threshold: number | null;
  groups: ResearchGroupResult[];
  trainingCount: number;
  testAvailableCount: number;
  selectedGroup: string | null;
  selectedHorizon: PaperStrategyHorizon | null;
  selectedTrainingCount: number;
  testCount: number;
  testDateCount: number;
  testSymbolCount: number;
  testMeanNetReturnPct: number | null;
  matchedGroupCount: number;
  matchedSelectedMeanPct: number | null;
  matchedBaselineMeanPct: number | null;
  matchedDifferencePct: number | null;
  status: 'EVALUATED' | 'MISSING_INPUT' | 'NO_TRAIN_VARIATION' | 'NO_TEST_MATCH';
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
  featureStudies?: ResearchFeatureStudy[];
  featureNotes?: string[];
  benchmarkSeriesCount?: number;
  error?: string;
}
