/**
 * @responsibility holidayResumePolicy 회귀 테스트 (ADR-0044 PR-C)
 */

import { describe, it, expect } from 'vitest';
import {
  resolveHolidayResumePolicyForContext,
  applyKellyMultiplierWithHolidayPolicy,
  applyGateBoostWithHolidayPolicy,
  isWithinMarketOpenDelay,
  getDefaultHolidayResumePolicy,
  type HolidayResumePolicy,
} from './holidayResumePolicy.js';
import { getMarketDayContext } from '../utils/marketDayClassifier.js';

describe('getDefaultHolidayResumePolicy — env 기반 기본값', () => {
  it('기본값: kelly 0.5x / gate +1 / openDelay 30분 / 만료 12:00', () => {
    const p = getDefaultHolidayResumePolicy();
    expect(p.kellyMultiplier).toBe(0.5);
    expect(p.gateScoreBoost).toBe(1);
    expect(p.marketOpenDelayMin).toBe(30);
    expect(p.expirationKstTime).toBe('12:00');
  });
});

describe('resolveHolidayResumePolicyForContext — 활성 조건', () => {
  it('TRADING_DAY → null (활성 조건 미충족)', () => {
    const ctx = getMarketDayContext('2026-04-21'); // 화요일 영업일
    const policy = resolveHolidayResumePolicyForContext(ctx, new Date(Date.UTC(2026, 3, 21, 0, 0, 0)));
    expect(policy).toBeNull();
  });

  it('단순 POST_HOLIDAY (단일 1일 휴장 직후, isLongHoliday=false) → null', () => {
    // 5/6 수요일 — 어린이날(5/5 화) 단일 휴장 직후. POST_HOLIDAY 이지만 isLongHoliday=false (간격 1일).
    const ctx = getMarketDayContext('2026-05-06');
    expect(ctx.type).toBe('POST_HOLIDAY');
    expect(ctx.isLongHoliday).toBe(false);
    const policy = resolveHolidayResumePolicyForContext(ctx, new Date(Date.UTC(2026, 4, 6, 0, 0, 0)));
    expect(policy).toBeNull();
  });

  it('POST_HOLIDAY + isLongHoliday=true (5/4 월) + 09:00 KST → 활성 정책 반환', () => {
    // 5/4 월 — 5/1 근로자의 날 + 5/2-3 주말 직후. 비영업 클러스터 3일 → isLongHoliday=true.
    const ctx = getMarketDayContext('2026-05-04');
    expect(ctx.type).toBe('POST_HOLIDAY');
    expect(ctx.isLongHoliday).toBe(true);
    // 5/4 09:00 KST = 5/4 00:00 UTC
    const now = new Date(Date.UTC(2026, 4, 4, 0, 0, 0));
    const policy = resolveHolidayResumePolicyForContext(ctx, now);
    expect(policy).not.toBeNull();
    expect(policy?.id).toBe('long-holiday-resume-default');
    expect(policy?.kellyMultiplier).toBe(0.5);
    expect(policy?.gateScoreBoost).toBe(1);
  });

  it('추석 직후 9/28 월 + 09:00 KST → 활성 정책 (LONG_HOLIDAY 4일 이후)', () => {
    // 9/24~9/27 4일 비영업 클러스터(목/금 KRX 휴장 + 토/일) → 9/28 월 POST_HOLIDAY+isLongHoliday=true
    const ctx = getMarketDayContext('2026-09-28');
    expect(ctx.type).toBe('POST_HOLIDAY');
    expect(ctx.isLongHoliday).toBe(true);
    const now = new Date(Date.UTC(2026, 8, 28, 0, 0, 0));
    const policy = resolveHolidayResumePolicyForContext(ctx, now);
    expect(policy).not.toBeNull();
  });

  it('POST_HOLIDAY + isLongHoliday=true + 12:01 KST → null (만료 후)', () => {
    const ctx = getMarketDayContext('2026-05-04');
    // 5/4 12:01 KST = 5/4 03:01 UTC
    const now = new Date(Date.UTC(2026, 4, 4, 3, 1, 0));
    const policy = resolveHolidayResumePolicyForContext(ctx, now);
    expect(policy).toBeNull();
  });

  it('POST_HOLIDAY + isLongHoliday=true + 11:59 KST → 활성 (만료 직전)', () => {
    const ctx = getMarketDayContext('2026-05-04');
    const now = new Date(Date.UTC(2026, 4, 4, 2, 59, 0));
    const policy = resolveHolidayResumePolicyForContext(ctx, now);
    expect(policy).not.toBeNull();
  });

  it('WEEKEND → null (영업일 아님)', () => {
    const ctx = getMarketDayContext('2026-04-25'); // 토요일
    const policy = resolveHolidayResumePolicyForContext(ctx, new Date(Date.UTC(2026, 3, 25, 0, 0, 0)));
    expect(policy).toBeNull();
  });

  it('LONG_HOLIDAY_END (비영업일) → null (영업일이 아니라 매매 안 함)', () => {
    const ctx = getMarketDayContext('2026-09-27'); // 추석 일요일
    expect(ctx.type).toBe('LONG_HOLIDAY_END');
    const policy = resolveHolidayResumePolicyForContext(ctx, new Date(Date.UTC(2026, 8, 27, 0, 0, 0)));
    expect(policy).toBeNull();
  });
});

