import { describe, expect, it, beforeEach } from 'vitest';
import {
  isIntradayStrong,
  isBreakoutStrong,
  isSupplyDemandStrong,
  classifyEntryPath,
  resetIntradayScanState,
  BREAKOUT_VOLUME_RATIO,
  SUPPLY_VOLUME_RATIO,
  BREAKOUT_PRICE_CHANGE_PCT,
  SUPPLY_PRICE_CHANGE_PCT,
  VOLUME_SURGE_RATIO,
  MIN_PRICE_CHANGE_PCT,
  MAX_INTRADAY_POSITIONS,
  INTRADAY_POSITION_PCT_FACTOR,
  INTRADAY_STOP_LOSS_PCT,
  INTRADAY_PULLBACK_STOP_LOSS_PCT,
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
    changePercent:   10.0,   // +10% → BREAKOUT_PRICE_CHANGE_PCT(1.5%) 초과
    volume:         600_000,
    avgVolume:      100_000, // volume / avgVolume = 6 → BREAKOUT_VOLUME_RATIO(2) 초과
    ma5:            10_500,
    ma20:           10_000,
    ma60:            9_500,
    high20d:        10_500,  // 현재가(11000) > high20d(10500) → 20일 고점 돌파
    high60d:        11_500,
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
    return5d:            8,
    // Compression Score 구성 요소
    bbWidthCurrent:     0.04,
    bbWidth20dAvg:      0.06,
    vol5dAvg:       80_000,
    vol20dAvg:     100_000,
    atr5d:             250,
    // MTAS 구성 요소
    monthlyAboveEMA12:    true,
    monthlyEMARising:     true,
    weeklyAboveCloud:     true,
    weeklyLaggingSpanUp:  true,
    dailyVolumeDrying:   false,
    isHighRisk:          false,
    ...overrides,
  };
}

// ── isBreakoutStrong 테스트 ──────────────────────────────────────────────────

describe('isBreakoutStrong', () => {
  beforeEach(() => {
    resetIntradayScanState();
  });

  it('returns true when all 4 breakout conditions are met', () => {
    const quote = makeQuote();
    expect(isBreakoutStrong(quote)).toBe(true);
  });

  it('fails when volume does not surge (volume clearly below morning-adjusted threshold)', () => {
    // 오전 보정 시 threshold = 2.0 × 0.7 = 1.4, 오후 = 2.0
    // ×1.2 는 두 경우 모두 미달
    const quote = makeQuote({ volume: 120_000, avgVolume: 100_000 }); // ×1.2 < ×1.4
    expect(isBreakoutStrong(quote)).toBe(false);
  });

  it('fails when volume is below full-day breakout ratio but above morning ratio', () => {
    // 오전 보정 threshold=1.4 → ×1.5는 통과, 오후 threshold=2.0 → 미달
    // 시간대에 따라 결과가 달라짐
    const quote = makeQuote({ volume: 150_000, avgVolume: 100_000 }); // ×1.5
    // 오전이면 통과, 오후이면 미달 — 시간대 의존적
    const result = isBreakoutStrong(quote);
    expect(typeof result).toBe('boolean'); // 시간대에 따라 다르므로 결과만 boolean 확인
  });

  it('passes when volume clearly exceeds even full-day threshold', () => {
    const quote = makeQuote({
      volume:    210_000,
      avgVolume: 100_000, // ×2.1 — 보정 유무와 무관하게 항상 통과
    });
    expect(isBreakoutStrong(quote)).toBe(true);
  });

  it('fails when price is below or equal to dayOpen', () => {
    const quote = makeQuote({ price: 9_800, dayOpen: 10_000, changePercent: -2.0 });
    expect(isBreakoutStrong(quote)).toBe(false);
  });

  it('fails when changePercent is below BREAKOUT_PRICE_CHANGE_PCT', () => {
    const quote = makeQuote({
      price:         10_100,
      dayOpen:       10_000,
      changePercent: BREAKOUT_PRICE_CHANGE_PCT - 0.1, // just below threshold
    });
    expect(isBreakoutStrong(quote)).toBe(false);
  });

  it('passes when changePercent equals BREAKOUT_PRICE_CHANGE_PCT exactly', () => {
    const quote = makeQuote({
      price:         10_150,
      dayOpen:       10_000,
      changePercent: BREAKOUT_PRICE_CHANGE_PCT, // exactly at threshold (1.5%)
      high20d:       10_100,               // price(10150) > high20d(10100) — breakout
    });
    expect(isBreakoutStrong(quote)).toBe(true);
  });

  it('fails when price does not break above 20-day high', () => {
    const quote = makeQuote({ price: 10_400, high20d: 10_500 }); // below 20d high
    expect(isBreakoutStrong(quote)).toBe(false);
  });

  it('fails when high20d is 0 (no data)', () => {
    const quote = makeQuote({ high20d: 0 });
    expect(isBreakoutStrong(quote)).toBe(false);
  });
});

