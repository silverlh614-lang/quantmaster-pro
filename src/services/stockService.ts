import { GoogleGenAI, GenerateContentResponse, ThinkingLevel } from "@google/genai";
import { 
  SectorRotation,
  MultiTimeframe,
  TranchePlan,
  EnemyChecklist,
  SeasonalityData,
  AttributionAnalysis,
  MacroEvent,
  BacktestResult,
  BacktestPosition,
  BacktestPortfolioState,
  BacktestDailyLog,
  Portfolio
} from "../types/quant";

import {
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateStochastic,
  calculateIchimoku,
  detectVCP,
  calculateDisparity
} from "../utils/indicators";

export type { 
  BacktestResult,
  BacktestPosition,
  BacktestPortfolioState,
  BacktestDailyLog,
  Portfolio
};

const getAI = () => {
  // Check for user-provided key in localStorage first
  const userKey = typeof window !== 'undefined' ? localStorage.getItem('k-stock-api-key') : null;
  // Fallback to platform-provided keys
  const apiKey = userKey || process.env.API_KEY || process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    throw new Error("API Key is missing. Please provide an API key in settings.");
  }
  
  return new GoogleGenAI({ apiKey });
};

// Simple in-memory cache for AI responses to improve consistency and reduce API calls
const aiCache: Record<string, { data: any; timestamp: number }> = {};
const CACHE_TTL = 1000 * 60 * 30; // 30 minutes

async function getCachedAIResponse<T>(cacheKey: string, fetchFn: () => Promise<T>): Promise<T> {
  const cached = aiCache[cacheKey];
  const now = Date.now();
  
  if (cached && (now - cached.timestamp < CACHE_TTL)) {
    console.log(`Using cached AI response for: ${cacheKey.substring(0, 50)}...`);
    return cached.data as T;
  }
  
  const data = await fetchFn();
  aiCache[cacheKey] = { data, timestamp: now };
  return data;
}

