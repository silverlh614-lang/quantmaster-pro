/**
 * @responsibility useAutoTradeContext 5분기 매핑 회귀 테스트 — ADR-0049 SSOT
 */
import { describe, it, expect } from 'vitest';
import {
  classifyAutoTradeContext,
  classifyAutoTradeContextFromNow,
  type AutoTradeContext,
} from './useAutoTradeContext';

/** KST 시각을 UTC Date 로 변환 — KST = UTC+9 */
function kstDate(year: number, monthIdx: number, day: number, hour: number, min: number): Date {
  return new Date(Date.UTC(year, monthIdx, day, hour - 9, min, 0));
}

describe('classifyAutoTradeContext — ADR-0049 §2.2 매핑', () => {
  // 2026-04-27 = 월요일 (정상 평일)
  // 2026-04-25 = 토요일
  // 2026-04-26 = 일요일

  describe('PRE_MARKET 분기 (평일 KST 08:30~09:00)', () => {
    it('월요일 KST 08:30 정확히 → PRE_MARKET (경계값 포함)', () => {
      // LIVE_TRADING_DAY 가 false 이므로 mode 는 AFTER_MARKET. KST 08:30 분 = 510 → PRE_MARKET 분기 진입.
      const t = kstDate(2026, 3, 27, 8, 30);
      expect(classifyAutoTradeContext('AFTER_MARKET', t)).toBe<AutoTradeContext>('PRE_MARKET');
    });

    it('월요일 KST 08:45 → PRE_MARKET', () => {
      const t = kstDate(2026, 3, 27, 8, 45);
      expect(classifyAutoTradeContext('AFTER_MARKET', t)).toBe('PRE_MARKET');
    });

    it('월요일 KST 08:59 → PRE_MARKET (경계값 1분 전)', () => {
      const t = kstDate(2026, 3, 27, 8, 59);
      expect(classifyAutoTradeContext('AFTER_MARKET', t)).toBe('PRE_MARKET');
    });

    it('월요일 KST 08:29 → OVERNIGHT (PRE_MARKET 경계값 1분 전)', () => {
      const t = kstDate(2026, 3, 27, 8, 29);
      expect(classifyAutoTradeContext('AFTER_MARKET', t)).toBe('OVERNIGHT');
    });
  });

  describe('LIVE_MARKET 분기 (평일 KST 09:00~15:30)', () => {
    it('월요일 KST 09:00 정확히 → LIVE_MARKET (경계값 포함)', () => {
      const t = kstDate(2026, 3, 27, 9, 0);
      expect(classifyAutoTradeContext('LIVE_TRADING_DAY', t)).toBe('LIVE_MARKET');
    });

    it('월요일 KST 12:00 → LIVE_MARKET', () => {
      const t = kstDate(2026, 3, 27, 12, 0);
      expect(classifyAutoTradeContext('LIVE_TRADING_DAY', t)).toBe('LIVE_MARKET');
    });

    it('월요일 KST 15:29 → LIVE_MARKET (경계값 1분 전)', () => {
      const t = kstDate(2026, 3, 27, 15, 29);
      expect(classifyAutoTradeContext('LIVE_TRADING_DAY', t)).toBe('LIVE_MARKET');
    });
  });

  describe('POST_MARKET 분기 (평일 KST 15:30~16:00)', () => {
    it('월요일 KST 15:30 정확히 → POST_MARKET (mode=AFTER_MARKET 으로 전환된 케이스)', () => {
      // 15:30 시각에는 isMarketOpen=false → mode=AFTER_MARKET. 시각 분기로 POST_MARKET 결정.
      const t = kstDate(2026, 3, 27, 15, 30);
      expect(classifyAutoTradeContext('AFTER_MARKET', t)).toBe('POST_MARKET');
    });

    it('월요일 KST 15:45 → POST_MARKET', () => {
      const t = kstDate(2026, 3, 27, 15, 45);
      expect(classifyAutoTradeContext('AFTER_MARKET', t)).toBe('POST_MARKET');
    });

    it('월요일 KST 15:59 → POST_MARKET (경계값 1분 전)', () => {
      const t = kstDate(2026, 3, 27, 15, 59);
      expect(classifyAutoTradeContext('AFTER_MARKET', t)).toBe('POST_MARKET');
    });
  });

  describe('OVERNIGHT 분기 (평일 KST 16:00~08:30)', () => {
    it('월요일 KST 16:00 정확히 → OVERNIGHT (POST_MARKET 경계값)', () => {
      const t = kstDate(2026, 3, 27, 16, 0);
      expect(classifyAutoTradeContext('AFTER_MARKET', t)).toBe('OVERNIGHT');
    });

    it('월요일 KST 03:00 (새벽) → OVERNIGHT', () => {
      const t = kstDate(2026, 3, 27, 3, 0);
      expect(classifyAutoTradeContext('AFTER_MARKET', t)).toBe('OVERNIGHT');
    });

    it('월요일 KST 22:00 (저녁) → OVERNIGHT', () => {
      const t = kstDate(2026, 3, 27, 22, 0);
      expect(classifyAutoTradeContext('AFTER_MARKET', t)).toBe('OVERNIGHT');
    });
  });

  describe('WEEKEND_HOLIDAY 분기', () => {
    it('토요일 KST 14:00 → WEEKEND_HOLIDAY', () => {
      const t = kstDate(2026, 3, 25, 14, 0);
      expect(classifyAutoTradeContext('WEEKEND_CACHE', t)).toBe('WEEKEND_HOLIDAY');
    });

    it('일요일 KST 11:00 → WEEKEND_HOLIDAY', () => {
      const t = kstDate(2026, 3, 26, 11, 0);
      expect(classifyAutoTradeContext('WEEKEND_CACHE', t)).toBe('WEEKEND_HOLIDAY');
    });

    it('HOLIDAY_CACHE → WEEKEND_HOLIDAY (공휴일 캘린더 활성화 후 사용)', () => {
      const t = kstDate(2026, 3, 27, 10, 0); // 평일이라도 mode 가 HOLIDAY_CACHE 면
      expect(classifyAutoTradeContext('HOLIDAY_CACHE', t)).toBe('WEEKEND_HOLIDAY');
    });

    it('주말 시각이 LIVE_TRADING_DAY 로 잘못 들어와도 WEEKEND_HOLIDAY 안전망', () => {
      // 정상 흐름에선 발생 안 하지만 안전 fallback 검증
      const sat = kstDate(2026, 3, 25, 12, 0);
      expect(classifyAutoTradeContext('LIVE_TRADING_DAY', sat)).toBe('WEEKEND_HOLIDAY');
    });
  });

  describe('DEGRADED fallback', () => {
    it('DEGRADED → LIVE_MARKET (안전 fallback, 모니터링 우선)', () => {
      const t = kstDate(2026, 3, 27, 12, 0);
      expect(classifyAutoTradeContext('DEGRADED', t)).toBe('LIVE_MARKET');
    });

    it('DEGRADED 가 어느 시각이든 LIVE_MARKET 반환 (휴장 시각 포함)', () => {
      const sat = kstDate(2026, 3, 25, 14, 0);
      expect(classifyAutoTradeContext('DEGRADED', sat)).toBe('LIVE_MARKET');
    });
  });
});

