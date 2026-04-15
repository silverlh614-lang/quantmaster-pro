import { describe, expect, it } from 'vitest';
import { checkVolumeClockWindow } from './volumeClock.js';

/** 주어진 KST 시:분으로 UTC Date를 생성하는 헬퍼 */
function kstTime(hour: number, minute: number): Date {
  // KST = UTC + 9h
  return new Date(Date.UTC(2026, 0, 12, hour - 9, minute));
}

describe('checkVolumeClockWindow', () => {
  // ── 절대 차단 구간 ──────────────────────────────────────────────────────────

  it('blocks entry at 09:00 (시초가 결정 구간 시작)', () => {
    const result = checkVolumeClockWindow(kstTime(9, 0));
    expect(result.allowEntry).toBe(false);
    expect(result.scoreBonus).toBe(0);
  });

  it('blocks entry at 09:15 (시초가 결정 구간 내부)', () => {
    const result = checkVolumeClockWindow(kstTime(9, 15));
    expect(result.allowEntry).toBe(false);
  });

  it('blocks entry at 09:29 (시초가 결정 구간 끝)', () => {
    const result = checkVolumeClockWindow(kstTime(9, 29));
    expect(result.allowEntry).toBe(false);
  });

  it('blocks entry at 14:55 (마감 동시호가 시작)', () => {
    const result = checkVolumeClockWindow(kstTime(14, 55));
    expect(result.allowEntry).toBe(false);
  });

  it('blocks entry at 15:00 (마감 동시호가 내부)', () => {
    const result = checkVolumeClockWindow(kstTime(15, 0));
    expect(result.allowEntry).toBe(false);
  });

  it('blocks entry at 15:30 (마감 동시호가 끝)', () => {
    const result = checkVolumeClockWindow(kstTime(15, 30));
    expect(result.allowEntry).toBe(false);
  });

  // ── 패널티 -2 구간 ─────────────────────────────────────────────────────────

  describe('패널티 -2: 09:30~09:59 개장 초반 노이즈', () => {
    it('applies -2 at 09:30 (구간 시작)', () => {
      const result = checkVolumeClockWindow(kstTime(9, 30));
      expect(result.allowEntry).toBe(true);
      expect(result.scoreBonus).toBe(-2);
    });

    it('applies -2 at 09:45 (구간 중간)', () => {
      const result = checkVolumeClockWindow(kstTime(9, 45));
      expect(result.allowEntry).toBe(true);
      expect(result.scoreBonus).toBe(-2);
    });

    it('applies -2 at 09:59 (구간 끝)', () => {
      const result = checkVolumeClockWindow(kstTime(9, 59));
      expect(result.allowEntry).toBe(true);
      expect(result.scoreBonus).toBe(-2);
    });
  });

  describe('패널티 -2: 14:30~14:54 마감 30분 전 변동성 확대', () => {
    it('applies -2 at 14:30 (구간 시작)', () => {
      const result = checkVolumeClockWindow(kstTime(14, 30));
      expect(result.allowEntry).toBe(true);
      expect(result.scoreBonus).toBe(-2);
    });

    it('applies -2 at 14:45 (구간 중간)', () => {
      const result = checkVolumeClockWindow(kstTime(14, 45));
      expect(result.allowEntry).toBe(true);
      expect(result.scoreBonus).toBe(-2);
    });

    it('applies -2 at 14:54 (구간 끝)', () => {
      const result = checkVolumeClockWindow(kstTime(14, 54));
      expect(result.allowEntry).toBe(true);
      expect(result.scoreBonus).toBe(-2);
    });
  });

  describe('절대 차단: 11:30~13:00 점심 구간', () => {
    it('blocks entry at 11:30 (구간 시작)', () => {
      const result = checkVolumeClockWindow(kstTime(11, 30));
      expect(result.allowEntry).toBe(false);
      expect(result.scoreBonus).toBe(0);
    });

    it('blocks entry at 12:00 (점심 중간)', () => {
      const result = checkVolumeClockWindow(kstTime(12, 0));
      expect(result.allowEntry).toBe(false);
      expect(result.scoreBonus).toBe(0);
    });

    it('blocks entry at 12:30 (점심 중간)', () => {
      const result = checkVolumeClockWindow(kstTime(12, 30));
      expect(result.allowEntry).toBe(false);
      expect(result.scoreBonus).toBe(0);
    });

    it('blocks entry at 12:59 (구간 내부)', () => {
      const result = checkVolumeClockWindow(kstTime(12, 59));
      expect(result.allowEntry).toBe(false);
      expect(result.scoreBonus).toBe(0);
    });

    it('blocks entry at 13:00 (구간 끝)', () => {
      const result = checkVolumeClockWindow(kstTime(13, 0));
      expect(result.allowEntry).toBe(false);
      expect(result.scoreBonus).toBe(0);
    });
  });

  // ── 패널티 -1 구간 ─────────────────────────────────────────────────────────

  describe('패널티 -2: 13:01~13:14 점심 직후 회복 초기', () => {
    it('applies -2 at 13:01 (구간 시작)', () => {
      const result = checkVolumeClockWindow(kstTime(13, 1));
      expect(result.allowEntry).toBe(true);
      expect(result.scoreBonus).toBe(-2);
    });

    it('applies -2 at 13:14 (구간 끝)', () => {
      const result = checkVolumeClockWindow(kstTime(13, 14));
      expect(result.allowEntry).toBe(true);
      expect(result.scoreBonus).toBe(-2);
    });
  });

  describe('패널티 -1: 13:15~13:29 거래 회복 중', () => {
    it('applies -1 at 13:15 (구간 시작)', () => {
      const result = checkVolumeClockWindow(kstTime(13, 15));
      expect(result.allowEntry).toBe(true);
      expect(result.scoreBonus).toBe(-1);
    });

    it('applies -1 at 13:29 (구간 끝)', () => {
      const result = checkVolumeClockWindow(kstTime(13, 29));
      expect(result.allowEntry).toBe(true);
      expect(result.scoreBonus).toBe(-1);
    });
  });

  describe('패널티 -1: 11:00~11:29 오전 후반 모멘텀 약화', () => {
    it('applies -1 at 11:00 (구간 시작)', () => {
      const result = checkVolumeClockWindow(kstTime(11, 0));
      expect(result.allowEntry).toBe(true);
      expect(result.scoreBonus).toBe(-1);
    });

    it('applies -1 at 11:29 (구간 끝)', () => {
      const result = checkVolumeClockWindow(kstTime(11, 29));
      expect(result.allowEntry).toBe(true);
      expect(result.scoreBonus).toBe(-1);
    });
  });

  // ── 보너스 없음 (0점) 구간 ─────────────────────────────────────────────────

  describe('보너스 0: 13:30~14:29 오후 기관 리밸런싱', () => {
    it('gives 0 bonus at 13:30 (구간 시작)', () => {
      const result = checkVolumeClockWindow(kstTime(13, 30));
      expect(result.allowEntry).toBe(true);
      expect(result.scoreBonus).toBe(0);
    });

    it('gives 0 bonus at 14:00 (구간 중간)', () => {
      const result = checkVolumeClockWindow(kstTime(14, 0));
      expect(result.allowEntry).toBe(true);
      expect(result.scoreBonus).toBe(0);
    });

    it('gives 0 bonus at 14:29 (구간 끝)', () => {
      const result = checkVolumeClockWindow(kstTime(14, 29));
      expect(result.allowEntry).toBe(true);
      expect(result.scoreBonus).toBe(0);
    });
  });

  // 11:30~11:59 → 점심 절대 차단으로 이동 (위 '절대 차단: 11:30~12:59 점심 구간' 참조)

  // ── 보너스 +2 구간 ─────────────────────────────────────────────────────────

  describe('보너스 +2: 10:00~10:59 기관 알고리즘 집중', () => {
    it('gives +2 bonus at 10:00 (구간 시작)', () => {
      const result = checkVolumeClockWindow(kstTime(10, 0));
      expect(result.allowEntry).toBe(true);
      expect(result.scoreBonus).toBe(2);
    });

    it('gives +2 bonus at 10:30 (구간 중간)', () => {
      const result = checkVolumeClockWindow(kstTime(10, 30));
      expect(result.allowEntry).toBe(true);
      expect(result.scoreBonus).toBe(2);
    });

    it('gives +2 bonus at 10:59 (구간 끝)', () => {
      const result = checkVolumeClockWindow(kstTime(10, 59));
      expect(result.allowEntry).toBe(true);
      expect(result.scoreBonus).toBe(2);
    });
  });

  // ── 구간 경계 전환 테스트 ──────────────────────────────────────────────────

  describe('구간 경계 전환', () => {
    it('09:29→09:30: 차단 → 패널티 -2 전환', () => {
      expect(checkVolumeClockWindow(kstTime(9, 29)).allowEntry).toBe(false);
      const at0930 = checkVolumeClockWindow(kstTime(9, 30));
      expect(at0930.allowEntry).toBe(true);
      expect(at0930.scoreBonus).toBe(-2);
    });

    it('09:59→10:00: 패널티 -2 → 보너스 +2 전환', () => {
      expect(checkVolumeClockWindow(kstTime(9, 59)).scoreBonus).toBe(-2);
      expect(checkVolumeClockWindow(kstTime(10, 0)).scoreBonus).toBe(2);
    });

    it('10:59→11:00: 보너스 +2 → 패널티 -1 전환', () => {
      expect(checkVolumeClockWindow(kstTime(10, 59)).scoreBonus).toBe(2);
      expect(checkVolumeClockWindow(kstTime(11, 0)).scoreBonus).toBe(-1);
    });

    it('11:29→11:30: 패널티 -1 → 절대 차단(점심) 전환', () => {
      const at1129 = checkVolumeClockWindow(kstTime(11, 29));
      expect(at1129.allowEntry).toBe(true);
      expect(at1129.scoreBonus).toBe(-1);
      expect(checkVolumeClockWindow(kstTime(11, 30)).allowEntry).toBe(false);
    });

    it('13:00→13:01: 절대 차단(점심) → 패널티 -2 전환', () => {
      expect(checkVolumeClockWindow(kstTime(13, 0)).allowEntry).toBe(false);
      const at1301 = checkVolumeClockWindow(kstTime(13, 1));
      expect(at1301.allowEntry).toBe(true);
      expect(at1301.scoreBonus).toBe(-2);
    });

    it('13:14→13:15: 패널티 -2 → 패널티 -1 전환', () => {
      expect(checkVolumeClockWindow(kstTime(13, 14)).scoreBonus).toBe(-2);
      expect(checkVolumeClockWindow(kstTime(13, 15)).scoreBonus).toBe(-1);
    });

    it('13:29→13:30: 패널티 -1 → 보너스 0 전환', () => {
      expect(checkVolumeClockWindow(kstTime(13, 29)).scoreBonus).toBe(-1);
      expect(checkVolumeClockWindow(kstTime(13, 30)).scoreBonus).toBe(0);
    });

    it('14:29→14:30: 보너스 0 → 패널티 -2 전환', () => {
      expect(checkVolumeClockWindow(kstTime(14, 29)).scoreBonus).toBe(0);
      expect(checkVolumeClockWindow(kstTime(14, 30)).scoreBonus).toBe(-2);
    });

    it('14:54→14:55: 패널티 -2 → 절대 차단 전환', () => {
      const at1454 = checkVolumeClockWindow(kstTime(14, 54));
      expect(at1454.allowEntry).toBe(true);
      expect(at1454.scoreBonus).toBe(-2);
      expect(checkVolumeClockWindow(kstTime(14, 55)).allowEntry).toBe(false);
    });
  });

  // ── 비허용 구간 (장 외 시간) ───────────────────────────────────────────────

  it('blocks entry before market open (08:30)', () => {
    const result = checkVolumeClockWindow(kstTime(8, 30));
    expect(result.allowEntry).toBe(false);
    expect(result.scoreBonus).toBe(0);
  });

  it('blocks entry after market close (16:00)', () => {
    const result = checkVolumeClockWindow(kstTime(16, 0));
    expect(result.allowEntry).toBe(false);
  });

  it('blocks entry at 15:31 (마감 직후)', () => {
    const result = checkVolumeClockWindow(kstTime(15, 31));
    expect(result.allowEntry).toBe(false);
  });
});
