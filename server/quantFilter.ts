// @responsibility quantFilter 서버 모듈
/**
 * quantFilter.ts — 서버사이드 경량 Gate 평가
 *
 * 전체 27조건 중 서버에서 평가 가능한 조건들을 실계산.
 * 나머지는 UI에서 수동 입력 시 반영되는 구조 유지.
 *
 * ADR-452: gateScore는 기존 live 의사결정 호환을 위해 raw score 그대로 유지하되,
 * DATA_UNAVAILABLE을 분모에서 제외한 availableMaxScore / normalizedGateScore를 진단용으로 노출한다.
 */

import type { YahooQuoteExtended } from './screener/stockScreener.js';
import type { DartFinancials } from './clients/dartFinancialClient.js';
import type { KisInvestorFlow } from './clients/kisClient.js';
import type { RegimeLevel } from '../src/types/core.js';
import { getVixConservativeMode } from './state.js';
import { isTradingHeld } from './learning/learningState.js';
import { getRegimeGateBand } from './trading/gateConfig.js';
import { defaultRegistry, calculateCompressionScore } from './quant/conditions/index.js';
import {
  buildKisOfficialQuoteCoverageFromQuote,
  type KisOfficialDriftDiagnostic,
  type KisProviderStatus,
} from './clients/kisClient/kisOfficialQuoteMapper.js';
import {
  normalizeLiquidityFloorForGate1,
  type Gate1LiquidityFloorDiagnostic,
  type Gate1LiquidityFloorStatus as Gate1LiquidityFloorStatusValue,
} from './quant/gate1LiquidityFloor.js';
import {
  normalizeShadowEligibilityForGate1,
  type Gate1ShadowEligibilityDiagnostic,
  type Gate1ShadowEligibilityMode as Gate1ShadowEligibilityModeValue,
} from './quant/gate1ShadowEligibility.js';
import {
  buildGate1ConsolidatedDiagnostic,
  type Gate1ConsolidatedDiagnostic,
} from './quant/gate1ConsolidatedDiagnostic.js';
import {
  buildGate2ExternalDataCoverage,
  buildGate2SourceCoverage,
  buildGate2WiringDiagnostics,
  type Gate2EvaluationStage,
  type Gate2ExternalDataCoverage,
  type Gate2ExternalCoverageInput,
  type Gate2SourceCoverage,
  type Gate2WiringDiagnostic,
} from './quant/gate2Diagnostics.js';

export type GateLayerName = 'gate1' | 'gate2' | 'gate3';

export type GateFinalPath = 'LIVE_ELIGIBLE' | 'SHADOW_OBSERVABLE' | 'WATCHLIST_ONLY' | 'BLOCKED';

export type Gate1WiringStatus =
  | 'FIRED'
  | 'THRESHOLD_NOT_MET'
  | 'DATA_UNAVAILABLE'
  | 'PROVIDER_DEGRADED'
  | 'ERROR';

export type GateLayerDataPath = 'QUOTE_ONLY' | 'KIS' | 'DART' | 'MIXED' | 'UNKNOWN';

export interface Gate1WiringDiagnostic {
  key: string;
  layer: 'gate1';
  status: Gate1WiringStatus;
  inputs: string[];
  quoteInputs: string[];
  missingInputs: string[];
  dataPath: GateLayerDataPath;
}

export interface Gate1SourceCoverage {
  conditionCount: number;
  quoteInputCount: number;
  externalRequiredData: string[];
  missingInputs: string[];
  missingExternalData: string[];
  allDeclaredInputsAvailable: boolean;
  allExternalDataAvailable: boolean;
}

export type Gate1SurvivalExecutionImpact = 'NONE' | 'LIVE_BUY_BLOCKED_ONLY' | 'DIAGNOSTIC_ONLY';

export type Gate1QuoteFreshnessStatus = 'OK' | 'STALE' | 'MISSING' | 'UNKNOWN';
export type Gate1TradabilityStatus = 'TRADABLE' | 'HALTED' | 'WARNING' | 'MANAGEMENT' | 'UNKNOWN';
export type Gate1TradabilitySource = 'KIS_OFFICIAL' | 'QMP_MASTER' | 'UNKNOWN';
export type Gate1TradabilityMarket = 'KOSPI' | 'KOSDAQ' | 'KONEX' | 'ETF' | 'ETN' | 'REIT' | 'SPAC' | 'PREFERRED' | 'UNKNOWN';
export type Gate1TradabilityStockType = 'COMMON' | 'PREFERRED' | 'ETF' | 'ETN' | 'REIT' | 'SPAC' | 'OTHER' | 'UNKNOWN';
export type Gate1TradabilitySourceStatus = 'VERIFIED' | 'STALE' | 'MISSING' | 'DEGRADED' | 'UNKNOWN';
export type Gate1LiquidityFloorStatus = Gate1LiquidityFloorStatusValue;
export type Gate1MarketSession = 'REGULAR' | 'PREMARKET' | 'AFTERMARKET' | 'LUNCH' | 'SELL_ONLY' | 'CLOSED' | 'HOLIDAY' | 'UNKNOWN';
export type Gate1QuoteCoverageSource = 'KIS_OFFICIAL' | 'QMP_QUOTE' | 'YAHOO' | 'CACHE' | 'UNKNOWN';
export type Gate1QuoteCoverageConfidence = 'VERIFIED' | 'DEGRADED' | 'STALE' | 'MISSING' | 'AI_ESTIMATED';
export type Gate1ShadowEligibilityMode = Gate1ShadowEligibilityModeValue;
export type Gate1KisProviderStatus = KisProviderStatus;

