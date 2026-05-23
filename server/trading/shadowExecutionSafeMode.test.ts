import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerShadowTrade } from '../persistence/shadowTradeRepo.js';
import {
  executeShadowBuy,
  __resetShadowExecutionPipelineSummaryForTests,
} from './shadowExecutionPipeline.js';
import {
  __resetShadowExecutionSafetyForTests,
  isStopBlockedByUnverifiedEntry,
  markShadowTradeQuarantined,
  verifyShadowPositionQuantityForAutoExit,
  type AuthoritativeQuoteSnapshot,
} from './shadowExecutionSafety.js';
import {
  recordShadowExitNotification,
  resetShadowExitDedupStateForTest,
  shouldSendShadowExitNotification,
} from '../shadow/shadowExitDedup.js';

function makeTrade(overrides: Partial<ServerShadowTrade> = {}): ServerShadowTrade {
  return {
    id: 'shadow-safe-084670',
    stockCode: '084670',
    stockName: 'Dongyang Express',
    signalTime: '2026-05-22T00:00:00.000Z',
    signalPrice: 46_300,
    shadowEntryPrice: 48_600,
    quantity: 117,
    originalQuantity: 117,
    stopLoss: 45_198,
    targetPrice: 55_000,
    status: 'PENDING',
    mode: 'SHADOW',
    profitTranches: [],
    entryRegime: 'R5_CAUTION',
    ...overrides,
  } as ServerShadowTrade;
}

function quote(overrides: Partial<AuthoritativeQuoteSnapshot> = {}): AuthoritativeQuoteSnapshot {
  return {
    symbol: '084670',
    currentPrice: 46_300,
    quoteSource: 'KIS_API',
    quoteAsOf: '2026-05-22T02:00:00.000Z',
    snapshotId: 'quote-safe-1',
    marketSession: 'REGULAR',
    isStale: false,
    staleMs: 0,
    confidence: 'VERIFIED',
    providerIssue: null,
    tradingHalted: false,
    priceBasis: 'KIS_CURRENT',
    ...overrides,
  };
}

function activeTrade(id: string): ServerShadowTrade {
  return makeTrade({
    id,
    stockCode: id,
    status: 'ACTIVE',
    shadowEntryPrice: 10_000,
    signalPrice: 10_000,
    quantity: 1,
    originalQuantity: 1,
    fills: [{
      id: `${id}-buy`,
      type: 'BUY',
      subType: 'INITIAL_BUY',
      qty: 1,
      price: 10_000,
      reason: 'existing',
      timestamp: '2026-05-22T01:59:00.000Z',
      status: 'CONFIRMED',
      confirmedAt: '2026-05-22T01:59:00.000Z',
    }],
  });
}

