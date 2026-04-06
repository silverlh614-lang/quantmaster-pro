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

// ─── Gate 0: 거시 환경 생존 게이트 ───────────────────────────────────────────

export type RateCycle = 'TIGHTENING' | 'EASING' | 'PAUSE';
export type FXRegime = 'DOLLAR_STRONG' | 'DOLLAR_WEAK' | 'NEUTRAL';

/** 거시 환경 4개 축 입력 데이터 */
export interface MacroEnvironment {
  // 금리 축
  bokRateDirection: 'HIKING' | 'HOLDING' | 'CUTTING'; // 한국은행 기준금리 방향
  us10yYield: number;          // 미국 10년 국채 금리 (%)
  krUsSpread: number;          // 한미 금리 스프레드 (pp, 음수 = 역전)
  // 유동성 축
  m2GrowthYoY: number;         // M2 증가율 YoY (%)
  bankLendingGrowth: number;   // 은행 여신 증가율 (%)
  nominalGdpGrowth: number;    // 명목 GDP 성장률 (%)
  // 경기 축
  oeciCliKorea: number;        // OECD 경기선행지수 한국 (100 기준)
  exportGrowth3mAvg: number;   // 수출증가율 3개월 이동평균 (%)
  // 리스크 축
  vkospi: number;              // VKOSPI
  samsungIri: number;          // 삼성 IRI (1.0 = 중립, <0.7 = 매도 압력)
  vix: number;                 // VIX
  // 환율
  usdKrw: number;              // 원/달러 환율
}

/** Gate 0 평가 결과 */
export interface Gate0Result {
  passed: boolean;
  macroHealthScore: number;    // MHS 0-100
  mhsLevel: 'HIGH' | 'MEDIUM' | 'LOW'; // HIGH ≥70 / MEDIUM 40-69 / LOW <40
  kellyReduction: number;      // 포지션 축소율: 0=정상, 0.5=50%축소, 1.0=매수중단
  buyingHalted: boolean;       // MHS < 40 → 전면 매수 중단
  rateCycle: RateCycle;
  fxRegime: FXRegime;
  details: {
    interestRateScore: number; // 0-25
    liquidityScore: number;    // 0-25
    economicScore: number;     // 0-25
    riskScore: number;         // 0-25
  };
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
  gate0Result?: Gate0Result;       // Gate 0: 거시 환경 생존 게이트 결과
  gate1Passed: boolean;
  gate2Passed: boolean;
  gate3Passed: boolean;
  gate1Score: number;
  gate2Score: number;
  gate3Score: number;
  finalScore: number;
  fxAdjustmentFactor: number;      // FX 조정 팩터 (-3 ~ +3)
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

// ─── 경기 사이클 레짐 분류기 (Idea 2) ────────────────────────────────────────

export type EconomicRegime = 'RECOVERY' | 'EXPANSION' | 'SLOWDOWN' | 'RECESSION';

/**
 * ROE 5유형
 * 1: 레버리지 의존형 (부채 기반 자산 확장)
 * 2: 자본경량형 (무형자산·플랫폼 기반)
 * 3: 매출·마진 동반 성장형 (최강 알파 유형)
 * 4: 비용 통제형 (매출 정체, 비용 절감)
 * 5: 재무 왜곡형 (자사주 매입·자본 축소)
 */
export type ROEType = 1 | 2 | 3 | 4 | 5;

/** Gemini 기반 경기 레짐 분류 결과 */
export interface EconomicRegimeData {
  regime: EconomicRegime;
  confidence: number;        // 0-100
  rationale: string;         // 분류 근거 요약
  allowedSectors: string[];  // 현재 레짐 허용 섹터 화이트리스트
  avoidSectors: string[];    // 회피 섹터
  keyIndicators: {
    exportGrowth: string;       // 수출 증가율
    bokRateDirection: string;   // 한국은행 금리 방향
    oeciCli: string;            // OECD CLI 수치
    gdpGrowth: string;          // GDP 성장률
  };
  lastUpdated: string;
}

export interface Portfolio {
  id: string;
  name: string;
  items: { name: string; code: string; weight: number }[];
  createdAt: string;
  description?: string;
  lastBacktestResult?: BacktestResult | null;
}
