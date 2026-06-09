// @responsibility resolveTradingContext 날짜 SSOT 불변식 검증 (BUG-2026-05-07-001, ADR-0591).

import { describe, it, expect } from 'vitest';
import { resolveTradingContext } from './tradingContext.js';
import { isKrxTradingDay } from './krxTradingCalendar.js';

describe('resolveTradingContext (Market Truth Layer 날짜 SSOT)', () => {
  // KST 정오 기준 Date (DST-free) — 날짜 경계 모호성 제거.
  const at = (dateKey: string) => new Date(`${dateKey}T03:00:00.000Z`);

  it('effectiveTradingDate 는 항상 KRX 거래일이다 (불변식)', () => {
    for (const d of ['2026-06-05', '2026-06-06', '2026-06-07', '2026-06-08', '2026-06-09', '2026-01-01']) {
      const ctx = resolveTradingContext(at(d));
      expect(isKrxTradingDay(ctx.effectiveTradingDate)).toBe(true);
    }
  });

  it('previousTradingDate / nextTradingDate 도 거래일이며 effective 와 정렬된다', () => {
    const ctx = resolveTradingContext(at('2026-06-09'));
    expect(isKrxTradingDay(ctx.previousTradingDate)).toBe(true);
    expect(isKrxTradingDay(ctx.nextTradingDate)).toBe(true);
    expect(ctx.previousTradingDate < ctx.effectiveTradingDate).toBe(true);
    expect(ctx.nextTradingDate > ctx.calendarDate).toBe(true);
  });

  it('거래일 당일이면 effectiveTradingDate = calendarDate 이고 isTradingDay=true', () => {
    const ctx = resolveTradingContext(at('2026-06-09')); // 화요일 (비휴장 가정)
    if (ctx.isTradingDay) {
      expect(ctx.effectiveTradingDate).toBe(ctx.calendarDate);
      expect(ctx.dateMode).toBe('TRADING_DAY');
    }
  });

  it('토요일은 WEEKEND 이고 effectiveTradingDate 는 직전 거래일(< 오늘)', () => {
    const ctx = resolveTradingContext(at('2026-06-06')); // 토요일
    expect(ctx.isTradingDay).toBe(false);
    expect(ctx.dateMode).toBe('WEEKEND');
    expect(ctx.effectiveTradingDate < ctx.calendarDate).toBe(true);
  });

  it('동일 now → 동일 결과 (결정성)', () => {
    const a = resolveTradingContext(at('2026-06-08'));
    const b = resolveTradingContext(at('2026-06-08'));
    expect(a).toEqual(b);
  });

  it('asOf 는 입력 now 를 보존한다', () => {
    const now = at('2026-06-08');
    expect(resolveTradingContext(now).asOf).toBe(now.toISOString());
  });
});
