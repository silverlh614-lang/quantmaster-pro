import { GoogleGenAI } from "@google/genai";
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
  Portfolio,
  EconomicRegimeData,
  SmartMoneyData,
  ExportMomentumData,
  GeopoliticalRiskData,
  CreditSpreadData,
  MacroEnvironment,
  QuantScreenResult,
  DartScreenerResult,
  SilentAccumulationResult,
  ExtendedRegimeData,
  ThemeReverseTrackResult,
  NewsFrequencyScore,
  GlobalMultiSourceData,
  GlobalCorrelationMatrix,
  SupplyChainIntelligence,
  SectorOrderIntelligence,
  FinancialStressIndex,
  FomcSentimentAnalysis,
} from "../types/quant";

import { getMacroSnapshot, snapshotToMacroFields } from './ecosService';

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
  // 1. Legacy direct key (k-stock-api-key)
  const userKey = typeof window !== 'undefined' ? localStorage.getItem('k-stock-api-key') : null;
  // 2. Zustand persisted settings store (k-stock-settings)
  let zustandKey: string | null = null;
  if (!userKey && typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('k-stock-settings');
      if (raw) {
        const parsed = JSON.parse(raw);
        zustandKey = parsed?.state?.userApiKey || null;
      }
    } catch {}
  }
  // 3. Environment variables
  const apiKey = userKey || zustandKey || (typeof process !== 'undefined' ? (process.env.API_KEY || process.env.GEMINI_API_KEY) : undefined);

  if (!apiKey) {
    throw new Error("API Key is missing. Please provide an API key in settings.");
  }

  return new GoogleGenAI({ apiKey });
};

// ─── AI 응답 캐시 (메모리 + localStorage 이중 계층) ─────────────────────────────
//
// 계층 1: 메모리 캐시 — 같은 세션 내 즉각 응답 (무한 TTL → 탭 닫으면 소멸)
// 계층 2: localStorage — 새로고침/탭 재오픈 후에도 유지 (4시간 TTL)
//
// 효과: 앱 시작 시 12개 AI 쿼리 → 첫 실행 1회 후 새로고침해도 localStorage 히트
const aiCache: Record<string, { data: any; timestamp: number }> = {};
const AI_CACHE_TTL    = 4 * 60 * 60 * 1000; // 4시간 (기존 30분 → 8배 연장)
const LS_CACHE_PREFIX = 'qm:ai:';            // localStorage 키 네임스페이스
const LS_MAX_KEYS     = 30;                  // 최대 보관 키 수 (용량 제한)

