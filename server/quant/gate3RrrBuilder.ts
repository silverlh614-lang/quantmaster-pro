// @responsibility Gate3 reward/risk input builder for LastTrigger diagnostics.

export type Gate3RrrStatus = 'PASS' | 'WATCH' | 'FAIL' | 'MISSING';
export type Gate3RrrSource =
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
  missingFields: string[];
  notes: string[];
  fallbackUsed: boolean;
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
    missingFields: input.missingFields ?? [],
    notes: input.notes ?? [],
    fallbackUsed: input.fallbackUsed ?? false,
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
  if (explicit != null) return { value: explicit, source: 'SWING_LOW', notes: ['STOP_EXPLICIT_USED'], fallbackUsed: false };

  const swing = firstPositive(quote, ['recentSwingLow', 'swingLow', 'supportLow', 'low20d']);
  if (swing != null) return { value: swing, source: 'SWING_LOW', notes: ['STOP_SWING_LOW_USED'], fallbackUsed: false };

  const atr14 = firstPositive(quote, ['atr14', 'atr', 'atr5d']);
  if (atr14 != null) return { value: entryPrice - (2 * atr14), source: 'ATR_STOP', notes: ['STOP_ATR_2X_USED'], fallbackUsed: false };

  const ma20 = firstPositive(quote, ['ma20', 'baselinePrice', 'baseLine', 'kijunLine']);
  if (ma20 != null) return { value: ma20, source: 'SWING_LOW', notes: ['STOP_BASELINE_USED'], fallbackUsed: false };

  return { value: entryPrice * 0.93, source: 'FALLBACK_PERCENT', notes: ['STOP_FALLBACK_7PCT_USED'], fallbackUsed: true };
}

function resolveTargetPrice(
  quote: Record<string, unknown>,
  entryPrice: number,
): { value: number | null; source: Gate3RrrSource; notes: string[]; fallbackUsed: boolean } {
  const fib = firstPositive(quote, ['fibonacciExtensionTarget', 'fib1618', 'fibExtensionTarget']);
  if (fib != null) return { value: fib, source: 'FIB_EXT', notes: ['TARGET_FIB_EXTENSION_USED'], fallbackUsed: false };

  const explicit = firstPositive(quote, ['targetPrice', 'takeProfitPrice', 'expectedTargetPrice']);
  if (explicit != null) return { value: explicit, source: 'MEASURED_MOVE', notes: ['TARGET_EXPLICIT_USED'], fallbackUsed: false };

  const measured = firstPositive(quote, ['measuredMoveTarget', 'boxMeasuredMoveTarget']);
  if (measured != null) return { value: measured, source: 'MEASURED_MOVE', notes: ['TARGET_MEASURED_MOVE_USED'], fallbackUsed: false };

  const resistance = firstPositive(quote, ['recentResistance', 'boxHigh', 'boxTop', 'high20d']);
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

  return { value: entryPrice * 1.15, source: 'FALLBACK_PERCENT', notes: ['TARGET_FALLBACK_15PCT_USED'], fallbackUsed: true };
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
  const entry = resolveEntryPrice(quote);
  const entryPrice = entry.value;
  if (entryPrice == null) {
    return buildMissing({
      missingFields: ['entryPrice'],
      notes: ['RRR_ENTRY_PRICE_MISSING', ...entry.notes],
    });
  }

  const stop = resolveStopLoss(quote, entryPrice);
  const target = resolveTargetPrice(quote, entryPrice);
  const fallbackUsed = stop.fallbackUsed || target.fallbackUsed;
  const notes = [...entry.notes, ...stop.notes, ...target.notes];
  const stopLoss = stop.value;
  const targetPrice = target.value;

  if (stopLoss == null) {
    return buildMissing({ entryPrice, targetPrice, missingFields: ['stopLoss'], notes: [...notes, 'RRR_STOP_MISSING'], fallbackUsed });
  }
  if (targetPrice == null) {
    return buildMissing({ entryPrice, stopLoss, missingFields: ['targetPrice'], notes: [...notes, 'RRR_TARGET_MISSING'], fallbackUsed });
  }
  if (stopLoss >= entryPrice) {
    return buildMissing({
      entryPrice,
      stopLoss,
      targetPrice,
      missingFields: ['stopLoss'],
      notes: [...notes, 'RRR_STOP_SANITY_REJECTED'],
      fallbackUsed,
    });
  }
  if (targetPrice <= entryPrice) {
    return buildMissing({
      entryPrice,
      stopLoss,
      targetPrice,
      missingFields: ['targetPrice'],
      notes: [...notes, 'RRR_TARGET_SANITY_REJECTED'],
      fallbackUsed,
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
    marketSignal: false,
  };
}
