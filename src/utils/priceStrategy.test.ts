// @responsibility rebaseStrategyToCurrent 단위 테스트 — 현재가 기준 가격 전략 재계산.
import { describe, it, expect } from 'vitest';
import { rebaseStrategyToCurrent } from './priceStrategy';

describe('rebaseStrategyToCurrent', () => {
  it('진입이 현재가에서 멀면(>10% 아래) 현재가 앵커링 재계산 — 사용자 케이스', () => {
    // 현재 153,100 · 진입 118,500(한참 아래) · 목표 155,000(바로 위) · 손절 102,000
    const r = rebaseStrategyToCurrent(153100, 118500, 155000, 102000);
    expect(r.rebased).toBe(true);
    expect(r.entry).toBe(153100); // 진입 = 현재가
    // 비율 보존: target/entry=1.308 → 153100×1.308≈200,255
    expect(r.target).toBe(Math.round(153100 * (155000 / 118500)));
    expect(r.stop).toBe(Math.round(153100 * (102000 / 118500)));
    expect(r.target).toBeGreaterThan(153100);
    expect(r.stop).toBeLessThan(153100);
  });

  it('진입이 현재가 위(브레이크아웃 모순)면 재계산', () => {
    const r = rebaseStrategyToCurrent(153100, 188500, 245000, 165000);
    expect(r.rebased).toBe(true);
    expect(r.entry).toBe(153100);
  });

  it('손절이 현재가 이상이면 재계산', () => {
    const r = rebaseStrategyToCurrent(153100, 150000, 200000, 160000);
    expect(r.rebased).toBe(true);
  });

  it('진입이 현재가 근처(±10% 내)·목표 여력 충분이면 원본 유지', () => {
    const r = rebaseStrategyToCurrent(100000, 98000, 120000, 92000);
    expect(r.rebased).toBe(false);
    expect(r.entry).toBe(98000);
    expect(r.target).toBe(120000);
    expect(r.stop).toBe(92000);
  });

  it('current 미확보(0)면 원본 그대로', () => {
    const r = rebaseStrategyToCurrent(0, 98000, 120000, 92000);
    expect(r.rebased).toBe(false);
    expect(r.entry).toBe(98000);
  });
});