/** localStorage 안전 읽기 (SSR / 용량 초과 대비) */
function lsGet(key: string): { data: any; timestamp: number } | null {
  try {
    const raw = localStorage.getItem(LS_CACHE_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** localStorage 안전 쓰기 (QuotaExceededError 대비: 가장 오래된 항목 제거 후 재시도) */
function lsSet(key: string, value: { data: any; timestamp: number }): void {
  try {
    localStorage.setItem(LS_CACHE_PREFIX + key, JSON.stringify(value));
  } catch {
    // 용량 초과 시: LS_CACHE_PREFIX 키 중 가장 오래된 것 제거
    try {
      const allKeys = Object.keys(localStorage)
        .filter((k) => k.startsWith(LS_CACHE_PREFIX))
        .map((k) => ({ k, ts: (() => { try { return JSON.parse(localStorage.getItem(k)!).timestamp; } catch { return 0; } })() }))
        .sort((a, b) => a.ts - b.ts);
      // 오래된 항목 절반 제거
      allKeys.slice(0, Math.max(1, Math.floor(allKeys.length / 2))).forEach((e) => localStorage.removeItem(e.k));
      localStorage.setItem(LS_CACHE_PREFIX + key, JSON.stringify(value));
    } catch {
      // localStorage 쓰기 완전 실패 → 무시 (메모리 캐시만 사용)
    }
  }
}

/** localStorage 키 수가 LS_MAX_KEYS 초과 시 오래된 것부터 정리 */
function lsEvictIfNeeded(): void {
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(LS_CACHE_PREFIX));
    if (keys.length <= LS_MAX_KEYS) return;
    keys
      .map((k) => ({ k, ts: (() => { try { return JSON.parse(localStorage.getItem(k)!).timestamp; } catch { return 0; } })() }))
      .sort((a, b) => a.ts - b.ts)
      .slice(0, keys.length - LS_MAX_KEYS)
      .forEach((e) => localStorage.removeItem(e.k));
  } catch {
    // localStorage 접근 불가 시 무시
  }
}

async function getCachedAIResponse<T>(cacheKey: string, fetchFn: () => Promise<T>): Promise<T> {
  const now = Date.now();

  // 1) 메모리 캐시 확인 (TTL 무제한 — 탭 생존 기간 동안 유효)
  const memHit = aiCache[cacheKey];
  if (memHit) {
    console.log(`[AI캐시] 메모리 히트: ${cacheKey.substring(0, 50)}...`);
    return memHit.data as T;
  }

  // 2) localStorage 캐시 확인 (4시간 TTL)
  const lsHit = lsGet(cacheKey);
  if (lsHit && now - lsHit.timestamp < AI_CACHE_TTL) {
    console.log(`[AI캐시] localStorage 히트 (${Math.floor((now - lsHit.timestamp) / 60000)}분 전 캐시): ${cacheKey.substring(0, 50)}...`);
    aiCache[cacheKey] = lsHit; // 메모리에도 복사 → 이후 즉각 응답
    return lsHit.data as T;
  }

  // 3) AI API 실제 호출
  const data = await fetchFn();
  const entry = { data, timestamp: now };
  aiCache[cacheKey] = entry;
  lsEvictIfNeeded();
  lsSet(cacheKey, entry);
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

    const msgLower = message.toLowerCase();
    const isRateLimit = message.includes('429') || status === 429 || code === 429 || status === 'RESOURCE_EXHAUSTED' || message.includes('quota');
    const isServerError = message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504') ||
                        status === 500 || status === 502 || status === 503 || status === 504 ||
                        code === 500 || code === 502 || code === 503 || code === 504 ||
                        status === 'UNKNOWN' || status === 'Internal Server Error' || (typeof status === 'string' && status.includes('500'));
    const isXhrError = msgLower.includes('xhr error') || msgLower.includes('rpc failed') ||
                      msgLower.includes('failed to fetch') || msgLower.includes('networkerror') ||
                      msgLower.includes('aborted') || msgLower.includes('timeout') ||
                      msgLower.includes('deadline exceeded');
    const isAiError = message.includes('No response from AI') || message.includes('Failed to parse AI response');
    const isInvalidArg = message.includes('400') || status === 400 || code === 400 ||
                        status === 'INVALID_ARGUMENT' || msgLower.includes('invalid') ||
                        msgLower.includes('not found') || msgLower.includes('not supported');
    const isGroundingError = msgLower.includes('grounding') || msgLower.includes('google_search') ||
                            msgLower.includes('googlesearch') || msgLower.includes('search tool');

    if (isRateLimit) {
      throw new Error('API 할당량 초과. 잠시 후 다시 시도해주세요.');
    }

    if (isInvalidArg || isGroundingError) {
      console.error(`API 설정 오류 (${message || status || code}). 모델 또는 도구 설정을 확인해주세요.`);
      throw new Error(`API 호출 오류: ${message || '잘못된 요청 설정입니다. API 키와 모델 설정을 확인해주세요.'}`);
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

    // 0.5. Remove JavaScript-style comments (outside of strings)
    cleaned = removeJsonComments(cleaned);

    // 0.6. Fix unquoted property names (e.g., { key: "value" } -> { "key": "value" })
    cleaned = fixUnquotedKeys(cleaned);

    // 0.7. Replace single-quoted strings with double-quoted strings
    cleaned = fixSingleQuotes(cleaned);

    // 0.8. Remove control characters (except \n, \r, \t) that break JSON parsing
    cleaned = cleaned.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

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

/**
 * Remove JavaScript-style comments from JSON text while preserving strings.
 */
function removeJsonComments(text: string): string {
  let result = '';
  let i = 0;
  let inString = false;
  let escaped = false;

  while (i < text.length) {
    const ch = text[i];

    if (inString) {
      result += ch;
      if (ch === '\\' && !escaped) {
        escaped = true;
      } else if (ch === '"' && !escaped) {
        inString = false;
      } else {
        escaped = false;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      escaped = false;
      result += ch;
      i++;
    } else if (ch === '/' && i + 1 < text.length && text[i + 1] === '/') {
      // Single-line comment: skip until end of line
      i += 2;
      while (i < text.length && text[i] !== '\n') i++;
    } else if (ch === '/' && i + 1 < text.length && text[i + 1] === '*') {
      // Block comment: skip until */
      i += 2;
      while (i + 1 < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2; // skip closing */
    } else {
      result += ch;
      i++;
    }
  }

  return result;
}

/**
 * Fix unquoted property names in JSON-like text.
 * Converts { key: "value" } to { "key": "value" }
 */
function fixUnquotedKeys(text: string): string {
  // Match unquoted keys: after { or , followed by optional whitespace, then an identifier, then :
  // But only outside of strings
  let result = '';
  let i = 0;
  let inString = false;
  let escaped = false;

  while (i < text.length) {
    const ch = text[i];

    if (inString) {
      result += ch;
      if (ch === '\\' && !escaped) {
        escaped = true;
      } else if (ch === '"' && !escaped) {
        inString = false;
      } else {
        escaped = false;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      escaped = false;
      result += ch;
      i++;
      continue;
    }

    // Check if we're at a position where an unquoted key could start
    // (after { or , or start of line, with optional whitespace)
    if (/[a-zA-Z_$]/.test(ch)) {
      // Look back to see if this could be a key position
      const prevNonSpace = result.replace(/\s+$/, '').slice(-1);
      if (prevNonSpace === '{' || prevNonSpace === ',') {
        // Capture the identifier
        let key = '';
        let j = i;
        while (j < text.length && /[a-zA-Z0-9_$]/.test(text[j])) {
          key += text[j];
          j++;
        }
        // Skip whitespace after identifier
        let k = j;
        while (k < text.length && /\s/.test(text[k])) k++;
        // Check if followed by ':'
        if (k < text.length && text[k] === ':') {
          // It's an unquoted key — wrap in quotes
          result += '"' + key + '"';
          i = j;
          continue;
        }
      }
    }

    result += ch;
    i++;
  }

  return result;
}

/**
 * Replace single-quoted strings with double-quoted strings in JSON-like text.
 * Handles escaped quotes within strings.
 */
function fixSingleQuotes(text: string): string {
  let result = '';
  let i = 0;
  let inDouble = false;
  let escaped = false;

  while (i < text.length) {
    const ch = text[i];

    if (escaped) {
      result += ch;
      escaped = false;
      i++;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      result += ch;
      i++;
      continue;
    }

    if (inDouble) {
      result += ch;
      if (ch === '"') {
        inDouble = false;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inDouble = true;
      result += ch;
      i++;
      continue;
    }

    if (ch === "'") {
      // Start of single-quoted string — convert to double-quoted
      result += '"';
      i++;
      while (i < text.length) {
        const sc = text[i];
        if (sc === '\\' && i + 1 < text.length) {
          if (text[i + 1] === "'") {
            // Escaped single quote -> just output the single quote
            result += "'";
            i += 2;
          } else {
            result += sc;
            i++;
          }
        } else if (sc === "'") {
          result += '"';
          i++;
          break;
        } else if (sc === '"') {
          // Unescaped double quote inside single-quoted string -> escape it
          result += '\\"';
          i++;
        } else {
          result += sc;
          i++;
        }
      }
      continue;
    }

    result += ch;
    i++;
  }

  return result;
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
  mode?: 'MOMENTUM' | 'EARLY_DETECT' | 'QUANT_SCREEN';
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

  // ── QUANT_SCREEN 모드: 정량 스크리닝 → DART 공시 → 조용한 매집 파이프라인 ──
  if (mode === 'QUANT_SCREEN') {
    return runQuantScreenPipeline(filters);
  }

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
      12. **[글로벌 ETF 모니터링]** 'googleSearch'를 사용하여 KODEX 200(069500), TIGER 미국S&P500(360750), KODEX 레버리지(122630), TIGER 차이나전기차SOLACTIVE(371460) 등 주요 ETF의 현재가, 등락률, 자금 유입/유출 현황을 검색하여 'globalEtfMonitoring' 필드에 반영하라. 각 항목에 반드시 symbol(종목코드), name(ETF명), price(현재가 숫자), change(등락률 숫자 %), flow("INFLOW" 또는 "OUTFLOW"), implication(한글 설명) 필드를 모두 포함하라.
      12-1. **[환율/국채 데이터 수집]** 'googleSearch'를 사용하여 현재 USD/KRW 환율(숫자)과 한국 국채 10년물 금리(숫자, %)를 검색하라. 이를 각각 'exchangeRate': { "value": 환율숫자, "change": 전일대비변동 } 과 'bondYield': { "value": 금리숫자, "change": 전일대비변동 } 형식으로 반드시 실제 데이터로 채워라. 예시값(0) 사용 금지.
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
          { "symbol": "069500", "name": "KODEX 200", "price": 35000, "change": 0.8, "flow": "INFLOW", "implication": "외국인 순매수 유입" },
          { "symbol": "360750", "name": "TIGER 미국S&P500", "price": 18500, "change": -0.3, "flow": "OUTFLOW", "implication": "미국 증시 조정 반영" }
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
    // 기관 일별 순매수 수량 시계열 (최신→과거 → reverse로 과거→최신)
    const institutionalDailyAmounts = rows.map(r => parseInt(r.orgn_ntby_qty || '0')).reverse();
    const result = {
      foreignNet, institutionNet, individualNet, foreignConsecutive,
      institutionalDailyAmounts,
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

export async function fetchHistoricalData(code: string, range: string = '1y', interval: string = '1d'): Promise<any> {
  // Try .KS (KOSPI) first, then .KQ (KOSDAQ) if it looks like a Korean stock code
  // Handle cases where code might already have a suffix or be just 6 digits
  const baseCodeMatch = code.match(/^(\d{6})(\.(KS|KQ))?$/);
  const baseCode = baseCodeMatch ? baseCodeMatch[1] : null;

  const symbols = baseCode ? [`${baseCode}.KS`, `${baseCode}.KQ`] : [code];

  for (const symbol of symbols) {
    const url = `/api/historical-data?symbol=${symbol}&range=${range}&interval=${interval}`;
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
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - years * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  try {
    // 1. Fetch real historical data for each stock and benchmark
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

/**
 * syncStockPrice — 가격 신뢰도 계층 (AI 추정 완전 배제)
 *
 * 1순위: KIS 실시간  → dataSourceType: 'REALTIME'
 * 2순위: Yahoo Finance 서버 프록시 → dataSourceType: 'YAHOO'
 * 3순위: 마지막 알려진 가격 유지   → dataSourceType: 'STALE'
 */
export async function syncStockPrice(stock: StockRecommendation): Promise<StockRecommendation> {
  // 1순위: KIS 실시간
  try {
    const kisResult = await syncStockPriceKIS(stock);
    console.log(`[가격동기화] KIS 실시간 성공: ${stock.name} ${kisResult.currentPrice}원`);
    return await enrichStockWithRealData(kisResult);
  } catch (kisErr: any) {
    console.warn(`[가격동기화] KIS 실패 → Yahoo 시도: ${kisErr.message}`);
  }

  // 2순위: Yahoo Finance (/api/historical-data 서버 프록시) — .KS와 .KQ 모두 시도
  const baseCode = stock.code.replace(/\.(KS|KQ)$/, '');
  const suffixes = ['.KS', '.KQ'];
  for (const suffix of suffixes) {
    try {
      const symbol = `${baseCode}${suffix}`;
      const res = await fetch(`/api/historical-data?symbol=${symbol}&range=1d&interval=1m`);
      if (res.ok) {
        const data = await res.json();
        const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice as number | undefined;
        if (price && price > 0) {
          console.log(`[가격동기화] Yahoo Finance 성공 (${symbol}): ${stock.name} ${price}원`);
          const updated: StockRecommendation = {
            ...stock,
            currentPrice: Math.round(price),
            dataSourceType: 'YAHOO',
            priceUpdatedAt: `${new Date().toLocaleTimeString('ko-KR')} (Yahoo Finance)`,
          };
          return await enrichStockWithRealData(updated);
        }
      }
    } catch (yahooErr: any) {
      console.warn(`[가격동기화] Yahoo ${baseCode}${suffix} 실패: ${yahooErr.message}`);
    }
  }

  // 3순위: 마지막 알려진 가격 유지 (AI 추정 없음)
  console.warn(`[가격동기화] 모든 소스 실패 — STALE 유지: ${stock.name}`);
  return {
    ...stock,
    dataSourceType: 'STALE',
    priceUpdatedAt: `${new Date().toLocaleTimeString('ko-KR')} (가격 업데이트 실패)`,
  };
}

// KIS 실시간 현재가로 syncStockPrice 대체 — dataSourceType을 'REALTIME'으로 설정
export async function syncStockPriceKIS(stock: StockRecommendation): Promise<StockRecommendation> {
  try {
    const res = await fetch('/api/kis/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '/uapi/domestic-stock/v1/quotations/inquire-price',
        method: 'GET',
        headers: {
          'tr_id': 'FHKST01010100',
          'custtype': 'P',
        },
        params: {
          FID_COND_MRKT_DIV_CODE: 'J',
          FID_INPUT_ISCD: stock.code,
        },
      }),
    });
    const data = await res.json();
    const currentPrice = parseInt(data.output?.stck_prpr || '0', 10);
    if (!currentPrice) throw new Error(`KIS 가격 조회 실패: ${JSON.stringify(data)}`);
    return {
      ...stock,
      currentPrice,
      dataSourceType: 'REALTIME',
      priceUpdatedAt: `${new Date().toLocaleTimeString('ko-KR')} (KIS 실시간)`,
    };
  } catch (err) {
    console.error(`[ERROR] syncStockPriceKIS 실패 (${stock.code}):`, err);
    return {
      ...stock,
      dataSourceType: 'STALE',
      priceUpdatedAt: `${new Date().toLocaleTimeString('ko-KR')} (KIS 조회 실패)`,
    };
  }
}

const searchCache = new Map<string, { data: StockRecommendation[]; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export function clearSearchCache() {
  searchCache.clear();
}

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
          maxOutputTokens: 8192,
          temperature: 0.1,
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
  const indexPatterns: { pattern: RegExp; symbol: string }[] = [
    { pattern: /kospi|코스피/i, symbol: '^KS11' },
    { pattern: /kosdaq|코스닥/i, symbol: '^KQ11' },
    { pattern: /s\s*&?\s*p\s*500|spx/i, symbol: '^GSPC' },
    { pattern: /nasdaq|나스닥/i, symbol: '^IXIC' },
    { pattern: /dow\s*jones|다우/i, symbol: '^DJI' },
    { pattern: /nikkei|닛케이/i, symbol: '^N225' },
    { pattern: /csi\s*300/i, symbol: '000300.SS' },
  ];

  const updatedIndices = await Promise.all(
    (overview.indices || []).map(async (idx) => {
      const matched = indexPatterns.find(p => p.pattern.test(idx.name));
      const symbol = matched?.symbol ?? null;
      
      if (symbol) {
        try {
          const data = await fetchHistoricalData(symbol, '1d');
          if (data?.meta?.regularMarketPrice) {
            const price = data.meta.regularMarketPrice;
            const prevClose = data.meta.previousClose || data.meta.chartPreviousClose;
            if (prevClose && prevClose > 0) {
              const change = Number((price - prevClose).toFixed(2));
              const changePercent = Number(((change / prevClose) * 100).toFixed(2));
              return { ...idx, value: price, change, changePercent };
            }
            return { ...idx, value: price };
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
  const cacheKey = `market-overview-${todayDate}-${Math.floor(hour / 6)}`; // 6시간 단위 버킷 (0~3)
  
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

// ─── 배치 통합 호출 (12개 → 3개 압축) ─────────────────────────────────────────
//
// 기존 12개 개별 AI 호출을 3개 배치 호출로 통합.
// Google Search 1회로 공유 컨텍스트 기반 응답 → 품질 향상 + 비용 75% 절감.
//
// Batch 1: getBatchGlobalIntel()  — macro + regime + extendedRegime + creditSpreads + financialStress + smartMoney
// Batch 2: getBatchSectorIntel()  — exportMomentum + geoRisk + supplyChain + sectorOrders
// Batch 3: getBatchMarketIntel()  — globalCorrelation + fomcSentiment

export interface BatchGlobalIntelResult {
  macro: MacroEnvironment;
  regime: EconomicRegimeData;
  extendedRegime: ExtendedRegimeData;
  creditSpreads: CreditSpreadData;
  financialStress: FinancialStressIndex;
  smartMoney: SmartMoneyData;
}

export interface BatchSectorIntelResult {
  exportMomentum: ExportMomentumData;
  geoRisk: GeopoliticalRiskData;
  supplyChain: SupplyChainIntelligence;
  sectorOrders: SectorOrderIntelligence;
}

export interface BatchMarketIntelResult {
  globalCorrelation: GlobalCorrelationMatrix;
  fomcSentiment: FomcSentimentAnalysis;
}

/** Yahoo Finance 시장 지표 조회 (서버 프록시 경유, CORS 없음) */
async function fetchMarketIndicators(): Promise<{
  vix: number | null; us10yYield: number | null;
  usShortRate: number | null; samsungIri: number | null;
}> {
  try {
    const res = await fetch('/api/market-indicators');
    if (!res.ok) throw new Error(`market-indicators ${res.status}`);
    return await res.json();
  } catch {
    return { vix: null, us10yYield: null, usShortRate: null, samsungIri: null };
  }
}

/**
 * Batch 1: 글로벌 거시경제 인텔리전스 통합 호출.
 * Phase A (Search 없음): ECOS + Yahoo → macro 10개 필드 + regime + extendedRegime
 * Phase B (Search 1회): creditSpreads + financialStress + smartMoney
 * 비용: 기존 Search 1회(전체) → Phase A 무료 + Phase B Search 1회(3개 지표만)
 */
export async function getBatchGlobalIntel(): Promise<BatchGlobalIntelResult> {
  const requestedAt = new Date();
  const now = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayDate = now.split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  // ── 1단계: 무료 데이터 병렬 수집 (ECOS 한국은행 + Yahoo Finance, Search 0회) ──
  type EcosF = Partial<{
    bokRateDirection: 'HIKING' | 'HOLDING' | 'CUTTING';
    m2GrowthYoY: number; nominalGdpGrowth: number;
    exportGrowth3mAvg: number; usdKrw: number;
  }>;
  let ecosFields: EcosF = {};
  let yahooFields = { vix: null as number | null, us10yYield: null as number | null,
                      usShortRate: null as number | null, samsungIri: null as number | null };
  let bokRateValue: number | null = null;

  const [ecosSnapshotR, yahooR] = await Promise.allSettled([
    getMacroSnapshot(),
    fetchMarketIndicators(),
  ]);
  if (ecosSnapshotR.status === 'fulfilled') {
    const snap = ecosSnapshotR.value;
    ecosFields = snapshotToMacroFields(snap);
    if (snap.bokRate) bokRateValue = snap.bokRate.rate;
    console.log('[getBatchGlobalIntel] ECOS 수집 완료:', Object.keys(ecosFields));
  } else {
    console.warn('[getBatchGlobalIntel] ECOS 수집 실패:', ecosSnapshotR.reason);
  }
  if (yahooR.status === 'fulfilled') {
    yahooFields = yahooR.value;
    console.log('[getBatchGlobalIntel] Yahoo 수집 완료: vix=%d us10y=%d', yahooFields.vix, yahooFields.us10yYield);
  }

  // krUsSpread = 한국 기준금리 - 미국 단기금리(^IRX proxy)
  const krUsSpread = (bokRateValue !== null && yahooFields.usShortRate !== null)
    ? parseFloat((bokRateValue - yahooFields.usShortRate).toFixed(2))
    : null;

  // 사전 확보 필드 조합 (AI Phase A에 전달 → 검색 대체)
  const preFilledMacro: Record<string, number | string> = {
    ...(ecosFields.bokRateDirection ? { bokRateDirection: ecosFields.bokRateDirection } : {}),
    ...(ecosFields.m2GrowthYoY       !== undefined ? { m2GrowthYoY:       ecosFields.m2GrowthYoY }       : {}),
    ...(ecosFields.nominalGdpGrowth  !== undefined ? { nominalGdpGrowth:  ecosFields.nominalGdpGrowth }  : {}),
    ...(ecosFields.exportGrowth3mAvg !== undefined ? { exportGrowth3mAvg: ecosFields.exportGrowth3mAvg } : {}),
    ...(ecosFields.usdKrw            !== undefined ? { usdKrw:            ecosFields.usdKrw }            : {}),
    ...(yahooFields.vix       !== null ? { vix:        yahooFields.vix }       : {}),
    ...(yahooFields.us10yYield !== null ? { us10yYield: yahooFields.us10yYield } : {}),
    ...(yahooFields.samsungIri !== null ? { samsungIri: yahooFields.samsungIri } : {}),
    ...(krUsSpread             !== null ? { krUsSpread }                          : {}),
  };
  const preFilledCount = Object.keys(preFilledMacro).length;
  console.log(`[getBatchGlobalIntel] 사전 확보 macro 필드 ${preFilledCount}/12`);

  // ── Phase A 프롬프트: Search 없이 API 수치 기반 해석 (macro 완성 + regime 분류) ──
  const phaseAPrompt = `현재 한국 날짜: ${todayDate}

아래는 ECOS 한국은행 + Yahoo Finance에서 수집한 실제 수치입니다.
Google 검색 없이 이 데이터만으로 분석하세요.

[확보 실데이터 ${preFilledCount}/12개]
${JSON.stringify(preFilledMacro, null, 2)}

━━━ 1. macro: 12개 지표 완성 ━━━
확보된 필드는 그대로 사용. 누락 필드만 주어진 데이터로 추정:
- vkospi: vix가 있으면 vix×0.85 근사
- bankLendingGrowth: m2GrowthYoY 기반 추정
- oeciCliKorea: exportGrowth3mAvg + nominalGdpGrowth 기반 추정

━━━ 2. regime: 경기 레짐 (4단계) ━━━
RECOVERY/EXPANSION/SLOWDOWN/RECESSION.
- regime, confidence(0-100), rationale, allowedSectors(최대6), avoidSectors(최대4)
- keyIndicators: { exportGrowth, bokRateDirection, oeciCli, gdpGrowth }

━━━ 3. extendedRegime: 7단계 레짐 ━━━
RECOVERY/EXPANSION/SLOWDOWN/RECESSION/UNCERTAIN/CRISIS/RANGE_BOUND.
- 기본 regime 필드 + uncertaintyMetrics + systemAction
- uncertaintyMetrics: { regimeClarity(0-100), signalConflict(0-100), kospi60dVolatility, leadingSectorCount, foreignFlowDirection("CONSISTENT_BUY"|"CONSISTENT_SELL"|"ALTERNATING"), correlationBreakdown(boolean) }
- systemAction: { mode("NORMAL"|"DEFENSIVE"|"CASH_HEAVY"|"FULL_STOP"|"PAIR_TRADE"), cashRatio(0-100), gateAdjustment: { gate1Threshold, gate2Required, gate3Required }, message }

모든 lastUpdated: "${requestedAtISO}"
응답 형식 (JSON only): { "macro": {...}, "regime": {...}, "extendedRegime": {...} }`.trim();

  // ── Phase B 프롬프트: Search 1회, 3개 금융 지표만 ──
  const phaseBPrompt = `현재 한국 날짜: ${todayDate}

Google 검색으로 아래 3가지 금융시장 지표를 조회하고 JSON으로 반환하세요.

━━━ 1. creditSpreads: 신용 스프레드 ━━━
- krCorporateSpread(bp), usHySpread(bp), embiSpread(bp)
- isCrisisAlert: krCorporateSpread>=150, isLiquidityExpanding: NARROWING AND <100
- trend: "WIDENING"|"NARROWING"|"STABLE"

━━━ 2. financialStress: 금융 스트레스 지수 ━━━
- tedSpread: {bps, alert("NORMAL"|"ELEVATED"|"CRISIS")}
- usHySpread: {bps, trend("TIGHTENING"|"STABLE"|"WIDENING")}
- moveIndex: {current, alert("NORMAL"|"ELEVATED"|"EXTREME")}
- compositeScore(0-100), systemAction("NORMAL"|"CAUTION"|"DEFENSIVE"|"CRISIS")

━━━ 3. smartMoney: 스마트머니 ETF 흐름 ━━━
EWY/MTUM/EEMV/IYW/ITA 주간 자금흐름.
- score(0-10): EWY+MTUM 동시=+4, EWY=+2, MTUM=+1, EEMV/IYW/ITA 각+1
- etfFlows: [{ticker,name,flow("INFLOW"|"OUTFLOW"|"NEUTRAL"),weeklyAumChange(%),priceChange(%),significance}]
- isEwyMtumBothInflow(boolean), leadTimeWeeks, signal("BULLISH"|"BEARISH"|"NEUTRAL")

모든 lastUpdated: "${requestedAtISO}"
응답 형식 (JSON only): { "creditSpreads": {...}, "financialStress": {...}, "smartMoney": {...} }`.trim();

  const cacheKey = `batch-global-intel-${todayDate}`;

  return getCachedAIResponse<BatchGlobalIntelResult>(cacheKey, async () => {
    // Phase A (Search 없음) + Phase B (Search 1회) 병렬 실행
    const [phaseARes, phaseBRes] = await Promise.allSettled([
      withRetry(() => getAI().models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: phaseAPrompt,
        config: { temperature: 0.1, maxOutputTokens: 4096 },
      }), 2, 2000),
      withRetry(() => getAI().models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: phaseBPrompt,
        config: { tools: [{ googleSearch: {} }], temperature: 0.1, maxOutputTokens: 4096 },
      }), 2, 2000),
    ]);

    if (phaseARes.status === 'rejected') console.error('[getBatchGlobalIntel] Phase A 실패:', phaseARes.reason);
    if (phaseBRes.status === 'rejected') console.error('[getBatchGlobalIntel] Phase B 실패:', phaseBRes.reason);

    const fallbackMacro = {
      bokRateDirection: 'HOLDING' as const, us10yYield: 4.3, krUsSpread: -1.25,
      m2GrowthYoY: 6.0, bankLendingGrowth: 5.0, nominalGdpGrowth: 3.5,
      oeciCliKorea: 100.0, exportGrowth3mAvg: 8.0, vkospi: 18.0,
      samsungIri: 1.0, vix: 18.0, usdKrw: 1380.0,
    };
    const fallbackRegime = {
      regime: 'EXPANSION' as const, confidence: 50, rationale: 'Phase A 실패. 기본값.',
      allowedSectors: ['반도체', '조선', '방산'], avoidSectors: [],
      keyIndicators: { exportGrowth: 'N/A', bokRateDirection: 'N/A', oeciCli: 'N/A', gdpGrowth: 'N/A' },
      lastUpdated: requestedAtISO,
    };

    const parsedA = (phaseARes.status === 'fulfilled' && phaseARes.value.text)
      ? safeJsonParse(phaseARes.value.text) as Pick<BatchGlobalIntelResult, 'macro' | 'regime' | 'extendedRegime'>
      : null;
    const parsedB = (phaseBRes.status === 'fulfilled' && phaseBRes.value.text)
      ? safeJsonParse(phaseBRes.value.text) as Pick<BatchGlobalIntelResult, 'creditSpreads' | 'financialStress' | 'smartMoney'>
      : null;

    const parsed: BatchGlobalIntelResult = {
      macro:          parsedA?.macro          ?? fallbackMacro,
      regime:         parsedA?.regime         ?? fallbackRegime,
      extendedRegime: parsedA?.extendedRegime ?? {
        ...fallbackRegime,
        uncertaintyMetrics: { regimeClarity: 50, signalConflict: 50, kospi60dVolatility: 0, leadingSectorCount: 0, foreignFlowDirection: 'ALTERNATING' as const, correlationBreakdown: false },
        systemAction: { mode: 'DEFENSIVE' as const, cashRatio: 50, gateAdjustment: { gate1Threshold: 6, gate2Required: 10, gate3Required: 8 }, message: 'Phase A 실패. 방어 모드.' },
      },
      creditSpreads:  parsedB?.creditSpreads  ?? { krCorporateSpread: 70, usHySpread: 330, embiSpread: 390, isCrisisAlert: false, isLiquidityExpanding: false, trend: 'STABLE' as const, lastUpdated: requestedAtISO },
      financialStress:parsedB?.financialStress ?? { tedSpread: { bps: 0, alert: 'NORMAL' as const }, usHySpread: { bps: 0, trend: 'STABLE' as const }, moveIndex: { current: 0, alert: 'NORMAL' as const }, compositeScore: 0, systemAction: 'NORMAL' as const, lastUpdated: requestedAtISO },
      smartMoney:     parsedB?.smartMoney     ?? { score: 5, etfFlows: [], isEwyMtumBothInflow: false, leadTimeWeeks: 'N/A', signal: 'NEUTRAL' as const, lastUpdated: requestedAtISO },
    };

    // ── API 실데이터로 macro 오버라이드 (ECOS + Yahoo, AI 추정값보다 우선) ──
    const apiOverride = {
      ...ecosFields,
      ...(yahooFields.vix        !== null ? { vix:        yahooFields.vix }        : {}),
      ...(yahooFields.us10yYield !== null ? { us10yYield: yahooFields.us10yYield } : {}),
      ...(yahooFields.samsungIri !== null ? { samsungIri: yahooFields.samsungIri } : {}),
      ...(krUsSpread             !== null ? { krUsSpread }                          : {}),
    } as Partial<typeof parsed.macro>;
    if (Object.keys(apiOverride).length > 0) {
      parsed.macro = { ...parsed.macro, ...apiOverride };
      console.log('[getBatchGlobalIntel] API 실데이터 오버라이드:', Object.keys(apiOverride));
    }

    // 개별 캐시 저장 → 기존 개별 함수 호출 시 캐시 히트
    const nowTs   = Date.now();
    const macroKey  = `macro-environment-${todayDate}`;
    const regimeKey = `economic-regime-${todayDate}`;
    const extRegKey = `extended-regime-${todayDate}`;
    const weekKey   = `${requestedAt.getFullYear()}-W${Math.ceil((requestedAt.getDate() - requestedAt.getDay() + 1) / 7).toString().padStart(2, '0')}`;
    const creditKey = `credit-spread-${weekKey}`;
    const fsiKey    = `financial-stress-index-${weekKey}`;
    const smartKey  = `smart-money-${todayDate}`;

    if (parsed.macro)           { aiCache[macroKey]  = { data: parsed.macro,           timestamp: nowTs }; lsSet(macroKey,  { data: parsed.macro,           timestamp: nowTs }); }
    if (parsed.regime)          { aiCache[regimeKey] = { data: parsed.regime,          timestamp: nowTs }; lsSet(regimeKey, { data: parsed.regime,          timestamp: nowTs }); }
    if (parsed.extendedRegime)  { aiCache[extRegKey] = { data: parsed.extendedRegime,  timestamp: nowTs }; lsSet(extRegKey, { data: parsed.extendedRegime,  timestamp: nowTs }); }
    if (parsed.creditSpreads)   { aiCache[creditKey] = { data: parsed.creditSpreads,   timestamp: nowTs }; lsSet(creditKey, { data: parsed.creditSpreads,   timestamp: nowTs }); }
    if (parsed.financialStress) { aiCache[fsiKey]    = { data: parsed.financialStress, timestamp: nowTs }; lsSet(fsiKey,    { data: parsed.financialStress, timestamp: nowTs }); }
    if (parsed.smartMoney)      { aiCache[smartKey]  = { data: parsed.smartMoney,      timestamp: nowTs }; lsSet(smartKey,  { data: parsed.smartMoney,      timestamp: nowTs }); }

    return parsed;
  });
}

/**
 * Batch 2: 섹터/무역 인텔리전스 통합 호출.
 * exportMomentum + geoRisk + supplyChain + sectorOrders
 * 4개 개별 호출 → 1회 Google Search로 통합.
 */
export async function getBatchSectorIntel(): Promise<BatchSectorIntelResult> {
  const requestedAt = new Date();
  const now = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayDate = now.split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
현재 한국 날짜: ${todayDate}

다음 4가지 섹터/무역 분석을 한번에 수행하고 JSON으로 반환하세요.
Google 검색을 통해 최신 데이터를 기반으로 판단하세요.

━━━ 1. exportMomentum: 수출 모멘텀 ━━━
한국 5대 수출 품목(반도체, 선박, 자동차, 석유화학, 방산) YoY 증감률 조회.
- hotSectors: YoY > 10% 품목명 배열
- products: [{ product, sector, yoyGrowth, isHot(boolean), consecutiveGrowthMonths? }]
- shipyardBonus: 선박 YoY >= +30%
- semiconductorGate2Relax: 반도체 3개월 연속 YoY 증가

━━━ 2. geoRisk: 지정학 리스크 스코어 ━━━
키워드: 한반도 안보, NATO 방산 예산, 원자력/SMR 정책, 한국 조선 수주
- score(0-10): 기본5, NATO 방산 증가+2, 원자력/SMR 기회+1, 조선 수주 호조+1, 한반도 긴장-2, 극도 불확실-3
- level: "OPPORTUNITY"|"NEUTRAL"|"RISK"
- affectedSectors, headlines(주요 뉴스 3개), toneBreakdown: { positive, neutral, negative }

━━━ 3. supplyChain: 공급망 선행지표 ━━━
- bdi: { current, mom3Change(%), trend("SURGING"|"RISING"|"FLAT"|"FALLING"|"COLLAPSING"), sectorImplication }
- semiBillings: { latestBillionUSD, yoyGrowth(%), bookToBill, implication }
- gcfi: { shanghaiEurope($/40ft), transPacific($/40ft), trend("RISING"|"FLAT"|"FALLING") }

━━━ 4. sectorOrders: 글로벌 수주 인텔리전스 ━━━
- globalDefense: { natoGdpAvg(%), usDefenseBudget(억달러), trend("EXPANDING"|"STABLE"|"CUTTING"), koreaExposure }
- lngOrders: { newOrdersYTD(척), qatarEnergy(현황), orderBookMonths, implication }
- smrContracts: { usNrcApprovals, totalGwCapacity(GW), koreaHyundai(현황), timing("TOO_EARLY"|"OPTIMAL"|"LATE") }

모든 lastUpdated는 "${requestedAtISO}"로 설정.

응답 형식 (JSON only):
{
  "exportMomentum": { "hotSectors": [...], "products": [...], "shipyardBonus": true, "semiconductorGate2Relax": true, "lastUpdated": "..." },
  "geoRisk": { "score": 7, "level": "OPPORTUNITY", "affectedSectors": [...], "headlines": [...], "toneBreakdown": {...}, "lastUpdated": "..." },
  "supplyChain": { "bdi": {...}, "semiBillings": {...}, "gcfi": {...}, "lastUpdated": "..." },
  "sectorOrders": { "globalDefense": {...}, "lngOrders": {...}, "smrContracts": {...}, "lastUpdated": "..." }
}
  `.trim();

  const cacheKey = `batch-sector-intel-${todayDate}`;

  return getCachedAIResponse<BatchSectorIntelResult>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
            temperature: 0.1,
            maxOutputTokens: 8192,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      const parsed = safeJsonParse(text) as BatchSectorIntelResult;

      // 개별 캐시에도 저장
      const tsNow = Date.now();
      const yearMonth = requestedAt.toISOString().slice(0, 7);
      const weekKey = `${requestedAt.getFullYear()}-W${Math.ceil(requestedAt.getDate() / 7)}`;

      if (parsed.exportMomentum) { const k = `export-momentum-${yearMonth}`; aiCache[k] = { data: parsed.exportMomentum, timestamp: tsNow }; lsSet(k, { data: parsed.exportMomentum, timestamp: tsNow }); }
      if (parsed.geoRisk) { const k = `geo-risk-${weekKey}`; aiCache[k] = { data: parsed.geoRisk, timestamp: tsNow }; lsSet(k, { data: parsed.geoRisk, timestamp: tsNow }); }
      if (parsed.supplyChain) { const k = `supply-chain-intel-${weekKey}`; aiCache[k] = { data: parsed.supplyChain, timestamp: tsNow }; lsSet(k, { data: parsed.supplyChain, timestamp: tsNow }); }
      if (parsed.sectorOrders) { const k = `sector-order-intel-${weekKey}`; aiCache[k] = { data: parsed.sectorOrders, timestamp: tsNow }; lsSet(k, { data: parsed.sectorOrders, timestamp: tsNow }); }

      return parsed;
    } catch (error) {
      console.error("Error in getBatchSectorIntel:", error);
      return {
        exportMomentum: { hotSectors: [], products: [], shipyardBonus: false, semiconductorGate2Relax: false, lastUpdated: requestedAtISO },
        geoRisk: { score: 5, level: 'NEUTRAL', affectedSectors: ['방위산업', '조선', '원자력'], headlines: [], toneBreakdown: { positive: 33, neutral: 34, negative: 33 }, lastUpdated: requestedAtISO },
        supplyChain: {
          bdi: { current: 0, mom3Change: 0, trend: 'FLAT', sectorImplication: '데이터 조회 실패' },
          semiBillings: { latestBillionUSD: 0, yoyGrowth: 0, bookToBill: 1.0, implication: '데이터 조회 실패' },
          gcfi: { shanghaiEurope: 0, transPacific: 0, trend: 'FLAT' }, lastUpdated: requestedAtISO,
        },
        sectorOrders: {
          globalDefense: { natoGdpAvg: 0, usDefenseBudget: 0, trend: 'STABLE', koreaExposure: '데이터 조회 실패' },
          lngOrders: { newOrdersYTD: 0, qatarEnergy: '데이터 조회 실패', orderBookMonths: 0, implication: '데이터 조회 실패' },
          smrContracts: { usNrcApprovals: 0, totalGwCapacity: 0, koreaHyundai: '데이터 조회 실패', timing: 'TOO_EARLY' }, lastUpdated: requestedAtISO,
        },
      };
    }
  });
}

/**
 * Batch 3: 시장 상관관계 & 센티먼트 통합 호출.
 * globalCorrelation + fomcSentiment
 * 2개 개별 호출 → 1회로 통합.
 */
export async function getBatchMarketIntel(): Promise<BatchMarketIntelResult> {
  const requestedAt = new Date();
  const now = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayDate = now.split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
현재 날짜: ${todayDate}

다음 2가지 시장 분석을 한번에 수행하고 JSON으로 반환하세요.
Google 검색을 통해 최신 데이터를 기반으로 판단하세요.

━━━ 1. globalCorrelation: 글로벌 상관관계 매트릭스 ━━━
최근 30거래일 상관계수 추정:
- kospiSp500: KOSPI-S&P500 (정상 0.6~0.8, 디커플링 <0.3, 동조화 >0.9)
- kospiNikkei: KOSPI-닛케이225 (정상 0.5~0.7)
- kospiShanghai: KOSPI-상해종합 (정상 0.3~0.6)
- kospiDxy: KOSPI-달러인덱스 (보통 음의 상관 -0.3~-0.6)
- isDecoupling: kospiSp500 < 0.3
- isGlobalSync: kospiSp500 > 0.9

━━━ 2. fomcSentiment: FOMC 감성 분석 ━━━
최근 FOMC 의사록/성명서 기반:
- hawkDovishScore: -10(극비둘기) ~ +10(극매파)
- keyPhrases: 핵심 문구 배열 (예: "data dependent", "higher for longer")
- dotPlotShift: "MORE_CUTS"|"UNCHANGED"|"FEWER_CUTS"
- kospiImpact: "BULLISH"(비둘기≤-5)|"NEUTRAL"(-5~+5)|"BEARISH"(매파≥+5)
- rationale: 한국 증시 영향 근거 (한국어)

모든 lastUpdated는 "${requestedAtISO}"로 설정.

응답 형식 (JSON only):
{
  "globalCorrelation": { "kospiSp500": 0.72, "kospiNikkei": 0.58, "kospiShanghai": 0.41, "kospiDxy": -0.45, "isDecoupling": false, "isGlobalSync": false, "lastUpdated": "..." },
  "fomcSentiment": { "hawkDovishScore": 3, "keyPhrases": [...], "dotPlotShift": "FEWER_CUTS", "kospiImpact": "BEARISH", "rationale": "...", "lastUpdated": "..." }
}
  `.trim();

  const weekKey = `${requestedAt.getFullYear()}-W${Math.ceil(requestedAt.getDate() / 7)}`;
  const cacheKey = `batch-market-intel-${weekKey}`;

  return getCachedAIResponse<BatchMarketIntelResult>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
            temperature: 0.1,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      const parsed = safeJsonParse(text) as BatchMarketIntelResult;

      // 개별 캐시에도 저장
      const tsNow = Date.now();
      if (parsed.globalCorrelation) { const k = `global-correlation-${weekKey}`; aiCache[k] = { data: parsed.globalCorrelation, timestamp: tsNow }; lsSet(k, { data: parsed.globalCorrelation, timestamp: tsNow }); }
      if (parsed.fomcSentiment) { const k = `fomc-sentiment-${weekKey}`; aiCache[k] = { data: parsed.fomcSentiment, timestamp: tsNow }; lsSet(k, { data: parsed.fomcSentiment, timestamp: tsNow }); }

      return parsed;
    } catch (error) {
      console.error("Error in getBatchMarketIntel:", error);
      return {
        globalCorrelation: {
          kospiSp500: 0.7, kospiNikkei: 0.55, kospiShanghai: 0.4, kospiDxy: -0.45,
          isDecoupling: false, isGlobalSync: false, lastUpdated: requestedAtISO,
        },
        fomcSentiment: {
          hawkDovishScore: 0, keyPhrases: [], dotPlotShift: 'UNCHANGED',
          kospiImpact: 'NEUTRAL', rationale: 'FOMC 감성 분석 실패. 기본값 적용.', lastUpdated: requestedAtISO,
        },
      };
    }
  });
}

// ─── 아이디어 2: 경기 레짐 자동 분류기 (Economic Regime Classifier) ──────────

/**
 * Gemini + Google Search 기반으로 현재 한국 경기 사이클 레짐을 분류합니다.
 * RECOVERY → EXPANSION → SLOWDOWN → RECESSION 4단계 중 하나를 반환하며,
 * 현재 레짐에 부합하는 허용 섹터 화이트리스트를 함께 제공합니다.
 */
export async function getEconomicRegime(): Promise<EconomicRegimeData> {
  const todayDate = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const cacheKey = `economic-regime-${todayDate}`;
  // 배치 캐시에서 읽음 — 별도 Google Search 없음 (Search 1회 절약)
  return getCachedAIResponse<EconomicRegimeData>(cacheKey, async () => {
    const batch = await getBatchGlobalIntel();
    return batch.regime;
  });
}

// ─── 아이디어 4: Smart Money Radar (글로벌 ETF 선행 모니터) ──────────────────

/**
 * EWY·MTUM·EEMV·IYW·ITA 5개 ETF의 주간 자금흐름을 분석해
 * Smart Money Flow Score(0-10)를 산출합니다.
 * EWY + MTUM 동반 유입 감지 시 → Gate 2 통과 기준 선제 완화 신호를 반환합니다.
 */
export async function getSmartMoneyFlow(): Promise<SmartMoneyData> {
  const todayDate = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const cacheKey = `smart-money-${todayDate}`;
  // 배치 캐시에서 읽음 — 별도 Google Search 없음 (Search 1회 절약)
  return getCachedAIResponse<SmartMoneyData>(cacheKey, async () => {
    const batch = await getBatchGlobalIntel();
    return batch.smartMoney;
  });
}

// ─── 아이디어 5: 수출 선행지수 섹터 로테이션 엔진 ────────────────────────────

/**
 * 한국 주요 수출 품목(반도체·선박·자동차·석유화학·방산)의 YoY 증감률을 조회해
 * 수출 모멘텀 섹터를 분류하고 Gate 2 완화·스코어 가산 조건을 반환합니다.
 */
export async function getExportMomentum(): Promise<ExportMomentumData> {
  const requestedAt = new Date();
  const yearMonth = requestedAt.toISOString().slice(0, 7); // "2026-04"
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
    현재 날짜: ${requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}

    한국 산업통상자원부 또는 관세청의 최근 수출 데이터를 구글 검색으로 조회해줘.
    아래 5개 주요 수출 품목의 전년 동기 대비(YoY) 증감률을 확인해줘.

    품목: 반도체, 선박, 자동차, 석유화학, 방산(무기·방산 수출)

    분류 기준:
    - isHot = true: YoY 증가율 > 10% 또는 해당 품목 수출이 전체 수출 증가를 주도
    - shipyardBonus: 선박 수출 YoY ≥ +30%
    - semiconductorGate2Relax: 반도체 수출 3개월 연속 YoY 증가

    응답 형식 (JSON only):
    {
      "hotSectors": ["반도체", "조선"],
      "products": [
        { "product": "반도체", "sector": "반도체/IT", "yoyGrowth": 18.5, "isHot": true, "consecutiveGrowthMonths": 4 },
        { "product": "선박", "sector": "조선", "yoyGrowth": 32.1, "isHot": true },
        { "product": "자동차", "sector": "자동차/부품", "yoyGrowth": 5.2, "isHot": false },
        { "product": "석유화학", "sector": "석유화학", "yoyGrowth": -3.1, "isHot": false },
        { "product": "방산", "sector": "방위산업", "yoyGrowth": 25.0, "isHot": true }
      ],
      "shipyardBonus": true,
      "semiconductorGate2Relax": true,
      "lastUpdated": "${requestedAtISO}"
    }
  `;

  const cacheKey = `export-momentum-${yearMonth}`;

  return getCachedAIResponse<ExportMomentumData>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: { temperature: 0.1 },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as ExportMomentumData;
    } catch (error) {
      console.error("Error getting export momentum:", error);
      return {
        hotSectors: [],
        products: [],
        shipyardBonus: false,
        semiconductorGate2Relax: false,
        lastUpdated: requestedAtISO,
      };
    }
  });
}

// ─── 아이디어 7: 지정학 리스크 스코어링 모듈 (Geopolitical Risk Engine) ──────

/**
 * Gemini Google Search로 지정학 키워드를 분석해
 * Geopolitical Opportunity Score(GOS 0-10)를 산출합니다.
 * GOS ≥ 7: 방산·조선·원자력 Gate 3 완화 / GOS ≤ 3: Kelly 30% 하향
 */
export async function getGeopoliticalRiskScore(): Promise<GeopoliticalRiskData> {
  const requestedAt = new Date();
  const weekKey = `${requestedAt.getFullYear()}-W${Math.ceil(requestedAt.getDate() / 7)}`;
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
    현재 날짜: ${requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}

    아래 4가지 지정학 키워드에 대한 최신 뉴스 동향을 분석해줘:
    1. "한반도 안보 리스크" 또는 "북한 도발" 또는 "한미동맹"
    2. "NATO 방산 예산" 또는 "유럽 국방비 증액"
    3. "원자력 에너지 정책" 또는 "SMR 소형원전 수출"
    4. "한국 조선 수주 잔고" 또는 "LNG선 수주"

    각 키워드의 최신 뉴스 기사 톤을 분석해:
    - 긍정적 (방산·조선·원자력 섹터 수혜 예상)
    - 중립적
    - 부정적 (리스크 증가)

    GOS 점수 기준 (0-10):
    - 기본 5점
    - NATO/유럽 방산 예산 증가 뉴스: +2점
    - 원자력/SMR 수출 기회: +1점
    - 조선 수주 호조: +1점
    - 한반도 긴장 고조 (직접 충돌 위협): -2점
    - 지정학 불확실성 극도로 높음: -3점

    응답 형식 (JSON only):
    {
      "score": 7,
      "level": "OPPORTUNITY",
      "affectedSectors": ["방위산업", "조선", "원자력"],
      "headlines": [
        "NATO, 2025년 국방비 GDP 2% 이상 달성 회원국 18개국으로 증가",
        "한국 HD현대重, 유럽 LNG선 4척 추가 수주 — 수주잔고 역대 최대",
        "체코 원전 수주 확정 — 한국수력원자력 2조원 프로젝트 착수"
      ],
      "toneBreakdown": { "positive": 70, "neutral": 20, "negative": 10 },
      "lastUpdated": "${requestedAtISO}"
    }
  `;

  const cacheKey = `geo-risk-${weekKey}`;

  return getCachedAIResponse<GeopoliticalRiskData>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: { temperature: 0.1 },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as GeopoliticalRiskData;
    } catch (error) {
      console.error("Error getting geopolitical risk score:", error);
      return {
        score: 5,
        level: 'NEUTRAL',
        affectedSectors: ['방위산업', '조선', '원자력'],
        headlines: [],
        toneBreakdown: { positive: 33, neutral: 34, negative: 33 },
        lastUpdated: requestedAtISO,
      };
    }
  });
}

// ─── 아이디어 9: 크레딧 스프레드 조기 경보 시스템 ────────────────────────────

export async function getCreditSpreads(): Promise<CreditSpreadData> {
  const requestedAt = new Date();
  const requestedAtISO = requestedAt.toISOString();
  // 주 1회 캐시 (월요일 기준 주차 키)
  const weekKey = `${requestedAt.getFullYear()}-W${Math.ceil((requestedAt.getDate() - requestedAt.getDay() + 1) / 7).toString().padStart(2, '0')}`;

  const prompt = `
    You are a fixed income market analyst. Search for the latest credit spread data and return a JSON object.

    Search for:
    1. "한국 AA- 회사채 스프레드" or "Korea AA- corporate bond spread basis points 2025"
    2. "ICE BofA US High Yield OAS spread 2025" or "US HY spread basis points"
    3. "JPMorgan EMBI+ spread emerging market bond spread 2025"

    Interpret the trend:
    - WIDENING: spreads increased more than 10bp in past month (credit stress)
    - NARROWING: spreads decreased more than 10bp in past month (liquidity expanding)
    - STABLE: within ±10bp range

    isCrisisAlert: true if krCorporateSpread >= 150bp
    isLiquidityExpanding: true if trend === 'NARROWING' AND krCorporateSpread < 100

    Return ONLY valid JSON (no markdown):
    {
      "krCorporateSpread": <number, bp>,
      "usHySpread": <number, bp>,
      "embiSpread": <number, bp>,
      "isCrisisAlert": <boolean>,
      "isLiquidityExpanding": <boolean>,
      "trend": "WIDENING" | "NARROWING" | "STABLE",
      "lastUpdated": "${requestedAtISO}"
    }

    Example realistic values (search for actual current data):
    {
      "krCorporateSpread": 68,
      "usHySpread": 320,
      "embiSpread": 380,
      "isCrisisAlert": false,
      "isLiquidityExpanding": false,
      "trend": "STABLE",
      "lastUpdated": "${requestedAtISO}"
    }
  `;

  const cacheKey = `credit-spread-${weekKey}`;

  return getCachedAIResponse<CreditSpreadData>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: { temperature: 0.1 },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as CreditSpreadData;
    } catch (error) {
      console.error("Error getting credit spreads:", error);
      return {
        krCorporateSpread: 70,
        usHySpread: 330,
        embiSpread: 390,
        isCrisisAlert: false,
        isLiquidityExpanding: false,
        trend: 'STABLE',
        lastUpdated: requestedAtISO,
      };
    }
  });
}

// ─── 정량 스크리닝 엔진 (Quantitative Screening Engine) ──────────────────────
// 뉴스 의존 없이 순수 수치 데이터로 이상 신호 종목을 발굴합니다.
// Yahoo Finance OHLCV + KIS 수급 + DART 공시를 결합하여 AI가 모르는 종목도 포착.

/**
 * 정량 스크리닝: AI 검색 없이 수치 기반으로 이상 신호 종목을 발굴.
 * 1단계: 전종목 기본 필터 (시총, 거래대금, 관리종목 제외)
 * 2단계: 이상 신호 감지 (거래량 급증, 외국인/기관 매집, 신고가 근접, VCP 등)
 * 3단계: AI 정밀 분석 (뉴스가 아니라 "왜 수치가 변했는지" 분석)
 */
export async function runQuantitativeScreening(options?: {
  minMarketCap?: number;     // 최소 시총 (억원, 기본 1000)
  minTurnover?: number;      // 최소 거래대금 (억원, 기본 10)
  maxResults?: number;        // 최대 결과 수 (기본 30)
}): Promise<QuantScreenResult[]> {
  const todayDate = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
  const minCap = options?.minMarketCap ?? 1000;
  const minTurnover = options?.minTurnover ?? 10;
  const maxResults = options?.maxResults ?? 30;

  const prompt = `
현재 한국 날짜: ${todayDate}

당신은 정량 스크리너입니다. 뉴스·테마·인기도와 무관하게, 순수 수치 이상 신호만으로 종목을 발굴해야 합니다.
Google 검색을 통해 아래 조건을 충족하는 종목을 최대 ${maxResults}개 찾아주세요.

[1단계: 기본 필터]
- 시가총액 > ${minCap}억원
- 일평균 거래대금(20일) > ${minTurnover}억원
- 관리종목/투자경고/적자기업 제외

[2단계: 이상 신호 감지 - 다음 중 2개 이상 충족 종목]
검색 키워드를 활용하여 아래 신호를 감지하라:
1. "거래량 급증 종목 코스피 코스닥 ${todayDate}" - 20일 평균 대비 300% 이상 거래량 급증
2. "외국인 기관 동시 순매수 종목 ${todayDate}" - 외국인+기관 3일 이상 연속 순매수 전환
3. "52주 신고가 근접 종목 한국" - 52주 고가 대비 95% 이상 도달
4. "볼린저밴드 수축 종목 한국" - VCP 패턴 (변동성 수축 3단계 이상)
5. "공매도 잔고 급감 종목 한국" - 공매도 비중 20일 전 대비 30% 이상 감소
6. "자사주 매입 결정 공시 ${todayDate}" - 최근 5일 이내 자사주 취득 공시
7. "대주주 임원 주식 매수 공시 한국" - 최근 10일 이내 내부자 매수
8. "대규모 수주 공시 한국 ${todayDate}" - 매출 대비 10% 이상 수주
9. "대규모 설비투자 유형자산 취득 공시 한국" - 대규모 CAPEX 공시

[핵심 원칙]
- 뉴스가 많이 나온 인기 종목은 오히려 감점 (newsFrequencyScore 낮게)
- 뉴스가 거의 없지만 수치적 이상 신호가 있는 종목을 최우선
- 대형주보다 중소형주에서 이상 신호가 더 의미 있음
- 이미 최근 1주일 30% 이상 급등한 종목은 제외

[뉴스 빈도 역지표 채점 기준]
- 최근 30일 뉴스 0~2건: newsFrequencyScore = 10 (Silent Phase → 최고 점수)
- 최근 30일 뉴스 3~5건: 8 (Early Phase)
- 최근 30일 뉴스 6~15건: 5 (Growing Attention)
- 최근 30일 뉴스 16~30건: 3 (Crowded)
- 최근 30일 뉴스 30건 이상: 1 (Over-hyped → 감점)

응답 형식 (JSON only, 배열):
[
  {
    "code": "005930",
    "name": "종목명",
    "marketCap": 5000,
    "price": 75000,
    "signals": [
      { "type": "VOLUME_SURGE", "strength": 8, "description": "20일 평균 대비 450% 거래량 급증" },
      { "type": "INSTITUTIONAL_ACCUMULATION", "strength": 7, "description": "기관 5일 연속 소량 순매수" }
    ],
    "totalSignalScore": 75,
    "newsFrequencyScore": 9,
    "silentAccumulationScore": 7,
    "volumeProfile": {
      "current": 1500000,
      "avg20d": 300000,
      "ratio": 5.0,
      "trend": "SURGING"
    },
    "pricePosition": {
      "distanceFrom52wHigh": -3.2,
      "distanceFrom52wLow": 45.5,
      "aboveMA200": true,
      "aboveMA60": true
    },
    "institutionalFlow": {
      "foreignNet5d": 25000,
      "institutionNet5d": 15000,
      "foreignConsecutive": 3,
      "isQuietAccumulation": true
    },
    "source": "QUANT_SCREEN"
  }
]
  `.trim();

  const cacheKey = `quant-screening-${todayDate}`;

  return getCachedAIResponse<QuantScreenResult[]>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
            maxOutputTokens: 8000,
            temperature: 0.1,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      const parsed = safeJsonParse(text);
      return (Array.isArray(parsed) ? parsed : parsed?.results ?? []) as QuantScreenResult[];
    } catch (error) {
      console.error("Error in quantitative screening:", error);
      return [];
    }
  });
}

