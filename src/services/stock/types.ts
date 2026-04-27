// @responsibility stock types 서비스 모듈
import type {
  SectorRotation,
  MultiTimeframe,
  TranchePlan,
  EnemyChecklist,
  SeasonalityData,
  AttributionAnalysis,
  MacroEvent,
} from "../../types/quant";
import type { FibonacciTimeZoneResult } from "../quant/fibonacciTimeZoneEngine";
import type { InstitutionalFootprintResult } from "../quant/institutionalFootprintEngine";

export interface WalkForwardAnalysis {
  period: string;
  robustnessScore: number;
  overfittingRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  trendAdaptability: {
    aiSemiconductor: number;
    valueUp: number;
    overall: number;
  };
  metrics: {
    sharpeRatio: { inSample: number; outOfSample: number };
    maxDrawdown: { inSample: number; outOfSample: number };
    winRate: { inSample: number; outOfSample: number };
  };
  insights: string[];
  recommendations: string[];
}

export interface NewsArticle {
  headline: string;
  date: string;
  url: string;
}

export interface ChartPattern {
  name: string;
  type: 'BULLISH' | 'BEARISH' | 'REVERSAL_BULLISH' | 'REVERSAL_BEARISH' | 'NEUTRAL';
  description: string;
  reliability: number; // 0 to 100
}

