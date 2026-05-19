// @responsibility Gate1 liquidity floor diagnostic normalization only.

export type Gate1LiquidityFloorStatus =
  | 'PASS'
  | 'FAIL'
  | 'THIN'
  | 'SPIKE_ONLY'
  | 'MISSING'
  | 'UNKNOWN';

export type Gate1LiquiditySource =
  | 'KIS_OFFICIAL'
  | 'QMP_QUOTE'
  | 'YAHOO'
  | 'CACHE'
  | 'UNKNOWN';

export type Gate1LiquiditySourceStatus =
  | 'VERIFIED'
  | 'STALE'
  | 'MISSING'
  | 'DEGRADED'
  | 'UNKNOWN';

export interface Gate1LiquidityThresholds {
  minVolume: number | null;
  minTradingValue: number | null;
  minAvgVolume20d: number | null;
  minAvgTradingValue20d: number | null;
}

export interface Gate1LiquidityFloorDiagnostic {
  status: Gate1LiquidityFloorStatus;
  volume: number | null;
  avgVolume20d: number | null;
  tradingValue: number | null;
  avgTradingValue20d: number | null;
  currentPrice: number | null;
  threshold: Gate1LiquidityThresholds;
  checks: {
    volumePass: boolean | null;
    tradingValuePass: boolean | null;
    avgVolumePass: boolean | null;
    avgTradingValuePass: boolean | null;
  };
  source: Gate1LiquiditySource;
  sourceStatus: Gate1LiquiditySourceStatus;
  reason: string | null;
  providerIssue: boolean;
  marketSignal: false;
  executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY' | 'LIVE_BUY_BLOCKED_ONLY';
}

export interface NormalizeLiquidityFloorInput {
  quote?: Record<string, unknown> | null;
  thresholds?: Partial<Gate1LiquidityThresholds>;
  quoteCoverage?: {
    source?: unknown;
    confidence?: unknown;
  } | null;
}

export const DEFAULT_GATE1_LIQUIDITY_THRESHOLDS: Gate1LiquidityThresholds = {
  minVolume: 100_000,
  minTradingValue: 1_000_000_000,
  minAvgVolume20d: 50_000,
  minAvgTradingValue20d: 500_000_000,
};

const PRICE_ALIASES = ['currentPrice', 'price', 'regularMarketPrice', 'lastPrice'];
const VOLUME_ALIASES = ['volume', 'regularMarketVolume', 'acmlVol', 'acml_vol'];
const AVG_VOLUME_20D_ALIASES = ['avgVolume20d', 'averageVolume20d', 'vol20dAvg', 'avgVolume'];
const TRADING_VALUE_ALIASES = ['tradingValue', 'tradeValue', 'accTradePrice', 'acmlTrPbmn', 'acml_tr_pbmn'];
const AVG_TRADING_VALUE_20D_ALIASES = [
  'avgTradingValue20d',
  'averageTradingValue20d',
  'avgTradeValue20d',
  'avgTurnover20d',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function positiveNumberOrNull(value: unknown): number | null {
  const n = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value.replace(/,/g, '').trim())
      : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function firstValue(quote: Record<string, unknown>, aliases: readonly string[]): unknown {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(quote, alias) && quote[alias] != null) return quote[alias];
  }
  const kisOfficialQuote = quote.kisOfficialQuote;
  if (isRecord(kisOfficialQuote)) {
    for (const alias of aliases) {
      if (Object.prototype.hasOwnProperty.call(kisOfficialQuote, alias) && kisOfficialQuote[alias] != null) {
        return kisOfficialQuote[alias];
      }
    }
  }
  return undefined;
}

function mergeThresholds(input?: Partial<Gate1LiquidityThresholds>): Gate1LiquidityThresholds {
  return {
    minVolume: input?.minVolume ?? DEFAULT_GATE1_LIQUIDITY_THRESHOLDS.minVolume,
    minTradingValue: input?.minTradingValue ?? DEFAULT_GATE1_LIQUIDITY_THRESHOLDS.minTradingValue,
    minAvgVolume20d: input?.minAvgVolume20d ?? DEFAULT_GATE1_LIQUIDITY_THRESHOLDS.minAvgVolume20d,
    minAvgTradingValue20d: input?.minAvgTradingValue20d ?? DEFAULT_GATE1_LIQUIDITY_THRESHOLDS.minAvgTradingValue20d,
  };
}

function pass(value: number | null, threshold: number | null): boolean | null {
  if (value == null || threshold == null) return null;
  return value >= threshold;
}

function normalizeSource(value: unknown): Gate1LiquiditySource {
  const raw = String(value ?? '').toUpperCase();
  if (raw === 'KIS_OFFICIAL') return 'KIS_OFFICIAL';
  if (raw === 'QMP_QUOTE') return 'QMP_QUOTE';
  if (raw === 'YAHOO') return 'YAHOO';
  if (raw === 'CACHE') return 'CACHE';
  return 'UNKNOWN';
}

function sourceFromQuote(quote: Record<string, unknown> | null, quoteCoverage?: NormalizeLiquidityFloorInput['quoteCoverage']): Gate1LiquiditySource {
  const coverageSource = normalizeSource(quoteCoverage?.source);
  if (coverageSource !== 'UNKNOWN') return coverageSource;
  if (!quote) return 'UNKNOWN';
  const priceMetadata = quote.priceMetadata as { source?: unknown } | undefined;
  const provider = [
    priceMetadata?.source,
    quote.quoteProvider,
    quote.provider,
    quote.source,
    quote.priceProvider,
  ].map(value => String(value ?? '').toUpperCase()).join(' ');
  const dataQuality = String(quote.dataQuality ?? '').toUpperCase();
  if (provider.includes('KIS')) return 'KIS_OFFICIAL';
  if (provider.includes('QMP')) return 'QMP_QUOTE';
  if (provider.includes('YAHOO')) return 'YAHOO';
  if (provider.includes('CACHE') || dataQuality.includes('CACHE')) return 'CACHE';
  return 'UNKNOWN';
}