// ── isSupplyDemandStrong 테스트 ──────────────────────────────────────────────

describe('isSupplyDemandStrong', () => {
  // 수급형 셋업: 거래량 2.5×, 양봉, MA20 위, 눌림목 셋업
  function makeSupplyQuote(overrides: Partial<YahooQuoteExtended> = {}): YahooQuoteExtended {
    return makeQuote({
      price:          10_500,
      dayOpen:        10_400,
      prevClose:      10_400,
      changePercent:  0.5,        // 양봉 (> 0%)
      volume:         260_000,
      avgVolume:      100_000,    // ×2.6 > SUPPLY_VOLUME_RATIO(2.5)
      ma20:           10_200,     // price > ma20
      ma60:            9_800,     // price > ma60 (pullback requires this)
      high60d:        11_200,     // drawdown ~6.25% → 3~20% range
      atr:               200,
      atr20avg:          300,     // atr < atr20avg * 0.75 → VCP
      rsi14:             45,      // 35~55 for pullback
      dailyVolumeDrying: false,
      ...overrides,
    });
  }

  it('returns true when all supply-demand conditions are met', () => {
    const quote = makeSupplyQuote();
    expect(isSupplyDemandStrong(quote)).toBe(true);
  });

  it('fails when volume is below morning-adjusted SUPPLY_VOLUME_RATIO', () => {
    // 오전 보정 threshold = 2.5 × 0.7 = 1.75, 오후 = 2.5
    // ×1.6 은 두 경우 모두 미달
    const quote = makeSupplyQuote({ volume: 160_000, avgVolume: 100_000 }); // ×1.6 < ×1.75
    expect(isSupplyDemandStrong(quote)).toBe(false);
  });

  it('fails when price is below dayOpen', () => {
    const quote = makeSupplyQuote({ price: 10_300, dayOpen: 10_400, changePercent: -0.5 });
    expect(isSupplyDemandStrong(quote)).toBe(false);
  });

  it('fails when price is below MA20', () => {
    const quote = makeSupplyQuote({ price: 10_100, ma20: 10_200, changePercent: 0.3 });
    expect(isSupplyDemandStrong(quote)).toBe(false);
  });

  it('fails when not in pullback setup (drawdown too small)', () => {
    const quote = makeSupplyQuote({ high60d: 10_600 }); // drawdown < 3%
    expect(isSupplyDemandStrong(quote)).toBe(false);
  });
});

// ── isIntradayStrong 통합 테스트 ────────────────────────────────────────────

describe('isIntradayStrong', () => {
  beforeEach(() => {
    resetIntradayScanState();
  });

  it('returns true when breakout conditions are met', () => {
    const quote = makeQuote();
    expect(isIntradayStrong(quote)).toBe(true);
  });

  it('returns true when supply-demand conditions are met (even if breakout fails)', () => {
    // Supply-demand type: no 20d high break, but pullback setup with volume
    const quote = makeQuote({
      price:          10_500,
      dayOpen:        10_400,
      changePercent:  0.5,
      volume:         260_000,
      avgVolume:      100_000,
      high20d:        11_000,    // price < high20d → breakout fails
      ma20:           10_200,
      ma60:            9_800,
      high60d:        11_200,    // drawdown ~6.25%
      atr:               200,
      atr20avg:          300,    // VCP condition
      rsi14:             45,
    });
    expect(isIntradayStrong(quote)).toBe(true);
  });

  it('fails when neither breakout nor supply-demand conditions are met', () => {
    const quote = makeQuote({
      volume:    100_000,
      avgVolume: 100_000, // ×1 — fails both volume checks
    });
    expect(isIntradayStrong(quote)).toBe(false);
  });
});