export interface StockRecommendation {
  name: string;
  code: string;
  corpCode?: string; // DART 8-digit corp code
  reason: string;
  type: 'STRONG_BUY' | 'BUY' | 'STRONG_SELL' | 'SELL';
  gate?: 1 | 2 | 3;
  patterns: string[];
  hotness: number;
  latestNews?: NewsArticle[];
  roeType: string;
  isLeadingSector: boolean;
  momentumRank: number;
  supplyQuality: {
    passive: boolean;
    active: boolean;
  };
  peakPrice: number;
  currentPrice: number;
  isPreviousLeader: boolean;
  ichimokuStatus: 'ABOVE_CLOUD' | 'INSIDE_CLOUD' | 'BELOW_CLOUD';
  relatedSectors: string[];
  valuation: {
    per: number;
    pbr: number;
    epsGrowth: number;
    debtRatio: number;
  };
  technicalSignals: {
    maAlignment: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
    rsi: number;
    macdStatus: 'GOLDEN_CROSS' | 'DEAD_CROSS' | 'NEUTRAL';
    bollingerStatus: 'LOWER_TOUCH' | 'CENTER_REVERSION' | 'EXPANSION' | 'NEUTRAL';
    stochasticStatus: 'OVERSOLD' | 'OVERBOUGHT' | 'NEUTRAL';
    volumeSurge: boolean;
    disparity20: number;
    macdHistogram: number;
    bbWidth: number;
    stochRsi: number;
    macdHistogramDetail?: {
      status: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
      implication: string;
    };
    bbWidthDetail?: {
      status: 'SQUEEZE' | 'EXPANSION' | 'NEUTRAL';
      implication: string;
    };
    stochRsiDetail?: {
      status: 'OVERSOLD' | 'OVERBOUGHT' | 'NEUTRAL';
      implication: string;
    };
  };
  economicMoat: {
    type: 'BRAND' | 'NETWORK' | 'SCALE' | 'NONE';
    description: string;
  };
  disclosureSentiment?: {
    score: number;
    summary: string;
  };
  shortSelling?: {
    ratio: number;
    trend: 'INCREASING' | 'DECREASING';
    implication: string;
  };
  tenbaggerDNA?: {
    similarity: number;
    matchPattern: string;
    reason: string;
  };
  multiTimeframe?: MultiTimeframe;
  enemyChecklist?: EnemyChecklist;
  seasonality?: SeasonalityData;
  attribution?: AttributionAnalysis;
  tranchePlan?: TranchePlan;
  supplyData?: {
    foreignNet: number;
    institutionNet: number;
    individualNet: number;
    foreignConsecutive: number;
    institutionalDailyAmounts?: number[];
    isPassiveAndActive: boolean;
    dataSource: string;
  };
  correlationScore?: number;
  isPullbackVolumeLow?: boolean; // 1순위: 눌림목 거래량 감소 여부
  sectorLeaderNewHigh?: boolean; // 2순위: 대장주 신고가 경신 여부
  scores: {
    value: number;
    momentum: number;
  };
  marketSentiment: {
    iri: number;
    vkospi: number;
    fearAndGreed?: number;
    exchangeRate?: number;
    bondYield?: number;
  };
  confidenceScore: number;
  marketCap: number;
  marketCapCategory: 'LARGE' | 'MID' | 'SMALL';
  isSectorTopPick?: boolean;
  correlationGroup: string;
  aiConvictionScore: {
    totalScore: number;
    factors: { name: string; score: number; weight: number }[];
    marketPhase: 'BULL' | 'BEAR' | 'SIDEWAYS' | 'TRANSITION' | 'NEUTRAL' | 'RISK_ON' | 'RISK_OFF';
    description: string;
  };
  riskFactors: string[];
  targetPrice: number;
  targetPrice2?: number;
  stopLoss: number;
  entryPrice?: number;
  entryPrice2?: number;
  checklist: {
    cycleVerified: number;
    momentumRanking: number;
    roeType3: number;
    supplyInflow: number;
    riskOnEnvironment: number;
    ichimokuBreakout: number;
    mechanicalStop: number;
    economicMoatVerified: number;
    notPreviousLeader: number;
    technicalGoldenCross: number;
    volumeSurgeVerified: number;
    institutionalBuying: number;
    consensusTarget: number;
    earningsSurprise: number;
    performanceReality: number;
    policyAlignment: number;
    psychologicalObjectivity: number;
    turtleBreakout: number;
    fibonacciLevel: number;
    elliottWaveVerified: number;
    ocfQuality: number;
    marginAcceleration: number;
    interestCoverage: number;
    relativeStrength: number;
    vcpPattern: number;
    divergenceCheck: number;
    catalystAnalysis: number;
  };
  catalystDetail?: {
    description: string;
    score: number;
    upcomingEvents: string[];
  };
  catalystSummary?: string; // New: 촉매제 분석 통과 이유 요약
  visualReport: {
    financial: number;
    technical: number;
    supply: number;
    summary: string;
  };
  elliottWaveStatus?: {
    wave: 'WAVE_1' | 'WAVE_2' | 'WAVE_3' | 'WAVE_4' | 'WAVE_5' | 'WAVE_A' | 'WAVE_B' | 'WAVE_C';
    description: string;
  };
  analystRatings?: {
    strongBuy: number;
    buy: number;
    strongSell: number;
    sell: number;
    consensus: string;
    targetPriceAvg: number;
    targetPriceHigh: number;
    targetPriceLow: number;
    sources: string[];
  };
  analystSentiment?: string;
  newsSentiment?: {
    score: number;
    status: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
    summary: string;
  };
  chartPattern?: ChartPattern;
  roeAnalysis?: {
    drivers: string[];
    historicalTrend: string;
    strategy: string;
    metrics: {
      netProfitMargin: number;
      assetTurnover: number;
      equityMultiplier: number;
    };
  };
  strategicInsight?: {
    cyclePosition: 'NEW_LEADER' | 'MATURING' | 'FADING_STAR';
    earningsQuality: string;
    policyContext: string;
  };
  sectorAnalysis?: {
    sectorName: string;
    currentTrends: string[];
    leadingStocks: { name: string; code: string; marketCap: string }[];
    catalysts: string[];
    riskFactors: string[];
  };
  dataSource?: string;
  dataSourceType?: 'AI' | 'REALTIME' | 'YAHOO' | 'STALE'; // 신뢰도 계층
  /**
   * PR-B (ADR-0029): 27 조건 항목별 실제 데이터 출처 메타.
   * 부재 시 PR-A 휴리스틱 fallback (`classifyDataQuality` 가 키 그룹 기반 분류).
   */
  conditionSourceTiers?: Partial<Record<keyof StockRecommendation['checklist'], 'COMPUTED' | 'API' | 'AI_INFERRED'>>;
  priceUpdatedAt?: string;
  financialUpdatedAt?: string; // Added field for DART data
  historicalAnalogy: {
    stockName: string;
    period: string;
    similarity: number;
    reason: string;
  };
  anomalyDetection: {
    type: 'FUNDAMENTAL_DIVERGENCE' | 'SMART_MONEY_ACCUMULATION' | 'NONE';
    score: number;
    description: string;
  };
  semanticMapping: {
    theme: string;
    keywords: string[];
    relevanceScore: number;
    description: string;
  };
  gateEvaluation?: {
    gate1Passed: boolean;
    gate2Passed: boolean;
    gate3Passed: boolean;
    finalScore: number;
    recommendation: string;
    positionSize: number;
    isPassed?: boolean;
    currentGate?: number;
    // enrichment 단계에서 27-항목 checklist 에서 계산된 세부 게이트.
    // GateFilterSection 이 {score, reason, isPassed} 형태로 렌더한다.
    gate1?: { score: number; isPassed: boolean; reason: string };
    gate2?: { score: number; isPassed: boolean; reason: string };
    gate3?: { score: number; isPassed: boolean; reason: string };
  };
  sellScore?: number;
  sellSignals?: { condition: string; reason: string }[];
  watchedPrice?: number;   // 관심종목 추가 시점 가격
  watchedAt?: string;      // 추가 날짜
  fibonacciTimeZone?: FibonacciTimeZoneResult;          // 피보나치 타임존 분석 결과
  institutionalFootprint?: InstitutionalFootprintResult; // 기관 매집 발자국 분석 결과
}

