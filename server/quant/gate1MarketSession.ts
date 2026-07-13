// @responsibility Gate1 market-session compatibility diagnostics only.

type Gate1MarketSession =
  | 'PREMARKET'
  | 'REGULAR'
  | 'SELL_ONLY'
  | 'LUNCH'
  | 'AFTERMARKET'
  | 'CLOSED'
  | 'HOLIDAY'
  | 'UNKNOWN';

type Gate1MarketSessionEngineMode =
  | 'NORMAL'
  | 'DEGRADED'
  | 'SELL_ONLY'
  | 'SHADOW_ONLY'
  | 'OBSERVE_ONLY'
  | 'UNKNOWN';

type Gate1SellOnlyWindow =
  | 'OPENING_0900_0930'
  | 'LUNCH_1200_1259'
  | 'CLOSING_1520_1530';

type Gate1MarketSessionSource =
  | 'ENGINE_MODE'
  | 'MARKET_CLOCK'
  | 'KIS_HOLIDAY'
  | 'QMP_SESSION'
  | 'UNKNOWN';

type Gate1MarketSessionSourceStatus =
  | 'VERIFIED'
  | 'STALE'
  | 'MISSING'
  | 'DEGRADED'
  | 'UNKNOWN';

export interface Gate1MarketSessionCompatibilityDiagnostic {
  session: Gate1MarketSession;
  engineMode: Gate1MarketSessionEngineMode;
  liveBuyAllowed: boolean;
  liveSellAllowed: boolean;
  shadowAllowed: boolean;
  observeAllowed: boolean;
  caseRecordingAllowed: boolean;
  reason: string | null;
  timeKst: string | null;
  tradingDate: string | null;
  sellOnlyWindow: {
    active: boolean;
    matchedWindow: Gate1SellOnlyWindow | null;
  };
  source: Gate1MarketSessionSource;
  sourceStatus: Gate1MarketSessionSourceStatus;
  providerIssue: boolean;
  marketSignal: false;
  executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY' | 'LIVE_BUY_BLOCKED_ONLY';
}

export interface NormalizeMarketSessionForGate1Input {
  now?: unknown;
  timezone?: 'Asia/Seoul';
  engineMode?: unknown;
  marketSession?: unknown;
  matchedWindow?: unknown;
  marketClock?: unknown;
  kisHolidayStatus?: unknown;
}