export interface Gate1SurvivalDiagnostic {
  quoteFreshness: {
    status: Gate1QuoteFreshnessStatus;
    asOf: string | null;
    ageSec: number | null;
    provider: string | null;
    executionImpact: Gate1SurvivalExecutionImpact;
    providerIssue: boolean;
    marketSignal: false;
  };
  tradability: {
    status: Gate1TradabilityStatus;
    tradable?: boolean | null;
    market?: Gate1TradabilityMarket;
    stockType?: Gate1TradabilityStockType;
    source: Gate1TradabilitySource;
    sourceStatus?: Gate1TradabilitySourceStatus;
    reason: string | null;
    providerIssue?: boolean;
    marketSignal?: false;
    executionImpact: Gate1SurvivalExecutionImpact;
  };
  liquidityFloor: Gate1LiquidityFloorDiagnostic;
  marketSessionCompatibility: {
    session: Gate1MarketSession;
    liveBuyAllowed: boolean;
    liveSellAllowed?: boolean;
    shadowAllowed: boolean;
    reason: string | null;
  };
  kisOfficialQuoteCoverage: {
    source: Gate1QuoteCoverageSource;
    endpoint: string;
    trId: string;
    requiredParams: string[];
    requiredFields: string[];
    presentFields: string[];
    missingFields: string[];
    allRequiredFieldsPresent: boolean;
    providerStatus: Gate1KisProviderStatus;
    confidence: Gate1QuoteCoverageConfidence;
    providerIssue: boolean;
    marketSignal: false;
    executionImpact: Gate1SurvivalExecutionImpact;
    asOf: string | null;
    gate1DeclaredMissingInputs: string[];
    driftDiagnostics: KisOfficialDriftDiagnostic[];
  };
  shadowEligibility: Gate1ShadowEligibilityDiagnostic;
}

export interface GateLayerBucket {
  fired: string[];
  unavailable: string[];
  thresholdNotMet: string[];
  providerDegraded: string[];
  passed: boolean;
  score: number;
  availableMaxScore: number;
  wiring?: Array<Gate1WiringDiagnostic | Gate2WiringDiagnostic>;
  sourceCoverage?: Gate1SourceCoverage | Gate2SourceCoverage;
  survival?: Gate1SurvivalDiagnostic;
  consolidatedDiagnostic?: Gate1ConsolidatedDiagnostic;
  externalDataCoverage?: Gate2ExternalDataCoverage;
}

export interface GateLayerSummary {
  gate1: GateLayerBucket;
  gate2: GateLayerBucket;
  gate3: GateLayerBucket;
  finalPath: GateFinalPath;
  primaryBlockReason?: string;
}

export interface GateEvaluationSnapshot {
  gate1Passed: boolean;
  gate2Passed: boolean;
  gate3Passed: boolean;
  passedCount: number;
  unavailableKeys: string[];
  thresholdNotMetKeys: string[];
  providerDegradedKeys: string[];
  finalPath: GateFinalPath;
  blockReason?: string;
}

export interface ServerGateResult {
  gateScore: number;                          // 기존 live 의사결정 호환 raw score (float, 최대 ~15)
  /** ADR-452 — gateScore와 동일한 원점수. 신규 호출자는 rawScore를 선호. */
  rawScore: number;
  /** ADR-452 — DATA_UNAVAILABLE 조건을 제외한 현재 평가 가능 최대점. */
  availableMaxScore: number;
  /** ADR-452 — rawScore / availableMaxScore, 진단 전용. live 기준 대체 금지. */
  normalizedGateScore: number;
  /** ADR-452 — 데이터가 없어 평가 불가였던 조건 키. */
  unavailableConditions: string[];
  /** ADR-452 — 데이터는 있었지만 임계 미달이었던 조건 키. */
  thresholdNotMetConditions: string[];
  /** ADR-452 — provider degraded로 점수 합산에서 제외/강등된 조건 키. */
  providerDegradedConditions?: string[];
  signalType: 'STRONG' | 'NORMAL' | 'SKIP';
  positionPct: number;                        // Kelly 기반 포지션 비율
  details: string[];                          // 통과한 조건 레이블
  conditionKeys: string[];                    // 통과한 조건 키 (Signal Calibrator용)
  compressionScore: number;                   // CS (0~1) — 변동성 압축도 정량화 지수
  mtas: number;                               // MTAS (0~10) — 멀티타임프레임 정렬도
  /**
   * ADR-0387 — 평가 outputs 배열 (status 분류 포함). recordGateAuditByStatus 입력.
   * ADR-0418 Phase 3 — `context` 옵셔널 필드 추가.
   */
  outputs?: Array<{
    key: string;
    inputs?: readonly string[];
    output: { score: number; status?: string; detail?: string } | null;
    context?: {
      requiredData: string[];
      availableData: Record<string, boolean>;
      hadRequiredData: boolean;
      quoteInputs?: string[];
      inputAvailability?: Record<string, boolean>;
      missingInputs?: string[];
    };
  }>;
  /**
   * Gate 1/2/3 layer summary is diagnostic-only. It must never replace gateScore/rawScore
   * or normalizedGateScore in live threshold decisions.
   */
  gateLayerSummary?: GateLayerSummary;
  /**
   * Gate 1/2/3 pass snapshot for persistence. Derived only from gateLayerSummary.
   * Diagnostic/persistence data only; never use this to replace live threshold decisions.
   */
  gateEvaluation: GateEvaluationSnapshot;
}

