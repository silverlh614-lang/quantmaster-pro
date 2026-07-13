// @responsibility Price Snapshot SSOT for decision, execution, shadow fill, TradePlan, and display.

import { fetchCurrentPrice } from '../clients/kisClient.js';
import { getRealtimeQuote } from '../clients/kisStreamClient.js';
import type { AuthoritativeQuoteSnapshot } from './shadowExecutionSafety.js';

type PriceSource =
  | 'KIS_REALTIME_QUOTE'
  | 'KIS_DELAYED_QUOTE'
  | 'KIS_OHLCV_LAST'
  | 'YAHOO_OHLCV_LAST'
  | 'MANUAL_INPUT'
  | 'FALLBACK_PREV_CLOSE'
  | 'UNKNOWN';

type PriceConfidence =
  | 'REALTIME'
  | 'DELAYED_VALID'
  | 'EOD_VALID'
  | 'STALE'
  | 'MISSING'
  | 'ESTIMATED';

export type PriceSnapshotPurpose =
  | 'DECISION'
  | 'LIVE_ORDER'
  | 'SHADOW_FILL'
  | 'COUNTERFACTUAL'
  | 'DISPLAY';

export interface PriceSnapshot {
  snapshotId: string;
  priceSnapshotId: string;
  symbol: string;
  asOf: string;
  tradingDate: string;
  currentPrice: number | null;
  bidPrice?: number | null;
  askPrice?: number | null;
  lastTradePrice?: number | null;
  previousClose?: number | null;
  openPrice?: number | null;
  highPrice?: number | null;
  lowPrice?: number | null;
  source: PriceSource;
  confidence: PriceConfidence;
  ageSec: number;
  isTradableNow: boolean;
  isMarketOpen: boolean;
  priceUsableForDecision: boolean;
  priceUsableForExecution: boolean;
  priceUsableForShadowFill: boolean;
  reason?: string;
}

type TradePlanStatus =
  | 'VALID'
  | 'INVALID_PRICE'
  | 'INVALID_STOP'
  | 'INVALID_TARGET'
  | 'RR_INSUFFICIENT'
  | 'PRICE_STALE'
  | 'MISSING_PRICE';

type StopPolicy = 'FIXED_PCT' | 'TECHNICAL_SUPPORT' | 'HYBRID_SIMPLE';
type TargetPolicy = 'FIXED_RR' | 'FIXED_PCT' | 'HYBRID_SIMPLE';

export interface TradePlan {
  tradePlanId: string;
  snapshotId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  priceSnapshotId: string;
  entryPrice: number;
  initialStopLoss: number;
  currentStopLoss: number;
  targetPrice1: number;
  targetPrice2?: number | null;
  stopLoss: number;
  targetPrice: number;
  riskPerShare: number;
  rewardPerShare1: number;
  rewardPerShare: number;
  riskReward1: number;
  riskReward: number;
  stopLossPct: number;
  targetPct1: number;
  minRiskReward: number;
  status: TradePlanStatus;
  invalidReasons: string[];
  warnings: string[];
  riskTags: string[];
  stopPolicy: StopPolicy;
  targetPolicy: TargetPolicy;
  tp1SellPct: number;
  moveStopToBreakevenAfterTp1: boolean;
  breakevenBufferPct: number;
  computedAt: string;
  resolvedBy: 'TradePlanResolver';
}

export interface TradePlanParams {
  snapshotId?: string;
  side?: 'BUY' | 'SELL';
  stopLossPct?: number;
  targetGainPct?: number;
  minRiskReward?: number;
  initialStopLoss?: number | null;
  targetPrice1?: number | null;
  existingStopLoss?: number | null;
  existingTargetPrice?: number | null;
  technicalSupportCandidate?: number | null;
  stopPolicy?: StopPolicy;
  targetPolicy?: TargetPolicy;
  tp1SellPct?: number;
  moveStopToBreakevenAfterTp1?: boolean;
  breakevenBufferPct?: number;
  computedAt?: string;
}

