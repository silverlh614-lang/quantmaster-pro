import { describe, expect, it } from 'vitest';
import {
  detectPreBreakoutAccumulation,
  checkNarrowPriceRange,
  checkVolumeDryDown,
  checkHlRangeNarrowing,
  checkBidSupportApprox,
  checkContinuousNetBuy,
  PRE_BREAKOUT_MIN_SIGNS,
  SIGN1_PRICE_RANGE_MAX_PCT,
  SIGN2_VOLUME_RATIO_THRESHOLD,
  SIGN2_CONSECUTIVE_DAYS,
  SIGN3_HL_SHRINK_RATIO,
  SIGN4_ATR_RATIO_THRESHOLD,
} from './preBreakoutAccumulationDetector.js';

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

/** 모든 징후가 충족된 기본 입력 */
function makeFullInput() {
  // 가격 10,000원 기준 좁은 범위 횡보
  const recentCloses  = [9_960, 9_980, 9_990, 9_970, 9_985];
  // 거래량 3일 연속 감소 + 20일 평균의 40% 이하 (avgVolume20d=100_000, 40%=40_000)
  const recentVolumes = [120_000, 38_000, 35_000, 32_000];
  const avgVolume20d  = 100_000;
  // HL 범위 축소: prev3 avg > recent3 avg * 1.18 (> SIGN3_HL_SHRINK_RATIO 역)
  const recentHighs = [10_200, 10_150, 10_120, 10_080, 10_060, 10_050];
  const recentLows  = [9_800,  9_850,  9_880, 9_940,  9_960,  9_970];
  const atrRatio = 0.012;          // 1.2% < 1.5% 임계값
  const foreignNetBuy5d       = 500;
  const institutionalNetBuy5d = 200;
  return { recentCloses, recentVolumes, avgVolume20d, recentHighs, recentLows, atrRatio, foreignNetBuy5d, institutionalNetBuy5d };
}

// ─── 징후 1: 횡보 범위 ───────────────────────────────────────────────────────

describe('checkNarrowPriceRange', () => {
  it('detects narrow range when 5d spread ≤ SIGN1_PRICE_RANGE_MAX_PCT', () => {
    // max=10_000, min=9_800, mid=9_900, range=200/9900≈2.02% < 3%
    const closes = [9_900, 9_950, 10_000, 9_850, 9_800];
    expect(checkNarrowPriceRange(closes)).toBe(true);
  });

  it('does not detect when spread exceeds threshold', () => {
    // max=11_000, min=9_000, mid=10_000, range=2_000/10_000=20% > 3%
    const closes = [9_000, 9_500, 10_000, 10_500, 11_000];
    expect(checkNarrowPriceRange(closes)).toBe(false);
  });

  it('returns false when fewer than 5 closes', () => {
    expect(checkNarrowPriceRange([10_000, 10_010])).toBe(false);
  });

  it('returns false for zero or negative mid price', () => {
    expect(checkNarrowPriceRange([0, 0, 0, 0, 0])).toBe(false);
  });

  it(`respects SIGN1_PRICE_RANGE_MAX_PCT constant (${SIGN1_PRICE_RANGE_MAX_PCT})`, () => {
    const mid = 10_000;
    const halfRange = mid * (SIGN1_PRICE_RANGE_MAX_PCT / 2); // ±1.5%
    const max = mid + halfRange;
    const min = mid - halfRange;
    expect(checkNarrowPriceRange([mid, min, max, mid, mid])).toBe(true);
  });
});

// ─── 징후 2: 거래량 연속 감소 ─────────────────────────────────────────────────

describe('checkVolumeDryDown', () => {
  it('detects 3-day consecutive drop below 40% threshold', () => {
    // avgVolume20d=100_000, threshold=40_000
    // last 3: 39_000, 35_000, 30_000 — all below 40_000, all decreasing
    expect(checkVolumeDryDown([60_000, 39_000, 35_000, 30_000], 100_000)).toBe(true);
  });

  it('rejects when a day is above threshold', () => {
    // day 2 = 45_000 > 40_000
    expect(checkVolumeDryDown([60_000, 45_000, 35_000, 30_000], 100_000)).toBe(false);
  });

  it('rejects when volume increases in consecutive window', () => {
    // day 4 > day 3 — not monotone decreasing
    expect(checkVolumeDryDown([60_000, 38_000, 30_000, 32_000], 100_000)).toBe(false);
  });

  it('returns false with insufficient data', () => {
    expect(checkVolumeDryDown([30_000], 100_000)).toBe(false);
  });

  it('returns false when avgVolume20d is 0', () => {
    expect(checkVolumeDryDown([10_000, 8_000, 6_000, 4_000], 0)).toBe(false);
  });

  it(`uses SIGN2_CONSECUTIVE_DAYS=${SIGN2_CONSECUTIVE_DAYS} and SIGN2_VOLUME_RATIO_THRESHOLD=${SIGN2_VOLUME_RATIO_THRESHOLD}`, () => {
    const avg = 100_000;
    const limit = avg * SIGN2_VOLUME_RATIO_THRESHOLD; // 40_000
    // Exactly at threshold, strictly decreasing
    const vols = [80_000, limit, limit - 100, limit - 200];
    expect(checkVolumeDryDown(vols, avg)).toBe(true);
  });
});

// ─── 징후 3: HL Range 축소 ────────────────────────────────────────────────────

