// @responsibility ADR-0604 3단계 ENV 가드 회귀 — default OFF·임계 가드.
import { describe, expect, it } from 'vitest';
import {
  isUsOvernightDefenseEnabled,
  resolveUsOvernightDefenseThresholdPct,
  US_OVERNIGHT_DEFENSE_BIAS_PENALTY,
} from './usOvernightDefenseAdr0604.js';

describe('usOvernightDefenseAdr0604', () => {
  it('default OFF (정확 비교) · 임계 -10~-0.5 가드 외 -2.5', () => {
    expect(isUsOvernightDefenseEnabled({})).toBe(false);
    expect(isUsOvernightDefenseEnabled({ US_OVERNIGHT_DEFENSE_ENABLED: 'true' })).toBe(true);
    expect(resolveUsOvernightDefenseThresholdPct({})).toBe(-2.5);
    expect(resolveUsOvernightDefenseThresholdPct({ US_OVERNIGHT_DEFENSE_THRESHOLD_PCT: '-3.5' })).toBe(-3.5);
    expect(resolveUsOvernightDefenseThresholdPct({ US_OVERNIGHT_DEFENSE_THRESHOLD_PCT: '2' })).toBe(-2.5);
    expect(resolveUsOvernightDefenseThresholdPct({ US_OVERNIGHT_DEFENSE_THRESHOLD_PCT: '-50' })).toBe(-2.5);
    expect(US_OVERNIGHT_DEFENSE_BIAS_PENALTY).toBe(12);
  });
});
