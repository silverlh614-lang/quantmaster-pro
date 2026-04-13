import { describe, expect, it } from 'vitest';
import {
  computeHybridZone,
  assignPercentileZones,
  isStrongBuyQualified,
  normalizeScore,
  FINAL_SCORE_MAX,
} from './quant/percentileClassifier';
import type { ScoredEntry } from './quant/percentileClassifier';

// ─── normalizeScore ──────────────────────────────────────────────────────────
describe('normalizeScore', () => {
  it('만점(FINAL_SCORE_MAX)에서 100 반환', () => {
    expect(normalizeScore(FINAL_SCORE_MAX)).toBe(100);
  });

  it('0점에서 0 반환', () => {
    expect(normalizeScore(0)).toBe(0);
  });

  it('음수 입력 시 0으로 클램프', () => {
    expect(normalizeScore(-10)).toBe(0);
  });

  it('초과 입력 시 100으로 클램프', () => {
    expect(normalizeScore(FINAL_SCORE_MAX * 2)).toBe(100);
  });

  it('중간 점수 정규화 (50%)', () => {
    expect(normalizeScore(FINAL_SCORE_MAX / 2)).toBeCloseTo(50, 1);
  });
});

// ─── computeHybridZone ───────────────────────────────────────────────────────
describe('computeHybridZone', () => {
  it('정규화점수 ≥ 85 AND 퍼센타일 < 0.10 → STRONG_BUY', () => {
    expect(computeHybridZone(90, 0.05)).toBe('STRONG_BUY');
    expect(computeHybridZone(85, 0.09)).toBe('STRONG_BUY');
  });

  it('정규화점수 ≥ 85 이지만 퍼센타일 ≥ 0.10 → BUY (하이브리드 강등)', () => {
    expect(computeHybridZone(90, 0.15)).toBe('BUY');
    expect(computeHybridZone(86, 0.10)).toBe('BUY');
  });

  it('정규화점수 ≥ 75 AND 퍼센타일 < 0.30 → BUY', () => {
    expect(computeHybridZone(80, 0.20)).toBe('BUY');
    expect(computeHybridZone(75, 0.29)).toBe('BUY');
  });

  it('정규화점수 ≥ 75 이지만 퍼센타일 ≥ 0.30 → HOLD', () => {
    expect(computeHybridZone(80, 0.35)).toBe('HOLD');
  });

  it('정규화점수 ≥ 60 → HOLD', () => {
    expect(computeHybridZone(65, 0.50)).toBe('HOLD');
    expect(computeHybridZone(60, 0.99)).toBe('HOLD');
  });

  it('정규화점수 ≥ 40 AND < 60 → SELL', () => {
    expect(computeHybridZone(50, 0.70)).toBe('SELL');
    expect(computeHybridZone(40, 0.85)).toBe('SELL');
  });

  it('정규화점수 < 40 → STRONG_SELL', () => {
    expect(computeHybridZone(30, 0.90)).toBe('STRONG_SELL');
    expect(computeHybridZone(0, 1.0)).toBe('STRONG_SELL');
  });
});

