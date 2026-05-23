import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerShadowTrade } from '../../persistence/shadowTradeRepo.js';
import { __resetShadowDuplicateBuyRegistryForTests } from './shadowDuplicateBuyRegistry.js';
import { resolveBuyApprovalPolicy } from './buyApprovalPolicy.js';
import { createBuySignalStateMachine } from './buySignalStateMachine.js';
import {
  executeShadowBuyOrder,
  type ShadowBuyExecutorDeps,
} from './shadowBuyExecutor.js';

function makeTrade(overrides: Partial<ServerShadowTrade> = {}): ServerShadowTrade {
  return {
    id: 'trade-shadow-1',
    stockCode: '005930',
    stockName: 'Samsung',
    signalTime: '2026-05-18T00:00:00.000Z',
    signalPrice: 70_000,
    shadowEntryPrice: 70_000,
    quantity: 3,
    stopLoss: 65_000,
    targetPrice: 80_000,
    status: 'PENDING',
    mode: 'SHADOW',
    profitTranches: [],
    ...overrides,
  } as ServerShadowTrade;
}

function deps(overrides: Partial<ShadowBuyExecutorDeps> = {}): ShadowBuyExecutorDeps {
  return {
    appendShadowLog: vi.fn(),
    loadShadowTrades: vi.fn(() => []),
    executeShadowBuy: vi.fn(async ({ trade }) => {
      trade.status = 'ACTIVE';
      trade.fills = [{
        id: 'fill-1',
        type: 'BUY',
        subType: 'INITIAL_BUY',
        qty: trade.quantity,
        price: trade.shadowEntryPrice,
        reason: 'test',
        timestamp: '2026-05-18T00:00:00.000Z',
        status: 'CONFIRMED',
      }];
      return {
        outcome: 'EXECUTED' as const,
        reason: 'ok',
        tradeId: trade.id,
        executedAtIso: '2026-05-18T00:00:00.000Z',
        fillId: 'fill-1',
        fillPrice: trade.shadowEntryPrice,
        statusAfter: trade.status,
        liveOrderPlaced: false as const,
        executionImpact: 'NONE' as const,
      };
    }),
    recordShadowExecutionOutcome: vi.fn(),
    notifyFilled: vi.fn(),
    markAutoTradeReady: vi.fn(() => ({ ok: true, action: 'markAutoTradeReady' as const })),
    markFilled: vi.fn(() => ({ ok: true, action: 'markFilled' as const, skipped: true })),
    ...overrides,
  };
}

describe('shadowBuyExecutor', () => {
  beforeEach(() => {
    __resetShadowDuplicateBuyRegistryForTests();
  });

  it('finishes approved SHADOW execution at SHADOW_POSITION_OPENED', async () => {
    const trade = makeTrade();
    const sm = createBuySignalStateMachine({ mode: 'SHADOW' });
    sm.transition('APPROVAL_REQUESTED', 'requested');
    sm.transition('APPROVED', 'approved');
    const d = deps();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await executeShadowBuyOrder({
      trade,
      stockCode: '005930',
      stockName: 'Samsung',
      currentPrice: 70_000,
      entryPrice: 70_000,
      logEvent: 'BUY_SIGNAL',
      approvalPolicy: resolveBuyApprovalPolicy({
        mode: 'SHADOW',
        action: 'APPROVE',
        telegramDelivered: false,
      }),
      stateMachine: sm,
    }, d);

    expect(result.outcome).toBe('SHADOW_POSITION_OPENED');
    expect(result.orderIntent?.status).toBe('COMPLETED');
    expect(sm.state).toBe('SHADOW_POSITION_OPENED');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[SHADOW_EXECUTION_START]'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[SHADOW_SIGNAL_APPROVED]'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[SHADOW_SIGNAL_LIFECYCLE_REGISTERED]'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[ORDER_INTENT_CREATED]'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[SHADOW_ORDER_CREATED]'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[SHADOW_PAPER_FILLED]'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[SHADOW_POSITION_OPENED]'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[POSITION_STATE_OPENED]'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[PAPER_TRADE_LEDGER_RECORDED]'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[VIRTUAL_ACCOUNT_UPDATED]'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[ORDER_PIPELINE_COMPLETED]'));
    expect(d.notifyFilled).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('blocks duplicate same-day Shadow BUY before paper fill and Telegram', async () => {
    const trade = makeTrade();
    const existing = makeTrade({
      id: 'existing-open-1',
      stockCode: trade.stockCode,
      stockName: trade.stockName,
      status: 'ACTIVE',
      fills: [{
        id: 'existing-fill',
        type: 'BUY',
        subType: 'INITIAL_BUY',
        qty: 3,
        price: 70_000,
        reason: 'existing',
        timestamp: '2026-05-18T00:00:00.000Z',
        status: 'CONFIRMED',
      }],
    } as Partial<ServerShadowTrade>);
    const sm = createBuySignalStateMachine({ mode: 'SHADOW' });
    sm.transition('APPROVAL_REQUESTED', 'requested');
    sm.transition('APPROVED', 'approved');
    const d = deps({
      loadShadowTrades: vi.fn(() => [existing]),
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await executeShadowBuyOrder({
      trade,
      stockCode: '005930',
      stockName: 'Samsung',
      currentPrice: 70_000,
      entryPrice: 70_000,
      logEvent: 'BUY_SIGNAL',
      approvalPolicy: resolveBuyApprovalPolicy({
        mode: 'SHADOW',
        action: 'APPROVE',
        telegramDelivered: false,
      }),
      stateMachine: sm,
    }, d);

    expect(result.outcome).toBe('SHADOW_REJECTED');
    expect(result.reason).toBe('SHADOW_DUPLICATE_BUY_BLOCKED');
    expect(sm.state).toBe('DUPLICATE_BLOCKED');
    expect(d.executeShadowBuy).not.toHaveBeenCalled();
    expect(d.notifyFilled).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[SHADOW_DUPLICATE_BUY_BLOCKED]'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[TELEGRAM_DUPLICATE_SUPPRESSED]'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[SHADOW_POSITION_ALREADY_OPEN]'));
    warnSpy.mockRestore();
  });

  it('normalizes paper-fill failure to SHADOW_REJECTED', async () => {
    const trade = makeTrade();
    const sm = createBuySignalStateMachine({ mode: 'SHADOW' });
    sm.transition('APPROVAL_REQUESTED', 'requested');
    sm.transition('APPROVED', 'approved');
    const d = deps({
      executeShadowBuy: vi.fn(async ({ trade: inputTrade }) => ({
        outcome: 'INVALID_INPUT' as const,
        reason: 'bad qty',
        tradeId: inputTrade.id,
        executedAtIso: '2026-05-18T00:00:00.000Z',
        liveOrderPlaced: false as const,
        executionImpact: 'NONE' as const,
      })),
    });

    const result = await executeShadowBuyOrder({
      trade,
      stockCode: '005930',
      stockName: 'Samsung',
      currentPrice: 70_000,
      entryPrice: 70_000,
      logEvent: 'BUY_SIGNAL',
      approvalPolicy: resolveBuyApprovalPolicy({
        mode: 'SHADOW',
        action: 'APPROVE',
        telegramDelivered: true,
      }),
      stateMachine: sm,
    }, d);

    expect(result.outcome).toBe('SHADOW_REJECTED');
    expect(result.orderIntent?.status).toBe('REJECTED');
    expect(sm.state).toBe('SHADOW_REJECTED');
  });
});
