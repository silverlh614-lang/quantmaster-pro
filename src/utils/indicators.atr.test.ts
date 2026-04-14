import { describe, expect, it } from 'vitest';
import { calculateATR } from './indicators';

// ─── 기본 ATR 계산 ──────────────────────────────────────────────────────────

describe('calculateATR', () => {
  it('period=3 일 때 Wilder 평활화 ATR 계산', () => {
    // 4일 데이터 → 3개의 True Range → period=3이므로 SMA만
    const highs  = [110, 115, 112, 120];
    const lows   = [100, 105, 102, 108];
    const closes = [105, 110, 108, 115];

    // TR[0] = max(115-105, |115-105|, |105-105|) = max(10, 10, 0) = 10
    // TR[1] = max(112-102, |112-110|, |102-110|) = max(10, 2, 8) = 10
    // TR[2] = max(120-108, |120-108|, |108-108|) = max(12, 12, 0) = 12
    // SMA(3) = (10 + 10 + 12) / 3 ≈ 10.667
    const atr = calculateATR(highs, lows, closes, 3);
    expect(atr).toBeCloseTo(10.667, 2);
  });

  it('period보다 데이터가 적으면 가용 데이터로 평균', () => {
    const highs  = [110, 120];
    const lows   = [100, 105];
    const closes = [105, 115];

    // TR[0] = max(120-105, |120-105|, |105-105|) = max(15, 15, 0) = 15
    // 데이터 1개 → 14봉 미달 → 평균 = 15
    const atr = calculateATR(highs, lows, closes, 14);
    expect(atr).toBe(15);
  });

  it('데이터가 1개 이하이면 0 반환', () => {
    expect(calculateATR([100], [90], [95])).toBe(0);
    expect(calculateATR([], [], [])).toBe(0);
  });

  it('Wilder 평활화: period 이후 데이터는 EMA 방식으로 계산', () => {
    // 5일 데이터 → 4개의 True Range, period=2
    const highs  = [110, 115, 112, 120, 118];
    const lows   = [100, 105, 102, 108, 110];
    const closes = [105, 110, 108, 115, 114];

    // TR[0] = max(115-105, |115-105|, |105-105|) = 10
    // TR[1] = max(112-102, |112-110|, |102-110|) = 10
    // TR[2] = max(120-108, |120-108|, |108-108|) = 12
    // TR[3] = max(118-110, |118-115|, |110-115|) = max(8, 3, 5) = 8

    // SMA(first 2) = (10 + 10) / 2 = 10
    // Wilder step 1: (10 * 1 + 12) / 2 = 11
    // Wilder step 2: (11 * 1 + 8) / 2 = 9.5
    const atr = calculateATR(highs, lows, closes, 2);
    expect(atr).toBeCloseTo(9.5, 1);
  });

  it('기본 period = 14', () => {
    // 데이터가 충분하지 않을 때 fallback 확인
    const highs  = Array.from({ length: 5 }, (_, i) => 100 + i * 2);
    const lows   = Array.from({ length: 5 }, (_, i) => 90 + i * 2);
    const closes = Array.from({ length: 5 }, (_, i) => 95 + i * 2);

    const atr = calculateATR(highs, lows, closes); // default period=14
    expect(atr).toBeGreaterThan(0);
  });

  it('변동성이 큰 종목 vs 작은 종목 — ATR 차이 반영', () => {
    // 변동성 큰 종목: 일중 범위 20%
    const volatileHighs  = [120, 125, 130, 128, 135];
    const volatileLows   = [100, 102, 105, 103, 110];
    const volatileCloses = [110, 115, 120, 115, 125];

    // 변동성 작은 종목: 일중 범위 2%
    const stableHighs  = [102, 103, 104, 103, 105];
    const stableLows   = [100, 101, 102, 101, 103];
    const stableCloses = [101, 102, 103, 102, 104];

    const atrVolatile = calculateATR(volatileHighs, volatileLows, volatileCloses, 3);
    const atrStable   = calculateATR(stableHighs, stableLows, stableCloses, 3);

    expect(atrVolatile).toBeGreaterThan(atrStable * 5);
  });
});