export interface PriceMismatchCheck {
  referencePrice: number;
  latestPrice: number;
  diffPct: number;
  maxAllowedDiffPct: number;
  status: 'OK' | 'MISMATCH';
}

export interface TradePlanValidationResult {
  ok: boolean;
  reason?: 'STOP_ABOVE_LATEST_PRICE' | 'STOP_NOT_BELOW_ENTRY' | 'TARGET_NOT_ABOVE_ENTRY' | 'RR_INSUFFICIENT' | 'ENTRY_LATEST_MISMATCH' | 'TRADE_PLAN_STATUS_INVALID';
  executionImpact: 'NONE' | 'ORDER_WAIT_PRICE_REBUILD';
  learningLabel?: 'PRICE_PLAN_INVALID';
  mismatch?: PriceMismatchCheck;
}

export interface BreakevenStopMove {
  tradePlanId: string;
  symbol: string;
  entryPrice: number;
  tp1Price: number;
  oldStopLoss: number;
  newStopLoss: number;
  tp1RealizedPnL?: number;
  stopMovedToBreakeven: true;
}

export interface SimpleTrailingStopResult {
  currentStopLoss: number;
  trailingStop: number;
  trailingActivated: boolean;
}

const DEFAULT_SHADOW_FILL_AGE_SEC = 60;
const DEFAULT_QUOTE_AGE_SEC = 30;
const DEFAULT_STOP_LOSS_PCT = 0.05;
const DEFAULT_MIN_RISK_REWARD = 2.0;
const DEFAULT_TP1_SELL_PCT = 0.5;
const DEFAULT_BREAKEVEN_BUFFER_PCT = 0.001;
const DEFAULT_TRAILING_PCT = 0.03;
const MIN_STOP_DISTANCE_PCT = 0.015;
const WIDE_STOP_DISTANCE_PCT = 0.10;

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function roundPrice(value: number): number {
  return Math.round(value);
}

function kstTradingDate(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

function parseAgeSec(asOf: string, now: Date): number {
  const ms = Date.parse(asOf);
  if (!Number.isFinite(ms)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - ms) / 1000);
}

function normalizeSource(source: unknown): PriceSource {
  const value = String(source ?? '').toUpperCase();
  if (value.includes('KIS_WS') || value.includes('REALTIME')) return 'KIS_REALTIME_QUOTE';
  if (value.includes('KIS_API') || value.includes('KIS_CURRENT')) return 'KIS_DELAYED_QUOTE';
  if (value.includes('OHLCV')) return 'KIS_OHLCV_LAST';
  if (value.includes('YAHOO')) return 'YAHOO_OHLCV_LAST';
  if (value.includes('MANUAL')) return 'MANUAL_INPUT';
  if (value.includes('PREV_CLOSE') || value.includes('FALLBACK')) return 'FALLBACK_PREV_CLOSE';
  return 'UNKNOWN';
}

function confidenceFromQuote(quote: AuthoritativeQuoteSnapshot, source: PriceSource): PriceConfidence {
  if (quote.confidence !== 'VERIFIED') return quote.confidence === 'STALE' ? 'STALE' : 'MISSING';
  if (quote.isStale) return 'STALE';
  if (source === 'KIS_REALTIME_QUOTE') return 'REALTIME';
  if (source === 'KIS_DELAYED_QUOTE' || source === 'MANUAL_INPUT') return 'DELAYED_VALID';
  if (source === 'KIS_OHLCV_LAST' || source === 'YAHOO_OHLCV_LAST') return 'EOD_VALID';
  if (source === 'FALLBACK_PREV_CLOSE') return 'STALE';
  return 'MISSING';
}

function marketOpenFromSession(marketSession: string): boolean {
  return String(marketSession).toUpperCase() === 'REGULAR';
}

