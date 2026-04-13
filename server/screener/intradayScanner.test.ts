import { describe, expect, it, beforeEach } from 'vitest';
import {
  isIntradayStrong,
  resetIntradayScanState,
  VOLUME_SURGE_RATIO,
  MIN_PRICE_CHANGE_PCT,
  MAX_INTRADAY_POSITIONS,
  INTRADAY_POSITION_PCT_FACTOR,
  INTRADAY_STOP_LOSS_PCT,
  INTRADAY_TARGET_PCT,
  INTRADAY_MIN_HOLD_MS,
  CONFIRM_PRICE_CHANGE_PCT,
} from './intradayScanner.js';
import type { YahooQuoteExtended } from './stockScreener.js';

// ── 테스트 헬퍼 ──────────────────────────────────────────────────────────────

function makeQuote(overrides: Partial<YahooQuoteExtended> = {}): YahooQuoteExtended {
  return {
    price:          11_000,
    dayOpen:        10_000,  // 현재가 > 시가 (10% 상승)
    prevClose:       9_900,
    changePercent:   10.0,   // +10% → MIN_PRICE_CHANGE_PCT(3%) 초과
    volume:         600_000,
    avgVolume:      100_000, // volume / avgVolume = 6 → VOLUME_SURGE_RATIO(3) 초과
    ma5:            10_500,
    ma20:           10_000,
    ma60:            9_500,
    high20d:        10_500,  // 현재가(11000) > high20d(10500) → 20일 고점 돌파
    atr:               300,
    atr20avg:          280,
    per:                15,
    rsi14:             65,
    macd:               50,
    macdSignal:         30,
    macdHistogram:      20,
    rsi5dAgo:           55,
    weeklyRSI:          60,
    ma60TrendUp:      true,
    macd5dHistAgo:      10,
    ...overrides,
  };
}

// ── isIntradayStrong 테스트 ──────────────────────────────────────────────────

describe('isIntradayStrong', () => {
  beforeEach(() => {
    resetIntradayScanState();
  });

  it('returns true when all 4 conditions are met', () => {
    const quote = makeQuote();
    expect(isIntradayStrong(quote)).toBe(true);
  });

  it('fails when volume does not surge (volume ≤ avgVolume × VOLUME_SURGE_RATIO)', () => {
    const quote = makeQuote({ volume: 200_000, avgVolume: 100_000 }); // ×2 < ×3
    expect(isIntradayStrong(quote)).toBe(false);
  });

  it('fails exactly at volume = avgVolume × VOLUME_SURGE_RATIO (not strictly greater)', () => {
    const quote = makeQuote({
      volume:    300_000,
      avgVolume: 100_000, // exactly ×3 — not strictly greater
    });
    expect(isIntradayStrong(quote)).toBe(false);
  });

  it('passes when volume is just above surge threshold', () => {
    const quote = makeQuote({
      volume:    300_001,
      avgVolume: 100_000,
    });
    expect(isIntradayStrong(quote)).toBe(true);
  });

  it('fails when price is below or equal to dayOpen', () => {
    const quote = makeQuote({ price: 9_800, dayOpen: 10_000, changePercent: -2.0 });
    expect(isIntradayStrong(quote)).toBe(false);
  });

  it('fails when price equals dayOpen', () => {
    const quote = makeQuote({ price: 10_000, dayOpen: 10_000, changePercent: 0.5 });
    expect(isIntradayStrong(quote)).toBe(false);
  });

  it('fails when changePercent is below MIN_PRICE_CHANGE_PCT', () => {
    const quote = makeQuote({
      price:         10_200,
      dayOpen:       10_000,
      changePercent: MIN_PRICE_CHANGE_PCT - 0.1, // just below threshold
    });
    expect(isIntradayStrong(quote)).toBe(false);
  });

  it('passes when changePercent equals MIN_PRICE_CHANGE_PCT exactly', () => {
    const quote = makeQuote({
      price:         10_300,
      dayOpen:       10_000,
      changePercent: MIN_PRICE_CHANGE_PCT, // exactly at threshold
      high20d:       10_200,               // price(10300) > high20d(10200) — breakout
    });
    expect(isIntradayStrong(quote)).toBe(true);
  });

  it('fails when price does not break above 20-day high', () => {
    const quote = makeQuote({ price: 10_400, high20d: 10_500 }); // below 20d high
    expect(isIntradayStrong(quote)).toBe(false);
  });

  it('fails when high20d is 0 (no data)', () => {
    const quote = makeQuote({ high20d: 0 });
    expect(isIntradayStrong(quote)).toBe(false);
  });

  it('fails when price equals high20d (not strictly greater)', () => {
    const quote = makeQuote({ price: 10_500, high20d: 10_500 });
    expect(isIntradayStrong(quote)).toBe(false);
  });

  it('fails when avgVolume is 0', () => {
    const quote = makeQuote({ avgVolume: 0 });
    expect(isIntradayStrong(quote)).toBe(false);
  });

  it('fails when only 3 out of 4 conditions are met (missing high20d break)', () => {
    const quote = makeQuote({
      price:    10_200, // below high20d
      high20d:  10_500,
      dayOpen:  10_000,
      changePercent: 3.5,
    });
    expect(isIntradayStrong(quote)).toBe(false);
  });

  it('fails when only 3 out of 4 conditions are met (missing volume surge)', () => {
    const quote = makeQuote({
      volume:    250_000,
      avgVolume: 100_000, // ×2.5 < ×3
    });
    expect(isIntradayStrong(quote)).toBe(false);
  });
});

