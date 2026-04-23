/**
 * probingBandit.test.ts
 * Idea 6 — Thompson Sampling PROBING slot bandit.
 */

import { describe, it, expect } from 'vitest';
import {
  sampleBeta, makeRng, buildArmKey,
  decideProbingSlotBudget, canReserveBanditProbingSlot,
  PROBING_BASE_SLOTS, PROBING_MAX_SLOTS_WITH_BANDIT, PROBING_MIN_OBS_FOR_CONFIDENT,
} from './probingBandit.js';
import type { RecommendationRecord } from './recommendationTracker.js';

function rec(signalType: 'STRONG_BUY' | 'BUY', status: 'WIN' | 'LOSS' | 'PENDING' | 'EXPIRED'): RecommendationRecord {
  return {
    id: `r${Math.random()}`,
    stockCode: '000000',
    stockName: 'test',
    signalTime: '2026-01-01',
    priceAtRecommend: 10_000,
    stopLoss: 9_500,
    targetPrice: 12_000,
    kellyPct: 5,
    gateScore: 9,
    signalType,
    status,
  };
}

describe('sampleBeta', () => {
  it('Beta(1,1) == Uniform(0,1)', () => {
    const rng = makeRng(42);
    const samples = Array.from({ length: 1000 }, () => sampleBeta(1, 1, rng));
    const mean = samples.reduce((s, x) => s + x, 0) / samples.length;
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.6);
  });

  it('Beta(20,2) posterior mean ≈ α/(α+β) = 0.909', () => {
    const rng = makeRng(42);
    const samples = Array.from({ length: 2000 }, () => sampleBeta(20, 2, rng));
    const mean = samples.reduce((s, x) => s + x, 0) / samples.length;
    expect(mean).toBeGreaterThan(0.85);
    expect(mean).toBeLessThan(0.95);
  });

  it('deterministic with seed', () => {
    const rng1 = makeRng(123);
    const rng2 = makeRng(123);
    const a = Array.from({ length: 5 }, () => sampleBeta(3, 3, rng1));
    const b = Array.from({ length: 5 }, () => sampleBeta(3, 3, rng2));
    expect(a).toEqual(b);
  });
});

describe('buildArmKey', () => {
  it('signalType × profileType 조합을 키로', () => {
    expect(buildArmKey({ signalType: 'STRONG_BUY', profileType: 'A' })).toBe('STRONG_BUY:A');
    expect(buildArmKey({ signalType: 'BUY', profileType: null })).toBe('BUY:X');
  });
});

describe('decideProbingSlotBudget', () => {
  it('후보 없으면 base 1 슬롯', () => {
    const d = decideProbingSlotBudget([]);
    expect(d.budget).toBe(PROBING_BASE_SLOTS);
  });

  it('모든 arm 이 ESS < MIN_OBS 이면 최대 예산까지 확장', () => {
    const d = decideProbingSlotBudget(
      ['STRONG_BUY:A', 'BUY:B', 'PROBING:X'],
      { recommendations: [], seed: 1 },
    );
    // 3개 모두 exploratory, cap 에 의해 상한 = PROBING_MAX_SLOTS_WITH_BANDIT
    expect(d.budget).toBeLessThanOrEqual(PROBING_MAX_SLOTS_WITH_BANDIT);
    expect(d.budget).toBeGreaterThan(PROBING_BASE_SLOTS);
  });

  it('ESS ≥ MIN_OBS 인 arm 은 보너스에서 제외', () => {
    // STRONG_BUY 에 충분한 관측 (10+ wins, 10+ losses) 추가
    const history: RecommendationRecord[] = [
      ...Array.from({ length: 12 }, () => rec('STRONG_BUY', 'WIN')),
      ...Array.from({ length: 12 }, () => rec('STRONG_BUY', 'LOSS')),
    ];
    // STRONG_BUY arm 의 ESS = 24 >= 10 → exploratory=false
    // BUY arm 의 ESS = 0 → exploratory=true
    const d = decideProbingSlotBudget(
      ['STRONG_BUY:A', 'BUY:B'],
      { recommendations: history, seed: 1 },
    );
    const strong = d.arms.find(a => a.armKey === 'STRONG_BUY:A')!;
    const buy = d.arms.find(a => a.armKey === 'BUY:B')!;
    expect(strong.ess).toBeGreaterThanOrEqual(PROBING_MIN_OBS_FOR_CONFIDENT);
    expect(strong.exploratory).toBe(false);
    expect(buy.exploratory).toBe(true);
    // 1 exploratory arm → +1 bonus slot
    expect(d.budget).toBe(PROBING_BASE_SLOTS + 1);
  });

  it('bonus 절대 상한 = PROBING_MAX_SLOTS_WITH_BANDIT - PROBING_BASE_SLOTS', () => {
    const manyArms = Array.from({ length: 10 }, (_, i) => `BUY:ARM_${i}`);
    const d = decideProbingSlotBudget(manyArms, { recommendations: [], seed: 1 });
    expect(d.budget).toBe(PROBING_MAX_SLOTS_WITH_BANDIT);
  });

  it('중복 armKey 는 한 번만 카운트', () => {
    const d = decideProbingSlotBudget(
      ['BUY:A', 'BUY:A', 'BUY:A'],
      { recommendations: [], seed: 1 },
    );
    expect(d.arms).toHaveLength(1);
  });
});

describe('canReserveBanditProbingSlot', () => {
  it('reservedCount < budget → 허용', () => {
    expect(canReserveBanditProbingSlot(0, 3)).toBe(true);
    expect(canReserveBanditProbingSlot(2, 3)).toBe(true);
    expect(canReserveBanditProbingSlot(3, 3)).toBe(false);
  });
});
