import { describe, expect, it, vi } from 'vitest';
import { normalizeFillQueryResult, queryKisFill } from './kisFillQueryService.js';

describe('kisFillQueryService', () => {
  it('normalizes full CCLD rows to FILLED', () => {
    const result = normalizeFillQueryResult({
      order: { side: 'SELL', ordNo: 'OD-1', symbol: '005930', orderQty: 10 },
      raw: { output: [{ odno: 'OD-1', ord_qty: '10', tot_ccld_qty: '10', avg_prvs: '70000' }] },
    });

    expect(result).toEqual({
      kind: 'FILLED',
      filledQty: 10,
      avgPrice: 70000,
      raw: expect.any(Object),
    });
  });

  it('normalizes partial rows to PARTIALLY_FILLED', () => {
    const result = normalizeFillQueryResult({
      order: { side: 'SELL', ordNo: 'OD-1', symbol: '005930', orderQty: 10 },
      raw: { output: [{ odno: 'OD-1', ord_qty: '10', tot_ccld_qty: '4', avg_prvs: '70000' }] },
    });

    expect(result).toMatchObject({
      kind: 'PARTIALLY_FILLED',
      filledQty: 4,
      remainingQty: 6,
      avgPrice: 70000,
    });
  });

  it('keeps empty responses retryable instead of treating them as fatal', () => {
    const result = normalizeFillQueryResult({
      order: { side: 'SELL', ordNo: 'OD-1', symbol: '005930', orderQty: 10 },
      raw: { output: [] },
    });

    expect(result).toEqual({
      kind: 'EMPTY_RESPONSE',
      retryable: true,
      raw: { output: [] },
    });
  });

  it('returns QUERY_FAILED for malformed responses', () => {
    const result = normalizeFillQueryResult({
      order: { side: 'BUY', ordNo: 'OD-1', symbol: '005930', orderQty: 10 },
      raw: { output: null },
    });

    expect(result).toMatchObject({
      kind: 'QUERY_FAILED',
      retryable: true,
      reason: 'MALFORMED_KIS_FILL_RESPONSE',
    });
  });

  it('wraps KIS request failures as retryable QUERY_FAILED', async () => {
    const result = await queryKisFill({
      side: 'SELL',
      ordNo: 'OD-1',
      symbol: '005930',
      orderQty: 10,
    }, {
      kisGet: vi.fn(async () => {
        throw new Error('cooldown');
      }) as never,
      isReal: true,
      now: () => new Date('2026-05-19T00:00:00.000Z'),
    });

    expect(result).toMatchObject({
      kind: 'QUERY_FAILED',
      reason: 'cooldown',
      retryable: true,
    });
  });
});
