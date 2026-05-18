import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveExitSessionGuard } from './exitSessionGuard.js';

describe('exitSessionGuard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows live sell orders only in regular open sessions', () => {
    expect(resolveExitSessionGuard({
      marketSessionState: 'REGULAR',
      isKrxTradingOpen: true,
      kisOrderAllowed: true,
      liveOrderAllowed: true,
    })).toMatchObject({
      marketSessionState: 'REGULAR',
      liveSellOrderAllowed: true,
    });
  });

  it('blocks live sell orders outside regular trading', () => {
    expect(resolveExitSessionGuard({
      marketSessionState: 'AFTER_MARKET',
      isKrxTradingOpen: false,
      kisOrderAllowed: false,
      liveOrderAllowed: true,
    })).toMatchObject({
      marketSessionState: 'AFTER_HOURS',
      liveSellOrderAllowed: false,
      reason: 'SESSION_NOT_OPEN',
    });
  });

  it('treats SELL_ONLY as not sufficient for real sell order submission', () => {
    expect(resolveExitSessionGuard({
      marketSessionState: 'SELL_ONLY',
      sellOnly: true,
    })).toMatchObject({
      marketSessionState: 'SELL_ONLY',
      liveSellOrderAllowed: false,
      reason: 'SESSION_NOT_OPEN',
    });
  });
});
