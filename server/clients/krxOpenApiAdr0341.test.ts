// @responsibility ADR-0341 krxOpenApi recentBusinessDaysKst 한국 공휴일 정합 회귀
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isKrxTradingCalendarLegacy, recentBusinessDaysKst } from './krxOpenApi.js';

const ORIGINAL_LEGACY = process.env.KRX_TRADING_CALENDAR_LEGACY;

beforeEach(() => {
  delete process.env.KRX_TRADING_CALENDAR_LEGACY;
});

afterEach(() => {
  if (ORIGINAL_LEGACY === undefined) delete process.env.KRX_TRADING_CALENDAR_LEGACY;
  else process.env.KRX_TRADING_CALENDAR_LEGACY = ORIGINAL_LEGACY;
});

describe('isKrxTradingCalendarLegacy — ENV 정확 비교 (ADR-0157)', () => {
  it('미설정 → false (default ADR-0341)', () => {
    expect(isKrxTradingCalendarLegacy()).toBe(false);
  });
  it('"true" → true (legacy weekday-only 복원)', () => {
    process.env.KRX_TRADING_CALENDAR_LEGACY = 'true';
    expect(isKrxTradingCalendarLegacy()).toBe(true);
  });
  it('"1" / "TRUE" → false (정확 비교)', () => {
    process.env.KRX_TRADING_CALENDAR_LEGACY = '1';
    expect(isKrxTradingCalendarLegacy()).toBe(false);
    process.env.KRX_TRADING_CALENDAR_LEGACY = 'TRUE';
    expect(isKrxTradingCalendarLegacy()).toBe(false);
  });
});

describe('recentBusinessDaysKst (ADR-0341)', () => {
  it('default — 한국 공휴일 (어린이날 5/5) 자동 제외', () => {
    // KST 5/6 (수) 시점 → 직전 영업일 5/4 (월) 가 첫 번째 (5/5 어린이날 skip)
    const now = new Date('2026-05-06T15:00:00+09:00');
    const r = recentBusinessDaysKst(3, now);
    expect(r).not.toContain('20260505');
    expect(r[0]).toBe('20260504');
  });

  it('default — 사용자 명시 5/4 시점 — 5/1 근로자의 날 skip 검증', () => {
    // KST 5/4 (월) 시점 → 직전 영업일은 4/30 (목)
    // skip 대상: 5/3(일) + 5/2(토) + 5/1(금, 근로자의 날) → 4/30(목) 도달
    const now = new Date('2026-05-04T15:00:00+09:00');
    const r = recentBusinessDaysKst(2, now);
    expect(r).not.toContain('20260501'); // 근로자의 날
    expect(r).not.toContain('20260502'); // 토
    expect(r).not.toContain('20260503'); // 일
    expect(r[0]).toBe('20260430');
  });

  it('default — 사용자 명시 5/6 시점 — recentBusinessDaysKst(1) = 20260504', () => {
    // 정확히 사용자 명시 케이스: 2026-05-06 기준 recentBusinessDaysKst(1)
    // 기대값: 20260504 / 금지값: 20260505
    const now = new Date('2026-05-06T15:00:00+09:00');
    const r = recentBusinessDaysKst(1, now);
    expect(r).toEqual(['20260504']);
    expect(r).not.toContain('20260505');
  });

  it('default — 추석 연휴 (9/24~9/26) 자동 제외', () => {
    // KST 9/29 (월) 시점 → 9/26(금)/9/25(목)/9/24(수) 모두 추석 skip → 9/23(화) 부터 시작
    const now = new Date('2026-09-29T15:00:00+09:00');
    const r = recentBusinessDaysKst(2, now);
    expect(r).not.toContain('20260926');
    expect(r).not.toContain('20260925');
    expect(r).not.toContain('20260924');
  });

  it('default — 주말 + 휴일 동시 skip', () => {
    // 5/2(토) + 5/3(일) + 5/5(화 어린이날) 모두 skip
    const now = new Date('2026-05-06T15:00:00+09:00');
    const r = recentBusinessDaysKst(5, now);
    expect(r).not.toContain('20260502');
    expect(r).not.toContain('20260503');
    expect(r).not.toContain('20260505');
  });

  it('legacy ENV — 한국 공휴일 미반영 (weekday-only 복원)', () => {
    process.env.KRX_TRADING_CALENDAR_LEGACY = 'true';
    const now = new Date('2026-05-06T15:00:00+09:00');
    const r = recentBusinessDaysKst(2, now);
    // 5/5 (화 어린이날) — legacy 모드에선 weekday=true 라 통과
    expect(r).toContain('20260505');
  });

  it('count=1 — 단일 영업일', () => {
    const now = new Date('2026-05-06T15:00:00+09:00');
    const r = recentBusinessDaysKst(1, now);
    expect(r).toHaveLength(1);
    expect(r[0]).toBe('20260504');
  });

  it('count=0 → 1 (Math.max 보장)', () => {
    const now = new Date('2026-05-06T15:00:00+09:00');
    const r = recentBusinessDaysKst(0, now);
    expect(r).toHaveLength(1);
  });

  it('count=10 다수 영업일 — 모두 KRX 거래일', () => {
    const now = new Date('2026-05-06T15:00:00+09:00');
    const r = recentBusinessDaysKst(10, now);
    expect(r).toHaveLength(10);
    // 모두 yyyymmdd 형식 + 중복 없음
    for (const d of r) {
      expect(d).toMatch(/^\d{8}$/);
    }
    expect(new Set(r).size).toBe(10);
  });

  it('safety 가드 — 무한 루프 방지 (60회 limit)', () => {
    // 정상 동작 확인 — 무한 루프 발생 시 timeout 또는 빈 배열
    const now = new Date('2026-05-06T15:00:00+09:00');
    const r = recentBusinessDaysKst(20, now);
    expect(r.length).toBeLessThanOrEqual(20);
    expect(r.length).toBeGreaterThanOrEqual(15); // safety 60 으로 충분
  });
});
