// @responsibility Gate3 last-trigger and entry price readiness helpers.

import {
  buildGate3RrrInput,
  type Gate3RrrInput,
  type Gate3RrrStatus,
} from './gate3RrrBuilder.js';
import {
  buildGate3PriceConfirmation,
  type Gate3PriceConfirmation,
} from './gate3PriceConfirmation.js';
import {
  buildGate3VolumeConfirmation,
  type Gate3VolumeConfirmation,
} from './gate3VolumeConfirmation.js';

type Gate3LastTriggerStatus =
  | 'FIRED'
  | 'THRESHOLD_NOT_MET'
  | 'DATA_UNAVAILABLE'
  | 'PROVIDER_DEGRADED'
  | 'SANITY_REJECTED';

type Gate3EntryPriceFreshness = 'VERIFIED' | 'FRESH' | 'STALE' | 'MISSING';
type Gate3EntryPriceSource =
  | 'KIS_REALTIME'
  | 'KIS_INQUIRE_PRICE'
  | 'KIS_WS'
  | 'YAHOO'
  | 'CACHE'
  | 'UNKNOWN';
export type Gate3ExecutionImpact = 'NONE' | 'DIAGNOSTIC_ONLY' | 'LIVE_BUY_BLOCKED_ONLY';
type Gate3FalseBreakoutRisk = 'LOW' | 'WATCH' | 'HIGH' | 'MISSING' | 'UNKNOWN';

export interface Gate3EntryPriceGuardDiagnostic {
  priceFreshness: Gate3EntryPriceFreshness;
  entryPriceSource: Gate3EntryPriceSource;
  entryPriceAgeSec: number | null;
  rawEntryPrice: number | null;
  adjustedEntryPrice: number | null;
  currentPrice: number | null;
  driftPct: number | null;
  allowed: boolean;
  blockReason?: string;
  marketSignal: false;
  executionImpact: Gate3ExecutionImpact;
}

export interface Gate3RrrCheckDiagnostic {
  rrr: number | null;
  requiredRrr: 2.0;
  passed: boolean;
  status: Gate3RrrStatus;
  reason: string | null;
  missingReason?: Gate3RrrInput['missingReason'];
  entryPrice: number | null;
  stopLoss: number | null;
  targetPrice: number | null;
  source: Gate3RrrInput['source'];
  missingFields: string[];
  notes: string[];
  fallbackUsed: boolean;
  stopFallbackUsed: boolean;
  targetFallbackUsed: boolean;
  inputCoverage: Record<string, boolean>;
  breakPoint: string;
  marketSignal: false;
}

export interface Gate3LastTriggerEvaluation {
  status: Gate3LastTriggerStatus;
  fired: boolean;
  reason: string;
  detail: string;
  priceBreakout: 'PASS' | 'NEAR' | 'FAIL' | 'MISSING';
  volumeConfirmation: 'PASS' | 'PARTIAL' | 'FAIL' | 'MISSING';
  vcp: 'PASS' | 'FAIL' | 'MISSING';
  rsi: 'PASS' | 'FAIL' | 'MISSING';
  macd: 'PASS' | 'IMPROVING' | 'FAIL' | 'MISSING';
  falseBreakoutRisk: Gate3FalseBreakoutRisk;
  strongBuyAllowed: boolean;
  liveBuyAllowed: boolean;
  shadowObservableAllowed: boolean;
  counterfactualAllowed: boolean;
  executionReady: boolean;
  executionImpact: Gate3ExecutionImpact;
  entryPriceGuard: Gate3EntryPriceGuardDiagnostic;
  rrrCheck: Gate3RrrCheckDiagnostic;
  priceConfirmation: Gate3PriceConfirmation;
  volumeConfirmationDetail: Gate3VolumeConfirmation;
  notes: string[];
  marketSignal: false;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value != null && typeof value === 'object' ? value as Record<string, unknown> : {};

function finite(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function positive(value: unknown): number | null {
  const n = finite(value);
  return n != null && n > 0 ? n : null;
}

function firstFinite(source: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = finite(source[key]);
    if (value != null) return value;
  }
  return null;
}

function firstPositive(source: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = positive(source[key]);
    if (value != null) return value;
  }
  return null;
}