describe('checkHlRangeNarrowing', () => {
  it('detects HL narrowing when recent3 avg < prev3 avg × 0.85', () => {
    // prev3 ranges: 400, 300, 240 → avg=313.3
    // recent3 ranges: 120, 100, 90 → avg=103.3 (< 313.3 * 0.85)
    const highs = [10_200, 10_150, 10_120, 10_080, 10_060, 10_045];
    const lows  = [9_800,  9_850,  9_880, 9_960,  9_960,  9_955];
    expect(checkHlRangeNarrowing(highs, lows)).toBe(true);
  });

  it('does not detect when recent ranges are not shrinking', () => {
    // Flat ranges
    const highs = [10_200, 10_200, 10_200, 10_200, 10_200, 10_200];
    const lows  = [9_800,  9_800,  9_800,  9_800,  9_800,  9_800];
    expect(checkHlRangeNarrowing(highs, lows)).toBe(false);
  });

  it('returns false with fewer than 6 data points', () => {
    expect(checkHlRangeNarrowing([10_200, 10_100], [9_800, 9_900])).toBe(false);
  });

  it(`uses SIGN3_HL_SHRINK_RATIO=${SIGN3_HL_SHRINK_RATIO}`, () => {
    // prev3 ranges all 200 → avg=200, threshold=200*0.85=170
    // recent3 ranges all 160 < 170 → detected
    const h = (base: number, half: number) => base + half;
    const l = (base: number, half: number) => base - half;
    const highs = [h(10_000, 100), h(10_000, 100), h(10_000, 100), h(10_000, 80), h(10_000, 80), h(10_000, 80)];
    const lows  = [l(10_000, 100), l(10_000, 100), l(10_000, 100), l(10_000, 80), l(10_000, 80), l(10_000, 80)];
    expect(checkHlRangeNarrowing(highs, lows)).toBe(true);
  });
});

// ─── 징후 4: 호가 지지 근사 ───────────────────────────────────────────────────

describe('checkBidSupportApprox', () => {
  it('detects low ATR ratio (tight range = bid support)', () => {
    expect(checkBidSupportApprox(0.010)).toBe(true);
  });

  it('detects at exact threshold', () => {
    expect(checkBidSupportApprox(SIGN4_ATR_RATIO_THRESHOLD)).toBe(true);
  });

  it('does not detect when ATR ratio is above threshold', () => {
    expect(checkBidSupportApprox(0.020)).toBe(false);
  });

  it('returns false for zero ATR', () => {
    expect(checkBidSupportApprox(0)).toBe(false);
  });
});

// ─── 징후 5: 수급 순매수 ──────────────────────────────────────────────────────

describe('checkContinuousNetBuy', () => {
  it('detects when both foreign and institutional are positive', () => {
    expect(checkContinuousNetBuy(500, 200)).toBe(true);
  });

  it('detects when only foreign is positive', () => {
    expect(checkContinuousNetBuy(100, -50)).toBe(true);
  });

  it('detects when only institutional is positive', () => {
    expect(checkContinuousNetBuy(-100, 300)).toBe(true);
  });

  it('does not detect when both are zero or negative', () => {
    expect(checkContinuousNetBuy(0, 0)).toBe(false);
    expect(checkContinuousNetBuy(-100, -200)).toBe(false);
  });
});

// ─── detectPreBreakoutAccumulation — 종합 판단 ──────────────────────────────

describe('detectPreBreakoutAccumulation', () => {
  it(`signals accumulating when all 5 signs are met`, () => {
    const result = detectPreBreakoutAccumulation(makeFullInput());
    expect(result.detectedSigns).toBe(5);
    expect(result.isAccumulating).toBe(true);
    expect(result.summary).toContain('30% 선취매 권고');
  });

  it(`signals accumulating with exactly ${PRE_BREAKOUT_MIN_SIGNS} signs`, () => {
    const input = makeFullInput();
    // Disable sign 5 by making net buy negative
    input.foreignNetBuy5d       = -100;
    input.institutionalNetBuy5d = -50;
    const result = detectPreBreakoutAccumulation(input);
    expect(result.detectedSigns).toBe(4);
    expect(result.isAccumulating).toBe(true);
  });

  it(`does not signal when only ${PRE_BREAKOUT_MIN_SIGNS - 1} signs are met`, () => {
    const input = makeFullInput();
    // Disable signs 4 and 5
    input.atrRatio              = 0.05; // Too high — sign 4 fails
    input.foreignNetBuy5d       = -100;
    input.institutionalNetBuy5d = -50;
    const result = detectPreBreakoutAccumulation(input);
    expect(result.detectedSigns).toBe(3);
    expect(result.isAccumulating).toBe(false);
    expect(result.summary).toContain('매집 미감지');
  });

  it('returns false for all signs when data is insufficient', () => {
    const result = detectPreBreakoutAccumulation({
      recentCloses:        [10_000],
      recentVolumes:       [5_000],
      avgVolume20d:        100_000,
      recentHighs:         [10_100],
      recentLows:          [9_900],
      atrRatio:            0.05,
      foreignNetBuy5d:     0,
      institutionalNetBuy5d: 0,
    });
    expect(result.isAccumulating).toBe(false);
    expect(result.detectedSigns).toBeLessThan(PRE_BREAKOUT_MIN_SIGNS);
  });

  it('includes detected sign names in summary', () => {
    const result = detectPreBreakoutAccumulation(makeFullInput());
    expect(result.summary).toContain('①횡보VCP');
    expect(result.summary).toContain('②거래량감소');
    expect(result.summary).toContain('③HL축소');
    expect(result.summary).toContain('④호가지지');
    expect(result.summary).toContain('⑤수급순매수');
  });

  it('correctly populates signDetail flags', () => {
    const result = detectPreBreakoutAccumulation(makeFullInput());
    expect(result.signDetail.narrowPriceRange).toBe(true);
    expect(result.signDetail.volumeDryDown).toBe(true);
    expect(result.signDetail.hlRangeNarrowing).toBe(true);
    expect(result.signDetail.bidSupportApprox).toBe(true);
    expect(result.signDetail.continuousNetBuy).toBe(true);
  });
});