async function withRetry<T>(fn: () => Promise<T>, retries = 2, delay = 2000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    // Extract error details from potential nested structures
    let errObj = error?.error || error;
    let message = "";
    let status: string | number = "";
    let code: string | number = "";

    if (typeof error === 'string') {
      message = error;
      try {
        const parsed = JSON.parse(error);
        errObj = parsed.error || parsed;
      } catch (e) {
        // Not JSON, just use the string
      }
    }

    if (typeof errObj === 'object' && errObj !== null) {
      message = errObj.message || message || "";
      status = errObj.status || "";
      code = errObj.code || "";
    } else if (typeof errObj === 'string') {
      message = errObj;
    }

    const isRateLimit = message.includes('429') || status === 429 || code === 429 || status === 'RESOURCE_EXHAUSTED' || message.includes('quota');
    const isServerError = message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504') || 
                        status === 500 || status === 502 || status === 503 || status === 504 || 
                        code === 500 || code === 502 || code === 503 || code === 504 || 
                        status === 'UNKNOWN' || status === 'Internal Server Error' || (typeof status === 'string' && status.includes('500'));
    const isXhrError = message.toLowerCase().includes('xhr error') || message.toLowerCase().includes('rpc failed') || 
                      message.toLowerCase().includes('failed to fetch') || message.toLowerCase().includes('networkerror') ||
                      message.toLowerCase().includes('aborted') || message.toLowerCase().includes('timeout') ||
                      message.toLowerCase().includes('deadline exceeded');
    const isAiError = message.includes('No response from AI') || message.includes('Failed to parse AI response');
    
    if (isRateLimit) {
      throw new Error('API 할당량 초과. 잠시 후 다시 시도해주세요.');
    }

    if ((isServerError || isXhrError || isAiError) && retries > 0) {
      const waitTime = delay;
      console.warn(`Transient error hit (${message || status || code}). Retrying in ${waitTime}ms... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return withRetry(fn, retries - 1, waitTime * 1.5);
    }
    throw error;
  }
}

function safeJsonParse(text: string | undefined): any {
  if (!text) return {};
  try {
    // 0. Extract JSON from markdown code blocks if present
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    let cleaned = jsonMatch ? jsonMatch[1].trim() : text.trim();
    
    // If it's still not starting with [ or {, find the first occurrence
    if (!cleaned.startsWith('[') && !cleaned.startsWith('{')) {
      const firstBracket = cleaned.indexOf('[');
      const firstBrace = cleaned.indexOf('{');
      let startIndex = -1;
      if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
        startIndex = firstBracket;
      } else if (firstBrace !== -1) {
        startIndex = firstBrace;
      }
      
      if (startIndex !== -1) {
        cleaned = cleaned.substring(startIndex);
      }
    }

    // 1. Handle unclosed strings if truncated
    let isInsideString = false;
    let escaped = false;
    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i] === '\\' && !escaped) {
        escaped = true;
      } else if (cleaned[i] === '"' && !escaped) {
        isInsideString = !isInsideString;
        escaped = false;
      } else {
        escaped = false;
      }
    }

    if (isInsideString) {
      cleaned += '"';
    }

    // 2. Strip trailing partial content (like "key": or "key": "part...)
    // If it's NOT inside a string, we can safely check for trailing colons/commas
    if (!isInsideString) {
      // Remove trailing colon and the key preceding it
      // Matches: , "key" : or just "key" : at the end
      const keyTrailingMatch = cleaned.match(/(?:,\s*)?"[^"]*"\s*:\s*$/);
      if (keyTrailingMatch) {
        cleaned = cleaned.substring(0, cleaned.length - keyTrailingMatch[0].length);
      }
      
      // Remove trailing comma
      cleaned = cleaned.replace(/,\s*$/, '');
    }

    // 3. Attempt to fix truncated JSON by adding missing closing braces/brackets
    let stack: string[] = [];
    isInsideString = false;
    escaped = false;
    
    for (let i = 0; i < cleaned.length; i++) {
      const char = cleaned[i];
      if (char === '\\' && !escaped) {
        escaped = true;
        continue;
      }
      
      if (char === '"' && !escaped) {
        isInsideString = !isInsideString;
      }
      
      if (!isInsideString) {
        if (char === '{') stack.push('}');
        else if (char === '[') stack.push(']');
        else if (char === '}') {
          if (stack.length > 0 && stack[stack.length - 1] === '}') stack.pop();
        } else if (char === ']') {
          if (stack.length > 0 && stack[stack.length - 1] === ']') stack.pop();
        }
      }
      escaped = false;
    }
    
    const originalCleaned = cleaned;
    if (stack.length > 0) {
      cleaned += stack.reverse().join('');
    }

    try {
      return JSON.parse(cleaned);
    } catch (innerError) {
      // If simple fix failed, try more aggressive cleanup
      try {
        // Try to find the last complete object in an array if it's an array
        if (originalCleaned.startsWith('[')) {
          let tempCleaned = originalCleaned;
          let attempts = 0;
          while (attempts < 5) {
            const braceIdx = tempCleaned.lastIndexOf('}');
            if (braceIdx === -1) break;
            
            const truncated = tempCleaned.substring(0, braceIdx + 1) + ']';
            try {
              return JSON.parse(truncated);
            } catch (e) {
              tempCleaned = tempCleaned.substring(0, braceIdx);
              attempts++;
            }
          }
        }
        
        // Final attempt: aggressive comma cleanup
        let aggressiveCleaned = cleaned.replace(/,\s*([\]\}])/g, '$1'); 
        return JSON.parse(aggressiveCleaned);
      } catch (finalError) {
        throw innerError;
      }
    }
  } catch (e) {
    console.error("JSON Parse Error. Original text:", text);
    throw new Error(`Failed to parse AI response as JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

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
  dataSourceType?: 'AI' | 'REALTIME'; // Added field
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
  };
  sellScore?: number;
  sellSignals?: { condition: string; reason: string }[];
  watchedPrice?: number;   // 관심종목 추가 시점 가격
  watchedAt?: string;      // 추가 날짜
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
  symbol: string;
  name: string;
  price: number;
  change: number;
  signal: 'BUY' | 'SELL' | 'HOLD';
  reason: string;
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
}

export function calculateTranchePlan(currentPrice: number, stopLoss: number, targetPrice: number): TranchePlan {
  const risk = currentPrice - stopLoss;
  const reward = targetPrice - currentPrice;
  
  return {
    tranche1: { size: 30, trigger: `${currentPrice.toLocaleString()} (즉시)`, status: 'PENDING' },
    tranche2: { size: 40, trigger: `${Math.round(currentPrice - (risk * 0.382)).toLocaleString()} (피보나치 38.2%)`, status: 'PENDING' },
    tranche3: { size: 30, trigger: `${Math.round(currentPrice + (reward * 0.1)).toLocaleString()} (모멘텀 가속)`, status: 'PENDING' }
  };
}

export interface StockFilters {
  minRoe?: number;
  maxPer?: number;
  maxDebtRatio?: number;
  minMarketCap?: number;
  mode?: 'MOMENTUM' | 'EARLY_DETECT';
}

export async function enrichStockWithRealData(stock: StockRecommendation): Promise<StockRecommendation> {
  try {
    const data = await fetchHistoricalData(stock.code, '1y');
    if (!data || !data.timestamp || !data.indicators?.quote?.[0]) {
      return { ...stock, dataSourceType: 'AI' };
    }

    const quotes = data.indicators.quote[0];
    const closes = (quotes.close as (number | null)[]).filter((v): v is number => v !== null);
    const highs = (quotes.high as (number | null)[]).filter((v): v is number => v !== null);
    const lows = (quotes.low as (number | null)[]).filter((v): v is number => v !== null);
    const volumes = (quotes.volume as (number | null)[]).filter((v): v is number => v !== null);

    if (closes.length < 26) return { ...stock, dataSourceType: 'AI' };

    const rsi = calculateRSI(closes);
    const macd = calculateMACD(closes);
    const bb = calculateBollingerBands(closes);
    const stoch = calculateStochastic(highs, lows, closes);
    const ichimoku = calculateIchimoku(highs, lows, closes);
    const vcp = detectVCP(closes, volumes);
    const disparity = calculateDisparity(closes);

    const currentPrice = closes[closes.length - 1];
    
    // Fetch DART Financial Data if corpCode is available
    let dartFinancials = null;
    
    // Auto-fetch corpCode if missing
    if (!stock.corpCode) {
      stock.corpCode = await fetchCorpCode(stock.code) || undefined;
    }

    if (stock.corpCode) {
      dartFinancials = await fetchDartFinancials(stock.corpCode);
    }

    // Fetch KIS Supply & Short Selling data for Korean stocks
    let kisSupply = null;
    let kisShort = null;
    const isKoreanStock = /^\d{6}$/.test(stock.code.split('.')[0]);
    if (isKoreanStock) {
      const baseCode = stock.code.split('.')[0];
      kisSupply = await fetchKisSupply(baseCode);
      kisShort = await fetchKisShortSelling(baseCode);
    }

    // Update stock with real data
    const enriched: StockRecommendation = {
      ...stock,
      currentPrice: currentPrice || stock.currentPrice,
      dataSourceType: 'REALTIME',
      priceUpdatedAt: `${new Date().toLocaleTimeString('ko-KR')} (Real-time)`,
      supplyData: kisSupply || stock.supplyData,
      shortSelling: kisShort || stock.shortSelling,
      technicalSignals: {
        ...stock.technicalSignals,
        rsi: Math.round(rsi * 10) / 10,
        macdStatus: macd.status,
        macdHistogram: Math.round(macd.histogram * 100) / 100,
        macdHistogramDetail: {
          status: macd.histogram > 0 ? 'BULLISH' : 'BEARISH',
          implication: macd.histogram > 0 
            ? 'MACD 히스토그램 양수 전환으로 상승 모멘텀이 강화되고 있습니다.' 
            : 'MACD 히스토그램 음수권으로 하락 압력이 존재합니다.'
        },
        bollingerStatus: bb?.status || 'NEUTRAL',
        bbWidth: bb ? Math.round(bb.width * 1000) / 1000 : 0,
        bbWidthDetail: {
          status: bb?.width && bb.width < 0.05 ? 'SQUEEZE' : (bb?.width && bb.width > 0.15 ? 'EXPANSION' : 'NEUTRAL'),
          implication: bb?.width && bb.width < 0.05 
            ? '볼린저 밴드 스퀴즈 발생으로 조만간 큰 변동성이 예상됩니다.' 
            : (bb?.width && bb.width > 0.15 ? '밴드 확장 중으로 현재 추세가 강하게 유지되고 있습니다.' : '정상적인 변동성 범위 내에 있습니다.')
        },
        stochasticStatus: stoch?.status || 'NEUTRAL',
        stochRsi: stoch ? Math.round(stoch.k * 10) / 10 : 0,
        stochRsiDetail: {
          status: stoch?.status || 'NEUTRAL',
          implication: stoch?.status === 'OVERSOLD' 
            ? '스토캐스틱 과매도 구간으로 기술적 반등 가능성이 높습니다.' 
            : (stoch?.status === 'OVERBOUGHT' ? '과매수 구간으로 단기 차익 실현 매물에 주의가 필요합니다.' : '중립적인 수급 상태입니다.')
        },
        disparity20: Math.round(disparity * 10) / 10,
        volumeSurge: vcp // Using VCP as a proxy for volume surge/tightening logic
      },
      ichimokuStatus: ichimoku.status,
      checklist: {
        ...stock.checklist,
        vcpPattern: vcp ? 1 : 0,
        // Update with DART data if available
        roeType3: (dartFinancials?.roe ?? 0) >= 15 ? 1 : 0,
        ocfQuality: dartFinancials?.ocfGreaterThanNetIncome ? 1 : 0,
        interestCoverage: (dartFinancials?.interestCoverageRatio ?? 0) >= 3 ? 1 : 0,
        // Update with KIS data if available
        institutionalBuying: kisSupply?.institutionNet > 0 ? 1 : 0,
        supplyInflow: kisSupply?.foreignNet > 0 ? 1 : 0,
      },
      valuation: {
        ...stock.valuation,
        debtRatio: dartFinancials?.debtRatio || stock.valuation.debtRatio,
      },
      financialUpdatedAt: dartFinancials?.updatedAt || stock.financialUpdatedAt
    };

    if (dartFinancials) {
      enriched.roeAnalysis = {
        historicalTrend: stock.roeAnalysis?.historicalTrend || 'N/A',
        strategy: stock.roeAnalysis?.strategy || 'N/A',
        ...stock.roeAnalysis,
        drivers: [
          `실제 ROE: ${dartFinancials.roe.toFixed(2)}% (DART 실계산)`,
          `이자보상배율: ${dartFinancials.interestCoverageRatio.toFixed(2)}배`,
          `OCF > 순이익: ${dartFinancials.ocfGreaterThanNetIncome ? 'YES' : 'NO'}`,
          ...(stock.roeAnalysis?.drivers || [])
        ],
        metrics: {
          netProfitMargin: dartFinancials.netProfitMargin,
          assetTurnover: stock.roeAnalysis?.metrics?.assetTurnover || 0,
          equityMultiplier: stock.roeAnalysis?.metrics?.equityMultiplier || 0,
        }
      };
    }

    return enriched;
  } catch (error) {
    console.error(`Error enriching stock ${stock.name}:`, error);
    return { ...stock, dataSourceType: 'AI' };
  }
}

export async function getStockRecommendations(filters?: StockFilters): Promise<RecommendationResponse | null> {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayDate = now.split(' ')[0];
  const mode = filters?.mode || 'MOMENTUM';

  const filterPrompt = filters ? `
      [사용자 정의 정량 필터]
      - ROE > ${filters.minRoe || 0}%
      - PER < ${filters.maxPer || 999}
      - 부채비율 < ${filters.maxDebtRatio || 999}%
      - 시가총액 > ${filters.minMarketCap || 0}억
      이 조건을 만족하는 종목들 중에서만 추천하라.
  ` : '';

  const momentumSearchQueries = [
    `오늘(${todayDate})의 코스피 지수`,
    `오늘의 코스닥 지수`,
    `코스피 200일 이동평균선(200MA)`,
    `오늘의 VKOSPI`,
    `미국 나스닥 지수 실시간`,
    `S&P 500 실시간`,
    `다우 지수 실시간`,
    `필라델피아 반도체 지수(SOX) 실시간`,
    `오늘의 한국 주도주`,
    `기관 대량 매수 종목 한국`,
    `외국인 순매수 상위 종목 한국`
  ];

  const earlyDetectSearchQueries = [
    `거래량 급감 횡보 종목 한국`,
    `52주 신고가 5% 이내 근접 종목 한국`,
    `기관 연속 소량 매수 종목 한국`,
    `볼린저밴드 수축 최저 종목 한국`,
    `VCP 패턴 종목 한국`,
    `섹터 대장주 신고가 경신 후 2등주`,
    `KODEX 조선 ETF 자금 유입`,
    `PLUS 방산 ETF 자금 유입`,
    `섹터 ETF 순자산 증가 종목`
  ];

  const searchQueries = mode === 'EARLY_DETECT' ? earlyDetectSearchQueries : momentumSearchQueries;

  const modePrompt = mode === 'EARLY_DETECT' ? `
      [선행 신호 우선 탐색 - 급등 전 종목 포착 모드]
      다음 조건을 모두 또는 대부분 충족하는 종목을 최우선으로 선정하라:
      1. 주가 상승률: 최근 1개월 기준 KOSPI/KOSDAQ 대비 아웃퍼폼하되, 단기(5일) 상승률은 3% 미만인 종목 (이미 급등한 종목 제외)
      2. 거래량 조건: 최근 3~5일 거래량이 20일 평균의 50% 이하로 마른 상태 (매도 물량 소진 신호, VCP 패턴)
      3. 기술적 위치: 52주 신고가 대비 -5% 이내 근접, 볼린저밴드 폭(BBWidth)이 최근 3개월 내 최저 수준, 주가가 주요 이평선(20일, 60일) 위에서 횡보 중
      4. 수급 조건: 기관이 최근 3~7일간 조용히 소량 순매수 중, 외국인 매수는 아직 본격화되지 않은 상태
      5. 섹터 조건: 해당 섹터 대장주가 이미 신고가를 경신했으나, 해당 종목은 아직 대장주 대비 상승률이 30% 이상 뒤처진 상태
      
      위 조건을 충족할수록 높은 confidenceScore를 부여하고, 이미 단기 급등(5일 기준 +15% 이상)한 종목은 추천에서 제외하라.
  ` : `
      [모멘텀 추종 - 현재 주도주 포착 모드]
      현재 시장에서 가장 강력한 상승 모멘텀을 가진 주도주를 선정하라.
      기관과 외국인의 동반 대량 매수가 확인되고, 신고가를 경신하며 추세가 강화되는 종목을 우선한다.
  `;

  const prompt = `
      [절대 원칙: 실시간성 보장 및 과거 데이터 배제]
      현재 한국 시각은 ${now}입니다. (오늘 날짜: ${todayDate})
      추천 모드: ${mode === 'EARLY_DETECT' ? '미리 볼 종목 (Early Detect)' : '지금 살 종목 (Momentum)'}
      
      ${filterPrompt}
      ${modePrompt}
      당신은 반드시 'googleSearch' 도구를 사용하여 '현재 시점의 실시간 데이터'만을 기반으로 응답해야 합니다.
      특히 해외 지수(나스닥, S&P 500 등)는 반드시 현재 시점의 실시간 또는 가장 최근 종가를 반영해야 합니다.
      과거의 훈련 데이터, 예시 데이터, 혹은 이전에 생성했던 데이터를 재사용하는 것은 엄격히 금지됩니다.
      조회 시 항상 현재(${now})를 기준으로 하는 조건을 강력하게 부여합니다.

      [중요 알림: 기술적 지표 실계산 시스템 도입]
      현재 시스템은 Yahoo Finance의 OHLCV 데이터를 기반으로 RSI, MACD, Bollinger Bands, VCP 패턴 등을 코드로 직접 계산합니다.
      따라서 당신은 이러한 수치를 '추정'할 필요가 없습니다. 대신, 검색을 통해 얻은 '현재가'와 '거래량' 데이터를 정확히 반영하고,
      이러한 지표들이 가리키는 '의미'와 '투자 전략'에 집중하여 분석을 수행하십시오.
      당신이 생성한 JSON 데이터는 이후 실시간 데이터로 'Enrichment(강화)' 과정을 거치게 됩니다.
      
      [필수 검색 단계 - 실시간 데이터 확보]
      1. 다음 쿼리들을 검색하여 시장 상황을 파악하라: ${searchQueries.join(', ')}
      2. 현재 시장 상황(BULL, BEAR, SIDEWAYS 등)에 가장 적합한 종목 3~5개를 선정하라.
      3. 선정된 각 종목에 대해 다음 정보를 'googleSearch'로 검색하라:
         - '네이버 증권 [종목명]' (현재가 및 시가총액 확인용)
         - '${todayDate} [종목명] 실시간 주가'
         - 'KRX:[종목코드] 주가'
      4. **[초정밀 가격 검증 및 시가총액 대조]**
         - 검색 결과에서 반드시 오늘(${todayDate}) 날짜와 현재 시각이 포함된 최신 가격 정보를 선택하라.
         - **[필수]** 해당 종목의 시가총액을 확인하여 [현재가 * 발행주식수 = 시가총액] 공식이 맞는지 검증하라. 자릿수 오류를 절대적으로 방지하라.
         - 여러 검색 결과(네이버 증권, 다음 금융, 구글 파이낸스 등)를 비교하여 가장 신뢰할 수 있는 데이터를 채택하라.
      5. **[DART corpCode 확보]** 각 종목에 대해 'DART 고유번호(corpCode, 8자리)'를 반드시 검색하여 'corpCode' 필드에 포함하라. 이는 이후 실시간 재무 데이터 연동에 필수적이다.
      6. **[차트 패턴 분석]** 각 종목의 최근 주가 흐름을 분석하여 다음 패턴 중 하나 이상이 발견되는지 확인하라:
         - 상승 패턴: 상승삼각형, 상승플래그, 상승패넌트, 컵 앤 핸들, 삼각수렴
         - 상승 반전: 쌍바닥(Double Bottom), 3중바닥, 하락쐐기, 역 헤드 앤 숄더(Inverse H&S), 라운드 바텀
         - 하락 패턴: 하락삼각형, 하락플래그, 하락패넌트, 상승쐐기
         - 하락 반전: 브로드닝 탑, 더블 탑(쌍봉), 트리플 탑, 헤드 앤 숄더(H&S), 라운드 탑, 다이아몬드 탑
      7. **[뉴스 데이터 확보]** 각 종목에 대해 가장 최근의 뉴스 기사 3개를 찾아 'latestNews' 필드에 [헤드라인, 날짜, URL] 형식으로 포함하라.
      7. **[판단 기준 - STRONG_BUY, BUY, STRONG_SELL, SELL]**
         - ${mode === 'EARLY_DETECT' ? 'EARLY_DETECT 모드에서는 거래량 마름과 횡보 후 돌파 직전 신호를 가장 높게 평가하라.' : 'MOMENTUM 모드에서는 강력한 수급과 추세 강도를 가장 높게 평가하라.'}
         [BUY/STRONG_BUY 발동 전 필수 선결 조건 - 하나라도 미충족 시 즉시 HOLD]
        ① Gate 1 전부 통과 필수: cycleVerified, roeType3, riskOnEnvironment, mechanicalStop, notPreviousLeader 중 하나라도 False이면 HOLD.
        ② RRR 최소 기준 필수: BUY 2.0 이상, STRONG_BUY 3.0 이상. 미충족 시 HOLD.
        ③ 일목균형표 구름대 위치 필수: ichimokuStatus가 ABOVE_CLOUD 상태여야만 BUY 허용.
        ④ 다이버전스 부재 필수: divergenceCheck가 False이면 STRONG_BUY 발동 금지 (BUY로 강등).

        [BUY 수치 임계값 — 반드시 모두 충족]
        - 기술적 조건: RSI 40~70, 이격도(20일) 97~105%, 볼린저밴드 LOWER_TOUCH 또는 CENTER_REVERSION, MACD 히스토그램 전환/확대 중.
        - 수급 조건: 외인+기관 동반 순매수(BUY 3일, STRONG_BUY 5일), 거래량 20일 평균 150% 이상.
        - 펀더멘털 조건: OCF > 당기순이익, 부채비율 100% 미만, 이자보상배율 3배 초과.
        - 시장 환경 조건: VKOSPI 25 미만, BEAR/RISK_OFF 시 STRONG_BUY 금지 및 BUY 비중 축소.

         - **STRONG_BUY**: 압도적인 상승 모멘텀(RS 상위 5% 이내), 주도주 사이클 초입(신고가 경신), 기관/외인 5거래일 연속 순매수 필수, 모든 기술적 지표가 완벽한 정배열 및 상향 돌파를 가리키며, 27개 체크리스트 중 25개 이상을 만족하는 경우.
         - **BUY**: 명확한 상승 추세, 주도 섹터 1~2순위 부합, 안정적인 수급 유입(최근 5일 중 3일 이상 순매수), 주요 지지선에서의 반등이 확인되었으며, 27개 체크리스트 중 22개 이상을 만족하는 경우.
         - **STRONG_SELL**: 추세 붕괴, 재료 소멸, 극심한 고평가, 대규모 수급 이탈이 명확하며 하락 압력이 매우 강한 경우.
         - **SELL**: 추세 약화, 모멘텀 둔화, 수급 이탈 조짐, 기술적 저항에 부딪힌 경우.
      8. **[엄격한 평가 원칙]** 단순히 '좋아 보인다'는 이유로 BUY를 주지 마라. 위 기준을 '보수적'으로 적용하여 데이터가 확실할 때만 긍정적 의견을 제시하라.
      9. **[초정밀 검증]** 검색 결과에서 반드시 오늘(${todayDate}) 날짜와 현재 시각이 포함된 최신 가격 정보를 선택하라. 
         - **[시가총액 교차 검증 필수]** 모든 추천 종목의 가격은 반드시 시가총액과 대조하여 자릿수 오류가 없는지 확인하라. (예: 100만원대 종목을 30만원대로 기재하는 오류 절대 금지)
         - 여러 검색 결과(네이버 증권, 다음 금융, 야후 파이낸스 등)를 비교하여 가장 최신의 데이터를 채택하라. 며칠 전 데이터는 절대 사용하지 마라.
      10. **[트레이딩 전략 수립]** 각 종목에 대해 현재가 기준 최적의 '진입가(entryPrice)', '손절가(stopLoss)', '1차 목표가(targetPrice)', '2차 목표가(targetPrice2)'를 기술적 분석(지지/저항, 피보나치 등)을 통해 산출하라.
      11. **[데이터 출처 명시]** 'dataSource' 필드에 어떤 사이트에서 몇 시에 데이터를 가져왔는지 명시하라.
      12. **[글로벌 ETF 모니터링]** 'googleSearch'를 사용하여 KODEX 200, TIGER 미국S&P500 등 주요 ETF의 자금 유입/유출 현황을 파악하여 'globalEtfMonitoring' 필드에 반영하라.
      13. **[장세 전환 감지]** 현재 시장의 주도 섹터가 바뀌고 있는지(Regime Shift)를 판단하여 'regimeShiftDetector' 필드에 반영하라.
      14. **[다중 시계열 분석]** 월봉, 주봉, 일봉의 추세가 일치하는지 확인하여 'multiTimeframe' 필드에 반영하라.
      15. **[눌림목 성격 판단 (Pullback Analysis)]** 주가가 조정(눌림목)을 받을 때 거래량이 감소하는지(건전한 조정) 또는 증가하는지(매도 압력)를 반드시 확인하여 'technicalSignals'의 'volumeSurge' 및 'reason' 필드에 반영하라. 거래량이 줄어들며 지지받는 눌림목을 최우선으로 추천하라.
      16. **[섹터 대장주 선행 확인]** 해당 종목이 속한 섹터의 대장주(Leading Stock)가 최근 5거래일 이내에 신고가를 경신했는지 확인하라. 대장주가 먼저 길을 열어준 종목에 대해 'isLeadingSector' 및 'gate' 평가 시 가산점을 부여하라.
      17. **[AI 공시 감성 분석]** 'googleSearch'를 사용하여 해당 종목의 최근 DART 공시(실적, 수주, 증자 등)를 분석하여 'disclosureSentiment'에 반영하라.
      18. **[공매도/대차잔고 분석]** 'googleSearch'를 사용하여 해당 종목의 공매도 비율(Short Selling Ratio)과 대차잔고 추이를 분석하여 'shortSelling' 필드에 반영하라. 특히 공매도 급감에 따른 숏 커버링 가능성을 체크하라.
      19. **[텐배거 DNA 패턴 매칭]** 다음 과거 대장주들의 급등 직전 DNA와 현재 종목을 비교하여 'tenbaggerDNA' 필드에 유사도(similarity, 0-100)와 매칭 패턴명, 이유를 기술하라.
          - **에코프로(2023)**: RSI 45-55(과열 전), 거래량 마름(VCP), 대장주 신고가 선행, ROE 유형 3, 전 사이클 비주도주.
          - **씨젠(2020)**: 폭발적 실적 가속도(OPM 급증), 강력한 외부 촉매제(팬데믹), 이평선 정배열 초입.
          - **HD현대중공업(2024)**: 장기 바닥권 탈출, 섹터 전체 수주 잔고 폭증, 기관/외인 역대급 쌍끌이 매수.
      20. **[적의 체크리스트 (Enemy's Checklist)]** 해당 종목의 하락 시나리오(Bear Case), 주요 리스크 요인, 그리고 매수 논거에 대한 반박(Counter Arguments)을 분석하여 'enemyChecklist' 필드에 반영하라.
      21. **[계절성 레이어 (Seasonality Layer)]** 현재 월(${todayDate.split('-')[1]}월)의 해당 종목 또는 섹터의 역사적 수익률, 승률, 성수기 여부를 분석하여 'seasonality' 필드에 반영하라.
      22. **[수익률 귀인 분석 (Attribution Analysis)]** 해당 종목의 추천 강도를 섹터 기여도, 모멘텀 기여도, 밸류 기여도, 그리고 알파(개별 종목 특성)로 세분화하여 'attribution' 필드에 반영하라.
      23. **[8시간 비동기 해소 (Timezone Sync)]** 한국 시장(KST)과 미국 시장(EST)의 시차를 고려하여, 미국 지수는 전일 종가가 아닌 '현재 실시간 선물 지수' 또는 '가장 최근 마감 지수'를 정확히 구분하여 반영하라.
      24. **[3-Gate Triage 분류]** 각 종목을 다음 기준에 따라 Gate 1, 2, 3으로 분류하라:
          - **Gate 1 (Survival Filter)**: 주도주 사이클, ROE 유형 3, 시장 환경 Risk-On, 기계적 손절 설정, 신규 주도주 여부 등 5대 생존 조건 충족 여부. (최소 조건)
          - **Gate 2 (Growth Verification)**: 수급 질, 일목균형표, 경제적 해자, 기술적 정배열, 거래량, 기관/외인 수급, 목표가 여력, 실적 서프라이즈, 실체적 펀더멘털, 정책/매크로, 이익의 질 OCF, 상대강도 RS 등 12개 항목 중 9개 이상 충족.
          - **Gate 3 (Precision Timing)**: 심리적 객관성, 터틀 돌파, 피보나치, 엘리엇 파동, 마크 미너비니 VCP, 변동성 축적 등 10개 정밀 타이밍 조건 분석.
          - 가장 높은 단계를 'gate' 필드(1, 2, 3)에 숫자로 기록하라.

      [AI 기반 동적 가중치 (Dynamic Weighting) 적용]
      현재 판단된 장세(BULL, BEAR, SIDEWAYS, TRANSITION)에 따라 27개 체크리스트 항목의 배점을 정밀 조절하여 'Confidence Score'를 계산하라.
      - 약세장(BEAR/RISK_OFF)일수록 재무방어력과 이익의 질에 높은 가중치를 두어라.
      - 강세장(BULL/RISK_ON)일수록 모멘텀과 기술적 돌파에 높은 가중치를 두어라.

      [시장 상황에 따른 추천 전략]
      1. 시황이 좋지 않은 경우(BEAR, VKOSPI 25 이상 등)에는 종목 추천을 최소화(0~3개)하라. 
      2. 시황이 극도로 악화된 경우 "현재는 현금 비중 확대 및 관망이 필요한 시점입니다"라는 메시지와 함께 추천 종목을 반드시 빈 배열([])로 반환하라.
      3. 추천 종목이 있다면 최대 5개까지만 추천하여 응답의 완성도를 높여라.
      4. **[필수]** 'reason' 필드는 해당 종목의 점수나 등급에 가장 큰 영향을 미친 구체적인 기술적 지표나 펀더멘털 요인을 반드시 포함하여 2~3문장으로 핵심만 상세히 작성하라.
      5. **[필수]** 'sectorAnalysis' 필드는 해당 종목이 속한 산업 섹터에 대한 AI 분석을 제공하라. 다음 내용을 반드시 포함해야 한다:
         - sectorName: 산업 명칭
         - currentTrends: 주요 트렌드 2~3가지
         - leadingStocks: 주도 상위 3개 종목 (종목명, 코드, 시가총액)
         - catalysts: 주가 견인 촉매제 2~3가지
         - riskFactors: 리스크 요인 2~3가지
      6. 각 필드의 설명(description 등)은 핵심 위주로 매우 간결하게 작성하라.
      7. 불필요한 수식어나 중복된 정보는 배제하라.
      8. 반드시 유효한 JSON 형식으로 닫는 중괄호까지 완벽하게 작성하라.
      9. 종목은 최대 5개까지만 추천하라.

    응답은 반드시 다음 JSON 형식으로만 하며, 절대 중간에 끊기지 않도록 끝까지 완성하라:
    {
      "marketContext": {
        "kospi": { "index": 0, "change": 0, "changePercent": 0, "status": "NEUTRAL", "analysis": "...", "ma200": 2650.5 },
        "kosdaq": { "index": 0, "change": 0, "changePercent": 0, "status": "NEUTRAL", "analysis": "..." },
        "globalIndices": { "nasdaq": { "index": 0, "changePercent": 0 }, "snp500": { "index": 0, "changePercent": 0 }, "dow": { "index": 0, "changePercent": 0 }, "sox": { "index": 0, "changePercent": 0 } },
        "globalMacro": { "us10yYield": 0, "brentOil": 0, "gold": 0, "dollarIndex": 0 },
        "fearAndGreed": { "value": 0, "status": "..." },
        "iri": 0, "vkospi": 0, 
        "globalEtfMonitoring": [
          { "name": "ETF명", "flow": "INFLOW", "implication": "..." }
        ],
        "regimeShiftDetector": {
          "currentRegime": "...",
          "nextRegimeProbability": 0,
          "leadingIndicator": "..."
        },
        "volumeTrend": "STABLE",
        "exchangeRate": { "value": 0, "change": 0 },
        "bondYield": { "value": 0, "change": 0 },
        "overallSentiment": "...",
        "marketPhase": "BULL",
        "activeStrategy": "...",
        "dataSource": "..."
      },
      "recommendations": [
        {
          "name": "종목명", "code": "종목코드", "corpCode": "00123456", "reason": "...", "type": "STRONG_BUY/BUY/STRONG_SELL/SELL", "gate": 3, "patterns": ["..."], "hotness": 9, "roeType": "...",
          "//gate_guide": "1: Survival, 2: Growth, 3: Timing 중 해당 종목이 도달한 가장 높은 단계를 숫자로 입력하라.",
          "isLeadingSector": true, "isSectorTopPick": true, "momentumRank": 1, "confidenceScore": 85,
          "supplyQuality": { "passive": true, "active": true }, "peakPrice": 0, "currentPrice": 0, "priceUpdatedAt": "...", "dataSource": "...",
          "isPreviousLeader": false, "ichimokuStatus": "ABOVE_CLOUD", "relatedSectors": ["..."],
          "valuation": { "per": 0, "pbr": 0, "epsGrowth": 0, "debtRatio": 0 },
          "technicalSignals": { 
            "maAlignment": "BULLISH", "rsi": 0, "macdStatus": "GOLDEN_CROSS", "bollingerStatus": "NEUTRAL", "stochasticStatus": "NEUTRAL", "volumeSurge": true, "disparity20": 0, "macdHistogram": 0, "bbWidth": 0, "stochRsi": 0,
            "macdHistogramDetail": { "status": "BULLISH", "implication": "..." },
            "bbWidthDetail": { "status": "SQUEEZE", "implication": "..." },
            "stochRsiDetail": { "status": "OVERSOLD", "implication": "..." }
          },
          "economicMoat": { "type": "BRAND", "description": "..." },
          "scores": { "value": 0, "momentum": 0 },
          "shortSelling": { "ratio": 0, "trend": "DECREASING", "implication": "..." },
          "tenbaggerDNA": { "similarity": 0, "matchPattern": "에코프로2023", "reason": "..." },
          "checklist": { "cycleVerified": true, "momentumRanking": true, "roeType3": true, "supplyInflow": true, "riskOnEnvironment": true, "ichimokuBreakout": true, "mechanicalStop": true, "economicMoatVerified": true, "notPreviousLeader": true, "technicalGoldenCross": true, "volumeSurgeVerified": true, "institutionalBuying": true, "consensusTarget": true, "earningsSurprise": true, "performanceReality": true, "policyAlignment": true, "psychologicalObjectivity": true, "turtleBreakout": true, "fibonacciLevel": true, "elliottWaveVerified": true, "ocfQuality": true, "marginAcceleration": true, "interestCoverage": true, "relativeStrength": true, "vcpPattern": true, "divergenceCheck": true, "catalystAnalysis": true },
          "catalystDetail": { "description": "...", "score": 15, "upcomingEvents": ["..."] },
          "catalystSummary": "촉매제 분석 통과 이유(예: 실적 발표 예정, 정부 정책 수혜 등)를 20자 이내로 요약",
          "visualReport": { "financial": 1, "technical": 1, "supply": 1, "summary": "..." },
          "elliottWaveStatus": { "wave": "WAVE_3", "description": "..." },
          "analystRatings": { "strongBuy": 0, "buy": 0, "strongSell": 0, "sell": 0, "consensus": "...", "targetPriceAvg": 0, "targetPriceHigh": 0, "targetPriceLow": 0, "sources": ["..."] },
          "newsSentiment": { "score": 0, "status": "POSITIVE", "summary": "..." },
          "chartPattern": { "name": "역 헤드 앤 숄더", "type": "REVERSAL_BULLISH", "description": "강력한 바닥 다지기 후 추세 반전 신호", "reliability": 85 },
          "roeAnalysis": { "drivers": ["..."], "historicalTrend": "...", "strategy": "...", "metrics": { "netProfitMargin": 0, "assetTurnover": 0, "equityMultiplier": 0 } },
          "strategicInsight": { "cyclePosition": "NEW_LEADER", "earningsQuality": "...", "policyContext": "..." },
          "marketCap": 0, "marketCapCategory": "LARGE", "correlationGroup": "...",
          "aiConvictionScore": { "totalScore": 0, "factors": [{ "name": "...", "score": 0, "weight": 0 }], "marketPhase": "BULL", "description": "..." },
          "shortSelling": { "ratio": 0, "trend": "DECREASING", "implication": "..." },
          "tenbaggerDNA": { "similarity": 0, "matchPattern": "...", "reason": "..." },
          "disclosureSentiment": { "score": 0, "summary": "..." },
          "shortSelling": { "ratio": 0, "trend": "DECREASING", "implication": "..." },
          "tenbaggerDNA": { "similarity": 0, "matchPattern": "...", "reason": "..." },
          "isPullbackVolumeLow": true,
          "sectorLeaderNewHigh": true,
          "multiTimeframe": { "monthly": "BULLISH", "weekly": "BULLISH", "daily": "BULLISH", "consistency": true },
          "enemyChecklist": { "bearCase": "...", "riskFactors": ["..."], "counterArguments": ["..."] },
          "seasonality": { "month": 0, "historicalPerformance": 0, "winRate": 0, "isPeakSeason": true },
          "attribution": { "sectorContribution": 0, "momentumContribution": 0, "valueContribution": 0, "alpha": 0 },
          "tranchePlan": {
            "tranche1": { "size": 0, "trigger": "...", "status": "PENDING" },
            "tranche2": { "size": 0, "trigger": "...", "status": "PENDING" },
            "tranche3": { "size": 0, "trigger": "...", "status": "PENDING" }
          },
          "correlationScore": 0,
          "historicalAnalogy": { "stockName": "...", "period": "...", "similarity": 0, "reason": "..." },
          "latestNews": [
            { "headline": "뉴스 제목", "date": "2026-03-28", "url": "https://..." }
          ],
          "anomalyDetection": { "type": "FUNDAMENTAL_DIVERGENCE", "score": 0, "description": "..." },
          "semanticMapping": { "theme": "...", "keywords": ["..."], "relevanceScore": 0, "description": "..." },
          "gateEvaluation": { "gate1Passed": true, "gate2Passed": true, "gate3Passed": true, "finalScore": 0, "recommendation": "...", "positionSize": 0 },
          "multiTimeframe": { "monthly": "BULLISH", "weekly": "BULLISH", "daily": "BULLISH", "consistency": true },
          "sectorAnalysis": { "sectorName": "...", "currentTrends": ["..."], "leadingStocks": [{ "name": "...", "code": "...", "marketCap": "..." }], "catalysts": ["..."], "riskFactors": ["..."] },
          "dataSource": "...",
          "targetPrice": 0, "targetPrice2": 0, "entryPrice": 0, "entryPrice2": 0, "stopLoss": 0, "riskFactors": ["..."]
        }
      ]
    }
    
    [주의: JSON 응답 외에 어떤 텍스트도 포함하지 마라. 반드시 유효한 JSON 형식으로 닫는 중괄호까지 완벽하게 작성하라.]
  `;

  const hour = new Date().getHours();
  const cacheKey = `recommendations-${JSON.stringify(filters)}-${todayDate}-${hour}`;
  
  return getCachedAIResponse(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
            maxOutputTokens: 12000,
            temperature: 0.1, // Increased to 0.1 to encourage fresh search
          },
        });
      }, 2, 2000);

      const text = response.text;
      if (!text) {
        console.error("Full AI Response:", JSON.stringify(response, null, 2));
        throw new Error("No response from AI");
      }
      const parsed = safeJsonParse(text);
      
      // Ensure recommendations is always an array
      if (parsed && !parsed.recommendations) {
        parsed.recommendations = [];
      }

      // Enrich with real data
      if (parsed && parsed.recommendations.length > 0) {
        console.log(`Enriching ${parsed.recommendations.length} recommendations with real data (sequentially)...`);
        const enrichedRecommendations = [];
        for (const stock of parsed.recommendations) {
          try {
            const enriched = await enrichStockWithRealData(stock);
            enrichedRecommendations.push(enriched);
            // Small delay between stocks to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (err) {
            console.error(`Failed to enrich ${stock.name}:`, err);
            enrichedRecommendations.push(stock);
          }
        }
        parsed.recommendations = enrichedRecommendations;
      }
      
      return parsed;
    } catch (error) {
      console.error("Error in getStockRecommendations:", error);
      throw error;
    }
  });
}