// ─── DART 공시 Pre-News 스크리너 ────────────────────────────────────────────
// 뉴스가 되기 전에 DART 공시에서 투자 단서를 선행 포착합니다.
// 공시 → 뉴스 → 주가 반영의 1~3일 시간차를 활용.

/**
 * DART 공시 자동 스캔: 최근 주요 공시 중 아직 뉴스화되지 않은 투자 신호를 포착.
 * 수주/설비투자/자사주/내부자매수/특허 등 핵심 공시를 자동 감지.
 */
export async function scanDartDisclosures(options?: {
  daysBack?: number;          // 최근 N일 공시 스캔 (기본 5)
  minSignificance?: number;   // 최소 중요도 (기본 5)
  maxResults?: number;         // 최대 결과 수 (기본 20)
}): Promise<DartScreenerResult[]> {
  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const daysBack = options?.daysBack ?? 5;
  const minSig = options?.minSignificance ?? 5;
  const maxResults = options?.maxResults ?? 20;

  const prompt = `
현재 한국 날짜: ${todayDate}

당신은 DART 공시 분석 전문가입니다. 최근 ${daysBack}일 이내 DART에 공시된 내용 중,
아직 주요 뉴스로 보도되지 않았지만 주가에 큰 영향을 줄 수 있는 공시를 스캔해주세요.

Google 검색 키워드:
1. "DART 주요사항보고서 수주 ${todayDate}" - 대규모 수주 공시
2. "DART 유형자산 취득 결정 공시 한국" - 대규모 설비투자
3. "DART 타법인 주식 출자 공시 한국" - 신사업 진출/M&A
4. "DART 자기주식 취득 결정 공시 ${todayDate}" - 자사주 매입
5. "DART 임원 주식변동 매수 공시 한국" - 내부자 매수
6. "DART 특허 기술이전 계약 공시 한국" - 특허/기술 이전
7. "DART 전환사채 조건변경 공시 한국" - CB 전환가 변경
8. "DART 최대주주 변경 공시 한국" - 경영권 변동
9. "DART 분기보고서 영업이익 전년대비 한국" - 아직 뉴스 안 된 어닝 서프라이즈
10. "DART 자기주식 소각 결정 공시 한국" - 자사주 소각 (주주환원)

[중요도 채점 기준]
- 매출 대비 20% 이상 대규모 수주: 10점
- 매출 대비 10% 이상 설비투자: 8점
- 대주주/임원 10억원 이상 장내 매수: 9점
- 자사주 매입 (발행주식 1% 이상): 8점
- 자사주 소각 결정: 9점
- 특허 취득/기술이전 계약 (100억 이상): 7점
- 최대주주 변경 (경영권 인수): 8점
- 분기 영업이익 전년대비 50% 이상 증가: 9점
- CB 전환가 하향 조정: 6점

[Pre-News 점수 기준 (0-10)]
- 공시 후 48시간 이내 & 관련 뉴스 0건: preNewsScore = 10
- 공시 후 48시간 이내 & 관련 뉴스 1~2건: 7
- 공시 후 3~5일 & 관련 뉴스 3건 미만: 5
- 공시 후 5일 초과 또는 뉴스 다수: 2

종목별로 그룹화하여, 최대 ${maxResults}개 종목에 대해 중요도 ${minSig} 이상 공시만 포함.

응답 형식 (JSON only, 배열):
[
  {
    "code": "329180",
    "name": "종목명",
    "disclosures": [
      {
        "type": "LARGE_ORDER",
        "title": "단일판매·공급계약체결(자율공시) - 1,200억원 규모",
        "date": "2026-04-05",
        "significance": 9,
        "revenueImpact": 25.3,
        "description": "연매출 대비 25% 규모의 대형 수주. 수주잔고 역대 최대 갱신.",
        "dartUrl": ""
      }
    ],
    "totalScore": 85,
    "preNewsScore": 9,
    "daysSinceDisclosure": 1,
    "isActionable": true,
    "lastUpdated": "${requestedAtISO}"
  }
]
  `.trim();

  const cacheKey = `dart-screener-${todayDate}`;

  return getCachedAIResponse<DartScreenerResult[]>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
            maxOutputTokens: 8000,
            temperature: 0.1,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      const parsed = safeJsonParse(text);
      return (Array.isArray(parsed) ? parsed : parsed?.results ?? []) as DartScreenerResult[];
    } catch (error) {
      console.error("Error in DART disclosure screening:", error);
      return [];
    }
  });
}