interface KstParts {
  iso: string;
  tradingDate: string;
  minutes: number;
  weekday: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function normalizeGate1MarketSession(value: unknown): Gate1MarketSession {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return 'UNKNOWN';
  if (raw === 'REGULAR' || raw === 'OPEN' || raw === 'MARKET_OPEN' || raw === 'BUY_ALLOWED') return 'REGULAR';
  if (raw === 'PREMARKET' || raw === 'PRE_MARKET' || raw === 'PREOPEN' || raw === 'PRE_OPEN') return 'PREMARKET';
  if (raw === 'AFTERMARKET' || raw === 'AFTER_MARKET' || raw === 'AFTER_HOURS') return 'AFTERMARKET';
  if (raw === 'LUNCH' || raw === 'MIDDAY_BREAK') return 'LUNCH';
  if (raw === 'SELL_ONLY' || raw === 'SELL_ONLY_MODE') return 'SELL_ONLY';
  if (raw === 'HOLIDAY' || raw === 'NON_TRADING_DAY') return 'HOLIDAY';
  if (raw === 'CLOSED' || raw === 'MARKET_CLOSED') return 'CLOSED';
  return 'UNKNOWN';
}

function normalizeEngineMode(value: unknown): Gate1MarketSessionEngineMode {
  const raw = String(value ?? '').trim().toUpperCase();
  if (raw === 'NORMAL') return 'NORMAL';
  if (raw === 'DEGRADED') return 'DEGRADED';
  if (raw === 'SELL_ONLY') return 'NORMAL';
  if (raw === 'SHADOW_ONLY') return 'SHADOW_ONLY';
  if (raw === 'OBSERVE_ONLY') return 'OBSERVE_ONLY';
  return 'UNKNOWN';
}

function normalizeSellOnlyWindow(value: unknown): Gate1SellOnlyWindow | null {
  const raw = String(value ?? '').trim().toUpperCase();
  if (raw === 'OPENING_0900_0930') return 'OPENING_0900_0930';
  if (raw === 'LUNCH_1200_1259') return 'LUNCH_1200_1259';
  if (raw === 'CLOSING_1520_1530') return 'CLOSING_1520_1530';
  return null;
}

function toDate(value: unknown): Date | null {
  if (value == null) return null;
  if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toKstParts(date: Date | null): KstParts | null {
  if (!date) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(date);
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  const year = value('year');
  const month = value('month');
  const day = value('day');
  const hour = value('hour');
  const minute = value('minute');
  const second = value('second');
  const weekdayText = value('weekday');
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = weekdayMap[weekdayText] ?? date.getUTCDay();
  return {
    iso: `${year}-${month}-${day}T${hour}:${minute}:${second}+09:00`,
    tradingDate: `${year}-${month}-${day}`,
    minutes: Number(hour) * 60 + Number(minute),
    weekday,
  };
}

function sellOnlyWindowForMinutes(minutes: number): Gate1SellOnlyWindow | null {
  if (minutes >= 9 * 60 && minutes < 9 * 60 + 30) return 'OPENING_0900_0930';
  // ADR-0552: 점심 12:00~12:59 sellOnly 제거 — KRX 점심 휴장 폐지 반영(잔재 제거).
  if (minutes >= 15 * 60 + 20 && minutes < 15 * 60 + 30) return 'CLOSING_1520_1530';
  return null;
}

function sessionFromKst(parts: KstParts): Gate1MarketSession {
  if (parts.weekday === 0 || parts.weekday === 6) return 'HOLIDAY';
  const sellOnly = sellOnlyWindowForMinutes(parts.minutes);
  if (sellOnly) return 'REGULAR';
  if (parts.minutes < 9 * 60) return 'PREMARKET';
  if (parts.minutes >= 9 * 60 + 30 && parts.minutes < 15 * 60 + 20) return 'REGULAR';
  if (parts.minutes >= 15 * 60 + 30 && parts.minutes < 18 * 60) return 'AFTERMARKET';
  return 'CLOSED';
}

function holidayActive(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const record = asRecord(value);
  const direct = boolOrNull(record.holiday ?? record.isHoliday ?? record.closed);
  if (direct != null) return direct;
  const tradingDay = boolOrNull(record.isTradingDay ?? record.tradingDay);
  if (tradingDay != null) return !tradingDay;
  const status = stringOrNull(record.status ?? record.session);
  if (status) {
    const normalized = status.toUpperCase();
    if (normalized === 'HOLIDAY' || normalized === 'NON_TRADING_DAY' || normalized === 'CLOSED') return true;
    if (normalized === 'TRADING_DAY' || normalized === 'OPEN') return false;
  }
  return null;
}

function marketClockSession(value: unknown): Gate1MarketSession {
  const record = asRecord(value);
  return normalizeGate1MarketSession(
    record.marketSession
      ?? record.marketSessionState
      ?? record.session
      ?? record.sessionState
      ?? record.state,
  );
}

function sourceStatusFromRecord(value: unknown): Gate1MarketSessionSourceStatus {
  const record = asRecord(value);
  const raw = String(record.sourceStatus ?? record.status ?? '').trim().toUpperCase();
  if (raw.includes('VERIFIED') || raw === 'OK' || raw === 'OPEN' || raw === 'TRADING_DAY') return 'VERIFIED';
  if (raw.includes('STALE')) return 'STALE';
  if (raw.includes('MISSING')) return 'MISSING';
  if (raw.includes('DEGRADED') || raw.includes('ERROR')) return 'DEGRADED';
  return Object.keys(record).length > 0 ? 'VERIFIED' : 'UNKNOWN';
}

function reasonFor(input: {
  session: Gate1MarketSession;
  engineMode: Gate1MarketSessionEngineMode;
  matchedWindow: Gate1SellOnlyWindow | null;
  liveBuyAllowed: boolean;
  holiday: boolean;
}): string | null {
  if (input.holiday) return 'KIS_HOLIDAY';
  if (input.liveBuyAllowed) return null;
  if (input.session === 'CLOSED') return 'MARKET_CLOSED';
  if (input.session === 'PREMARKET') return 'MARKET_PREMARKET';
  if (input.session === 'AFTERMARKET') return 'MARKET_AFTERMARKET';
  if (input.session === 'UNKNOWN') return 'MARKET_SESSION_UNKNOWN';
  if (input.engineMode === 'SHADOW_ONLY') return 'ENGINE_MODE_SHADOW_ONLY';
  if (input.engineMode === 'OBSERVE_ONLY') return 'ENGINE_MODE_OBSERVE_ONLY';
  return `${input.session}_LIVE_BUY_NOT_ALLOWED_DIAGNOSTIC`;
}

export function normalizeMarketSessionForGate1(
  input: NormalizeMarketSessionForGate1Input = {},
): Gate1MarketSessionCompatibilityDiagnostic {
  const marketClock = asRecord(input.marketClock);
  const now = toDate(input.now ?? marketClock.now ?? marketClock.time ?? marketClock.timeKst ?? null);
  const kst = toKstParts(now);
  const engineMode = normalizeEngineMode(
    input.engineMode
      ?? marketClock.engineMode
      ?? marketClock.executionMode,
  );
  const holiday = holidayActive(input.kisHolidayStatus);
  const explicitSession = normalizeGate1MarketSession(input.marketSession);
  const clockSession = marketClockSession(input.marketClock);
  let source: Gate1MarketSessionSource = 'UNKNOWN';
  let sourceStatus: Gate1MarketSessionSourceStatus = 'UNKNOWN';
  let session: Gate1MarketSession = 'UNKNOWN';

  if (holiday === true) {
    session = 'HOLIDAY';
    source = 'KIS_HOLIDAY';
    sourceStatus = sourceStatusFromRecord(input.kisHolidayStatus) === 'UNKNOWN' ? 'VERIFIED' : sourceStatusFromRecord(input.kisHolidayStatus);
  } else if (explicitSession !== 'UNKNOWN') {
    session = explicitSession;
    source = 'QMP_SESSION';
    sourceStatus = 'VERIFIED';
  } else if (clockSession !== 'UNKNOWN') {
    session = clockSession;
    source = 'MARKET_CLOCK';
    sourceStatus = sourceStatusFromRecord(input.marketClock);
  } else if (kst) {
    session = sessionFromKst(kst);
    source = session === 'HOLIDAY' ? 'MARKET_CLOCK' : 'MARKET_CLOCK';
    sourceStatus = 'VERIFIED';
  }

  const matchedWindow = null;
  const sellOnlyActive = false;
  const effectiveEngineMode: Gate1MarketSessionEngineMode =
    session === 'SELL_ONLY'
      ? 'SELL_ONLY'
      : engineMode !== 'UNKNOWN'
        ? engineMode
        : session === 'CLOSED' || session === 'HOLIDAY'
          ? 'OBSERVE_ONLY'
          : session === 'REGULAR' || session === 'LUNCH'
            ? 'NORMAL'
            : 'UNKNOWN';
  const liveBuyAllowed = effectiveEngineMode === 'NORMAL' || effectiveEngineMode === 'DEGRADED' || effectiveEngineMode === 'UNKNOWN';
  const liveSellAllowed = (session === 'REGULAR' || session === 'LUNCH' || session === 'SELL_ONLY')
    && effectiveEngineMode !== 'SHADOW_ONLY'
    && effectiveEngineMode !== 'OBSERVE_ONLY';
  const reason = reasonFor({
    session,
    engineMode: effectiveEngineMode,
    matchedWindow,
    liveBuyAllowed,
    holiday: holiday === true,
  });
  const providerIssue = sourceStatus === 'MISSING' || sourceStatus === 'DEGRADED';

  return {
    session,
    engineMode: effectiveEngineMode,
    liveBuyAllowed,
    liveSellAllowed,
    shadowAllowed: true,
    observeAllowed: true,
    caseRecordingAllowed: true,
    reason,
    timeKst: kst?.iso ?? null,
    tradingDate: kst?.tradingDate ?? null,
    sellOnlyWindow: {
      active: sellOnlyActive,
      matchedWindow,
    },
    source,
    sourceStatus,
    providerIssue,
    marketSignal: false,
    executionImpact: 'DIAGNOSTIC_ONLY',
  };
}