// ─────────────────────────────────────────────────────────────────
// KIS 수급 데이터
// ─────────────────────────────────────────────────────────────────
const kisCache = new Map<string, { data: any; timestamp: number }>();
const KIS_CACHE_TTL = 1000 * 60 * 60; // 1시간

async function fetchKisSupply(code: string) {
  const key = `kis_supply_${code}`;
  const hit = kisCache.get(key);
  if (hit && Date.now() - hit.timestamp < KIS_CACHE_TTL) return hit.data;
  try {
    const res = await fetch(`/api/kis/supply?code=${code}`);
    const data = await res.json();
    if (data.rt_cd !== '0' || !data.output) return null;
    const rows: any[] = Array.isArray(data.output) ? data.output.slice(0, 5) : [];
    const foreignNet     = rows.reduce((s, r) => s + parseInt(r.frgn_ntby_qty    || '0'), 0);
    const institutionNet = rows.reduce((s, r) => s + parseInt(r.orgn_ntby_qty    || '0'), 0);
    const individualNet  = rows.reduce((s, r) => s + parseInt(r.indvdl_ntby_qty  || '0'), 0);
    let foreignConsecutive = 0;
    for (const r of rows) {
      if (parseInt(r.frgn_ntby_qty || '0') > 0) foreignConsecutive++;
      else break;
    }
    const result = {
      foreignNet, institutionNet, individualNet, foreignConsecutive,
      isPassiveAndActive: foreignNet > 0 && institutionNet > 0,
      dataSource: 'KIS',
    };
    kisCache.set(key, { data: result, timestamp: Date.now() });
    return result;
  } catch (e) {
    console.error(`KIS supply error (${code}):`, e);
    return null;
  }
}