// ─── 조용한 매집 감지기 (Silent Accumulation Detector) ───────────────────────
// 주도주가 되기 전 단계의 특징적 패턴을 수치로 포착합니다.
// VWAP/거래량/기관수급/공매도/내부자 매수 등 복합 신호를 종합.

/**
 * 특정 종목 리스트에 대해 조용한 매집 패턴을 분석합니다.
 * 정량 스크리닝 결과 또는 관심 종목에 대해 실행.
 */
export async function detectSilentAccumulation(
  stockCodes: { code: string; name: string }[],
): Promise<SilentAccumulationResult[]> {
  if (stockCodes.length === 0) return [];

  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const stockList = stockCodes.map(s => `${s.name}(${s.code})`).join(', ');

  const prompt = `
현재 한국 날짜: ${todayDate}

다음 종목들에 대해 "조용한 매집" 패턴을 분석해주세요: ${stockList}

각 종목에 대해 Google 검색으로 아래 7가지 매집 신호를 확인하라:

[신호 1: VWAP > 종가 & 거래량 감소 (Dark Pool 패턴)]
검색: "[종목명] VWAP 거래량 추이"
- VWAP(거래량가중평균가)이 종가보다 높으면서 거래량이 감소 → 고가에서 조용히 매수 중

[신호 2: 기관 소량 분할 매수]
검색: "[종목명] 기관 순매수 추이 ${todayDate}"
- 대량 매매 없이 5일 이상 소량 순매수 지속 → 조용한 매집

[신호 3: 공매도 잔고 감소]
검색: "[종목명] 공매도 잔고 추이"
- 공매도 비중이 20일 전 대비 30% 이상 감소 → 하방 베팅 철수

[신호 4: 콜옵션 미결제약정 급증]
검색: "[종목명] 또는 관련 섹터 ETF 옵션 미결제약정"
- 콜옵션 OI 급증 → 상승 베팅 증가 (해당 정보 있는 경우만)

[신호 5: 내부자 매수]
검색: "DART [종목명] 임원 주식변동 매수"
- 대주주/임원이 장내 직접 매수 → 강력한 확신 신호

[신호 6: 자사주 매입 진행]
검색: "DART [종목명] 자기주식 취득"
- 회사가 자기 주식을 매입 중 → 주가 하한선 지지

[신호 7: 하한선 상승 (Price Floor Rising)]
검색: "[종목명] 주가 추이 저점 ${todayDate}"
- 최근 20일간 일중 저점(Low)이 점진적으로 상승 → 매수 세력 존재

[종합 점수 계산]
- 각 신호 0-10점, 총합을 100점 만점으로 정규화
- 3개 이상 신호 감지: HIGH 확신
- 2개 신호: MEDIUM
- 1개 이하: LOW

[매집 단계 판정]
- EARLY: 거래량 마르면서 저점 형성 (1-2개 신호)
- MID: 소량 매집 + 공매도 감소 (3-4개 신호)
- LATE: 내부자 매수 + VWAP 이탈 + 거래량 미세 증가 (5개+ 신호, 곧 돌파 예상)
- NONE: 신호 없음

응답 형식 (JSON only, 배열):
[
  {
    "code": "005930",
    "name": "종목명",
    "signals": [
      { "type": "INSTITUTIONAL_QUIET_BUY", "strength": 7, "description": "기관 7일 연속 소량 순매수 (일 평균 3,000주)", "daysDetected": 7 },
      { "type": "SHORT_DECREASE", "strength": 6, "description": "공매도 잔고 20일 전 대비 -42% 감소", "daysDetected": 20 }
    ],
    "compositeScore": 65,
    "confidenceLevel": "MEDIUM",
    "estimatedAccumulationDays": 15,
    "priceFloorTrend": "RISING",
    "volumeTrend": "DRYING",
    "accumulationPhase": "MID",
    "lastUpdated": "${requestedAtISO}"
  }
]
  `.trim();

  const cacheKey = `silent-accum-${stockCodes.map(s => s.code).sort().join('-')}-${todayDate}`;

  return getCachedAIResponse<SilentAccumulationResult[]>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
            maxOutputTokens: 8000,
            temperature: 0.1,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      const parsed = safeJsonParse(text);
      return (Array.isArray(parsed) ? parsed : parsed?.results ?? []) as SilentAccumulationResult[];
    } catch (error) {
      console.error("Error detecting silent accumulation:", error);
      return [];
    }
  });
}

