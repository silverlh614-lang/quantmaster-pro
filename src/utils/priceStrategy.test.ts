// @responsibility computeTranchePlan/toTranchePlan 단위 테스트 — regime 가중 분할매수.
import { describe, it, expect } from 'vitest';
import { computeTranchePlan, toTranchePlan } from './priceStrategy';

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