describe('applyKellyMultiplierWithHolidayPolicy', () => {
  it('정책 null → 입력 그대로', () => {
    expect(applyKellyMultiplierWithHolidayPolicy(0.8, null)).toBe(0.8);
  });

  it('정책 0.5 → 50% 축소', () => {
    const policy: HolidayResumePolicy = { ...getDefaultHolidayResumePolicy(), kellyMultiplier: 0.5 };
    expect(applyKellyMultiplierWithHolidayPolicy(0.8, policy)).toBeCloseTo(0.4);
  });

  it('음수 입력 → 0 안전 fallback', () => {
    const policy = getDefaultHolidayResumePolicy();
    expect(applyKellyMultiplierWithHolidayPolicy(-0.1, policy)).toBe(0);
  });

  it('NaN 입력 → 0', () => {
    const policy = getDefaultHolidayResumePolicy();
    expect(applyKellyMultiplierWithHolidayPolicy(NaN, policy)).toBe(0);
  });
});

describe('applyGateBoostWithHolidayPolicy', () => {
  it('정책 null → 입력 그대로', () => {
    expect(applyGateBoostWithHolidayPolicy(5, null)).toBe(5);
  });

  it('정책 +1 → 6', () => {
    expect(applyGateBoostWithHolidayPolicy(5, getDefaultHolidayResumePolicy())).toBe(6);
  });

  it('정책 +2 → 7', () => {
    const policy: HolidayResumePolicy = { ...getDefaultHolidayResumePolicy(), gateScoreBoost: 2 };
    expect(applyGateBoostWithHolidayPolicy(5, policy)).toBe(7);
  });
});

describe('isWithinMarketOpenDelay — 시초 진입 차단 윈도우', () => {
  const policy = getDefaultHolidayResumePolicy(); // marketOpenDelayMin=30

  it('정책 null → false', () => {
    // 09:15 KST = 00:15 UTC
    expect(isWithinMarketOpenDelay(new Date(Date.UTC(2026, 4, 4, 0, 15, 0)), null)).toBe(false);
  });

  it('marketOpenDelayMin=0 → false (정책 있어도 차단 안 함)', () => {
    const noDelay: HolidayResumePolicy = { ...policy, marketOpenDelayMin: 0 };
    expect(isWithinMarketOpenDelay(new Date(Date.UTC(2026, 4, 4, 0, 15, 0)), noDelay)).toBe(false);
  });

  it('09:00 KST 정확히 → true (윈도우 시작 포함)', () => {
    expect(isWithinMarketOpenDelay(new Date(Date.UTC(2026, 4, 4, 0, 0, 0)), policy)).toBe(true);
  });

  it('09:15 KST → true', () => {
    expect(isWithinMarketOpenDelay(new Date(Date.UTC(2026, 4, 4, 0, 15, 0)), policy)).toBe(true);
  });

  it('09:29 KST → true (윈도우 끝 1분 전)', () => {
    expect(isWithinMarketOpenDelay(new Date(Date.UTC(2026, 4, 4, 0, 29, 0)), policy)).toBe(true);
  });

  it('09:30 KST → false (윈도우 끝 정확히 — 종단 미포함)', () => {
    expect(isWithinMarketOpenDelay(new Date(Date.UTC(2026, 4, 4, 0, 30, 0)), policy)).toBe(false);
  });

  it('08:59 KST → false (윈도우 시작 직전)', () => {
    // 5/3 23:59 UTC = 5/4 08:59 KST
    expect(isWithinMarketOpenDelay(new Date(Date.UTC(2026, 4, 3, 23, 59, 0)), policy)).toBe(false);
  });

  it('15:00 KST → false (장중이지만 윈도우 밖)', () => {
    expect(isWithinMarketOpenDelay(new Date(Date.UTC(2026, 4, 4, 6, 0, 0)), policy)).toBe(false);
  });
});