function buildPriceSnapshot(input: {
  snapshotId: string;
  symbol: string;
  marketSession: string;
  now: Date;
  currentPrice: number | null;
  bidPrice?: number | null;
  askPrice?: number | null;
  lastTradePrice?: number | null;
  previousClose?: number | null;
  source: PriceSource;
  confidence: PriceConfidence;
  asOf: string;
  reason?: string;
}): PriceSnapshot {
  const ageSec = parseAgeSec(input.asOf, input.now);
  const isMarketOpen = marketOpenFromSession(input.marketSession);
  const hasPrice = finitePositive(input.currentPrice);
  const quoteFresh = ageSec <= DEFAULT_QUOTE_AGE_SEC;
  const shadowFresh = ageSec <= DEFAULT_SHADOW_FILL_AGE_SEC;
  const confidence = !hasPrice ? 'MISSING' : input.confidence;
  const priceUsableForDecision = hasPrice && ['REALTIME', 'DELAYED_VALID', 'EOD_VALID'].includes(confidence);
  const executableSource = !['FALLBACK_PREV_CLOSE', 'UNKNOWN'].includes(input.source);
  const priceUsableForExecution = hasPrice
    && executableSource
    && ['REALTIME', 'DELAYED_VALID'].includes(confidence)
    && quoteFresh;
  const priceUsableForShadowFill = hasPrice
    && executableSource
    && ['REALTIME', 'DELAYED_VALID'].includes(confidence)
    && shadowFresh;

  return {
    snapshotId: input.snapshotId,
    priceSnapshotId: `ps_${input.snapshotId}`,
    symbol: input.symbol,
    asOf: input.asOf,
    tradingDate: kstTradingDate(input.now),
    currentPrice: hasPrice ? input.currentPrice : null,
    bidPrice: input.bidPrice,
    askPrice: input.askPrice,
    lastTradePrice: input.lastTradePrice,
    previousClose: input.previousClose,
    source: input.source,
    confidence,
    ageSec: Number.isFinite(ageSec) ? Number(ageSec.toFixed(3)) : ageSec,
    isTradableNow: hasPrice && executableSource,
    isMarketOpen,
    priceUsableForDecision,
    priceUsableForExecution,
    priceUsableForShadowFill,
    reason: input.reason ?? (!hasPrice ? 'PRICE_MISSING' : undefined),
  };
}

export function priceSnapshotFromAuthoritativeQuote(input: {
  quote: AuthoritativeQuoteSnapshot;
  purpose: PriceSnapshotPurpose;
  now?: Date;
  marketSession?: string;
}): PriceSnapshot {
  const now = input.now ?? new Date();
  const source = normalizeSource(input.quote.quoteSource);
  return buildPriceSnapshot({
    snapshotId: input.quote.snapshotId,
    symbol: input.quote.symbol,
    marketSession: input.marketSession ?? input.quote.marketSession ?? 'UNKNOWN',
    now,
    currentPrice: finitePositive(input.quote.currentPrice) ? input.quote.currentPrice : null,
    bidPrice: finitePositive(input.quote.bid) ? input.quote.bid : null,
    askPrice: finitePositive(input.quote.ask) ? input.quote.ask : null,
    lastTradePrice: finitePositive(input.quote.lastTradePrice) ? input.quote.lastTradePrice : null,
    source,
    confidence: confidenceFromQuote(input.quote, source),
    asOf: input.quote.quoteAsOf,
    reason: input.quote.providerIssue ?? undefined,
  });
}

export function resolveEntryPriceFromSnapshot(snapshot: PriceSnapshot, purpose: 'LIVE_ORDER' | 'SHADOW_FILL' | 'COUNTERFACTUAL'): number | null {
  if (purpose === 'SHADOW_FILL') return snapshot.priceUsableForShadowFill ? snapshot.currentPrice : null;
  if (purpose === 'LIVE_ORDER') return snapshot.priceUsableForExecution ? snapshot.currentPrice : null;
  return snapshot.priceUsableForDecision ? snapshot.currentPrice : null;
}

