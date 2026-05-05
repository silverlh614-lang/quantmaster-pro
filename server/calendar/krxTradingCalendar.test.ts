import { describe, expect, it } from 'vitest';
import {
  isAcceptableKrxDailyBase,
  isKrxTradingDay,
  previousKrxTradingDay,
  recommendedDailyStaleWindowDays,
} from './krxTradingCalendar';

describe('krxTradingCalendar', () => {
  it('skips weekend and configured KRX holidays', () => {
    expect(isKrxTradingDay('2026-05-04')).toBe(true);
    expect(isKrxTradingDay('2026-05-01')).toBe(false);
    expect(isKrxTradingDay('2026-05-05')).toBe(false);
    expect(isKrxTradingDay('2026-05-02')).toBe(false);
  });

  it('resolves previous KRX trading day across weekend/holiday gap', () => {
    const now = new Date('2026-05-04T02:00:00.000Z');
    expect(previousKrxTradingDay(now)).toBe('2026-04-30');
  });

  it('accepts recent daily base but rejects deeper stale base', () => {
    const now = new Date('2026-05-04T02:00:00.000Z');
    expect(isAcceptableKrxDailyBase('2026-05-01T06:30:00.000Z', now)).toBe(true);
    expect(isAcceptableKrxDailyBase('2026-04-30T06:30:00.000Z', now)).toBe(true);
    expect(isAcceptableKrxDailyBase('2026-04-24T06:30:00.000Z', now)).toBe(false);
  });

  it('derives a bounded calendar stale window from expected previous trading day', () => {
    const now = new Date('2026-05-04T02:00:00.000Z');
    expect(recommendedDailyStaleWindowDays(now)).toBeGreaterThanOrEqual(3);
    expect(recommendedDailyStaleWindowDays(now)).toBeLessThanOrEqual(8);
  });
});
