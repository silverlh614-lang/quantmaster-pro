import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveR6LiveEmergencyExitPolicy } from './r6LiveEmergencyExitPolicy.js';
import type { ExitDecision } from '../exitTypes.js';

function liveTrade(overrides: Record<string, unknown> = {}) {
  return {
    id: 'live-1',
    stockCode: '005930',
    stockName: 'Samsung',
    quantity: 100,
    mode: 'LIVE',
    ...overrides,
  } as any;
}

describe('r6LiveEmergencyExitPolicy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a live sell intent only when regular session order submission is allowed', () => {
    expect(resolveR6LiveEmergencyExitPolicy({
      trade: liveTrade(),
      currentRegime: 'R6_DEFENSE',
      currentPrice: 70000,
      returnPct: -4.2,
      marketSessionState: 'REGULAR',
      isKrxTradingOpen: true,
      kisOrderAllowed: true,
      liveOrderAllowed: true,
    })).toEqual({
      kind: 'LIVE_SELL_INTENT',
      reason: 'R6_LIVE_EMERGENCY_EXIT',
      qty: 30,
    });
  });

  it('defers live R6 exit outside regular trading and records a pending intent', () => {
    const deferred: ExitDecision = {
      kind: 'LIVE_SELL_DEFERRED',
      reason: 'SESSION_GUARDED_R6_EMERGENCY_EXIT',
      pendingIntentId: 'pending-1',
    };
    const decision = resolveR6LiveEmergencyExitPolicy({
      trade: liveTrade(),
      currentRegime: 'R6_DEFENSE',
      currentPrice: 70000,
      returnPct: -4.2,
      marketSessionState: 'AFTER_HOURS',
      isKrxTradingOpen: false,
      kisOrderAllowed: false,
      liveOrderAllowed: true,
      now: new Date('2026-05-19T09:00:00.000Z'),
    }, {
      recordPendingExitIntent: vi.fn(() => deferred),
    });

    expect(decision).toEqual(deferred);
  });

  it('does not apply live emergency policy to Shadow positions', () => {
    expect(resolveR6LiveEmergencyExitPolicy({
      trade: liveTrade({ mode: 'SHADOW' }),
      currentRegime: 'R6_DEFENSE',
      currentPrice: 70000,
      returnPct: -4.2,
    })).toEqual({
      kind: 'NO_EXIT',
      reason: 'NON_LIVE_POSITION_USES_SHADOW_POLICY',
    });
  });

  // 중복주문 방어 회귀 — R6 facade 는 reserveSell/in-flight 가드 미경유라 r6EmergencySold
  // 플래그가 유일 방어선. 이미 청산된 포지션에 LIVE_SELL_INTENT/지연 의도를 다시 만들지 않는다.
  it('blocks a duplicate R6 emergency exit once the position is already sold (idempotency)', () => {
    const recordPendingExitIntent = vi.fn();
    expect(resolveR6LiveEmergencyExitPolicy({
      trade: liveTrade({ r6EmergencySold: true }),
      currentRegime: 'R6_DEFENSE',
      currentPrice: 70000,
      returnPct: -4.2,
      marketSessionState: 'REGULAR',
      isKrxTradingOpen: true,
      kisOrderAllowed: true,
      liveOrderAllowed: true,
    }, { recordPendingExitIntent })).toEqual({
      kind: 'NO_EXIT',
      reason: 'R6_EMERGENCY_ALREADY_SOLD',
    });
    expect(recordPendingExitIntent).not.toHaveBeenCalled();
  });

  it('does not emit an exit intent when no remaining quantity', () => {
    expect(resolveR6LiveEmergencyExitPolicy({
      trade: liveTrade({ quantity: 0 }),
      currentRegime: 'R6_DEFENSE',
      currentPrice: 70000,
      returnPct: -4.2,
      marketSessionState: 'REGULAR',
      isKrxTradingOpen: true,
      kisOrderAllowed: true,
      liveOrderAllowed: true,
    })).toEqual({
      kind: 'NO_EXIT',
      reason: 'NO_REMAINING_QTY',
    });
  });

  it('does not apply the live emergency policy outside R6_DEFENSE regime', () => {
    expect(resolveR6LiveEmergencyExitPolicy({
      trade: liveTrade(),
      currentRegime: 'R3_EARLY',
      currentPrice: 70000,
      returnPct: -4.2,
    })).toEqual({
      kind: 'NO_EXIT',
      reason: 'NOT_R6_DEFENSE',
    });
  });
});
