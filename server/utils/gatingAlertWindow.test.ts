// @responsibility gatingAlertWindow SSOT 회귀 테스트 — 윈도우 분류 + ENV 우회 + dedupeKey 합성

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getGatingAlertSession,
  isGatingAlertWindowDisabled,
  buildSessionDedupeKey,
  GATING_ALERT_WINDOW_CONSTANTS,
} from './gatingAlertWindow.js';

// KST 시각을 UTC Date 로 변환 (테스트 입력용 헬퍼)
function kstDate(yyyy: number, mm: number, dd: number, hh: number, min: number): Date {
  // KST = UTC+9, so to construct a Date that represents the given KST clock time,
  // we subtract 9 hours from the given KST.
  return new Date(Date.UTC(yyyy, mm - 1, dd, hh - 9, min));
}

describe('gatingAlertWindow SSOT', () => {
  beforeEach(() => {
    delete process.env.GATING_ALERT_WINDOW_DISABLED;
  });
  afterEach(() => {
    delete process.env.GATING_ALERT_WINDOW_DISABLED;
  });

  describe('GATING_ALERT_WINDOW_CONSTANTS 정합', () => {
    it('OPEN/CLOSE 분 단위 임계 정확', () => {
      expect(GATING_ALERT_WINDOW_CONSTANTS.OPEN_START_MIN).toBe(540);  // 09:00
      expect(GATING_ALERT_WINDOW_CONSTANTS.OPEN_END_MIN).toBe(600);    // 10:00
      expect(GATING_ALERT_WINDOW_CONSTANTS.CLOSE_START_MIN).toBe(900); // 15:00
      expect(GATING_ALERT_WINDOW_CONSTANTS.CLOSE_END_MIN).toBe(960);   // 16:00
    });
  });

  describe('getGatingAlertSession — OPEN 윈도우', () => {
    it('09:00 KST 정확 → OPEN', () => {
      // 2026-04-29 (수) 09:00 KST = 2026-04-29 00:00 UTC
      expect(getGatingAlertSession(kstDate(2026, 4, 29, 9, 0))).toBe('OPEN');
    });
    it('09:30 KST → OPEN', () => {
      expect(getGatingAlertSession(kstDate(2026, 4, 29, 9, 30))).toBe('OPEN');
    });
    it('09:59 KST → OPEN (마지막 분)', () => {
      expect(getGatingAlertSession(kstDate(2026, 4, 29, 9, 59))).toBe('OPEN');
    });
    it('10:00 KST 정확 → null (exclusive 종료)', () => {
      expect(getGatingAlertSession(kstDate(2026, 4, 29, 10, 0))).toBeNull();
    });
    it('08:59 KST → null (윈도우 직전)', () => {
      expect(getGatingAlertSession(kstDate(2026, 4, 29, 8, 59))).toBeNull();
    });
  });

  describe('getGatingAlertSession — CLOSE 윈도우', () => {
    it('15:00 KST 정확 → CLOSE', () => {
      expect(getGatingAlertSession(kstDate(2026, 4, 29, 15, 0))).toBe('CLOSE');
    });
    it('15:30 KST → CLOSE (장마감 직후 권장 발송 시각)', () => {
      expect(getGatingAlertSession(kstDate(2026, 4, 29, 15, 30))).toBe('CLOSE');
    });
    it('15:59 KST → CLOSE (마지막 분)', () => {
      expect(getGatingAlertSession(kstDate(2026, 4, 29, 15, 59))).toBe('CLOSE');
    });
    it('16:00 KST 정확 → null (exclusive 종료)', () => {
      expect(getGatingAlertSession(kstDate(2026, 4, 29, 16, 0))).toBeNull();
    });
    it('14:59 KST → null (윈도우 직전)', () => {
      expect(getGatingAlertSession(kstDate(2026, 4, 29, 14, 59))).toBeNull();
    });
  });

  describe('getGatingAlertSession — 발송 차단 시간대 (사용자 보고 시나리오)', () => {
    it('14:30 KST → null (FOMC DAY 청산 시각 — 게이팅 알림 발송 안 함)', () => {
      expect(getGatingAlertSession(kstDate(2026, 4, 29, 14, 30))).toBeNull();
    });
    it('13:30 KST → null (사용자 이미지 14:30 KST = 베이징 13:30, 게이팅 차단)', () => {
      expect(getGatingAlertSession(kstDate(2026, 4, 29, 13, 30))).toBeNull();
    });
    it('11:30 KST → null (오전 시간대 발송 차단)', () => {
      expect(getGatingAlertSession(kstDate(2026, 4, 29, 11, 30))).toBeNull();
    });
    it('점심 시간 12:30 KST → null', () => {
      expect(getGatingAlertSession(kstDate(2026, 4, 29, 12, 30))).toBeNull();
    });
    it('새벽 02:00 KST → null', () => {
      expect(getGatingAlertSession(kstDate(2026, 4, 29, 2, 0))).toBeNull();
    });
  });

  describe('getGatingAlertSession — 주말 차단', () => {
    it('토요일 09:30 KST → null', () => {
      // 2026-05-02 (토)
      expect(getGatingAlertSession(kstDate(2026, 5, 2, 9, 30))).toBeNull();
    });
    it('일요일 15:30 KST → null', () => {
      // 2026-05-03 (일)
      expect(getGatingAlertSession(kstDate(2026, 5, 3, 15, 30))).toBeNull();
    });
  });

  describe('isGatingAlertWindowDisabled — ENV 우회', () => {
    it('미설정 → false', () => {
      expect(isGatingAlertWindowDisabled()).toBe(false);
    });
    it('"true" → true', () => {
      process.env.GATING_ALERT_WINDOW_DISABLED = 'true';
      expect(isGatingAlertWindowDisabled()).toBe(true);
    });
    it('"TRUE" 대소문자 무관 → true', () => {
      process.env.GATING_ALERT_WINDOW_DISABLED = 'TRUE';
      expect(isGatingAlertWindowDisabled()).toBe(true);
    });
    it('"1" → true', () => {
      process.env.GATING_ALERT_WINDOW_DISABLED = '1';
      expect(isGatingAlertWindowDisabled()).toBe(true);
    });
    it('"false" → false', () => {
      process.env.GATING_ALERT_WINDOW_DISABLED = 'false';
      expect(isGatingAlertWindowDisabled()).toBe(false);
    });
    it('빈 문자열 → false', () => {
      process.env.GATING_ALERT_WINDOW_DISABLED = '';
      expect(isGatingAlertWindowDisabled()).toBe(false);
    });
  });

  describe('getGatingAlertSession — ENV 우회 동작', () => {
    it('DISABLED=true 시 14:30 KST 도 OPEN 반환 (발송 허용)', () => {
      process.env.GATING_ALERT_WINDOW_DISABLED = 'true';
      expect(getGatingAlertSession(kstDate(2026, 4, 29, 14, 30))).toBe('OPEN');
    });
    it('DISABLED=true 시 주말도 OPEN 반환', () => {
      process.env.GATING_ALERT_WINDOW_DISABLED = 'true';
      expect(getGatingAlertSession(kstDate(2026, 5, 2, 9, 30))).toBe('OPEN');
    });
    it('DISABLED=false 시 정상 동작', () => {
      process.env.GATING_ALERT_WINDOW_DISABLED = 'false';
      expect(getGatingAlertSession(kstDate(2026, 4, 29, 14, 30))).toBeNull();
      expect(getGatingAlertSession(kstDate(2026, 4, 29, 9, 30))).toBe('OPEN');
    });
  });

  describe('buildSessionDedupeKey — dedupeKey 합성', () => {
    it('OPEN session → "${prefix}:${date}:open"', () => {
      expect(buildSessionDedupeKey('fomc_gating_block', '2026-04-29', 'OPEN')).toBe(
        'fomc_gating_block:2026-04-29:open',
      );
    });
    it('CLOSE session → "${prefix}:${date}:close"', () => {
      expect(buildSessionDedupeKey('vix_gating_block', '2026-04-29', 'CLOSE')).toBe(
        'vix_gating_block:2026-04-29:close',
      );
    });
    it('null session → null (호출자 발송 차단)', () => {
      expect(buildSessionDedupeKey('fomc_gating_block', '2026-04-29', null)).toBeNull();
    });
    it('OPEN/CLOSE 다른 session 은 다른 dedupeKey 생성 (1일 2회 발송 보장)', () => {
      const open = buildSessionDedupeKey('fomc_gating_block', '2026-04-29', 'OPEN');
      const close = buildSessionDedupeKey('fomc_gating_block', '2026-04-29', 'CLOSE');
      expect(open).not.toBe(close);
      expect(open).toBe('fomc_gating_block:2026-04-29:open');
      expect(close).toBe('fomc_gating_block:2026-04-29:close');
    });
  });
});