function sourceStatusFromCoverage(
  quote: Record<string, unknown> | null,
  quoteCoverage?: NormalizeLiquidityFloorInput['quoteCoverage'],
): Gate1LiquiditySourceStatus {
  const confidence = String(quoteCoverage?.confidence ?? '').toUpperCase();
  if (confidence === 'VERIFIED') return 'VERIFIED';
  if (confidence === 'STALE') return 'STALE';
  if (confidence === 'MISSING') return 'MISSING';
  if (confidence === 'DEGRADED' || confidence === 'AI_ESTIMATED') return 'DEGRADED';
  if (!quote) return 'MISSING';
  const dataQuality = String(quote.dataQuality ?? '').toUpperCase();
  if (dataQuality.includes('STALE')) return 'STALE';
  if (dataQuality.includes('MISSING')) return 'MISSING';
  return 'UNKNOWN';
}

export function normalizeLiquidityFloorForGate1(input: NormalizeLiquidityFloorInput): Gate1LiquidityFloorDiagnostic {
  const quote = input.quote ?? null;
  const threshold = mergeThresholds(input.thresholds);
  const source = sourceFromQuote(quote, input.quoteCoverage);
  const initialSourceStatus = sourceStatusFromCoverage(quote, input.quoteCoverage);

  if (!quote) {
    return {
      status: 'MISSING',
      volume: null,
      avgVolume20d: null,
      tradingValue: null,
      avgTradingValue20d: null,
      currentPrice: null,
      threshold,
      checks: {
        volumePass: null,
        tradingValuePass: null,
        avgVolumePass: null,
        avgTradingValuePass: null,
      },
      source,
      sourceStatus: 'MISSING',
      reason: 'LIQUIDITY_INPUT_MISSING',
      providerIssue: true,
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
    };
  }

  const currentPrice = positiveNumberOrNull(firstValue(quote, PRICE_ALIASES));
  const volume = positiveNumberOrNull(firstValue(quote, VOLUME_ALIASES));
  const avgVolume20d = positiveNumberOrNull(firstValue(quote, AVG_VOLUME_20D_ALIASES));
  const explicitTradingValue = positiveNumberOrNull(firstValue(quote, TRADING_VALUE_ALIASES));
  const tradingValue = explicitTradingValue ?? (volume != null && currentPrice != null ? volume * currentPrice : null);
  const explicitAvgTradingValue20d = positiveNumberOrNull(firstValue(quote, AVG_TRADING_VALUE_20D_ALIASES));
  const avgTradingValue20d = explicitAvgTradingValue20d
    ?? (avgVolume20d != null && currentPrice != null ? avgVolume20d * currentPrice : null);

  const checks = {
    volumePass: pass(volume, threshold.minVolume),
    tradingValuePass: pass(tradingValue, threshold.minTradingValue),
    avgVolumePass: pass(avgVolume20d, threshold.minAvgVolume20d),
    avgTradingValuePass: pass(avgTradingValue20d, threshold.minAvgTradingValue20d),
  };

  let status: Gate1LiquidityFloorStatus;
  let reason: string | null = null;

  if (currentPrice == null && volume == null && tradingValue == null) {
    status = 'MISSING';
    reason = 'LIQUIDITY_INPUT_MISSING';
  } else if (currentPrice == null || volume == null || tradingValue == null) {
    status = 'MISSING';
    reason = 'LIQUIDITY_INPUT_MISSING';
  } else if (
    checks.volumePass === true
    && checks.tradingValuePass === true
    && checks.avgVolumePass === true
    && checks.avgTradingValuePass === true
  ) {
    status = 'PASS';
  } else if (
    checks.volumePass === true
    && checks.tradingValuePass === true
    && (checks.avgVolumePass === false || checks.avgTradingValuePass === false)
  ) {
    status = 'SPIKE_ONLY';
    reason = 'CURRENT_LIQUIDITY_SPIKE_BUT_AVERAGE_THIN';
  } else if (checks.volumePass === null || checks.tradingValuePass === null) {
    status = 'UNKNOWN';
    reason = 'LIQUIDITY_INPUT_INCOMPLETE';
  } else if (checks.volumePass === false || checks.tradingValuePass === false) {
    status = (checks.avgVolumePass === true || checks.avgTradingValuePass === true) ? 'FAIL' : 'THIN';
    reason = 'LIQUIDITY_BELOW_FLOOR';
  } else {
    status = 'UNKNOWN';
    reason = 'AVERAGE_LIQUIDITY_INPUT_MISSING';
  }

  const sourceStatus: Gate1LiquiditySourceStatus = status === 'MISSING'
    ? 'MISSING'
    : initialSourceStatus === 'MISSING'
      ? 'DEGRADED'
      : initialSourceStatus;
  const providerIssue = status === 'MISSING'
    || sourceStatus === 'MISSING'
    || sourceStatus === 'DEGRADED'
    || sourceStatus === 'UNKNOWN';

  return {
    status,
    volume,
    avgVolume20d,
    tradingValue,
    avgTradingValue20d,
    currentPrice,
    threshold,
    checks,
    source,
    sourceStatus,
    reason,
    providerIssue,
    marketSignal: false,
    executionImpact: 'DIAGNOSTIC_ONLY',
  };
}
