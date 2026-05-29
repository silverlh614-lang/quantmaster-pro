// @responsibility macroDataHealthRouter shortSelling trading-day-aware freshness + 7-source 36h regression tests.
import { describe, it, expect } from 'vitest';
import type { MacroState } from '../../persistence/macroStateRepo.js';
import {
  classifyMacroDataHealth,
  summarizeMacroDataHealth,
} from './macroDataHealthRouter.js';

// 2026-05-29 금(정상 거래일), 2026-06-01 월(정상 거래일). 5월은 5/5 어린이날만 휴장.
// 36h = 129,600s. iso 시각 헬퍼.
function hoursAgo(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * 3_600_000).toISOString();
}

// 거래일-aware 케이스에서 source 의 다른 7항목은 모두 FRESH 가 되도록 updatedAt 을 now 로 채운 베이스.
function baseMacro(now: Date, overrides: Partial<MacroState> = {}): MacroState {
  return {
    updatedAt: now.toISOString(),
    kospiDayReturn: 0.1,
    usdKrw: 1350,
    usdKrwSource: 'YAHOO',
    spx20dReturn: 0.5,
    dxy5dChange: 0.2,
    vkospi: 18,
    programNetBuyAmount: 100,
    programSource: 'KIS',
    shortSellingRatio: 3.2,
    shortSellingSource: 'KRX_DIRECT',
    ...overrides,
  } as unknown as MacroState;
}

describe('macroDataHealthRouter shortSelling trading-day-aware freshness', () => {
  it('(a) 직전 거래일 값 = FRESH (VERIFIED)', () => {
    // 월요일 기준, 직전 거래일(금) 장후 fetch → 거래일 거리 1 → FRESH
    const now = new Date('2026-06-01T05:00:00Z'); // 월
    const macro = baseMacro(now, {
      shortSellingFetchedAt: '2026-05-29T07:00:00Z', // 금 장후
    });
    const health = classifyMacroDataHealth(macro, now);
    expect(health.shortSelling).toBe('VERIFIED');
    expect(summarizeMacroDataHealth(health)).toBe('VERIFIED');
  });

  it('(b) 주말 너머 금요일 값 = FRESH (월요일 기준, 캘린더 60h+ 이지만 거래일 1)', () => {
    // 월 오후 기준 금 오전 fetch: 캘린더로는 ~36h 초과 가능 영역이나 거래일 거리는 1 → FRESH
    const now = new Date('2026-06-01T06:00:00Z'); // 월
    const macro = baseMacro(now, {
      shortSellingFetchedAt: '2026-05-29T01:00:00Z', // 금 오전 (캘린더 ~77h 전)
    });
    const health = classifyMacroDataHealth(macro, now);
    expect(health.shortSelling).toBe('VERIFIED');
  });

  it('(c) 2영업일 초과 미갱신 = STALE 유지 (진짜 outage)', () => {
    // 월요일 기준, 직전직전 거래일(목, 5/28)보다 더 전(화 5/26) fetch → 거래일 거리 3 → STALE
    const now = new Date('2026-06-01T06:00:00Z'); // 월
    const macro = baseMacro(now, {
      shortSellingFetchedAt: '2026-05-26T07:00:00Z', // 화
    });
    const health = classifyMacroDataHealth(macro, now);
    expect(health.shortSelling).toBe('STALE');
    expect(summarizeMacroDataHealth(health)).toBe('STALE');
  });

  it('(c-경계) 거래일 거리 정확히 2 = FRESH (목 fetch, 월 기준)', () => {
    // 목(5/28)→월(6/1): 금(29)=1, 월(6/1)=2 → 거리 2 ≤ 2 → FRESH (경계 포함)
    const now = new Date('2026-06-01T06:00:00Z'); // 월
    const macro = baseMacro(now, {
      shortSellingFetchedAt: '2026-05-28T07:00:00Z', // 목
    });
    const health = classifyMacroDataHealth(macro, now);
    expect(health.shortSelling).toBe('VERIFIED');
  });

  it('(c-경계) 거래일 거리 3 = STALE (수 fetch, 월 기준)', () => {
    // 수(5/27)→월(6/1): 목(28)=1, 금(29)=2, 월(6/1)=3 → 거리 3 > 2 → STALE
    const now = new Date('2026-06-01T06:00:00Z'); // 월
    const macro = baseMacro(now, {
      shortSellingFetchedAt: '2026-05-27T07:00:00Z', // 수
    });
    const health = classifyMacroDataHealth(macro, now);
    expect(health.shortSelling).toBe('STALE');
  });

  it('당일 intraday fetch = FRESH', () => {
    const now = new Date('2026-05-29T06:00:00Z'); // 금
    const macro = baseMacro(now, {
      shortSellingFetchedAt: '2026-05-29T01:00:00Z', // 같은 날
    });
    expect(classifyMacroDataHealth(macro, now).shortSelling).toBe('VERIFIED');
  });

  it('shortSellingFetchedAt 미존재 시 36h flat(updatedAt) 폴백', () => {
    const now = new Date('2026-05-29T06:00:00Z');
    // 자체 timestamp 없음 → timestampKeys 2순위 updatedAt 으로 36h 판정
    const macro = baseMacro(now, {
      updatedAt: hoursAgo(now, 40), // 36h 초과
      shortSellingFetchedAt: undefined,
    });
    // 단, baseMacro 의 updatedAt 을 40h 전으로 바꾸면 다른 소스도 STALE 이 됨 → shortSelling 만 검증
    expect(classifyMacroDataHealth(macro, now).shortSelling).toBe('STALE');
  });

  it('잘못된 timestamp = DEGRADED', () => {
    const now = new Date('2026-05-29T06:00:00Z');
    const macro = baseMacro(now, { shortSellingFetchedAt: 'not-a-date' });
    expect(classifyMacroDataHealth(macro, now).shortSelling).toBe('DEGRADED');
  });

  it('shortSellingSource=NONE 이면 거래일-aware 이전에 DEGRADED', () => {
    const now = new Date('2026-05-29T06:00:00Z');
    const macro = baseMacro(now, {
      shortSellingSource: 'NONE' as unknown as MacroState['shortSellingSource'],
      shortSellingFetchedAt: '2026-05-29T01:00:00Z',
    });
    expect(classifyMacroDataHealth(macro, now).shortSelling).toBe('DEGRADED');
  });
});

