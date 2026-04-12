import { describe, expect, it, beforeEach } from 'vitest';
import {
  calculateFibSupport,
  getConditionalOrders,
} from './autoTrading/trancheEngine';

// ─── calculateFibSupport ─────────────────────────────────────────────────────

describe('calculateFibSupport — 피보나치 38.2% 눌림목 지지선', () => {
  it('기본 계산: entryPrice=10000, stopLoss=9000 → 9618 (반올림)', () => {
    // 10000 - (10000 - 9000) × 0.382 = 10000 - 382 = 9618
    expect(calculateFibSupport(10000, 9000)).toBe(9618);
  });

  it('entryPrice = stopLoss: 지지선 = entryPrice (레인지 없음)', () => {
    expect(calculateFibSupport(50000, 50000)).toBe(50000);
  });

  it('stopLoss가 0: 피보나치 38.2% 레벨 반환', () => {
    // 10000 - 10000 × 0.382 = 10000 - 3820 = 6180
    expect(calculateFibSupport(10000, 0)).toBe(6180);
  });

  it('큰 가격대에서도 올바른 값 반환', () => {
    // 100000 - (100000 - 90000) × 0.382 = 100000 - 3820 = 96180
    expect(calculateFibSupport(100000, 90000)).toBe(96180);
  });

  it('결과는 Math.round로 반올림된 정수', () => {
    const result = calculateFibSupport(15300, 14000);
    expect(Number.isInteger(result)).toBe(true);
    // 15300 - 1300 × 0.382 = 15300 - 496.6 = 14803.4 → 14803
    expect(result).toBe(14803);
  });

  it('지지선은 항상 stopLoss 이상 entryPrice 이하', () => {
    const testCases = [
      [10000, 9000],
      [50000, 45000],
      [200000, 180000],
    ] as [number, number][];

    for (const [entry, stop] of testCases) {
      const fib = calculateFibSupport(entry, stop);
      expect(fib).toBeGreaterThanOrEqual(stop);
      expect(fib).toBeLessThanOrEqual(entry);
    }
  });
});

// ─── getConditionalOrders ────────────────────────────────────────────────────

describe('getConditionalOrders — 조건부 주문 큐 조회', () => {
  it('기본 호출 시 배열 반환 (미체결 건만)', () => {
    const orders = getConditionalOrders();
    expect(Array.isArray(orders)).toBe(true);
    // 미체결(executed=false)인 항목만 포함
    for (const order of orders) {
      expect(order).toHaveProperty('stockCode');
      expect(order).toHaveProperty('triggerPrice');
      expect(order).toHaveProperty('type');
      expect(order).toHaveProperty('investAmount');
    }
  });
});
