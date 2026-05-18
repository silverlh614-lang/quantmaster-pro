import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./sellReservationLedger.js', () => ({
  recordSellReservationLedgerEvent: vi.fn(),
}));

import {
  confirmSellSubmitted,
  markSellFailed,
  markSellFilled,
  reconcileOrphanedReservations,
  reserveSell,
  sellReservationManager,
} from './sellReservationManager.js';
import type { ServerShadowTrade } from '../../../persistence/shadowTradeRepo.js';

function trade(overrides: Partial<ServerShadowTrade> = {}): ServerShadowTrade {
  return {
    id: 'pos-1',
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
    ...overrides,
  };
}

describe('sellReservationManager', () => {
  beforeEach(() => {
    sellReservationManager.__testOnly.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('reserves, submits, and marks a live sell as filled', () => {
    const t = trade();
    const reserved = reserveSell({
      trade: t,
      requestedQty: 30,
      reason: 'STOP_LOSS',
      now: new Date('2026-05-19T01:00:00.000Z'),
    });

    expect(reserved).toEqual({
      kind: 'RESERVED',
      reservationId: expect.any(String),
      reservedQty: 30,
    });

    if (reserved.kind !== 'RESERVED') throw new Error('expected reserved');
    expect(confirmSellSubmitted({
      reservationId: reserved.reservationId,
      ordNo: 'OD-1',
      now: new Date('2026-05-19T01:01:00.000Z'),
    })).toEqual({
      kind: 'PENDING',
      reservationId: reserved.reservationId,
      reservedQty: 30,
      ordNo: 'OD-1',
    });

    expect(markSellFilled({
      reservationId: reserved.reservationId,
      filledQty: 30,
      now: new Date('2026-05-19T01:02:00.000Z'),
    })).toEqual({
      kind: 'PENDING',
      reservationId: reserved.reservationId,
      reservedQty: 30,
      ordNo: 'OD-1',
    });
  });

  it('blocks duplicate sell intent by dedup key', () => {
    const t = trade();
    reserveSell({ trade: t, requestedQty: 30, reason: 'STOP_LOSS' });

    const duplicate = reserveSell({ trade: t, requestedQty: 30, reason: 'STOP_LOSS' });

    expect(duplicate).toEqual({
      kind: 'DUPLICATE_BLOCKED',
      dedupKey: 'sell-reserve:LIVE:005930:pos-1:STOP_LOSS:30',
    });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[P0][P0_SELL_DUPLICATE_BLOCKED]'),
      expect.objectContaining({ code: 'P0_SELL_DUPLICATE_BLOCKED' }),
    );
  });

  it('blocks sell quantity above available minus pending reservations', () => {
    const t = trade({
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
        {
          id: 'sell-pending',
          type: 'SELL',
          qty: 20,
          price: 110,
          reason: 'PENDING',
          timestamp: '2026-05-19T00:10:00.000Z',
          status: 'PROVISIONAL',
        },
      ],
    });

    const result = reserveSell({ trade: t, requestedQty: 81, reason: 'STOP_LOSS' });

    expect(result).toEqual({
      kind: 'INSUFFICIENT_QUANTITY',
      availableQty: 80,
      requestedQty: 81,
    });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[P0][P0_SELL_INSUFFICIENT_QUANTITY]'),
      expect.objectContaining({ code: 'P0_SELL_INSUFFICIENT_QUANTITY' }),
    );
  });

  it('marks failed reservations rollback-required', () => {
    const t = trade();
    const reserved = reserveSell({ trade: t, requestedQty: 10, reason: 'TAKE_PROFIT' });
    if (reserved.kind !== 'RESERVED') throw new Error('expected reserved');

    expect(markSellFailed({
      reservationId: reserved.reservationId,
      reason: 'KIS_FAILED',
    })).toEqual({
      kind: 'FAILED',
      reason: 'KIS_FAILED',
      rollbackRequired: true,
    });

    expect(reserveSell({ trade: t, requestedQty: 10, reason: 'TAKE_PROFIT' }).kind).toBe('RESERVED');
  });

  it('reconciles orphaned non-terminal reservations', () => {
    const t = trade();
    reserveSell({
      trade: t,
      requestedQty: 10,
      reason: 'TAKE_PROFIT',
      now: new Date('2026-05-19T01:00:00.000Z'),
    });

    const orphaned = reconcileOrphanedReservations(
      new Date('2026-05-19T01:31:00.000Z'),
      30 * 60 * 1000,
    );

    expect(orphaned).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[P0][P0_SELL_RESERVATION_ORPHANED]'),
      expect.objectContaining({ code: 'P0_SELL_RESERVATION_ORPHANED' }),
    );
  });
});
