// @responsibility computeEntryStrategy 단위 테스트 — 눌림목(20일선) 진입 전략.
import { describe, it, expect } from 'vitest';
import { computeEntryStrategy } from './priceStrategy';

describe('computeEntryStrategy (눌림목)', () => {
  it('이격 큰 종목 — 진입 = 20일선 눌림목(현재가 아래) + R:R 보존', () => {
    // 현재 153,100 · 이격도 108(20일선 8% 위) · AI 진입 118,500 목표 155,000 손절 102,000
    const r = computeEntryStrategy(153100, 118500, 155000, 102000, 108);
    expect(r.basis).toBe('PULLBACK');
    expect(r.entry).toBe(Math.round(153100 * (100 / 108))); // MA20 ≈ 141,759
    expect(r.entry).toBeLessThan(153100);
    expect(r.target).toBe(Math.round(r.entry * (155000 / 118500)));
    expect(r.stop).toBe(Math.round(r.entry * (102000 / 118500)));
    expect(r.target).toBeGreaterThan(r.entry);
    expect(r.stop).toBeLessThan(r.entry);
  });

  it('이격 ≤100 (20일선 근처/아래) — 진입 = 현재가', () => {
    const r = computeEntryStrategy(100000, 95000, 120000, 90000, 99);
    expect(r.basis).toBe('CURRENT');
    expect(r.entry).toBe(100000);
  });

  it('이격도 없음 — 진입 = 현재가 (눌림목 데이터 부재)', () => {
    const r = computeEntryStrategy(100000, 95000, 120000, 90000, undefined);
    expect(r.basis).toBe('CURRENT');
    expect(r.entry).toBe(100000);
  });

  it('과도한 이격 — 되돌림 15%로 clamp', () => {
    // 이격도 140 → 100/140≈0.714 → clamp 0.85 (최대 15% 되돌림)
    const r = computeEntryStrategy(100000, 90000, 130000, 85000, 140);
    expect(r.entry).toBe(85000);
  });

  it('current 0 — 원본 AI 레벨 그대로', () => {
    const r = computeEntryStrategy(0, 95000, 120000, 90000, 110);
    expect(r.entry).toBe(95000);
    expect(r.target).toBe(120000);
  });
});