function selectStopLoss(input: {
  entryPrice: number;
  fixedStop: number;
  technicalSupportCandidate?: number | null;
  explicitStop?: number | null;
  stopPolicy: StopPolicy;
}): number {
  if (finitePositive(input.explicitStop)) {
    return roundPrice(input.explicitStop);
  }
  const technicalStop = input.technicalSupportCandidate;
  if (
    (input.stopPolicy === 'TECHNICAL_SUPPORT' || input.stopPolicy === 'HYBRID_SIMPLE')
    && finitePositive(technicalStop)
    && technicalStop < input.entryPrice
  ) {
    const distancePct = (input.entryPrice - technicalStop) / input.entryPrice;
    if (distancePct >= MIN_STOP_DISTANCE_PCT && distancePct <= WIDE_STOP_DISTANCE_PCT) {
      return roundPrice(Math.max(input.fixedStop, technicalStop));
    }
  }
  return roundPrice(input.fixedStop);
}

function deriveTradePlanStatus(input: {
  priceSnapshot: PriceSnapshot;
  entryPrice: number;
  initialStopLoss: number;
  targetPrice1: number;
  riskPerShare: number;
  riskReward1: number;
  minRiskReward: number;
}): { status: TradePlanStatus; invalidReasons: string[]; warnings: string[]; riskTags: string[] } {
  const invalidReasons: string[] = [];
  const warnings: string[] = [];
  const riskTags: string[] = [];

  if (!finitePositive(input.priceSnapshot.currentPrice)) {
    invalidReasons.push('MISSING_PRICE');
    return { status: 'MISSING_PRICE', invalidReasons, warnings, riskTags };
  }
  if (!finitePositive(input.entryPrice)) {
    invalidReasons.push('INVALID_ENTRY_PRICE');
    return { status: 'INVALID_PRICE', invalidReasons, warnings, riskTags };
  }
  if (['STALE', 'MISSING', 'ESTIMATED'].includes(input.priceSnapshot.confidence) || !input.priceSnapshot.priceUsableForDecision) {
    invalidReasons.push(`PRICE_${input.priceSnapshot.confidence}`);
    return { status: 'PRICE_STALE', invalidReasons, warnings, riskTags };
  }
  if (!finitePositive(input.initialStopLoss) || input.initialStopLoss >= input.entryPrice || input.riskPerShare <= 0) {
    invalidReasons.push('STOP_NOT_BELOW_ENTRY');
    return { status: 'INVALID_STOP', invalidReasons, warnings, riskTags };
  }
  const stopDistancePct = (input.entryPrice - input.initialStopLoss) / input.entryPrice;
  if (stopDistancePct < MIN_STOP_DISTANCE_PCT) {
    invalidReasons.push('STOP_TOO_CLOSE_TO_ENTRY');
    return { status: 'INVALID_STOP', invalidReasons, warnings, riskTags };
  }
  if (stopDistancePct > WIDE_STOP_DISTANCE_PCT) {
    warnings.push('WIDE_STOP_RISK');
    riskTags.push('WIDE_STOP_RISK');
  }
  if (!finitePositive(input.targetPrice1) || input.targetPrice1 <= input.entryPrice) {
    invalidReasons.push('TARGET_NOT_ABOVE_ENTRY');
    return { status: 'INVALID_TARGET', invalidReasons, warnings, riskTags };
  }
  if (input.riskReward1 < input.minRiskReward) {
    invalidReasons.push('RR_BELOW_MINIMUM');
    return { status: 'RR_INSUFFICIENT', invalidReasons, warnings, riskTags };
  }

  return { status: 'VALID', invalidReasons, warnings, riskTags };
}

