// @responsibility ADR-0641 레짐 값 히스테리시스(effectiveRegime 디바운스) 회귀 검증.
import { describe, expect, it, afterEach } from 'vitest';
import {
  applyRegimeHysteresis,
  isRegimeHysteresisEnabled,
  regimeHysteresisMinDwellMs,
  regimeHysteresisMinConfirmations,
} from './regimeHysteresis.js';

const DWELL = 15 * 60_000; // 15분
const T0 = Date.parse('2026-06-19T06:00:00.000Z');

describe('applyRegimeHysteresis (디바운스)', () => {
  it('변화 없음(computed===confirmed) → pending 클리어, held=false', () => {
    const r = applyRegimeHysteresis({
      computedEffective: 'R4_NEUTRAL', confirmedEffective: 'R4_NEUTRAL',
      pendingRegime: 'R3_EARLY', pendingSince: new Date(T0).toISOString(), pendingCount: 3,
      nowMs: T0 + DWELL, minDwellMs: DWELL, minConfirmations: 2,
    });
    expect(r.held).toBe(false);
    expect(r.effectiveRegime).toBe('R4_NEUTRAL');
    expect(r.pendingRegime).toBeUndefined();
    expect(r.pendingCount).toBe(0);
  });

  it('첫 변화 관측 → hold(확정값 유지), pending 기록', () => {
    const r = applyRegimeHysteresis({
      computedEffective: 'R3_EARLY', confirmedEffective: 'R4_NEUTRAL',
      nowMs: T0, minDwellMs: DWELL, minConfirmations: 2,
    });
    expect(r.held).toBe(true);
    expect(r.effectiveRegime).toBe('R4_NEUTRAL'); // 아직 안 바뀜
    expect(r.pendingRegime).toBe('R3_EARLY');
    expect(r.pendingCount).toBe(1);
  });

  it('같은 후보 dwell+confirmations 충족 → 채택', () => {
    const r = applyRegimeHysteresis({
      computedEffective: 'R3_EARLY', confirmedEffective: 'R4_NEUTRAL',
      pendingRegime: 'R3_EARLY', pendingSince: new Date(T0).toISOString(), pendingCount: 2,
      nowMs: T0 + DWELL, minDwellMs: DWELL, minConfirmations: 2,
    });
    expect(r.held).toBe(false);
    expect(r.effectiveRegime).toBe('R3_EARLY'); // 채택
    expect(r.pendingCount).toBe(0);
  });

  it('dwell 미충족(시간 부족) → 아직 hold', () => {
    const r = applyRegimeHysteresis({
      computedEffective: 'R3_EARLY', confirmedEffective: 'R4_NEUTRAL',
      pendingRegime: 'R3_EARLY', pendingSince: new Date(T0).toISOString(), pendingCount: 5,
      nowMs: T0 + 5 * 60_000, minDwellMs: DWELL, minConfirmations: 2,
    });
    expect(r.held).toBe(true);
    expect(r.effectiveRegime).toBe('R4_NEUTRAL');
  });

  it('교차 flap — confirmed 로 복귀하면 pending 리셋(다음 후보 since 새로 시작)', () => {
    // tick1: R3 후보 기록(since=T0)
    const t1 = applyRegimeHysteresis({
      computedEffective: 'R3_EARLY', confirmedEffective: 'R4_NEUTRAL',
      nowMs: T0, minDwellMs: DWELL, minConfirmations: 2,
    });
    expect(t1.held).toBe(true);
    // tick2(3분 후): computed 가 confirmed(R4)로 복귀 → pending 클리어
    const t2 = applyRegimeHysteresis({
      computedEffective: 'R4_NEUTRAL', confirmedEffective: 'R4_NEUTRAL',
      pendingRegime: t1.pendingRegime, pendingSince: t1.pendingSince, pendingCount: t1.pendingCount,
      nowMs: T0 + 3 * 60_000, minDwellMs: DWELL, minConfirmations: 2,
    });
    expect(t2.pendingRegime).toBeUndefined();
    // tick3(6분 후): R3 다시 → since 새로 시작(T0+6m), 누적 안 됨 → 여전히 hold
    const t3 = applyRegimeHysteresis({
      computedEffective: 'R3_EARLY', confirmedEffective: 'R4_NEUTRAL',
      pendingRegime: t2.pendingRegime, pendingSince: t2.pendingSince, pendingCount: t2.pendingCount,
      nowMs: T0 + 6 * 60_000, minDwellMs: DWELL, minConfirmations: 2,
    });
    expect(t3.held).toBe(true);
    expect(t3.effectiveRegime).toBe('R4_NEUTRAL'); // flap 내내 확정값 유지(안정)
    expect(t3.pendingSince).toBe(new Date(T0 + 6 * 60_000).toISOString());
  });

  it('손상된 pendingSince → elapsed 0 안전 처리(hold)', () => {
    const r = applyRegimeHysteresis({
      computedEffective: 'R3_EARLY', confirmedEffective: 'R4_NEUTRAL',
      pendingRegime: 'R3_EARLY', pendingSince: 'not-a-date', pendingCount: 9,
      nowMs: T0 + DWELL, minDwellMs: DWELL, minConfirmations: 2,
    });
    // sameCandidate=true(문자열)지만 Date.parse 실패 → elapsed 0 → 미확정 hold
    expect(r.held).toBe(true);
  });
});

describe('ENV 가드', () => {
  const keys = ['REGIME_HYSTERESIS_ENABLED', 'REGIME_HYSTERESIS_MIN_DWELL_MIN', 'REGIME_HYSTERESIS_MIN_CONFIRMATIONS'] as const;
  const original: Record<string, string | undefined> = {};
  for (const k of keys) original[k] = process.env[k];
  afterEach(() => {
    for (const k of keys) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it('isRegimeHysteresisEnabled — 미설정 false, =true 만 true', () => {
    delete process.env.REGIME_HYSTERESIS_ENABLED;
    expect(isRegimeHysteresisEnabled()).toBe(false);
    process.env.REGIME_HYSTERESIS_ENABLED = 'true';
    expect(isRegimeHysteresisEnabled()).toBe(true);
    process.env.REGIME_HYSTERESIS_ENABLED = '1';
    expect(isRegimeHysteresisEnabled()).toBe(false);
  });

  it('minDwellMs — 기본 15분·상한 120·음수 fallback', () => {
    delete process.env.REGIME_HYSTERESIS_MIN_DWELL_MIN;
    expect(regimeHysteresisMinDwellMs()).toBe(15 * 60_000);
    process.env.REGIME_HYSTERESIS_MIN_DWELL_MIN = '999';
    expect(regimeHysteresisMinDwellMs()).toBe(120 * 60_000);
    process.env.REGIME_HYSTERESIS_MIN_DWELL_MIN = '-1';
    expect(regimeHysteresisMinDwellMs()).toBe(15 * 60_000);
  });

  it('minConfirmations — 기본 2·하한 1·상한 20', () => {
    delete process.env.REGIME_HYSTERESIS_MIN_CONFIRMATIONS;
    expect(regimeHysteresisMinConfirmations()).toBe(2);
    process.env.REGIME_HYSTERESIS_MIN_CONFIRMATIONS = '0';
    expect(regimeHysteresisMinConfirmations()).toBe(2); // <1 → 기본
    process.env.REGIME_HYSTERESIS_MIN_CONFIRMATIONS = '50';
    expect(regimeHysteresisMinConfirmations()).toBe(20);
  });
});
