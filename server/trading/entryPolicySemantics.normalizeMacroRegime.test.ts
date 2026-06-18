// @responsibility ADR-0546 C19 — RegimeLevel↔MacroRegime 사상 SSOT(normalizeMacroRegime) 1:1 회귀 고정.
import { describe, expect, it } from 'vitest';
import { normalizeMacroRegime, resolveMacroRegime } from './entryPolicySemantics.js';

describe('ADR-0546 C19 — normalizeMacroRegime RegimeLevel→MacroRegime 사상 SSOT', () => {
  it('R6_DEFENSE → R6_DEFENSE', () => {
    expect(normalizeMacroRegime('R6_DEFENSE')).toBe('R6_DEFENSE');
  });

  it('R5_CRISIS → R5_CRISIS', () => {
    expect(normalizeMacroRegime('R5_CRISIS')).toBe('R5_CRISIS');
  });

  it('R5_CAUTION(RegimeLevel) → R5_CRISIS', () => {
    expect(normalizeMacroRegime('R5_CAUTION')).toBe('R5_CRISIS');
  });

  it('R4_RISK_OFF → R4_RISK_OFF', () => {
    expect(normalizeMacroRegime('R4_RISK_OFF')).toBe('R4_RISK_OFF');
  });

  it('R4_NEUTRAL(RegimeLevel) → R4_RISK_OFF', () => {
    expect(normalizeMacroRegime('R4_NEUTRAL')).toBe('R4_RISK_OFF');
  });

  it('R3_CAUTION → R3_CAUTION (정규 멤버 보존)', () => {
    expect(normalizeMacroRegime('R3_CAUTION')).toBe('R3_CAUTION');
  });

  it('R3_EARLY(RegimeLevel) → R3_CAUTION', () => {
    expect(normalizeMacroRegime('R3_EARLY')).toBe('R3_CAUTION');
  });

  it('R1_RISK_ON → R1_RISK_ON', () => {
    expect(normalizeMacroRegime('R1_RISK_ON')).toBe('R1_RISK_ON');
  });

  it('R1_TURBO(RegimeLevel) → R1_RISK_ON', () => {
    expect(normalizeMacroRegime('R1_TURBO')).toBe('R1_RISK_ON');
  });

  it('R2_BULL(RegimeLevel) → R1_RISK_ON (주의: R2_NEUTRAL 아님 — 회귀 차단)', () => {
    expect(normalizeMacroRegime('R2_BULL')).toBe('R1_RISK_ON');
  });

  it('R2_NEUTRAL → R2_NEUTRAL (분기 미일치 → default 경유)', () => {
    expect(normalizeMacroRegime('R2_NEUTRAL')).toBe('R2_NEUTRAL');
  });

  it('소문자 r3_early → R3_CAUTION (toUpperCase 정규화)', () => {
    expect(normalizeMacroRegime('r3_early')).toBe('R3_CAUTION');
  });

  it('undefined → R2_NEUTRAL (default)', () => {
    expect(normalizeMacroRegime(undefined)).toBe('R2_NEUTRAL');
  });

  it('null → R2_NEUTRAL', () => {
    expect(normalizeMacroRegime(null)).toBe('R2_NEUTRAL');
  });

  it('미인식 문자열 BOGUS → R2_NEUTRAL', () => {
    expect(normalizeMacroRegime('BOGUS')).toBe('R2_NEUTRAL');
  });
});

describe('ADR-0546 C19 — resolveMacroRegime R3_CAUTION 정규 입력 보존 (제거 금지 회귀 가드)', () => {
  it('resolveMacroRegime([R3_CAUTION]) === R3_CAUTION', () => {
    expect(resolveMacroRegime(['R3_CAUTION'])).toBe('R3_CAUTION');
  });

  it('resolveMacroRegime([R5_CRISIS, R3_CAUTION]) === R5_CRISIS (priority 보존)', () => {
    expect(resolveMacroRegime(['R5_CRISIS', 'R3_CAUTION'])).toBe('R5_CRISIS');
  });
});
