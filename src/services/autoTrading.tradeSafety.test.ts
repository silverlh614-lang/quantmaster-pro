import { describe, expect, it } from 'vitest';
import {
  isDailyLossLimitReached,
  isMaxPositionsReached,
  checkTradeSafety,
  DAILY_MAX_LOSS_RATE,
  MAX_POSITIONS,
} from './autoTrading/tradeSafety';

// ─── isDailyLossLimitReached ─────────────────────────────────────────────────

describe('isDailyLossLimitReached — 일일 손실 한도 확인', () => {
  it('손실 0%: 한도 미달 → false', () => {
    expect(isDailyLossLimitReached(0)).toBe(false);
  });

  it(`임계값 경계(${DAILY_MAX_LOSS_RATE * 100}%): 정확히 일치 → true (한도 도달)`, () => {
    expect(isDailyLossLimitReached(DAILY_MAX_LOSS_RATE)).toBe(true);
  });

  it('임계값 초과(-4%): true', () => {
    expect(isDailyLossLimitReached(-0.04)).toBe(true);
  });

  it('임계값 미달(-2.9%): false', () => {
    expect(isDailyLossLimitReached(-0.029)).toBe(false);
  });

  it('수익 상황(+2%): false', () => {
    expect(isDailyLossLimitReached(0.02)).toBe(false);
  });
});

// ─── isMaxPositionsReached ───────────────────────────────────────────────────

describe('isMaxPositionsReached — 최대 보유 종목 수 확인', () => {
  it('0종목: false', () => {
    expect(isMaxPositionsReached(0)).toBe(false);
  });

  it(`경계값 미만(${MAX_POSITIONS - 1}종목): false`, () => {
    expect(isMaxPositionsReached(MAX_POSITIONS - 1)).toBe(false);
  });

  it(`경계값 정확히(${MAX_POSITIONS}종목): true (한도 도달)`, () => {
    expect(isMaxPositionsReached(MAX_POSITIONS)).toBe(true);
  });

  it(`경계값 초과(${MAX_POSITIONS + 1}종목): true`, () => {
    expect(isMaxPositionsReached(MAX_POSITIONS + 1)).toBe(true);
  });
});

// ─── checkTradeSafety ────────────────────────────────────────────────────────

describe('checkTradeSafety — 종합 안전 체크', () => {
  const safeOpts = {
    todayPnLRate: 0,
    currentPositionCount: 2,
    mhs: 55,
  };

  it('모든 조건 정상: blocked=false', () => {
    const result = checkTradeSafety(safeOpts);
    expect(result.blocked).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('MHS < 30 (DEFENSE 모드): blocked=true, reason에 "DEFENSE" 포함', () => {
    const result = checkTradeSafety({ ...safeOpts, mhs: 25 });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('DEFENSE');
    expect(result.reason).toContain('25');
  });

  it('MHS = 29 (경계 미달): blocked=true', () => {
    const result = checkTradeSafety({ ...safeOpts, mhs: 29 });
    expect(result.blocked).toBe(true);
  });

  it('MHS = 30 (경계 통과): DEFENSE 조건은 blocked=false', () => {
    // MHS 30 → DEFENSE 조건 통과, 손실 없고 종목 수 정상
    const result = checkTradeSafety({ ...safeOpts, mhs: 30 });
    expect(result.blocked).toBe(false);
  });

  it('일일 손실 한도 초과: blocked=true, reason에 손실률 포함', () => {
    const result = checkTradeSafety({ ...safeOpts, todayPnLRate: -0.04 });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('%');
  });

  it(`최대 보유 종목 수(${MAX_POSITIONS}) 초과: blocked=true, reason에 종목 수 포함`, () => {
    const result = checkTradeSafety({ ...safeOpts, currentPositionCount: MAX_POSITIONS });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain(String(MAX_POSITIONS));
  });

  it('MHS가 가장 먼저 체크됨 (손실/종목 동시 초과해도 DEFENSE 이유 반환)', () => {
    const result = checkTradeSafety({
      todayPnLRate: -0.05,
      currentPositionCount: MAX_POSITIONS + 2,
      mhs: 10,
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('DEFENSE');
  });

  it('손실 한도는 종목 수보다 먼저 체크됨 (손실 초과 + 종목 초과 → 손실 이유)', () => {
    const result = checkTradeSafety({
      todayPnLRate: -0.04,
      currentPositionCount: MAX_POSITIONS + 1,
      mhs: 50,
    });
    expect(result.blocked).toBe(true);
    // 손실 한도가 먼저이므로 DEFENSE 메시지는 없고 손실 관련 reason
    expect(result.reason).not.toContain('DEFENSE');
    expect(result.reason).toContain('%');
  });
});
