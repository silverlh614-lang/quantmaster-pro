// @responsibility Gate3 reward/risk input builder for LastTrigger diagnostics.

export type Gate3RrrStatus = 'PASS' | 'WATCH' | 'FAIL' | 'MISSING';
type Gate3RrrMissingReason =
  | 'RRR_MISSING_ENTRY'
  | 'RRR_MISSING_STOP'
  | 'RRR_MISSING_TARGET'
  | 'RRR_INVALID_RISK'
  | 'RRR_INVALID_REWARD'
  | 'RRR_PRICE_STALE';
type Gate3RrrSource =
  | 'EXPLICIT'
  | 'FIB_EXT'
  | 'MEASURED_MOVE'
  | 'ATR_STOP'
  | 'SWING_LOW'
  | 'FALLBACK_PERCENT'
  | 'MISSING';

export interface Gate3RrrInput {
  entryPrice: number | null;
  stopLoss: number | null;
  targetPrice: number | null;
  rrr: number | null;
  status: Gate3RrrStatus;
  source: Gate3RrrSource;
  missingReason?: Gate3RrrMissingReason;
  missingFields: string[];
  notes: string[];
  fallbackUsed: boolean;
  stopFallbackUsed: boolean;
  targetFallbackUsed: boolean;
  inputCoverage: Record<string, boolean>;
  breakPoint: string;
  marketSignal: false;
}

function finite(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function positive(value: unknown): number | null {
  const n = finite(value);
  return n != null && n > 0 ? n : null;
}

function firstPositive(source: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = positive(source[key]);
    if (value != null) return value;
  }
  return null;
}

function statusForRrr(rrr: number): Gate3RrrStatus {
  if (rrr >= 2.0) return 'PASS';
  if (rrr >= 1.5) return 'WATCH';
  return 'FAIL';
}

function buildMissing(input: Partial<Gate3RrrInput>): Gate3RrrInput {
  return {
    entryPrice: input.entryPrice ?? null,
    stopLoss: input.stopLoss ?? null,
    targetPrice: input.targetPrice ?? null,
    rrr: null,
    status: 'MISSING',
    source: 'MISSING',
    ...(input.missingReason ? { missingReason: input.missingReason } : {}),
    missingFields: input.missingFields ?? [],
    notes: input.notes ?? [],
    fallbackUsed: input.fallbackUsed ?? false,
    stopFallbackUsed: input.stopFallbackUsed ?? false,
    targetFallbackUsed: input.targetFallbackUsed ?? false,
    inputCoverage: input.inputCoverage ?? {},
    breakPoint: input.breakPoint ?? input.missingReason ?? 'RRR_MISSING',
    marketSignal: false,
  };
}

function resolveEntryPrice(quote: Record<string, unknown>): { value: number | null; notes: string[] } {
  const priceFreshness = String(quote.priceFreshness ?? quote.quoteFreshness ?? '').toUpperCase();
  const value = firstPositive(quote, [
    'currentPrice',
    'kisCurrentPrice',
    'kisRealtimePrice',
    'kisInquirePrice',
    'kisWsLastPrice',
    'lastPrice',
    'price',
    'close',
    'regularMarketPrice',
  ]);
  const notes: string[] = [];
  if (priceFreshness === 'STALE' || priceFreshness === 'MISSING') {
    notes.push(`ENTRY_PRICE_FRESHNESS_${priceFreshness}`);
  }
  return { value, notes };
}

function resolveStopLoss(
  quote: Record<string, unknown>,
  entryPrice: number,
): { value: number | null; source: Gate3RrrSource; notes: string[]; fallbackUsed: boolean } {
  const explicit = firstPositive(quote, ['stopLoss', 'stopLossPrice', 'stopPrice', 'riskStopPrice']);
  if (explicit != null) return { value: explicit, source: 'EXPLICIT', notes: ['STOP_EXPLICIT_USED'], fallbackUsed: false };

  const swing = firstPositive(quote, ['recentSwingLow', 'swingLow', 'supportLevel', 'supportLow', 'low20d']);
  if (swing != null) return { value: swing, source: 'SWING_LOW', notes: ['STOP_SWING_LOW_USED'], fallbackUsed: false };

  const atr14 = firstPositive(quote, ['atr14', 'atr', 'atr5d']);
  if (atr14 != null) return { value: entryPrice - (2 * atr14), source: 'ATR_STOP', notes: ['STOP_ATR_2X_USED'], fallbackUsed: false };

  const ma20 = firstPositive(quote, ['ma20', 'baselinePrice', 'baseLine', 'kijunLine']);
  const ma60 = firstPositive(quote, ['ma60']);
  const maStop = ma20 != null && ma60 != null ? Math.min(ma20, ma60) : ma20 ?? ma60;
  if (maStop != null) return { value: maStop, source: 'SWING_LOW', notes: ['STOP_MA_DEFENSIVE_USED'], fallbackUsed: false };

  return { value: entryPrice * 0.92, source: 'FALLBACK_PERCENT', notes: ['STOP_FALLBACK_8PCT_USED'], fallbackUsed: true };
}

