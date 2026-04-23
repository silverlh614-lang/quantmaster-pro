import { describe, it, expect } from 'vitest';
import { computeKellySurface } from './kellySurfaceMap.js';
import type { RecommendationRecord } from './recommendationTracker.js';

function mk(
  overrides: Partial<RecommendationRecord> & { signalType: 'STRONG_BUY' | 'BUY'; status: 'WIN' | 'LOSS' | 'PENDING' },
): RecommendationRecord {
  return {
    id: Math.random().toString(),
    stockCode: '000000', stockName: 't',
    signalTime: '2026-01-01', priceAtRecommend: 10000,
    stopLoss: 9500, targetPrice: 12000, kellyPct: 5, gateScore: 9,
    actualReturn: 0,
    ...overrides,
  } as RecommendationRecord;
}

describe('computeKellySurface', () => {
  it('샘플 부족 cell은 pHalfWidth = Infinity', () => {
    const r = computeKellySurface([]);
    for (const c of r.cells) {
      expect(c.pHalfWidth).toBe(Infinity);
      expect(c.samples).toBe(0);
    }
  });

  it('3 WIN, 2 LOSS → p=0.6, b=avgWin/avgLoss, Kelly* 계산', () => {
    const history: RecommendationRecord[] = [
      mk({ signalType: 'STRONG_BUY', status: 'WIN',  entryRegime: 'R2_BULL', actualReturn:  10 }),
      mk({ signalType: 'STRONG_BUY', status: 'WIN',  entryRegime: 'R2_BULL', actualReturn:   8 }),
      mk({ signalType: 'STRONG_BUY', status: 'WIN',  entryRegime: 'R2_BULL', actualReturn:  12 }),
      mk({ signalType: 'STRONG_BUY', status: 'LOSS', entryRegime: 'R2_BULL', actualReturn:  -4 }),
      mk({ signalType: 'STRONG_BUY', status: 'LOSS', entryRegime: 'R2_BULL', actualReturn:  -5 }),
    ];
    const r = computeKellySurface(history);
    const cell = r.cells.find(c => c.signalType === 'STRONG_BUY' && c.regime === 'R2_BULL')!;
    expect(cell.samples).toBe(5);
    expect(cell.p).toBeCloseTo(0.6, 2);
    // avgWin = 10, avgLoss = 4.5 → b ≈ 2.22
    expect(cell.b).toBeCloseTo(10 / 4.5, 2);
    // Kelly* = (0.6 * 3.22 - 1) / 2.22 ≈ 0.42
    expect(cell.kellyStar).toBeGreaterThan(0.3);
    expect(cell.kellyStar).toBeLessThan(0.6);
    expect(cell.pHalfWidth).toBeLessThan(0.5);
    // 추가 10 샘플 시 정밀도 개선분 > 0
    expect(cell.marginalPrecisionGainForNext10).toBeGreaterThan(0);
  });
});