async function fetchKisShortSelling(code: string) {
  const key = `kis_short_${code}`;
  const hit = kisCache.get(key);
  if (hit && Date.now() - hit.timestamp < KIS_CACHE_TTL) return hit.data;
  try {
    const res = await fetch(`/api/kis/short-selling?code=${code}`);
    const data = await res.json();
    if (data.rt_cd !== '0' || !data.output2) return null;
    
    const rows = data.output2;
    if (rows.length === 0) return null;
    
    const recentRows = rows.slice(0, 5);
    const avgShortRatio = recentRows.reduce((s: number, r: any) => s + parseFloat(r.shrt_vol_rate || '0'), 0) / recentRows.length;
    
    const currentRatio = parseFloat(rows[0].shrt_vol_rate || '0');
    const prevRatio = parseFloat(rows[1]?.shrt_vol_rate || '0');
    const trend = currentRatio < prevRatio ? 'DECREASING' : (currentRatio > prevRatio ? 'INCREASING' : 'STABLE');
    
    const result = {
      ratio: avgShortRatio,
      trend,
      implication: avgShortRatio > 15 ? '공매도 비중 높음 (주의)' : '공매도 비중 안정적',
      dataSource: 'KIS'
    };
    
    kisCache.set(key, { data: result, timestamp: Date.now() });
    return result;
  } catch (e) {
    console.error(`KIS short-selling error (${code}):`, e);
    return null;
  }
}

const dartCache = new Map<string, { data: any; timestamp: number }>();
const DART_CACHE_TTL = 1000 * 60 * 60 * 6; // 6 hours

async function fetchCorpCode(stockCode: string): Promise<string | null> {
  const cacheKey = `corp_${stockCode}`;
  const cached = dartCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < DART_CACHE_TTL) {
    return cached.data;
  }

  try {
    const res = await fetch(`/api/dart/company?stock_code=${stockCode}`);
    const data = await res.json();
    if (data.status === '000') {
      dartCache.set(cacheKey, { data: data.corp_code, timestamp: Date.now() });
      return data.corp_code;
    }
    return null;
  } catch (error) {
    console.error('Error fetching corpCode:', error);
    return null;
  }
}

async function fetchDartFinancials(corpCode: string) {
  const cacheKey = `fin_${corpCode}`;
  const cached = dartCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < DART_CACHE_TTL) {
    return cached.data;
  }

  try {
    const year = new Date().getFullYear();
    const lastYear = year - 1;
    // Try current year Q3 first, then last year annual
    const reportCodes = ['11014', '11011']; 
    
    for (const reportCode of reportCodes) {
      const bsnsYear = reportCode === '11011' ? lastYear : year;
      // Using /api/dart proxy for more comprehensive data (OCF, Interest Expense)
      const url = `/api/dart?corp_code=${corpCode}&bsns_year=${bsnsYear}&reprt_code=${reportCode}&fs_div=CFS`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.status === '000' && data.list) {
        const findValue = (nm: string) => {
          const item = data.list.find((i: any) => 
            i.account_nm.replace(/\s/g, '').includes(nm.replace(/\s/g, '')) || 
            (i.account_id && i.account_id.includes(nm))
          );
          return item ? parseFloat(item.thstrm_amount.replace(/,/g, '')) : 0;
        };

        const netIncome = findValue('당기순이익');
        const operatingIncome = findValue('영업이익');
        const equity = findValue('자본총계');
        const assets = findValue('자산총계');
        const liabilities = findValue('부채총계');
        const interestExpense = findValue('이자비용') || findValue('금융비용');
        const ocf = findValue('영업활동현금흐름') || findValue('영업활동으로인한현금흐름');

        const roe = equity > 0 ? (netIncome / equity) * 100 : 0;
        const debtRatio = equity > 0 ? (liabilities / equity) * 100 : 0;
        const interestCoverageRatio = interestExpense > 0 ? operatingIncome / interestExpense : (operatingIncome > 0 ? 99.9 : 0);
        const netProfitMargin = assets > 0 ? (netIncome / assets) * 100 : 0;

        const result = {
          roe,
          debtRatio,
          interestCoverageRatio,
          netProfitMargin,
          ocfGreaterThanNetIncome: ocf > netIncome,
          updatedAt: `${bsnsYear} ${reportCode === '11011' ? '사업보고서' : '3분기보고서'}`
        };

        dartCache.set(cacheKey, { data: result, timestamp: Date.now() });
        return result;
      }
    }
    return null;
  } catch (error) {
    console.error('DART API Error:', error);
    return null;
  }
}

export async function fetchHistoricalData(code: string, range: string = '1y'): Promise<any> {
  // Try .KS (KOSPI) first, then .KQ (KOSDAQ) if it looks like a Korean stock code
  // Handle cases where code might already have a suffix or be just 6 digits
  const baseCodeMatch = code.match(/^(\d{6})(\.(KS|KQ))?$/);
  const baseCode = baseCodeMatch ? baseCodeMatch[1] : null;
  
  const symbols = baseCode ? [`${baseCode}.KS`, `${baseCode}.KQ`] : [code];
  
  for (const symbol of symbols) {
    const url = `/api/historical-data?symbol=${symbol}&range=${range}&interval=1d`;
    try {
      const data = await withRetry(async () => {
        const response = await fetch(url);
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        const json = await response.json();
        if (!json.chart?.result?.[0]) {
          throw new Error('Invalid data format from Yahoo API');
        }
        return json.chart.result[0];
      }, 2, 2000); // Updated retries for Yahoo Finance
      
      if (data) return data;
    } catch (error) {
      console.error(`Error fetching historical data for ${symbol}:`, error);
      // Wait a bit before trying next symbol (e.g. .KQ after .KS)
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  return null;
}

export async function backtestPortfolio(
  portfolio: { name: string; code: string; weight: number }[], 
  initialEquity: number = 100000000,
  years: number = 1
): Promise<BacktestResult> {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - years * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  try {
    // 1. Fetch real historical data for each stock and benchmark
    const historicalDataPromises = portfolio.map(p => fetchHistoricalData(p.code, `${years + 1}y`));
    const benchmarkPromise = fetchHistoricalData('^KS11', `${years + 1}y`);
    
    const [historicalResults, benchmarkData] = await (async () => {
      const results = [];
      for (const p of portfolio) {
        results.push(await fetchHistoricalData(p.code, `${years + 1}y`));
        await new Promise(resolve => setTimeout(resolve, 300)); // 300ms delay between fetches
      }
      const benchmark = await fetchHistoricalData('^KS11', `${years + 1}y`);
      return [results, benchmark];
    })();

    // 2. Align dates and prepare price map
    const allDatesSet = new Set<string>();
    const priceMap: Record<string, Record<string, number>> = {}; // date -> symbol -> price
    const openPriceMap: Record<string, Record<string, number>> = {}; // date -> symbol -> open price
    const highPriceMap: Record<string, Record<string, number>> = {}; // date -> symbol -> high price
    const lowPriceMap: Record<string, Record<string, number>> = {}; // date -> symbol -> low price
    
    historicalResults.forEach((data, idx) => {
      if (data && data.timestamp) {
        const symbol = portfolio[idx].code;
        data.timestamp.forEach((ts: number, i: number) => {
          const date = new Date(ts * 1000).toISOString().split('T')[0];
          if (date >= startDate && date <= endDate) {
            allDatesSet.add(date);
            if (!priceMap[date]) priceMap[date] = {};
            if (!openPriceMap[date]) openPriceMap[date] = {};
            if (!highPriceMap[date]) highPriceMap[date] = {};
            if (!lowPriceMap[date]) lowPriceMap[date] = {};
            
            const close = data.indicators.quote[0].close[i];
            const open = data.indicators.quote[0].open[i];
            const high = data.indicators.quote[0].high[i];
            const low = data.indicators.quote[0].low[i];
            
            if (close !== null) priceMap[date][symbol] = close;
            if (open !== null) openPriceMap[date][symbol] = open;
            if (high !== null) highPriceMap[date][symbol] = high;
            if (low !== null) lowPriceMap[date][symbol] = low;
          }
        });
      }
    });

    const benchmarkPriceMap: Record<string, number> = {};
    if (benchmarkData && benchmarkData.timestamp) {
      const quotes = benchmarkData.indicators.quote[0].close;
      benchmarkData.timestamp.forEach((ts: number, i: number) => {
        const date = new Date(ts * 1000).toISOString().split('T')[0];
        const val = quotes[i];
        if (val !== null) benchmarkPriceMap[date] = val;
      });
    }

    const sortedDates = Array.from(allDatesSet).sort();
    if (sortedDates.length === 0) throw new Error("No historical data found for the selected period.");

    // 3. Simulation Loop
    let state: BacktestPortfolioState = {
      cash: initialEquity,
      positions: [],
      equity: initialEquity,
      initialEquity
    };
    
    const dailyLogs: BacktestDailyLog[] = [];
    let peak = initialEquity;
    let mdd = 0;
    
    // Transaction costs constants (User provided)
    const BUY_COST_RATIO = 1.00115; // Fee 0.015% + Slippage 0.1%
    const SELL_COST_RATIO = 0.99655; // Fee 0.015% + Slippage 0.1% + Tax 0.23%

    const closedTrades: { profit: number; isWin: boolean }[] = [];

    // Day 0: Initial Allocation at Open Price of the first day
    const firstDate = sortedDates[0];
    portfolio.forEach(p => {
      const openPrice = openPriceMap[firstDate]?.[p.code] || priceMap[firstDate]?.[p.code];
      if (openPrice) {
        const targetValue = initialEquity * (p.weight / 100);
        const realBuyPrice = openPrice * BUY_COST_RATIO;
        const quantity = Math.floor(targetValue / realBuyPrice);
        const cost = quantity * realBuyPrice;
        
        if (quantity > 0 && state.cash >= cost) {
          state.positions.push({
            stockCode: p.code,
            stockName: p.name,
            entryPrice: realBuyPrice,
            quantity,
            entryDate: firstDate,
            stopLoss: realBuyPrice * 0.85, // Default 15%
            takeProfit: realBuyPrice * 1.5, // Default 50%
            currentPrice: openPrice,
            unrealizedReturn: 0
          });
          state.cash -= cost;
        }
      }
    });

    // Daily Simulation
    sortedDates.forEach((date, dateIdx) => {
      // 0. Monthly Rebalancing (Every 20 trading days)
      // We use yesterday's close to decide, and execute at today's open.
      if (dateIdx > 0 && dateIdx % 20 === 0) {
        const prevDate = sortedDates[dateIdx - 1];
        const currentEquity = state.equity;
        
        // Calculate target positions based on current equity and target weights
        const targetPositions = portfolio.map(p => {
          const targetValue = currentEquity * (p.weight / 100);
          const openPrice = openPriceMap[date]?.[p.code] || priceMap[prevDate]?.[p.code];
          return {
            ...p,
            targetValue,
            openPrice
          };
        });

        // 1. Sell over-weighted or removed positions
        const nextPositions: BacktestPosition[] = [];
        state.positions.forEach(pos => {
          const target = targetPositions.find(tp => tp.code === pos.stockCode);
          const openPrice = openPriceMap[date]?.[pos.stockCode] || pos.currentPrice;
          
          if (!target) {
            // Remove position
            state.cash += pos.quantity * openPrice * SELL_COST_RATIO;
          } else {
            const currentVal = pos.quantity * openPrice;
            if (currentVal > target.targetValue * 1.1) { // 10% drift threshold
              const excessVal = currentVal - target.targetValue;
              const sellQty = Math.floor(excessVal / (openPrice * SELL_COST_RATIO));
              if (sellQty > 0) {
                state.cash += sellQty * openPrice * SELL_COST_RATIO;
                nextPositions.push({ ...pos, quantity: pos.quantity - sellQty });
              } else {
                nextPositions.push(pos);
              }
            } else {
              nextPositions.push(pos);
            }
          }
        });
        state.positions = nextPositions;

        // 2. Buy under-weighted or new positions
        targetPositions.forEach(target => {
          const existingPos = state.positions.find(p => p.stockCode === target.code);
          const openPrice = target.openPrice;
          if (!openPrice) return;

          const currentVal = existingPos ? existingPos.quantity * openPrice : 0;
          if (currentVal < target.targetValue * 0.9) { // 10% drift threshold
            const deficitVal = target.targetValue - currentVal;
            const buyQty = Math.floor(deficitVal / (openPrice * BUY_COST_RATIO));
            if (buyQty > 0 && state.cash >= buyQty * openPrice * BUY_COST_RATIO) {
              state.cash -= buyQty * openPrice * BUY_COST_RATIO;
              if (existingPos) {
                existingPos.quantity += buyQty;
                // Update entry price as weighted average? For simplicity, we'll keep original or update it
                existingPos.entryPrice = (existingPos.entryPrice * (existingPos.quantity - buyQty) + openPrice * buyQty) / existingPos.quantity;
              } else {
                state.positions.push({
                  stockCode: target.code,
                  stockName: target.name,
                  entryPrice: openPrice * BUY_COST_RATIO,
                  quantity: buyQty,
                  entryDate: date,
                  stopLoss: openPrice * 0.85,
                  takeProfit: openPrice * 1.5,
                  currentPrice: openPrice,
                  unrealizedReturn: 0
                });
              }
            }
          }
        });
      }

      // 1. Update current prices (using Close of the day)
      let positionsValue = 0;
      state.positions.forEach((pos: BacktestPosition) => {
        const closePrice = priceMap[date][pos.stockCode] || pos.currentPrice;
        pos.currentPrice = closePrice;
        pos.unrealizedReturn = (closePrice - pos.entryPrice) / pos.entryPrice;
        positionsValue += pos.quantity * closePrice;
      });
      
      state.equity = state.cash + positionsValue;
      
      // 2. MDD calculation
      if (state.equity > peak) peak = state.equity;
      const currentDD = (peak - state.equity) / peak;
      if (currentDD > mdd) mdd = currentDD;
      
      // 3. Benchmark calculation
      const benchmarkVal = benchmarkPriceMap[date] || 1;
      const firstBenchmark = benchmarkPriceMap[sortedDates[0]] || 1;
      
      dailyLogs.push({
        date,
        equity: state.equity,
        cash: state.cash,
        positionsValue,
        drawdown: currentDD * 100,
        returns: ((state.equity - initialEquity) / initialEquity) * 100,
        benchmarkValue: (benchmarkVal / firstBenchmark) * 100
      });
      
      // 4. Sell Check (Stop Loss / Take Profit)
      // Using actual High/Low data for more accurate SL/TP triggers
      const remainingPositions: BacktestPosition[] = [];
      state.positions.forEach((pos: BacktestPosition) => {
        const lowPrice = lowPriceMap[date]?.[pos.stockCode] || pos.currentPrice;
        const highPrice = highPriceMap[date]?.[pos.stockCode] || pos.currentPrice;
        
        if (lowPrice <= pos.stopLoss) {
          // Stop Loss Triggered
          const exitPrice = pos.stopLoss * SELL_COST_RATIO;
          const profit = (exitPrice - pos.entryPrice) * pos.quantity;
          state.cash += pos.quantity * exitPrice;
          closedTrades.push({ profit, isWin: false });
        } else if (highPrice >= pos.takeProfit) {
          // Take Profit Triggered
          const exitPrice = pos.takeProfit * SELL_COST_RATIO;
          const profit = (exitPrice - pos.entryPrice) * pos.quantity;
          state.cash += pos.quantity * exitPrice;
          closedTrades.push({ profit, isWin: true });
        } else {
          remainingPositions.push(pos);
        }
      });
      state.positions = remainingPositions;
    });

    // 4. Calculate Final Metrics
    const finalEquity = state.equity;
    const totalReturn = ((finalEquity - initialEquity) / initialEquity) * 100;
    
    const durationYears = sortedDates.length / 252;
    const cagr = (Math.pow(finalEquity / initialEquity, 1 / durationYears) - 1) * 100;
    
    const dailyReturns = dailyLogs.map((log, i) => {
      if (i === 0) return 0;
      return (log.equity - dailyLogs[i-1].equity) / dailyLogs[i-1].equity;
    });
    const avgDailyReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const stdDevDailyReturn = Math.sqrt(dailyReturns.reduce((a, b) => a + Math.pow(b - avgDailyReturn, 2), 0) / dailyReturns.length) || 0.0001;
    const sharpe = (avgDailyReturn / stdDevDailyReturn) * Math.sqrt(252);

    const wins = closedTrades.filter(t => t.isWin).length;
    const losses = closedTrades.filter(t => !t.isWin).length;
    const winRate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0;
    
    const totalWinAmount = closedTrades.filter(t => t.isWin).reduce((sum, t) => sum + t.profit, 0);
    const totalLossAmount = Math.abs(closedTrades.filter(t => !t.isWin).reduce((sum, t) => sum + t.profit, 0));
    const profitFactor = totalLossAmount > 0 ? totalWinAmount / totalLossAmount : totalWinAmount > 0 ? 10 : 0;

    // 5. AI Analysis
    const portfolioStr = portfolio.map(p => `${p.name}(${p.code}): ${p.weight}%`).join(', ');
    const aiPrompt = `
      [퀀트 백테스트 심층 분석]
      포트폴리오: ${portfolioStr}
      초기 자산: ${initialEquity.toLocaleString()}원
      최종 자산: ${finalEquity.toLocaleString()}원
      누적 수익률: ${totalReturn.toFixed(2)}%
      CAGR (연평균 수익률): ${cagr.toFixed(2)}%
      MDD (최대 낙폭): ${(mdd * 100).toFixed(2)}%
      샤프 지수: ${sharpe.toFixed(2)}
      승률: ${winRate.toFixed(2)}%
      Profit Factor: ${profitFactor.toFixed(2)}
      
      위 실제 시뮬레이션 데이터를 바탕으로 '퀀트 펀드 매니저'의 관점에서 분석을 수행해줘.
      1. 이 전략의 리스크 대비 수익성(Risk-Adjusted Return)을 평가하라.
      2. 하락장에서의 방어력과 상승장에서의 탄력성을 분석하라.
      3. 수수료와 슬리피지를 고려했을 때 실전 매매 가능 여부를 판별하라.
      4. 포트폴리오 최적화(비중 조절, 종목 교체)를 위한 구체적인 액션 플랜을 제시하라.

      응답은 반드시 다음 JSON 형식으로만 해줘:
      {
        "aiAnalysis": "...",
        "optimizationSuggestions": [{ "stock": "...", "action": "...", "currentWeight": 0, "recommendedWeight": 0, "reason": "..." }],
        "newThemeSuggestions": [{ "theme": "...", "stocks": ["..."], "reason": "..." }],
        "riskyStocks": [{ "stock": "...", "reason": "...", "riskLevel": "..." }],
        "riskMetrics": { "beta": 1.0, "alpha": 0.0, "treynorRatio": 0.0 }
      }
    `;

    const response = await withRetry(async () => {
      return await getAI().models.generateContent({
        model: "gemini-3-flash-preview",
        contents: aiPrompt,
        config: { 
          responseMimeType: "application/json",
          temperature: 0,
        }
      });
    }, 2, 2000);
    const text = response.text;
    const aiParsed = safeJsonParse(text);

    let maxStreak = 0, curStreak = 0;
    closedTrades.forEach(t => {
      curStreak = t.isWin ? 0 : curStreak + 1;
      maxStreak = Math.max(maxStreak, curStreak);
    });

    return {
      dailyLogs,
      finalEquity,
      totalReturn,
      cagr,
      mdd: mdd * 100,
      sharpe,
      winRate,
      profitFactor,
      avgWin: totalWinAmount / (wins || 1),
      avgLoss: totalLossAmount / (losses || 1),
      maxConsecutiveLoss: maxStreak,
      trades: closedTrades.length,
      cumulativeReturn: totalReturn,
      annualizedReturn: cagr,
      sharpeRatio: sharpe,
      maxDrawdown: mdd * 100,
      volatility: stdDevDailyReturn * Math.sqrt(252) * 100,
      performanceData: dailyLogs.map(log => ({
        date: log.date,
        value: (log.equity / initialEquity) * 100,
        benchmark: log.benchmarkValue
      })),
      aiAnalysis: aiParsed.aiAnalysis || "분석 완료",
      optimizationSuggestions: aiParsed.optimizationSuggestions || [],
      newThemeSuggestions: aiParsed.newThemeSuggestions || [],
      riskyStocks: aiParsed.riskyStocks || [],
      riskMetrics: aiParsed.riskMetrics || { beta: 1.0, alpha: 0, treynorRatio: 0 }
    };

  } catch (error) {
    console.error("Error in advanced backtesting:", error);
    throw error;
  }
}

export async function runAdvancedAnalysis(type: 'BACKTEST' | 'WALK_FORWARD' | 'PAPER_TRADING', period?: string): Promise<AdvancedAnalysisResult> {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  
  let prompt = "";
  if (type === 'BACKTEST') {
    prompt = `
      [과거 데이터 백테스팅 (Back-Testing) 분석 요청]
      현재 시각: ${now}
      대상 기간: ${period || "2022년 금리 인상기 vs 2024년 상반기 순환매 장세"}
      
      [분석 요구사항]
      1. 27가지 마스터 체크리스트 조건 중 해당 기간 동안 '수익률 기여도가 가장 높았던 항목' 3개와 '오히려 노이즈가 되었던 항목' 2개를 선정하라.
      2. 장세 판단 엔진이 가중치를 변경했을 때, 실제 하락장에서의 방어력 향상 수치를 시뮬레이션하라.
      3. 전체 수익률, 승률, MDD, 샤프 지수를 산출하라.
      4. 'googleSearch'를 사용하여 해당 기간의 실제 시장 상황(KOSPI, 금리, 환율 등)을 참고하여 분석의 신뢰도를 높여라.
      
      응답은 반드시 다음 JSON 형식으로만 해줘:
      {
        "type": "BACKTEST",
        "period": "${period || '2022-2024 분석'}",
        "metrics": {
          "totalReturn": 15.5,
          "winRate": 62.5,
          "maxDrawdown": -8.4,
          "sharpeRatio": 1.45
        },
        "performanceData": [
          { "date": "2022-01", "value": 100, "benchmark": 100 },
          { "date": "2022-06", "value": 90, "benchmark": 85 },
          { "date": "2022-12", "value": 85, "benchmark": 75 }
        ],
        "topContributors": [
          { "name": "항목명", "weight": 45, "impact": "POSITIVE" }
        ],
        "noiseItems": ["항목1", "항목2"],
        "description": "AI 기반 백테스팅 결과 요약 및 인사이트..."
      }
    `;
  } else if (type === 'WALK_FORWARD') {
    prompt = `
      [전진 분석 (Walk-Forward Analysis) 분석 요청]
      현재 시각: ${now}
      방법: 2025년 최적화 로직을 2026년 최근 3개월 데이터에 대입
      
      [분석 요구사항]
      1. 'googleSearch'를 사용하여 2025년과 2026년 초(현재까지)의 한국 시장 트렌드를 검색하라.
      2. 과최적화(Over-fitting) 여부를 판별하라.
      3. 최신 트렌드(AI 비주얼 스토리텔링, 밸류업 등)에서 주도주 포착 정확도를 산출하라.
      4. Robustness Score(강건성 점수)를 100점 만점으로 계산하라.
      
      응답은 반드시 다음 JSON 형식으로만 해줘:
      {
        "type": "WALK_FORWARD",
        "period": "2025 -> 2026 Q1",
        "metrics": {
          "accuracy": 78.5,
          "robustnessScore": 85
        },
        "performanceData": [
          { "date": "2025-Q1", "value": 100, "benchmark": 100 },
          { "date": "2025-Q4", "value": 120, "benchmark": 110 },
          { "date": "2026-Q1", "value": 125, "benchmark": 112 }
        ],
        "description": "전진 분석 결과 및 과최적화 판별 보고서..."
      }
    `;
  } else {
    prompt = `
      [페이퍼 트레이딩 (Paper Trading) & 로그 분석 요청]
      현재 시각: ${now}
      
      [분석 요구사항]
      1. 'googleSearch'를 사용하여 '오늘' 또는 '최근 2일'간의 한국 증시 주도주를 검색하라.
      2. 최근 2일간의 가상 '마스터 픽' Top 3 종목을 생성하라.
      3. 각 종목의 [진입가 / 손절가 / 목표가]를 설정하라. (현재가 기준)
      4. 27번(촉매) 분석이 실제 주가 폭발의 '트리거'가 되었는지, 아니면 재료 소멸로 작동했는지 AI 피드백 루프를 생성하라.
      
      응답은 반드시 다음 JSON 형식으로만 해줘:
      {
        "type": "PAPER_TRADING",
        "period": "최근 2일",
        "metrics": {},
        "description": "페이퍼 트레이딩 성과 요약",
        "paperTradeLogs": [
          {
            "date": "2026-03-26",
            "picks": [
              {
                "name": "종목명",
                "code": "000000",
                "entryPrice": 50000,
                "stopLoss": 48000,
                "targetPrice": 55000,
                "currentPrice": 52000,
                "status": "PROFIT",
                "catalyst": "촉매 분석 내용...",
                "pnl": 4.0
              }
            ],
            "aiFeedback": "AI 피드백 루프 내용..."
          }
        ]
      }
    `;
  }

  try {
    const parsed = await withRetry(async () => {
      const response = await getAI().models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          toolConfig: { includeServerSideToolInvocations: true },
          maxOutputTokens: 2048,
          temperature: 0,
        },
      });

      const text = response.text;
      if (!text) {
        console.error("Full AI Response:", JSON.stringify(response, null, 2));
        throw new Error("No response from AI");
      }
      return safeJsonParse(text);
    }, 2, 2000);
    
    // Ensure performanceData and paperTradeLogs are always arrays
    if (parsed) {
      if (!parsed.performanceData) parsed.performanceData = [];
      if (!parsed.paperTradeLogs) parsed.paperTradeLogs = [];
      if (!parsed.metrics) parsed.metrics = {};
    }
    
    return parsed;
  } catch (error) {
    console.error("Error running advanced analysis:", error);
    throw error;
  }
}