// ─── 정량 스크리닝 통합 파이프라인 ───────────────────────────────────────────
// QUANT_SCREEN 모드: 정량 스크리닝 → DART 공시 → 조용한 매집 → AI 정밀 분석

async function runQuantScreenPipeline(filters?: StockFilters): Promise<RecommendationResponse | null> {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  try {
    // 1단계: 정량 스크리닝 + DART 공시 병렬 실행
    console.log('[QUANT_SCREEN] 1단계: 정량 스크리닝 + DART 공시 병렬 스캔...');
    const [quantResults, dartResults] = await Promise.all([
      runQuantitativeScreening({
        minMarketCap: filters?.minMarketCap ?? 1000,
        maxResults: 30,
      }),
      scanDartDisclosures({ daysBack: 5, minSignificance: 5, maxResults: 20 }),
    ]);

    // 2단계: 두 소스에서 종목 통합 및 중복 제거
    const stockMap = new Map<string, {
      code: string; name: string;
      quantScore: number; dartScore: number;
      newsFreqScore: number; signals: string[];
    }>();

    for (const q of quantResults) {
      stockMap.set(q.code, {
        code: q.code, name: q.name,
        quantScore: q.totalSignalScore,
        dartScore: 0,
        newsFreqScore: q.newsFrequencyScore,
        signals: q.signals.map(s => s.description),
      });
    }

    for (const d of dartResults) {
      const existing = stockMap.get(d.code);
      if (existing) {
        existing.dartScore = d.totalScore;
        existing.signals.push(...d.disclosures.map(disc => `[공시] ${disc.title}`));
      } else {
        stockMap.set(d.code, {
          code: d.code, name: d.name,
          quantScore: 0, dartScore: d.totalScore,
          newsFreqScore: 8, // DART에서만 발견 → 뉴스 적은 편
          signals: d.disclosures.map(disc => `[공시] ${disc.title}`),
        });
      }
    }

    // 3단계: 종합 점수 계산 및 상위 10개 선별
    const candidates = Array.from(stockMap.values())
      .map(s => ({
        ...s,
        combinedScore: s.quantScore * 0.4 + s.dartScore * 0.3 + s.newsFreqScore * 3, // 뉴스 적을수록 보너스
      }))
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, 10);

    if (candidates.length === 0) {
      return {
        marketContext: {
          kospi: { index: 0, change: 0, changePercent: 0, status: 'NEUTRAL', analysis: '정량 스크리닝 결과 없음' },
          kosdaq: { index: 0, change: 0, changePercent: 0, status: 'NEUTRAL', analysis: '' },
        },
        recommendations: [],
      };
    }

    // 4단계: 조용한 매집 감지 (상위 후보에 대해)
    console.log(`[QUANT_SCREEN] 4단계: 상위 ${candidates.length}개 종목 조용한 매집 분석...`);
    const accumResults = await detectSilentAccumulation(
      candidates.map(c => ({ code: c.code, name: c.name }))
    );
    const accumMap = new Map(accumResults.map(a => [a.code, a]));

    // 5단계: AI 정밀 분석 — 수치가 변한 이유 분석
    console.log('[QUANT_SCREEN] 5단계: AI 정밀 분석...');
    const candidateList = candidates.map(c => {
      const accum = accumMap.get(c.code);
      return `${c.name}(${c.code}): 정량점수=${c.quantScore}, 공시점수=${c.dartScore}, 뉴스빈도역점수=${c.newsFreqScore}, 매집단계=${accum?.accumulationPhase ?? 'N/A'}, 신호=[${c.signals.slice(0, 3).join('; ')}]`;
    }).join('\n');

    const analysisPrompt = `
현재 한국 시각: ${now}

당신은 정량 스크리닝 결과를 바탕으로 최종 분석을 수행합니다.
아래 종목들은 뉴스가 아닌 순수 수치 이상 신호와 DART 공시로 발굴된 종목입니다.

[후보 종목]
${candidateList}

각 종목에 대해:
1. Google 검색으로 현재가, 시가총액, 기본 재무 데이터를 확인
2. 수치 변동의 근본 원인을 분석 (뉴스가 아닌 비즈니스 변화 원인)
3. 27개 체크리스트 항목을 최대한 평가
4. 기존 getStockRecommendations와 동일한 JSON 형식으로 응답

[핵심 차별점]
- 이 종목들은 뉴스 인기도가 아닌 수치 이상 신호로 발굴됨
- "왜 거래량이 변했는가", "왜 기관이 매집하는가", "공시의 실질적 임팩트는 무엇인가"를 분석
- 뉴스가 아직 없는 종목일수록 더 높은 잠재력을 가진 것으로 평가

응답은 기존 recommendations JSON 형식과 동일하게 작성하되,
각 종목의 dataSourceType을 "QUANT_SCREEN"으로 설정하라.
최대 5개까지만 최종 추천하라.

응답 형식: 기존 getStockRecommendations와 동일한 JSON
    `.trim();

    const response = await withRetry(async () => {
      return await getAI().models.generateContent({
        model: "gemini-3-flash-preview",
        contents: analysisPrompt,
        config: {
          tools: [{ googleSearch: {} }],
          maxOutputTokens: 12000,
          temperature: 0.1,
        },
      });
    }, 2, 2000);

    const text = response.text;
    if (!text) throw new Error("No response from AI for quant screen analysis");
    const parsed = safeJsonParse(text);

    if (parsed && !parsed.recommendations) {
      parsed.recommendations = [];
    }

    // Enrich with real data
    if (parsed && parsed.recommendations.length > 0) {
      console.log(`[QUANT_SCREEN] Enriching ${parsed.recommendations.length} recommendations...`);
      const enriched = [];
      for (const stock of parsed.recommendations) {
        try {
          // 매집 데이터 주입
          const accum = accumMap.get(stock.code);
          if (accum) {
            stock.anomalyDetection = {
              type: accum.compositeScore > 50 ? 'SMART_MONEY_ACCUMULATION' : 'NONE',
              score: accum.compositeScore,
              description: `매집단계: ${accum.accumulationPhase}, 확신도: ${accum.confidenceLevel}, 추정 매집기간: ${accum.estimatedAccumulationDays}일`,
            };
          }
          stock.dataSourceType = 'QUANT_SCREEN' as any;
          const enrichedStock = await enrichStockWithRealData(stock);
          enriched.push(enrichedStock);
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (err) {
          console.error(`[QUANT_SCREEN] Failed to enrich ${stock.name}:`, err);
          enriched.push(stock);
        }
      }
      parsed.recommendations = enriched;
    }

    return parsed;
  } catch (error) {
    console.error("[QUANT_SCREEN] Pipeline error:", error);
    throw error;
  }
}