/** 조건 키 상수 — condition-weights.json의 키와 1:1 매핑 */
export const CONDITION_KEYS = {
  MOMENTUM:          'momentum',
  MA_ALIGNMENT:      'ma_alignment',
  VOLUME_BREAKOUT:   'volume_breakout',
  PER:               'per',
  TURTLE_HIGH:       'turtle_high',
  RELATIVE_STRENGTH: 'relative_strength',
  BREAKOUT_MOMENTUM: 'breakout_momentum',
  VCP:               'vcp',
  VOLUME_SURGE:      'volume_surge',
  RSI_ZONE:          'rsi_zone',
  MACD_BULL:         'macd_bull',
  PULLBACK:          'pullback',
  MA60_RISING:       'ma60_rising',
  WEEKLY_RSI_ZONE:   'weekly_rsi_zone',
  SUPPLY_CONFLUENCE: 'supply_confluence',
  EARNINGS_QUALITY:  'earnings_quality',
  TREND_ACCELERATION: 'trend_acceleration',
} as const;

export type ConditionKey = (typeof CONDITION_KEYS)[keyof typeof CONDITION_KEYS];

/** 조건별 가중치 — 기본값 1.0, 범위 0.1~2.0 */
export type ConditionWeights = Record<ConditionKey, number>;

export const DEFAULT_CONDITION_WEIGHTS: ConditionWeights = {
  momentum:          1.0,
  ma_alignment:      1.0,
  volume_breakout:   1.0,
  per:               1.0,
  turtle_high:       1.0,
  relative_strength: 1.0,
  breakout_momentum: 1.0,
  vcp:               1.0,
  volume_surge:      1.0,
  rsi_zone:          1.0,
  macd_bull:         1.0,
  pullback:          1.0,
  ma60_rising:       1.0,
  weekly_rsi_zone:   0.8,
  supply_confluence: 1.2,
  earnings_quality:  0.7,
  trend_acceleration: 1.0,
};

const CONDITION_WEIGHT_MIN = 0.1;
const CONDITION_WEIGHT_MAX = 2.0;
const GATE1_SURVIVAL_STALE_AFTER_SEC = 15 * 60;

type QuoteRecord = YahooQuoteExtended & Record<string, unknown>;

const GATE1_DECLARED_CONDITION_FIELD_ALIASES: ReadonlyArray<{ field: string; aliases: readonly string[] }> = [
  { field: 'quote.ma5', aliases: ['ma5'] },
  { field: 'quote.ma20', aliases: ['ma20'] },
  { field: 'quote.ma60', aliases: ['ma60'] },
  { field: 'quote.ma60TrendUp', aliases: ['ma60TrendUp'] },
  { field: 'quote.weeklyRSI', aliases: ['weeklyRSI'] },
];

/** Gate condition → 3-layer diagnostic SSOT. Live thresholds/weights are not derived from this map. */
export const GATE_CONDITION_LAYER_MAP: Record<ConditionKey, GateLayerName> = {
  momentum: 'gate3',
  ma_alignment: 'gate1',
  volume_breakout: 'gate3',
  per: 'gate2',
  turtle_high: 'gate3',
  relative_strength: 'gate2',
  breakout_momentum: 'gate3',
  vcp: 'gate3',
  volume_surge: 'gate3',
  rsi_zone: 'gate3',
  macd_bull: 'gate3',
  pullback: 'gate3',
  ma60_rising: 'gate1',
  weekly_rsi_zone: 'gate1',
  supply_confluence: 'gate2',
  earnings_quality: 'gate2',
  trend_acceleration: 'gate2',
};

function emptyGateLayerBucket(): GateLayerBucket {
  return {
    fired: [],
    unavailable: [],
    thresholdNotMet: [],
    providerDegraded: [],
    passed: false,
    score: 0,
    availableMaxScore: 0,
  };
}

function emptyGate1SourceCoverage(): Gate1SourceCoverage {
  return {
    conditionCount: 0,
    quoteInputCount: 0,
    externalRequiredData: [],
    missingInputs: [],
    missingExternalData: [],
    allDeclaredInputsAvailable: true,
    allExternalDataAvailable: true,
  };
}

function hasQuoteValue(quote: QuoteRecord, aliases: readonly string[]): boolean {
  return aliases.some(alias => Object.prototype.hasOwnProperty.call(quote, alias) && quote[alias] != null);
}

function firstQuoteValue(quote: QuoteRecord, aliases: readonly string[]): unknown {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(quote, alias) && quote[alias] != null) return quote[alias];
  }
  return undefined;
}

