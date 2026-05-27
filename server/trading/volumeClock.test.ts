import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkVolumeClockWindow } from './volumeClock.js';

/** 주어진 KST 시:분으로 UTC Date를 생성하는 헬퍼 */
function kstTime(hour: number, minute: number): Date {
  // KST = UTC + 9h
  return new Date(Date.UTC(2026, 0, 12, hour - 9, minute));
}

describe('checkVolumeClockWindow — ALWAYS-ON (장중 전 시간 매수 허용, 가/감점만)', () => {
  // ── 시초가 09:00~09:29: 차단이 아니라 강한 감점(-3) ─────────────────────────
  describe('09:00~09:29 시초가 — 매수 허용 + -3점 (차단 아님)', () => {
    it('allows entry at 09:00 with -3', () => {
      const r = checkVolumeClockWindow(kstTime(9, 0));
      expect(r.allowEntry).toBe(true);
      expect(r.scoreBonus).toBe(-3);
    });
    it('allows entry at 09:15 with -3', () => {
      const r = checkVolumeClockWindow(kstTime(9, 15));
      expect(r.allowEntry).toBe(true);
      expect(r.scoreBonus).toBe(-3);
    });
    it('allows entry at 09:29 with -3', () => {
      const r = checkVolumeClockWindow(kstTime(9, 29));
      expect(r.allowEntry).toBe(true);
      expect(r.scoreBonus).toBe(-3);
    });
  });

  // ── 점심 12:00~12:59: 차단이 아니라 -2점 ───────────────────────────────────
  describe('12:00~12:59 점심 — 매수 허용 + -2점 (차단 아님)', () => {
    it('allows entry at 12:00 with -2', () => {
      const r = checkVolumeClockWindow(kstTime(12, 0));
      expect(r.allowEntry).toBe(true);
      expect(r.scoreBonus).toBe(-2);
    });
    it('allows entry at 12:30 with -2', () => {
      const r = checkVolumeClockWindow(kstTime(12, 30));
      expect(r.allowEntry).toBe(true);
      expect(r.scoreBonus).toBe(-2);
    });
    it('allows entry at 12:59 with -2', () => {
      const r = checkVolumeClockWindow(kstTime(12, 59));
      expect(r.allowEntry).toBe(true);
      expect(r.scoreBonus).toBe(-2);
    });
  });

  // ── 유일한 하드 차단: 15:21~15:30 마감 동시호가 ────────────────────────────
  describe('15:21~15:30 마감 동시호가 — 유일한 하드 차단', () => {
    it('blocks entry at 15:21', () => {
      expect(checkVolumeClockWindow(kstTime(15, 21)).allowEntry).toBe(false);
    });
    it('blocks entry at 15:25', () => {
      expect(checkVolumeClockWindow(kstTime(15, 25)).allowEntry).toBe(false);
    });
    it('blocks entry at 15:30', () => {
      expect(checkVolumeClockWindow(kstTime(15, 30)).allowEntry).toBe(false);
    });
  });

  // ── 가/감점 구간 (모두 매수 허용) ───────────────────────────────────────────
  describe('가/감점 구간 (allowEntry=true)', () => {
    it('-2 at 09:30~09:59', () => {
      for (const m of [30, 45, 59]) {
        const r = checkVolumeClockWindow(kstTime(9, m));
        expect(r.allowEntry).toBe(true);
        expect(r.scoreBonus).toBe(-2);
      }
    });
    it('+2 at 10:00~10:59', () => {
      for (const m of [0, 30, 59]) {
        const r = checkVolumeClockWindow(kstTime(10, m));
        expect(r.allowEntry).toBe(true);
        expect(r.scoreBonus).toBe(2);
      }
    });
    it('-1 at 11:00~11:59', () => {
      for (const m of [0, 30, 59]) {
        const r = checkVolumeClockWindow(kstTime(11, m));
        expect(r.allowEntry).toBe(true);
        expect(r.scoreBonus).toBe(-1);
      }
    });
    it('-2 at 13:00~13:14', () => {
      expect(checkVolumeClockWindow(kstTime(13, 0)).scoreBonus).toBe(-2);
      expect(checkVolumeClockWindow(kstTime(13, 14)).scoreBonus).toBe(-2);
    });
    it('-1 at 13:15~13:29', () => {
      expect(checkVolumeClockWindow(kstTime(13, 15)).scoreBonus).toBe(-1);
      expect(checkVolumeClockWindow(kstTime(13, 29)).scoreBonus).toBe(-1);
    });
    it('0 at 13:30~14:29', () => {
      expect(checkVolumeClockWindow(kstTime(13, 30)).scoreBonus).toBe(0);
      expect(checkVolumeClockWindow(kstTime(14, 29)).scoreBonus).toBe(0);
    });
    it('-2 at 14:30~15:20', () => {
      expect(checkVolumeClockWindow(kstTime(14, 30)).scoreBonus).toBe(-2);
      const r = checkVolumeClockWindow(kstTime(15, 20));
      expect(r.allowEntry).toBe(true);
      expect(r.scoreBonus).toBe(-2);
    });
  });

  // ── 경계 전환 ───────────────────────────────────────────────────────────────
  describe('경계 전환 (전부 매수 허용, 15:20→15:21 만 차단)', () => {
    it('09:29→09:30: -3 → -2 (둘 다 허용)', () => {
      expect(checkVolumeClockWindow(kstTime(9, 29)).scoreBonus).toBe(-3);
      expect(checkVolumeClockWindow(kstTime(9, 30)).scoreBonus).toBe(-2);
      expect(checkVolumeClockWindow(kstTime(9, 29)).allowEntry).toBe(true);
    });
    it('11:59→12:00: -1 → -2 (둘 다 허용, 점심 차단 없음)', () => {
      expect(checkVolumeClockWindow(kstTime(11, 59)).allowEntry).toBe(true);
      const at1200 = checkVolumeClockWindow(kstTime(12, 0));
      expect(at1200.allowEntry).toBe(true);
      expect(at1200.scoreBonus).toBe(-2);
    });
    it('15:20→15:21: 허용(-2) → 마감 동시호가 차단', () => {
      const at1520 = checkVolumeClockWindow(kstTime(15, 20));
      expect(at1520.allowEntry).toBe(true);
      expect(checkVolumeClockWindow(kstTime(15, 21)).allowEntry).toBe(false);
    });
  });

  // ── 장외 시간 (세션 외) ─────────────────────────────────────────────────────
  describe('장외 시간 (연속매매 세션 외)', () => {
    it('08:30 (개장 전)', () => {
      expect(checkVolumeClockWindow(kstTime(8, 30)).allowEntry).toBe(false);
    });
    it('15:31 (마감 직후)', () => {
      expect(checkVolumeClockWindow(kstTime(15, 31)).allowEntry).toBe(false);
    });
    it('16:00 (장 마감 후)', () => {
      expect(checkVolumeClockWindow(kstTime(16, 0)).allowEntry).toBe(false);
    });
  });
});

