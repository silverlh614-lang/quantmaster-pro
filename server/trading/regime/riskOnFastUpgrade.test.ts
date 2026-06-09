// @responsibility ADR-0593 riskOnFastUpgrade 순수 SSOT 진리표 — 3중 AND 각 축 / flag OFF / breadth·intraday 부재 / 임계 경계값.
import { describe, expect, it, afterEach } from 'vitest';
import {
  shouldFastUpgradeToR3Early,
  isRegimeRiskOnFastUpgradeEnabled,
  regimeRiskOnFastUpgradeThresholdPct,
  regimeRiskOnFastUpgradeBreadthMinRatio,
} from './riskOnFastUpgrade.js';

afterEach(() => {
  delete process.env.REGIME_RISK_ON_FAST_UPGRADE_ENABLED;
  delete process.env.REGIME_RISK_ON_FAST_UPGRADE_THRESHOLD_PCT;
  delete process.env.REGIME_RISK_ON_FAST_UPGRADE_BREADTH_MIN_RATIO;
});

const FULL = { kospiDayReturnToday: 4.0, vkospiDayChange: -2, marketBreadthAdvanceRatio: 0.7 };

describe('ADR-0593 shouldFastUpgradeToR3Early', () => {
  it('flag OFF (default) → 항상 false (byte-equivalent)', () => {
    expect(isRegimeRiskOnFastUpgradeEnabled()).toBe(false);
    expect(shouldFastUpgradeToR3Early(FULL)).toBe(false);
  });

  it('flag ON + 3중 AND 전부 충족 → true', () => {
    process.env.REGIME_RISK_ON_FAST_UPGRADE_ENABLED = 'true';
    expect(shouldFastUpgradeToR3Early(FULL)).toBe(true);
  });

  it('① 오늘 강반등 미달(< T) → false', () => {
    process.env.REGIME_RISK_ON_FAST_UPGRADE_ENABLED = 'true';
    expect(shouldFastUpgradeToR3Early({ ...FULL, kospiDayReturnToday: 3.0 })).toBe(false);
  });

  it('① intraday today 부재(undefined) → false (보수, falling-knife 방지)', () => {
    process.env.REGIME_RISK_ON_FAST_UPGRADE_ENABLED = 'true';
    expect(shouldFastUpgradeToR3Early({ ...FULL, kospiDayReturnToday: undefined })).toBe(false);
  });

  it('② VKOSPI 진정 위반(> 0, 공포 확산) → false', () => {
    process.env.REGIME_RISK_ON_FAST_UPGRADE_ENABLED = 'true';
    expect(shouldFastUpgradeToR3Early({ ...FULL, vkospiDayChange: 0.5 })).toBe(false);
  });

  it('② VKOSPI 경계값(== 0) → 충족(true)', () => {
    process.env.REGIME_RISK_ON_FAST_UPGRADE_ENABLED = 'true';
    expect(shouldFastUpgradeToR3Early({ ...FULL, vkospiDayChange: 0 })).toBe(true);
  });

  it('③ breadth 부재(undefined) → false (보수, 불변식 #6 결손≠signal)', () => {
    process.env.REGIME_RISK_ON_FAST_UPGRADE_ENABLED = 'true';
    expect(shouldFastUpgradeToR3Early({ ...FULL, marketBreadthAdvanceRatio: undefined })).toBe(false);
  });

  it('③ breadth 열위(< 0.6) → false', () => {
    process.env.REGIME_RISK_ON_FAST_UPGRADE_ENABLED = 'true';
    expect(shouldFastUpgradeToR3Early({ ...FULL, marketBreadthAdvanceRatio: 0.55 })).toBe(false);
  });

  it('임계 경계값: today == T(3.5), breadth == 0.6 → 충족(true, >= 비교)', () => {
    process.env.REGIME_RISK_ON_FAST_UPGRADE_ENABLED = 'true';
    expect(shouldFastUpgradeToR3Early({ kospiDayReturnToday: 3.5, vkospiDayChange: -1, marketBreadthAdvanceRatio: 0.6 })).toBe(true);
  });

  it('ENV 임계 오버라이드 적용 (T=4.0 → 3.6 미달)', () => {
    process.env.REGIME_RISK_ON_FAST_UPGRADE_ENABLED = 'true';
    process.env.REGIME_RISK_ON_FAST_UPGRADE_THRESHOLD_PCT = '4.0';
    expect(regimeRiskOnFastUpgradeThresholdPct()).toBe(4.0);
    expect(shouldFastUpgradeToR3Early({ ...FULL, kospiDayReturnToday: 3.6 })).toBe(false);
    expect(shouldFastUpgradeToR3Early({ ...FULL, kospiDayReturnToday: 4.0 })).toBe(true);
  });

  it('ENV breadth ratio 오버라이드 적용 (0.7 → 0.65 미달)', () => {
    process.env.REGIME_RISK_ON_FAST_UPGRADE_ENABLED = 'true';
    process.env.REGIME_RISK_ON_FAST_UPGRADE_BREADTH_MIN_RATIO = '0.7';
    expect(regimeRiskOnFastUpgradeBreadthMinRatio()).toBe(0.7);
    expect(shouldFastUpgradeToR3Early({ ...FULL, marketBreadthAdvanceRatio: 0.65 })).toBe(false);
    expect(shouldFastUpgradeToR3Early({ ...FULL, marketBreadthAdvanceRatio: 0.7 })).toBe(true);
  });

  it('잘못된 ENV 임계 → default(3.5/0.6) 폴백', () => {
    process.env.REGIME_RISK_ON_FAST_UPGRADE_THRESHOLD_PCT = 'abc';
    process.env.REGIME_RISK_ON_FAST_UPGRADE_BREADTH_MIN_RATIO = '2';
    expect(regimeRiskOnFastUpgradeThresholdPct()).toBe(3.5);
    expect(regimeRiskOnFastUpgradeBreadthMinRatio()).toBe(0.6);
  });

  it('비유한 입력(NaN) → 보수적 false', () => {
    process.env.REGIME_RISK_ON_FAST_UPGRADE_ENABLED = 'true';
    expect(shouldFastUpgradeToR3Early({ ...FULL, vkospiDayChange: NaN })).toBe(false);
    expect(shouldFastUpgradeToR3Early({ ...FULL, kospiDayReturnToday: NaN })).toBe(false);
  });
});
