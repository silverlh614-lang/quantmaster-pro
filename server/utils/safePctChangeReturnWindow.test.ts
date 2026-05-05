import { describe, expect, it } from 'vitest';
import { isStaleBase, safePctChangeDetailed, STALENESS_LIMITS_BY_MODE } from './safePctChange.js';
// ADR-0188 (lint baseline cleanup): `DAILY_STALE_AFTER_DAYS` 정적 export 폐지 후 동적
// 산출 함수 `currentDailyStaleAfterDays` 사용 (calendar-based 가변 값).
// `RECOMMENDATION_RETURN_STALE_AFTER_DAYS` 는 정적 상수 그대로.
import {
  RECOMMENDATION_RETURN_STALE_AFTER_DAYS,
  currentDailyStaleAfterDays,
} from './safePctChangeCalendarPatch.js';

describe('Yahoo/KRX calendar staleness windows — PR-551/553', () => {
  const NOW = new Date('2026-05-04T02:00:00.000Z');

  it('uses patched calendar windows for daily and recommendation returns', () => {
    expect(STALENESS_LIMITS_BY_MODE.DAILY).toBe(currentDailyStaleAfterDays());
    expect(STALENESS_LIMITS_BY_MODE.RECOMMENDATION_RETURN).toBe(RECOMMENDATION_RETURN_STALE_AFTER_DAYS);
    expect(STALENESS_LIMITS_BY_MODE.INTRADAY).toBe(1);
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

  it('allows a 4.1-day DAILY base for weekend/holiday market gaps', () => {
    const base = {
      value: 100,
      asOf: new Date(NOW.getTime() - 4.1 * 24 * 60 * 60 * 1000).toISOString(),
      source: 'YAHOO_HISTORICAL' as const,
    };
    expect(isStaleBase(base, 'DAILY', NOW)).toBe(false);
  });

  it('still marks a 7-day DAILY base as stale', () => {
    const base = {
      value: 100,
      asOf: new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
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
