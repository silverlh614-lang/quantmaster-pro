// @responsibility Gate1 liquidity floor diagnostic normalization only.

export type Gate1LiquidityFloorStatus =
  | 'PASS'
  | 'FAIL'
  | 'THIN'
  | 'SPIKE_ONLY'
  | 'OPENING_RAMP'
  | 'MISSING'
  | 'UNKNOWN';

/**
 * OPENING_RAMP soft-pass 세션 인지 입력.
 * 개장 직후엔 intraday 누적거래량(acml_vol)이 자연 저조하므로,
 * 상시 유동(20일 평균 통과) 종목이 개장초 현재거래량 미달로 FAIL 되는 오탈락을 방지한다.
 * SPIKE_ONLY 의 대칭: avg 통과 + current 저조 + early session → OPENING_RAMP.
 */
export interface Gate1LiquiditySessionContext {
  /** 평가 시점(KST 환산용). marketSession 이 명시되면 우선이지만, early-session 판정엔 시각도 사용. */
  now?: unknown;
  /** 명시적 세션 라벨(REGULAR/OPEN 등). early-session 판정의 보조 입력. */
  marketSession?: unknown;
  /** 개장 후 경과 분(이미 계산돼 있으면 우선 사용). */
  minutesSinceOpen?: number | null;
}

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
    /** KIS official quote 의 정본 timestamp. early-session 판정의 1순위 시각 소스. */
    asOf?: unknown;
  } | null;
  /** 세션 인지 OPENING_RAMP soft-pass 입력. 미제공 시 quote 내부 필드에서 best-effort 추출. */
  session?: Gate1LiquiditySessionContext | null;
}

/** 개장(09:00 KST) 후 이 시간(분) 이내를 early session(개장초 ramp)으로 본다. */
export const GATE1_OPENING_RAMP_WINDOW_MINUTES = 30;
const KST_MARKET_OPEN_MINUTES = 9 * 60;

/**
 * ADR-0157 정확 비교. default true(신규 OPENING_RAMP soft-pass).
 * GATE1_LIQUIDITY_OPENING_RAMP_ENABLED='false' 시 기존 FAIL 동작 byte-equivalent 복원.
 */
function openingRampEnabled(): boolean {
  return process.env.GATE1_LIQUIDITY_OPENING_RAMP_ENABLED !== 'false';
}

function kstMinutesOfDay(value: unknown): number | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value as string | number);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '');
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? '');
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

/**
 * early session(개장초) 여부.
 * 1) minutesSinceOpen 명시 → 0 <= x <= window.
 * 2) now(시각) → KST 분으로 환산해 [09:00, 09:00+window] 구간.
 * marketSession 라벨만으로는 경과시간을 알 수 없으므로 early 로 단정하지 않는다(mid-session dry-up 보호).
 */
function isEarlySession(session: Gate1LiquiditySessionContext | null | undefined): boolean {
  if (!session) return false;
  if (typeof session.minutesSinceOpen === 'number' && Number.isFinite(session.minutesSinceOpen)) {
    return session.minutesSinceOpen >= 0 && session.minutesSinceOpen <= GATE1_OPENING_RAMP_WINDOW_MINUTES;
  }
  const minutes = kstMinutesOfDay(session.now);
  if (minutes == null) return false;
  return minutes >= KST_MARKET_OPEN_MINUTES
    && minutes <= KST_MARKET_OPEN_MINUTES + GATE1_OPENING_RAMP_WINDOW_MINUTES;
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

function resolveSessionContext(
  quote: Record<string, unknown> | null,
  quoteCoverage: NormalizeLiquidityFloorInput['quoteCoverage'],
  session?: Gate1LiquiditySessionContext | null,
): Gate1LiquiditySessionContext | null {
  // 정본 평가시각: KIS official coverage.asOf → quote.priceMetadata.asOf 순.
  // top-level now/asOf/fetchedAt 는 quote 스키마에 존재하지 않아 항상 미부착이므로
  // canonical asOf 를 시각 소스로 사용한다(데이터 부착 정합).
  const canonicalAsOf =
    quoteCoverage?.asOf
    ?? (quote?.priceMetadata as { asOf?: unknown } | undefined)?.asOf
    ?? null;
  if (session) {
    // 명시 세션이라도 minutesSinceOpen/now 가 비어 있으면 canonical asOf 로 backfill.
    if (typeof session.minutesSinceOpen === 'number' || session.now != null) return session;
    if (canonicalAsOf == null) return session;
    return { ...session, now: canonicalAsOf };
  }
  if (!quote) {
    return canonicalAsOf == null ? null : { now: canonicalAsOf };
  }
  const now = quote.now ?? quote.currentTime ?? quote.timeKst ?? quote.marketTimeKst
    ?? canonicalAsOf ?? quote.asOf ?? quote.fetchedAt;
  const marketSession = quote.marketSession ?? quote.marketSessionState ?? quote.session ?? quote.tradingSession;
  if (now == null && marketSession == null) return null;
  return { now, marketSession };
}

export function normalizeLiquidityFloorForGate1(input: NormalizeLiquidityFloorInput): Gate1LiquidityFloorDiagnostic {
  const quote = input.quote ?? null;
  const threshold = mergeThresholds(input.thresholds);
  const source = sourceFromQuote(quote, input.quoteCoverage);
  const initialSourceStatus = sourceStatusFromCoverage(quote, input.quoteCoverage);
  const session = resolveSessionContext(quote, input.quoteCoverage, input.session);

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
  } else if (
    openingRampEnabled()
    && checks.avgVolumePass === true
    && checks.avgTradingValuePass === true
    && (checks.volumePass === false || checks.tradingValuePass === false)
    && isEarlySession(session)
  ) {
    // 상시 유동(20일 평균 통과)인데 개장초 intraday 누적이 자연 저조 → soft-pass.
    // SPIKE_ONLY 의 대칭. mid-session 실제 dry-up(early session 아님)은 아래 FAIL 로 빠진다.
    status = 'OPENING_RAMP';
    reason = 'OPENING_RAMP_AVG_LIQUID_CURRENT_RAMPING';
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
