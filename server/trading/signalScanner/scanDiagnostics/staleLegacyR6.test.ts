// @responsibility Truth-table tests for the shared stale legacy-R6 leak-block decision SSOT.
import { describe, expect, it } from 'vitest';
import { resolveStaleLegacyR6 } from './staleLegacyR6.js';

describe('resolveStaleLegacyR6 — leak-block 결정 SSOT (ADR-0531)', () => {
  it('non-R6: legacy 그대로, staleLegacyR6=false', () => {
    expect(resolveStaleLegacyR6({
      legacyEffectiveRegime: 'R3_EARLY',
      displayRegime: 'R3_EARLY',
      regime: 'R3_EARLY',
      rawRegime: 'R3_EARLY',
    })).toEqual({ effectiveRegime: 'R3_EARLY', staleLegacyR6: false });
  });

  it('stale-R6 누출(legacy=R6 인데 display/regime≠R6, raw 회복): raw 로 차단', () => {
    expect(resolveStaleLegacyR6({
      legacyEffectiveRegime: 'R6_DEFENSE',
      displayRegime: 'SHADOW_ONLY',
      regime: 'R4_NEUTRAL',
      rawRegime: 'R4_NEUTRAL',
    })).toEqual({ effectiveRegime: 'R4_NEUTRAL', staleLegacyR6: true });
  });

  it('genuine R6(raw 도 R6): raw=R6 보존, staleLegacyR6=true(조건 충족)', () => {
    expect(resolveStaleLegacyR6({
      legacyEffectiveRegime: 'R6_DEFENSE',
      displayRegime: 'SHADOW_ONLY',
      regime: 'R4_NEUTRAL',
      rawRegime: 'R6_DEFENSE',
    })).toEqual({ effectiveRegime: 'R6_DEFENSE', staleLegacyR6: true });
  });

  it('display 가 R6 를 인지하면 stale 아님 → legacy 그대로', () => {
    expect(resolveStaleLegacyR6({
      legacyEffectiveRegime: 'R6_DEFENSE',
      displayRegime: 'R6_DEFENSE',
      regime: 'R4_NEUTRAL',
      rawRegime: 'R6_DEFENSE',
    })).toEqual({ effectiveRegime: 'R6_DEFENSE', staleLegacyR6: false });
  });

  it('실행 regime 이 R6 면 stale 아님 → legacy 그대로', () => {
    expect(resolveStaleLegacyR6({
      legacyEffectiveRegime: 'R6_DEFENSE',
      displayRegime: 'SHADOW_ONLY',
      regime: 'R6_DEFENSE',
      rawRegime: 'R6_DEFENSE',
    })).toEqual({ effectiveRegime: 'R6_DEFENSE', staleLegacyR6: false });
  });

  it('regime undefined 도 R6 아님으로 취급 → stale 차단 적용', () => {
    expect(resolveStaleLegacyR6({
      legacyEffectiveRegime: 'R6_DEFENSE',
      displayRegime: 'SHADOW_ONLY',
      regime: undefined,
      rawRegime: 'R4_NEUTRAL',
    })).toEqual({ effectiveRegime: 'R4_NEUTRAL', staleLegacyR6: true });
  });
});
