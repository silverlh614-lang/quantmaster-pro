// @responsibility Gate3 price confirmation builder for LastTrigger timing diagnostics.

type Gate3PriceConfirmationStatus =
  | 'BREAKOUT_CONFIRMED'
  | 'NEAR_BREAKOUT'
  | 'PULLBACK_ENTRY'
  | 'NOT_CONFIRMED'
  | 'OVEREXTENDED'
  | 'DATA_UNAVAILABLE';

export interface Gate3PriceConfirmation {
  status: Gate3PriceConfirmationStatus;
  currentPrice: number | null;
  high5d: number | null;
  high20d: number | null;
  boxHigh: number | null;
  ma20: number | null;
  atr14: number | null;
  distanceToHigh20dPct: number | null;
  extensionFromMa20Pct: number | null;
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

function firstPositive(source: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = positive(source[key]);
    if (value != null) return value;
  }
  return null;
}

function pctDistance(value: number | null, reference: number | null): number | null {
  return value != null && reference != null && reference > 0
    ? (value - reference) / reference * 100
    : null;
}

/** ADR-0598 G2 — 이격 검증불가(ma20 결손) 시 BREAKOUT_CONFIRMED 보수화 스위치
 *  (정확 비교, default OFF byte-equivalent — OFF 시 observe note 만 추가). */
function isGate3ExtensionGuardStrictEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GATE3_EXTENSION_GUARD_STRICT_ENABLED === 'true';
}

export function buildGate3PriceConfirmation(
  quote: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Gate3PriceConfirmation {
  const currentPrice = firstPositive(quote, ['currentPrice', 'price', 'close', 'regularMarketPrice']);
  const high5d = firstPositive(quote, ['high5d']);
  const high20d = firstPositive(quote, ['high20d']);
  const boxHigh = firstPositive(quote, ['boxHigh', 'boxTop', 'recentResistance']);
  const ma20 = firstPositive(quote, ['ma20', 'baselinePrice', 'baseLine', 'kijunLine']);
  const atr14 = firstPositive(quote, ['atr14', 'atr', 'atr5d']);
  const distanceToHigh20dPct = pctDistance(currentPrice, high20d);
  const extensionFromMa20Pct = pctDistance(currentPrice, ma20);
  const missingFields: string[] = [];
  const notes: string[] = [];

  if (currentPrice == null) {
    return {
      status: 'DATA_UNAVAILABLE',
      currentPrice,
      high5d,
      high20d,
      boxHigh,
      ma20,
      atr14,
      distanceToHigh20dPct,
      extensionFromMa20Pct,
      source: 'MISSING',
      missingFields: ['currentPrice'],
      notes: ['PRICE_CONFIRMATION_PRICE_MISSING'],
      marketSignal: false,
    };
  }

  if (high20d == null && boxHigh == null && ma20 == null) {
    missingFields.push('high20d_or_boxHigh_or_ma20');
    return {
      status: 'DATA_UNAVAILABLE',
      currentPrice,
      high5d,
      high20d,
      boxHigh,
      ma20,
      atr14,
      distanceToHigh20dPct,
      extensionFromMa20Pct,
      source: 'MISSING',
      missingFields,
      notes: ['PRICE_CONFIRMATION_REFERENCE_MISSING'],
      marketSignal: false,
    };
  }

  const atrExtended = ma20 != null && atr14 != null && currentPrice >= ma20 + (3 * atr14);
  if ((extensionFromMa20Pct != null && extensionFromMa20Pct >= 12) || atrExtended) {
    if (atrExtended) notes.push('PRICE_EXTENDED_OVER_3ATR');
    return {
      status: 'OVEREXTENDED',
      currentPrice,
      high5d,
      high20d,
      boxHigh,
      ma20,
      atr14,
      distanceToHigh20dPct,
      extensionFromMa20Pct,
      source: 'TECHNICAL_CONTEXT',
      missingFields,
      notes,
      marketSignal: false,
    };
  }

  const breakoutConfirmed =
    (high20d != null && currentPrice >= high20d * 1.002)
    || (boxHigh != null && currentPrice >= boxHigh * 1.002);
  if (breakoutConfirmed) {
    // ADR-0598 G2 — ma20 결손이면 이격(≥12%)·3ATR 과확장 체크가 모두 단락되어 "결손=통과"가
    // 된다 (과확장일수록 신고가 돌파는 자동 충족 — 역설 구조). strict flag ON 시 확정을
    // 보류(NOT_CONFIRMED=WAIT, bearish 변환 아님 — 불변식 #6), OFF 시 observe note 만.
    if (ma20 == null) {
      missingFields.push('ma20');
      if (isGate3ExtensionGuardStrictEnabled(env)) {
        notes.push('BREAKOUT_EXTENSION_UNVERIFIABLE_MA20_MISSING_STRICT_BLOCK');
        return {
          status: 'NOT_CONFIRMED',
          currentPrice,
          high5d,
          high20d,
          boxHigh,
          ma20,
          atr14,
          distanceToHigh20dPct,
          extensionFromMa20Pct,
          source: 'OHLCV',
          missingFields,
          notes,
          marketSignal: false,
        };
      }
      notes.push('EXTENSION_UNVERIFIABLE_MA20_MISSING_OBSERVE');
    }
    return {
      status: 'BREAKOUT_CONFIRMED',
      currentPrice,
      high5d,
      high20d,
      boxHigh,
      ma20,
      atr14,
      distanceToHigh20dPct,
      extensionFromMa20Pct,
      source: 'OHLCV',
      missingFields,
      notes,
      marketSignal: false,
    };
  }

  const nearBreakout =
    (high20d != null && currentPrice >= high20d * 0.985)
    || (boxHigh != null && currentPrice >= boxHigh * 0.985);
  if (nearBreakout) {
    return {
      status: 'NEAR_BREAKOUT',
      currentPrice,
      high5d,
      high20d,
      boxHigh,
      ma20,
      atr14,
      distanceToHigh20dPct,
      extensionFromMa20Pct,
      source: 'OHLCV',
      missingFields,
      notes,
      marketSignal: false,
    };
  }

  const withinMa20Pullback = ma20 != null && currentPrice >= ma20 * 0.99 && currentPrice <= ma20 * 1.03;
  const withinHigh20dDrawdown = high20d == null || currentPrice >= high20d * 0.92;
  if (withinMa20Pullback && withinHigh20dDrawdown) {
    return {
      status: 'PULLBACK_ENTRY',
      currentPrice,
      high5d,
      high20d,
      boxHigh,
      ma20,
      atr14,
      distanceToHigh20dPct,
      extensionFromMa20Pct,
      source: 'TECHNICAL_CONTEXT',
      missingFields,
      notes,
      marketSignal: false,
    };
  }

  return {
    status: 'NOT_CONFIRMED',
    currentPrice,
    high5d,
    high20d,
    boxHigh,
    ma20,
    atr14,
    distanceToHigh20dPct,
    extensionFromMa20Pct,
    source: high20d != null || boxHigh != null ? 'OHLCV' : 'TECHNICAL_CONTEXT',
    missingFields,
    notes,
    marketSignal: false,
  };
}