export interface AdvancedAnalysisResult {
  type: 'BACKTEST' | 'WALK_FORWARD' | 'PAPER_TRADING';
  period: string;
  metrics: {
    totalReturn?: number;
    winRate?: number;
    maxDrawdown?: number;
    sharpeRatio?: number;
    accuracy?: number;
    robustnessScore?: number;
  };
  performanceData?: { date: string; value: number; benchmark: number }[];
  topContributors?: { name: string; weight: number; impact: 'POSITIVE' | 'NEGATIVE' }[];
  noiseItems?: string[];
  description: string;
  paperTradeLogs?: {
    date: string;
    picks: {
      name: string;
      code: string;
      entryPrice: number;
      stopLoss: number;
      targetPrice: number;
      currentPrice: number;
      status: 'OPEN' | 'PROFIT' | 'LOSS' | 'CLOSED';
      catalyst: string;
      pnl?: number;
    }[];
    aiFeedback: string;
  }[];
}

export interface MarketDataPoint {
  name: string;
  value: number;
  change: number;
  changePercent: number;
  history?: { date: string; value: number }[];
}

export interface SnsSentiment {
  score: number; // 0 to 100
  status: 'EXTREME_FEAR' | 'FEAR' | 'NEUTRAL' | 'GREED' | 'EXTREME_GREED';
  summary: string;
  trendingKeywords: string[];
}

export interface EuphoriaSignal {
  score: number;
  status: string;
  implication: string;
}

export interface GlobalEtfMonitoring {
  symbol?: string;
  name: string;
  price?: number;
  change: number;
  signal?: 'BUY' | 'SELL' | 'HOLD';
  reason?: string;
  implication?: string;
  flow?: 'INFLOW' | 'OUTFLOW';
}

export interface MarketOverview {
  indices: MarketDataPoint[];
  exchangeRates: MarketDataPoint[];
  commodities: MarketDataPoint[];
  interestRates: MarketDataPoint[];
  macroIndicators?: MarketDataPoint[];
  snsSentiment?: SnsSentiment;
  sectorRotation?: {
    topSectors: SectorRotation[];
  };
  euphoriaSignals?: EuphoriaSignal;
  regimeShiftDetector?: {
    currentRegime: string;
    shiftProbability: number;
    leadingIndicator: string;
    isShiftDetected?: boolean;
  };
  globalEtfMonitoring?: GlobalEtfMonitoring[];
  marketPhase?: string;
  activeStrategy?: string;
  dynamicWeights?: Record<number, number>;
  upcomingEvents?: MacroEvent[];
  summary: string;
  lastUpdated: string;
  triageSummary?: {
    gate1: number;
    gate2: number;
    gate3: number;
    total: number;
  };
}

