/**
 * @responsibility marketDayClassifier 7분기 + 영업일 산술 회귀 테스트 (ADR-0037 PR-B)
 */

import { describe, it, expect } from 'vitest';
import {
  getMarketDayContext,
  isTradingDay,
  nextTradingDay,
  prevTradingDay,
} from './marketDayClassifier.js';

describe('isTradingDay — 4분기 기본 분류', () => {
  it('평일 영업일 (2026-04-21 화) → true', () => {
    expect(isTradingDay('2026-04-21')).toBe(true);
  });
  it('토요일 (2026-04-25) → false', () => {
    expect(isTradingDay('2026-04-25')).toBe(false);
  });
  it('일요일 (2026-04-26) → false', () => {
    expect(isTradingDay('2026-04-26')).toBe(false);
  });
  it('평일 KRX 공휴일 (2026-05-05 어린이날) → false', () => {
    expect(isTradingDay('2026-05-05')).toBe(false);
  });
});

describe('nextTradingDay / prevTradingDay — 영업일 산술', () => {
  it('영업일 자기 자신 반환 (next/prev 모두)', () => {
    expect(nextTradingDay('2026-04-21')).toBe('2026-04-21');
    expect(prevTradingDay('2026-04-21')).toBe('2026-04-21');
  });
  it('금요일 → 다음 영업일은 월요일 (주말 건너뜀)', () => {
    // 2026-04-24 금 → 다음 영업일 2026-04-27 월
    expect(nextTradingDay('2026-04-25')).toBe('2026-04-27'); // 토요일에서 시작
    expect(nextTradingDay('2026-04-26')).toBe('2026-04-27'); // 일요일에서 시작
  });
  it('어린이날(5/5 화) → 다음 영업일 5/6 수', () => {
    expect(nextTradingDay('2026-05-05')).toBe('2026-05-06');
    // 직전 영업일 5/4 월 (5/1 근로자의 날 + 5/2-3 주말)
    expect(prevTradingDay('2026-05-05')).toBe('2026-05-04');
  });
  it('5/1 근로자의 날(금) → 직전 영업일 4/30, 다음 영업일 5/4', () => {
    expect(prevTradingDay('2026-05-01')).toBe('2026-04-30');
    expect(nextTradingDay('2026-05-01')).toBe('2026-05-04');
  });
  it('추석 연휴(9/24~9/26) — 다음 영업일 9/28 월', () => {
    // 2026-09-24 목, 9/25 금, 9/26 토(공휴일이지만 주말 자동) → 9/27 일 → 9/28 월
    expect(nextTradingDay('2026-09-24')).toBe('2026-09-28');
    expect(nextTradingDay('2026-09-25')).toBe('2026-09-28');
    expect(nextTradingDay('2026-09-26')).toBe('2026-09-28');
    expect(nextTradingDay('2026-09-27')).toBe('2026-09-28');
  });
});

describe('getMarketDayContext — 7분기 분류', () => {
  it('평일 영업일 → TRADING_DAY', () => {
    const ctx = getMarketDayContext('2026-04-21');
    expect(ctx.type).toBe('TRADING_DAY');
    expect(ctx.isTradingDay).toBe(true);
    expect(ctx.nextTradingDay).toBe('2026-04-21');
    expect(ctx.prevTradingDay).toBe('2026-04-21');
    expect(ctx.isLongHoliday).toBe(false);
  });

  it('일반 토요일 → WEEKEND (직전/다음 영업일 1일 차)', () => {
    const ctx = getMarketDayContext('2026-04-25');
    expect(ctx.type).toBe('WEEKEND');
    expect(ctx.isTradingDay).toBe(false);
    expect(ctx.nextTradingDay).toBe('2026-04-27');
    expect(ctx.prevTradingDay).toBe('2026-04-24');
    expect(ctx.isLongHoliday).toBe(false);
  });

  it('어린이날(5/5 화) → KRX_HOLIDAY (단일 평일 휴장)', () => {
    const ctx = getMarketDayContext('2026-05-05');
    expect(ctx.type).toBe('KRX_HOLIDAY');
    expect(ctx.isTradingDay).toBe(false);
    expect(ctx.nextTradingDay).toBe('2026-05-06');
    expect(ctx.prevTradingDay).toBe('2026-05-04');
    expect(ctx.isLongHoliday).toBe(false);
  });

  it('5/4 월 (5/1 근로자의 날 + 5/2-3 주말 직후) → POST_HOLIDAY', () => {
    // 직전 영업일은 4/30 목 → 4일 간격
    const ctx = getMarketDayContext('2026-05-04');
    expect(ctx.type).toBe('POST_HOLIDAY');
    expect(ctx.isTradingDay).toBe(true);
    expect(ctx.prevTradingDay).toBe('2026-05-04');
  });

  it('4/30 목 (5/1 + 5/2-3 + 5/4 월직전) → PRE_HOLIDAY', () => {
    // 다음 영업일은 5/4 월 → 4일 간격
    const ctx = getMarketDayContext('2026-04-30');
    expect(ctx.type).toBe('PRE_HOLIDAY');
    expect(ctx.isTradingDay).toBe(true);
  });

  it('추석 9/25 금 (9/24~9/27 4일 비영업 클러스터) → LONG_HOLIDAY (start/end 분기)', () => {
    // 9/24 목 KRX 공휴일, 9/25 금 KRX 공휴일, 9/26 토 KRX 공휴일+주말, 9/27 일 주말
    // 직전 영업일 9/23 수, 다음 영업일 9/28 월 → gap = 4일
    const ctx24 = getMarketDayContext('2026-09-24');
    expect(ctx24.isLongHoliday).toBe(true);
    expect(ctx24.type).toBe('LONG_HOLIDAY_START'); // 직전 영업일과 1일 차

    const ctx27 = getMarketDayContext('2026-09-27');
    expect(ctx27.isLongHoliday).toBe(true);
    expect(ctx27.type).toBe('LONG_HOLIDAY_END'); // 다음 영업일과 1일 차

    // 9/28 월 자체는 POST_HOLIDAY (영업일이지만 직전 영업일까지 5일 간격)
    const ctx28 = getMarketDayContext('2026-09-28');
    expect(ctx28.type).toBe('POST_HOLIDAY');
    expect(ctx28.isTradingDay).toBe(true);
  });

  it('LONG_HOLIDAY 중간일 (9/26 토) — 직전/다음 영업일까지 모두 ≥ 2', () => {
    // 9/26 토: 직전 영업일 9/23 수 (3일), 다음 영업일 9/28 월 (2일)
    // 직전 영업일과 더 멀거나 같으므로 LONG_HOLIDAY_END
    const ctx = getMarketDayContext('2026-09-26');
    expect(ctx.isLongHoliday).toBe(true);
    expect(['LONG_HOLIDAY_START', 'LONG_HOLIDAY_END']).toContain(ctx.type);
  });

  it('인자 미지정 시 오늘 KST 사용 — date 필드가 빈 문자열이 아님', () => {
    const ctx = getMarketDayContext();
    expect(ctx.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof ctx.isTradingDay).toBe('boolean');
  });
});