// ─── assignPercentileZones ───────────────────────────────────────────────────
describe('assignPercentileZones', () => {
  it('빈 배열 → 빈 배열 반환', () => {
    expect(assignPercentileZones([])).toEqual([]);
  });

  it('단일 종목 → 퍼센타일 0 (최상위)', () => {
    const result = assignPercentileZones([{ code: 'A', finalScore: 200 }]);
    expect(result[0].percentile).toBe(0);
  });

  it('5개 종목 배치 — 퍼센타일 분포 및 등급 부여', () => {
    const stocks: ScoredEntry[] = [
      { code: 'A', finalScore: 250 }, // rank 0 → percentile 0.0 (20%)
      { code: 'B', finalScore: 230 }, // rank 1 → percentile 0.2 (40%)
      { code: 'C', finalScore: 180 }, // rank 2 → percentile 0.4 (60%)
      { code: 'D', finalScore: 100 }, // rank 3 → percentile 0.6 (80%)
      { code: 'E', finalScore: 50  }, // rank 4 → percentile 0.8 (100%)
    ];
    const result = assignPercentileZones(stocks);

    expect(result.find(r => r.code === 'A')?.percentile).toBeCloseTo(0.0);
    expect(result.find(r => r.code === 'E')?.percentile).toBeCloseTo(0.8);

    // 최상위(A): 정규화점수 ~93 + 퍼센타일 0.0 → STRONG_BUY
    expect(result.find(r => r.code === 'A')?.zone).toBe('STRONG_BUY');
    // 하위(E): 정규화점수 ~19 → STRONG_SELL
    expect(result.find(r => r.code === 'E')?.zone).toBe('STRONG_SELL');
  });

  it('원본 배열 순서 유지', () => {
    const stocks: ScoredEntry[] = [
      { code: 'X', finalScore: 100 },
      { code: 'Y', finalScore: 200 },
    ];
    const result = assignPercentileZones(stocks);
    expect(result[0].code).toBe('X');
    expect(result[1].code).toBe('Y');
  });

  it('10% 비율 → 10개 중 상위 1개만 STRONG_BUY (퍼센타일 기준)', () => {
    const stocks: ScoredEntry[] = Array.from({ length: 10 }, (_, i) => ({
      code: `S${i}`,
      finalScore: (10 - i) * 25, // 250, 225, 200, ..., 25
    }));
    const result = assignPercentileZones(stocks);
    const strongBuys = result.filter(r => r.zone === 'STRONG_BUY');
    // 상위 1개(250점 = 92.6% 정규화, percentile=0.0)만 STRONG_BUY 가능
    expect(strongBuys.length).toBeLessThanOrEqual(1);
  });
});

// ─── isStrongBuyQualified ────────────────────────────────────────────────────
describe('isStrongBuyQualified', () => {
  const baseCriteria = {
    gatePassed: true,
    rrr: 2.5,
    confluenceBullishAxes: 4,
    regime: 'R2_NEUTRAL',
    volumeIncreasing: true,
    noDrawdown: true,
  };

  it('6개 조건 전부 충족 → true', () => {
    expect(isStrongBuyQualified(baseCriteria)).toBe(true);
  });

  it('Gate 미통과 → false', () => {
    expect(isStrongBuyQualified({ ...baseCriteria, gatePassed: false })).toBe(false);
  });

  it('RRR < 2.0 → false', () => {
    expect(isStrongBuyQualified({ ...baseCriteria, rrr: 1.9 })).toBe(false);
  });

  it('Confluence < 3 → false', () => {
    expect(isStrongBuyQualified({ ...baseCriteria, confluenceBullishAxes: 2 })).toBe(false);
  });

  it('Regime R5 → false', () => {
    expect(isStrongBuyQualified({ ...baseCriteria, regime: 'R5' })).toBe(false);
  });

  it('Regime R6 → false', () => {
    expect(isStrongBuyQualified({ ...baseCriteria, regime: 'R6' })).toBe(false);
  });

  it('거래량 감소 → false', () => {
    expect(isStrongBuyQualified({ ...baseCriteria, volumeIncreasing: false })).toBe(false);
  });

  it('Drawdown 있음 → false', () => {
    expect(isStrongBuyQualified({ ...baseCriteria, noDrawdown: false })).toBe(false);
  });

  it('Confluence 정확히 3 → true (경계값)', () => {
    expect(isStrongBuyQualified({ ...baseCriteria, confluenceBullishAxes: 3 })).toBe(true);
  });

  it('RRR 정확히 2.0 → true (경계값)', () => {
    expect(isStrongBuyQualified({ ...baseCriteria, rrr: 2.0 })).toBe(true);
  });
});
