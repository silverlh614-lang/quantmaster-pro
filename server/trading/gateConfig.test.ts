// @responsibility ADR-0546 Gate1 required-score SSOT regression tests (flag off/on)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GATE1_SCORE_SCALE,
  LEGACY_GATE1_REQUIRED_SCORE,
  getEffectiveGateThreshold,
  getRegimeAwareGate1RequiredScore,
  isGate1RegimeAwareRequiredEnabled,
  resolveGate1RequiredScore,
} from './gateConfig.js';

describe('ADR-0546 Gate1 required-score SSOT', () => {
  const ORIGINAL = process.env.GATE1_REGIME_AWARE_REQUIRED;

  beforeEach(() => {
    delete process.env.GATE1_REGIME_AWARE_REQUIRED;
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.GATE1_REGIME_AWARE_REQUIRED;
    else process.env.GATE1_REGIME_AWARE_REQUIRED = ORIGINAL;
  });

  it('LEGACY_GATE1_REQUIRED_SCORE는 70, GATE1_SCORE_SCALE는 10으로 고정', () => {
    expect(LEGACY_GATE1_REQUIRED_SCORE).toBe(70);
    expect(GATE1_SCORE_SCALE).toBe(10);
  });

  it('플래그 미설정(기본)이면 비활성', () => {
    expect(isGate1RegimeAwareRequiredEnabled()).toBe(false);
  });

  it('플래그 OFF면 레짐과 무관하게 항상 레거시 70 반환 (동작 보존)', () => {
    expect(resolveGate1RequiredScore('R3_EARLY')).toBe(70);
    expect(resolveGate1RequiredScore('R4_NEUTRAL')).toBe(70);
    expect(resolveGate1RequiredScore('R6_DEFENSE')).toBe(70);
    expect(resolveGate1RequiredScore(undefined)).toBe(70);
  });

  it('플래그 ON이면 R3_EARLY는 getEffectiveGateThreshold×10 반환 (40~60 밴드)', () => {
    process.env.GATE1_REGIME_AWARE_REQUIRED = 'true';
    const expected = getEffectiveGateThreshold('R3_EARLY') * GATE1_SCORE_SCALE;
    expect(resolveGate1RequiredScore('R3_EARLY')).toBe(expected);
    expect(expected).toBeGreaterThanOrEqual(40);
    expect(expected).toBeLessThanOrEqual(60);
  });

  it('getRegimeAwareGate1RequiredScore는 플래그와 무관하게 항상 레짐값(섀도 관측용)', () => {
    // 플래그 OFF 상태에서도 레짐 인식값은 계산되어야 한다 (병행 로깅).
    const regimeAware = getRegimeAwareGate1RequiredScore('R3_EARLY');
    expect(regimeAware).toBe(getEffectiveGateThreshold('R3_EARLY') * GATE1_SCORE_SCALE);
    expect(resolveGate1RequiredScore('R3_EARLY')).toBe(70); // applied는 여전히 레거시
  });

  it("플래그 값이 정확히 'true'가 아니면 비활성 (안전 기본)", () => {
    process.env.GATE1_REGIME_AWARE_REQUIRED = '1';
    expect(resolveGate1RequiredScore('R3_EARLY')).toBe(70);
    process.env.GATE1_REGIME_AWARE_REQUIRED = 'TRUE';
    expect(resolveGate1RequiredScore('R3_EARLY')).toBe(70);
  });
});