export async function fetchCurrentPrice(code: string): Promise<number | null> {
  try {
    const data = await fetchHistoricalData(code, '1d');
    if (data && data.meta?.regularMarketPrice) {
      return data.meta.regularMarketPrice;
    }
    if (data && data.indicators?.quote?.[0]?.close) {
      const quotes = data.indicators.quote[0].close;
      return quotes[quotes.length - 1];
    }
    return null;
  } catch (error) {
    console.error(`Error fetching current price for ${code}:`, error);
    return null;
  }
}

export async function syncStockPrice(stock: StockRecommendation): Promise<StockRecommendation> {
  const ai = getAI();
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayDate = now.split(' ')[0];
  
  // Try real-time API first (Yahoo Finance)
  const realTimePrice = await fetchCurrentPrice(stock.code);
  
  if (realTimePrice) {
    // If we have a real-time price, we can still use AI to update the strategy/news
    // but we provide the real price to the AI to ensure accuracy
    const prompt = `
      현재 한국 시각은 ${now}입니다. (오늘 날짜: ${todayDate})
      종목명: ${stock.name} (${stock.code})
      **실시간 현재가: ${realTimePrice.toLocaleString()}원** (Yahoo Finance 확인됨)
      
      [기존 데이터]
      - 기존 기록된 가격: ${stock.currentPrice}
      - 기존 엔트리가격: ${stock.entryPrice}
      - 기존 타겟가격: ${stock.targetPrice}
      - 기존 손절가: ${stock.stopLoss}

      [필수 작업]
      1. 실시간 현재가(${realTimePrice}원)를 기반으로 엔트리, 타겟, 손절가를 재산출하라.
      2. 'googleSearch'를 사용하여 최신 뉴스 5개와 수급 현황을 검색하라.
      3. 현재가와 기술적 지표 변화를 바탕으로 'type'을 STRONG_BUY, BUY, STRONG_SELL, SELL 중 하나로 업데이트하라.
      4. 'priceUpdatedAt' 필드에 "${new Date().toLocaleTimeString('ko-KR')} (Yahoo Finance)" 라고 명시하라.

      응답은 반드시 다음 JSON 형식으로만 해줘:
      {
        "currentPrice": ${realTimePrice},
        "entryPrice": 0,
        "targetPrice": 0,
        "stopLoss": 0,
        "type": "STRONG_BUY",
        "priceUpdatedAt": "...",
        "recentNews": ["..."],
        "supplyDemand": "...",
        "analysis": "..."
      }
    `;

    try {
      const response = await withRetry(async () => {
        return await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
            toolConfig: { includeServerSideToolInvocations: true },
            temperature: 0,
            maxOutputTokens: 8192,
          }
        });
      }, 2, 2000);
      const text = response.text;
      const parsed = safeJsonParse(text);
      const updatedStock = { ...stock, ...parsed, currentPrice: realTimePrice };
      
      // Enrich with real technical indicators
      return await enrichStockWithRealData(updatedStock);
    } catch (e) {
      // Fallback if AI fails but we have the price
      const fallbackStock = { ...stock, currentPrice: realTimePrice, priceUpdatedAt: `${new Date().toLocaleTimeString('ko-KR')} (Yahoo Finance)` };
      return await enrichStockWithRealData(fallbackStock);
    }
  }

  // Original AI-only fallback if Yahoo Finance fails
  const prompt = `
    현재 한국 시각은 ${now}입니다. (오늘 날짜: ${todayDate})
    종목명: ${stock.name} (${stock.code})
    
    [기존 데이터 (참고용 - 절대 이 가격을 그대로 사용하지 마라)]
    - 기존 기록된 가격: ${stock.currentPrice}
    - 기존 엔트리가격: ${stock.entryPrice}
    - 기존 타겟가격: ${stock.targetPrice}
    - 기존 손절가: ${stock.stopLoss}

    [필수 작업 - 초정밀 실시간 가격 동기화]
    1. 'googleSearch'를 사용하여 다음 쿼리들을 각각 검색하여 최신 정보를 확보하라:
       - '네이버 증권 ${stock.name}' (가장 권장되는 출처)
       - '${todayDate} ${stock.name} 현재가'
       - 'KRX:${stock.code} 실시간 주가'
    2. **[가격 검증 및 채택 원칙]** 
       - 검색 결과에서 '1분 전', '5분 전', '방금 전' 또는 오늘 날짜(${todayDate})가 명시된 가격만 채택하라.
       - 만약 오늘이 주말/공휴일이라면 '가장 최근 거래일(예: ${todayDate} 이전의 금요일) 종가'를 사용하고, 반드시 "03-27 종가(휴장)"와 같이 명시하라.
       - **절대 주의**: 과거의 블로그 포스트, 며칠 전 뉴스, 혹은 AI의 내부 학습 데이터에 의존하지 마라. 오직 검색 결과의 '실시간' 데이터만 믿어라.
    3. **[시가총액 교차 검증]** 
       - 해당 종목의 '현재 시가총액'을 반드시 검색하여 확인하라.
       - [현재가 * 발행주식수 = 시가총액] 공식이 성립하는지 확인하여 가격의 자릿수 오류(예: 37만 vs 133만)를 원천 차단하라.
       - 만약 검색된 가격이 시가총액과 맞지 않는다면(예: 3배 이상 차이), 다른 출처를 다시 검색하라.
    4. **[가격 전략 재산출]** 검색된 최신 현재가를 기반으로, 기존의 엔트리가격, 타겟가격, 손절가를 현재 시장 상황에 맞게 재산출하라.
       - **타겟가격(Target):** 다음 주요 저항선 또는 현재가 대비 10~20% 수익 구간 중 기술적으로 타당한 지점을 설정하라.
       - **손절가(Stop-Loss):** 직전 저점(Swing Low) 또는 주요 이평선 지지선, 혹은 진입가 대비 -5~8% 이내에서 리스크-리워드 비율(최소 1:2)을 고려하여 설정하라.
    5. **[뉴스 및 수급 업데이트]** 해당 종목의 가장 최신 뉴스 5개와 최근 3일간의 기관/외인 수급 현황을 검색하여 반영하라.
    6. **[판단 재평가]** 현재가와 기술적 지표 변화를 바탕으로 'type'을 STRONG_BUY, BUY, STRONG_SELL, SELL 중 하나로 업데이트하라.
    7. **[출처 및 시각 명시]** 'priceUpdatedAt' 필드에 가격 확인 시각과 출처를 명시하라 (예: "15:30 (네이버증권)").

    응답은 반드시 다음 JSON 형식으로만 해줘:
    {
      "currentPrice": 숫자,
      "type": "STRONG_BUY/BUY/STRONG_SELL/SELL",
      "entryPrice": 숫자,
      "entryPrice2": 숫자 또는 null,
      "targetPrice": 숫자,
      "targetPrice2": 숫자 또는 null,
      "stopLoss": 숫자,
      "latestNews": [
        { "headline": "뉴스 제목", "date": "${todayDate}", "url": "https://..." }
      ],
      "technicalSignals": { 
        "maAlignment": "BULLISH", "rsi": 0, "macdStatus": "GOLDEN_CROSS", "bollingerStatus": "NEUTRAL", "stochasticStatus": "NEUTRAL", "volumeSurge": true, "disparity20": 0, "macdHistogram": 0, "bbWidth": 0, "stochRsi": 0,
        "macdHistogramDetail": { "status": "BULLISH", "implication": "..." },
        "bbWidthDetail": { "status": "SQUEEZE", "implication": "..." },
        "stochRsiDetail": { "status": "OVERSOLD", "implication": "..." }
      },
      "priceUpdatedAt": "시각(예: 15:30)"
    }
  `;

  try {
    const result = await withRetry(async () => {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          toolConfig: { includeServerSideToolInvocations: true },
          maxOutputTokens: 1024,
          temperature: 0,
        }
      });
      const text = response.text;
      if (!text) {
        console.error("Full AI Response:", JSON.stringify(response, null, 2));
        throw new Error("No response from AI");
      }
      return safeJsonParse(text);
    }, 2, 2000);

    return {
      ...stock,
      currentPrice: result.currentPrice,
      type: result.type || stock.type,
      entryPrice: result.entryPrice,
      entryPrice2: result.entryPrice2 || stock.entryPrice2,
      targetPrice: result.targetPrice,
      targetPrice2: result.targetPrice2 || stock.targetPrice2,
      stopLoss: result.stopLoss,
      latestNews: result.latestNews || stock.latestNews,
      technicalSignals: result.technicalSignals || stock.technicalSignals,
      priceUpdatedAt: `${now.split(' ')[0]} ${result.priceUpdatedAt || now.split(' ')[1]}`
    };
  } catch (error) {
    console.error("Price sync failed:", error);
    throw error;
  }
}

