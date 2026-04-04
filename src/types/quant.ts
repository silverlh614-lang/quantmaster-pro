export type ConditionId = number;

export interface Condition {
  id: ConditionId;
  name: string;
  description: string;
  baseWeight: number;
}

export type MarketRegimeType = '상승초기' | '변동성' | '횡보' | '하락';

export interface MarketRegime {
  type: MarketRegimeType;
  weightMultipliers: Record<ConditionId, number>;
  vKospi: number;
  samsungIri: number;
}

export type StockProfileType = 'A' | 'B' | 'C' | 'D'; // 대형 주도주, 중형 성장주, 소형 모멘텀주, 촉매제 플레이

export interface StockProfile {
  type: StockProfileType;
  monitoringCycle: 'WEEKLY' | 'DAILY' | 'REALTIME';
  stopLoss: number; // e.g., -15
  executionDelay: number; // days
}

export interface EuphoriaSignal {
  id: string;
  name: string;
  active: boolean;
}

export interface SellCondition {
  id: number;
  name: string;
  description: string;
  trigger: string;
}

export interface MultiTimeframe {
  monthly: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  weekly: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  daily: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  consistency: boolean;
}

export interface TranchePlan {
  tranche1: { size: number; trigger: string; status: 'PENDING' | 'EXECUTED' };
  tranche2: { size: number; trigger: string; status: 'PENDING' | 'EXECUTED' };
  tranche3: { size: number; trigger: string; status: 'PENDING' | 'EXECUTED' };
}

export interface EnemyChecklist {
  bearCase: string;
  riskFactors: string[];
  counterArguments: string[];
}

export interface SeasonalityData {
  month: number;
  historicalPerformance: number;
  winRate: number;
  isPeakSeason: boolean;
}

export interface AttributionAnalysis {
  sectorContribution: number;
  momentumContribution: number;
  valueContribution: number;
  alpha: number;
}

export interface EvaluationResult {
  gate1Passed: boolean;
  gate2Passed: boolean;
  gate3Passed: boolean;
  gate1Score: number;
  gate2Score: number;
  gate3Score: number;
  finalScore: number;
  recommendation: '풀 포지션' | '절반 포지션' | '관망' | '매도' | '강력 매도';
  positionSize: number; // % of portfolio
  rrr: number; // Risk-Reward Ratio
  lastTrigger: boolean;
  euphoriaLevel: number; // 0-5
  emergencyStop: boolean;
  profile: StockProfile;
  sellScore: number; // 0-27
  sellSignals: number[]; // IDs of triggered sell conditions
  multiTimeframe?: MultiTimeframe;
  tranchePlan?: TranchePlan;
  enemyChecklist?: EnemyChecklist;
  seasonality?: SeasonalityData;
  attribution?: AttributionAnalysis;
  correlationScore?: number; // Correlation with existing portfolio
}

export interface SectorRotation {
  name: string;
  rank: number;
  strength: number;
  isLeading: boolean;
  sectorLeaderNewHigh: boolean; // 2순위: 대장주 신고가 경신 여부
  leadingSectors?: string[];
}

export interface EmergencyStopSignal {
  id: string;
  name: string;
  triggered: boolean;
}

export interface MacroEvent {
  id: string;
  title: string;
  date: string; // ISO 8601
  dDay: number;
  type: 'MACRO' | 'EARNINGS' | 'POLICY';
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  strategyAdjustment: string;
  probability?: number; // e.g., 55 for surprise probability
}

export interface RecommendationHistory {
  stockCode: string;
  stockName: string;
  recommendedAt: string;      // "2026-03-15"
  priceAtRecommend: number;   // 245,000
  type: 'STRONG_BUY' | 'BUY';
  stopLoss: number;
  targetPrice: number;
  outcome: 'WIN' | 'LOSS' | 'PENDING';
  actualReturn: number;       // +12.3% or -8.5%
}

export interface BacktestPosition {
  stockCode: string;
  stockName: string;
  entryPrice: number;
  quantity: number;
  entryDate: string;
  stopLoss: number;
  takeProfit: number;
  currentPrice: number;
  unrealizedReturn: number;
}

export interface BacktestPortfolioState {
  cash: number;
  positions: BacktestPosition[];
  equity: number;
  initialEquity: number;
}

export interface BacktestDailyLog {
  date: string;
  equity: number;
  cash: number;
  positionsValue: number;
  drawdown: number;
  returns: number;
  benchmarkValue: number;
}

export interface BacktestResult {
  dailyLogs: BacktestDailyLog[];
  finalEquity: number;
  totalReturn: number;
  cagr: number;
  mdd: number;
  sharpe: number;
  winRate: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  maxConsecutiveLoss: number;
  trades: number;
  cumulativeReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  volatility: number;
  performanceData: { date: string; value: number; benchmark: number }[];
  aiAnalysis: string;
  optimizationSuggestions: {
    stock: string;
    action: 'INCREASE' | 'DECREASE' | 'MAINTAIN' | 'REMOVE';
    currentWeight: number;
    recommendedWeight: number;
    reason: string;
  }[];
  newThemeSuggestions?: {
    theme: string;
    stocks: string[];
    reason: string;
  }[];
  riskyStocks?: {
    stock: string;
    reason: string;
    riskLevel: 'HIGH' | 'MEDIUM';
  }[];
  riskMetrics: {
    beta: number;
    alpha: number;
    treynorRatio: number;
  };
}

export interface Portfolio {
  id: string;
  name: string;
  items: { name: string; code: string; weight: number }[];
  createdAt: string;
  description?: string;
  lastBacktestResult?: BacktestResult | null;
}
