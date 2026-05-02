/**
 * @responsibility ADR-0170 §M4 회귀 — mapInternalToExposureRegimeWithMacro + applyExposureBudgetCap macro 분기
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  isExposureRegimeAutoMappingDisabled,
  mapInternalToExposureRegime,
  mapInternalToExposureRegimeWithMacro,
} from './regimeExposurePolicy.js';

const ORIGINAL_DISABLED = process.env.EXPOSURE_REGIME_AUTO_MAPPING_DISABLED;
const ORIGINAL_BUDGET = process.env.POSITION_SIZING_EXPOSURE_BUDGET_ENABLED;

afterEach(() => {
  if (ORIGINAL_DISABLED === undefined) delete process.env.EXPOSURE_REGIME_AUTO_MAPPING_DISABLED;
  else process.env.EXPOSURE_REGIME_AUTO_MAPPING_DISABLED = ORIGINAL_DISABLED;
  if (ORIGINAL_BUDGET === undefined) delete process.env.POSITION_SIZING_EXPOSURE_BUDGET_ENABLED;
  else process.env.POSITION_SIZING_EXPOSURE_BUDGET_ENABLED = ORIGINAL_BUDGET;
});

describe('ADR-0170 §1 isExposureRegimeAutoMappingDisabled', () => {
  it('미설정 → false (default ON)', () => {
    delete process.env.EXPOSURE_REGIME_AUTO_MAPPING_DISABLED;
    expect(isExposureRegimeAutoMappingDisabled()).toBe(false);
  });

  it('"true" → true (비활성)', () => {
    process.env.EXPOSURE_REGIME_AUTO_MAPPING_DISABLED = 'true';
    expect(isExposureRegimeAutoMappingDisabled()).toBe(true);
  });

  it('"false" → false', () => {
    process.env.EXPOSURE_REGIME_AUTO_MAPPING_DISABLED = 'false';
    expect(isExposureRegimeAutoMappingDisabled()).toBe(false);
  });

  it('"1" → false (정확히 "true" 만)', () => {
    process.env.EXPOSURE_REGIME_AUTO_MAPPING_DISABLED = '1';
    expect(isExposureRegimeAutoMappingDisabled()).toBe(false);
  });
});

describe('ADR-0170 §2 mapInternalToExposureRegimeWithMacro 결정 트리', () => {
  beforeEach(() => {
    delete process.env.EXPOSURE_REGIME_AUTO_MAPPING_DISABLED;
  });

  describe('ENV 비활성 fallback', () => {
    it('DISABLED=true → 기존 매핑 (R5_CAUTION 격상 안 됨)', () => {
      process.env.EXPOSURE_REGIME_AUTO_MAPPING_DISABLED = 'true';
      expect(
        mapInternalToExposureRegimeWithMacro('R5_CAUTION', { bearDefenseMode: true, vix: 50 }),
      ).toBe('R2_WEAK');
    });

    it('DISABLED=true + R6_DEFENSE → R0_CRISIS (기존 매핑 보존)', () => {
      process.env.EXPOSURE_REGIME_AUTO_MAPPING_DISABLED = 'true';
      expect(mapInternalToExposureRegimeWithMacro('R6_DEFENSE', { bearDefenseMode: true })).toBe('R0_CRISIS');
    });
  });

  describe('R6_DEFENSE 매크로 무관', () => {
    it('R6_DEFENSE → R0_CRISIS (매크로 신호 무시)', () => {
      expect(mapInternalToExposureRegimeWithMacro('R6_DEFENSE', { bearDefenseMode: false, vix: 10 })).toBe('R0_CRISIS');
    });
  });

  describe('R5_CAUTION + 매크로 신호 → R1_DEFENSIVE 격상', () => {
    it('우선순위 1: bearDefenseMode=true → R1_DEFENSIVE', () => {
      expect(mapInternalToExposureRegimeWithMacro('R5_CAUTION', { bearDefenseMode: true })).toBe('R1_DEFENSIVE');
    });

    it('우선순위 2: vix>30 → R1_DEFENSIVE', () => {
      expect(mapInternalToExposureRegimeWithMacro('R5_CAUTION', { vix: 35 })).toBe('R1_DEFENSIVE');
    });

    it('우선순위 2: vkospi>30 → R1_DEFENSIVE', () => {
      expect(mapInternalToExposureRegimeWithMacro('R5_CAUTION', { vkospi: 32 })).toBe('R1_DEFENSIVE');
    });

    it('우선순위 3: vix>25 + dailyLossPct<-3 → R1_DEFENSIVE', () => {
      expect(
        mapInternalToExposureRegimeWithMacro('R5_CAUTION', { vix: 27, dailyLossPct: -3.5 }),
      ).toBe('R1_DEFENSIVE');
    });

    it('boundary: vix=30 (≤30) → 기존 매핑 R2_WEAK', () => {
      expect(mapInternalToExposureRegimeWithMacro('R5_CAUTION', { vix: 30 })).toBe('R2_WEAK');
    });

    it('boundary: vkospi=30 → 기존 매핑 R2_WEAK', () => {
      expect(mapInternalToExposureRegimeWithMacro('R5_CAUTION', { vkospi: 30 })).toBe('R2_WEAK');
    });

    it('vix=26 + dailyLossPct=-2 → 기존 매핑 (loss 미달)', () => {
      expect(
        mapInternalToExposureRegimeWithMacro('R5_CAUTION', { vix: 26, dailyLossPct: -2 }),
      ).toBe('R2_WEAK');
    });

    it('vix=27 + dailyLossPct=-3 (boundary) → 기존 매핑', () => {
      expect(
        mapInternalToExposureRegimeWithMacro('R5_CAUTION', { vix: 27, dailyLossPct: -3 }),
      ).toBe('R2_WEAK');
    });

    it('vix=24 + dailyLossPct=-5 → 기존 매핑 (vix 미달)', () => {
      expect(
        mapInternalToExposureRegimeWithMacro('R5_CAUTION', { vix: 24, dailyLossPct: -5 }),
      ).toBe('R2_WEAK');
    });

    it('NaN/undefined 안전 fallback', () => {
      expect(
        mapInternalToExposureRegimeWithMacro('R5_CAUTION', { vix: NaN, vkospi: NaN, bearDefenseMode: false }),
      ).toBe('R2_WEAK');
    });

    it('macro 부재 → 기존 매핑', () => {
      expect(mapInternalToExposureRegimeWithMacro('R5_CAUTION')).toBe('R2_WEAK');
      expect(mapInternalToExposureRegimeWithMacro('R5_CAUTION', undefined)).toBe('R2_WEAK');
    });
  });

  describe('R5_CAUTION 외 레짐 — 매크로 신호 무관', () => {
    it('R3_EARLY + bearDefenseMode=true → R4_RECOVERY (격상 안 됨)', () => {
      expect(
        mapInternalToExposureRegimeWithMacro('R3_EARLY', { bearDefenseMode: true }),
      ).toBe('R4_RECOVERY');
    });

    it('R4_NEUTRAL + vix=50 → R3_NEUTRAL (격상 안 됨)', () => {
      expect(
        mapInternalToExposureRegimeWithMacro('R4_NEUTRAL', { vix: 50 }),
      ).toBe('R3_NEUTRAL');
    });

    it('R1_TURBO + bearDefenseMode=true → R6_STRONG_BULL (강세 보호)', () => {
      expect(
        mapInternalToExposureRegimeWithMacro('R1_TURBO', { bearDefenseMode: true }),
      ).toBe('R6_STRONG_BULL');
    });
  });

  describe('우선순위 충돌 — 첫 매칭 적용', () => {
    it('bearDefenseMode + vix>30 동시 → bearDefenseMode (우선순위 1)', () => {
      expect(
        mapInternalToExposureRegimeWithMacro('R5_CAUTION', { bearDefenseMode: true, vix: 50 }),
      ).toBe('R1_DEFENSIVE');
    });

    it('vix=27 + vkospi=33 → vkospi 우선순위 2 매칭 (R1_DEFENSIVE)', () => {
      expect(
        mapInternalToExposureRegimeWithMacro('R5_CAUTION', { vix: 27, vkospi: 33 }),
      ).toBe('R1_DEFENSIVE');
    });
  });

  describe('mapInternalToExposureRegime (기존) 무회귀', () => {
    it('R5_CAUTION → R2_WEAK (매크로 미적용)', () => {
      expect(mapInternalToExposureRegime('R5_CAUTION')).toBe('R2_WEAK');
    });

    it('R6_DEFENSE → R0_CRISIS', () => {
      expect(mapInternalToExposureRegime('R6_DEFENSE')).toBe('R0_CRISIS');
    });

    it('R1_TURBO → R6_STRONG_BULL', () => {
      expect(mapInternalToExposureRegime('R1_TURBO')).toBe('R6_STRONG_BULL');
    });
  });
});