export function computeTradePlan(priceSnapshot: PriceSnapshot, params: TradePlanParams = {}): TradePlan {
  const entryPrice = priceSnapshot.currentPrice ?? 0;
  const stopLossPct = params.stopLossPct ?? DEFAULT_STOP_LOSS_PCT;
  const minRiskReward = params.minRiskReward ?? DEFAULT_MIN_RISK_REWARD;
  const stopPolicy = params.stopPolicy ?? (params.technicalSupportCandidate ? 'HYBRID_SIMPLE' : 'FIXED_PCT');
  const targetPolicy = params.targetPolicy ?? (params.targetGainPct !== undefined || params.existingTargetPrice !== undefined || params.targetPrice1 !== undefined ? 'FIXED_PCT' : 'FIXED_RR');
  const fixedStop = entryPrice > 0 ? entryPrice * (1 - stopLossPct) : 0;
  const explicitStop = params.initialStopLoss ?? params.existingStopLoss;
  const initialStopLoss = selectStopLoss({
    entryPrice,
    fixedStop,
    technicalSupportCandidate: params.technicalSupportCandidate,
    explicitStop,
    stopPolicy,
  });
  const riskPerShare = Math.max(0, entryPrice - initialStopLoss);
  const explicitTarget = params.targetPrice1 ?? params.existingTargetPrice;
  const targetPrice1 = finitePositive(explicitTarget)
    ? roundPrice(explicitTarget)
    : params.targetGainPct !== undefined
      ? roundPrice(entryPrice * (1 + params.targetGainPct))
      : roundPrice(entryPrice + riskPerShare * minRiskReward);
  const rewardPerShare1 = Math.max(0, targetPrice1 - entryPrice);
  const riskReward1 = riskPerShare > 0 ? rewardPerShare1 / riskPerShare : 0;
  const targetPct1 = entryPrice > 0 ? (targetPrice1 - entryPrice) / entryPrice : 0;
  const computedAt = params.computedAt ?? new Date().toISOString();
  const derived = deriveTradePlanStatus({
    priceSnapshot,
    entryPrice,
    initialStopLoss,
    targetPrice1,
    riskPerShare,
    riskReward1,
    minRiskReward,
  });
  const tradePlanId = [
    'tp',
    priceSnapshot.priceSnapshotId,
    priceSnapshot.symbol,
    String(Date.parse(computedAt) || computedAt).replace(/[^0-9a-zA-Z_-]+/g, '_'),
  ].join('_');

  return {
    tradePlanId,
    snapshotId: params.snapshotId ?? priceSnapshot.snapshotId,
    symbol: priceSnapshot.symbol,
    side: params.side ?? 'BUY',
    priceSnapshotId: priceSnapshot.priceSnapshotId,
    entryPrice,
    initialStopLoss,
    currentStopLoss: initialStopLoss,
    targetPrice1,
    targetPrice2: null,
    stopLoss: initialStopLoss,
    targetPrice: targetPrice1,
    riskPerShare,
    rewardPerShare1,
    rewardPerShare: rewardPerShare1,
    riskReward1: Number(riskReward1.toFixed(4)),
    riskReward: Number(riskReward1.toFixed(4)),
    stopLossPct,
    targetPct1: Number(targetPct1.toFixed(4)),
    minRiskReward,
    status: derived.status,
    invalidReasons: derived.invalidReasons,
    warnings: derived.warnings,
    riskTags: derived.riskTags,
    stopPolicy,
    targetPolicy,
    tp1SellPct: params.tp1SellPct ?? DEFAULT_TP1_SELL_PCT,
    moveStopToBreakevenAfterTp1: params.moveStopToBreakevenAfterTp1 ?? true,
    breakevenBufferPct: params.breakevenBufferPct ?? DEFAULT_BREAKEVEN_BUFFER_PCT,
    computedAt,
    resolvedBy: 'TradePlanResolver',
  };
}

export function checkPriceMismatch(input: {
  referencePrice: number;
  latestPrice: number;
  maxAllowedDiffPct?: number;
}): PriceMismatchCheck {
  const maxAllowedDiffPct = input.maxAllowedDiffPct ?? 1.0;
  const diffPct = input.latestPrice > 0
    ? Math.abs(input.referencePrice - input.latestPrice) / input.latestPrice * 100
    : Number.POSITIVE_INFINITY;
  return {
    referencePrice: input.referencePrice,
    latestPrice: input.latestPrice,
    diffPct: Number(diffPct.toFixed(4)),
    maxAllowedDiffPct,
    status: diffPct > maxAllowedDiffPct || diffPct > 3 ? 'MISMATCH' : 'OK',
  };
}

