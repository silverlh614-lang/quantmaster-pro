// @responsibility ADR-0659 펀더멘털 floor flag + ROE floor SSOT getter 테스트.

import { afterEach, describe, expect, it } from 'vitest';
import {
  isRiskFundamentalFloorExclusionEnabled,
  getRiskFundamentalRoeFloorPct,
} from './gateConfig.js';

const ORIG_FLAG = process.env.RISK_FUNDAMENTAL_FLOOR_EXCLUSION_ENABLED;
const ORIG_FLOOR = process.env.RISK_FUNDAMENTAL_ROE_FLOOR_PCT;
afterEach(() => {
  if (ORIG_FLAG === undefined) delete process.env.RISK_FUNDAMENTAL_FLOOR_EXCLUSION_ENABLED;
  else process.env.RISK_FUNDAMENTAL_FLOOR_EXCLUSION_ENABLED = ORIG_FLAG;
  if (ORIG_FLOOR === undefined) delete process.env.RISK_FUNDAMENTAL_ROE_FLOOR_PCT;
  else process.env.RISK_FUNDAMENTAL_ROE_FLOOR_PCT = ORIG_FLOOR;
});

describe('isRiskFundamentalFloorExclusionEnabled (ADR-0659)', () => {
  it('미설정 → ON (default kill-switch)', () => {
    delete process.env.RISK_FUNDAMENTAL_FLOOR_EXCLUSION_ENABLED;
    expect(isRiskFundamentalFloorExclusionEnabled()).toBe(true);
  });
  it('=false → OFF', () => {
    process.env.RISK_FUNDAMENTAL_FLOOR_EXCLUSION_ENABLED = 'false';
    expect(isRiskFundamentalFloorExclusionEnabled()).toBe(false);
  });
  it('임의값(true) → ON', () => {
    process.env.RISK_FUNDAMENTAL_FLOOR_EXCLUSION_ENABLED = 'true';
    expect(isRiskFundamentalFloorExclusionEnabled()).toBe(true);
  });
});

describe('getRiskFundamentalRoeFloorPct (ADR-0659)', () => {
  it('미설정 → 기본 -20', () => {
    delete process.env.RISK_FUNDAMENTAL_ROE_FLOOR_PCT;
    expect(getRiskFundamentalRoeFloorPct()).toBe(-20);
  });
  it('유효값 -40 → -40', () => {
    process.env.RISK_FUNDAMENTAL_ROE_FLOOR_PCT = '-40';
    expect(getRiskFundamentalRoeFloorPct()).toBe(-40);
  });
  it('NaN/빈문자 → 기본 -20', () => {
    process.env.RISK_FUNDAMENTAL_ROE_FLOOR_PCT = 'abc';
    expect(getRiskFundamentalRoeFloorPct()).toBe(-20);
    process.env.RISK_FUNDAMENTAL_ROE_FLOOR_PCT = '';
    expect(getRiskFundamentalRoeFloorPct()).toBe(-20);
  });
  it('clamp: 흑자 floor(+30) → 0 상한', () => {
    process.env.RISK_FUNDAMENTAL_ROE_FLOOR_PCT = '30';
    expect(getRiskFundamentalRoeFloorPct()).toBe(0);
  });
  it('clamp: 과도한 음수(-500) → -100 하한', () => {
    process.env.RISK_FUNDAMENTAL_ROE_FLOOR_PCT = '-500';
    expect(getRiskFundamentalRoeFloorPct()).toBe(-100);
  });
});