function resolveTargetPrice(
  quote: Record<string, unknown>,
  entryPrice: number,
  stopLoss: number,
): { value: number | null; source: Gate3RrrSource; notes: string[]; fallbackUsed: boolean } {
  const explicit = firstPositive(quote, ['targetPrice', 'takeProfitPrice', 'expectedTargetPrice']);
  if (explicit != null) return { value: explicit, source: 'EXPLICIT', notes: ['TARGET_EXPLICIT_USED'], fallbackUsed: false };

  const fib = firstPositive(quote, ['fibonacciExtensionTarget', 'fib1618', 'fibExtensionTarget']);
  if (fib != null) return { value: fib, source: 'FIB_EXT', notes: ['TARGET_FIB_EXTENSION_USED'], fallbackUsed: false };

  const measured = firstPositive(quote, ['measuredMoveTarget', 'boxMeasuredMoveTarget']);
  if (measured != null) return { value: measured, source: 'MEASURED_MOVE', notes: ['TARGET_MEASURED_MOVE_USED'], fallbackUsed: false };

  const recentSwingHigh = firstPositive(quote, ['recentSwingHigh', 'swingHigh']);
  const resistance = firstPositive(quote, ['resistanceLevel', 'recentResistance', 'boxHigh', 'boxTop', 'high20d']) ?? recentSwingHigh;
  const boxLow = firstPositive(quote, ['boxLow', 'boxBottom', 'low20d']);
  if (resistance != null && resistance > entryPrice) {
    if (boxLow != null && resistance > boxLow) {
      return {
        value: Math.max(resistance, entryPrice + (resistance - boxLow)),
        source: 'MEASURED_MOVE',
        notes: ['TARGET_BOX_MEASURED_MOVE_USED'],
        fallbackUsed: false,
      };
    }
    return { value: resistance, source: 'MEASURED_MOVE', notes: ['TARGET_RESISTANCE_USED'], fallbackUsed: false };
  }

  const riskPerShare = entryPrice - stopLoss;
  return { value: entryPrice + (2.5 * riskPerShare), source: 'FALLBACK_PERCENT', notes: ['TARGET_FALLBACK_2_5R_USED'], fallbackUsed: true };
}

function chooseSource(
  explicitRrr: number | null,
  targetSource: Gate3RrrSource,
  stopSource: Gate3RrrSource,
  fallbackUsed: boolean,
): Gate3RrrSource {
  if (explicitRrr != null) return 'EXPLICIT';
  if (fallbackUsed) return 'FALLBACK_PERCENT';
  if (targetSource !== 'MISSING') return targetSource;
  return stopSource;
}