// ─── 확장 레짐 분류기 (Extended Regime Classifier) ───────────────────────────
// 기존 4단계에 UNCERTAIN/CRISIS/RANGE_BOUND를 추가하여 7단계로 확장.
// 글로벌 소스 확장 및 상관관계 분석 포함.

/**
 * 확장 경기 레짐 분류: 기존 getEconomicRegime + 불확실성 메트릭 추가.
 * 글로벌 소스를 폭넓게 참조하여 한국 시장 특수 상황을 감지합니다.
 */
export async function getExtendedEconomicRegime(): Promise<ExtendedRegimeData> {
  const requestedAt = new Date();
  const now = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayDate = now.split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
현재 한국 날짜: ${todayDate}

아래 7가지 경기 사이클 중 현재 한국 경제가 어디에 해당하는지 분류해줘.
구글 검색을 통해 최신 실제 데이터를 기반으로 판단해야 해.

분류 기준 (확장 7단계):
- RECOVERY (회복기): GDP 성장 반등, 수출 증가 시작, 금리 인하 또는 동결, OECD CLI ≥ 100 상승 전환
- EXPANSION (확장기): GDP 성장 가속, 수출 호조, 금리 동결 또는 소폭 인상, CLI 상승 지속
- SLOWDOWN (둔화기): GDP 성장 둔화, 수출 증가율 감소, 금리 인상 또는 동결, CLI 하락
- RECESSION (침체기): GDP 역성장 또는 제로, 수출 급감, CLI 급락, 신용 위기 징후
- UNCERTAIN (불확실): 지표 혼조, 매크로 신호 상충, 방향성 불명확, 주도 섹터 부재
- CRISIS (위기): VKOSPI > 35, VIX > 30, 외부 충격(전쟁/금융위기), 신용스프레드 급등
- RANGE_BOUND (박스권): KOSPI 60일 변동성 < 5%, 뚜렷한 주도 섹터 없음, 외국인 매수/매도 교차

조회할 데이터 (기존 + 확장):
[기존]
1. 한국 최근 수출 증가율 (전년 동월 대비, 3개월 이동평균)
2. 한국은행 기준금리 현재 수준 및 방향
3. OECD 경기선행지수(CLI) 한국 최신
4. 한국 최근 분기 GDP 성장률

[확장 - 글로벌 소스]
5. VKOSPI 현재값 및 20일 이동평균
6. VIX 현재값
7. KOSPI 60일 변동성 (표준편차 기반)
8. 최근 5일 주도 섹터 수 (KOSPI 업종별 상승률 상위 3개 섹터가 명확한지)
9. 외국인 최근 5일 순매수 패턴 (일관된 매수/매도 vs 교차)
10. KOSPI-S&P500 30일 상관계수 (정상: 0.6-0.8, 디커플링: <0.3, 동조화: >0.9)
11. CME FedWatch 금리 전망 (다음 FOMC 금리 동결/인하 확률)
12. 중국 PMI 최신값 (한국 수출 선행지표)
13. 대만 TSMC 월간 매출 추이 (반도체 사이클 선행)
14. 일본 BOJ 정책 최신 동향 (엔캐리 리스크)
15. 미국 ISM 제조업 PMI 최신값
16. 원/달러 환율 현재값

응답 형식 (JSON only):
{
  "regime": "EXPANSION",
  "confidence": 78,
  "rationale": "수출 YoY +12.3%, CLI 101.2 상승 기조...",
  "allowedSectors": ["반도체", "조선", "방산", "바이오", "AI인프라", "자동차"],
  "avoidSectors": ["내수소비재", "항공", "음식료"],
  "keyIndicators": {
    "exportGrowth": "+12.3% YoY",
    "bokRateDirection": "동결 (3.50%)",
    "oeciCli": "101.2",
    "gdpGrowth": "+2.1% QoQ"
  },
  "lastUpdated": "${requestedAtISO}",
  "uncertaintyMetrics": {
    "regimeClarity": 75,
    "signalConflict": 25,
    "kospi60dVolatility": 12.5,
    "leadingSectorCount": 3,
    "foreignFlowDirection": "CONSISTENT_BUY",
    "correlationBreakdown": false
  },
  "systemAction": {
    "mode": "NORMAL",
    "cashRatio": 20,
    "gateAdjustment": { "gate1Threshold": 5, "gate2Required": 9, "gate3Required": 7 },
    "message": "정상 시장. 기본 Gate 기준 적용."
  }
}
  `.trim();

  const cacheKey = `extended-regime-${todayDate}`;

  return getCachedAIResponse<ExtendedRegimeData>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
            temperature: 0.1,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as ExtendedRegimeData;
    } catch (error) {
      console.error("Error getting extended economic regime:", error);
      return {
        regime: 'EXPANSION',
        confidence: 50,
        rationale: "데이터 조회 실패. 기본값(확장기)으로 설정됨.",
        allowedSectors: ["반도체", "조선", "방산"],
        avoidSectors: [],
        keyIndicators: {
          exportGrowth: "N/A",
          bokRateDirection: "N/A",
          oeciCli: "N/A",
          gdpGrowth: "N/A",
        },
        lastUpdated: requestedAtISO,
        uncertaintyMetrics: {
          regimeClarity: 50,
          signalConflict: 50,
          kospi60dVolatility: 0,
          leadingSectorCount: 0,
          foreignFlowDirection: 'ALTERNATING',
          correlationBreakdown: false,
        },
        systemAction: {
          mode: 'DEFENSIVE',
          cashRatio: 50,
          gateAdjustment: { gate1Threshold: 6, gate2Required: 10, gate3Required: 8 },
          message: '데이터 수집 실패. 방어적 모드로 전환.',
        },
      };
    }
  });
}

// ─── 거시 환경 자동 수집 (Gate 0 입력) ────────────────────────────────────────
export async function fetchMacroEnvironment(): Promise<MacroEnvironment> {
  const requestedAt = new Date();
  const now = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayDate = now.split(' ')[0];
  const cacheKey = `macro-environment-${todayDate}`;

  return getCachedAIResponse<MacroEnvironment>(cacheKey, async () => {
    const prompt = `
현재 한국 날짜: ${todayDate}

아래 12개 거시 지표의 최신 실제 값을 당신의 학습 데이터 기반으로 추정하여 JSON 하나만 반환해줘.
(마크다운, 설명 없이 JSON만)

수집 대상:
1. 한국은행 기준금리 방향 (최근 결정): "HIKING" | "HOLDING" | "CUTTING"
2. 미국 10년 국채 금리 (%, 최신)
3. 한미 금리 스프레드 (한국 기준금리 - 미국 기준금리, 음수 허용)
4. 한국 M2 통화량 증가율 YoY (%, 최신)
5. 한국 은행 여신(대출) 증가율 YoY (%, 최신)
6. 한국 명목 GDP 성장률 YoY (%, 최신 분기)
7. OECD 경기선행지수 한국 (최신, 100 기준)
8. 한국 수출 증가율 3개월 이동평균 YoY (%, 최신)
9. VKOSPI 현재값
10. 삼성전자 IRI 또는 프로그램 매매 비율 대용값 (0.5~1.5 범위; 중립=1.0)
11. VIX 현재값
12. 원달러 환율 현재값

응답 형식 (JSON only, 추정값 사용 가능):
{
  "bokRateDirection": "HOLDING",
  "us10yYield": 4.35,
  "krUsSpread": -1.25,
  "m2GrowthYoY": 6.2,
  "bankLendingGrowth": 5.1,
  "nominalGdpGrowth": 3.8,
  "oeciCliKorea": 100.4,
  "exportGrowth3mAvg": 11.5,
  "vkospi": 18.2,
  "samsungIri": 0.92,
  "vix": 16.8,
  "usdKrw": 1385.0
}
    `.trim();

    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: prompt,
          config: {
            temperature: 0.1,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error('No response from AI');
      return safeJsonParse(text) as MacroEnvironment;
    } catch (_) {
      // 수집 실패 시 보수적 중립 기본값 반환
      return {
        bokRateDirection: 'HOLDING',
        us10yYield: 4.3,
        krUsSpread: -1.25,
        m2GrowthYoY: 6.0,
        bankLendingGrowth: 5.0,
        nominalGdpGrowth: 3.5,
        oeciCliKorea: 100.0,
        exportGrowth3mAvg: 8.0,
        vkospi: 18.0,
        samsungIri: 1.0,
        vix: 18.0,
        usdKrw: 1380.0,
      };
    }
  });
}

// ─── H: 섹터-테마 역추적 엔진 (Theme → Korea Value Chain Reverse Tracking) ──

/**
 * 글로벌 메가트렌드에서 아직 시장이 연결짓지 못한 한국 숨은 수혜주를 역추적.
 * "종목 → 뉴스 검색" 방식을 뒤집어 "테마 → 관련 종목 역추적".
 * DART 사업보고서의 주요 제품/매출 구성을 분석하여 밸류체인을 매핑합니다.
 */
export async function trackThemeToKoreaValueChain(options?: {
  customThemes?: string[];     // 사용자 지정 테마 (없으면 AI가 자동 감지)
  maxThemes?: number;          // 최대 테마 수 (기본 5)
}): Promise<ThemeReverseTrackResult[]> {
  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();
  const maxThemes = options?.maxThemes ?? 5;

  const themeSection = options?.customThemes?.length
    ? `[사용자 지정 테마]\n${options.customThemes.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
    : `[1단계: 글로벌 메가트렌드 자동 감지]
아래 키워드로 Google 검색하여 최근 2주 이내 급부상하는 글로벌 테마 ${maxThemes}개를 감지하라:
- "global megatrend 2026 emerging technology"
- "US Congress bill passed technology energy defense"
- "EU regulation new policy 2026"
- "China industrial policy subsidy 2026"
- "breakthrough technology commercialization 2026"
- "GLP-1 obesity drug market expansion"
- "SMR small modular reactor contract"
- "low earth orbit satellite constellation"
- "AI infrastructure data center power"
- "solid state battery commercialization"
- "humanoid robot mass production"
- "space economy commercial launch"`;

  const prompt = `
현재 한국 날짜: ${todayDate}

당신은 글로벌 테마 → 한국 밸류체인 역추적 전문가입니다.
핵심 목적: 글로벌 트렌드의 한국 수혜주 중 아직 시장이 연결짓지 못한 '숨은 수혜주'를 발굴.

${themeSection}

[2단계: 한국 밸류체인 역추적]
감지된 각 테마에 대해:
1. Google 검색으로 해당 테마의 글로벌 밸류체인 구조를 파악
2. "DART 사업보고서 [키워드]" 또는 "[키워드] 한국 관련 기업 부품 소재"로 검색
3. 한국 상장기업 중 해당 밸류체인에 속하는 기업을 최대 5개 발굴
4. 각 기업의 시장 인지도를 판별:
   - HIDDEN: 아직 시장이 이 테마와 연결짓지 못함 (뉴스 거의 없음) → 최우선 추천
   - EMERGING: 일부 리포트에서 언급되기 시작 → 초기 진입 가능
   - KNOWN: 이미 시장에서 테마주로 인식 → 이미 반영됨, 후순위

[3단계: 투자 타이밍 판정]
- TOO_EARLY: 글로벌 테마 자체가 아직 불확실 (정책 미확정, 기술 미검증)
- OPTIMAL: 글로벌 정책/기술 확정 + 한국 수혜주 아직 미반영 → 최적 진입
- LATE: 한국에서도 이미 테마주로 인식, 주가 선반영 진행 중
- MISSED: 주가 이미 대폭 상승, 진입 시점 지남

응답 형식 (JSON only, 배열):
[
  {
    "theme": "소형모듈원자로(SMR)",
    "globalTrend": {
      "keyword": "Small Modular Reactor commercialization",
      "source": "미국 에너지부 SMR 상용화 지원법 통과",
      "momentum": "ACCELERATING",
      "globalMarketSize": "$120B by 2035"
    },
    "koreaValueChain": [
      { "company": "두산에너빌리티", "code": "034020", "role": "원전 주기기 제조", "revenueExposure": 35, "marketAttention": "KNOWN", "competitiveEdge": "한국 유일 원전 주기기 EPC" },
      { "company": "비에이치아이", "code": "083650", "role": "열교환기·압력용기 부품", "revenueExposure": 20, "marketAttention": "HIDDEN", "competitiveEdge": "SMR 핵심 부품 납품 이력" },
      { "company": "우진", "code": "105840", "role": "원전 계측기기", "revenueExposure": 40, "marketAttention": "HIDDEN", "competitiveEdge": "국내 유일 원전 계측 전문" }
    ],
    "hiddenGems": [
      { "company": "비에이치아이", "code": "083650", "role": "열교환기·압력용기 부품", "revenueExposure": 20, "marketAttention": "HIDDEN", "competitiveEdge": "SMR 핵심 부품 납품 이력" }
    ],
    "totalCompanies": 3,
    "avgMarketAttention": 33,
    "investmentTiming": "OPTIMAL",
    "lastUpdated": "${requestedAtISO}"
  }
]
  `.trim();

  const cacheKey = `theme-reverse-track-${todayDate}`;

  return getCachedAIResponse<ThemeReverseTrackResult[]>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
            maxOutputTokens: 10000,
            temperature: 0.2,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      const parsed = safeJsonParse(text);
      return (Array.isArray(parsed) ? parsed : parsed?.results ?? []) as ThemeReverseTrackResult[];
    } catch (error) {
      console.error("Error in theme reverse tracking:", error);
      return [];
    }
  });
}