// ── 상수 일관성 테스트 ─────────────────────────────────────────────────────────

describe('intraday scanner constants', () => {
  it('VOLUME_SURGE_RATIO is at least 2x', () => {
    expect(VOLUME_SURGE_RATIO).toBeGreaterThanOrEqual(2);
  });

  it('MIN_PRICE_CHANGE_PCT is positive', () => {
    expect(MIN_PRICE_CHANGE_PCT).toBeGreaterThan(0);
  });

  it('CONFIRM_PRICE_CHANGE_PCT is less than MIN_PRICE_CHANGE_PCT', () => {
    expect(CONFIRM_PRICE_CHANGE_PCT).toBeLessThan(MIN_PRICE_CHANGE_PCT);
    expect(CONFIRM_PRICE_CHANGE_PCT).toBeGreaterThan(0);
  });

  it('MAX_INTRADAY_POSITIONS is a small positive integer', () => {
    expect(MAX_INTRADAY_POSITIONS).toBeGreaterThan(0);
    expect(MAX_INTRADAY_POSITIONS).toBeLessThanOrEqual(5);
    expect(Number.isInteger(MAX_INTRADAY_POSITIONS)).toBe(true);
  });

  it('INTRADAY_POSITION_PCT_FACTOR reduces position size (≤ 0.5)', () => {
    expect(INTRADAY_POSITION_PCT_FACTOR).toBeLessThanOrEqual(0.5);
    expect(INTRADAY_POSITION_PCT_FACTOR).toBeGreaterThan(0);
  });

  it('INTRADAY_STOP_LOSS_PCT is tighter than typical regime stop (-5% or less)', () => {
    expect(INTRADAY_STOP_LOSS_PCT).toBeLessThanOrEqual(0.05);
    expect(INTRADAY_STOP_LOSS_PCT).toBeGreaterThan(0);
  });

  it('INTRADAY_TARGET_PCT gives RRR ≥ 1 relative to stop loss', () => {
    // RRR = target / stop = 0.10 / 0.05 = 2.0 ≥ 1
    expect(INTRADAY_TARGET_PCT / INTRADAY_STOP_LOSS_PCT).toBeGreaterThanOrEqual(1);
  });

  it('INTRADAY_MIN_HOLD_MS is at least 30 minutes', () => {
    const thirtyMinutesMs = 30 * 60 * 1000;
    expect(INTRADAY_MIN_HOLD_MS).toBeGreaterThanOrEqual(thirtyMinutesMs);
  });
});
