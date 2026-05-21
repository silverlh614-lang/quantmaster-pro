import { describe, expect, it } from 'vitest';
import { computeVkospiDayChangeFromBars } from './marketDataRefresh.js';

describe('computeVkospiDayChangeFromBars', () => {
  it('bars 2개 이상이면 당일 변화율 계산', () => {
    const out = computeVkospiDayChangeFromBars([
      { date: '2026-05-20', close: 70 },
      { date: '2026-05-21', close: 18 },
    ]);
    expect(out).not.toBeNull();
    expect(out?.prevClose).toBe(70);
    expect(out?.current).toBe(18);
    expect(out?.dayChangePct).toBeCloseTo(-74.2857, 3);
  });

  it('bars 1개 이하면 null', () => {
    expect(computeVkospiDayChangeFromBars([{ date: '2026-05-21', close: 18 }])).toBeNull();
    expect(computeVkospiDayChangeFromBars(null)).toBeNull();
  });
});