function finiteNumberOrNull(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function positiveNumberOrNull(value: unknown): number | null {
  const n = finiteNumberOrNull(value);
  return n != null && n > 0 ? n : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function boolValue(value: unknown): boolean {
  return value === true || value === 'true' || value === 'Y' || value === '1' || value === 1;
}

function normalizeGate1TradabilityMarket(value: unknown): Gate1TradabilityMarket {
  const raw = String(value ?? '').trim().toUpperCase();
  if (raw === 'KOSPI' || raw === 'KOSDAQ' || raw === 'KONEX' || raw === 'ETF' || raw === 'ETN' || raw === 'REIT' || raw === 'SPAC' || raw === 'PREFERRED') {
    return raw;
  }
  return 'UNKNOWN';
}

function normalizeGate1StockType(value: unknown, quote: QuoteRecord, source: Gate1TradabilitySource): Gate1TradabilityStockType {
  const raw = String(value ?? '').trim().toUpperCase();
  if (raw === 'COMMON' || raw === 'PREFERRED' || raw === 'ETF' || raw === 'ETN' || raw === 'REIT' || raw === 'SPAC' || raw === 'OTHER') {
    return raw;
  }
  if (boolValue(quote.preferred) || boolValue(quote.isPreferred)) return 'PREFERRED';
  if (boolValue(quote.etf) || boolValue(quote.isEtf)) return 'ETF';
  if (boolValue(quote.etn) || boolValue(quote.isEtn)) return 'ETN';
  if (boolValue(quote.reit) || boolValue(quote.isReit)) return 'REIT';
  if (boolValue(quote.spac) || boolValue(quote.isSpac)) return 'SPAC';
  return source === 'UNKNOWN' ? 'UNKNOWN' : 'COMMON';
}

function inferQuoteProviderLabel(quote: QuoteRecord): string | null {
  const priceMetadata = quote.priceMetadata as { source?: unknown } | undefined;
  return stringOrNull(priceMetadata?.source)
    ?? stringOrNull(quote.quoteProvider)
    ?? stringOrNull(quote.provider)
    ?? stringOrNull(quote.source)
    ?? stringOrNull(quote.priceProvider);
}

function buildGate1QuoteCoverage(quote: YahooQuoteExtended): Gate1SurvivalDiagnostic['kisOfficialQuoteCoverage'] {
  const q = quote as QuoteRecord;
  const coverage = buildKisOfficialQuoteCoverageFromQuote(q);
  const gate1DeclaredMissingInputs = GATE1_DECLARED_CONDITION_FIELD_ALIASES
    .filter(item => !hasQuoteValue(q, item.aliases))
    .map(item => item.field);

  return {
    source: coverage.source,
    endpoint: coverage.endpoint,
    trId: coverage.trId,
    requiredParams: [...coverage.requiredParams],
    requiredFields: [...coverage.requiredFields],
    presentFields: [...coverage.presentFields],
    missingFields: [...coverage.missingFields],
    allRequiredFieldsPresent: coverage.allRequiredFieldsPresent,
    providerStatus: coverage.providerStatus,
    confidence: coverage.confidence,
    providerIssue: coverage.providerIssue,
    marketSignal: false,
    executionImpact: coverage.executionImpact,
    asOf: coverage.asOf,
    gate1DeclaredMissingInputs,
    driftDiagnostics: [...coverage.driftDiagnostics],
  };
}

function buildGate1QuoteFreshness(
  quote: YahooQuoteExtended,
  coverage: Gate1SurvivalDiagnostic['kisOfficialQuoteCoverage'],
): Gate1SurvivalDiagnostic['quoteFreshness'] {
  const q = quote as QuoteRecord;
  const price = positiveNumberOrNull(firstQuoteValue(q, ['price', 'currentPrice', 'regularMarketPrice']));
  const volume = positiveNumberOrNull(firstQuoteValue(q, ['volume', 'regularMarketVolume', 'acmlVol', 'acml_vol']));
  const priceMetadata = q.priceMetadata as { asOf?: unknown; source?: unknown } | undefined;
  const asOf = coverage.asOf
    ?? stringOrNull(priceMetadata?.asOf)
    ?? stringOrNull(q.asOf)
    ?? stringOrNull(q.updatedAt)
    ?? stringOrNull(q.fetchedAt)
    ?? stringOrNull(q.screenedAt);
  const provider = coverage.source === 'KIS_OFFICIAL'
    ? 'KIS_OFFICIAL'
    : inferQuoteProviderLabel(q);
  const asOfMs = asOf ? new Date(asOf).getTime() : NaN;
  const ageSec = Number.isFinite(asOfMs)
    ? Math.max(0, Math.floor((Date.now() - asOfMs) / 1000))
    : null;

  let status: Gate1QuoteFreshnessStatus;
  if (price == null || volume == null) status = 'MISSING';
  else if (!asOf || ageSec == null) status = 'UNKNOWN';
  else if (String(q.dataQuality ?? '').includes('STALE') || ageSec > GATE1_SURVIVAL_STALE_AFTER_SEC) status = 'STALE';
  else status = 'OK';

  const executionImpact: Gate1SurvivalExecutionImpact = status === 'OK'
    ? 'NONE'
    : coverage.source === 'KIS_OFFICIAL'
      ? 'DIAGNOSTIC_ONLY'
      : status === 'STALE' || status === 'MISSING'
        ? 'LIVE_BUY_BLOCKED_ONLY'
      : 'DIAGNOSTIC_ONLY';

  return {
    status,
    asOf,
    ageSec,
    provider,
    executionImpact,
    providerIssue: status !== 'OK',
    marketSignal: false,
  };
}

function buildGate1Tradability(quote: YahooQuoteExtended): Gate1SurvivalDiagnostic['tradability'] {
  const q = quote as QuoteRecord;
  const source: Gate1TradabilitySource = boolValue(q.kisOfficialTradability)
    ? 'KIS_OFFICIAL'
    : Object.prototype.hasOwnProperty.call(q, 'isHighRisk')
      ? 'QMP_MASTER'
      : 'UNKNOWN';

  let status: Gate1TradabilityStatus = 'UNKNOWN';
  let reason: string | null = null;

  if (boolValue(q.tradingHalted) || boolValue(q.halted) || boolValue(q.tradeStop)) {
    status = 'HALTED';
    reason = 'TRADING_HALTED';
  } else if (boolValue(q.managementIssue) || boolValue(q.managementStock) || boolValue(q.isManagement)) {
    status = 'MANAGEMENT';
    reason = 'MANAGEMENT_STOCK';
  } else if (
    boolValue(q.investmentWarning)
    || boolValue(q.investmentCaution)
    || boolValue(q.investmentRisk)
    || boolValue(q.cleanupTrading)
    || q.isHighRisk === true
  ) {
    status = 'WARNING';
    reason = 'INVESTMENT_WARNING_OR_HIGH_RISK';
  } else if (source !== 'UNKNOWN') {
    status = 'TRADABLE';
  }

  const executionImpact: Gate1SurvivalExecutionImpact = status === 'TRADABLE'
    ? 'NONE'
    : status === 'UNKNOWN'
      ? 'DIAGNOSTIC_ONLY'
      : 'LIVE_BUY_BLOCKED_ONLY';
  const tradable = status === 'TRADABLE'
    ? true
    : status === 'UNKNOWN'
      ? null
      : false;
  const sourceStatus: Gate1TradabilitySourceStatus = source === 'UNKNOWN' ? 'MISSING' : 'VERIFIED';

  return {
    status,
    tradable,
    market: normalizeGate1TradabilityMarket(q.market),
    stockType: normalizeGate1StockType(q.stockType, q, source),
    source,
    sourceStatus,
    reason,
    providerIssue: source === 'UNKNOWN',
    marketSignal: false,
    executionImpact,
  };
}

function buildGate1LiquidityFloor(
  quote: YahooQuoteExtended,
  coverage: Gate1SurvivalDiagnostic['kisOfficialQuoteCoverage'],
): Gate1SurvivalDiagnostic['liquidityFloor'] {
  return normalizeLiquidityFloorForGate1({
    quote: quote as QuoteRecord,
    quoteCoverage: coverage,
  });
}

function normalizeGate1MarketSession(value: unknown): Gate1MarketSession {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return 'UNKNOWN';
  if (raw === 'REGULAR' || raw === 'OPEN' || raw === 'MARKET_OPEN') return 'REGULAR';
  if (raw === 'PREMARKET' || raw === 'PRE_MARKET' || raw === 'PREOPEN' || raw === 'PRE_OPEN') return 'PREMARKET';
  if (raw === 'AFTERMARKET' || raw === 'AFTER_MARKET' || raw === 'AFTER_HOURS') return 'AFTERMARKET';
  if (raw === 'LUNCH' || raw === 'MIDDAY_BREAK') return 'LUNCH';
  if (raw === 'SELL_ONLY') return 'SELL_ONLY';
  if (raw === 'HOLIDAY') return 'HOLIDAY';
  if (raw === 'CLOSED' || raw === 'NON_TRADING_DAY' || raw === 'MARKET_CLOSED') return 'CLOSED';
  return 'UNKNOWN';
}

function buildGate1MarketSessionCompatibility(quote: YahooQuoteExtended): Gate1SurvivalDiagnostic['marketSessionCompatibility'] {
  const q = quote as QuoteRecord;
  const session = normalizeGate1MarketSession(
    q.marketSession
      ?? q.marketSessionState
      ?? q.session
      ?? q.tradingSession
      ?? q.engineMode,
  );
  const liveBuyAllowed = session === 'REGULAR';
  const liveSellAllowed = session !== 'CLOSED' && session !== 'HOLIDAY' && session !== 'UNKNOWN';
  const shadowAllowed = true;
  const reason = session === 'UNKNOWN'
    ? 'MARKET_SESSION_UNKNOWN'
    : liveBuyAllowed
      ? null
      : `${session}_LIVE_BUY_NOT_ALLOWED_DIAGNOSTIC`;
  return { session, liveBuyAllowed, liveSellAllowed, shadowAllowed, reason };
}

function buildGate1ShadowEligibility(input: {
  quote: YahooQuoteExtended;
  freshness: Gate1SurvivalDiagnostic['quoteFreshness'];
  coverage: Gate1SurvivalDiagnostic['kisOfficialQuoteCoverage'];
  tradability: Gate1SurvivalDiagnostic['tradability'];
  liquidityFloor: Gate1SurvivalDiagnostic['liquidityFloor'];
  marketSession: Gate1SurvivalDiagnostic['marketSessionCompatibility'];
}): Gate1SurvivalDiagnostic['shadowEligibility'] {
  const q = input.quote as QuoteRecord;
  return normalizeShadowEligibilityForGate1({
    engineMode: stringOrNull(q.engineMode)
      ?? stringOrNull(q.executionMode)
      ?? stringOrNull(q.runtimeEngineMode),
    marketSessionCompatibility: input.marketSession,
    quoteCoverage: input.coverage,
    quoteFreshness: input.freshness,
    tradability: input.tradability,
    liquidityFloor: input.liquidityFloor,
    alwaysOnKernelEnabled: true,
  });
}

function buildGate1SurvivalDiagnostic(quote: YahooQuoteExtended): Gate1SurvivalDiagnostic {
  const kisOfficialQuoteCoverage = buildGate1QuoteCoverage(quote);
  const quoteFreshness = buildGate1QuoteFreshness(quote, kisOfficialQuoteCoverage);
  const tradability = buildGate1Tradability(quote);
  const liquidityFloor = buildGate1LiquidityFloor(quote, kisOfficialQuoteCoverage);
  const marketSessionCompatibility = buildGate1MarketSessionCompatibility(quote);
  const shadowEligibility = buildGate1ShadowEligibility({
    quote,
    freshness: quoteFreshness,
    coverage: kisOfficialQuoteCoverage,
    tradability,
    liquidityFloor,
    marketSession: marketSessionCompatibility,
  });
  return {
    quoteFreshness,
    tradability,
    liquidityFloor,
    marketSessionCompatibility,
    kisOfficialQuoteCoverage,
    shadowEligibility,
  };
}

function layerForCondition(key: string): GateLayerName {
  return (GATE_CONDITION_LAYER_MAP as Record<string, GateLayerName>)[key] ?? 'gate3';
}

function addUnique(target: string[], value: string): void {
  if (!target.includes(value)) target.push(value);
}

function dataPathForInputs(inputs: readonly string[]): GateLayerDataPath {
  const hasQuote = inputs.some(input => input.startsWith('quote.'));
  const hasKis = inputs.some(input => input.startsWith('ctx.kisFlow.'));
  const hasDart = inputs.some(input => input.startsWith('ctx.dartFin.'));
  const hasOtherCtx = inputs.some(input => (
    input.startsWith('ctx.')
    && !input.startsWith('ctx.kisFlow.')
    && !input.startsWith('ctx.dartFin.')
  ));
  const sourceCount = [hasQuote, hasKis, hasDart, hasOtherCtx].filter(Boolean).length;
  if (sourceCount === 0) return 'UNKNOWN';
  if (sourceCount > 1) return 'MIXED';
  if (hasQuote) return 'QUOTE_ONLY';
  if (hasKis) return 'KIS';
  if (hasDart) return 'DART';
  return 'UNKNOWN';
}

function toGate1WiringStatus(status: GateOutputStatus): Gate1WiringStatus {
  if (status === 'FIRED'
    || status === 'DATA_UNAVAILABLE'
    || status === 'PROVIDER_DEGRADED'
    || status === 'ERROR') {
    return status;
  }
  return 'THRESHOLD_NOT_MET';
}

function buildGate1WiringDiagnostic(
  item: NonNullable<ServerGateResult['outputs']>[number],
  status: GateOutputStatus,
): Gate1WiringDiagnostic {
  const inputs = [...(item.inputs ?? [])];
  const quoteInputs = item.context?.quoteInputs
    ? [...item.context.quoteInputs]
    : inputs.filter(input => input.startsWith('quote.'));
  return {
    key: item.key,
    layer: 'gate1',
    status: toGate1WiringStatus(status),
    inputs,
    quoteInputs,
    missingInputs: [...(item.context?.missingInputs ?? [])],
    dataPath: dataPathForInputs(inputs),
  };
}

function buildGate1SourceCoverage(outputs: NonNullable<ServerGateResult['outputs']>): Gate1SourceCoverage {
  const quoteInputs: string[] = [];
  const externalRequiredData: string[] = [];
  const missingInputs: string[] = [];
  const missingExternalData: string[] = [];
  let conditionCount = 0;

  for (const item of outputs) {
    if (layerForCondition(item.key) !== 'gate1') continue;
    conditionCount += 1;

    const declaredInputs = [...(item.inputs ?? [])];
    const declaredQuoteInputs = item.context?.quoteInputs
      ? item.context.quoteInputs
      : declaredInputs.filter(input => input.startsWith('quote.'));
    for (const input of declaredQuoteInputs) addUnique(quoteInputs, input);
    for (const input of item.context?.missingInputs ?? []) addUnique(missingInputs, input);

    for (const key of item.context?.requiredData ?? []) {
      addUnique(externalRequiredData, key);
      if (item.context?.availableData?.[key] !== true) addUnique(missingExternalData, key);
    }
  }

  return {
    conditionCount,
    quoteInputCount: quoteInputs.length,
    externalRequiredData,
    missingInputs,
    missingExternalData,
    allDeclaredInputsAvailable: missingInputs.length === 0,
    allExternalDataAvailable: missingExternalData.length === 0,
  };
}

function buildGateLayerSummary(
  outputs: NonNullable<ServerGateResult['outputs']>,
  weights: ConditionWeights,
  signalType: ServerGateResult['signalType'],
  gate2ExternalCoverageInput: Gate2ExternalCoverageInput = {},
): GateLayerSummary {
  const summary: GateLayerSummary = {
    gate1: { ...emptyGateLayerBucket(), wiring: [], sourceCoverage: emptyGate1SourceCoverage() },
    gate2: emptyGateLayerBucket(),
    gate3: emptyGateLayerBucket(),
    finalPath: 'WATCHLIST_ONLY',
  };

  for (const item of outputs) {
    const layerName = layerForCondition(item.key);
    const layer = summary[layerName];
    const status = inferOutputStatus(item.output, item.context?.hadRequiredData);
    const score = item.output && Number.isFinite(item.output.score) ? Math.max(0, item.output.score) : 0;
    const baseWeight = conditionWeightFor(weights, item.key);
    if (layerName === 'gate1') {
      summary.gate1.wiring?.push(buildGate1WiringDiagnostic(item, status));
    }

    if (status === 'DATA_UNAVAILABLE' || status === 'ERROR') {
      layer.unavailable.push(item.key);
      continue;
    }

    layer.availableMaxScore += Math.max(baseWeight, score);
    if (status === 'PROVIDER_DEGRADED') {
      layer.providerDegraded.push(item.key);
    } else if (status === 'THRESHOLD_NOT_MET' || status === 'SKIPPED_BY_POLICY' || status === 'SANITY_REJECTED') {
      layer.thresholdNotMet.push(item.key);
    } else if (score > 0 || status === 'FIRED') {
      layer.fired.push(item.key);
      layer.score += score;
    }
  }

  summary.gate1.sourceCoverage = buildGate1SourceCoverage(outputs);
  const gate2Wiring = buildGate2WiringDiagnostics(outputs, GATE_CONDITION_LAYER_MAP);
  summary.gate2.wiring = gate2Wiring;
  summary.gate2.sourceCoverage = buildGate2SourceCoverage(gate2Wiring);
  summary.gate2.externalDataCoverage = buildGate2ExternalDataCoverage(gate2Wiring, gate2ExternalCoverageInput);

  for (const layer of [summary.gate1, summary.gate2, summary.gate3]) {
    layer.passed = layer.unavailable.length === 0 && layer.providerDegraded.length === 0 && layer.thresholdNotMet.length === 0 && layer.fired.length > 0;
  }

  const unavailable = [...summary.gate1.unavailable, ...summary.gate2.unavailable, ...summary.gate3.unavailable];
  const degraded = [...summary.gate1.providerDegraded, ...summary.gate2.providerDegraded, ...summary.gate3.providerDegraded];
  const thresholdMiss = [...summary.gate1.thresholdNotMet, ...summary.gate2.thresholdNotMet, ...summary.gate3.thresholdNotMet];

  if (signalType === 'SKIP') {
    summary.finalPath = 'BLOCKED';
    summary.primaryBlockReason = thresholdMiss[0] ? `THRESHOLD_NOT_MET:${thresholdMiss[0]}` : 'SIGNAL_SKIP';
  } else if (unavailable.length > 0) {
    summary.finalPath = 'SHADOW_OBSERVABLE';
    summary.primaryBlockReason = `DATA_UNAVAILABLE:${unavailable[0]}`;
  } else if (degraded.length > 0) {
    summary.finalPath = 'SHADOW_OBSERVABLE';
    summary.primaryBlockReason = `PROVIDER_DEGRADED:${degraded[0]}`;
  } else {
    summary.finalPath = 'LIVE_ELIGIBLE';
  }

  return summary;
}

function buildGateEvaluationSnapshot(
  summary: GateLayerSummary,
  conditionKeys: string[],
): GateEvaluationSnapshot {
  return {
    gate1Passed: summary.gate1.passed,
    gate2Passed: summary.gate2.passed,
    gate3Passed: summary.gate3.passed,
    passedCount: conditionKeys.length,
    unavailableKeys: [
      ...summary.gate1.unavailable,
      ...summary.gate2.unavailable,
      ...summary.gate3.unavailable,
    ],
    thresholdNotMetKeys: [
      ...summary.gate1.thresholdNotMet,
      ...summary.gate2.thresholdNotMet,
      ...summary.gate3.thresholdNotMet,
    ],
    providerDegradedKeys: [
      ...summary.gate1.providerDegraded,
      ...summary.gate2.providerDegraded,
      ...summary.gate3.providerDegraded,
    ],
    finalPath: summary.finalPath,
    ...(summary.primaryBlockReason ? { blockReason: summary.primaryBlockReason } : {}),
  };
}

type GateOutputStatus =
  | 'FIRED'
  | 'DATA_UNAVAILABLE'
  | 'THRESHOLD_NOT_MET'
  | 'PROVIDER_DEGRADED'
  | 'ERROR'
  | 'SKIPPED_BY_POLICY'
  | 'SANITY_REJECTED'
  | string;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function conditionWeightFor(weights: ConditionWeights, key: string): number {
  const raw = (weights as Record<string, number>)[key];
  if (typeof raw !== 'number' || Number.isNaN(raw)) return 1.0;
  return clamp(raw, CONDITION_WEIGHT_MIN, CONDITION_WEIGHT_MAX);
}

function inferOutputStatus(output: { score: number; status?: string } | null, hadRequiredData?: boolean): GateOutputStatus {
  if (output?.status) return output.status;
  if (output) return 'FIRED';
  return hadRequiredData === false ? 'DATA_UNAVAILABLE' : 'THRESHOLD_NOT_MET';
}

function computeGateScoreHealth(
  outputs: NonNullable<ServerGateResult['outputs']>,
  weights: ConditionWeights,
  rawScore: number,
): Pick<ServerGateResult,
  | 'rawScore'
  | 'availableMaxScore'
  | 'normalizedGateScore'
  | 'unavailableConditions'
  | 'thresholdNotMetConditions'
  | 'providerDegradedConditions'
> {
  let availableMaxScore = 0;
  const unavailableConditions: string[] = [];
  const thresholdNotMetConditions: string[] = [];
  const providerDegradedConditions: string[] = [];

  for (const item of outputs) {
    const key = item.key;
    const output = item.output;
    const status = inferOutputStatus(output, item.context?.hadRequiredData);
    const baseWeight = conditionWeightFor(weights, key);

    if (status === 'DATA_UNAVAILABLE') {
      unavailableConditions.push(key);
      continue;
    }

    if (status === 'ERROR') {
      unavailableConditions.push(key);
      continue;
    }

    // ADR-452: THRESHOLD_NOT_MET/PROVIDER_DEGRADED/FIRED는 평가 가능한 조건으로 분모에 남긴다.
    // FIRED 보너스 점수가 baseWeight보다 큰 경우 normalized>1 방지를 위해 실제 score를 상한 후보로 반영한다.
    const firedScore = output && Number.isFinite(output.score) ? Math.max(0, output.score) : 0;
    availableMaxScore += Math.max(baseWeight, firedScore);

    if (status === 'THRESHOLD_NOT_MET' || status === 'SKIPPED_BY_POLICY' || status === 'SANITY_REJECTED') {
      thresholdNotMetConditions.push(key);
    } else if (status === 'PROVIDER_DEGRADED') {
      providerDegradedConditions.push(key);
    }
  }

  const normalizedGateScore = availableMaxScore > 0
    ? clamp(rawScore / availableMaxScore, 0, 1)
    : 0;

  return {
    rawScore,
    availableMaxScore,
    normalizedGateScore,
    unavailableConditions,
    thresholdNotMetConditions,
    providerDegradedConditions,
  };
}

/**
 * Multi-Timeframe Alignment Score (MTAS) — 타임프레임 정렬도 수치화
 */
function calculateMTAS(quote: YahooQuoteExtended): { mtas: number; dataInsufficient: boolean } {
  let mtas = 0;

  if (quote.monthlyAboveEMA12 && quote.monthlyEMARising) {
    mtas += 3;
  }

  if (quote.weeklyAboveCloud) mtas += 1.5;
  if (quote.weeklyLaggingSpanUp) mtas += 1.5;

  let dailyScore = 0;
  if (quote.ma5 > 0 && quote.ma20 > 0 && quote.ma60 > 0 &&
      quote.ma5 > quote.ma20 && quote.ma20 > quote.ma60) {
    dailyScore += 1.5;
  }
  if (quote.atr20avg > 0 && quote.atr < quote.atr20avg * 0.7) {
    dailyScore += 1.5;
  }
  if (quote.dailyVolumeDrying) {
    dailyScore += 1;
  }
  mtas += dailyScore;

  const monthlyWeeklyScore = mtas - dailyScore;
  const dataInsufficient = monthlyWeeklyScore === 0 && dailyScore > 0 &&
    !quote.monthlyAboveEMA12 && !quote.weeklyAboveCloud && !quote.weeklyLaggingSpanUp;

  if (dataInsufficient && dailyScore > 0) {
    mtas = Math.max(4.0, (dailyScore / 4) * 7);
  }

  return { mtas, dataInsufficient };
}

/**
 * Yahoo Finance 확장 시세 데이터로 Gate 조건 평가.
 */
export function evaluateServerGate(
  quote: YahooQuoteExtended,
  weights: ConditionWeights = DEFAULT_CONDITION_WEIGHTS,
  kospi20dReturn?: number,
  dartFin?: DartFinancials | null,
  kisFlow?: Gate2ExternalCoverageInput['kisFlow'],
  regime?: RegimeLevel | string,
  evaluationStage?: Gate2EvaluationStage | null,
): ServerGateResult {
  const run = defaultRegistry.run({ quote, weights, kospi20dReturn, dartFin, kisFlow: kisFlow as KisInvestorFlow | null | undefined });
  let score = run.totalScore;
  const details = [...run.details];
  const conditionKeys = [...run.conditionKeys];
  const scoreHealth = computeGateScoreHealth(run.outputs, weights, score);

  const cs = calculateCompressionScore(quote);
  const { mtas, dataInsufficient } = calculateMTAS(quote);

  let signalType: 'STRONG' | 'NORMAL' | 'SKIP';
  let positionPct: number;

  if (mtas <= 3) {
    signalType = 'SKIP';
    positionPct = 0;
    details.push(`MTAS ${mtas.toFixed(1)}/10 진입금지`);
  } else {
    // ADR-452: live 의사결정은 기존 raw score(gateScore)를 그대로 사용한다. normalizedGateScore는 진단 전용.
    const band = getRegimeGateBand(regime);
    signalType = score >= band.strong ? 'STRONG' as const
               : score >= band.normal ? 'NORMAL' as const
               : 'SKIP' as const;
    if (regime && (band.strong !== 7 || band.normal !== 5)) {
      details.push(`레짐(${regime}) 밴드 S${band.strong}/N${band.normal}`);
    }

    positionPct = signalType === 'STRONG' ? 0.12
                : signalType === 'NORMAL' ? 0.08
                : 0.03;

    if (dataInsufficient) {
      positionPct *= 0.6;
      details.push(`MTAS ${mtas.toFixed(1)}/10 데이터부족-일봉평가(60%포지션)`);
    } else if (mtas === 10) {
      positionPct = Math.min(positionPct * 1.15, 0.15);
      details.push(`MTAS 10/10 최대포지션 (+15%)`);
    } else if (mtas >= 7) {
      details.push(`MTAS ${mtas.toFixed(1)}/10 표준`);
    } else if (mtas >= 5) {
      positionPct *= 0.5;
      details.push(`MTAS ${mtas.toFixed(1)}/10 50%포지션`);
    }
  }

  if (getVixConservativeMode()) {
    positionPct *= 0.80;
    if (signalType !== 'SKIP') {
      signalType = 'SKIP';
      details.push('VIX 보수모드 — 신규 진입 일시 중단');
    }
  }

  if (isTradingHeld()) {
    if (signalType !== 'SKIP') {
      signalType = 'SKIP';
      details.push('실시간 연속손절 홀드 — 신규 진입 차단 중');
    }
  }

  const gateLayerSummary = buildGateLayerSummary(run.outputs, weights, signalType, { kisFlow, dartFin, kospi20dReturn, evaluationStage });
  gateLayerSummary.gate1.survival = buildGate1SurvivalDiagnostic(quote);
  gateLayerSummary.gate1.consolidatedDiagnostic = buildGate1ConsolidatedDiagnostic({ gate1: gateLayerSummary.gate1 });
  const gateEvaluation = buildGateEvaluationSnapshot(gateLayerSummary, conditionKeys);

  return {
    gateScore: score,
    ...scoreHealth,
    signalType,
    positionPct,
    details,
    conditionKeys,
    compressionScore: cs,
    mtas,
    outputs: run.outputs,
    gateLayerSummary,
    gateEvaluation,
  };
}