// ─── C: 글로벌 상관관계 매트릭스 (Global Correlation Matrix) ─────────────────

/**
 * KOSPI와 주요 글로벌 지수·자산 간 30일 상관계수를 산출.
 * 디커플링(<0.3) 또는 동조화(>0.9) 감지 시 레짐 판단에 반영됩니다.
 */
export async function getGlobalCorrelationMatrix(): Promise<GlobalCorrelationMatrix> {
  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
현재 날짜: ${todayDate}

다음 지수 쌍의 최근 30거래일 상관계수(correlation coefficient)를 Google 검색으로 추정해줘.
각 지수의 최근 30일 일일 수익률 패턴을 비교하여 상관계수를 산출하라.

계산 대상:
1. KOSPI - S&P500: 정상 범위 0.6~0.8, 디커플링 <0.3, 동조화 >0.9
2. KOSPI - 닛케이225: 정상 범위 0.5~0.7
3. KOSPI - 상해종합: 정상 범위 0.3~0.6
4. KOSPI - 달러인덱스(DXY): 보통 음의 상관 -0.3~-0.6

검색 키워드:
- "KOSPI S&P 500 correlation ${todayDate}"
- "KOSPI 코스피 S&P500 상관계수"
- "코스피 나스닥 동조화 디커플링 ${todayDate}"
- "달러인덱스 DXY 코스피 역상관"
- "코스피 닛케이 상해종합 상관관계"

판별 기준:
- isDecoupling: KOSPI-S&P500 상관계수 < 0.3 (한국 특수 요인 발생)
- isGlobalSync: KOSPI-S&P500 상관계수 > 0.9 (외부 충격 전이 모드)

응답 형식 (JSON only):
{
  "kospiSp500": 0.72,
  "kospiNikkei": 0.58,
  "kospiShanghai": 0.41,
  "kospiDxy": -0.45,
  "isDecoupling": false,
  "isGlobalSync": false,
  "lastUpdated": "${requestedAtISO}"
}
  `.trim();

  const weekKey = `${requestedAt.getFullYear()}-W${Math.ceil(requestedAt.getDate() / 7)}`;
  const cacheKey = `global-correlation-${weekKey}`;

  return getCachedAIResponse<GlobalCorrelationMatrix>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
            temperature: 0.1,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as GlobalCorrelationMatrix;
    } catch (error) {
      console.error("Error getting global correlation matrix:", error);
      return {
        kospiSp500: 0.7,
        kospiNikkei: 0.55,
        kospiShanghai: 0.4,
        kospiDxy: -0.45,
        isDecoupling: false,
        isGlobalSync: false,
        lastUpdated: requestedAtISO,
      };
    }
  });
}

// ─── D: 해외 뉴스 멀티소스 집계 (Global Multi-Source Intelligence) ───────────

/**
 * Fed Watch, 중국 PMI, TSMC 매출, BOJ 정책, 미국 ISM, FRED 데이터를
 * 단일 함수로 집계하여 한국 시장 선행지표로 활용합니다.
 */
export async function getGlobalMultiSourceData(): Promise<GlobalMultiSourceData> {
  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
현재 날짜: ${todayDate}

아래 6개 글로벌 데이터 소스의 최신값을 추정하여 JSON으로 반환해줘.
이 데이터는 한국 증시의 선행지표로 활용됩니다.

[1. CME FedWatch - 미국 금리 전망]
검색: "CME FedWatch tool next FOMC meeting probability ${todayDate}"
- 다음 FOMC 회의 일자
- 금리 동결/인하/인상 확률 (%)

[2. 중국 PMI]
검색: "China PMI manufacturing services latest ${todayDate}"
- 제조업 PMI (50 기준: 위=확장, 아래=수축)
- 서비스업 PMI
- 한국 수출의 25%가 중국 → 중국 PMI는 한국 수출 선행지표

[3. 대만 TSMC 월간 매출]
검색: "TSMC monthly revenue latest ${todayDate}"
- 최근 월 매출 (억 대만달러)
- 전년동월비 성장률 (%)
- 한국 반도체 섹터 가장 강력한 선행지표

[4. 일본 BOJ 정책]
검색: "Bank of Japan BOJ interest rate policy latest ${todayDate}"
- 현재 기준금리
- 금리 방향 (인상/동결/인하)
- 엔캐리 트레이드 청산 리스크 판단

[5. 미국 ISM 제조업/서비스업]
검색: "ISM manufacturing PMI services PMI latest ${todayDate}"
- ISM 제조업 PMI (50 기준)
- ISM 서비스업 PMI
- 신규 주문 지수

[6. FRED 핵심 데이터]
검색: "US CPI unemployment rate retail sales latest"
- 미국 CPI (% YoY)
- 미국 실업률 (%)
- 미국 소매판매 (% MoM)

응답 형식 (JSON only):
{
  "fedWatch": {
    "nextMeetingDate": "2026-05-07",
    "holdProbability": 65,
    "cutProbability": 30,
    "hikeProbability": 5
  },
  "chinaPmi": {
    "manufacturing": 50.8,
    "services": 52.3,
    "trend": "EXPANDING"
  },
  "tsmcRevenue": {
    "monthlyRevenueTWD": 2360,
    "yoyGrowth": 35.2,
    "trend": "ACCELERATING",
    "implication": "AI 수요 급증으로 반도체 슈퍼사이클 진행 중. 한국 반도체 섹터 수혜 지속."
  },
  "bojPolicy": {
    "currentRate": 0.5,
    "direction": "HIKING",
    "yenCarryRisk": "MEDIUM",
    "implication": "BOJ 추가 인상 시 엔캐리 청산으로 한국 외국인 자금 유출 위험."
  },
  "usIsm": {
    "manufacturing": 49.2,
    "services": 53.8,
    "newOrders": 51.5,
    "trend": "FLAT"
  },
  "fredData": {
    "usCpi": 2.8,
    "usUnemployment": 3.9,
    "usRetailSales": 0.4
  },
  "lastUpdated": "${requestedAtISO}"
}
  `.trim();

  const cacheKey = `global-multi-source-${todayDate}`;

  return getCachedAIResponse<GlobalMultiSourceData>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
            temperature: 0.1,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as GlobalMultiSourceData;
    } catch (error) {
      console.error("Error getting global multi-source data:", error);
      return {
        fedWatch: { nextMeetingDate: 'N/A', holdProbability: 50, cutProbability: 25, hikeProbability: 25 },
        chinaPmi: { manufacturing: 50, services: 50, trend: 'FLAT' },
        tsmcRevenue: { monthlyRevenueTWD: 0, yoyGrowth: 0, trend: 'STABLE', implication: '데이터 수집 실패' },
        bojPolicy: { currentRate: 0, direction: 'HOLDING', yenCarryRisk: 'LOW', implication: '데이터 수집 실패' },
        usIsm: { manufacturing: 50, services: 50, newOrders: 50, trend: 'FLAT' },
        fredData: { usCpi: 0, usUnemployment: 0, usRetailSales: 0 },
        lastUpdated: requestedAtISO,
      };
    }
  });
}

// ─── I: 뉴스 빈도 역지표 (Contrarian News Frequency Score) ───────────────────

/**
 * 특정 종목 리스트에 대해 뉴스 빈도를 조회하고 역지표 점수를 산출.
 * 뉴스가 적을수록 높은 점수 → AI 주목도 편향을 역이용.
 */
