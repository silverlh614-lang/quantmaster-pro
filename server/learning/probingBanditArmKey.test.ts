/**
 * @responsibility probingBandit armKey 해상도 — legacy fallback 경고·signalType 매칭 회귀 보호.
 *
 * PR-22 / ADR-0007 — `RecommendationRecord.profileType` 미존재 상황에서 "옵션 a"
 * (legacy-only retain + warn) 정책이 유지되는지, 경고가 프로세스당 1회만 나가는지,
 * legacy armKey(`:X`) 는 경고 없이 기존 동작을 보존하는지 검증한다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decideProbingSlotBudget,
  PROBING_BASE_SLOTS,
  PROBING_MIN_OBS_FOR_CONFIDENT,
  __resetLegacyArmKeyWarningForTests,
} from './probingBandit.js';
import type { RecommendationRecord } from './recommendationTracker.js';

function rec(
  signalType: 'STRONG_BUY' | 'BUY',
  status: 'WIN' | 'LOSS' | 'PENDING' | 'EXPIRED',
): RecommendationRecord {
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

describe('probingBandit armKey 해상도 (legacy fallback)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetLegacyArmKeyWarningForTests();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('BUY:A / BUY:B / BUY:C 는 profileType 미해상으로 전부 동일 BUY signalType 레코드와 매칭된다 (legacy fallback)', () => {
    // 관측: BUY WIN 12건 + BUY LOSS 4건 (ESS=16 → exploratory=false)
    const history: RecommendationRecord[] = [
      ...Array.from({ length: 12 }, () => rec('BUY', 'WIN')),
      ...Array.from({ length: 4 }, () => rec('BUY', 'LOSS')),
    ];

    const d = decideProbingSlotBudget(
      ['BUY:A', 'BUY:B', 'BUY:C'],
      { recommendations: history, seed: 1 },
    );

    // RecommendationRecord 에 profileType 이 없으므로 legacy fallback 정책상
    // A/B/C 는 전부 동일한 BUY signalType 집계를 공유한다.
    const armA = d.arms.find(a => a.armKey === 'BUY:A')!;
    const armB = d.arms.find(a => a.armKey === 'BUY:B')!;
    const armC = d.arms.find(a => a.armKey === 'BUY:C')!;
    expect(armA.wins).toBe(12);
    expect(armA.losses).toBe(4);
    expect(armB.wins).toBe(12);
    expect(armB.losses).toBe(4);
    expect(armC.wins).toBe(12);
    expect(armC.losses).toBe(4);
    // 모든 arm 이 ESS=16 ≥ MIN_OBS 이므로 exploratory=false 여야 한다
    expect(armA.ess).toBeGreaterThanOrEqual(PROBING_MIN_OBS_FOR_CONFIDENT);
    expect(armA.exploratory).toBe(false);
    expect(armB.exploratory).toBe(false);
    expect(armC.exploratory).toBe(false);
    // 보너스 슬롯 0 → 기본 슬롯만 유지
    expect(d.budget).toBe(PROBING_BASE_SLOTS);
  });

  it('BUY:X (legacy armKey) 는 동일 signalType 모든 레코드와 매칭된다', () => {
    const history: RecommendationRecord[] = [
      ...Array.from({ length: 3 }, () => rec('BUY', 'WIN')),
      ...Array.from({ length: 2 }, () => rec('BUY', 'LOSS')),
      // STRONG_BUY 는 signalType 가 달라 포함되면 안 된다
      rec('STRONG_BUY', 'WIN'),
      rec('STRONG_BUY', 'LOSS'),
      // PENDING 은 항상 제외
      rec('BUY', 'PENDING'),
    ];

    const d = decideProbingSlotBudget(
      ['BUY:X'],
      { recommendations: history, seed: 1 },
    );

    const arm = d.arms.find(a => a.armKey === 'BUY:X')!;
    expect(arm.wins).toBe(3);
    expect(arm.losses).toBe(2);
    expect(arm.ess).toBe(5);
  });

  it('비-legacy armKey 진입 시 경고 로그가 프로세스당 1회만 출력된다', () => {
    const history: RecommendationRecord[] = [
      rec('BUY', 'WIN'),
      rec('BUY', 'LOSS'),
    ];

    // 3개의 비-legacy armKey 를 한번에 넘긴다
    decideProbingSlotBudget(
      ['BUY:A', 'BUY:B', 'BUY:C'],
      { recommendations: history, seed: 1 },
    );

    // 이후 또 다른 비-legacy armKey 호출 — 경고는 추가되면 안 된다
    decideProbingSlotBudget(
      ['STRONG_BUY:A'],
      { recommendations: history, seed: 1 },
    );

    const legacyWarnCalls = (warnSpy.mock.calls as unknown[][]).filter((args) => {
      const msg = typeof args[0] === 'string' ? args[0] : '';
      return msg.includes('legacy signal-only history');
    });
    expect(legacyWarnCalls).toHaveLength(1);
  });

  it('legacy armKey (`:X`) 만 사용되면 경고를 출력하지 않는다', () => {
    const history: RecommendationRecord[] = [
      rec('BUY', 'WIN'),
      rec('BUY', 'LOSS'),
    ];

    decideProbingSlotBudget(
      ['BUY:X', 'STRONG_BUY:X'],
      { recommendations: history, seed: 1 },
    );

    const legacyWarnCalls = (warnSpy.mock.calls as unknown[][]).filter((args) => {
      const msg = typeof args[0] === 'string' ? args[0] : '';
      return msg.includes('legacy signal-only history');
    });
    expect(legacyWarnCalls).toHaveLength(0);
  });

  it('signalType 매칭은 유지 — BUY armKey 는 STRONG_BUY 레코드를 집계하지 않는다', () => {
    const history: RecommendationRecord[] = [
      rec('STRONG_BUY', 'WIN'),
      rec('STRONG_BUY', 'WIN'),
      rec('STRONG_BUY', 'LOSS'),
    ];

    const d = decideProbingSlotBudget(
      ['BUY:X'],
      { recommendations: history, seed: 1 },
    );
    const arm = d.arms.find(a => a.armKey === 'BUY:X')!;
    expect(arm.wins).toBe(0);
    expect(arm.losses).toBe(0);
    expect(arm.ess).toBe(0);
    expect(arm.exploratory).toBe(true);
  });
});