export function validateTradePlanAgainstLatestPrice(input: {
  tradePlan: TradePlan;
  latestPriceSnapshot: PriceSnapshot;
  minRiskReward?: number;
  maxEntryLatestDiffPct?: number;
}): TradePlanValidationResult {
  const latestPrice = input.latestPriceSnapshot.currentPrice;
  if (!finitePositive(latestPrice)) {
    return { ok: false, reason: 'ENTRY_LATEST_MISMATCH', executionImpact: 'ORDER_WAIT_PRICE_REBUILD', learningLabel: 'PRICE_PLAN_INVALID' };
  }
  const mismatch = checkPriceMismatch({
    referencePrice: input.tradePlan.entryPrice,
    latestPrice,
    maxAllowedDiffPct: input.maxEntryLatestDiffPct ?? 1.0,
  });
  if (mismatch.status === 'MISMATCH') {
    return { ok: false, reason: 'ENTRY_LATEST_MISMATCH', executionImpact: 'ORDER_WAIT_PRICE_REBUILD', learningLabel: 'PRICE_PLAN_INVALID', mismatch };
  }
  if (input.tradePlan.initialStopLoss >= input.tradePlan.entryPrice) {
    return { ok: false, reason: 'STOP_NOT_BELOW_ENTRY', executionImpact: 'ORDER_WAIT_PRICE_REBUILD', learningLabel: 'PRICE_PLAN_INVALID', mismatch };
  }
  if (input.tradePlan.targetPrice1 <= input.tradePlan.entryPrice) {
    return { ok: false, reason: 'TARGET_NOT_ABOVE_ENTRY', executionImpact: 'ORDER_WAIT_PRICE_REBUILD', learningLabel: 'PRICE_PLAN_INVALID', mismatch };
  }
  if (input.tradePlan.initialStopLoss > latestPrice) {
    return { ok: false, reason: 'STOP_ABOVE_LATEST_PRICE', executionImpact: 'ORDER_WAIT_PRICE_REBUILD', learningLabel: 'PRICE_PLAN_INVALID', mismatch };
  }
  if (!['VALID', 'RR_INSUFFICIENT'].includes(input.tradePlan.status)) {
    return { ok: false, reason: 'TRADE_PLAN_STATUS_INVALID', executionImpact: 'ORDER_WAIT_PRICE_REBUILD', learningLabel: 'PRICE_PLAN_INVALID', mismatch };
  }
  const minRiskReward = input.minRiskReward ?? input.tradePlan.minRiskReward ?? DEFAULT_MIN_RISK_REWARD;
  if (input.tradePlan.riskReward1 < minRiskReward) {
    return { ok: false, reason: 'RR_INSUFFICIENT', executionImpact: 'ORDER_WAIT_PRICE_REBUILD', learningLabel: 'PRICE_PLAN_INVALID', mismatch };
  }
  return { ok: true, executionImpact: 'NONE', mismatch };
}

export function applyTp1BreakevenMove(input: {
  tradePlan: TradePlan;
  tp1Price?: number;
  oldStopLoss?: number;
  tp1RealizedPnL?: number;
}): BreakevenStopMove {
  const newStopLoss = roundPrice(input.tradePlan.entryPrice * (1 + input.tradePlan.breakevenBufferPct));
  return {
    tradePlanId: input.tradePlan.tradePlanId,
    symbol: input.tradePlan.symbol,
    entryPrice: input.tradePlan.entryPrice,
    tp1Price: input.tp1Price ?? input.tradePlan.targetPrice1,
    oldStopLoss: input.oldStopLoss ?? input.tradePlan.currentStopLoss,
    newStopLoss,
    tp1RealizedPnL: input.tp1RealizedPnL,
    stopMovedToBreakeven: true,
  };
}

export function applySimpleTrailingStop(input: {
  entryPrice: number;
  currentStopLoss: number;
  latestPrice: number;
  trailingPct?: number;
}): SimpleTrailingStopResult {
  const trailingPct = input.trailingPct ?? DEFAULT_TRAILING_PCT;
  const trailingStop = roundPrice(input.latestPrice * (1 - trailingPct));
  const floorStop = Math.max(input.currentStopLoss, input.entryPrice);
  const currentStopLoss = Math.max(input.currentStopLoss, floorStop, trailingStop);
  return {
    currentStopLoss,
    trailingStop,
    trailingActivated: currentStopLoss > input.currentStopLoss,
  };
}

