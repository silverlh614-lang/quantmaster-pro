// @responsibility twoBarConfirmation 회귀 테스트 — 결정 트리 6 분기 + ENV 롤백 + 헬퍼.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  TWO_BAR_CONSTANTS,
  diffDaysKst,
  evaluateTwoBarConfirmation,
  isTwoBarConfirmationDisabled,
} from './twoBarConfirmation.js';

describe('twoBarConfirmation — 상수 + ENV', () => {
  beforeEach(() => { delete process.env.BEP_TWO_BAR_CONFIRMATION_DISABLED; });
  afterEach(() => { delete process.env.BEP_TWO_BAR_CONFIRMATION_DISABLED; });

  it('GRACE_DAYS = 1', () => {
    expect(TWO_BAR_CONSTANTS.GRACE_DAYS).toBe(1);
  });

  it('ENV DISABLED — true 정확값 만', () => {
    expect(isTwoBarConfirmationDisabled()).toBe(false);
    process.env.BEP_TWO_BAR_CONFIRMATION_DISABLED = 'true';
    expect(isTwoBarConfirmationDisabled()).toBe(true);
    process.env.BEP_TWO_BAR_CONFIRMATION_DISABLED = 'TRUE';
    expect(isTwoBarConfirmationDisabled()).toBe(false);
    process.env.BEP_TWO_BAR_CONFIRMATION_DISABLED = '1';
    expect(isTwoBarConfirmationDisabled()).toBe(false);
  });
});

describe('twoBarConfirmation — diffDaysKst', () => {
  it('정상 일수 차이', () => {
    expect(diffDaysKst('2026-04-28', '2026-04-27')).toBe(1);
    expect(diffDaysKst('2026-04-30', '2026-04-27')).toBe(3);
  });

  it('동일 일자 = 0', () => {
    expect(diffDaysKst('2026-04-28', '2026-04-28')).toBe(0);
  });

  it('과거 일자 음수', () => {
    expect(diffDaysKst('2026-04-27', '2026-04-28')).toBe(-1);
  });

  it('잘못된 ISO 0 fallback', () => {
    expect(diffDaysKst('NOT_A_DATE', '2026-04-28')).toBe(0);
    expect(diffDaysKst('2026-04-28', 'NOT_A_DATE')).toBe(0);
  });
});

describe('twoBarConfirmation — 결정 트리', () => {
  beforeEach(() => { delete process.env.BEP_TWO_BAR_CONFIRMATION_DISABLED; });
  afterEach(() => { delete process.env.BEP_TWO_BAR_CONFIRMATION_DISABLED; });

  const baseInput = {
    currentPrice: 9200,
    stopLoss: 9250,
    entryPrice: 10000,
    entryATR14: 1500,
    isBepProtection: true,
    currentDateKst: '2026-04-28',
  };

  it('ENV DISABLED → PASS', () => {
    process.env.BEP_TWO_BAR_CONFIRMATION_DISABLED = 'true';
    const result = evaluateTwoBarConfirmation(baseInput);
    expect(result.action).toBe('PASS');
    expect(result.reason).toContain('정책 우회');
  });

  it('isBepProtection=false → PASS (즉시 청산 위임)', () => {
    const result = evaluateTwoBarConfirmation({ ...baseInput, isBepProtection: false });
    expect(result.action).toBe('PASS');
    expect(result.reason).toContain('BEP_PROTECTION 분류 아님');
  });

  it('currentPrice 비정상 (NaN) → PASS', () => {
    const result = evaluateTwoBarConfirmation({ ...baseInput, currentPrice: NaN });
    expect(result.action).toBe('PASS');
    expect(result.reason).toContain('비정상');
  });

  it('currentPrice > stopLoss (회복) → RESET', () => {
    const result = evaluateTwoBarConfirmation({ ...baseInput, currentPrice: 9300, stopLoss: 9250 });
    expect(result.action).toBe('RESET');
    expect(result.reason).toContain('회복');
  });

  it('1차 터치 (bepGlideTouchAt 부재) → WAIT + touchAt', () => {
    const result = evaluateTwoBarConfirmation(baseInput);
    expect(result.action).toBe('WAIT');
    expect(result.touchAt).toBe('2026-04-28');
    expect(result.reason).toContain('1차 터치');
  });

  it('1차 터치 당일 재방문 → WAIT + 영속 유지', () => {
    const result = evaluateTwoBarConfirmation({
      ...baseInput,
      bepGlideTouchAt: '2026-04-28',
      currentDateKst: '2026-04-28',
    });
    expect(result.action).toBe('WAIT');
    expect(result.touchAt).toBe('2026-04-28');
    expect(result.reason).toContain('당일');
  });

  it('1차 터치 다음 영업일 (diff=1) → CONFIRM_EXIT', () => {
    const result = evaluateTwoBarConfirmation({
      ...baseInput,
      bepGlideTouchAt: '2026-04-27',
      currentDateKst: '2026-04-28',
    });
    expect(result.action).toBe('CONFIRM_EXIT');
    expect(result.reason).toContain('2개 봉');
  });

  it('1차 터치 1주 후 (diff=7) → CONFIRM_EXIT', () => {
    const result = evaluateTwoBarConfirmation({
      ...baseInput,
      bepGlideTouchAt: '2026-04-21',
      currentDateKst: '2026-04-28',
    });
    expect(result.action).toBe('CONFIRM_EXIT');
  });

  it('정확히 stopLoss 도달 (currentPrice = stopLoss) → WAIT', () => {
    const result = evaluateTwoBarConfirmation({
      ...baseInput,
      currentPrice: 9250,
      stopLoss: 9250,
    });
    expect(result.action).toBe('WAIT');
  });

  it('stopLoss NaN → PASS (안전)', () => {
    const result = evaluateTwoBarConfirmation({ ...baseInput, stopLoss: NaN });
    expect(result.action).toBe('PASS');
  });
});
