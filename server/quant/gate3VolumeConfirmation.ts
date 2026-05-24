// @responsibility Gate3 volume confirmation builder for LastTrigger timing diagnostics.

export type Gate3VolumeConfirmationStatus =
  | 'CONFIRMED'
  | 'PARTIAL'
  | 'DRY_UP'
  | 'WEAK'
  | 'SPIKE_RISK'
  | 'DATA_UNAVAILABLE';

export interface Gate3VolumeConfirmation {
  status: Gate3VolumeConfirmationStatus;
  volume: number | null;
  avgVolume20d: number | null;
  volumeRatio20d: number | null;
  tradingValue: number | null;
  avgTradingValue20d: number | null;
  tradingValueRatio20d: number | null;
  source: 'QUOTE' | 'OHLCV' | 'TECHNICAL_CONTEXT' | 'MISSING';
  missingFields: string[];
  notes: string[];
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

function bool(value: unknown): boolean {
  return value === true || value === 'true' || value === 'Y' || value === '1' || value === 1;
}

export function buildGate3VolumeConfirmation(quote: Record<string, unknown>): Gate3VolumeConfirmation {
  const volume = firstFinite(quote, ['volume', 'regularMarketVolume']);
  const avgVolume20d = firstPositive(quote, ['avgVolume20d', 'avgVolume', 'vol20dAvg']);
  const currentPrice = firstPositive(quote, ['currentPrice', 'price', 'close', 'regularMarketPrice']);
  const tradingValue = firstFinite(quote, ['tradingValue'])
    ?? (volume != null && currentPrice != null ? volume * currentPrice : null);
  const avgTradingValue20d = firstFinite(quote, ['avgTradingValue20d'])
    ?? (avgVolume20d != null && currentPrice != null ? avgVolume20d * currentPrice : null);
  const volumeRatio20d = volume != null && avgVolume20d != null && avgVolume20d > 0
    ? volume / avgVolume20d
    : null;
  const tradingValueRatio20d = tradingValue != null && avgTradingValue20d != null && avgTradingValue20d > 0
    ? tradingValue / avgTradingValue20d
    : null;
  const missingFields: string[] = [];
  const notes: string[] = [];

  if (volume == null) missingFields.push('volume');
  if (avgVolume20d == null) missingFields.push('avgVolume20d');
  if (missingFields.length > 0 || volumeRatio20d == null) {
    return {
      status: 'DATA_UNAVAILABLE',
      volume,
      avgVolume20d,
      volumeRatio20d,
      tradingValue,
      avgTradingValue20d,
      tradingValueRatio20d,
      source: 'MISSING',
      missingFields,
      notes: ['VOLUME_CONFIRMATION_BASELINE_MISSING'],
      marketSignal: false,
    };
  }

  const spikeRiskContext = bool(quote.upperWickRisk)
    || bool(quote.longUpperWick)
    || bool(quote.bearishCandle)
    || bool(quote.exhaustionCandle)
    || bool(quote.overheated);

  if (volumeRatio20d >= 4.0) {
    if (spikeRiskContext) {
      return {
        status: 'SPIKE_RISK',
        volume,
        avgVolume20d,
        volumeRatio20d,
        tradingValue,
        avgTradingValue20d,
        tradingValueRatio20d,
        source: 'OHLCV',
        missingFields,
        notes: ['VOLUME_SPIKE_RISK_CONTEXT'],
        marketSignal: false,
      };
    }
    notes.push('CONFIRMED_WITH_SPIKE_NOTE');
  }

  const ratio = Math.max(volumeRatio20d, tradingValueRatio20d ?? 0);
  const status: Gate3VolumeConfirmationStatus =
    volumeRatio20d <= 0.5 ? 'DRY_UP'
      : ratio >= 1.5 ? 'CONFIRMED'
        : ratio >= 1.1 ? 'PARTIAL'
          : 'WEAK';

  return {
    status,
    volume,
    avgVolume20d,
    volumeRatio20d,
    tradingValue,
    avgTradingValue20d,
    tradingValueRatio20d,
    source: 'OHLCV',
    missingFields,
    notes,
    marketSignal: false,
  };
}