export function attachTradePlanToPositionState<T extends Record<string, unknown>>(
  position: T,
  tradePlan: TradePlan,
): T & {
  tradePlanId: string;
  priceSnapshotId: string;
  entryPrice: number;
  initialStopLoss: number;
  currentStopLoss: number;
  targetPrice1: number;
  riskReward1: number;
  tp1SellPct: number;
  moveStopToBreakevenAfterTp1: boolean;
} {
  return {
    ...position,
    tradePlanId: tradePlan.tradePlanId,
    priceSnapshotId: tradePlan.priceSnapshotId,
    entryPrice: tradePlan.entryPrice,
    initialStopLoss: tradePlan.initialStopLoss,
    currentStopLoss: tradePlan.currentStopLoss,
    targetPrice1: tradePlan.targetPrice1,
    riskReward1: tradePlan.riskReward1,
    tp1SellPct: tradePlan.tp1SellPct,
    moveStopToBreakevenAfterTp1: tradePlan.moveStopToBreakevenAfterTp1,
  };
}

function kv(key: string, value: unknown): string {
  return `${key}=${value === undefined || value === null ? 'none' : String(value)}`;
}

export function formatPriceSnapshotResolvedLog(input: {
  purpose: PriceSnapshotPurpose;
  snapshot: PriceSnapshot;
}): string {
  const s = input.snapshot;
  return [
    '[PRICE_SNAPSHOT_RESOLVED]',
    kv('snapshotId', s.snapshotId),
    kv('priceSnapshotId', s.priceSnapshotId),
    kv('symbol', s.symbol),
    kv('purpose', input.purpose),
    kv('currentPrice', s.currentPrice),
    kv('source', s.source),
    kv('confidence', s.confidence),
    kv('ageSec', s.ageSec),
    kv('priceUsableForDecision', s.priceUsableForDecision),
    kv('priceUsableForExecution', s.priceUsableForExecution),
    kv('priceUsableForShadowFill', s.priceUsableForShadowFill),
  ].join(' ');
}

export function formatTradePlanComputedFromPriceSnapshotLog(plan: TradePlan): string {
  return [
    '[TRADE_PLAN_COMPUTED_FROM_PRICE_SNAPSHOT]',
    kv('symbol', plan.symbol),
    kv('priceSnapshotId', plan.priceSnapshotId),
    kv('entryPrice', plan.entryPrice),
    kv('stopLoss', plan.initialStopLoss),
    kv('targetPrice', plan.targetPrice1),
    kv('riskReward', plan.riskReward1),
    kv('computedAt', plan.computedAt),
  ].join(' ');
}

export function formatTradePlanResolvedLog(plan: TradePlan): string {
  return [
    '[TRADE_PLAN_RESOLVED]',
    kv('snapshotId', plan.snapshotId),
    kv('priceSnapshotId', plan.priceSnapshotId),
    kv('tradePlanId', plan.tradePlanId),
    kv('symbol', plan.symbol),
    kv('entryPrice', plan.entryPrice),
    kv('initialStopLoss', plan.initialStopLoss),
    kv('targetPrice1', plan.targetPrice1),
    kv('riskReward1', plan.riskReward1),
    kv('status', plan.status),
    kv('invalidReasons', `[${plan.invalidReasons.join(',') || 'none'}]`),
    "resolvedBy='TradePlanResolver'",
  ].join(' ');
}

export function formatRrInsufficientObservedLog(plan: TradePlan): string {
  return [
    '[RR_INSUFFICIENT_OBSERVED]',
    kv('tradePlanId', plan.tradePlanId),
    kv('symbol', plan.symbol),
    kv('riskReward1', plan.riskReward1),
    kv('minRiskReward', plan.minRiskReward),
    "decision='WATCH_RR_INSUFFICIENT'",
    "executionImpact='NONE'",
    'shadowLearning=true',
  ].join(' ');
}