export interface MarketContext {
  kospi: {
    index: number;
    change: number;
    changePercent: number;
    status: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'BULL' | 'BEAR';
    analysis: string;
    ma200?: number;
  };
  kosdaq: {
    index: number;
    change: number;
    changePercent: number;
    status: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'BULL' | 'BEAR';
    analysis: string;
  };
  globalIndices?: {
    nasdaq: { index: number; changePercent: number };
    snp500: { index: number; changePercent: number };
    dow: { index: number; changePercent: number };
    sox: { index: number; changePercent: number };
  };
  globalMacro?: {
    us10yYield: number;
    brentOil: number;
    gold: number;
    dollarIndex: number;
  };
  fearAndGreed?: { value: number; status: string };
  iri?: number;
  vkospi?: number;
  volumeTrend?: string;
  exchangeRate?: { value: number; change: number };
  bondYield?: { value: number; change: number };
  overallSentiment?: string;
  marketPhase?: string;
  activeStrategy?: string;
  upcomingEvents?: MacroEvent[];
  dataSource?: string;
  sectorRotation?: {
    topSectors: SectorRotation[];
  };
  euphoriaSignals?: EuphoriaSignal;
  regimeShiftDetector?: {
    currentRegime: string;
    shiftProbability: number;
    leadingIndicator: string;
    isShiftDetected?: boolean;
  };
  globalEtfMonitoring?: GlobalEtfMonitoring[];
}

export interface MarketPhaseLog {
  timestamp: string;
  phase: 'BULL' | 'BEAR' | 'SIDEWAYS' | 'TRANSITION' | 'NEUTRAL' | 'RISK_ON' | 'RISK_OFF';
  reason: string;
  kospiIndex: number;
  kospi200ma: number;
  vkospi: number;
}

export interface RecommendationResponse {
  marketContext: MarketContext;
  recommendations: StockRecommendation[];
  /**
   * 사용자에게 노출할 안내 메시지. AI 추천 universe 발굴이 degrade 되었거나
   * (Google 미설정·예산 초과) fallback seed 가 사용된 경우 그 사유를 기록한다.
   * 있으면 프론트엔드가 `toast.warning` 등으로 표시한다. 비어있으면 생략.
   */
  warnings?: string[];
  /**
   * ADR-0016 (PR-37) 5-Tier fallback diagnostics. 서버가 응답에 동봉하면
   * `RecommendationWarningsBanner` 가 sourceStatus 별 정밀 분기 + marketMode 표기.
   * 모두 옵셔널 — 비파괴 확장. 미제공 시 기존 warnings[] 만 표시.
   */
  sourceStatus?:
    | 'GOOGLE_OK'
    | 'FALLBACK_SNAPSHOT'
    | 'FALLBACK_QUANT'
    | 'FALLBACK_NAVER'
    | 'FALLBACK_SEED'
    | 'NOT_CONFIGURED'
    | 'BUDGET_EXCEEDED'
    | 'ERROR'
    | 'NO_MATCHES';
  marketMode?: 'LIVE_TRADING_DAY' | 'AFTER_MARKET' | 'WEEKEND_CACHE' | 'HOLIDAY_CACHE' | 'DEGRADED';
  tradingDateRef?: string | null;
  snapshotAgeDays?: number | null;
}

// ─── 유니버스 선택 (Gate-0) ─────────────────────────────────────────────────

export type UniversePreset =
  | 'KOSPI200'        // KOSPI 200 구성종목
  | 'KOSDAQ150'       // KOSDAQ 150 구성종목
  | 'ALL'             // 전체 상장 (KOSPI + KOSDAQ)
  | 'CUSTOM';         // 커스텀 유니버스

export type UniverseMarket = 'J' | 'Q' | 'JQ';  // J=KOSPI, Q=KOSDAQ, JQ=Both

export interface UniverseFilter {
  minMarketCapBillion?: number;   // 시총 하한 (억원)
  volumeTopPercent?: number;      // 거래량 상위 N%
  foreignOwned?: boolean;         // 외국인 편입 종목만
}

export interface UniverseConfig {
  preset: UniversePreset;
  market: UniverseMarket;
  filters: UniverseFilter;
}

export interface StockFilters {
  minRoe?: number;
  maxPer?: number;
  maxDebtRatio?: number;
  minMarketCap?: number;
  mode?: 'MOMENTUM' | 'EARLY_DETECT' | 'QUANT_SCREEN' | 'BEAR_SCREEN' | 'SMALL_MID_CAP';
  universe?: UniverseConfig;
}

