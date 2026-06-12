import { describe, expect, it, vi } from 'vitest';

import { evaluateLiveExit } from './liveExitEngine.js';
import { evaluateShadowExit } from './shadowExitEngine.js';

function trade(mode: 'LIVE' | 'SHADOW', overrides: Record<string, unknown> = {}) {
  return {
    id: `${mode}-1`,
    stockCode: '005930',
    stockName: 'Samsung',
    quantity: 100,
    mode,
    ...overrides,
  } as any;
}

describe('split exit engines', () => {
  it('LiveExitEngine submits a live sell only after R6 live policy returns an in-session intent', async () => {
    const submit = vi.fn(async () => ({ ordNo: 'ORD-1', placed: true, outcome: 'LIVE_ORDERED' as const }));

    await expect(evaluateLiveExit({
      trade: trade('LIVE'),
      currentRegime: 'R6_DEFENSE',
      currentPrice: 70000,
      returnPct: -3,
      marketSessionState: 'REGULAR',
      isKrxTradingOpen: true,
      kisOrderAllowed: true,
      liveOrderAllowed: true,
    }, {
      placeKisSellOrder: submit,
    })).resolves.toEqual({
      kind: 'LIVE_SELL_SUBMITTED',
      reason: 'R6_LIVE_EMERGENCY_EXIT',
      qty: 30,
      ordNo: 'ORD-1',
    });
    expect(submit).toHaveBeenCalledWith('005930', 'Samsung', 30, 'STOP_LOSS');
  });

  it('LiveExitEngine does not submit a sell order outside regular trading', async () => {
    const submit = vi.fn();
    const result = await evaluateLiveExit({
      trade: trade('LIVE'),
      currentRegime: 'R6_DEFENSE',
      currentPrice: 70000,
      returnPct: -3,
      marketSessionState: 'AFTER_HOURS',
      isKrxTradingOpen: false,
      kisOrderAllowed: false,
      liveOrderAllowed: true,
    }, {
      placeKisSellOrder: submit,
      resolveR6LiveEmergencyExitPolicy: () => ({
        kind: 'LIVE_SELL_DEFERRED',
        reason: 'SESSION_GUARDED_R6_EMERGENCY_EXIT',
        pendingIntentId: 'pending-1',
      }),
    });

    expect(result.kind).toBe('LIVE_SELL_DEFERRED');
    expect(submit).not.toHaveBeenCalled();
  });

  it('ShadowExitEngine holds Shadow positions in R6 with executionImpact NONE', () => {
    expect(evaluateShadowExit({
      trade: trade('SHADOW'),
      currentRegime: 'R6_DEFENSE',
    })).toMatchObject({
      kind: 'SHADOW_HOLD_R6_DEFENSE',
      executionImpact: 'NONE',
    });
  });

  // 중복주문 방어 회귀 (facade) — 이미 R6 긴급청산된 포지션은 정규장 중에도 재주문하지 않는다.
  // r6EmergencySold=true → policy NO_EXIT → placeKisSellOrder 호출 0회 (KIS 실주문 중복 차단).
  it('LiveExitEngine does not resubmit a sell for an already-sold R6 position (no duplicate order)', async () => {
    const submit = vi.fn(async () => ({ ordNo: 'ORD-DUP', placed: true, outcome: 'LIVE_ORDERED' as const }));
    const result = await evaluateLiveExit({
      trade: trade('LIVE', { r6EmergencySold: true }),
      currentRegime: 'R6_DEFENSE',
      currentPrice: 70000,
      returnPct: -3,
      marketSessionState: 'REGULAR',
      isKrxTradingOpen: true,
      kisOrderAllowed: true,
      liveOrderAllowed: true,
    }, {
      placeKisSellOrder: submit,
    });

    expect(result).toEqual({ kind: 'NO_EXIT', reason: 'R6_EMERGENCY_ALREADY_SOLD' });
    expect(submit).not.toHaveBeenCalled();
  });
});
