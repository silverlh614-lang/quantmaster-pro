import { describe, expect, it } from 'vitest';
import { decideUnfilledOrderPolicy } from './unfilledOrderPolicy.js';

describe('unfilledOrderPolicy', () => {
  it('defers live reissue outside trading hours', () => {
    expect(decideUnfilledOrderPolicy({
      side: 'SELL',
      pollCount: 5,
      maxPollCount: 5,
      marketSession: 'CLOSED',
      riskMode: 'NORMAL',
      retryable: false,
    })).toMatchObject({
      action: 'DEFER_MONITOR',
      canPlaceLiveOrder: false,
      executionImpact: 'EXIT_MONITOR_DEGRADED',
    });
  });

  it('reissues sell market orders only after max poll in regular session', () => {
    expect(decideUnfilledOrderPolicy({
      side: 'SELL',
      pollCount: 5,
      maxPollCount: 5,
      marketSession: 'REGULAR',
      riskMode: 'NORMAL',
      retryable: false,
    })).toMatchObject({
      action: 'REISSUE_MARKET',
      canPlaceLiveOrder: true,
    });
  });

  it('does not share sell reissue policy with buy unfilled orders', () => {
    expect(decideUnfilledOrderPolicy({
      side: 'BUY',
      pollCount: 5,
      maxPollCount: 5,
      marketSession: 'REGULAR',
      riskMode: 'NORMAL',
      retryable: false,
    })).toMatchObject({
      action: 'CANCEL',
      canPlaceLiveOrder: false,
    });
  });
});