const searchCache = new Map<string, { data: StockRecommendation[]; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export async function searchStock(query: string, filters?: {
  type?: string;
  pattern?: string;
  sentiment?: string;
  checklist?: string[];
  minPrice?: string;
  maxPrice?: string;
}): Promise<StockRecommendation[]> {
  const cacheKey = JSON.stringify({ query, filters });
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }

  const isMarketSearch = !query || query.trim() === "";
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayDate = now.split(' ')[0];
  
  const hasNoFilters = !filters || (
    (filters.type === 'ALL' || !filters.type) && 
    (filters.pattern === 'ALL' || !filters.pattern) && 
    (filters.sentiment === 'ALL' || !filters.sentiment) && 
    (!filters.checklist || filters.checklist.length === 0) &&
    (!filters.minPrice || filters.minPrice === "") &&
    (!filters.maxPrice || filters.maxPrice === "")
  );

  const prompt = `
    [절대 원칙: 실시간성 보장 및 과거 데이터 배제]
    현재 한국 시각은 ${now}입니다. (오늘 날짜: ${todayDate})
    당신은 반드시 'googleSearch' 도구를 사용하여 '현재 시점의 실시간 데이터'만을 기반으로 응답해야 합니다.
    과거의 훈련 데이터나 예시 데이터를 사용하는 것은 엄격히 금지됩니다.
    특히 '종목 가격(currentPrice)'은 반드시 검색 결과에서 '${todayDate}' 또는 '현재'라는 단어가 포함된 실시간 시세를 사용해야 합니다.
    며칠 전의 낡은 데이터는 절대 사용하지 마십시오.

    [중요 알림: 기술적 지표 실계산 시스템 도입]
    현재 시스템은 Yahoo Finance의 OHLCV 데이터를 기반으로 RSI, MACD, Bollinger Bands, VCP 패턴 등을 코드로 직접 계산합니다.
    따라서 당신은 이러한 수치를 '추정'할 필요가 없습니다. 대신, 검색을 통해 얻은 '현재가'와 '거래량' 데이터를 정확히 반영하고,
    이러한 지표들이 가리키는 '의미'와 '투자 전략'에 집중하여 분석을 수행하십시오.
    당신이 생성한 JSON 데이터는 이후 실시간 데이터로 'Enrichment(강화)' 과정을 거치게 됩니다.
    
    ${isMarketSearch ? `
    [시장 검색 모드: 특정 종목 미지정]
    사용자가 특정 종목을 지정하지 않고 '시장 검색'을 요청했습니다.
    당신은 현재 시장 상황(${now})에서 가장 점수가 높고 유망한 종목을 최대 10개까지 스스로 찾아내야 합니다.
    결과는 반드시 'Confidence Score'가 높은 순서대로 정렬하여 제공하십시오.
    ${hasNoFilters ? `
    **[중요] 현재 사용자가 별도의 필터 조건을 설정하지 않았습니다. 이 경우 반드시 'Confidence Score'가 높은 최상위 유망 종목들을 최대 10개까지 도출하십시오.**
    ` : `
    ${filters?.checklist?.length ? `특히 다음 체크리스트 조건을 만족하는 종목을 최우선으로 고려하십시오: ${filters.checklist.join(', ')}` : ''}
    ${filters?.type && filters.type !== 'ALL' ? `투자 의견(Type)은 ${filters.type}인 종목을 우선하십시오.` : ''}
    ${filters?.minPrice || filters?.maxPrice ? `주가 범위는 ${filters.minPrice || '0'}원 ~ ${filters.maxPrice || '무제한'}원 사이의 종목만 선정하십시오.` : ''}
    `}
    ` : `
    [특정 종목 검색 모드]
    대상 종목: "${query}"
    ${filters?.minPrice || filters?.maxPrice ? `주가 범위는 ${filters.minPrice || '0'}원 ~ ${filters.maxPrice || '무제한'}원 사이인지 확인하십시오.` : ''}
    `}

    [필수 검색 단계 - 실시간 데이터 확보]
    ${isMarketSearch ? `
    1. "오늘의 한국 증시 주도주", "현재 급등주", "기관/외인 대량 매수 종목"을 검색하여 유망 종목 후보를 선정하라.
    2. 선정된 후보들에 대해 실시간 주가, 시가총액, 최신 뉴스, 재무 지표를 검색하여 정밀 분석하라.
    3. **[시가총액 교차 검증 필수]** 모든 종목의 가격은 반드시 시가총액과 대조하여 자릿수 오류가 없는지 확인하라.
    4. **[차트 패턴 분석]** 각 종목의 최근 주가 흐름을 분석하여 헤드 앤 숄더, 역 헤드 앤 숄더, 쌍바닥, 쌍봉, 컵 앤 핸들 등 주요 기술적 패턴을 식별하라.
    ` : `
    1. "${todayDate} ${query} 현재가", "${todayDate} ${query} 실시간 주가", "KRX ${query} 주가"를 검색하여 ${now} 기준의 정확한 가격을 확인하라.
    2. **[초정밀 검증]** 검색 결과 스니펫에서 '1분 전', '5분 전', '방금 전' 또는 오늘 날짜(${todayDate})가 명시된 가격만 채택하라. 며칠 전 데이터는 절대 사용하지 마라.
    3. **[시가총액 교차 검증 필수]** 해당 종목의 시가총액을 검색하여 [현재가 * 발행주식수 = 시가총액] 공식이 맞는지 확인하고 자릿수 오류를 방지하라.
    4. "${query} 최신 뉴스", "${query} 공시"를 검색하여 현재의 모멘텀을 분석하라.
    5. **[DART corpCode 확보]** 해당 종목의 'DART 고유번호(corpCode, 8자리)'를 반드시 검색하여 'corpCode' 필드에 포함하라.
    6. **[차트 패턴 분석]** ${query}의 최근 3개월~1년 주가 차트를 분석하여 헤드 앤 숄더, 역 헤드 앤 숄더, 쌍바닥, 쌍봉, 컵 앤 핸들, 플래그, 패넌트 등 주요 기술적 패턴을 식별하라.
    5. **[뉴스 데이터 확보]** 각 종목에 대해 가장 최근의 뉴스 기사 5개를 찾아 'latestNews' 필드에 [헤드라인, 날짜, URL] 형식으로 포함하라. 반드시 실제 접근 가능한 기사 URL을 제공해야 하며, 허위 URL이나 플레이스홀더를 사용하지 마라.
    `}
    6. **[판단 기준 - STRONG_BUY, BUY, STRONG_SELL, SELL]**
        [BUY/STRONG_BUY 발동 전 필수 선결 조건 - 하나라도 미충족 시 즉시 HOLD]
        ① Gate 1 전부 통과 필수: cycleVerified, roeType3, riskOnEnvironment, mechanicalStop, notPreviousLeader 중 하나라도 False이면 HOLD.
        ② RRR 최소 기준 필수: BUY 2.0 이상, STRONG_BUY 3.0 이상. 미충족 시 HOLD.
        ③ 일목균형표 구름대 위치 필수: ichimokuStatus가 ABOVE_CLOUD 상태여야만 BUY 허용.
        ④ 다이버전스 부재 필수: divergenceCheck가 False이면 STRONG_BUY 발동 금지 (BUY로 강등).

        [BUY 수치 임계값 — 반드시 모두 충족]
        - 기술적 조건: RSI 40~70, 이격도(20일) 97~105%, 볼린저밴드 LOWER_TOUCH 또는 CENTER_REVERSION, MACD 히스토그램 전환/확대 중.
        - 수급 조건: 외인+기관 동반 순매수(BUY 3일, STRONG_BUY 5일), 거래량 20일 평균 150% 이상.
        - 펀더멘털 조건: OCF > 당기순이익, 부채비율 100% 미만, 이자보상배율 3배 초과.
        - 시장 환경 조건: VKOSPI 25 미만, BEAR/RISK_OFF 시 STRONG_BUY 금지 및 BUY 비중 축소.

       - **STRONG_BUY**: 압도적인 상승 모멘텀(RS 상위 5% 이내), 주도주 사이클 초입(신고가 경신), 기관/외인 5거래일 연속 순매수 필수, 모든 기술적 지표가 완벽한 정배열 및 상향 돌파를 가리키며, 27개 체크리스트 중 25개 이상을 만족하는 경우.
       - **BUY**: 명확한 상승 추세, 주도 섹터 1~2순위 부합, 안정적인 수급 유입(최근 5일 중 3일 이상 순매수), 주요 지지선에서의 반등이 확인되었으며, 27개 체크리스트 중 22개 이상을 만족하는 경우.
       - **STRONG_SELL**: 추세 붕괴, 재료 소멸, 극심한 고평가, 대규모 수급 이탈이 명확하며 하락 압력이 매우 강한 경우.
       - **SELL**: 추세 약화, 모멘텀 둔화, 수급 이탈 조짐, 기술적 저항에 부딪힌 경우.
    6. **[엄격한 평가 원칙]** 단순히 '좋아 보인다'는 이유로 BUY를 주지 마라. 위 기준을 '보수적'으로 적용하여 데이터가 확실할 때만 긍정적 의견을 제시하라.
    7. 모든 수치는 ${now} 기준의 최신 데이터여야 하며, 'priceUpdatedAt' 필드에 해당 가격이 확인된 시각(예: 14:30)을 반드시 기록하라.

    ${isMarketSearch ? '현재 시점에서 가장 유망한 종목 최대 10개' : `"${query}" 종목`}에 대해 현재 시점(${now})의 실시간 데이터를 기반으로 '초고도화된 AI 투자 분석 엔진'을 사용하여 가장 정밀한 분석을 수행해줘.
    ${isMarketSearch ? '각 종목이' : '이 종목이'} 현재 시점에서 얼마나 '확실한' 투자 기회인지 확신도(Confidence Score)와 함께 분석하라.

    [분석 고도화 가이드라인]
    1. 주도주 사이클: 한국 증시 70년 역사를 관통하는 주도주 교체 패턴을 고려하여 현재 종목의 위치(New Leader vs Fading Star)를 분석.
    2. 실체적 펀더멘털: '조방원' 섹터와 같이 확실한 수주 잔고와 이익 성장세(Earnings)가 담보되었는지, 아니면 막연한 기대감(Dream)인지 판별.
    3. 심리적 편향 배제: 보유 효과 및 후회 회피 심리를 배제한 객관적 데이터 분석.
    4. 정책 수혜: 정부 정책(중소기업 지원, 일자리 등) 및 글로벌 매크로 피벗 부합 여부.
    5. 터틀 트레이딩(Turtle Trading) 분석: 20일/55일 돌파 전략(Donchian Channel) 및 ATR 기반의 변동성 분석을 통해 추세의 강도와 리스크를 평가.
    6. 피보나치(Fibonacci) 되돌림: 주요 추세의 피보나치 레벨(0.382, 0.5, 0.618)을 분석하여 지지/저항 및 반등 가능성을 정밀 진단.
    7. 엘리엇 파동(Elliott Wave): 현재 파동의 위치(상승 1~5파, 조정 A~C파)를 파악하여 추세의 지속성 및 반전 가능성을 분석.
    8. 수급 및 거래량: 최근 기관/외인의 수급 패턴과 거래량 변화를 통한 매집 여부 판단.
    9. 기술적 위치: 현재 주가가 주요 이평선 대비 어디에 위치하는지, 추세 전환의 신호가 있는지 확인.
    10. 펀더멘털: 최근 실적 발표 내용, ROE 개선 여부, 밸류에이션 매력도 평가.
    11. ROE 심층 분석: DuPont 분석을 통해 ROE의 질(Quality)을 평가하고(마진, 회전율, 레버리지), 과거 3~5년의 구체적인 추세와 향후 전망을 바탕으로 한 즉시 실행 가능한(Actionable) 투자 전략을 수립하라.
    12. 애널리스트 의견 및 목표가: 주요 금융 정보원(네이버 금융, FnGuide 등)을 검색하여 최신 애널리스트 투자의견 분포, 평균 목표주가, 그리고 시장의 전반적인 컨센서스 분위기를 요약하라.
    13. 확신도 산출: 0~100점 사이의 점수를 부여하고, 그 근거를 명확히 제시.
    14. 기술적 지표 심화 분석: MACD Histogram, Bollinger Band Width, Stochastic RSI 지표를 정밀 분석하여 각각의 상태(Bullish/Bearish/Neutral 등)와 그에 따른 주가 모멘텀 함의(Implication)를 도출하라.
    
    [장세 판단 자동화 로직 - 6단계 분류]
    - 강세장(BULL/RISK_ON): KOSPI 지수가 200일 이동평균선(200MA) 위에 있고, VKOSPI가 낮은(20 미만) 상태. 글로벌 위험 선호도가 높은 상태.
    - 약세장(BEAR/RISK_OFF): KOSPI 지수가 200일 이동평균선(200MA) 아래에 있고, VKOSPI가 높은(25 이상) 상태. 글로벌 위험 회피 심리가 강한 상태.
    - 횡보장(SIDEWAYS): KOSPI가 박스권에 갇혀 있으며, 최근 5거래일 거래량이 감소 추세인 상태.
    - 전환장(TRANSITION): 기존 주도주 섹터의 하락과 함께 신규 섹터(예: 신성장 산업)로의 수급 이동 및 주도주 교체 신호가 발생하는 상태.
    - 중립(NEUTRAL): 위 조건들이 명확하지 않은 상태.
    * 'marketPhase' 필드에는 반드시 다음 중 하나만 입력하라: 'BULL', 'BEAR', 'SIDEWAYS', 'TRANSITION', 'NEUTRAL', 'RISK_ON', 'RISK_OFF'

    [AI 기반 동적 가중치 (Dynamic Weighting) - 심화 설계]
    현재 판단된 장세에 따라 27개 체크리스트 항목의 배점을 다음과 같이 정밀 조절하여 'Confidence Score'에 반영하라:
    - 강세장(BULL/RISK_ON): 모멘텀(02), 터틀돌파(18), 엘리엇(20) 항목에 가중치 2.5배 부여. 재무방어력(23), 해자(08) 가중치 0.5배로 축소.
    - 약세장(BEAR/RISK_OFF): 재무방어력(23), 이익의 질(21), 해자(08) 항목에 가중치 2.5배 부여. 모멘텀(02), 수급(04) 가중치 0.5배로 축소.
    - 횡보장(SIDEWAYS): VCP(25), 피보나치(19), 수급질개선(04) 항목에 가중치 2.5배 부여. 주도주 사이클(01), 엘리엇(20) 가중치 0.5배로 축소.
    - 전환장(TRANSITION): 신규 주도주(09), 섹터 사이클(01), 수급(12) 항목에 가중치 2.5배 부여. 기존 모멘텀 전 종목의 가중치를 0.3배로 대폭 축소.

    [분석 고도화 원칙]
    - 촉매제(Catalyst): 확정 일정(30-60일 내), 핫 섹터 연관성, DART 공시의 질(수주/소각 등) 분석.
    - 과거 텐배거 유사도 매칭: 과거 대장주(에코프로, 씨젠 등) 급등 직전 패턴과 비교.
    - 이상 징후 탐지: 실적-주가 괴리 또는 스마트머니 매집 패턴 탐지.
    - 시각적 리포트 요약: "재무 n등급, 차트 n등급, 수급 n등급" 형식 요약 및 핵심 투자 포인트 정리.

    [27단계 마스터 체크리스트 평가 로직]
    다음 27개 항목에 대해 엄격한 기준(Strict Criteria)으로 True/False를 평가하라.
    1. cycleVerified: 새로운 주도주 사이클 진입 여부
    2. momentumRanking: 업종 내 RS 상위 20% 이내 여부
    3. roeType3: 순이익률/자산회전율 기반 ROE 상승 여부
    4. supplyInflow: 최근 5거래일 외국인/기관 양매수 여부
    5. riskOnEnvironment: VIX/VKOSPI 안정 및 위험자산 선호 여부
    6. ichimokuBreakout: 일목 구름대 상향 돌파 여부
    7. mechanicalStop: 명확한 지지선 및 손절가 설정 용이성
    8. economicMoatVerified: 기술력, 독점적 지위 등 해자 확인
    9. notPreviousLeader: 직전 상승장 주도주가 아닌 신선함
    10. technicalGoldenCross: 주요 이평선 골든크로스 발생
    11. volumeSurgeVerified: 바닥권 300% 이상 거래량 급증
    12. institutionalBuying: 연기금/투신 등 핵심 기관 매수
    13. consensusTarget: 최근 1개월 목표가 상향 리포트 2개 이상
    14. earningsSurprise: 최근 실적 컨센서스 10% 상회
    15. performanceReality: 수주/매출 등 실체적 데이터 증명
    16. policyAlignment: 정부 정책 및 매크로 환경 부합
    17. psychologicalObjectivity: 대중 FOMO 이전의 객관적 진입 구간
    18. turtleBreakout: 20일/55일 신고가 경신
    19. fibonacciLevel: 주요 피보나치 레벨 지지 및 반등
    20. elliottWaveVerified: 상승 3파 국면 위치 여부
    21. ocfQuality: OCF > 당기순이익 (현금흐름 우수)
    22. marginAcceleration: 영업이익률(YoY) 개선 가속도
    23. interestCoverage: 이자보상배율 3배 초과 (재무 건전성)
    24. relativeStrength: 지수 대비 강력한 아웃퍼폼
    25. vcpPattern: 변동성 축소 및 거래량 마름 패턴
    26. divergenceCheck: 보조지표 다이버전스 부재 (추세 신뢰도)
    27. catalystAnalysis: 확정 일정, 핫 섹터, DART 공시 기반 촉매

    [응답 지침]
    - 'reason' 필드는 해당 종목의 점수나 등급에 가장 큰 영향을 미친 구체적인 기술적 지표(이평선, RSI, MACD, 볼린저 밴드, 특정 차트 패턴 등)나 펀더멘털 요인(실적 서프라이즈, 기관/외인 수급 집중, 산업 내 경쟁력, 정책 수혜 등)을 반드시 포함하여 3~4문장 이상의 상세한 분석 사유를 작성하라.
    - **[필수]** 'sectorAnalysis' 필드는 해당 종목이 속한 산업 섹터에 대한 AI 분석을 제공하라. 다음 내용을 반드시 포함해야 한다:
       - sectorName: 해당 산업의 명칭 (예: 반도체, 2차전지, AI 소프트웨어 등)
       - currentTrends: 현재 해당 섹터에서 나타나고 있는 주요 트렌드 3~4가지
       - leadingStocks: 해당 섹터를 주도하고 있는 상위 3개 종목 (종목명, 코드, 시가총액 포함)
       - catalysts: 해당 섹터의 주가를 견인할 수 있는 구체적인 촉매제(이벤트, 정책, 실적 등) 3~4가지
       - riskFactors: 해당 섹터 특유의 리스크 요인(규제, 원자재 가격, 경쟁 심화 등) 3~4가지
    - 각 필드의 설명(description 등)은 핵심 위주로 간결하게 작성하라.
    - 불필요한 수식어나 중복된 정보는 배제하라.
    - 반드시 유효한 JSON 형식으로 닫는 중괄호까지 완벽하게 작성하라.
    - 종목 검색 시 최대 5개까지만 결과에 포함하라.

    응답은 반드시 다음 JSON 배열 형식으로만 해줘 (예: [{...}, {...}]):
    [
      {
        "name": "종목명", "code": "종목코드", "corpCode": "00123456", "reason": "...", "type": "STRONG_BUY/BUY/STRONG_SELL/SELL", "patterns": ["..."], "hotness": 9, "roeType": "...",
      "isLeadingSector": true, "isSectorTopPick": true, "momentumRank": 1, "confidenceScore": 85,
      "supplyQuality": { "passive": true, "active": true }, "peakPrice": 0, "currentPrice": 0, "priceUpdatedAt": "...",
      "isPreviousLeader": false, "ichimokuStatus": "ABOVE_CLOUD", "relatedSectors": ["..."],
      "valuation": { "per": 0, "pbr": 0, "epsGrowth": 0, "debtRatio": 0 },
      "technicalSignals": { 
        "maAlignment": "BULLISH", "rsi": 0, "macdStatus": "GOLDEN_CROSS", "bollingerStatus": "NEUTRAL", "stochasticStatus": "NEUTRAL", "volumeSurge": true, "disparity20": 0, "macdHistogram": 0, "bbWidth": 0, "stochRsi": 0,
        "macdHistogramDetail": { "status": "BULLISH", "implication": "..." },
        "bbWidthDetail": { "status": "SQUEEZE", "implication": "..." },
        "stochRsiDetail": { "status": "OVERSOLD", "implication": "..." }
      },
      "economicMoat": { "type": "BRAND", "description": "..." },
      "scores": { "value": 0, "momentum": 0 },
      "shortSelling": { "ratio": 0, "trend": "DECREASING", "implication": "..." },
      "tenbaggerDNA": { "similarity": 0, "matchPattern": "에코프로2023", "reason": "..." },
      "checklist": { "cycleVerified": true, "momentumRanking": true, "roeType3": true, "supplyInflow": true, "riskOnEnvironment": true, "ichimokuBreakout": true, "mechanicalStop": true, "economicMoatVerified": true, "notPreviousLeader": true, "technicalGoldenCross": true, "volumeSurgeVerified": true, "institutionalBuying": true, "consensusTarget": true, "earningsSurprise": true, "performanceReality": true, "policyAlignment": true, "psychologicalObjectivity": true, "turtleBreakout": true, "fibonacciLevel": true, "elliottWaveVerified": true, "ocfQuality": true, "marginAcceleration": true, "interestCoverage": true, "relativeStrength": true, "vcpPattern": true, "divergenceCheck": true, "catalystAnalysis": true },
      "catalystDetail": { "description": "...", "score": 15, "upcomingEvents": ["..."] },
      "catalystSummary": "촉매제 분석 통과 이유(예: 실적 발표 예정, 정부 정책 수혜 등)를 20자 이내로 요약",
      "visualReport": { "financial": 1, "technical": 1, "supply": 1, "summary": "..." },
      "elliottWaveStatus": { "wave": "WAVE_3", "description": "..." },
      "analystRatings": { "strongBuy": 0, "buy": 0, "strongSell": 0, "sell": 0, "consensus": "...", "targetPriceAvg": 0, "targetPriceHigh": 0, "targetPriceLow": 0, "sources": ["..."] },
      "newsSentiment": { "score": 0, "status": "POSITIVE", "summary": "..." },
      "chartPattern": { "name": "쌍바닥", "type": "REVERSAL_BULLISH", "description": "전형적인 바닥 확인 패턴", "reliability": 90 },
      "latestNews": [
        { "headline": "뉴스 제목", "date": "2026-03-28", "url": "https://..." }
      ],
      "roeAnalysis": { "drivers": ["..."], "historicalTrend": "...", "strategy": "...", "metrics": { "netProfitMargin": 0, "assetTurnover": 0, "equityMultiplier": 0 } },
      "strategicInsight": { "cyclePosition": "NEW_LEADER", "earningsQuality": "...", "policyContext": "..." },
      "marketCap": 0, "marketCapCategory": "LARGE", "correlationGroup": "...",
      "aiConvictionScore": { "totalScore": 0, "factors": [{ "name": "...", "score": 0, "weight": 0 }], "marketPhase": "BULL", "description": "..." },
      "shortSelling": { "ratio": 0, "trend": "DECREASING", "implication": "..." },
      "tenbaggerDNA": { "similarity": 0, "matchPattern": "...", "reason": "..." },
      "historicalAnalogy": { "stockName": "...", "period": "...", "similarity": 0, "reason": "..." },
      "anomalyDetection": { "type": "...", "score": 0, "description": "..." },
      "semanticMapping": { "theme": "...", "keywords": ["..."], "relevanceScore": 0, "description": "..." },
      "sectorAnalysis": { "sectorName": "...", "currentTrends": ["..."], "leadingStocks": [{ "name": "...", "code": "...", "marketCap": "..." }], "catalysts": ["..."], "riskFactors": ["..."] },
      "dataSource": "...",
      "targetPrice": 0, "targetPrice2": 0, "entryPrice": 0, "entryPrice2": 0, "stopLoss": 0, "riskFactors": ["..."]
    }
  ]
  `;

  try {
    const parsed = await withRetry(async () => {
      const response = await getAI().models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          toolConfig: { includeServerSideToolInvocations: true },
          maxOutputTokens: 8192,
          temperature: 0,
        },
      });
      const text = response.text;
      if (!text) {
        console.error("Full AI Response:", JSON.stringify(response, null, 2));
        throw new Error("No response from AI");
      }
      return safeJsonParse(text);
    }, 2, 2000);

    const results = Array.isArray(parsed) ? parsed : [parsed];
    
    // Enrich with real data (sequentially)
    console.log(`Enriching ${results.length} search results with real data (sequentially)...`);
    const enrichedResults = [];
    for (const stock of results) {
      try {
        const enriched = await enrichStockWithRealData(stock);
        enrichedResults.push(enriched);
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err) {
        console.error(`Failed to enrich ${stock.name}:`, err);
        enrichedResults.push(stock);
      }
    }
    
    searchCache.set(cacheKey, { data: enrichedResults, timestamp: Date.now() });
    return enrichedResults;
  } catch (error) {
    console.error("Error searching stock:", error);
    throw error;
  }
}