function firstString(source: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

function bool(value: unknown): boolean {
  return value === true || value === 'true' || value === 'Y' || value === '1' || value === 1;
}

function normalizeSource(value: unknown): Gate3EntryPriceSource {
  const raw = String(value ?? '').trim().toUpperCase();
  if (raw.includes('KIS_WS') || raw.includes('WEBSOCKET')) return 'KIS_WS';
  if (raw.includes('KIS_REALTIME') || raw.includes('REALTIME')) return 'KIS_REALTIME';
  if (raw.includes('KIS_INQUIRE_PRICE') || raw.includes('INQUIRE_PRICE') || raw.includes('FHKST01010100')) return 'KIS_INQUIRE_PRICE';
  if (raw.includes('KIS_PRICE') || raw.includes('KIS_OFFICIAL')) return 'KIS_INQUIRE_PRICE';
  if (raw.includes('YAHOO')) return 'YAHOO';
  if (raw.includes('CACHE')) return 'CACHE';
  return 'UNKNOWN';
}

function ageFromTimestamp(now: Date, value: unknown): number | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  const ms = date.getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor((now.getTime() - ms) / 1000));
}

function buildGate3EntryPriceGuard(input: {
  quote: Record<string, unknown>;
  now?: Date;
}): Gate3EntryPriceGuardDiagnostic {
  const quote = input.quote;
  const now = input.now ?? new Date();
  const priceMetadata = asRecord(quote.priceMetadata);
  const currentPrice = firstPositive(quote, ['currentPrice', 'price', 'close', 'regularMarketPrice']);
  const rawEntryPrice = firstPositive(quote, ['rawEntryPrice', 'entryPrice', 'resolvedEntryPrice', 'candidateEntryPrice']);
  const adjustedEntryPrice = firstPositive(quote, ['adjustedEntryPrice', 'correctedEntryPrice'])
    ?? rawEntryPrice
    ?? currentPrice;
  const explicitAge = firstFinite(quote, ['entryPriceAgeSec', 'priceAgeSec', 'quoteAgeSec']);
  const asOf = firstString(quote, ['priceAsOf', 'entryPriceAsOf', 'asOf', 'fetchedAt', 'updatedAt'])
    ?? (typeof priceMetadata.asOf === 'string' ? priceMetadata.asOf : null);
  const entryPriceAgeSec = explicitAge ?? ageFromTimestamp(now, asOf);
  const entryPriceSource = normalizeSource(
    firstString(quote, ['entryPriceSource', 'priceSource', 'priceProvider', 'quoteProvider', 'provider'])
      ?? priceMetadata.source,
  );
  const explicitDrift = firstFinite(quote, ['driftPct', 'entryPriceDriftPct', 'priceDriftPct']);
  const driftPct = explicitDrift != null
    ? Math.abs(explicitDrift)
    : currentPrice != null && adjustedEntryPrice != null
      ? Math.abs(adjustedEntryPrice - currentPrice) / currentPrice * 100
      : null;

  let priceFreshness: Gate3EntryPriceFreshness;
  if (currentPrice == null) {
    priceFreshness = 'MISSING';
  } else {
    const rawFreshness = String(quote.priceFreshness ?? quote.quoteFreshness ?? '').toUpperCase();
    if (rawFreshness === 'VERIFIED' || rawFreshness === 'FRESH' || rawFreshness === 'STALE' || rawFreshness === 'MISSING') {
      priceFreshness = rawFreshness as Gate3EntryPriceFreshness;
    } else if (entryPriceAgeSec == null) {
      priceFreshness = 'MISSING';
    } else if (entryPriceAgeSec <= 60) {
      priceFreshness = entryPriceSource === 'KIS_REALTIME' || entryPriceSource === 'KIS_WS' || entryPriceSource === 'KIS_INQUIRE_PRICE'
        ? 'VERIFIED'
        : 'FRESH';
    } else {
      priceFreshness = 'STALE';
    }
  }

  let blockReason: string | undefined;
  if (currentPrice == null || currentPrice <= 0) blockReason = 'ENTRY_PRICE_MISSING';
  else if (entryPriceAgeSec == null) blockReason = 'ENTRY_PRICE_FRESHNESS_MISSING';
  else if (entryPriceAgeSec > 60) blockReason = 'ENTRY_PRICE_STALE';
  else if (driftPct != null && driftPct >= 3) blockReason = 'ENTRY_PRICE_DRIFT_HIGH';

  return {
    priceFreshness,
    entryPriceSource,
    entryPriceAgeSec,
    rawEntryPrice,
    adjustedEntryPrice,
    currentPrice,
    driftPct,
    allowed: blockReason == null,
    ...(blockReason ? { blockReason } : {}),
    marketSignal: false,
    executionImpact: blockReason ? 'LIVE_BUY_BLOCKED_ONLY' : 'NONE',
  };
}

