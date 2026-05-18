import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  __resetSellReissuePolicyForTests,
  buildSellReissueDedupKey,
  decideSellReissue,
  reserveSellReissue,
} from './sellReissuePolicy.js';

describe('sellReissuePolicy', () => {
  beforeEach(() => {
    __resetSellReissuePolicyForTests();
  });

  it('builds the required sell reissue dedup key', () => {
    expect(buildSellReissueDedupKey({
      mode: 'LIVE',
      symbol: '005930',
      originalOrdNo: 'OD-1',
      reason: 'UNFILLED_MAX_POLL',
    })).toBe('sell-reissue:LIVE:005930:OD-1:UNFILLED_MAX_POLL');
  });

  it('allows only one reissue for the same symbol/order/reason', () => {
    const first = reserveSellReissue({
      mode: 'LIVE',
      symbol: '005930',
      originalOrdNo: 'OD-1',
      reason: 'UNFILLED_MAX_POLL',
    });
    const second = reserveSellReissue({
      mode: 'LIVE',
      symbol: '005930',
      originalOrdNo: 'OD-1',
      reason: 'UNFILLED_MAX_POLL',
    });

    expect(first.kind).toBe('ALLOW_REISSUE');
    expect(second).toMatchObject({
      kind: 'DUPLICATE_BLOCKED',
      executionImpact: 'LIVE_SELL_BLOCKED',
    });
  });

  it('does not reissue outside trading session', () => {
    const decision = decideSellReissue({
      mode: 'LIVE',
      symbol: '005930',
      originalOrdNo: 'OD-1',
      reason: 'UNFILLED_MAX_POLL',
      marketOpen: false,
      liveSellAllowed: true,
      remainingQty: 10,
    });

    expect(decision).toMatchObject({
      kind: 'DEFERRED_MONITOR',
      executionImpact: 'EXIT_MONITOR_DEGRADED',
    });
  });

  it('emits duplicate P0 through the warn wrapper path', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reserveSellReissue({ mode: 'LIVE', symbol: '005930', originalOrdNo: 'OD-1', reason: 'R' });
    reserveSellReissue({ mode: 'LIVE', symbol: '005930', originalOrdNo: 'OD-1', reason: 'R' });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[P0][EXECUTION][P0_SELL_REISSUE_DUPLICATE_BLOCKED]'),
      expect.objectContaining({
        code: 'P0_SELL_REISSUE_DUPLICATE_BLOCKED',
        executionImpact: 'LIVE_SELL_BLOCKED',
      }),
    );
    warnSpy.mockRestore();
  });
});
