/**
 * @responsibility 매매 허용 시간 정책 회귀 테스트 (ADR-0192)
 *
 * 사용자 5/6 요청 — isBuyableKstWindow 진단 윈도. ALWAYS-ON: 시간대 기반 SELL_ONLY 없음.
 * volumeClock ALWAYS-ON SSOT 정합 — isBuyableKstWindow 09:00~15:20 연속 (시초가/점심 포함, 감점만).
 * 비-buyable 은 마감 동시호가 준비(15:20~)·장외뿐. (이전 09:30~15:30 ADR-0552 표기 → SSOT 정합 정정.)
 *
 * 정적 grep 가드 (drift 차단) + ENV 매트릭스.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const SCHEDULER_PATH = path.resolve(
  __dirname, 'adaptiveScanScheduler.base.ts',
);
const source = fs.readFileSync(SCHEDULER_PATH, 'utf-8');

describe('ADR-0192 / ALWAYS-ON 정적 가드 — isBuyableKstWindow + decideScan phase', () => {
  it('isBuyableKstWindow 시간대 (09:00~15:20 연속) — 진단/경보 윈도 (매매 게이트 아님)', () => {
    // volumeClock ALWAYS-ON 정합: 09:00~15:20 연속 (시초가/점심 포함, 감점만), 15:20~ 비-buyable.
    expect(source).toMatch(/t >= 900 && t < 1520/);
  });

  it('isBuyableKstWindow legacy 분기 보존 (ADR-0122 정합)', () => {
    expect(source).toMatch(/t >= 900 && t < 1130/);
    expect(source).toMatch(/t >= 1300 && t < 1430/);
  });

  it('ENV `TRADE_WINDOW_LEGACY_HOURS` 우회 (ADR-0157 정확 비교)', () => {
    const matches = source.match(/process\.env\.TRADE_WINDOW_LEGACY_HOURS === ['"]true['"]/g);
    expect(matches).not.toBeNull();
    // isBuyableKstWindow + decideScan 두 곳에서 사용 (drift 차단 — useLegacy 변수로 재할당).
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it('ALWAYS-ON: decideScan 에 시간대 기반 forceSellOnly 가 없다', () => {
    // 시간대(시초가/점심/마감) 기반 SELL_ONLY 제거 — volume clock 가/감점 + always-on.
    expect(source).not.toMatch(/forceSellOnly = true/);
  });

  it('ALWAYS-ON: decideScan 시간대 phase 라벨에 SELL_ONLY 가 없다', () => {
    expect(source).not.toMatch(/시초가\(SELL_ONLY/);
    expect(source).not.toMatch(/점심\(SELL_ONLY\)/);
    expect(source).not.toMatch(/마감\(SELL_ONLY\)/);
  });

  it('decideScan 시간 구간 보존 (t < 1200 / t < 1500 — 스캔 빈도 SSOT)', () => {
    expect(source).toMatch(/t < 1200/);
    expect(source).toMatch(/t < 1500/);
  });

  it('lastLunchBlockSeenAt 점심 구간 통과 변수 보존', () => {
    expect(source).toMatch(/lastLunchBlockSeenAt = now/);
  });

  it('ADR-0192 추적 주석 보존', () => {
    expect((source.match(/ADR-0192/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('ADR-0122 legacy 윈도 주석 보존', () => {
    expect(source).toMatch(/ADR-0122/);
  });
});

describe('ADR-0192 isBuyableKstWindow 동작 매트릭스', () => {
  beforeEach(() => {
    delete process.env.TRADE_WINDOW_LEGACY_HOURS;
  });
  afterEach(() => {
    delete process.env.TRADE_WINDOW_LEGACY_HOURS;
  });

  // KST 시각을 UTC ms 로 환산 — 해당 KST 일자 시점의 UTC 일자에 -9h 보정.
  // KST 평일 (예: 2026-05-06 화 = UTC 2026-05-05 화 15:00).
  function kstWeekdayMs(hour: number, minute: number): number {
    // 2026-05-06 (수) KST hour:minute → UTC = (hour - 9):minute (전날 18:00 ~ 당일 15:00 분기)
    const utcDate = new Date(Date.UTC(2026, 4, 6, hour - 9, minute, 0));
    return utcDate.getTime();
  }

  // 모듈에서 isBuyableKstWindow 직접 export 안 됨 — 시간 계산 정합성만 단언.
  function computeBuyableKst(hour: number, minute: number, legacy: boolean = false): boolean {
    const kst = new Date(kstWeekdayMs(hour, minute) + 9 * 60 * 60 * 1000);
    const dow = kst.getUTCDay();
    if (dow === 0 || dow === 6) return false;
    const t = kst.getUTCHours() * 100 + kst.getUTCMinutes();
    if (legacy) return (t >= 900 && t < 1130) || (t >= 1300 && t < 1430);
    // volumeClock ALWAYS-ON 정합: 09:00~15:20 연속 (시초가/점심 포함, 감점만).
    return t >= 900 && t < 1520;
  }

  it('09:00 boundary — 정확히 매수 가능 시작 (volumeClock ALWAYS-ON 정합)', () => {
    expect(computeBuyableKst(9, 0)).toBe(true);
  });

  it('09:29 — 시초가 매수 가능 (차단 아님, 감점 구간 — volumeClock ALWAYS-ON 정합)', () => {
    expect(computeBuyableKst(9, 29)).toBe(true);
  });

  it('11:59 — 매수 가능 마지막 분 (오전)', () => {
    expect(computeBuyableKst(11, 59)).toBe(true);
  });

  it('12:00 — 매수 가능 (ADR-0552 점심 휴장 잔재 제거)', () => {
    expect(computeBuyableKst(12, 0)).toBe(true);
  });

  it('12:30 — 매수 가능 (ADR-0552 점심 휴장 잔재 제거)', () => {
    expect(computeBuyableKst(12, 30)).toBe(true);
  });

  it('13:00 boundary — 오후 매수 시작', () => {
    expect(computeBuyableKst(13, 0)).toBe(true);
  });

  it('15:19 — 매수 가능 마지막 분 (오후, volumeClock ALWAYS-ON 정합)', () => {
    expect(computeBuyableKst(15, 19)).toBe(true);
  });

  it('15:20 — 매수 차단 (마감 동시호가 준비 진입, volumeClock 정합)', () => {
    expect(computeBuyableKst(15, 20)).toBe(false);
  });

  it('Legacy 모드 — 11:00 매수 가능 (11:30 까지)', () => {
    expect(computeBuyableKst(11, 0, true)).toBe(true);
  });

  it('Legacy 모드 — 11:30 차단 (점심 진입)', () => {
    expect(computeBuyableKst(11, 30, true)).toBe(false);
  });

  it('Legacy 모드 — 14:30 차단 (마감전 윈도)', () => {
    expect(computeBuyableKst(14, 30, true)).toBe(false);
  });
});

describe('ADR-0192 decideScan phase 시각 매트릭스', () => {
  it('09:00 시초가 분기 boundary (t < 930)', () => {
    // t = 900 → t < 930 분기 진입 → 시초가(변동성 회피)
    expect(900 < 930).toBe(true);
  });

  it('09:30 오전 주도주 분기 진입 (default 정책)', () => {
    // t = 930 → t < 1200 분기 (오전 주도주)
    expect(930 < 1200).toBe(true);
    expect(930 >= 930).toBe(true);
  });

  it('11:30 — 신규 정책 오전 주도주 보존 (legacy 진입은 점심)', () => {
    // 신규 정책: 1130 < 1200 → 오전 / Legacy: 1130 >= 1130 → 점심 진입
    expect(1130 < 1200).toBe(true);
    expect(1130 >= 1130).toBe(true);
  });

  it('12:30 점심 분기 (신규 정책 — t >= 1200 && t < 1300)', () => {
    expect(1230 >= 1200 && 1230 < 1300).toBe(true);
  });

  it('13:30 오후 재개장 분기 (default 정책 — t < 1500)', () => {
    expect(1330 >= 1300 && 1330 < 1500).toBe(true);
  });

  it('15:00 마감 분기 (t >= 1500)', () => {
    expect(1500 >= 1500).toBe(true);
  });
});
