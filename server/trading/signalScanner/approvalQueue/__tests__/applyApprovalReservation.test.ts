// @responsibility applyApprovalReservation 회귀 테스트 — 8개 mutable 필드 동시 갱신 검증

import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('../../../../screener/sectorMap.js', () => ({
  getSectorByCode: vi.fn(() => '미분류'),
}));

import { applyApprovalReservation } from '../applyApprovalReservation.js';
import type { BuyListLoopMutables } from '../../perSymbolEvaluation.js';
import type { LiveBuyTask } from '../../../buyPipeline.js';

function makeMutables(orderableCash = 100_000_000): BuyListLoopMutables {
  return {
    liveBuyQueue: [] as LiveBuyTask[],
    reservedSlots: { value: 0 },
    probingReservedSlots: { value: 0 },
    reservedTiers: [],
    reservedIsMomentum: [],
    reservedBudgets: [],
    reservedSectorValues: [],
    pendingSectorValue: new Map(),
    currentSectorValue: new Map(),
    orderableCash: { value: orderableCash },
    watchlistMutated: { value: false },
  };
}

describe('applyApprovalReservation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('LIVE STANDARD — 슬롯+1, reservedTiers OTHER, orderableCash 차감', () => {
    const mut = makeMutables(10_000_000);
    applyApprovalReservation({
      mutables: mut,
      isMomentumShadow: false,
      tier: 'STANDARD',
      effectiveBudget: 3_000_000,
      stockCode: '005930',
      stockSector: '반도체',
    });
    expect(mut.reservedSlots.value).toBe(1);
    expect(mut.probingReservedSlots.value).toBe(0);
    expect(mut.reservedTiers).toEqual(['OTHER']);
    expect(mut.reservedIsMomentum).toEqual([false]);
    expect(mut.reservedBudgets).toEqual([3_000_000]);
    expect(mut.orderableCash.value).toBe(7_000_000);
    expect(mut.reservedSectorValues).toEqual([{ sector: '반도체', value: 3_000_000 }]);
    expect(mut.pendingSectorValue.get('반도체')).toBe(3_000_000);
  });

  it('LIVE PROBING — probingReservedSlots도 +1', () => {
    const mut = makeMutables();
    applyApprovalReservation({
      mutables: mut,
      isMomentumShadow: false,
      tier: 'PROBING',
      effectiveBudget: 1_000_000,
      stockCode: '035420',
    });
    expect(mut.probingReservedSlots.value).toBe(1);
    expect(mut.reservedTiers).toEqual(['PROBING']);
  });

  it('MOMENTUM Shadow — 슬롯/섹터/orderableCash 모두 격리, placeholder만 push', () => {
    const mut = makeMutables(10_000_000);
    applyApprovalReservation({
      mutables: mut,
      isMomentumShadow: true,
      tier: 'STANDARD',
      effectiveBudget: 3_000_000,
      stockCode: '005930',
      stockSector: '반도체',
    });
    expect(mut.reservedSlots.value).toBe(0);
    expect(mut.probingReservedSlots.value).toBe(0);
    expect(mut.reservedTiers).toEqual(['OTHER']);   // placeholder
    expect(mut.reservedIsMomentum).toEqual([true]);
    expect(mut.reservedBudgets).toEqual([0]);
    expect(mut.orderableCash.value).toBe(10_000_000); // 차감 안 됨
    expect(mut.reservedSectorValues).toEqual([]);     // 섹터 미기록
    expect(mut.pendingSectorValue.size).toBe(0);
  });

  it('orderableCash 부족 — Math.max(0, ...) 로 음수 방지', () => {
    const mut = makeMutables(2_000_000);
    applyApprovalReservation({
      mutables: mut,
      isMomentumShadow: false,
      tier: 'STANDARD',
      effectiveBudget: 5_000_000,
      stockCode: '005930',
    });
    expect(mut.orderableCash.value).toBe(0);
    expect(mut.reservedBudgets).toEqual([5_000_000]);
  });

  it('effectiveBudget=0 — orderableCash 차감 없음, reservedBudgets에 0 push', () => {
    const mut = makeMutables(10_000_000);
    applyApprovalReservation({
      mutables: mut,
      isMomentumShadow: false,
      tier: 'STANDARD',
      effectiveBudget: 0,
      stockCode: '005930',
    });
    expect(mut.reservedBudgets).toEqual([0]);
    expect(mut.orderableCash.value).toBe(10_000_000);
  });

  it('stockSector 미전달 — getSectorByCode fallback 사용', () => {
    const mut = makeMutables(10_000_000);
    applyApprovalReservation({
      mutables: mut,
      isMomentumShadow: false,
      tier: 'STANDARD',
      effectiveBudget: 1_000_000,
      stockCode: '005930',
    });
    expect(mut.reservedSectorValues[0].sector).toBe('미분류');
  });
});
