// @responsibility computeTranchePlan/toTranchePlan 단위 테스트 — regime 가중 분할매수.
import { describe, it, expect } from 'vitest';
import { computeTranchePlan, toTranchePlan, deriveSecondaryLevels } from './priceStrategy';

describe('computeTranchePlan (regime 가중 분할매수)', () => {
  it('강세(BULL) — 즉시 비중↑ [50/30/20], 3분할, 눌림목이 현재가 아래', () => {
    const r = computeTranchePlan(153100, 108, 'BULL', 118500, 155000, 102000)!;
    expect(r.multiTranche).toBe(true);
    expect(r.regimeLabel).toBe('강세');
    expect(r.levels.map((l) => l.weight)).toEqual([50, 30, 20]);
    expect(r.levels[0].price).toBe(153100);            // 1차 = 현재가
    expect(r.levels[2].price).toBeLessThan(153100);     // 3차 = 20일선 눌림목 (아래)
    expect(r.zoneLow).toBe(r.levels[2].price);
    expect(r.zoneHigh).toBe(153100);
    expect(r.avgEntry).toBeGreaterThan(r.zoneLow);
    expect(r.avgEntry).toBeLessThan(r.zoneHigh);
    expect(r.target).toBeGreaterThan(r.avgEntry);
    expect(r.stop).toBeLessThan(r.avgEntry);
  });

  it('약세(BEAR) — 깊은 눌림 비중↑ [20/30/50] (방어)', () => {
    const r = computeTranchePlan(153100, 108, 'BEAR', 118500, 155000, 102000)!;
    expect(r.regimeLabel).toBe('약세');
    expect(r.levels.map((l) => l.weight)).toEqual([20, 30, 50]);
  });

  it('중립(SIDEWAYS) — 균등 [34/33/33]', () => {
    const r = computeTranchePlan(153100, 108, 'SIDEWAYS', 118500, 155000, 102000)!;
    expect(r.regimeLabel).toBe('중립');
    expect(r.levels.map((l) => l.weight)).toEqual([34, 33, 33]);
  });

  it('되돌림 여력 없음(이격≤100) — 단일 진입(현재가, 100%)', () => {
    const r = computeTranchePlan(100000, 99, 'BULL', 95000, 120000, 90000)!;
    expect(r.multiTranche).toBe(false);
    expect(r.levels).toHaveLength(1);
    expect(r.levels[0].weight).toBe(100);
    expect(r.levels[0].price).toBe(100000);
  });

  it('current 0 — null', () => {
    expect(computeTranchePlan(0, 108, 'BULL', 1, 1, 1)).toBeNull();
  });

  it('toTranchePlan — 카드용 변환 (size·trigger·status)', () => {
    const r = computeTranchePlan(153100, 108, 'BULL', 118500, 155000, 102000)!;
    const plan = toTranchePlan(r);
    expect(plan.tranche1.size).toBe(50);
    expect(plan.tranche1.status).toBe('PENDING');
    expect(plan.tranche1.trigger).toContain('₩');
    expect(plan.tranche3.size).toBe(20);
  });
});

describe('deriveSecondaryLevels (2차 진입·목표 정합 가드)', () => {
  it('버그 케이스 — stale 2차 진입가가 손절선 아래면 숨김', () => {
    // 화면 재현: 진입 171,600 · 손절 153,833 · stale 2차 진입 77,500.
    const r = deriveSecondaryLevels({
      displayPrice: 171600, aiEntry: 171600, entryShown: 171600, targetShown: 249167, stopShown: 153833,
      aiEntry2: 77500, aiTarget2: 130000,
    });
    expect(r.entry2).toBeUndefined();   // 손절 아래 → 비표시
    expect(r.target2).toBeUndefined();  // 1차 목표 아래 → 비표시
  });

  it('정합 충족 — 2차 진입(손절<값<1차) · 2차 목표(1차 위) 노출', () => {
    const r = deriveSecondaryLevels({
      displayPrice: 100000, aiEntry: 100000, entryShown: 100000, targetShown: 120000, stopShown: 93000,
      aiEntry2: 97000, aiTarget2: 140000,
    });
    expect(r.entry2).toBe(97000);
    expect(r.target2).toBe(140000);
  });

  it('현재가 앵커링 — 가격이 올라도 비율 유지해 손절 위로 재산출', () => {
    const r = deriveSecondaryLevels({
      displayPrice: 200000, aiEntry: 100000, entryShown: 200000, targetShown: 240000, stopShown: 186000,
      aiEntry2: 97000, aiTarget2: 140000,
    });
    expect(r.entry2).toBe(194000); // 200000 * 0.97 → 손절 186000 위
    expect(r.target2).toBe(280000);
  });

  it('aiEntry 0 / displayPrice 0 — 빈 결과', () => {
    expect(deriveSecondaryLevels({ displayPrice: 100000, aiEntry: 0, entryShown: 0, targetShown: 0, stopShown: 0, aiEntry2: 97000 })).toEqual({});
    expect(deriveSecondaryLevels({ displayPrice: 0, aiEntry: 100000, entryShown: 100000, targetShown: 120000, stopShown: 93000, aiEntry2: 97000 })).toEqual({});
  });
});