describe('SHADOW_EXECUTION_SAFE_MODE price and position SSOT', () => {
  beforeEach(() => {
    process.env.SHADOW_EXECUTION_SAFE_MODE = 'true';
    __resetShadowExecutionPipelineSummaryForTests();
    __resetShadowExecutionSafetyForTests();
    resetShadowExitDedupStateForTest();
  });

  afterEach(() => {
    delete process.env.SHADOW_EXECUTION_SAFE_MODE;
    vi.restoreAllMocks();
  });

  it('rejects a 4.97% shadow buy fill deviation and does not open a position', async () => {
    const trade = makeTrade();
    const notifyFilled = vi.fn();

    const result = await executeShadowBuy({
      trade,
      allTrades: [trade],
      proposedFillPrice: 48_600,
      now: new Date('2026-05-22T02:00:00.000Z'),
      quoteResolver: () => quote(),
      notifyFilled,
    });

    expect(result.outcome).toBe('BAD_FILL_PRICE_DEVIATION');
    expect(result.learningTag).toBe('CASE_BAD_SHADOW_FILL_PRICE');
    expect(result.currentPrice).toBe(46_300);
    expect(result.proposedFillPrice).toBe(48_600);
    expect(result.deviationPct).toBeCloseTo(4.9676, 3);
    expect(trade.status).toBe('PENDING');
    expect(trade.fills ?? []).toHaveLength(0);
    expect(notifyFilled).not.toHaveBeenCalled();
  });

  it('opens a shadow position only after verified quote validation', async () => {
    const trade = makeTrade({
      shadowEntryPrice: 46_300,
      signalPrice: 46_300,
      quantity: 10,
      originalQuantity: 10,
      stopLoss: 43_059,
    });
    const notifyFilled = vi.fn();

    const result = await executeShadowBuy({
      trade,
      allTrades: [trade],
      proposedFillPrice: 46_300,
      now: new Date('2026-05-22T02:00:00.000Z'),
      quoteResolver: () => quote({ currentPrice: 46_300 }),
      notifyFilled,
    });

    expect(result.outcome).toBe('EXECUTED');
    expect(result.fillPrice).toBe(46_300);
    expect(result.priceSnapshotId).toBe('ps_quote-safe-1');
    expect(result.priceConfidence).toBe('DELAYED_VALID');
    expect(result.orderIntentStatus).toBe('READY');
    expect(result.tradePlanValid).toBe(true);
    expect(result.quoteConfidence).toBe('VERIFIED');
    expect(trade.status).toBe('ACTIVE');
    expect(trade.entryPriceValidationStatus).toBe('VERIFIED');
    expect((trade as { priceSnapshotId?: string }).priceSnapshotId).toBe('ps_quote-safe-1');
    expect(trade.fills?.[0].price).toBe(46_300);
    expect(notifyFilled).toHaveBeenCalledWith(expect.objectContaining({
      validation: 'VERIFIED',
      currentPrice: 46_300,
      fillReferencePrice: 46_300,
      liveOrderPlaced: false,
    }));
  });

  it('rejects a stale quote before creating paper fill', async () => {
    const trade = makeTrade({ shadowEntryPrice: 46_300, signalPrice: 46_300 });

    const result = await executeShadowBuy({
      trade,
      allTrades: [trade],
      proposedFillPrice: 46_300,
      now: new Date('2026-05-22T02:00:10.000Z'),
      quoteResolver: () => quote({
        currentPrice: 46_300,
        quoteAsOf: '2026-05-22T02:00:00.000Z',
      }),
    });

    expect(result.outcome).toBe('STALE_QUOTE_FOR_EXECUTION');
    expect(result.learningTag).toBe('CASE_STALE_QUOTE_EXECUTION_BLOCKED');
    expect(trade.status).toBe('PENDING');
    expect(trade.fills ?? []).toHaveLength(0);
  });

  it('blocks previous-close shadow fill sources and suppresses fill notification', async () => {
    const trade = makeTrade({ shadowEntryPrice: 46_300, signalPrice: 46_300 });
    const notifyFilled = vi.fn();

    const result = await executeShadowBuy({
      trade,
      allTrades: [trade],
      proposedFillPrice: 46_300,
      now: new Date('2026-05-22T02:00:00.000Z'),
      quoteResolver: () => quote({
        currentPrice: 46_300,
        quoteSource: 'PREVIOUS_CLOSE',
        priceBasis: 'KIS_CURRENT',
      }),
      notifyFilled,
    });

    expect(result.outcome).toBe('QUOTE_SOURCE_NOT_EXECUTABLE');
    expect(result.learningTag).toBe('CASE_STALE_QUOTE_EXECUTION_BLOCKED');
    expect(trade.status).toBe('PENDING');
    expect(trade.fills ?? []).toHaveLength(0);
    expect(notifyFilled).not.toHaveBeenCalled();
  });

  it('marks quantity mismatch inconsistent and blocks auto exit diagnostics', () => {
    const trade = makeTrade({
      status: 'ACTIVE',
      quantity: 58,
      originalQuantity: 117,
      entryPriceValidationStatus: 'VERIFIED',
      fills: [{
        id: 'fill-buy-117',
        type: 'BUY',
        subType: 'INITIAL_BUY',
        qty: 117,
        price: 48_600,
        reason: 'bad old fill',
        timestamp: '2026-05-22T00:00:00.000Z',
        status: 'CONFIRMED',
        confirmedAt: '2026-05-22T00:00:00.000Z',
      }],
    });

    const check = verifyShadowPositionQuantityForAutoExit(trade);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('POSITION_QTY_MISMATCH');
    expect(check.positionQty).toBe(58);
    expect(check.ledgerQty).toBe(117);

    markShadowTradeQuarantined({
      trade,
      reason: 'POSITION_QTY_MISMATCH',
      learningTag: 'CASE_POSITION_QTY_MISMATCH',
      now: new Date('2026-05-22T02:00:00.000Z'),
    });
    expect(trade.status).toBe('INCONSISTENT');
    expect(trade.needsManualReview).toBe(true);
  });

  it('rechecks slot guard immediately before shadow fill', async () => {
    const trade = makeTrade({
      id: 'new-slot-trade',
      stockCode: '084670',
      shadowEntryPrice: 46_300,
      signalPrice: 46_300,
      quantity: 1,
      originalQuantity: 1,
    });
    const open = [activeTrade('slot-1'), activeTrade('slot-2'), activeTrade('slot-3')];

    const result = await executeShadowBuy({
      trade,
      allTrades: [...open, trade],
      proposedFillPrice: 46_300,
      maxPositions: 3,
      now: new Date('2026-05-22T02:00:00.000Z'),
      quoteResolver: () => quote({ currentPrice: 46_300 }),
    });

    expect(result.outcome).toBe('SHADOW_SLOT_FULL_AT_FILL_TIME');
    expect(result.learningTag).toBe('CASE_SLOT_FULL_FILL_BLOCKED');
    expect(trade.status).toBe('PENDING');
    expect(trade.fills ?? []).toHaveLength(0);
  });

  it('suppresses repeated STOP_EXECUTION_IMMINENT alerts for the same position', () => {
    const input = {
      mode: 'SHADOW',
      tradeDate: '2026-05-22',
      symbol: '084670',
      positionId: 'position-1',
      exitReason: 'STOP_LOSS',
      exitStage: 'STOP_EXECUTION_IMMINENT',
      channelType: 'BOT',
      messageKind: 'STOP_EXECUTION_IMMINENT',
    };

    expect(shouldSendShadowExitNotification({ ...input, positionStatus: 'ACTIVE' }).allow).toBe(true);
    recordShadowExitNotification(input);
    expect(shouldSendShadowExitNotification({ ...input, positionStatus: 'ACTIVE' }).allow).toBe(false);
    expect(shouldSendShadowExitNotification({ ...input, positionStatus: 'ACTIVE' }).allow).toBe(false);
  });

  it('blocks stop engine when entry price validation is not VERIFIED', () => {
    const trade = makeTrade({
      status: 'ACTIVE',
      entryPriceValidationStatus: 'UNVERIFIED',
    });

    expect(isStopBlockedByUnverifiedEntry(trade)).toBe(true);
    markShadowTradeQuarantined({
      trade,
      reason: 'STOP_BLOCKED_UNVERIFIED_ENTRY_PRICE',
      learningTag: 'CASE_STOP_BLOCKED_UNVERIFIED_ENTRY_PRICE',
      now: new Date('2026-05-22T02:00:00.000Z'),
    });
    expect(trade.status).toBe('QUARANTINED_BAD_ENTRY');
    expect(trade.executionImpact).toBe('NONE');
  });
});
