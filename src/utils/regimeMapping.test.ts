/**
 * @responsibility deriveRegimeLevel 매핑 단위 테스트 — ADR-0028 §1
 */
import { describe, it, expect } from 'vitest';
import { deriveRegimeLevel } from './regimeMapping';

describe('deriveRegimeLevel — ADR-0028 6레짐 매핑', () => {
  it('bearRegime=BEAR → R6_DEFENSE (최우선)', () => {
    expect(deriveRegimeLevel(
      { tradeRegime: 'BULL_AGGRESSIVE', macroHealthScore: 90 },
      { regime: 'BEAR' },
      15,
    )).toBe('R6_DEFENSE');
  });

  it('bearRegime=TRANSITION → R5_CAUTION', () => {
    expect(deriveRegimeLevel(
      { tradeRegime: 'BULL_NORMAL', macroHealthScore: 60 },
      { regime: 'TRANSITION' },
      20,
    )).toBe('R5_CAUTION');
  });

  it('gate0.tradeRegime=DEFENSE → R6_DEFENSE (bearRegime BULL 도 무시 안 됨, gate0 우선)', () => {
    expect(deriveRegimeLevel(
      { tradeRegime: 'DEFENSE', macroHealthScore: 25 },
      { regime: 'BULL' },
      20,
    )).toBe('R6_DEFENSE');
  });

  it('gate0.tradeRegime=BULL_AGGRESSIVE → R1_TURBO', () => {
    expect(deriveRegimeLevel(
      { tradeRegime: 'BULL_AGGRESSIVE', macroHealthScore: 80 },
      { regime: 'BULL' },
      15,
    )).toBe('R1_TURBO');
  });

  it('gate0.tradeRegime=BULL_NORMAL + MHS≥60 → R2_BULL', () => {
    expect(deriveRegimeLevel(
      { tradeRegime: 'BULL_NORMAL', macroHealthScore: 65 },
      null,
      18,
    )).toBe('R2_BULL');
  });

  it('gate0.tradeRegime=BULL_NORMAL + MHS<60 → R3_EARLY (선행 신호 구간)', () => {
    expect(deriveRegimeLevel(
      { tradeRegime: 'BULL_NORMAL', macroHealthScore: 55 },
      null,
      20,
    )).toBe('R3_EARLY');
  });

  it('gate0.tradeRegime=NEUTRAL → R4_NEUTRAL', () => {
    expect(deriveRegimeLevel(
      { tradeRegime: 'NEUTRAL', macroHealthScore: 40 },
      null,
      22,
    )).toBe('R4_NEUTRAL');
  });

  it('gate0 부재 + VKOSPI≥30 → R5_CAUTION', () => {
    expect(deriveRegimeLevel(null, null, 32)).toBe('R5_CAUTION');
  });

  it('gate0 부재 + VKOSPI 정상 → R4_NEUTRAL (기본값)', () => {
    expect(deriveRegimeLevel(null, null, 18)).toBe('R4_NEUTRAL');
  });

  it('모든 인자 부재 → R4_NEUTRAL (기본값)', () => {
    expect(deriveRegimeLevel()).toBe('R4_NEUTRAL');
  });

  it('VKOSPI=NaN → R4_NEUTRAL (안전 fallback)', () => {
    expect(deriveRegimeLevel(null, null, NaN)).toBe('R4_NEUTRAL');
  });
});
