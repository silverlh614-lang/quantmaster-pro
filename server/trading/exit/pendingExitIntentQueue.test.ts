import { afterEach, describe, expect, it, vi } from 'vitest';

import { recordPendingExitIntent } from './pendingExitIntentQueue.js';
import { emitExitOperationalWarn } from './exitOperationalWarn.js';
import type { PendingEmergencyExit } from '../../persistence/pendingEmergencyExitQueueRepo.js';

// P0 운영 경고는 console.warn 직접 호출이 아니라 중앙 SSOT emitExitOperationalWarn 으로 emit 된다
// (DEFERRED_NON_TRADING 은 executionImpact=NONE 이라 adapter 가 console 출력을 기본 억제 —
// 신호 유실이 아니라 라우팅 중앙화). 따라서 P0 emit 계약은 중앙 emitter 호출로 검증한다.
vi.mock('./exitOperationalWarn.js', () => ({ emitExitOperationalWarn: vi.fn() }));

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
    vi.mocked(emitExitOperationalWarn).mockClear();
    vi.restoreAllMocks();
  });

  it('records a deferred live sell intent and returns a normalized ExitDecision', () => {
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
    expect(emitExitOperationalWarn).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'P0_LIVE_EXIT_DEFERRED_NON_TRADING' }),
    );
  });

  it('returns EXIT_FAILED and emits P0 when persistence fails', () => {
    const result = recordPendingExitIntent(input(), {
      appendPendingEmergencyExit: vi.fn(() => {
        throw new Error('disk failed');
      }),
    });

    expect(result).toEqual({
      kind: 'EXIT_FAILED',
      reason: 'disk failed',
    });
    expect(emitExitOperationalWarn).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'P0_PENDING_EXIT_INTENT_FAILED' }),
    );
  });
});
