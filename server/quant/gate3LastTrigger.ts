// @responsibility Gate3 last-trigger and entry price readiness helpers.

import {
  buildGate3RrrInput,
  type Gate3RrrInput,
  type Gate3RrrStatus,
} from './gate3RrrBuilder.js';

export type Gate3LastTriggerStatus =
  | 'FIRED'
  | 'THRESHOLD_NOT_MET'
  | 'DATA_UNAVAILABLE'
  | 'PROVIDER_DEGRADED'
  | 'SANITY_REJECTED';

export type Gate3EntryPriceFreshness = 'VERIFIED' | 'FRESH' | 'STALE' | 'MISSING';
export type Gate3EntryPriceSource =
  | 'KIS_REALTIME'
  | 'KIS_INQUIRE_PRICE'
  | 'KIS_WS'
  | 'YAHOO'
  | 'CACHE'
  | 'UNKNOWN';
export type Gate3ExecutionImpact = 'NONE' | 'DIAGNOSTIC_ONLY' | 'LIVE_BUY_BLOCKED_ONLY';
export type Gate3FalseBreakoutRisk = 'LOW' | 'WATCH' | 'HIGH' | 'MISSING' | 'UNKNOWN';

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
  entryPrice: number | null;
  stopLoss: number | null;
  targetPrice: number | null;
  source: Gate3RrrInput['source'];
  missingFields: string[];
  notes: string[];
  fallbackUsed: boolean;
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

export function buildGate3EntryPriceGuard(input: {
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

export function buildGate3RrrCheck(quote: Record<string, unknown>): Gate3RrrCheckDiagnostic {
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
    entryPrice: built.entryPrice,
    stopLoss: built.stopLoss,
    targetPrice: built.targetPrice,
    source: built.source,
    missingFields: built.missingFields,
    notes: built.notes,
    fallbackUsed: built.fallbackUsed,
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
  const currentPrice = firstPositive(quote, ['currentPrice', 'price', 'close', 'regularMarketPrice']);
  const high5d = firstPositive(quote, ['high5d']);
  const high20d = firstPositive(quote, ['high20d']);
  const volume = firstFinite(quote, ['volume', 'regularMarketVolume']);
  const avgVolume = firstPositive(quote, ['avgVolume', 'avgVolume20d', 'vol20dAvg']);
  const rsi14 = firstFinite(quote, ['rsi14']);
  const macdHistogram = firstFinite(quote, ['macdHistogram']);
  const macd5dHistAgo = firstFinite(quote, ['macd5dHistAgo']);
  const entryPriceGuard = buildGate3EntryPriceGuard({ quote, now: input.now });
  const rrrCheck = buildGate3RrrCheck(quote);
  const falseBreakoutRisk = normalizeFalseBreakoutRisk(quote);
  const notes: string[] = [];

  const breakoutReference = high5d ?? high20d;
  const breakoutPass = currentPrice != null && breakoutReference != null && currentPrice >= breakoutReference;
  const breakoutNear = currentPrice != null && breakoutReference != null && currentPrice >= breakoutReference * 0.99;
  const priceBreakout: Gate3LastTriggerEvaluation['priceBreakout'] =
    currentPrice == null || breakoutReference == null ? 'MISSING' : breakoutPass ? 'PASS' : breakoutNear ? 'NEAR' : 'FAIL';

  const volumeRatio = volume != null && avgVolume != null && avgVolume > 0 ? volume / avgVolume : null;
  const breakoutVolume = volumeRatio != null && volumeRatio >= 2;
  const volumeSurge = volumeRatio != null && volumeRatio >= 3;
  const vcpPass = bool(quote.vcpPass)
    || bool(quote.vcp)
    || (firstFinite(quote, ['compressionScore']) ?? 0) >= 0.4
    || (
      firstPositive(quote, ['bbWidthCurrent']) != null
      && firstPositive(quote, ['bbWidth20dAvg']) != null
      && firstPositive(quote, ['bbWidthCurrent'])! <= firstPositive(quote, ['bbWidth20dAvg'])! * 0.7
    );
  const volumeConfirmation: Gate3LastTriggerEvaluation['volumeConfirmation'] =
    volumeRatio == null ? 'MISSING' : breakoutVolume || volumeSurge ? 'PASS' : volumeRatio >= 1.2 ? 'PARTIAL' : 'FAIL';
  const vcp: Gate3LastTriggerEvaluation['vcp'] = vcpPass ? 'PASS' : 'FAIL';

  const rsi: Gate3LastTriggerEvaluation['rsi'] =
    rsi14 == null ? 'MISSING' : rsi14 >= 40 && rsi14 <= 75 ? 'PASS' : 'FAIL';
  const macdImproving = macdHistogram != null && macd5dHistAgo != null && macdHistogram > macd5dHistAgo;
  const macd: Gate3LastTriggerEvaluation['macd'] =
    macdHistogram == null ? 'MISSING' : macdHistogram >= 0 ? 'PASS' : macdImproving ? 'IMPROVING' : 'FAIL';

  const missingReason =
    currentPrice == null ? 'PRICE_MISSING'
      : breakoutReference == null ? 'BREAKOUT_REFERENCE_MISSING'
        : volume == null || avgVolume == null ? 'VOLUME_BASELINE_MISSING'
          : rsi14 == null ? 'RSI_MISSING'
            : macdHistogram == null ? 'MACD_MISSING'
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
      notes: ['LIVE_BUY_BLOCKED_ONLY', 'SHADOW_COUNTERFACTUAL_ALLOWED'],
      marketSignal: false,
    };
  }

  const positiveSetup = priceBreakout === 'PASS' || priceBreakout === 'NEAR';
  const positiveVolumeOrVcp = volumeConfirmation === 'PASS' || vcp === 'PASS';
  if (!positiveSetup) notes.push('BREAKOUT_NOT_NEAR');
  if (!positiveVolumeOrVcp) notes.push('VOLUME_OR_VCP_NOT_CONFIRMED');
  if (rsi !== 'PASS') notes.push('RSI_OUT_OF_TRIGGER_ZONE');
  if (!(macd === 'PASS' || macd === 'IMPROVING')) notes.push('MACD_NOT_POSITIVE');
  if (!rrrCheck.passed) notes.push(rrrCheck.reason ?? 'RRR_FAIL');
  if (falseBreakoutRisk === 'HIGH') notes.push('FALSE_BREAKOUT_HIGH');

  const thresholdOk = positiveSetup
    && positiveVolumeOrVcp
    && rsi === 'PASS'
    && (macd === 'PASS' || macd === 'IMPROVING')
    && rrrCheck.passed
    && falseBreakoutRisk !== 'HIGH';

  if (!thresholdOk) {
    const reason = notes[0] ?? 'LAST_TRIGGER_NOT_FIRED';
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
      notes,
      marketSignal: false,
    };
  }

  return {
    status: 'FIRED',
    fired: true,
    reason: 'FIRED',
    detail: `LastTrigger FIRED: price=${priceBreakout} volume=${volumeConfirmation} rrr=${rrrCheck.rrr?.toFixed(1) ?? 'n/a'} source=${rrrCheck.source}`,
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
    notes,
    marketSignal: false,
  };
}
