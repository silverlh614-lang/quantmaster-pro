import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decideSellFillMonitorAction, normalizeSellFillState } from './sellFillMonitor.js';
import { __resetSellReissuePolicyForTests } from './sellReissuePolicy.js';

describe('sellFillMonitor', () => {
  const order = {
    ordNo: 'SELL-1',
    symbol: '005930',
    orderQty: 10,
    pollCount: 1,
    mode: 'LIVE' as const,
    reason: 'STOP_LOSS',
  };

  beforeEach(() => {
    __resetSellReissuePolicyForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes sell-specific fill states', () => {
    expect(normalizeSellFillState({ kind: 'FILLED', filledQty: 10, avgPrice: 71000 })).toBe('SELL_FILLED');
    expect(normalizeSellFillState({ kind: 'PARTIALLY_FILLED', filledQty: 4, remainingQty: 6 })).toBe(
      'PARTIALLY_FILLED',
    );
    expect(normalizeSellFillState({ kind: 'UNFILLED', reason: 'still pending', retryable: true })).toBe('UNFILLED');
    expect(normalizeSellFillState({ kind: 'REJECTED', reason: 'rejected' })).toBe('REJECTED');
  });

  it('allows one market reissue for a max-polled sell order', () => {
    const first = decideSellFillMonitorAction({
      order: { ...order, pollCount: 5 },
      maxPollCount: 5,
      marketSession: 'REGULAR',
      riskMode: 'NORMAL',
      marketOpen: true,
      liveSellAllowed: true,
      queryResult: { kind: 'UNFILLED', reason: 'not filled', retryable: true },
    });

    expect(first).toEqual({
      action: 'REISSUE_MARKET',
      state: 'UNFILLED',
      remainingQty: 10,
      dedupKey: 'sell-reissue:LIVE:005930:SELL-1:STOP_LOSS',
      executionImpact: 'NONE',
      terminal: false,
    });

    const second = decideSellFillMonitorAction({
      order: { ...order, pollCount: 5 },
      maxPollCount: 5,
      marketSession: 'REGULAR',
      riskMode: 'NORMAL',
      marketOpen: true,
      liveSellAllowed: true,
      queryResult: { kind: 'UNFILLED', reason: 'not filled', retryable: true },
    });

    expect(second).toEqual({
      action: 'DUPLICATE_REISSUE_BLOCKED',
      state: 'UNFILLED',
      dedupKey: 'sell-reissue:LIVE:005930:SELL-1:STOP_LOSS',
      executionImpact: 'LIVE_SELL_BLOCKED',
      terminal: false,
    });
  });

  it('defers reissue outside the regular trading session', () => {
    expect(
      decideSellFillMonitorAction({
        order: { ...order, pollCount: 5 },
        maxPollCount: 5,
        marketSession: 'CLOSED',
        riskMode: 'NORMAL',
        marketOpen: false,
        liveSellAllowed: true,
        queryResult: { kind: 'UNFILLED', reason: 'not filled', retryable: true },
      }),
    ).toEqual({
      action: 'DEFER_MONITOR',
      state: 'UNFILLED',
      reason: 'NON_TRADING_SESSION_CLOSED',
      executionImpact: 'EXIT_MONITOR_DEGRADED',
      terminal: false,
    });
  });

  it('records sell query failure as degraded instead of reissuing blindly', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(
      decideSellFillMonitorAction({
        order: { ...order, pollCount: 5 },
        maxPollCount: 5,
        marketSession: 'REGULAR',
        riskMode: 'NORMAL',
        marketOpen: true,
        liveSellAllowed: true,
        queryResult: { kind: 'QUERY_FAILED', reason: 'KIS cooldown', retryable: true },
      }),
    ).toEqual({
      action: 'MONITOR_DEGRADED',
      state: 'UNFILLED',
      reason: 'KIS cooldown',
      retryable: true,
      executionImpact: 'EXIT_MONITOR_DEGRADED',
      terminal: false,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[P0][P0_SELL_FILL_MONITOR_DEGRADED]'),
      expect.any(Object),
    );
  });
});
