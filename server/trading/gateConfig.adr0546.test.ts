// @responsibility ADR-0546 C19 — Gate1 R4_NEUTRAL(=5) 분모 폴백 + flag OFF legacy 70 byte-equivalent 회귀.
import { afterEach, describe, expect, it } from 'vitest';
import {
  GATE1_SCORE_SCALE,
  clearRuntimeThresholdDelta,
  getEffectiveGateThreshold,
  getRegimeAwareGate1RequiredScore,
  resolveGate1RequiredScore,
} from './gateConfig.js';

describe('ADR-0546 C19 — Gate1 regime fallback (R4_NEUTRAL=5) byte-equivalent', () => {
  const ORIGINAL = process.env.GATE1_REGIME_AWARE_REQUIRED;

  afterEach(() => {
    clearRuntimeThresholdDelta();
    if (ORIGINAL === undefined) delete process.env.GATE1_REGIME_AWARE_REQUIRED;
    else process.env.GATE1_REGIME_AWARE_REQUIRED = ORIGINAL;
  });

  it('getEffectiveGateThreshold(undefined) === R4_NEUTRAL normal(5)', () => {
    expect(getEffectiveGateThreshold(undefined)).toBe(5);
    expect(getEffectiveGateThreshold(undefined)).toBe(getEffectiveGateThreshold('R4_NEUTRAL'));
  });

  it('getRegimeAwareGate1RequiredScore(undefined) === 50 (5 × GATE1_SCORE_SCALE)', () => {
    expect(getRegimeAwareGate1RequiredScore(undefined)).toBe(50);
    expect(getRegimeAwareGate1RequiredScore(undefined)).toBe(
      getEffectiveGateThreshold('R4_NEUTRAL') * GATE1_SCORE_SCALE,
    );
  });

  it('미지원 regime 문자열도 R4_NEUTRAL(5)로 폴백', () => {
    expect(getEffectiveGateThreshold('R9_BOGUS')).toBe(5);
  });

  it('resolveGate1RequiredScore(undefined) — flag OFF 면 legacy 70 (폴백과 무관)', () => {
    delete process.env.GATE1_REGIME_AWARE_REQUIRED;
    expect(resolveGate1RequiredScore(undefined)).toBe(70);
  });
});
