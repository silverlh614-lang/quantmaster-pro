import { describe, expect, it } from 'vitest';
import { checkVolumeClockWindow } from './volumeClock.js';

/** 주어진 KST 시:분으로 UTC Date를 생성하는 헬퍼 */
function kstTime(hour: number, minute: number): Date {
  // KST = UTC + 9h
  return new Date(Date.UTC(2026, 0, 12, hour - 9, minute));
}

describe('checkVolumeClockWindow', () => {
  it('allows entry in 10:00~11:30 window', () => {
    const result = checkVolumeClockWindow(kstTime(10, 30));
    expect(result.allowEntry).toBe(true);
  });

  it('gives +2 score bonus in 10:00~11:00 prime window', () => {
    const result = checkVolumeClockWindow(kstTime(10, 0));
    expect(result.allowEntry).toBe(true);
    expect(result.scoreBonus).toBe(2);
  });

  it('gives no bonus in 11:01~11:30 (outside prime window)', () => {
    const result = checkVolumeClockWindow(kstTime(11, 15));
    expect(result.allowEntry).toBe(true);
    expect(result.scoreBonus).toBe(0);
  });

  it('allows entry in 14:00~14:50 window', () => {
    const result = checkVolumeClockWindow(kstTime(14, 20));
    expect(result.allowEntry).toBe(true);
    expect(result.scoreBonus).toBe(0);
  });

  it('blocks entry in 09:00~09:59 noise window', () => {
    const result = checkVolumeClockWindow(kstTime(9, 30));
    expect(result.allowEntry).toBe(false);
    expect(result.scoreBonus).toBe(0);
  });

  it('blocks entry in 14:55~15:30 closing volatility window', () => {
    const result = checkVolumeClockWindow(kstTime(15, 0));
    expect(result.allowEntry).toBe(false);
  });

  it('blocks entry outside all allowed windows (e.g. 12:00)', () => {
    const result = checkVolumeClockWindow(kstTime(12, 0));
    expect(result.allowEntry).toBe(false);
    expect(result.scoreBonus).toBe(0);
  });

  it('blocks entry at market open before 09:00 (e.g. 08:30)', () => {
    const result = checkVolumeClockWindow(kstTime(8, 30));
    expect(result.allowEntry).toBe(false);
  });
});
