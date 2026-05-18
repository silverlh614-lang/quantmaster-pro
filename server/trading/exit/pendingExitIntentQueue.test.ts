import { afterEach, describe, expect, it, vi } from 'vitest';

import { recordPendingExitIntent } from './pendingExitIntentQueue.js';
import type { PendingEmergencyExit } from '../../persistence/pendingEmergencyExitQueueRepo.js';

function input() {
  return {
    tradeId: 'trade-1',
    stockCode: '005930',
    stockName: 'Samsung',
    qty: 3,
    currentPrice: 70000,
    returnPct: -3.2,
    regime: 'R6_DEFENSE',
    reason: 'SESSION_GUARDED_R6_EMERGENCY_EXIT',
    guardReason: 'SESSION_NOT_OPEN',
    marketSessionState: 'AFTER_HOURS',
    isKrxTradingOpen: false,
    kisOrderAllowed: false,
    liveOrderAllowed: true,
  };
}

describe('pendingExitIntentQueue', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records a deferred live sell intent and returns a normalized ExitDecision', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const row: PendingEmergencyExit = {
      id: 'pending-1',
      tradeId: 'trade-1',
      stockCode: '005930',
      stockName: 'Samsung',
      qty: 3,
      currentPrice: 70000,
      returnPct: -3.2,
      regime: 'R6_DEFENSE',
      reason: 'SESSION_GUARDED_R6_EMERGENCY_EXIT',
      guardReason: 'SESSION_NOT_OPEN',
      marketSessionState: 'AFTER_HOURS',
      isKrxTradingOpen: false,
      kisOrderAllowed: false,
      liveOrderAllowed: true,
      scheduledForNextOpen: true,
      liveOrderSent: false,
      executionImpact: 'NONE',
      createdAt: '2026-05-19T00:00:00.000Z',
    };
    const result = recordPendingExitIntent(input(), {
      appendPendingEmergencyExit: vi.fn(() => row),
    });

    expect(result).toEqual({
      kind: 'LIVE_SELL_DEFERRED',
      reason: 'SESSION_GUARDED_R6_EMERGENCY_EXIT',
      pendingIntentId: 'pending-1',
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[P0][P0_LIVE_EXIT_DEFERRED_NON_TRADING]'),
      expect.objectContaining({ code: 'P0_LIVE_EXIT_DEFERRED_NON_TRADING' }),
    );
  });

  it('returns EXIT_FAILED and emits P0 when persistence fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = recordPendingExitIntent(input(), {
      appendPendingEmergencyExit: vi.fn(() => {
        throw new Error('disk failed');
      }),
    });

    expect(result).toEqual({
      kind: 'EXIT_FAILED',
      reason: 'disk failed',
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[P0][P0_PENDING_EXIT_INTENT_FAILED]'),
      expect.objectContaining({ code: 'P0_PENDING_EXIT_INTENT_FAILED' }),
    );
  });
});
