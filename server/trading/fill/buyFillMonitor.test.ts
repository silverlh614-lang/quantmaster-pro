import { describe, expect, it } from 'vitest';
import { decideBuyFillMonitorAction, normalizeBuyFillState } from './buyFillMonitor.js';

describe('buyFillMonitor', () => {
  const order = {
    ordNo: 'BUY-1',
    symbol: '005930',
    orderQty: 10,
    pollCount: 1,
  };

  it('normalizes submitted buy fill results without sell policy coupling', () => {
    expect(normalizeBuyFillState({ kind: 'FILLED', filledQty: 10, avgPrice: 71000 })).toBe('FILLED');
    expect(normalizeBuyFillState({ kind: 'PARTIALLY_FILLED', filledQty: 4, remainingQty: 6 })).toBe(
      'PARTIALLY_FILLED',
    );
    expect(normalizeBuyFillState({ kind: 'UNFILLED', reason: 'still pending', retryable: true })).toBe('UNFILLED');
    expect(normalizeBuyFillState({ kind: 'REJECTED', reason: 'rejected' })).toBe('REJECTED');
  });

  it('marks filled orders as terminal', () => {
    expect(
      decideBuyFillMonitorAction({
        order,
        maxPollCount: 10,
        queryResult: { kind: 'FILLED', filledQty: 10, avgPrice: 71000 },
      }),
    ).toEqual({
      action: 'MARK_FILLED',
      state: 'FILLED',
      filledQty: 10,
      avgPrice: 71000,
      terminal: true,
    });
  });

  it('expires non-retryable or max-poll unfilled buy orders', () => {
    expect(
      decideBuyFillMonitorAction({
        order: { ...order, pollCount: 10 },
        maxPollCount: 10,
        queryResult: { kind: 'UNFILLED', reason: 'max poll reached', retryable: true },
      }),
    ).toEqual({
      action: 'MARK_EXPIRED',
      state: 'UNFILLED',
      reason: 'max poll reached',
      terminal: true,
    });
  });
});