export async function parsePortfolioFile(content: string): Promise<{ name: string; code: string; weight: number }[]> {
  const prompt = `
    다음은 사용자가 업로드한 포트폴리오 관련 텍스트 파일의 내용이야:
    "${content}"

    이 텍스트에서 주식 종목명(또는 코드)과 해당 종목의 비중(%)을 추출해서 JSON 배열 형식으로 반환해줘.
    비중이 명시되지 않았다면 균등 배분(Total 100%)을 가정해서 계산해줘.
    종목 코드를 모른다면 빈 문자열로 두지 말고, 검색을 통해 정확한 종목 코드를 찾아내라.

    응답 형식:
    [
      { "name": "삼성전자", "code": "005930", "weight": 20 },
      { "name": "SK하이닉스", "code": "000660", "weight": 30 },
      ...
    ]
  `;

  try {
    const parsed = await withRetry(async () => {
      const response = await getAI().models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          toolConfig: { includeServerSideToolInvocations: true },
          maxOutputTokens: 1024,
          temperature: 0,
        },
      });
      const text = response.text;
      if (!text) {
        console.error("Full AI Response:", JSON.stringify(response, null, 2));
        throw new Error("No response from AI");
      }
      return safeJsonParse(text);
    }, 2, 2000);

    return parsed;
  } catch (error) {
    console.error("Error parsing portfolio file:", error);
    throw error;
  }
}

