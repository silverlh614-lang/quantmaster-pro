import { describe, expect, it } from 'vitest';
import { checkVolumeClockWindow } from './volumeClock.js';

/** 주어진 KST 시:분으로 UTC Date를 생성하는 헬퍼 */
function kstTime(hour: number, minute: number): Date {
  // KST = UTC + 9h
  return new Date(Date.UTC(2026, 0, 12, hour - 9, minute));
}

describe('checkVolumeClockWindow', () => {
  // ── 허용 구간 ────────────────────────────────────────────────────────────────

  it('allows entry in core 10:00~11:30 window', () => {
    // 10:30 is inside the 10:00~11:00 prime window → +2 bonus
    const result = checkVolumeClockWindow(kstTime(10, 30));
    expect(result.allowEntry).toBe(true);
    expect(result.scoreBonus).toBe(2);
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

  it('allows entry in 13:30~14:50 afternoon window', () => {
    const result = checkVolumeClockWindow(kstTime(14, 20));
    expect(result.allowEntry).toBe(true);
    expect(result.scoreBonus).toBe(0);
  });

  it('allows entry at 13:30 (new window start)', () => {
    const result = checkVolumeClockWindow(kstTime(13, 30));
    expect(result.allowEntry).toBe(true);
    expect(result.scoreBonus).toBe(0);
  });

  // ── 초반 개장 구간 (-1 패널티) ───────────────────────────────────────────────

  it('allows entry at 09:30 with -1 gate penalty', () => {
    const result = checkVolumeClockWindow(kstTime(9, 30));
    expect(result.allowEntry).toBe(true);
    expect(result.scoreBonus).toBe(-1);
  });

  it('allows entry at 09:45 with -1 gate penalty', () => {
    const result = checkVolumeClockWindow(kstTime(9, 45));
    expect(result.allowEntry).toBe(true);
    expect(result.scoreBonus).toBe(-1);
  });

  it('allows entry at 09:59 with -1 gate penalty (last minute of penalty zone)', () => {
    const result = checkVolumeClockWindow(kstTime(9, 59));
    expect(result.allowEntry).toBe(true);
    expect(result.scoreBonus).toBe(-1);
  });

  it('gives +2 bonus (not penalty) at exactly 10:00', () => {
    const result = checkVolumeClockWindow(kstTime(10, 0));
    expect(result.allowEntry).toBe(true);
    expect(result.scoreBonus).toBe(2);
  });

  // ── 차단 구간 ────────────────────────────────────────────────────────────────

  it('blocks entry at 09:00 (시초가 결정 구간)', () => {
    const result = checkVolumeClockWindow(kstTime(9, 0));
    expect(result.allowEntry).toBe(false);
    expect(result.scoreBonus).toBe(0);
  });

  it('blocks entry at 09:15 (시초가 결정 구간 내부)', () => {
    const result = checkVolumeClockWindow(kstTime(9, 15));
    expect(result.allowEntry).toBe(false);
  });

  it('blocks entry in 14:55~15:30 closing volatility window', () => {
    const result = checkVolumeClockWindow(kstTime(15, 0));
    expect(result.allowEntry).toBe(false);
  });

  it('blocks entry at 14:55 (마감 변동성 시작)', () => {
    const result = checkVolumeClockWindow(kstTime(14, 55));
    expect(result.allowEntry).toBe(false);
  });

  // ── 비허용 구간 (차단도 허용도 아님) ─────────────────────────────────────────

  it('blocks entry in 11:31~13:29 thin volume gap (e.g. 12:00)', () => {
    const result = checkVolumeClockWindow(kstTime(12, 0));
    expect(result.allowEntry).toBe(false);
    expect(result.scoreBonus).toBe(0);
  });

  it('blocks entry at 11:31 (갭 구간 시작)', () => {
    const result = checkVolumeClockWindow(kstTime(11, 31));
    expect(result.allowEntry).toBe(false);
  });

  it('blocks entry at 14:51 (허용 구간 종료 직후)', () => {
    const result = checkVolumeClockWindow(kstTime(14, 51));
    expect(result.allowEntry).toBe(false);
  });

  it('blocks entry before market open (e.g. 08:30)', () => {
    const result = checkVolumeClockWindow(kstTime(8, 30));
    expect(result.allowEntry).toBe(false);
  });
});
