import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveR6ShadowHoldPolicy } from './r6ShadowHoldPolicy.js';

function shadowTrade(overrides: Record<string, unknown> = {}) {
  return {
    id: 'shadow-1',
    stockCode: '005930',
    stockName: 'Samsung',
    quantity: 10,
    mode: 'SHADOW',
    ...overrides,
  } as any;
}

describe('r6ShadowHoldPolicy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks R6 Shadow force exit and keeps learning markers', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const trade = shadowTrade();

    expect(resolveR6ShadowHoldPolicy({
      trade,
      currentRegime: 'R6_DEFENSE',
    })).toEqual({
      kind: 'SHADOW_HOLD_R6_DEFENSE',
      reason: 'SHADOW_EXCLUDED_FROM_R6_FORCED_EXIT',
      executionImpact: 'NONE',
    });
    expect(trade).toMatchObject({
      shadowDecision: 'HOLD_R6_DEFENSE',
      postOutcome: 'R6_SHADOW_HOLD',
      learningTag: 'R6_SHADOW_HOLD',
      liveOrderSent: false,
      executionImpact: 'NONE',
    });
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('[P2][P2_R6_SHADOW_FORCE_EXIT_EXCLUDED]'),
      expect.objectContaining({ code: 'P2_R6_SHADOW_FORCE_EXIT_EXCLUDED' }),
    );
  });

  it('does not handle live positions', () => {
    expect(resolveR6ShadowHoldPolicy({
      trade: shadowTrade({ mode: 'LIVE' }),
      currentRegime: 'R6_DEFENSE',
    })).toEqual({
      kind: 'NO_EXIT',
      reason: 'LIVE_POSITION_USES_R6_LIVE_POLICY',
    });
  });
});
