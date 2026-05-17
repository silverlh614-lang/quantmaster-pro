import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isStaleBase, safePctChangeDetailed, STALENESS_LIMITS_BY_MODE } from './safePctChange.js';
// ADR-0188 (lint baseline cleanup): `DAILY_STALE_AFTER_DAYS` 정적 export 폐지 후 동적
// 산출 함수 `currentDailyStaleAfterDays` 사용 (calendar-based 가변 값).
// `RECOMMENDATION_RETURN_STALE_AFTER_DAYS` 는 정적 상수 그대로.
import {
  RECOMMENDATION_RETURN_STALE_AFTER_DAYS,
  currentDailyStaleAfterDays,
  installYahooTradingCalendarWindows,
} from './safePctChangeCalendarPatch.js';

describe('Yahoo/KRX calendar staleness windows — PR-551/553', () => {
  const NOW = new Date('2026-05-04T02:00:00.000Z');

  // ADR-0188 (잔여 시간 의존 결함 정리): module-load 시점에 박제된 STALENESS_LIMITS_BY_MODE.DAILY
  // 가 현재 시간 기반 calendar window 라 test fixture NOW (2026-05-04) 와 어긋남. KRX 5/1~5/5
  // 연휴 기간에 module-load 시점이 5/5 이면 limit=3, NOW=5/4 이면 limit=6 → 4.1-day base 가
  // module-박제 limit 로 stale 판정. test isolation — beforeEach 에서 NOW 기반 재박제 후
  // afterEach 에서 module-load 시점 값 복원.
  //
  // Patch-VITEST-CAT-E-BASELINE-001 (Cat E test isolation): `safePctChangeDetailed` 가
  // 내부에서 `isStaleBase(base, opts.mode)` 호출 시 `now` 파라미터 미주입 (default `new Date()`)
  // → 호출 시점 real time 사용. test fixture NOW (2026-05-04) 와 real time (배포 시각)
  // 차이로 RECOMMENDATION_RETURN 31.1-day base 가 real-time 기준 stale 판정. fake timers
  // 로 Date.now() 자체를 NOW 로 박제 → 런타임 정책 무수정 + test 격리.
  let originalDaily: number;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    originalDaily = STALENESS_LIMITS_BY_MODE.DAILY;
    installYahooTradingCalendarWindows(NOW);
  });
  afterEach(() => {
    STALENESS_LIMITS_BY_MODE.DAILY = originalDaily;
    vi.useRealTimers();
  });

  it('uses patched calendar windows for daily and recommendation returns', () => {
    expect(STALENESS_LIMITS_BY_MODE.DAILY).toBe(currentDailyStaleAfterDays(NOW));
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
