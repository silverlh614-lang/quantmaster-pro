// @responsibility toCanonicalRegimeLevel 확장 effective 어휘 → canonical RegimeLevel 정규화 회귀 테스트.
import { describe, it, expect } from 'vitest';
import { REGIME_CONFIGS, toCanonicalRegimeLevel } from './regimeEngine';

describe('toCanonicalRegimeLevel — 확장 effective 어휘 → canonical RegimeLevel 정규화', () => {
  it('확장 R3_NORMAL → canonical R3_EARLY 정규화 (핵심 버그: R4_NEUTRAL clamp 폴백 방지)', () => {
    expect(toCanonicalRegimeLevel('R3_NORMAL')).toBe('R3_EARLY');
  });

  it('확장 R5_STABILIZING → canonical R5_CAUTION 정규화', () => {
    expect(toCanonicalRegimeLevel('R5_STABILIZING')).toBe('R5_CAUTION');
  });

  it('확장 R4_CAUTION → canonical R4_NEUTRAL 정규화', () => {
    expect(toCanonicalRegimeLevel('R4_CAUTION')).toBe('R4_NEUTRAL');
  });

  it('R6 상태기계 어휘 전부 → canonical R6_DEFENSE', () => {
    expect(toCanonicalRegimeLevel('R6_PANIC')).toBe('R6_DEFENSE');
    expect(toCanonicalRegimeLevel('R6_CONFIRMATION_WAIT')).toBe('R6_DEFENSE');
    expect(toCanonicalRegimeLevel('R6_RECOVERY_WATCH')).toBe('R6_DEFENSE');
  });

  it('이미 canonical 인 값은 그대로 통과 (무변경)', () => {
    for (const key of Object.keys(REGIME_CONFIGS)) {
      expect(toCanonicalRegimeLevel(key)).toBe(key);
    }
  });

  it('R1/R2 확장/canonical prefix 도 정규화', () => {
    expect(toCanonicalRegimeLevel('R1_TURBO')).toBe('R1_TURBO');
    expect(toCanonicalRegimeLevel('R2_BULL')).toBe('R2_BULL');
  });

  it('정규화 불가(빈/비문자/미지수 prefix) → undefined (호출부 폴백)', () => {
    expect(toCanonicalRegimeLevel('')).toBeUndefined();
    expect(toCanonicalRegimeLevel(undefined)).toBeUndefined();
    expect(toCanonicalRegimeLevel(null)).toBeUndefined();
    expect(toCanonicalRegimeLevel(123)).toBeUndefined();
    expect(toCanonicalRegimeLevel('SHADOW_ONLY')).toBeUndefined();
    expect(toCanonicalRegimeLevel('GREEN')).toBeUndefined();
    expect(toCanonicalRegimeLevel('R7_UNKNOWN')).toBeUndefined();
  });

  it('정규화 결과는 항상 REGIME_CONFIGS 유효 키 (소비처 clamp 불필요)', () => {
    for (const v of ['R3_NORMAL', 'R5_STABILIZING', 'R6_RECOVERY_WATCH', 'R4_CAUTION']) {
      const canonical = toCanonicalRegimeLevel(v);
      expect(canonical).toBeDefined();
      expect(Object.prototype.hasOwnProperty.call(REGIME_CONFIGS, canonical as string)).toBe(true);
    }
  });
});