describe('classifyAutoTradeContextFromNow — mode 도출 일관성', () => {
  it('월요일 KST 10:00 → LIVE_MARKET (mode 자체 도출)', () => {
    const t = kstDate(2026, 3, 27, 10, 0);
    expect(classifyAutoTradeContextFromNow(t)).toBe('LIVE_MARKET');
  });

  it('월요일 KST 08:45 → PRE_MARKET (mode=AFTER_MARKET 자체 도출 후 분기)', () => {
    const t = kstDate(2026, 3, 27, 8, 45);
    expect(classifyAutoTradeContextFromNow(t)).toBe('PRE_MARKET');
  });

  it('토요일 KST 11:00 → WEEKEND_HOLIDAY', () => {
    const t = kstDate(2026, 3, 25, 11, 0);
    expect(classifyAutoTradeContextFromNow(t)).toBe('WEEKEND_HOLIDAY');
  });

  it('월요일 KST 22:00 → OVERNIGHT', () => {
    const t = kstDate(2026, 3, 27, 22, 0);
    expect(classifyAutoTradeContextFromNow(t)).toBe('OVERNIGHT');
  });

  it('월요일 KST 15:45 → POST_MARKET', () => {
    const t = kstDate(2026, 3, 27, 15, 45);
    expect(classifyAutoTradeContextFromNow(t)).toBe('POST_MARKET');
  });
});