export function formatStopMovedToBreakevenAfterTp1Log(input: BreakevenStopMove & { positionId?: string }): string {
  return [
    '[STOP_MOVED_TO_BREAKEVEN_AFTER_TP1]',
    kv('positionId', input.positionId),
    kv('symbol', input.symbol),
    kv('entryPrice', input.entryPrice),
    kv('tp1Price', input.tp1Price),
    kv('oldStopLoss', input.oldStopLoss),
    kv('newStopLoss', input.newStopLoss),
    kv('tp1RealizedPnL', input.tp1RealizedPnL),
  ].join(' ');
}

export function formatPositionTradePlanAttachedLog(input: {
  positionId?: string;
  symbol: string;
  tradePlan: TradePlan;
}): string {
  return [
    '[POSITION_TRADE_PLAN_ATTACHED]',
    kv('positionId', input.positionId),
    kv('symbol', input.symbol),
    kv('tradePlanId', input.tradePlan.tradePlanId),
    kv('priceSnapshotId', input.tradePlan.priceSnapshotId),
    kv('entryPrice', input.tradePlan.entryPrice),
    kv('initialStopLoss', input.tradePlan.initialStopLoss),
    kv('targetPrice1', input.tradePlan.targetPrice1),
    kv('riskReward1', input.tradePlan.riskReward1),
  ].join(' ');
}

export function formatShadowFillPriceConfirmedLog(input: {
  symbol: string;
  priceSnapshot: PriceSnapshot;
  fillPrice: number;
}): string {
  return [
    '[SHADOW_FILL_PRICE_CONFIRMED]',
    kv('symbol', input.symbol),
    kv('priceSnapshotId', input.priceSnapshot.priceSnapshotId),
    kv('fillPrice', input.fillPrice),
    kv('source', input.priceSnapshot.source),
    kv('confidence', input.priceSnapshot.confidence),
    kv('ageSec', input.priceSnapshot.ageSec),
  ].join(' ');
}

export function formatPriceNotUsableForExecutionLog(input: {
  symbol: string;
  purpose: PriceSnapshotPurpose;
  snapshot: PriceSnapshot;
  reason?: string;
}): string {
  return [
    '[PRICE_NOT_USABLE_FOR_EXECUTION]',
    kv('symbol', input.symbol),
    kv('purpose', input.purpose),
    kv('source', input.snapshot.source),
    kv('confidence', input.snapshot.confidence),
    kv('ageSec', input.snapshot.ageSec),
    kv('reason', input.reason ?? input.snapshot.reason ?? 'PRICE_NOT_USABLE'),
    "executionImpact='ORDER_WAIT_PRICE_VALID'",
  ].join(' ');
}

export function formatPriceMismatchBlockedFillLog(input: {
  symbol: string;
  mismatch: PriceMismatchCheck;
}): string {
  return [
    '[PRICE_MISMATCH_BLOCKED_FILL]',
    kv('symbol', input.symbol),
    kv('referencePrice', input.mismatch.referencePrice),
    kv('latestPrice', input.mismatch.latestPrice),
    kv('diffPct', input.mismatch.diffPct),
    kv('maxAllowedDiffPct', input.mismatch.maxAllowedDiffPct),
    "executionImpact='ORDER_WAIT_PRICE_VALID'",
    'shadowLearning=true',
  ].join(' ');
}

export function formatTradePlanPriceValidationFailedLog(input: {
  symbol: string;
  tradePlan: TradePlan;
  latestPriceSnapshot: PriceSnapshot;
  reason?: string;
}): string {
  return [
    '[TRADE_PLAN_PRICE_VALIDATION_FAILED]',
    kv('symbol', input.symbol),
    kv('entryPrice', input.tradePlan.entryPrice),
    kv('latestPrice', input.latestPriceSnapshot.currentPrice),
    kv('stopLoss', input.tradePlan.initialStopLoss),
    kv('targetPrice', input.tradePlan.targetPrice1),
    kv('reason', input.reason ?? 'PRICE_PLAN_INVALID'),
    "executionImpact='ORDER_WAIT_PRICE_REBUILD'",
    'shadowLearning=true',
  ].join(' ');
}