function buildGate3RrrCheck(quote: Record<string, unknown>): Gate3RrrCheckDiagnostic {
  const built = buildGate3RrrInput(quote);
  const passed = built.status === 'PASS';
  const reason = built.status === 'PASS'
    ? null
    : built.status === 'WATCH'
      ? 'RRR_WATCH'
      : built.status === 'FAIL'
        ? 'RRR_FAIL'
        : 'RRR_MISSING';
  return {
    rrr: built.rrr,
    requiredRrr: 2.0,
    passed,
    status: built.status,
    reason,
    ...(built.missingReason ? { missingReason: built.missingReason } : {}),
    entryPrice: built.entryPrice,
    stopLoss: built.stopLoss,
    targetPrice: built.targetPrice,
    source: built.source,
    missingFields: built.missingFields,
    notes: built.notes,
    fallbackUsed: built.fallbackUsed,
    stopFallbackUsed: built.stopFallbackUsed,
    targetFallbackUsed: built.targetFallbackUsed,
    inputCoverage: built.inputCoverage,
    breakPoint: built.breakPoint,
    marketSignal: false,
  };
}

function normalizeFalseBreakoutRisk(quote: Record<string, unknown>): Gate3FalseBreakoutRisk {
  const nested = asRecord(quote.falseBreakout);
  const raw = String(
    quote.falseBreakoutRisk
      ?? nested.risk
      ?? nested.status
      ?? quote.falseBreakoutStatus
      ?? '',
  ).trim().toUpperCase();
  if (raw === 'HIGH' || raw === 'HIGH_RISK') return 'HIGH';
  if (raw === 'WATCH' || raw === 'WARN' || raw === 'WARNING') return 'WATCH';
  if (raw === 'LOW' || raw === 'LOW_RISK' || raw === 'NONE') return 'LOW';
  if (raw === 'MISSING') return 'MISSING';
  return 'UNKNOWN';
}

