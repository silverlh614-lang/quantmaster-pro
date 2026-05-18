import { describe, expect, it, vi } from 'vitest';
import type { ServerShadowTrade } from '../../persistence/shadowTradeRepo.js';
import { resolveBuyApprovalPolicy } from './buyApprovalPolicy.js';
import { createBuySignalStateMachine } from './buySignalStateMachine.js';
import {
  __resetLiveBuyExecutorForTests,
  executeLiveBuy,
  type LiveBuyExecutorDeps,
} from './liveBuyExecutor.js';

function makeTrade(): ServerShadowTrade {
  return {
    id: 'trade-live-1',
    stockCode: '005930',
    stockName: 'Samsung',
    signalTime: '2026-05-18T00:00:00.000Z',
    signalPrice: 70_000,
    shadowEntryPrice: 70_000,
    quantity: 3,
    stopLoss: 65_000,
    targetPrice: 80_000,
    status: 'PENDING',
    mode: 'LIVE',
    profitTranches: [],
  } as ServerShadowTrade;
}

function deps(overrides: Partial<LiveBuyExecutorDeps> = {}): LiveBuyExecutorDeps {
  return {
    fetchAccountBalance: vi.fn(async () => 100_000_000),
    submitBuyOrder: vi.fn(async () => ({ kind: 'SUBMITTED' as const, ordNo: 'ORD-1' })),
    assertSafeOrder: vi.fn(),
    appendShadowLog: vi.fn(),
    addFillMonitorOrder: vi.fn(),
    getSmokeTestLiveBlocked: vi.fn(() => false),
    getSmokeTestLastFailedReason: vi.fn(() => ''),
    markAutoTradeReady: vi.fn(() => ({ ok: true, action: 'markAutoTradeReady' as const })),
    markOrderPending: vi.fn(() => ({ ok: true, action: 'markOrderPending' as const, skipped: true })),
    ...overrides,
  };
}

describe('liveBuyExecutor', () => {
  it('normalizes a KIS order number to LIVE_ORDER_SUBMITTED', async () => {
    __resetLiveBuyExecutorForTests();
    const trade = makeTrade();
    const sm = createBuySignalStateMachine({ mode: 'LIVE' });
    sm.transition('APPROVAL_REQUESTED', 'requested');
    sm.transition('APPROVED', 'approved');
    const d = deps();

    const result = await executeLiveBuy({
      trade,
      stockCode: '005930',
      stockName: 'Samsung',
      quantity: 3,
      entryPrice: 70_000,
      stopLoss: 65_000,
      currentPrice: 70_000,
      logEvent: 'BUY_SIGNAL',
      approvalPolicy: resolveBuyApprovalPolicy({
        mode: 'LIVE',
        action: 'APPROVE',
        telegramDelivered: true,
      }),
      stateMachine: sm,
    }, d);

    expect(result.outcome).toBe('LIVE_ORDER_SUBMITTED');
    expect(trade.status).toBe('ORDER_SUBMITTED');
    expect(sm.state).toBe('LIVE_ORDER_SUBMITTED');
    expect(d.addFillMonitorOrder).toHaveBeenCalled();
  });

  it('does not submit a live order after Telegram delivery failure', async () => {
    __resetLiveBuyExecutorForTests();
    const trade = makeTrade();
    const sm = createBuySignalStateMachine({ mode: 'LIVE' });
    sm.transition('APPROVAL_REQUESTED', 'requested');
    sm.transition('APPROVED', 'delivery failed auto approve must be blocked');
    const d = deps();

    const result = await executeLiveBuy({
      trade,
      stockCode: '005930',
      stockName: 'Samsung',
      quantity: 3,
      entryPrice: 70_000,
      stopLoss: 65_000,
      currentPrice: 70_000,
      logEvent: 'BUY_SIGNAL',
      approvalPolicy: resolveBuyApprovalPolicy({
        mode: 'LIVE',
        action: 'APPROVE',
        telegramDelivered: false,
      }),
      stateMachine: sm,
    }, d);

    expect(result.outcome).toBe('LIVE_REJECTED');
    expect(d.submitBuyOrder).not.toHaveBeenCalled();
    expect(sm.state).toBe('LIVE_REJECTED');
  });
});