export async function generateReportSummary(recommendations: StockRecommendation[], marketContext: MarketContext | null): Promise<string> {
  const cacheKey = `report-summary-...-${new Date().toISOString().split('T')[0]}`;
  return getCachedAIResponse(cacheKey, async () => {
    const prompt = `
      다음은 'QuantMaster Pro' 애플리케이션에서 분석한 주식 시장 상황과 추천 종목 정보야.
      이 내용을 바탕으로 투자 결정에 직접적인 도움을 줄 수 있는 'AI 핵심 요약 리포트'를 작성해줘.

      [시장 상황]
      ${marketContext ? `
      - 코스피: ${marketContext.kospi.index} (${marketContext.kospi.changePercent}%) - ${marketContext.kospi.status}
      - 코스닥: ${marketContext.kosdaq.index} (${marketContext.kosdaq.changePercent}%) - ${marketContext.kosdaq.status}
      - 삼성 IRI: ${marketContext.iri}pt, VKOSPI: ${marketContext.vkospi}%
      - 종합 의견: ${marketContext.overallSentiment}
      ` : '정보 없음'}

      [추천 종목 및 27단계 마스터 체크리스트 분석]
      ${recommendations.map(r => {
        const passedCount = Object.values(r.checklist || {}).filter(Boolean).length;
        const keyItems = Object.entries(r.checklist || {})
          .filter(([_, passed]) => passed)
          .map(([key, _]) => key)
          .slice(0, 5)
          .join(', ');
        
        return `
      - ${r.name} (${r.code}): ${r.type.replace('_', ' ')} 의견, 목표가 ${r.targetPrice?.toLocaleString() || '0'}원.
        * 체크리스트 통과: ${passedCount}/27 (주요 통과 항목: ${keyItems})
        * 분석 사유: ${r.reason}
        * 섹터 분석 (${r.sectorAnalysis?.sectorName || 'N/A'}): 트렌드(${r.sectorAnalysis?.currentTrends?.join(', ') || 'N/A'}), 촉매제(${r.sectorAnalysis?.catalysts?.join(', ') || 'N/A'}), 리스크(${r.sectorAnalysis?.riskFactors?.join(', ') || 'N/A'})
        * 리스크 요인: ${r.riskFactors?.join(', ') || 'N/A'}
        `;
      }).join('\n')}

      작성 가이드라인:
      1. 친절하고 전문적인 어조로 작성하되, 투자자에게 실질적인 통찰을 제공하라.
      2. 현재 시장 상황(Risk-On/Off 여부 등)과 추천 종목들의 강점이 어떻게 맞물리는지 분석하여 첫 단락에 요약하라.
      3. '27단계 마스터 체크리스트'의 통과 비중과 주요 항목(예: ROE 유형, 수급, 기술적 돌파 등)이 해당 종목의 신뢰도에 미치는 영향을 구체적으로 언급하라.
      4. 각 종목별로 투자자가 가장 주의 깊게 봐야 할 '결정적 한 방(Key Insight)'을 제시하라.
      5. 시장 리스크와 개별 종목 리스크를 결합하여 최종적인 투자 판단 가이드를 제공하라.
      6. 전체 길이는 600~800자 내외로 상세하게 작성하고, 마크다운 형식을 적극 활용하라.
    `;

    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
            maxOutputTokens: 2048,
            temperature: 0,
          },
        });
      }, 2, 2000);

      return response.text || "요약을 생성할 수 없습니다.";
    } catch (error: any) {
      const errObj = error?.error || error;
      const message = errObj?.message || error?.message || "";
      if (message.includes('429') || message.includes('quota') || message.includes('RESOURCE_EXHAUSTED')) {
        console.warn("Report summary generation hit rate limit.");
      } else {
        console.error("Error generating report summary:", error);
      }
      throw error;
    }
  });
}

export async function syncMarketOverviewIndices(overview: MarketOverview): Promise<MarketOverview> {
  const indexMap: Record<string, string> = {
    'KOSPI': '^KS11',
    'KOSDAQ': '^KQ11',
    'S&P 500': '^GSPC',
    'NASDAQ': '^IXIC',
    'DOW JONES': '^DJI',
    'NIKKEI 225': '^N225',
    'CSI 300': '000300.SS',
  };

  const updatedIndices = await Promise.all(
    (overview.indices || []).map(async (idx) => {
      const nameUpper = idx.name.toUpperCase();
      const symbol = indexMap[nameUpper] || 
                     (idx.name.includes('코스피') ? '^KS11' : 
                      idx.name.includes('코스닥') ? '^KQ11' : null);
      
      if (symbol) {
        try {
          const data = await fetchHistoricalData(symbol, '1d');
          if (data && data.meta) {
            const price = data.meta.regularMarketPrice;
            const prevClose = data.meta.previousClose;
            const change = price - prevClose;
            const changePercent = Number(((change / prevClose) * 100).toFixed(2));
            return { ...idx, value: price, change, changePercent };
          }
        } catch (e) {
          console.error(`Failed to sync index ${idx.name}`, e);
        }
      }
      return idx;
    })
  );

  return {
    ...overview,
    indices: updatedIndices,
    lastUpdated: new Date().toISOString()
  };
}

export async function getMarketOverview(): Promise<MarketOverview | null> {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayDate = now.split(' ')[0];
  const prompt = `
    현재 한국 시각은 ${now}입니다. (오늘 날짜: ${todayDate})
    현재 글로벌 및 국내 주식 시장 상황을 종합적으로 분석해서 시각화에 적합한 JSON 데이터로 제공해줘.
    다음 항목들을 포함해야 해:
    1. 주요 지수: KOSPI, KOSDAQ, S&P 500, NASDAQ, Dow Jones, Nikkei 225, CSI 300 등 (지수 이름은 반드시 영문 대문자로 통일할 것)
    2. 환율: USD/KRW, JPY/KRW, EUR/KRW 등
    3. 원자재: 금, 국제유가(WTI) 등
    4. 금리: 미국 10년물 국채 금리, 한국 3년물 국채 금리 등
    5. 거시경제 지표: 실업률(Unemployment Rate), 인플레이션(CPI/PCE), 중앙은행 기준금리 결정(Fed/BOK Interest Rate Decisions) 등
    6. SNS 시장 감성 (Sentiment): X(트위터), 네이버 종토방, 텔레그램 등 주요 커뮤니티의 현재 분위기를 분석하여 수치화 (0~100점, 0: 극도의 공포, 100: 극도의 탐욕)
    7. **[신규 퀀트 지표]**:
       - Sector Rotation: 현재 자금이 유입되고 있는 섹터와 유출되고 있는 섹터 분석
       - Euphoria Detector: 시장의 과열 여부를 판단하는 신호 (0~100, 100: 극도 과열)
       - Regime Shift Detector: 현재 시장의 장세 변화 감지 (BULL, BEAR, SIDEWAYS, TRANSITION)
       - Global ETF Monitoring: 주요 글로벌 ETF(SPY, QQQ, SOXX, KODEX 200 등)의 자금 흐름
       - Market Phase: 현재 시장의 단계 (Accumulation, Markup, Distribution, Markdown)
       - Active Strategy: 현재 장세에 가장 적합한 투자 전략 제안
    8. **[AI 동적 가중치 전략 (Dynamic Weighting)]**:
       - 현재 시장 상황(변동성, 금리, 환율, 섹터 순환 등)을 고려하여, 퀀트 엔진의 각 조건(Condition ID 1~27)에 적용할 최적의 가중치 배수(multiplier)를 산출해줘.
       - 예: 변동성이 높으면 리스크 관리(ID 7, 23) 가중치 상향, 상승장 초기면 모멘텀(ID 2, 24) 가중치 상향 등.
       - 결과는 "dynamicWeights": { "1": 1.2, "2": 0.8, ... } 형식으로 제공.
    9. **[매크로 이벤트 달력 (Upcoming Events)]**:
       - FOMC 금리 결정, 한국은행 기준금리 발표, 주요 대형주(삼성전자, SK하이닉스, 현대차 등) 실적 발표일 등 향후 2주 이내의 주요 이벤트를 찾아줘.
       - 각 이벤트에 대해 'strategyAdjustment' 필드에 구체적인 대응 전략을 포함해줘. (예: "금리 결정 전 현금 비중 확대", "실적 발표 전 변동성 대비 포지션 축소" 등)
       - D-Day(dDay)를 계산하여 포함해줘. (오늘 날짜 기준)
    10. 시장 요약: 현재 시장의 핵심 이슈와 흐름을 3~4문장으로 요약

    **[중요: 실시간성 보장]**:
    - 사용자가 "하단부 종합지수가 현재랑 다르게 나옴"이라고 보고했어. 이는 데이터가 과거 것이거나 부정확하다는 뜻이야.
    - KOSPI, KOSDAQ 등 모든 지수 데이터는 반드시 구글 검색 도구를 사용하여 **지금 이 순간의 실시간 시세**를 찾아야 해.
    - 네이버 증권, 다음 금융, 야후 파이낸스 등 신뢰할 수 있는 실시간 시세 사이트의 검색 결과를 우선시해.
    - ${todayDate} 장중 또는 장마감 후의 가장 최신 수치를 정확히 입력해.
    - 지수 값(value)뿐만 아니라 변동폭(change)과 변동률(changePercent)도 현재 시점의 데이터를 반영해야 해.

    응답 형식 (JSON):
    {
      "indices": [...],
      "exchangeRates": [...],
      "commodities": [...],
      "interestRates": [...],
      "macroIndicators": [...],
      "snsSentiment": { ... },
      "sectorRotation": [
        { "sector": "반도체", "momentum": 85, "flow": "INFLOW" },
        { "sector": "이차전지", "momentum": 40, "flow": "OUTFLOW" }
      ],
      "euphoriaSignals": { "score": 45, "status": "NEUTRAL", "implication": "..." },
      "regimeShiftDetector": { "current": "BULL", "probability": 85, "signal": "BUY" },
      "globalEtfMonitoring": [
        { "name": "SPY", "flow": "INFLOW", "change": 1.2 },
        { "name": "QQQ", "flow": "INFLOW", "change": 1.5 }
      ],
      "marketPhase": "Markup",
      "activeStrategy": "추세 추종 및 주도주 집중 매수",
      "dynamicWeights": {
        "1": 1.2, "2": 1.5, "3": 1.0, "4": 1.1, "5": 1.3,
        "7": 1.0, "10": 0.9, "23": 1.0, "24": 1.4, "25": 1.2
      },
      "upcomingEvents": [
        {
          "id": "fomc-2026-04",
          "title": "FOMC 금리 결정",
          "date": "2026-04-04",
          "dDay": 3,
          "type": "MACRO",
          "impact": "HIGH",
          "description": "미 연준의 기준금리 결정 및 파월 의장 기자회견",
          "strategyAdjustment": "VKOSPI 상승 대비 포지션 축소 권고 및 BEAR/RISK_OFF 시나리오 사전 점검",
          "probability": 95
        },
        {
          "id": "hdm-earnings-1q",
          "title": "HD현대중공업 1Q 실적 발표",
          "date": "2026-04-08",
          "dDay": 5,
          "type": "EARNINGS",
          "impact": "MEDIUM",
          "description": "1분기 실적 발표 및 컨퍼런스 콜",
          "strategyAdjustment": "컨센서스 대비 서프라이즈 가능성 55%. 발표 전 포지션 절반 축소 고려",
          "probability": 55
        }
      ],
      "summary": "현재 시장은 ...",
      "lastUpdated": "${new Date().toISOString()}"
    }
  `;

  const hour = new Date().getHours();
  const cacheKey = `market-overview-${todayDate}-${hour}`;
  
  return getCachedAIResponse(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
            temperature: 0.1, // Increased to 0.1 to encourage fresh search
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) {
        console.error("Full AI Response:", JSON.stringify(response, null, 2));
        throw new Error("No response from AI");
      }
      return safeJsonParse(text);
    } catch (error) {
      console.error("Error getting market overview:", error);
      throw error;
    }
  });
}

export async function performWalkForwardAnalysis(): Promise<WalkForwardAnalysis | null> {
  const prompt = `
    QuantMaster Pro의 'Walk-Forward Analysis' 기능을 실행해줘.
    
    분석 조건:
    1. In-Sample (훈련): 2025년 전체 데이터 기반 최적화 로직
    2. Out-of-Sample (검증): 2026년 최근 3개월 (1월~3월) 실전 데이터
    
    분석 항목:
    - 과최적화(Overfitting) 여부 판별 (IS vs OOS 성과 차이 분석)
    - 최신 트렌드 적응력 검증:
      * AI & 반도체 (AI 인프라, HBM, 온디바이스 AI 등 핵심 기술 테마)
      * 밸류업 (기업 가치 제고 프로그램 및 저PBR 테마)
    - Robustness Score 산출 (0~100점)
    
    응답 형식 (JSON):
    {
      "period": "2025 (IS) vs 2026 Q1 (OOS)",
      "robustnessScore": 88,
      "overfittingRisk": "LOW",
      "trendAdaptability": {
        "aiSemiconductor": 92,
        "valueUp": 85,
        "overall": 89
      },
      "metrics": {
        "sharpeRatio": { "inSample": 2.4, "outOfSample": 2.1 },
        "maxDrawdown": { "inSample": -8.5, "outOfSample": -9.2 },
        "winRate": { "inSample": 68, "outOfSample": 65 }
      },
      "insights": [
        "2025년의 고성장주 중심 로직이 2026년 초 밸류업 장세에서도 견고한 방어력을 보임",
        "AI & 반도체 섹터로의 자금 유입을 정확히 포착하여 OOS 수익률 기여도 높음"
      ],
      "recommendations": [
        "현재 로직의 Robustness가 높으므로 유지하되, 저PBR 종목 필터링 가중치를 5% 상향 조정 권장",
        "AI 테마 내에서 실질적인 매출 발생 기업 위주로 포트폴리오 압축 필요"
      ]
    }
  `;

  const cacheKey = `walk-forward-analysis-${new Date().toISOString().split('T')[0]}`;
  
  return getCachedAIResponse(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            temperature: 0, // Set to 0 for maximum consistency
          }
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) {
        console.error("Full AI Response:", JSON.stringify(response, null, 2));
        throw new Error("No response from AI");
      }
      return safeJsonParse(text);
    } catch (error) {
      console.error("Error performing Walk-Forward Analysis:", error);
      throw error;
    }
  });
}
