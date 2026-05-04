import { describe, expect, it } from 'vitest';
import { isStaleBase, safePctChangeDetailed, STALENESS_LIMITS_BY_MODE } from './safePctChange.js';

describe('RECOMMENDATION_RETURN calendar staleness — PR-551', () => {
  const NOW = new Date('2026-05-04T02:00:00.000Z');

  it('uses 45 calendar days for recommendation return windows', () => {
    expect(STALENESS_LIMITS_BY_MODE.RECOMMENDATION_RETURN).toBe(45);
  });

  it('does not mark a 31.1-day 20-trading-day base as stale', () => {
    const base = {
      value: 100,
      asOf: new Date(NOW.getTime() - 31.1 * 24 * 60 * 60 * 1000).toISOString(),
      source: 'YAHOO_HISTORICAL' as const,
    };
    expect(isStaleBase(base, 'RECOMMENDATION_RETURN', NOW)).toBe(false);
    expect(safePctChangeDetailed(110, base, {
      mode: 'RECOMMENDATION_RETURN',
      silent: true,
    })).toMatchObject({ valid: true, reason: 'OK' });
  });

  it('still marks a 46-day recommendation return base as stale', () => {
    const base = {
      value: 100,
      asOf: new Date(NOW.getTime() - 46 * 24 * 60 * 60 * 1000).toISOString(),
      source: 'YAHOO_HISTORICAL' as const,
    };
    expect(isStaleBase(base, 'RECOMMENDATION_RETURN', NOW)).toBe(true);
  });

  it('keeps DAILY stale strict at 3 days', () => {
    const base = {
      value: 100,
      asOf: new Date(NOW.getTime() - 4.1 * 24 * 60 * 60 * 1000).toISOString(),
      source: 'YAHOO_HISTORICAL' as const,
    };
    expect(isStaleBase(base, 'DAILY', NOW)).toBe(true);
  });

  it('keeps INTRADAY stale strict at 1 day', () => {
    const base = {
      value: 100,
      asOf: new Date(NOW.getTime() - 1.1 * 24 * 60 * 60 * 1000).toISOString(),
      source: 'YAHOO_HISTORICAL' as const,
    };
    expect(isStaleBase(base, 'INTRADAY', NOW)).toBe(true);
  });
});
