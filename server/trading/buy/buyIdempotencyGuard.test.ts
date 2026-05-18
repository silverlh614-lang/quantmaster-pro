import { describe, expect, it, vi } from 'vitest';
import {
  buildBuyDedupKey,
  createBuyIdempotencyGuard,
  logBuyDuplicateBlocked,
} from './buyIdempotencyGuard.js';

describe('buyIdempotencyGuard', () => {
  it('builds the required symbol/strategy/session/side key', () => {
    expect(buildBuyDedupKey({
      mode: 'SHADOW',
      symbol: '005930',
      strategy: 'BREAKOUT',
      session: 'REGULAR',
      side: 'BUY',
    })).toBe('buy:SHADOW:005930:BREAKOUT:REGULAR:BUY');
  });

  it('blocks duplicate pending/open reservations', () => {
    const guard = createBuyIdempotencyGuard();
    const first = guard.reserve({
      mode: 'SHADOW',
      symbol: '005930',
      strategy: 'BREAKOUT',
      session: 'REGULAR',
      side: 'BUY',
      tradeId: 't1',
    });
    const second = guard.reserve({
      mode: 'SHADOW',
      symbol: '005930',
      strategy: 'BREAKOUT',
      session: 'REGULAR',
      side: 'BUY',
      tradeId: 't2',
    });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    expect(second.existing?.tradeId).toBe('t1');
  });

  it('logs shadow duplicate blocks as compact non-P0 telemetry', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const guard = createBuyIdempotencyGuard();
    const first = guard.reserve({
      mode: 'SHADOW',
      symbol: '005930',
      strategy: 'BREAKOUT',
      session: 'REGULAR',
      side: 'BUY',
    });

    logBuyDuplicateBlocked(first.record);

    expect(spy).toHaveBeenCalledWith(
      '[SHADOW_DUPLICATE_BLOCKED]',
      expect.stringContaining('buy:SHADOW:005930:BREAKOUT:REGULAR:BUY'),
    );
    spy.mockRestore();
  });
});
