// @responsibility Price Snapshot SSOT for decision, execution, shadow fill, TradePlan, and display.

import { fetchCurrentPrice } from '../clients/kisClient.js';
import { getRealtimeQuote } from '../clients/kisStreamClient.js';
import type { AuthoritativeQuoteSnapshot } from './shadowExecutionSafety.js';

export type PriceSource =
  | 'KIS_REALTIME_QUOTE'
  | 'KIS_DELAYED_QUOTE'
  | 'KIS_OHLCV_LAST'
  | 'YAHOO_OHLCV_LAST'
  | 'MANUAL_INPUT'
  | 'FALLBACK_PREV_CLOSE'
  | 'UNKNOWN';

export type PriceConfidence =
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

export interface ResolvePriceSnapshotInput {
  symbol: string;
  purpose: PriceSnapshotPurpose;
  marketSession: string;
  snapshotId?: string;
  now?: Date;
  quote?: AuthoritativeQuoteSnapshot;
}

export interface TradePlan {
  symbol: string;
  priceSnapshotId: string;
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  riskPerShare: number;
  rewardPerShare: number;
  riskReward: number;
  computedAt: string;
}

export interface TradePlanParams {
  stopLossPct?: number;
  targetGainPct?: number;
  minRiskReward?: number;
  existingStopLoss?: number | null;
  existingTargetPrice?: number | null;
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
  reason?: 'STOP_ABOVE_LATEST_PRICE' | 'STOP_NOT_BELOW_ENTRY' | 'TARGET_NOT_ABOVE_ENTRY' | 'RR_INSUFFICIENT' | 'ENTRY_LATEST_MISMATCH';
  executionImpact: 'NONE' | 'ORDER_WAIT_PRICE_REBUILD';
  learningLabel?: 'PRICE_PLAN_INVALID';
  mismatch?: PriceMismatchCheck;
}

const DEFAULT_SHADOW_FILL_AGE_SEC = 60;
const DEFAULT_QUOTE_AGE_SEC = 30;

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
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

