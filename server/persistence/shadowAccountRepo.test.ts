/**
 * shadowAccountRepo.test.ts — PR-5 #11 Shadow 계좌 독립 원장 동작 계약.
 *
 * computeShadowAccount 는 KIS 실/모의 잔고와 무관하게 startingCapital 기반의
 * 자체 현금·투자·수익 원장을 반환해야 한다. 시나리오별 cashBalance 파생을 검증.
 */

import { describe, it, expect } from 'vitest';
import { computeShadowAccount } from './shadowAccountRepo.js';

function makeFill(
  type: 'BUY' | 'SELL',
  qty: number,
  price: number,
  overrides: { pnl?: number; pnlPct?: number; timestamp?: string; status?: 'CONFIRMED' | 'PROVISIONAL' | 'REVERTED' } = {},
): any {
  return {
    id: `f-${Math.random().toString(36).slice(2, 8)}`,
    type,
    qty,
    price,
    reason: 'test',
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    status: overrides.status ?? 'CONFIRMED',
    ...(type === 'SELL' ? { pnl: overrides.pnl, pnlPct: overrides.pnlPct } : {}),
  };
}

function makeTrade(partial: any): any {
  return {
    id: partial.id ?? 't1',
    stockCode: partial.stockCode ?? '005930',
    stockName: partial.stockName ?? '삼성전자',
    signalTime: partial.signalTime ?? new Date().toISOString(),
    signalPrice: partial.signalPrice ?? 70_000,
    shadowEntryPrice: partial.shadowEntryPrice ?? 70_000,
    quantity: partial.quantity ?? 0,
    stopLoss: partial.stopLoss ?? 66_500,
    targetPrice: partial.targetPrice ?? 77_000,
    status: partial.status ?? 'ACTIVE',
    ...partial,
  };
}

describe('computeShadowAccount — 독립 원장 동작', () => {
  it('거래 없으면 startingCapital 그대로 현금·총자산', () => {
    const acc = computeShadowAccount([], 100_000_000);
    expect(acc.startingCapital).toBe(100_000_000);
    expect(acc.cashBalance).toBe(100_000_000);
    expect(acc.totalInvested).toBe(0);
    expect(acc.totalAssets).toBe(100_000_000);
    expect(acc.returnPct).toBe(0);
  });

  it('BUY fill 이 들어오면 cashBalance 가 감소하고 totalInvested 증가', () => {
    const trade = makeTrade({
      id: 't1', status: 'ACTIVE',
      shadowEntryPrice: 70_000, quantity: 10,
      fills: [makeFill('BUY', 10, 70_000)],
    });
    const acc = computeShadowAccount([trade], 100_000_000);
    expect(acc.cashBalance).toBe(100_000_000 - 700_000);
    expect(acc.totalInvested).toBe(700_000);
    // totalAssets = cash + invested (미실현 미제공 시 0)
    expect(acc.totalAssets).toBe(100_000_000);
  });

  it('일부 SELL 후 현금 회수 + 잔량 반영', () => {
    const trade = makeTrade({
      id: 't2', status: 'ACTIVE',
      shadowEntryPrice: 70_000, quantity: 10,
      fills: [
        makeFill('BUY', 10, 70_000),
        makeFill('SELL', 4, 77_000, { pnl: 28_000, pnlPct: 10 }),
      ],
    });
    const acc = computeShadowAccount([trade], 100_000_000);
    // 현금 = 1억 - 700,000(매수) + 308,000(매도 4주×77000) = 99,608,000
    expect(acc.cashBalance).toBe(100_000_000 - 700_000 + 4 * 77_000);
    // 잔량 = 10 - 4 = 6주, investedCash = 6 × 70,000 = 420,000
    expect(acc.totalInvested).toBe(6 * 70_000);
    expect(acc.openPositions).toHaveLength(1);
    expect(acc.openPositions[0]?.remainingQty).toBe(6);
  });

  it('HIT_TARGET 전량 청산은 closedTrades 로 이동, totalInvested 0', () => {
    const trade = makeTrade({
      id: 't3', status: 'HIT_TARGET',
      shadowEntryPrice: 70_000, quantity: 0,
      exitPrice: 77_000,
      fills: [
        makeFill('BUY', 10, 70_000),
        makeFill('SELL', 10, 77_000, { pnl: 70_000, pnlPct: 10 }),
      ],
    });
    const acc = computeShadowAccount([trade], 100_000_000);
    expect(acc.totalInvested).toBe(0);
    expect(acc.openPositions).toHaveLength(0);
    expect(acc.closedTrades).toHaveLength(1);
    expect(acc.realizedPnl).toBe(70_000);
    // 현금 = 1억 - 700,000 + 770,000 = 100,070,000
    expect(acc.cashBalance).toBe(100_000_000 + 70_000);
  });

  it('현재가 주입 시 unrealizedPnl 계산', () => {
    const trade = makeTrade({
      id: 't4', status: 'ACTIVE',
      shadowEntryPrice: 70_000, quantity: 10,
      fills: [makeFill('BUY', 10, 70_000)],
    });
    const acc = computeShadowAccount([trade], 100_000_000, { '005930': 75_000 });
    // (75k - 70k) × 10 = 50,000
    expect(acc.unrealizedPnl).toBe(50_000);
    expect(acc.openPositions[0]?.unrealizedPnl).toBe(50_000);
    // totalAssets = cash(99.3M) + invested(700k) + unrealized(50k) = 100.05M
    expect(acc.totalAssets).toBe(99_300_000 + 700_000 + 50_000);
  });

  it('LIVE 모드 KIS 잔고가 어떤 값이든 startingCapital 에 영향 없음', () => {
    // 이 함수는 KIS 잔고를 전혀 참조하지 않는다 — 순전히 trades + startingCapital 로 파생.
    // startingCapital 50M 으로 주면 totalAssets 도 그 기반으로만 계산된다.
    const trade = makeTrade({
      id: 't5', status: 'ACTIVE',
      shadowEntryPrice: 100_000, quantity: 5,
      fills: [makeFill('BUY', 5, 100_000)],
    });
    const acc = computeShadowAccount([trade], 50_000_000);
    expect(acc.startingCapital).toBe(50_000_000);
    expect(acc.cashBalance).toBe(50_000_000 - 500_000);
    expect(acc.totalInvested).toBe(500_000);
  });
});