export function evaluateGate3LastTrigger(input: {
  quote: Record<string, unknown>;
  now?: Date;
}): Gate3LastTriggerEvaluation {
  const quote = input.quote;
  const rsi14 = firstFinite(quote, ['rsi14']);
  const macdHistogram = firstFinite(quote, ['macdHistogram']);
  const macd5dHistAgo = firstFinite(quote, ['macd5dHistAgo']);
  const entryPriceGuard = buildGate3EntryPriceGuard({ quote, now: input.now });
  const rrrCheck = buildGate3RrrCheck(quote);
  const priceConfirmation = buildGate3PriceConfirmation(quote);
  const volumeConfirmationDetail = buildGate3VolumeConfirmation(quote);
  const falseBreakoutRisk = normalizeFalseBreakoutRisk(quote);
  const notes: string[] = [];
  const priceBreakout: Gate3LastTriggerEvaluation['priceBreakout'] =
    priceConfirmation.status === 'DATA_UNAVAILABLE' ? 'MISSING'
      : priceConfirmation.status === 'BREAKOUT_CONFIRMED' ? 'PASS'
        : priceConfirmation.status === 'NEAR_BREAKOUT' || priceConfirmation.status === 'PULLBACK_ENTRY' ? 'NEAR'
          : 'FAIL';
  const volumeConfirmation: Gate3LastTriggerEvaluation['volumeConfirmation'] =
    volumeConfirmationDetail.status === 'DATA_UNAVAILABLE' ? 'MISSING'
      : volumeConfirmationDetail.status === 'CONFIRMED' ? 'PASS'
        : volumeConfirmationDetail.status === 'PARTIAL' || volumeConfirmationDetail.status === 'DRY_UP' ? 'PARTIAL'
          : 'FAIL';
  const vcpPass = bool(quote.vcpPass)
    || bool(quote.vcp)
    || (firstFinite(quote, ['compressionScore']) ?? 0) >= 0.4
    || (
      firstPositive(quote, ['bbWidthCurrent']) != null
      && firstPositive(quote, ['bbWidth20dAvg']) != null
      && firstPositive(quote, ['bbWidthCurrent'])! <= firstPositive(quote, ['bbWidth20dAvg'])! * 0.7
    );
  const vcp: Gate3LastTriggerEvaluation['vcp'] = vcpPass ? 'PASS' : 'FAIL';
  const rsi: Gate3LastTriggerEvaluation['rsi'] =
    rsi14 == null ? 'MISSING' : rsi14 >= 40 && rsi14 <= 75 ? 'PASS' : 'FAIL';
  const macdImproving = macdHistogram != null && macd5dHistAgo != null && macdHistogram > macd5dHistAgo;
  const macd: Gate3LastTriggerEvaluation['macd'] =
    macdHistogram == null ? 'MISSING' : macdHistogram >= 0 ? 'PASS' : macdImproving ? 'IMPROVING' : 'FAIL';

  const missingReason =
    priceConfirmation.status === 'DATA_UNAVAILABLE' ? 'PRICE_CONFIRMATION_MISSING'
      : volumeConfirmationDetail.status === 'DATA_UNAVAILABLE' ? 'VOLUME_BASELINE_MISSING'
        : rrrCheck.status === 'MISSING' ? 'RRR_MISSING'
          : entryPriceGuard.priceFreshness === 'MISSING' ? 'ENTRY_PRICE_FRESHNESS_MISSING'
            : null;

  if (missingReason) {
    return {
      status: 'DATA_UNAVAILABLE',
      fired: false,
      reason: missingReason,
      detail: `LastTrigger DATA_UNAVAILABLE: ${missingReason}`,
      priceBreakout,
      volumeConfirmation,
      vcp,
      rsi,
      macd,
      falseBreakoutRisk,
      strongBuyAllowed: false,
      liveBuyAllowed: false,
      shadowObservableAllowed: true,
      counterfactualAllowed: true,
      executionReady: false,
      executionImpact: entryPriceGuard.executionImpact === 'LIVE_BUY_BLOCKED_ONLY' ? 'LIVE_BUY_BLOCKED_ONLY' : 'DIAGNOSTIC_ONLY',
      entryPriceGuard,
      rrrCheck,
      priceConfirmation,
      volumeConfirmationDetail,
      notes: ['MISSING_DATA_IS_UNAVAILABLE_NOT_FAILED'],
      marketSignal: false,
    };
  }

  if (!entryPriceGuard.allowed) {
    const status: Gate3LastTriggerStatus = entryPriceGuard.blockReason === 'ENTRY_PRICE_DRIFT_HIGH'
      ? 'SANITY_REJECTED'
      : 'THRESHOLD_NOT_MET';
    return {
      status,
      fired: false,
      reason: entryPriceGuard.blockReason ?? 'ENTRY_PRICE_GUARD_BLOCKED',
      detail: `LastTrigger ${status}: ${entryPriceGuard.blockReason ?? 'ENTRY_PRICE_GUARD_BLOCKED'}`,
      priceBreakout,
      volumeConfirmation,
      vcp,
      rsi,
      macd,
      falseBreakoutRisk,
      strongBuyAllowed: false,
      liveBuyAllowed: false,
      shadowObservableAllowed: true,
      counterfactualAllowed: true,
      executionReady: false,
      executionImpact: 'LIVE_BUY_BLOCKED_ONLY',
      entryPriceGuard,
      rrrCheck,
      priceConfirmation,
      volumeConfirmationDetail,
      notes: ['LIVE_BUY_BLOCKED_ONLY', 'SHADOW_COUNTERFACTUAL_ALLOWED'],
      marketSignal: false,
    };
  }

  const rsiOverheated = rsi14 != null && rsi14 > 80;
  const rsiTriggerOk = rsi14 == null || (rsi14 >= 40 && rsi14 <= 75);
  const macdTriggerOk = macdHistogram == null || macd === 'PASS' || macd === 'IMPROVING';
  const priceReady = priceConfirmation.status === 'BREAKOUT_CONFIRMED';
  const volumeReady = volumeConfirmationDetail.status === 'CONFIRMED';
  const waitPrice = priceConfirmation.status === 'NEAR_BREAKOUT' || priceConfirmation.status === 'PULLBACK_ENTRY';
  const waitVolume = volumeConfirmationDetail.status === 'DRY_UP' || volumeConfirmationDetail.status === 'PARTIAL';
  const waitRrr = rrrCheck.status === 'PASS' || rrrCheck.status === 'WATCH';
  if (priceConfirmation.status === 'NOT_CONFIRMED') notes.push('PRICE_NOT_CONFIRMED');
  if (priceConfirmation.status === 'OVEREXTENDED') notes.push('PRICE_OVEREXTENDED');
  if (volumeConfirmationDetail.status === 'WEAK') notes.push('VOLUME_WEAK');
  if (volumeConfirmationDetail.status === 'SPIKE_RISK') notes.push('VOLUME_SPIKE_RISK');
  if (!rrrCheck.passed) notes.push(rrrCheck.reason ?? 'RRR_FAIL');
  if (falseBreakoutRisk === 'HIGH') notes.push('FALSE_BREAKOUT_HIGH');
  if (rsiOverheated) notes.push('RSI_OVERHEATED');
  else if (!rsiTriggerOk) notes.push('RSI_OUT_OF_TRIGGER_ZONE');
  if (!macdTriggerOk) notes.push('MACD_NOT_POSITIVE');

  const thresholdOk = priceReady
    && volumeReady
    && rrrCheck.passed
    && falseBreakoutRisk !== 'HIGH'
    && rsiTriggerOk
    && macdTriggerOk;

  const waitOk = !thresholdOk
    && waitRrr
    && waitPrice
    && waitVolume
    && falseBreakoutRisk !== 'HIGH'
    && !rsiOverheated
    && macdTriggerOk;

  if (!thresholdOk) {
    const reason = waitOk
      ? priceConfirmation.status === 'NEAR_BREAKOUT' && volumeConfirmationDetail.status === 'DRY_UP'
        ? 'NEAR_BREAKOUT_DRY_UP'
        : priceConfirmation.status === 'PULLBACK_ENTRY' && volumeConfirmationDetail.status === 'PARTIAL'
          ? 'PULLBACK_ENTRY_PARTIAL_VOLUME'
          : rrrCheck.status === 'WATCH'
            ? 'RRR_WATCH'
            : 'LAST_TRIGGER_WAIT'
      : notes[0] ?? 'LAST_TRIGGER_NOT_FIRED';
    return {
      status: 'THRESHOLD_NOT_MET',
      fired: false,
      reason,
      detail: `LastTrigger WAIT: ${reason}`,
      priceBreakout,
      volumeConfirmation,
      vcp,
      rsi,
      macd,
      falseBreakoutRisk,
      strongBuyAllowed: falseBreakoutRisk !== 'HIGH',
      liveBuyAllowed: false,
      shadowObservableAllowed: true,
      counterfactualAllowed: true,
      executionReady: false,
      executionImpact: falseBreakoutRisk === 'HIGH' ? 'LIVE_BUY_BLOCKED_ONLY' : 'NONE',
      entryPriceGuard,
      rrrCheck,
      priceConfirmation,
      volumeConfirmationDetail,
      notes: waitOk && notes.length === 0 ? ['WAIT_FOR_BREAKOUT_CONFIRMATION'] : notes,
      marketSignal: false,
    };
  }

  return {
    status: 'FIRED',
    fired: true,
    reason: 'FIRED',
    detail: `LastTrigger FIRED: price=${priceConfirmation.status} volume=${volumeConfirmationDetail.status} rrr=${rrrCheck.rrr?.toFixed(1) ?? 'n/a'} source=${rrrCheck.source}`,
    priceBreakout,
    volumeConfirmation,
    vcp,
    rsi,
    macd,
    falseBreakoutRisk,
    strongBuyAllowed: true,
    liveBuyAllowed: true,
    shadowObservableAllowed: true,
    counterfactualAllowed: true,
    executionReady: true,
    executionImpact: 'NONE',
    entryPriceGuard,
    rrrCheck,
    priceConfirmation,
    volumeConfirmationDetail,
    notes,
    marketSignal: false,
  };
}
