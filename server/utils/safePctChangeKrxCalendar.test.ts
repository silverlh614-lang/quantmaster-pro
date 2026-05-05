/**
 * @responsibility ADR-0190 회귀 — safePctChange.isStaleBase 의 KRX 거래일 분기 검증
 *
 * 5/6 시점 4/30 base @ YAHOO_HISTORICAL DAILY 시나리오 — KRX 5/1 (근로자의 날) +
 * 5/5 (어린이날) 휴장일 클러스터로 calendar 6일 vs KRX 거래일 2일 갭. 본 PR 이전엔
 * STALENESS_LIMITS_BY_MODE.DAILY (calendar 일 박제) 를 calendar 일 비교로 차단했지만
 * KRX 거래일 grace 정책 사용 시 정상 통과.
 *
 * ENV `SAFE_PCT_CHANGE_KRX_CALENDAR_DISABLED=true` 우회 — ADR-0190 이전 동작 복원.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isStaleBase, isSafePctChangeKrxCalendarDisabled } from './safePctChange.js';

describe('isSafePctChangeKrxCalendarDisabled — ENV gate (ADR-0190)', () => {
  const ORIGINAL = process.env.SAFE_PCT_CHANGE_KRX_CALENDAR_DISABLED;

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.SAFE_PCT_CHANGE_KRX_CALENDAR_DISABLED;
    } else {
      process.env.SAFE_PCT_CHANGE_KRX_CALENDAR_DISABLED = ORIGINAL;
    }
  });

  it('default OFF — ENV 미설정 시 false (정책 적용)', () => {
    delete process.env.SAFE_PCT_CHANGE_KRX_CALENDAR_DISABLED;
    expect(isSafePctChangeKrxCalendarDisabled()).toBe(false);
  });

  it('"true" 정확 비교 시에만 비활성', () => {
    process.env.SAFE_PCT_CHANGE_KRX_CALENDAR_DISABLED = 'true';
    expect(isSafePctChangeKrxCalendarDisabled()).toBe(true);
  });

  it('"1"·"TRUE"·"yes" 거부 (ADR-0157 정확 비교 의무)', () => {
    process.env.SAFE_PCT_CHANGE_KRX_CALENDAR_DISABLED = '1';
    expect(isSafePctChangeKrxCalendarDisabled()).toBe(false);
    process.env.SAFE_PCT_CHANGE_KRX_CALENDAR_DISABLED = 'TRUE';
    expect(isSafePctChangeKrxCalendarDisabled()).toBe(false);
    process.env.SAFE_PCT_CHANGE_KRX_CALENDAR_DISABLED = 'yes';
    expect(isSafePctChangeKrxCalendarDisabled()).toBe(false);
  });

  it('"false" / 빈 문자열 → false', () => {
    process.env.SAFE_PCT_CHANGE_KRX_CALENDAR_DISABLED = 'false';
    expect(isSafePctChangeKrxCalendarDisabled()).toBe(false);
    process.env.SAFE_PCT_CHANGE_KRX_CALENDAR_DISABLED = '';
    expect(isSafePctChangeKrxCalendarDisabled()).toBe(false);
  });
});

describe('isStaleBase mode=DAILY KRX 거래일 분기 (ADR-0190 사용자 보고 시나리오)', () => {
  const ORIGINAL_ENV = process.env.SAFE_PCT_CHANGE_KRX_CALENDAR_DISABLED;

  beforeEach(() => {
    delete process.env.SAFE_PCT_CHANGE_KRX_CALENDAR_DISABLED;
  });
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.SAFE_PCT_CHANGE_KRX_CALENDAR_DISABLED;
    } else {
      process.env.SAFE_PCT_CHANGE_KRX_CALENDAR_DISABLED = ORIGINAL_ENV;
    }
  });

  // 사용자 보고 5/6 KST 08:35 — 4/30 base 가 STALE_BASE_AGE 로 25+ 종목 차단됐던 시점.
  // KRX 5/1 (근로자의 날) + 주말 + 5/5 (어린이날) 휴장일 클러스터.
  const NOW_5_6 = new Date('2026-05-06T03:00:00.000Z'); // 12:00 KST
  const BASE_4_30 = '2026-04-30T06:30:00.000Z'; // KST 4/30 15:30 — toKstDateKey='2026-04-30'

  it('5/6 시점 4/30 base @ YAHOO_HISTORICAL DAILY → not stale (KRX grace 통과)', () => {
    const base = {
      value: 100,
      asOf: BASE_4_30,
      source: 'YAHOO_HISTORICAL' as const,
    };
    expect(isStaleBase(base, 'DAILY', NOW_5_6)).toBe(false);
  });

  it('5/6 시점 4/30 base @ KIS_DAILY DAILY → not stale (KRX grace 통과)', () => {
    const base = {
      value: 100,
      asOf: BASE_4_30,
      source: 'KIS_DAILY' as const,
    };
    expect(isStaleBase(base, 'DAILY', NOW_5_6)).toBe(false);
  });

  it('5/6 시점 4/30 base @ KRX_OPENAPI DAILY → not stale (KRX grace 통과)', () => {
    const base = {
      value: 100,
      asOf: BASE_4_30,
      source: 'KRX_OPENAPI' as const,
    };
    expect(isStaleBase(base, 'DAILY', NOW_5_6)).toBe(false);
  });

  it('5/6 시점 4/30 base @ NAVER_FINANCE DAILY → not stale (KRX grace 통과)', () => {
    const base = {
      value: 100,
      asOf: BASE_4_30,
      source: 'NAVER_FINANCE' as const,
    };
    expect(isStaleBase(base, 'DAILY', NOW_5_6)).toBe(false);
  });

  it('5/6 시점 4/29 base → stale (4/30 이 가장 직전 거래일이라 더 오래된 base 차단)', () => {
    const base = {
      value: 100,
      asOf: '2026-04-29T06:30:00.000Z', // KST 4/29 15:30 — toKstDateKey='2026-04-29'
      source: 'YAHOO_HISTORICAL' as const,
    };
    expect(isStaleBase(base, 'DAILY', NOW_5_6)).toBe(true);
  });

  it('ENV 우회 시 5/6 시점 4/30 base → stale (legacy calendar 6일 > limit)', () => {
    process.env.SAFE_PCT_CHANGE_KRX_CALENDAR_DISABLED = 'true';
    const base = {
      value: 100,
      asOf: BASE_4_30,
      source: 'YAHOO_HISTORICAL' as const,
    };
    // STALENESS_LIMITS_BY_MODE.DAILY 가 calendar window patch 로 박제됐을 수 있음 (3~8).
    // ENV ON 시 KRX 거래일 분기 미적용 — calendar 일수 비교만 수행.
    // calendar 6일 > min 3 → 항상 stale (limit 정확 값과 무관하게 결정적).
    expect(isStaleBase(base, 'DAILY', NOW_5_6)).toBe(true);
  });
});

describe('isStaleBase 분기 우선순위 (ADR-0190)', () => {
  const NOW_5_6 = new Date('2026-05-06T03:00:00.000Z');
  const BASE_4_30 = '2026-04-30T15:30:00.000Z';

  beforeEach(() => {
    delete process.env.SAFE_PCT_CHANGE_KRX_CALENDAR_DISABLED;
  });

  it('base.staleAfterDays override 우선 — KRX 분기 미적용', () => {
    const base = {
      value: 100,
      asOf: BASE_4_30,
      source: 'YAHOO_HISTORICAL' as const,
      staleAfterDays: 1, // 명시적 override
    };
    // override=1 → 6일 > 1 → stale (KRX 분기가 grace 통과시켰을 거지만 override 가 우선)
    expect(isStaleBase(base, 'DAILY', NOW_5_6)).toBe(true);
  });

  it('mode=RECOMMENDATION_RETURN → KRX 분기 미적용 (DAILY 만 적용)', () => {
    const base = {
      value: 100,
      asOf: BASE_4_30,
      source: 'YAHOO_HISTORICAL' as const,
    };
    // RECOMMENDATION_RETURN limit=30 (또는 calendar patch 45) 이라 6일 < limit → not stale
    expect(isStaleBase(base, 'RECOMMENDATION_RETURN', NOW_5_6)).toBe(false);
  });

  it('source=UNKNOWN → KRX 분기 미적용 (KR 일봉 출처 만 적용)', () => {
    const base = {
      value: 100,
      asOf: BASE_4_30,
      source: 'UNKNOWN' as const,
    };
    // UNKNOWN 은 KRX_DAILY_PRICE_SOURCES 미포함 → calendar limit 비교
    // STALENESS_LIMITS_BY_MODE.DAILY (calendar patch 박제) 와 6일 비교 — 결정적 stale
    expect(isStaleBase(base, 'DAILY', NOW_5_6)).toBe(true);
  });

  it('source=YAHOO_INTRADAY → KRX 분기 미적용 (HISTORICAL 만 적용)', () => {
    const base = {
      value: 100,
      asOf: BASE_4_30,
      source: 'YAHOO_INTRADAY' as const,
    };
    expect(isStaleBase(base, 'DAILY', NOW_5_6)).toBe(true);
  });

  it('mode 미명시 → KRX 분기 미적용 (DAILY 명시 만 적용, SANITY_ONLY default 7일)', () => {
    const base = {
      value: 100,
      asOf: BASE_4_30,
      source: 'YAHOO_HISTORICAL' as const,
    };
    // mode 미명시 → SANITY_ONLY=7일 → 6일 < 7 → not stale
    expect(isStaleBase(base, undefined, NOW_5_6)).toBe(false);
  });

  it('잘못된 ISO asOf → 보수적 stale 처리', () => {
    const base = {
      value: 100,
      asOf: 'not-a-date',
      source: 'YAHOO_HISTORICAL' as const,
    };
    expect(isStaleBase(base, 'DAILY', NOW_5_6)).toBe(true);
  });

  it('미래 시점 asOf → not stale (시계 어긋남 통과)', () => {
    const base = {
      value: 100,
      asOf: '2026-05-10T06:30:00.000Z',
      source: 'YAHOO_HISTORICAL' as const,
    };
    expect(isStaleBase(base, 'DAILY', NOW_5_6)).toBe(false);
  });
});

describe('isStaleBase 다양한 휴장일 시나리오 (ADR-0190)', () => {
  beforeEach(() => {
    delete process.env.SAFE_PCT_CHANGE_KRX_CALENDAR_DISABLED;
  });

  it('5/4 시점 4/30 base — 4/30 = previousKrxTradingDay → not stale', () => {
    const NOW = new Date('2026-05-04T03:00:00.000Z');
    const base = {
      value: 100,
      asOf: '2026-04-30T06:30:00.000Z', // KST 4/30 15:30 — toKstDateKey='2026-04-30'
      source: 'YAHOO_HISTORICAL' as const,
    };
    expect(isStaleBase(base, 'DAILY', NOW)).toBe(false);
  });

  it('5/4 시점 4/29 base — grace 1 거래일 lookback 통과 → not stale', () => {
    // KRX 정책: previousKrxTradingDay(5/4)=4/30, grace iter 첫 TD=4/29 → '4/29'>='4/29'=true
    const NOW = new Date('2026-05-04T03:00:00.000Z');
    const base = {
      value: 100,
      asOf: '2026-04-29T06:30:00.000Z', // KST 4/29 15:30 — toKstDateKey='2026-04-29'
      source: 'YAHOO_HISTORICAL' as const,
    };
    expect(isStaleBase(base, 'DAILY', NOW)).toBe(false);
  });

  it('5/4 시점 4/28 base — grace 한도 초과 → stale', () => {
    const NOW = new Date('2026-05-04T03:00:00.000Z');
    const base = {
      value: 100,
      asOf: '2026-04-28T06:30:00.000Z', // KST 4/28 15:30 — toKstDateKey='2026-04-28'
      source: 'YAHOO_HISTORICAL' as const,
    };
    expect(isStaleBase(base, 'DAILY', NOW)).toBe(true);
  });

  it('월요일 (5/4) 시점 금요일 (5/1 휴장 → 4/30) base → not stale (휴장일 skip)', () => {
    const NOW = new Date('2026-05-04T03:00:00.000Z');
    const base = {
      value: 100,
      asOf: '2026-04-30T06:30:00.000Z', // KST 4/30 15:30 — toKstDateKey='2026-04-30'
      source: 'YAHOO_HISTORICAL' as const,
    };
    expect(isStaleBase(base, 'DAILY', NOW)).toBe(false);
  });

  it('일반 주말 시나리오 — 월요일 시점 직전 금요일 base 통과 (KRX grace)', () => {
    // 1/12 월요일 시점, 1/9 금요일 base
    const NOW = new Date('2026-01-12T03:00:00.000Z');
    const base = {
      value: 100,
      asOf: '2026-01-09T06:30:00.000Z',
      source: 'YAHOO_HISTORICAL' as const,
    };
    expect(isStaleBase(base, 'DAILY', NOW)).toBe(false);
  });

  it('1주 이상 stale base → KRX 분기에서도 차단', () => {
    const NOW = new Date('2026-05-06T03:00:00.000Z');
    const base = {
      value: 100,
      asOf: '2026-04-22T06:30:00.000Z', // KST 4/22 15:30 — toKstDateKey='2026-04-22'
      source: 'YAHOO_HISTORICAL' as const,
    };
    expect(isStaleBase(base, 'DAILY', NOW)).toBe(true);
  });
});