export async function resolvePriceSnapshot(input: ResolvePriceSnapshotInput): Promise<PriceSnapshot> {
  const now = input.now ?? new Date();
  if (input.quote) {
    return priceSnapshotFromAuthoritativeQuote({
      quote: input.quote,
      purpose: input.purpose,
      now,
      marketSession: input.marketSession,
    });
  }

  const realtime = getRealtimeQuote(input.symbol);
  if (realtime && finitePositive(realtime.price)) {
    return buildPriceSnapshot({
      snapshotId: input.snapshotId ?? `quote_${input.symbol}_${realtime.updatedAt}`,
      symbol: input.symbol,
      marketSession: input.marketSession,
      now,
      currentPrice: realtime.price,
      lastTradePrice: realtime.price,
      source: 'KIS_REALTIME_QUOTE',
      confidence: 'REALTIME',
      asOf: new Date(realtime.updatedAt).toISOString(),
    });
  }

  try {
    const price = await fetchCurrentPrice(input.symbol);
    return buildPriceSnapshot({
      snapshotId: input.snapshotId ?? `quote_${input.symbol}_${now.getTime()}`,
      symbol: input.symbol,
      marketSession: input.marketSession,
      now,
      currentPrice: finitePositive(price) ? price : null,
      lastTradePrice: finitePositive(price) ? price : null,
      source: 'KIS_DELAYED_QUOTE',
      confidence: finitePositive(price) ? 'DELAYED_VALID' : 'MISSING',
      asOf: now.toISOString(),
    });
  } catch (error) {
    return buildPriceSnapshot({
      snapshotId: input.snapshotId ?? `quote_${input.symbol}_${now.getTime()}`,
      symbol: input.symbol,
      marketSession: input.marketSession,
      now,
      currentPrice: null,
      source: 'UNKNOWN',
      confidence: 'MISSING',
      asOf: now.toISOString(),
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

export function resolveEntryPriceFromSnapshot(snapshot: PriceSnapshot, purpose: 'LIVE_ORDER' | 'SHADOW_FILL' | 'COUNTERFACTUAL'): number | null {
  if (purpose === 'SHADOW_FILL') return snapshot.priceUsableForShadowFill ? snapshot.currentPrice : null;
  if (purpose === 'LIVE_ORDER') return snapshot.priceUsableForExecution ? snapshot.currentPrice : null;
  return snapshot.priceUsableForDecision ? snapshot.currentPrice : null;
}

export function computeTradePlan(priceSnapshot: PriceSnapshot, params: TradePlanParams = {}): TradePlan {
  const entryPrice = priceSnapshot.currentPrice ?? 0;
  const stopLossPct = params.stopLossPct ?? 0.07;
  const targetGainPct = params.targetGainPct ?? 0.14;
  const stopLoss = finitePositive(params.existingStopLoss) && (params.existingStopLoss as number) < entryPrice
    ? Math.round(params.existingStopLoss as number)
    : Math.round(entryPrice * (1 - stopLossPct));
  const targetPrice = finitePositive(params.existingTargetPrice) && (params.existingTargetPrice as number) > entryPrice
    ? Math.round(params.existingTargetPrice as number)
    : Math.round(entryPrice * (1 + targetGainPct));
  const riskPerShare = Math.max(0, entryPrice - stopLoss);
  const rewardPerShare = Math.max(0, targetPrice - entryPrice);
  const riskReward = riskPerShare > 0 ? rewardPerShare / riskPerShare : 0;
  return {
    symbol: priceSnapshot.symbol,
    priceSnapshotId: priceSnapshot.priceSnapshotId,
    entryPrice,
    stopLoss,
    targetPrice,
    riskPerShare,
    rewardPerShare,
    riskReward: Number(riskReward.toFixed(4)),
    computedAt: params.computedAt ?? new Date().toISOString(),
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
  if (input.tradePlan.stopLoss >= input.tradePlan.entryPrice) {
    return { ok: false, reason: 'STOP_NOT_BELOW_ENTRY', executionImpact: 'ORDER_WAIT_PRICE_REBUILD', learningLabel: 'PRICE_PLAN_INVALID', mismatch };
  }
  if (input.tradePlan.targetPrice <= input.tradePlan.entryPrice) {
    return { ok: false, reason: 'TARGET_NOT_ABOVE_ENTRY', executionImpact: 'ORDER_WAIT_PRICE_REBUILD', learningLabel: 'PRICE_PLAN_INVALID', mismatch };
  }
  if (input.tradePlan.stopLoss > latestPrice) {
    return { ok: false, reason: 'STOP_ABOVE_LATEST_PRICE', executionImpact: 'ORDER_WAIT_PRICE_REBUILD', learningLabel: 'PRICE_PLAN_INVALID', mismatch };
  }
  const minRiskReward = input.minRiskReward ?? 1;
  if (input.tradePlan.riskReward < minRiskReward) {
    return { ok: false, reason: 'RR_INSUFFICIENT', executionImpact: 'ORDER_WAIT_PRICE_REBUILD', learningLabel: 'PRICE_PLAN_INVALID', mismatch };
  }
  return { ok: true, executionImpact: 'NONE', mismatch };
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
    kv('stopLoss', plan.stopLoss),
    kv('targetPrice', plan.targetPrice),
    kv('riskReward', plan.riskReward),
    kv('computedAt', plan.computedAt),
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
    kv('stopLoss', input.tradePlan.stopLoss),
    kv('targetPrice', input.tradePlan.targetPrice),
    kv('reason', input.reason ?? 'PRICE_PLAN_INVALID'),
    "executionImpact='ORDER_WAIT_PRICE_REBUILD'",
    'shadowLearning=true',
  ].join(' ');
}
