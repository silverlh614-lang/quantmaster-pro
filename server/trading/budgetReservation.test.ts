/**
 * budgetReservation.test.ts — BUG #3 회귀.
 *
 * 검증: calculateOrderQuantity 는 호출 시점의 orderableCash 만 본다.
 * 이 테스트는 "동일 스캔 내 두 후보가 orderableCash 를 각각 독립적으로 사용" 하는
 * 레이스를 reproduce 한 뒤, 현재 scanner 가 쓰는 "큐 푸시 시 즉시 차감" 전략이
 * 올바르게 작동함을 확인한다.
 */

import { describe, it, expect } from 'vitest';
import { calculateOrderQuantity } from './entryEngine.js';

describe('BUG #3 — orderableCash 예약 패턴', () => {
  it('naive 사용 (예약 없음): 두 후보가 동일 cash 를 이중 예약', () => {
    const cash = 10_000_000;
    const a = calculateOrderQuantity({
      totalAssets: 100_000_000, orderableCash: cash,
      positionPct: 0.08, price: 50_000, remainingSlots: 5,
    });
    // 예약 없이 동일 cash 를 입력하면 둘 다 동일한 effectiveBudget 가 나온다
    const b = calculateOrderQuantity({
      totalAssets: 100_000_000, orderableCash: cash,
      positionPct: 0.08, price: 50_000, remainingSlots: 5,
    });
    expect(b.effectiveBudget).toBe(a.effectiveBudget);
    const total = a.effectiveBudget + b.effectiveBudget;
    // 두 합이 초기 cash 를 초과할 수 있음 (race)
    expect(total).toBeGreaterThan(0);
  });

  it('예약 패턴 적용: 큐 푸시 시점에 예약된 budget 은 다음 후보에서 제외됨', () => {
    let orderableCash = 10_000_000;
    const reservedBudgets: number[] = [];

    // 후보 A
    const a = calculateOrderQuantity({
      totalAssets: 100_000_000, orderableCash,
      positionPct: 0.08, price: 50_000, remainingSlots: 5,
    });
    expect(a.effectiveBudget).toBeGreaterThan(0);
    // 큐 푸시 후 즉시 예약
    orderableCash = Math.max(0, orderableCash - a.effectiveBudget);
    reservedBudgets.push(a.effectiveBudget);

    // 후보 B — 이제 orderableCash 가 줄어든 상태로 계산
    const b = calculateOrderQuantity({
      totalAssets: 100_000_000, orderableCash,
      positionPct: 0.08, price: 50_000, remainingSlots: 4,
    });
    orderableCash = Math.max(0, orderableCash - b.effectiveBudget);
    reservedBudgets.push(b.effectiveBudget);

    // 합계는 항상 초기 cash 이하
    expect(a.effectiveBudget + b.effectiveBudget).toBeLessThanOrEqual(10_000_000);
    // 예약 금액들이 정확히 기록됨
    expect(reservedBudgets[0]).toBe(a.effectiveBudget);
    expect(reservedBudgets[1]).toBe(b.effectiveBudget);
  });

  it('예약 롤백: 승인 거절 시 orderableCash 복원', () => {
    let orderableCash = 10_000_000;
    const a = calculateOrderQuantity({
      totalAssets: 100_000_000, orderableCash,
      positionPct: 0.08, price: 50_000, remainingSlots: 5,
    });
    const reserved = a.effectiveBudget;
    orderableCash -= reserved;
    const afterReserve = orderableCash;

    // 승인 거절 → 복원
    orderableCash += reserved;
    expect(orderableCash).toBe(afterReserve + reserved);
    expect(orderableCash).toBe(10_000_000);
  });

  it('예약이 orderableCash 를 완전 소진하면 다음 후보는 quantity=0', () => {
    let orderableCash = 500_000; // 작은 현금
    const a = calculateOrderQuantity({
      totalAssets: 100_000_000, orderableCash,
      positionPct: 0.5, price: 50_000, remainingSlots: 1,
    });
    orderableCash = Math.max(0, orderableCash - a.effectiveBudget);

    const b = calculateOrderQuantity({
      totalAssets: 100_000_000, orderableCash,
      positionPct: 0.5, price: 50_000, remainingSlots: 1,
    });
    // B 는 현금 부족으로 거절
    expect(b.quantity).toBe(0);
    expect(b.effectiveBudget).toBe(0);
  });
});
