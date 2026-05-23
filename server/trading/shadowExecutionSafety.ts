import { fetchCurrentPrice } from '../clients/kisClient.js';
import { getRealtimeQuote } from '../clients/kisStreamClient.js';
import {
  appendShadowLog,
  getRemainingQty,
  isActiveFill,
  type ServerShadowTrade,
} from '../persistence/shadowTradeRepo.js';
import { getOpenPositions } from '../persistence/shadowPositionLedger.js';
import { REGIME_CONFIGS } from '../../src/services/quant/regimeEngine.js';

export type ShadowQuoteConfidence = 'VERIFIED' | 'DEGRADED' | 'STALE' | 'MISSING';

export type ShadowQuotePriceBasis =
  | 'REALTIME_LAST'
  | 'BID_ASK_MID'
  | 'KIS_CURRENT'
  | 'KRX_CURRENT';

export type ShadowQuoteSource =
  | 'KIS_WS'
  | 'KIS_API'
  | 'KRX_CURRENT'
  | 'FALLBACK'
  | 'CACHE'
  | 'STALE'
  | 'MISSING';

export type ShadowExecutionLearningTag =
  | 'CASE_BAD_SHADOW_FILL_PRICE'
  | 'CASE_STALE_QUOTE_EXECUTION_BLOCKED'
  | 'CASE_ENTRY_ALREADY_BELOW_STOP'
  | 'CASE_POSITION_QTY_MISMATCH'
  | 'CASE_SLOT_FULL_FILL_BLOCKED'
  | 'CASE_STOP_ALERT_DUPLICATE_SUPPRESSED'
  | 'CASE_STOP_BLOCKED_UNVERIFIED_ENTRY_PRICE';

export interface AuthoritativeQuoteSnapshot {
  symbol: string;
  currentPrice: number;
  bid?: number;
  ask?: number;
  lastTradePrice?: number;
  quoteSource: ShadowQuoteSource | string;
  quoteAsOf: string;
  snapshotId: string;
  marketSession?: string;
  isStale: boolean;
  staleMs: number;
  confidence: ShadowQuoteConfidence;
  providerIssue?: string | null;
  tradingHalted?: boolean;
  priceBasis: ShadowQuotePriceBasis;
}

export interface ResolveAuthoritativeQuoteInput {
  symbol: string;
  snapshotId?: string;
  marketSession?: string;
  now?: Date;
}

export type ShadowAuthoritativeQuoteResolver = (
  input: ResolveAuthoritativeQuoteInput,
) => Promise<AuthoritativeQuoteSnapshot> | AuthoritativeQuoteSnapshot;

export type ShadowFillRejectReason =
  | 'QUOTE_NOT_VERIFIED_FOR_EXECUTION'
  | 'QUOTE_SOURCE_NOT_EXECUTABLE'
  | 'STALE_QUOTE_FOR_EXECUTION'
  | 'TRADING_HALTED'
  | 'BAD_FILL_PRICE_DEVIATION'
  | 'NO_EXECUTABLE_FILL_PRICE'
  | 'SHADOW_SLOT_FULL_AT_FILL_TIME'
  | 'SECTOR_LIMIT_EXCEEDED_AT_FILL_TIME'
  | 'STOP_BLOCKED_UNVERIFIED_ENTRY_PRICE'
  | 'ENTRY_ALREADY_BELOW_STOP'
  | 'POSITION_QTY_MISMATCH';

export interface ShadowFillValidationAccepted {
  ok: true;
  fillPrice: number;
  currentPrice: number;
  proposedFillPrice?: number;
  deviationPct: number;
  quote: AuthoritativeQuoteSnapshot;
  maxFillDeviationPct: number;
}

export interface ShadowFillValidationRejected {
  ok: false;
  reason: ShadowFillRejectReason;
  learningTag: ShadowExecutionLearningTag;
  fillPrice?: number;
  currentPrice?: number;
  proposedFillPrice?: number;
  deviationPct?: number;
  quote?: AuthoritativeQuoteSnapshot;
  maxFillDeviationPct?: number;
}

export type ShadowFillValidationResult =
  | ShadowFillValidationAccepted
  | ShadowFillValidationRejected;

