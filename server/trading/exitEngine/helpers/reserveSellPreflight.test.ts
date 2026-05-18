import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../clients/kisClient.js', () => ({
  placeKisSellOrder: vi.fn(),
}));

vi.mock('../../../persistence/shadowTradeRepo.js', async () => {
  const actual = await vi.importActual<any>('../../../persistence/shadowTradeRepo.js');
  return {
    ...actual,
    appendShadowLog: vi.fn(),
    appendFill: vi.fn((trade: any, fill: any) => {
      trade.fills = [...(trade.fills ?? []), { ...fill, id: `fill-${trade.fills?.length ?? 0}` }];
    }),
    syncPositionCache: vi.fn(),
    getRemainingQty: vi.fn((trade: any) => trade.quantity ?? 0),
    getTotalRealizedPnl: vi.fn(() => 0),
  };
});

vi.mock('../../tradeEventLog.js', () => ({
  appendTradeEvent: vi.fn(),
}));

vi.mock('../../shadowPositionLifecycle.js', () => ({
  emitShadowSellSignal: vi.fn(() => ({ outcome: 'RECORDED' })),
  emitShadowSellPaperFilled: vi.fn(() => ({ outcome: 'RECORDED' })),
  emitShadowPositionClosed: vi.fn(() => ({ outcome: 'RECORDED' })),
  recordShadowLifecycleOutcome: vi.fn(),
}));

vi.mock('./attribution.js', () => ({
  emitPartialAttributionForSell: vi.fn(),
}));

import { placeKisSellOrder } from '../../../clients/kisClient.js';
import { sellReservationManager } from '../../exit/sellReservation/sellReservationManager.js';
import { placeReservedSellOrder } from './reserveSell.js';
import type { ServerShadowTrade } from '../../../persistence/shadowTradeRepo.js';

function trade(): ServerShadowTrade {
  return {
    id: 'pos-dup',
    stockCode: '005930',
    stockName: 'Samsung',
    signalTime: '2026-05-19T00:00:00.000Z',
    signalPrice: 100,
    shadowEntryPrice: 100,
    quantity: 100,
    originalQuantity: 100,
    stopLoss: 90,
    targetPrice: 130,
    status: 'ACTIVE',
    mode: 'LIVE',
    fills: [
      {
        id: 'buy-1',
        type: 'BUY',
        qty: 100,
        price: 100,
        reason: 'BUY',
        timestamp: '2026-05-19T00:00:00.000Z',
        status: 'CONFIRMED',
      },
    ],
  };
}

describe('placeReservedSellOrder preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    sellReservationManager.__testOnly.clear();
  });

  it('blocks duplicate sell intent before sending a second KIS order', async () => {
    vi.mocked(placeKisSellOrder).mockResolvedValue({
      ordNo: 'OD-1',
      placed: true,
      outcome: 'LIVE_ORDERED',
    });

    const t = trade();
    const fill = {
      type: 'SELL' as const,
      subType: 'STOP_LOSS' as const,
      qty: 30,
      price: 95,
      pnl: -150,
      pnlPct: -5,
      reason: 'STOP_LOSS',
      exitRuleTag: 'HARD_STOP',
      timestamp: '2026-05-19T01:00:00.000Z',
    };

    const first = await placeReservedSellOrder(t, 30, 'STOP_LOSS', fill, 'HARD_STOP');
    const second = await placeReservedSellOrder(t, 30, 'STOP_LOSS', fill, 'HARD_STOP');

    expect(first.kind).toBe('PENDING');
    expect(second).toEqual(expect.objectContaining({
      kind: 'FAILED',
      recorded: false,
      reason: expect.stringContaining('DUPLICATE_BLOCKED'),
    }));
    expect(placeKisSellOrder).toHaveBeenCalledTimes(1);
  });
});