export function buildGate3RrrInput(quote: Record<string, unknown>): Gate3RrrInput {
  const inputCoverage = {
    entryPrice: firstPositive(quote, ['currentPrice', 'kisCurrentPrice', 'kisRealtimePrice', 'kisInquirePrice', 'kisWsLastPrice', 'lastPrice', 'price', 'close', 'regularMarketPrice']) != null,
    explicitStop: firstPositive(quote, ['stopLoss', 'stopLossPrice', 'stopPrice', 'riskStopPrice']) != null,
    recentSwingLow: firstPositive(quote, ['recentSwingLow', 'swingLow', 'supportLevel', 'supportLow', 'low20d']) != null,
    atr: firstPositive(quote, ['atr14', 'atr', 'atr5d']) != null,
    maStop: firstPositive(quote, ['ma20', 'ma60', 'baselinePrice', 'baseLine', 'kijunLine']) != null,
    explicitTarget: firstPositive(quote, ['targetPrice', 'takeProfitPrice', 'expectedTargetPrice']) != null,
    targetProjection: firstPositive(quote, ['fibonacciExtensionTarget', 'fib1618', 'fibExtensionTarget', 'measuredMoveTarget', 'boxMeasuredMoveTarget', 'resistanceLevel', 'recentResistance', 'recentSwingHigh', 'boxHigh', 'boxTop', 'high20d']) != null,
    priceFreshness: String(quote.priceFreshness ?? quote.quoteFreshness ?? '').trim().length > 0,
  };
  const entry = resolveEntryPrice(quote);
  const entryPrice = entry.value;
  if (entryPrice == null) {
    return buildMissing({
      missingReason: 'RRR_MISSING_ENTRY',
      missingFields: ['entryPrice'],
      notes: ['RRR_ENTRY_PRICE_MISSING', ...entry.notes],
      inputCoverage,
      breakPoint: 'RRR_MISSING_ENTRY',
    });
  }

  const stop = resolveStopLoss(quote, entryPrice);
  const stopLoss = stop.value;
  if (stopLoss == null) {
    return buildMissing({
      entryPrice,
      missingReason: 'RRR_MISSING_STOP',
      missingFields: ['stopLoss'],
      notes: [...entry.notes, ...stop.notes, 'RRR_STOP_MISSING'],
      fallbackUsed: stop.fallbackUsed,
      stopFallbackUsed: stop.fallbackUsed,
      targetFallbackUsed: false,
      inputCoverage,
      breakPoint: 'RRR_MISSING_STOP',
    });
  }

  const target = resolveTargetPrice(quote, entryPrice, stopLoss);
  const fallbackUsed = stop.fallbackUsed || target.fallbackUsed;
  const notes = [...entry.notes, ...stop.notes, ...target.notes];
  const targetPrice = target.value;

  if (targetPrice == null) {
    return buildMissing({
      entryPrice,
      stopLoss,
      missingReason: 'RRR_MISSING_TARGET',
      missingFields: ['targetPrice'],
      notes: [...notes, 'RRR_TARGET_MISSING'],
      fallbackUsed,
      stopFallbackUsed: stop.fallbackUsed,
      targetFallbackUsed: target.fallbackUsed,
      inputCoverage,
      breakPoint: 'RRR_MISSING_TARGET',
    });
  }
  if (stopLoss >= entryPrice) {
    return buildMissing({
      entryPrice,
      stopLoss,
      targetPrice,
      missingReason: 'RRR_INVALID_RISK',
      missingFields: ['stopLoss'],
      notes: [...notes, 'RRR_STOP_SANITY_REJECTED', 'RRR_INVALID_RISK'],
      fallbackUsed,
      stopFallbackUsed: stop.fallbackUsed,
      targetFallbackUsed: target.fallbackUsed,
      inputCoverage,
      breakPoint: 'RRR_INVALID_RISK',
    });
  }
  if (targetPrice <= entryPrice) {
    return buildMissing({
      entryPrice,
      stopLoss,
      targetPrice,
      missingReason: 'RRR_INVALID_REWARD',
      missingFields: ['targetPrice'],
      notes: [...notes, 'RRR_TARGET_SANITY_REJECTED', 'RRR_INVALID_REWARD'],
      fallbackUsed,
      stopFallbackUsed: stop.fallbackUsed,
      targetFallbackUsed: target.fallbackUsed,
      inputCoverage,
      breakPoint: 'RRR_INVALID_REWARD',
    });
  }

  const calculated = (targetPrice - entryPrice) / (entryPrice - stopLoss);
  const explicitRrr = finite(quote.rrr ?? quote.riskRewardRatio ?? quote.rewardRiskRatio);
  const rrr = explicitRrr != null && explicitRrr > 0 ? explicitRrr : calculated;
  return {
    entryPrice,
    stopLoss,
    targetPrice,
    rrr,
    status: statusForRrr(rrr),
    source: chooseSource(explicitRrr != null && explicitRrr > 0 ? explicitRrr : null, target.source, stop.source, fallbackUsed),
    missingFields: [],
    notes: explicitRrr != null && explicitRrr > 0 ? [...notes, 'RRR_EXPLICIT_USED'] : notes,
    fallbackUsed,
    stopFallbackUsed: stop.fallbackUsed,
    targetFallbackUsed: target.fallbackUsed,
    inputCoverage,
    breakPoint: 'RRR_COMPUTED',
    marketSignal: false,
  };
}
