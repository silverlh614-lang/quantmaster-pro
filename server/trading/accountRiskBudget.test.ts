/**
 * accountRiskBudget.test.ts
 *
 * Idea 8 회귀: 트레일링 hardStop 이 진입가 위로 올라간 포지션의 activeR 이
 * 동시 R 한도에서 정상 해제되는지 검증.
 *
 * 기존 로직: r = max(0, entry - hardStop) × qty → BE 위 트레일링도 양(+) R 로 집계
 *   (수익 구간에 있는 포지션이 동시 R 한도를 점유)
 * 신규 로직: r = max(0, min(entry, current) - hardStop) × remainingQty
 *   (현재가 제공 시 트레일링 반영, 미제공 시 레거시 동작)
 */

import { describe, it, expect } from 'vitest';
import { getAccountRiskBudget } from './accountRiskBudget.js';
import type { ServerShadowTrade } from '../persistence/shadowTradeRepo.js';

function mkTrade(partial: Partial<ServerShadowTrade>): ServerShadowTrade {
  return {
    id: partial.id ?? 't1',
    stockCode: partial.stockCode ?? '005930',
    stockName: partial.stockName ?? 'Test',
    signalTime: '2026-01-01T00:00:00.000Z',
    signalPrice: 10_000,
    shadowEntryPrice: 10_000,
    quantity: 10,
    stopLoss: 9_500,
    hardStopLoss: 9_500,
    targetPrice: 12_000,
    status: 'ACTIVE',
    ...partial,
  };
}

describe('Idea 8 — openRiskPct 트레일링 hardStop 반영', () => {
  const totalAssets = 100_000_000; // 1억원

  it('진입가·손절 500원차 × 10주 = 5,000원 R 을 정확히 계좌 % 로 환산', () => {
    const trades = [mkTrade({})];
    const budget = getAccountRiskBudget({ totalAssets, trades });
    // 5,000원 / 1억 * 100 = 0.005%
    expect(budget.openRiskPct).toBeCloseTo(0.005, 5);
  });

  it('트레일링 hardStop 이 진입가 이상으로 올라가면 activeR = 0 (currentPrices 제공)', () => {
    // 진입 10,000 · 현재 12,000 · hardStop 이 11,500 (BE 위 트레일링)
    const trades = [mkTrade({
      shadowEntryPrice: 10_000,
      hardStopLoss: 11_500,
      quantity: 10,
    })];
    const budget = getAccountRiskBudget({
      totalAssets,
      trades,
      currentPrices: { '005930': 12_000 },
    });
    // base = min(10_000, 12_000) = 10_000; max(0, 10_000 - 11_500) = 0
    expect(budget.openRiskPct).toBe(0);
  });

  it('currentPrices 미제공 시 레거시 동작 — 진입가 기준 activeR 유지', () => {
    // 같은 포지션, 현재가 미제공 → min(entry, current) 가 entry 로 폴백
    const trades = [mkTrade({
      shadowEntryPrice: 10_000,
      hardStopLoss: 9_500,
      quantity: 10,
    })];
    const budget = getAccountRiskBudget({ totalAssets, trades });
    expect(budget.openRiskPct).toBeCloseTo(0.005, 5);
  });

  it('현재가가 진입가 아래로 떨어지면 더 보수적인 base 를 사용', () => {
    // 진입 10,000 · 현재 9,800 · hardStop 9,500 → base = min(10,000, 9,800) = 9,800
    // r = max(0, 9,800 - 9,500) × 10 = 3,000원 (기존 5,000원 보다 작음)
    const trades = [mkTrade({
      shadowEntryPrice: 10_000,
      hardStopLoss: 9_500,
      quantity: 10,
    })];
    const budget = getAccountRiskBudget({
      totalAssets,
      trades,
      currentPrices: new Map([['005930', 9_800]]),
    });
    expect(budget.openRiskPct).toBeCloseTo(0.003, 5);
  });

  it('fills SSOT: PROVISIONAL SELL 으로 remaining 이 줄면 activeR 도 감소', () => {
    const trades = [mkTrade({
      shadowEntryPrice: 10_000,
      hardStopLoss: 9_500,
      quantity: 10,
      fills: [
        { id: 'b1', type: 'BUY', qty: 10, price: 10_000, reason: 'init', timestamp: 't', status: 'CONFIRMED' },
        { id: 's1', type: 'SELL', qty: 5, price: 11_000, reason: 'partial', timestamp: 't', status: 'CONFIRMED' },
      ],
    })];
    const budget = getAccountRiskBudget({ totalAssets, trades });
    // remainingQty = 10 - 5 = 5; r = 500 × 5 = 2,500
    expect(budget.openRiskPct).toBeCloseTo(0.0025, 5);
  });

  it('concurrentRiskRemainingPct 는 트레일링으로 해제된 R 을 정상적으로 반영', () => {
    // 두 포지션: A 는 BE 위 트레일링(리스크 해소), B 는 진입 근처(원 리스크 유지)
    const trades = [
      mkTrade({
        id: 'tA', stockCode: 'A',
        shadowEntryPrice: 10_000, hardStopLoss: 10_200, quantity: 10, // 이미 해소
      }),
      mkTrade({
        id: 'tB', stockCode: 'B',
        shadowEntryPrice: 10_000, hardStopLoss: 9_500, quantity: 10, // 5,000 R
      }),
    ];
    const budget = getAccountRiskBudget({
      totalAssets,
      trades,
      currentPrices: { A: 11_000, B: 10_050 },
    });
    // openRisk 는 B 만 반영: 5,000/1억 = 0.005%
    expect(budget.openRiskPct).toBeCloseTo(0.005, 5);
    // 동시 R 한도에서 A 가 부당하게 점유하던 몫이 해제되어 신규 진입 여지 증가
    expect(budget.concurrentRiskRemainingPct).toBeCloseTo(budget.maxConcurrentRiskPct - 0.005, 5);
  });
});