export interface ShadowSlotValidationResult {
  ok: boolean;
  reason?: 'SHADOW_SLOT_FULL_AT_FILL_TIME' | 'SECTOR_LIMIT_EXCEEDED_AT_FILL_TIME';
  learningTag?: 'CASE_SLOT_FULL_FILL_BLOCKED';
  currentOpenPositions: number;
  maxPositions: number;
  sameSectorCount: number;
  sectorLimit?: number;
}

export interface ShadowQuantityConsistencyResult {
  ok: boolean;
  reason?: 'POSITION_QTY_MISMATCH';
  learningTag?: 'CASE_POSITION_QTY_MISMATCH';
  positionId: string;
  symbol: string;
  positionQty: number;
  ledgerQty: number;
}

const OPERATOR_DIAG_COOLDOWN_MS = 10 * 60 * 1000;
const operatorDiagnosticLastSent = new Map<string, number>();

export function isShadowExecutionSafeModeEnabled(): boolean {
  return process.env.SHADOW_EXECUTION_SAFE_MODE === 'true';
}

export function __resetShadowExecutionSafetyForTests(): void {
  operatorDiagnosticLastSent.clear();
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function parseIsoMs(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function kstMinutesSinceMidnight(now: Date): number {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
}

export function shadowExecutionQuoteTtlMs(now: Date): number {
  const minutes = kstMinutesSinceMidnight(now);
  return minutes >= 9 * 60 && minutes < 9 * 60 + 10 ? 1_500 : 3_000;
}

export async function resolveAuthoritativeQuoteForShadowFill(
  input: ResolveAuthoritativeQuoteInput,
): Promise<AuthoritativeQuoteSnapshot> {
  const now = input.now ?? new Date();
  const snapshotId = input.snapshotId ?? `quote_${input.symbol}_${now.getTime()}`;

  const realtime = getRealtimeQuote(input.symbol);
  if (realtime && finitePositive(realtime.price)) {
    const staleMs = Math.max(0, now.getTime() - realtime.updatedAt);
    return {
      symbol: input.symbol,
      currentPrice: realtime.price,
      lastTradePrice: realtime.price,
      quoteSource: 'KIS_WS',
      quoteAsOf: new Date(realtime.updatedAt).toISOString(),
      snapshotId,
      marketSession: input.marketSession,
      isStale: staleMs > shadowExecutionQuoteTtlMs(now),
      staleMs,
      confidence: 'VERIFIED',
      providerIssue: null,
      tradingHalted: false,
      priceBasis: 'REALTIME_LAST',
    };
  }

  try {
    const price = await fetchCurrentPrice(input.symbol);
    if (finitePositive(price)) {
      return {
        symbol: input.symbol,
        currentPrice: price,
        lastTradePrice: price,
        quoteSource: 'KIS_API',
        quoteAsOf: now.toISOString(),
        snapshotId,
        marketSession: input.marketSession,
        isStale: false,
        staleMs: 0,
        confidence: 'VERIFIED',
        providerIssue: null,
        tradingHalted: false,
        priceBasis: 'KIS_CURRENT',
      };
    }
  } catch (error) {
    return missingQuote(input, now, snapshotId, error);
  }

  return missingQuote(input, now, snapshotId);
}

function missingQuote(
  input: ResolveAuthoritativeQuoteInput,
  now: Date,
  snapshotId: string,
  error?: unknown,
): AuthoritativeQuoteSnapshot {
  return {
    symbol: input.symbol,
    currentPrice: 0,
    quoteSource: 'MISSING',
    quoteAsOf: now.toISOString(),
    snapshotId,
    marketSession: input.marketSession,
    isStale: true,
    staleMs: Number.POSITIVE_INFINITY,
    confidence: 'MISSING',
    providerIssue: error instanceof Error ? error.message : error ? String(error) : 'NO_EXECUTABLE_QUOTE',
    tradingHalted: false,
    priceBasis: 'KIS_CURRENT',
  };
}

function isExecutableQuoteSource(source: string): boolean {
  const upper = source.toUpperCase();
  return !upper.includes('FALLBACK')
    && !upper.includes('CACHE')
    && !upper.includes('STALE')
    && !upper.includes('DAILY_CLOSE')
    && !upper.includes('PREVIOUS_CLOSE')
    && !upper.includes('PREV_CLOSE')
    && !upper.includes('ADJUSTED')
    && !upper.includes('HISTORICAL')
    && !upper.includes('YAHOO')
    && !upper.includes('OHLCV')
    && !upper.includes('NULL')
    && !upper.includes('GUESSED')
    && !upper.includes('ESTIMATED')
    && !upper.includes('AI_');
}

function spreadPct(bid: number, ask: number): number {
  const mid = (bid + ask) / 2;
  return mid > 0 ? ((ask - bid) / mid) * 100 : Number.POSITIVE_INFINITY;
}

function maxDeviationPctForQuote(quote: AuthoritativeQuoteSnapshot): number {
  if (finitePositive(quote.bid) && finitePositive(quote.ask) && spreadPct(quote.bid, quote.ask) > 0.7) {
    return 1.2;
  }
  return 0.7;
}

function deriveExecutableFillPrice(
  quote: AuthoritativeQuoteSnapshot,
  side: 'BUY' | 'SELL',
): number | null {
  if (finitePositive(quote.bid) && finitePositive(quote.ask)) {
    if (quote.ask < quote.bid) return null;
    if (spreadPct(quote.bid, quote.ask) <= 1.2) {
      return side === 'BUY' ? quote.ask : quote.bid;
    }
  }
  return quote.confidence === 'VERIFIED' && finitePositive(quote.currentPrice)
    ? quote.currentPrice
    : null;
}

function deviationPct(price: number, currentPrice: number): number {
  return Math.abs(price - currentPrice) / currentPrice * 100;
}

export function validateShadowFillExecution(input: {
  quote: AuthoritativeQuoteSnapshot;
  proposedFillPrice?: number;
  side?: 'BUY' | 'SELL';
  now?: Date;
}): ShadowFillValidationResult {
  const now = input.now ?? new Date();
  const quote = input.quote;
  const side = input.side ?? 'BUY';

  if (quote.tradingHalted) {
    return { ok: false, reason: 'TRADING_HALTED', learningTag: 'CASE_STALE_QUOTE_EXECUTION_BLOCKED', quote };
  }
  if (quote.confidence !== 'VERIFIED') {
    return {
      ok: false,
      reason: 'QUOTE_NOT_VERIFIED_FOR_EXECUTION',
      learningTag: 'CASE_STALE_QUOTE_EXECUTION_BLOCKED',
      quote,
      currentPrice: quote.currentPrice,
      proposedFillPrice: input.proposedFillPrice,
    };
  }
  if (!isExecutableQuoteSource(String(quote.quoteSource))) {
    return {
      ok: false,
      reason: 'QUOTE_SOURCE_NOT_EXECUTABLE',
      learningTag: 'CASE_STALE_QUOTE_EXECUTION_BLOCKED',
      quote,
      currentPrice: quote.currentPrice,
      proposedFillPrice: input.proposedFillPrice,
    };
  }

  const quoteAsOfMs = parseIsoMs(quote.quoteAsOf);
  const staleMs = quoteAsOfMs === null ? Number.POSITIVE_INFINITY : Math.max(0, now.getTime() - quoteAsOfMs);
  const ttlMs = shadowExecutionQuoteTtlMs(now);
  if (quote.isStale || staleMs > ttlMs) {
    return {
      ok: false,
      reason: 'STALE_QUOTE_FOR_EXECUTION',
      learningTag: 'CASE_STALE_QUOTE_EXECUTION_BLOCKED',
      quote: { ...quote, staleMs, isStale: true },
      currentPrice: quote.currentPrice,
      proposedFillPrice: input.proposedFillPrice,
    };
  }
  if (!finitePositive(quote.currentPrice)) {
    return {
      ok: false,
      reason: 'NO_EXECUTABLE_FILL_PRICE',
      learningTag: 'CASE_STALE_QUOTE_EXECUTION_BLOCKED',
      quote,
      currentPrice: quote.currentPrice,
      proposedFillPrice: input.proposedFillPrice,
    };
  }

  const maxFillDeviationPct = maxDeviationPctForQuote(quote);
  if (finitePositive(input.proposedFillPrice)) {
    const proposedDeviation = deviationPct(input.proposedFillPrice, quote.currentPrice);
    if (proposedDeviation > maxFillDeviationPct || proposedDeviation > 3) {
      return {
        ok: false,
        reason: 'BAD_FILL_PRICE_DEVIATION',
        learningTag: 'CASE_BAD_SHADOW_FILL_PRICE',
        quote,
        fillPrice: input.proposedFillPrice,
        currentPrice: quote.currentPrice,
        proposedFillPrice: input.proposedFillPrice,
        deviationPct: proposedDeviation,
        maxFillDeviationPct,
      };
    }
  }

  const fillPrice = deriveExecutableFillPrice(quote, side);
  if (!finitePositive(fillPrice)) {
    return {
      ok: false,
      reason: 'NO_EXECUTABLE_FILL_PRICE',
      learningTag: 'CASE_STALE_QUOTE_EXECUTION_BLOCKED',
      quote,
      currentPrice: quote.currentPrice,
      proposedFillPrice: input.proposedFillPrice,
    };
  }

  const actualDeviation = deviationPct(fillPrice, quote.currentPrice);
  if (actualDeviation > maxFillDeviationPct || actualDeviation > 3) {
    return {
      ok: false,
      reason: 'BAD_FILL_PRICE_DEVIATION',
      learningTag: 'CASE_BAD_SHADOW_FILL_PRICE',
      quote,
      fillPrice,
      currentPrice: quote.currentPrice,
      proposedFillPrice: input.proposedFillPrice,
      deviationPct: actualDeviation,
      maxFillDeviationPct,
    };
  }

  return {
    ok: true,
    fillPrice,
    currentPrice: quote.currentPrice,
    proposedFillPrice: input.proposedFillPrice,
    deviationPct: actualDeviation,
    quote,
    maxFillDeviationPct,
  };
}

function openTradesFromMemory(trades: ServerShadowTrade[], excludingTradeId?: string): ServerShadowTrade[] {
  return trades.filter((trade) => {
    if (trade.id === excludingTradeId) return false;
    if (!['PENDING', 'ORDER_SUBMITTED', 'PARTIALLY_FILLED', 'ACTIVE', 'EUPHORIA_PARTIAL'].includes(trade.status)) {
      return false;
    }
    const hasBuyFill = (trade.fills ?? []).some((fill) => fill.type === 'BUY' && isActiveFill(fill));
    return hasBuyFill && getRemainingQty(trade) > 0;
  });
}

export function resolveShadowMaxPositions(regime?: string, explicitMaxPositions?: number): number {
  if (Number.isFinite(explicitMaxPositions) && explicitMaxPositions !== undefined && explicitMaxPositions > 0) {
    return Math.floor(explicitMaxPositions);
  }
  const envMax = Number(process.env.SHADOW_MAX_POSITIONS ?? process.env.MAX_CONVICTION_POSITIONS);
  if (Number.isFinite(envMax) && envMax > 0) return Math.floor(envMax);
  const regimeMax = regime && Object.prototype.hasOwnProperty.call(REGIME_CONFIGS, regime)
    ? REGIME_CONFIGS[regime as keyof typeof REGIME_CONFIGS]?.maxPositions
    : undefined;
  return Number.isFinite(regimeMax) && regimeMax !== undefined && regimeMax > 0
    ? Math.floor(regimeMax)
    : 8;
}

export function validateSlotBeforeShadowFill(input: {
  symbol: string;
  sector?: string;
  regime?: string;
  maxPositions?: number;
  allTrades?: ServerShadowTrade[];
  excludingTradeId?: string;
}): ShadowSlotValidationResult {
  const maxPositions = resolveShadowMaxPositions(input.regime, input.maxPositions);
  const openTrades = input.allTrades
    ? openTradesFromMemory(input.allTrades, input.excludingTradeId)
    : getOpenPositions().map((entry) => entry.trade);
  const currentOpenPositions = openTrades.length;
  const sameSectorCount = input.sector
    ? openTrades.filter((trade) => trade.sector === input.sector).length
    : 0;
  const sectorLimitRaw = Number(process.env.SHADOW_SECTOR_LIMIT);
  const sectorLimit = Number.isFinite(sectorLimitRaw) && sectorLimitRaw > 0
    ? Math.floor(sectorLimitRaw)
    : undefined;

  if (currentOpenPositions >= maxPositions) {
    return {
      ok: false,
      reason: 'SHADOW_SLOT_FULL_AT_FILL_TIME',
      learningTag: 'CASE_SLOT_FULL_FILL_BLOCKED',
      currentOpenPositions,
      maxPositions,
      sameSectorCount,
      sectorLimit,
    };
  }
  if (sectorLimit !== undefined && input.sector && sameSectorCount >= sectorLimit) {
    return {
      ok: false,
      reason: 'SECTOR_LIMIT_EXCEEDED_AT_FILL_TIME',
      learningTag: 'CASE_SLOT_FULL_FILL_BLOCKED',
      currentOpenPositions,
      maxPositions,
      sameSectorCount,
      sectorLimit,
    };
  }
  return {
    ok: true,
    currentOpenPositions,
    maxPositions,
    sameSectorCount,
    sectorLimit,
  };
}

export function verifyShadowPositionQuantityForAutoExit(
  trade: ServerShadowTrade,
): ShadowQuantityConsistencyResult {
  const ledgerQty = getRemainingQty(trade);
  const positionQty = Number.isFinite(trade.quantity) ? trade.quantity : 0;
  const base = {
    positionId: trade.id,
    symbol: trade.stockCode,
    positionQty,
    ledgerQty,
  };
  if (['ACTIVE', 'PARTIALLY_FILLED', 'EUPHORIA_PARTIAL'].includes(trade.status) && positionQty !== ledgerQty) {
    return {
      ok: false,
      reason: 'POSITION_QTY_MISMATCH',
      learningTag: 'CASE_POSITION_QTY_MISMATCH',
      ...base,
    };
  }
  return { ok: true, ...base };
}

export function isStopBlockedByUnverifiedEntry(trade: ServerShadowTrade): boolean {
  return isShadowExecutionSafeModeEnabled()
    && trade.mode === 'SHADOW'
    && trade.entryPriceValidationStatus !== 'VERIFIED';
}

export function markShadowTradeQuarantined(input: {
  trade: ServerShadowTrade;
  reason: 'ENTRY_ALREADY_BELOW_STOP' | 'STOP_BLOCKED_UNVERIFIED_ENTRY_PRICE' | 'POSITION_QTY_MISMATCH';
  learningTag: ShadowExecutionLearningTag;
  now?: Date;
  context?: Record<string, unknown>;
}): void {
  const now = input.now ?? new Date();
  if (input.reason === 'POSITION_QTY_MISMATCH') {
    input.trade.status = 'INCONSISTENT';
  } else {
    input.trade.status = 'QUARANTINED_BAD_ENTRY';
  }
  input.trade.needsManualReview = true;
  input.trade.manualReviewReason = input.reason;
  input.trade.learningTag = input.learningTag;
  input.trade.executionImpact = 'NONE';
  input.trade.liveOrderSent = false;
  input.trade.quarantinedAt = now.toISOString();
  input.trade.quarantineReason = input.reason;
  appendShadowExecutionLearningCase({
    timestamp: now.toISOString(),
    symbol: input.trade.stockCode,
    positionId: input.trade.id,
    tradeId: input.trade.id,
    learningTag: input.learningTag,
    reason: input.reason,
    marketSession: input.trade.entryMarketSession,
    regime: input.trade.entryRegime,
    executionImpact: 'NONE',
    shadowLearning: true,
    ...input.context,
  });
}

export function appendShadowExecutionLearningCase(entry: Record<string, unknown>): void {
  try {
    appendShadowLog({
      event: 'SHADOW_EXECUTION_LEARNING_CASE',
      ...entry,
      executionImpact: 'NONE',
      shadowLearning: true,
    });
  } catch {
    // Learning diagnostics must never interrupt trading loops.
  }
}

export function appendShadowExecutionRejected(entry: Record<string, unknown>): void {
  try {
    appendShadowLog({
      event: 'SHADOW_EXECUTION_REJECTED',
      ...entry,
      executionImpact: 'NONE',
      shadowLearning: true,
    });
  } catch {
    // Rejection audit is best-effort.
  }
}

export function emitShadowExecutionOperatorDiagnosticOnce(input: {
  symbol: string;
  reason: string;
  now?: Date;
  payload: Record<string, unknown>;
}): boolean {
  const now = input.now ?? new Date();
  const key = `${input.symbol}:${input.reason}`;
  const last = operatorDiagnosticLastSent.get(key) ?? 0;
  if (now.getTime() - last < OPERATOR_DIAG_COOLDOWN_MS) return false;
  operatorDiagnosticLastSent.set(key, now.getTime());
  try {
    appendShadowLog({
      event: 'SHADOW_OPERATOR_DIAGNOSTIC',
      symbol: input.symbol,
      reason: input.reason,
      ...input.payload,
      executionImpact: 'NONE',
      shadowLearning: true,
    });
  } catch {
    // Diagnostic persistence is best-effort.
  }
  return true;
}