export async function getNewsFrequencyScores(
  stocks: { code: string; name: string }[]
): Promise<NewsFrequencyScore[]> {
  if (stocks.length === 0) return [];

  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];

  const stockList = stocks.map(s => `${s.name}(${s.code})`).join(', ');

  const prompt = `
현재 한국 날짜: ${todayDate}

다음 종목들의 최근 30일간 뉴스 빈도를 추정해주세요: ${stockList}

각 종목에 대해:
1. "[종목명] 뉴스 최근" 검색
2. 검색 결과 수와 최근 30일 기사 건수를 추정
3. 아래 기준으로 역지표 점수를 산출

[뉴스 빈도 역지표 채점]
- 0~2건 → score: 10, phase: "SILENT" (Silent Phase — 최고 점수. 시장 미인지.)
- 3~5건 → score: 8, phase: "EARLY" (Early Phase — 초기 관심. 최적 진입 구간.)
- 6~15건 → score: 5, phase: "GROWING" (Growing Attention — 관심 증가 중.)
- 16~30건 → score: 3, phase: "CROWDED" (Crowded — 이미 시장 관심.)
- 30건+ → score: 1, phase: "OVERHYPED" (Over-hyped — 뉴스 과잉. 주가 선반영 가능성.)

[투자 시사점 작성 규칙]
- SILENT: "시장 미인지 종목. 수치적 이상 신호 발생 시 최우선 분석 대상."
- EARLY: "초기 관심 단계. 뉴스가 본격화되기 전 선제 진입 가능 구간."
- GROWING: "관심 증가 중. 이미 일부 주가 반영 시작. 신중한 진입 필요."
- CROWDED: "시장 관심 과다. 추가 상승 여력 제한적. 차익실현 고려."
- OVERHYPED: "뉴스 과잉. 주가 선반영 완료 가능성. 신규 진입 비추천."

응답 형식 (JSON only, 배열):
[
  { "code": "083650", "name": "비에이치아이", "newsCount30d": 1, "score": 10, "phase": "SILENT", "implication": "시장 미인지 종목. 수치적 이상 신호 발생 시 최우선 분석 대상." }
]
  `.trim();

  const cacheKey = `news-freq-${stocks.map(s => s.code).sort().join('-')}-${todayDate}`;

  return getCachedAIResponse<NewsFrequencyScore[]>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
            temperature: 0.1,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      const parsed = safeJsonParse(text);
      return (Array.isArray(parsed) ? parsed : parsed?.results ?? []) as NewsFrequencyScore[];
    } catch (error) {
      console.error("Error getting news frequency scores:", error);
      return stocks.map(s => ({
        code: s.code,
        name: s.name,
        newsCount30d: -1,
        score: 5,
        phase: 'GROWING' as const,
        implication: '뉴스 빈도 조회 실패. 기본값 적용.',
      }));
    }
  });
}

// ─── 레이어 I: 공급망 물동량 인텔리전스 (Supply Chain Intelligence) ──────────────

export async function getSupplyChainIntelligence(): Promise<SupplyChainIntelligence> {
  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
현재 날짜: ${todayDate}

아래 3개 공급망 선행지표의 최신값을 추정하여 JSON으로 반환해줘.
한국 조선·반도체·해운 섹터의 선행지표로 활용됩니다.

[1. Baltic Dry Index (BDI) — 벌크 해운 운임 지수]
검색: "Baltic Dry Index today ${todayDate}"
- 현재 BDI 지수
- 3개월 전 대비 변화율 (%)
- 추세 판단: SURGING(+20%이상)/RISING(+5~20%)/FLAT(-5~+5%)/FALLING(-5~-20%)/COLLAPSING(-20%이하)
- 한국 조선/해운 섹터 시사점 (한국어 1줄)

[2. SEMI North America Billings — 반도체 장비 수주]
검색: "SEMI North America semiconductor equipment billings latest ${todayDate}"
검색: "SEMI book-to-bill ratio latest"
- 최근 월 반도체 장비 매출 (십억 달러)
- 전년동월비 성장률 (%)
- Book-to-Bill 비율 (수주/매출, 1.0 이상 = 수요 초과)
- 한국 반도체 시사점 (한국어 1줄)

[3. Global Container Freight Index — 컨테이너 운임]
검색: "Shanghai containerized freight index SCFI latest ${todayDate}"
검색: "Drewry World Container Index"
- 상하이-유럽 운임 ($/40ft)
- 태평양 횡단 운임 ($/40ft)
- 추세: RISING/FLAT/FALLING

응답 형식 (JSON only):
{
  "bdi": { "current": 1850, "mom3Change": 15.2, "trend": "RISING", "sectorImplication": "BDI 3개월 15% 상승 → 벌크선 발주 증가 기대" },
  "semiBillings": { "latestBillionUSD": 3.2, "yoyGrowth": 12.5, "bookToBill": 1.15, "implication": "Book-to-Bill 1.15 → 반도체 업사이클 지속" },
  "gcfi": { "shanghaiEurope": 2800, "transPacific": 3200, "trend": "RISING" },
  "lastUpdated": "${requestedAtISO}"
}
  `.trim();

  const weekKey = `${requestedAt.getFullYear()}-W${Math.ceil(requestedAt.getDate() / 7)}`;
  const cacheKey = `supply-chain-intel-${weekKey}`;

  return getCachedAIResponse<SupplyChainIntelligence>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: { temperature: 0.1 },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as SupplyChainIntelligence;
    } catch (error) {
      console.error("Error getting supply chain intelligence:", error);
      return {
        bdi: { current: 0, mom3Change: 0, trend: 'FLAT', sectorImplication: 'BDI 데이터 조회 실패' },
        semiBillings: { latestBillionUSD: 0, yoyGrowth: 0, bookToBill: 1.0, implication: 'SEMI 데이터 조회 실패' },
        gcfi: { shanghaiEurope: 0, transPacific: 0, trend: 'FLAT' },
        lastUpdated: requestedAtISO,
      };
    }
  });
}

// ─── 레이어 J: 섹터별 글로벌 수주 인텔리전스 (Sector Order Intelligence) ────────

export async function getSectorOrderIntelligence(): Promise<SectorOrderIntelligence> {
  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
현재 날짜: ${todayDate}

한국 증시 주도주 3대 섹터(조선·방산·원자력)의 글로벌 수주 데이터를 추정하여 JSON으로 반환해줘.

[1. 글로벌 방산 예산 트렌드]
검색: "NATO defense spending GDP percentage ${todayDate}"
검색: "US defense budget FY2025 FY2026"
검색: "Korea K2 tank K9 howitzer export contract ${todayDate}"
- NATO 평균 GDP 대비 국방비 (%)
- 미국 국방예산 (억달러)
- 추세: EXPANDING/STABLE/CUTTING
- 한국 방산 수출 파이프라인 현황 (한국어 1줄)

[2. LNG선 발주 동향]
검색: "LNG carrier newbuilding orders ${todayDate}"
검색: "QatarEnergy LNG ship orders"
검색: "global LNG orderbook months"
- 당해년도 LNG선 신규 발주 척수
- 카타르 에너지 발주 상황 (한국어 1줄)
- 수주잔고 개월수
- 한국 조선 섹터 시사점 (한국어 1줄)

[3. SMR(소형모듈원자로) 글로벌 계약]
검색: "SMR small modular reactor NRC approval ${todayDate}"
검색: "SMR global contract GW capacity"
검색: "Korea Hyundai Engineering SMR"
- 미국 NRC 승인 기수
- 계약 총 용량 (GW)
- 한국 현대엔지니어링 등 참여 현황 (한국어 1줄)
- 투자 타이밍: TOO_EARLY/OPTIMAL/LATE

응답 형식 (JSON only):
{
  "globalDefense": { "natoGdpAvg": 2.1, "usDefenseBudget": 8860, "trend": "EXPANDING", "koreaExposure": "K2전차 폴란드 1000대 + K9자주포 다국적 수출 파이프라인 확대" },
  "lngOrders": { "newOrdersYTD": 45, "qatarEnergy": "카타르 NFE 확장 프로젝트 LNG선 발주 지속", "orderBookMonths": 48, "implication": "수주잔고 4년치 → 한국 조선 3사 매출 가시성 최고" },
  "smrContracts": { "usNrcApprovals": 1, "totalGwCapacity": 12.5, "koreaHyundai": "현대엔지니어링 i-SMR 설계 인가 추진 중", "timing": "TOO_EARLY" },
  "lastUpdated": "${requestedAtISO}"
}
  `.trim();

  const weekKey = `${requestedAt.getFullYear()}-W${Math.ceil(requestedAt.getDate() / 7)}`;
  const cacheKey = `sector-order-intel-${weekKey}`;

  return getCachedAIResponse<SectorOrderIntelligence>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: { temperature: 0.1 },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as SectorOrderIntelligence;
    } catch (error) {
      console.error("Error getting sector order intelligence:", error);
      return {
        globalDefense: { natoGdpAvg: 0, usDefenseBudget: 0, trend: 'STABLE', koreaExposure: '데이터 조회 실패' },
        lngOrders: { newOrdersYTD: 0, qatarEnergy: '데이터 조회 실패', orderBookMonths: 0, implication: '데이터 조회 실패' },
        smrContracts: { usNrcApprovals: 0, totalGwCapacity: 0, koreaHyundai: '데이터 조회 실패', timing: 'TOO_EARLY' },
        lastUpdated: requestedAtISO,
      };
    }
  });
}

// ─── 레이어 K: 금융시스템 스트레스 인덱스 (Financial Stress Index) ───────────────

export async function getFinancialStressIndex(): Promise<FinancialStressIndex> {
  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
현재 날짜: ${todayDate}

금융시스템 스트레스 조기경보 지표 3개를 추정하여 JSON으로 반환해줘.
이 지표는 한국 증시 Gate 0 (매수 중단) 판단의 핵심 입력입니다.

[1. TED Spread — 은행간 신용리스크]
검색: "TED spread today ${todayDate}"
검색: "3-month LIBOR minus T-Bill spread"
- 현재 bp (정상: 10~50bp, 위험: 100bp+)
- 알림 수준: NORMAL(~50bp)/ELEVATED(50~100bp)/CRISIS(100bp+)

[2. US High Yield Spread — 기업 크레딧]
검색: "US high yield bond spread OAS today ${todayDate}"
검색: "ICE BofA US High Yield Index OAS"
- 현재 bp (정상: 300~400bp, 위험: 600bp+)
- 추세: TIGHTENING/STABLE/WIDENING

[3. MOVE Index — 채권시장 변동성 (채권판 VIX)]
검색: "MOVE index today ${todayDate}"
검색: "ICE BofA MOVE index"
- 현재값 (정상: 80~100, 위험: 150+)
- 알림 수준: NORMAL(~100)/ELEVATED(100~150)/EXTREME(150+)

종합 FSI 계산법:
- compositeScore = (tedSpread가 CRISIS?40:tedSpread가 ELEVATED?20:0) + (usHySpread>600?40:usHySpread>500?20:0) + (moveIndex>150?20:moveIndex>120?10:0)
- systemAction: compositeScore>=60→CRISIS, >=40→DEFENSIVE, >=20→CAUTION, else NORMAL

응답 형식 (JSON only):
{
  "tedSpread": { "bps": 25, "alert": "NORMAL" },
  "usHySpread": { "bps": 350, "trend": "STABLE" },
  "moveIndex": { "current": 95, "alert": "NORMAL" },
  "compositeScore": 0,
  "systemAction": "NORMAL",
  "lastUpdated": "${requestedAtISO}"
}
  `.trim();

  const weekKey = `${requestedAt.getFullYear()}-W${Math.ceil(requestedAt.getDate() / 7)}`;
  const cacheKey = `financial-stress-index-${weekKey}`;

  return getCachedAIResponse<FinancialStressIndex>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: { temperature: 0.1 },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as FinancialStressIndex;
    } catch (error) {
      console.error("Error getting financial stress index:", error);
      return {
        tedSpread: { bps: 0, alert: 'NORMAL' },
        usHySpread: { bps: 0, trend: 'STABLE' },
        moveIndex: { current: 0, alert: 'NORMAL' },
        compositeScore: 0,
        systemAction: 'NORMAL',
        lastUpdated: requestedAtISO,
      };
    }
  });
}

// ─── 레이어 L: FOMC 문서 감성 분석 (FOMC Sentiment Analysis) ────────────────────

export async function getFomcSentimentAnalysis(): Promise<FomcSentimentAnalysis> {
  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
현재 날짜: ${todayDate}

최근 FOMC 의사록/성명서/기자회견 텍스트를 분석하여 매파/비둘기파 스코어를 산출해줘.
이 분석은 한국 증시에 대한 미국 통화정책 영향을 정량화합니다.

[1. 매파/비둘기파 스코어]
검색: "FOMC statement minutes latest ${todayDate}"
검색: "Fed hawkish dovish analysis latest"
- 점수: -10(극비둘기) ~ +10(극매파)
- 핵심 문구 추출: "higher for longer", "data dependent", "gradual", "patient" 등

[2. 점도표(Dot Plot) 변화 방향]
검색: "FOMC dot plot median rate projection latest ${todayDate}"
- 이전 점도표 대비 변화: MORE_CUTS(인하 더 많음)/UNCHANGED/FEWER_CUTS(인하 축소)

[3. 한국 증시 임팩트 판단]
- BULLISH: 비둘기파(점수 -5 이하) → 달러 약세 → 외국인 유입
- NEUTRAL: 중립(-5 ~ +5) → 영향 제한적
- BEARISH: 매파(점수 +5 이상) → 달러 강세 → 외국인 유출
- 한국 증시 영향 근거 (한국어 1줄)

응답 형식 (JSON only):
{
  "hawkDovishScore": 3,
  "keyPhrases": ["data dependent", "gradual approach", "labor market strong"],
  "dotPlotShift": "FEWER_CUTS",
  "kospiImpact": "BEARISH",
  "rationale": "매파적 전환 → 달러 강세 → 외국인 자금 유출 압력",
  "lastUpdated": "${requestedAtISO}"
}
  `.trim();

  const weekKey = `${requestedAt.getFullYear()}-W${Math.ceil(requestedAt.getDate() / 7)}`;
  const cacheKey = `fomc-sentiment-${weekKey}`;

  return getCachedAIResponse<FomcSentimentAnalysis>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: { temperature: 0.1 },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as FomcSentimentAnalysis;
    } catch (error) {
      console.error("Error getting FOMC sentiment analysis:", error);
      return {
        hawkDovishScore: 0,
        keyPhrases: [],
        dotPlotShift: 'UNCHANGED',
        kospiImpact: 'NEUTRAL',
        rationale: 'FOMC 감성 분석 실패. 기본값 적용.',
        lastUpdated: requestedAtISO,
      };
    }
  });
}