// ── 롤백: VOLUME_CLOCK_LEGACY_HARD_BLOCK=true → 구 하드 차단 동작 ──────────────
describe('VOLUME_CLOCK_LEGACY_HARD_BLOCK=true (롤백 — 구 하드 차단)', () => {
  beforeEach(() => { process.env.VOLUME_CLOCK_LEGACY_HARD_BLOCK = 'true'; });
  afterEach(() => { delete process.env.VOLUME_CLOCK_LEGACY_HARD_BLOCK; });

  it('legacy: 09:00 차단', () => {
    expect(checkVolumeClockWindow(kstTime(9, 0)).allowEntry).toBe(false);
  });
  it('legacy: 12:00 / 12:59 차단 (점심)', () => {
    expect(checkVolumeClockWindow(kstTime(12, 0)).allowEntry).toBe(false);
    expect(checkVolumeClockWindow(kstTime(12, 59)).allowEntry).toBe(false);
  });
  it('legacy: 15:21 차단 (마감 동시호가)', () => {
    expect(checkVolumeClockWindow(kstTime(15, 21)).allowEntry).toBe(false);
  });
  it('legacy: 10:00 허용 (+2)', () => {
    const r = checkVolumeClockWindow(kstTime(10, 0));
    expect(r.allowEntry).toBe(true);
    expect(r.scoreBonus).toBe(2);
  });
});