describe('macroDataHealthRouter 7-source 36h 동작 무변경 회귀', () => {
  it('(d) 나머지 7소스는 36h flat 임계 유지 — updatedAt 40h 전이면 STALE', () => {
    const now = new Date('2026-05-29T06:00:00Z');
    const stale = hoursAgo(now, 40); // 36h 초과
    const macro = baseMacro(now, {
      updatedAt: stale,
      // shortSelling 은 거래일-aware 라 직전 거래일 fetch 면 FRESH 로 유지(비교 대조)
      shortSellingFetchedAt: '2026-05-28T07:00:00Z', // 목 → 금까지 거리 1 → FRESH
    });
    const health = classifyMacroDataHealth(macro, now);
    // updatedAt 기반 7소스는 STALE
    expect(health.macroState).toBe('STALE');
    expect(health.spx).toBe('STALE');
    expect(health.dxy).toBe('STALE');
    expect(health.vkospi).toBe('STALE');
    expect(health.usdKrw).toBe('STALE');
    // kospi: kospiTriggerSourceUpdatedAt 부재 → updatedAt fallback → STALE
    expect(health.kospi).toBe('STALE');
    // programTrading: programFetchedAt 부재 → updatedAt fallback → STALE (36h 유지)
    expect(health.programTrading).toBe('STALE');
    // shortSelling 만 거래일-aware 라 FRESH
    expect(health.shortSelling).toBe('VERIFIED');
  });

  it('7소스 updatedAt 신선(now) + shortSelling 직전 거래일 = 전체 VERIFIED', () => {
    const now = new Date('2026-06-01T06:00:00Z'); // 월
    const macro = baseMacro(now, { shortSellingFetchedAt: '2026-05-29T07:00:00Z' });
    const health = classifyMacroDataHealth(macro, now);
    expect(summarizeMacroDataHealth(health)).toBe('VERIFIED');
  });

  it('programSource=NONE 은 여전히 DEGRADED (대조군, 변경 없음)', () => {
    const now = new Date('2026-05-29T06:00:00Z');
    const macro = baseMacro(now, { programSource: 'NONE' as unknown as MacroState['programSource'] });
    const health = classifyMacroDataHealth(macro, now);
    expect(health.programTrading).toBe('DEGRADED');
    expect(summarizeMacroDataHealth(health)).toBe('DEGRADED');
  });
});
