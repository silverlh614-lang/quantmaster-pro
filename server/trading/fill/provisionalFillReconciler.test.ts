import { describe, expect, it } from 'vitest';
import type { ServerShadowTrade } from '../../persistence/shadowTradeRepo.js';
import { reconcileProvisionalFill } from './provisionalFillReconciler.js';

function makeTrade(): ServerShadowTrade {
  return {
    id: 'trade-1',
    stockCode: '005930',
    stockName: 'Samsung',
    signalTime: '2026-05-19T00:00:00.000Z',
    signalPrice: 70000,
    shadowEntryPrice: 70000,
    quantity: 10,
    stopLoss: 65000,
    targetPrice: 80000,
    status: 'ACTIVE',
    profitTranches: [],
    fills: [{
      id: 'fill-1',
      type: 'SELL',
      qty: 10,
      price: 70000,
      reason: 'test',
      timestamp: '2026-05-19T00:00:00.000Z',
      ordNo: 'OD-1',
      status: 'PROVISIONAL',
    }],
  } as ServerShadowTrade;
}

describe('provisionalFillReconciler', () => {
  it('confirms provisional fills when KIS confirms fill', () => {
    const trade = makeTrade();
    const result = reconcileProvisionalFill({
      trade,
      ordNo: 'OD-1',
      queryResult: { kind: 'FILLED', filledQty: 10, avgPrice: 71000 },
      now: new Date('2026-05-19T01:00:00.000Z'),
    });

    expect(result.outcome).toBe('CONFIRMED');
    expect(result.fill).toMatchObject({
      qty: 10,
      price: 71000,
      status: 'CONFIRMED',
      confirmedAt: '2026-05-19T01:00:00.000Z',
    });
  });

  it('keeps retryable empty responses pending', () => {
    const trade = makeTrade();
    const result = reconcileProvisionalFill({
      trade,
      ordNo: 'OD-1',
      queryResult: { kind: 'EMPTY_RESPONSE', retryable: true },
    });

    expect(result).toMatchObject({
      outcome: 'PENDING',
      reason: 'EMPTY_RESPONSE_RETRYABLE',
    });
    expect(result.fill?.status).toBe('PROVISIONAL');
  });

  it('marks non-retryable unfilled provisional fills for rollback', () => {
    const trade = makeTrade();
    const result = reconcileProvisionalFill({
      trade,
      ordNo: 'OD-1',
      queryResult: { kind: 'UNFILLED', retryable: false, reason: 'expired' },
      now: new Date('2026-05-19T01:00:00.000Z'),
    });

    expect(result.outcome).toBe('ROLLBACK_REQUIRED');
    expect(result.fill).toMatchObject({
      status: 'REVERTED',
      revertedAt: '2026-05-19T01:00:00.000Z',
    });
  });
});