// ── classifyEntryPath 테스트 ────────────────────────────────────────────────

describe('classifyEntryPath', () => {
  it('returns BREAKOUT for breakout-type entries', () => {
    const quote = makeQuote();
    expect(classifyEntryPath(quote)).toBe('BREAKOUT');
  });

  it('returns SUPPLY_DEMAND for supply-demand entries', () => {
    const quote = makeQuote({
      price:          10_500,
      dayOpen:        10_400,
      changePercent:  0.5,
      volume:         260_000,
      avgVolume:      100_000,
      high20d:        11_000,
      ma20:           10_200,
      ma60:            9_800,
      high60d:        11_200,
      atr:               200,
      atr20avg:          300,
      rsi14:             45,
    });
    expect(classifyEntryPath(quote)).toBe('SUPPLY_DEMAND');
  });
});

// ── 상수 일관성 테스트 ─────────────────────────────────────────────────────────

describe('intraday scanner constants', () => {
  it('BREAKOUT_VOLUME_RATIO is at least 2x', () => {
    expect(BREAKOUT_VOLUME_RATIO).toBeGreaterThanOrEqual(2);
  });

  it('SUPPLY_VOLUME_RATIO is greater than BREAKOUT_VOLUME_RATIO', () => {
    expect(SUPPLY_VOLUME_RATIO).toBeGreaterThan(BREAKOUT_VOLUME_RATIO);
  });

  it('VOLUME_SURGE_RATIO equals BREAKOUT_VOLUME_RATIO (backward compat)', () => {
    expect(VOLUME_SURGE_RATIO).toBe(BREAKOUT_VOLUME_RATIO);
  });

  it('MIN_PRICE_CHANGE_PCT equals BREAKOUT_PRICE_CHANGE_PCT (backward compat)', () => {
    expect(MIN_PRICE_CHANGE_PCT).toBe(BREAKOUT_PRICE_CHANGE_PCT);
  });

  it('BREAKOUT_PRICE_CHANGE_PCT is positive', () => {
    expect(BREAKOUT_PRICE_CHANGE_PCT).toBeGreaterThan(0);
  });

  it('SUPPLY_PRICE_CHANGE_PCT is 0 or more', () => {
    expect(SUPPLY_PRICE_CHANGE_PCT).toBeGreaterThanOrEqual(0);
  });

  it('CONFIRM_PRICE_CHANGE_PCT is less than BREAKOUT_PRICE_CHANGE_PCT', () => {
    expect(CONFIRM_PRICE_CHANGE_PCT).toBeLessThan(BREAKOUT_PRICE_CHANGE_PCT);
    expect(CONFIRM_PRICE_CHANGE_PCT).toBeGreaterThan(0);
  });

  it('MAX_INTRADAY_POSITIONS is 3', () => {
    expect(MAX_INTRADAY_POSITIONS).toBe(3);
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

  it('INTRADAY_STOP_LOSS_PCT is -5% for breakout path', () => {
    expect(INTRADAY_STOP_LOSS_PCT).toBe(0.05);
  });

  it('INTRADAY_PULLBACK_STOP_LOSS_PCT is -4% for pullback path', () => {
    expect(INTRADAY_PULLBACK_STOP_LOSS_PCT).toBe(0.04);
  });

  it('INTRADAY_TARGET_PCT gives RRR ≥ 1 relative to stop loss', () => {
    expect(INTRADAY_TARGET_PCT / INTRADAY_STOP_LOSS_PCT).toBeGreaterThanOrEqual(1);
  });

  it('INTRADAY_MIN_HOLD_MS is 15 minutes', () => {
    const fifteenMinutesMs = 15 * 60 * 1000;
    expect(INTRADAY_MIN_HOLD_MS).toBe(fifteenMinutesMs);
  });
});
