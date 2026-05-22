import { describe, expect, it } from 'vitest';

import {
  calculateRegimePositionSizing,
  formatKellyRemovedIgnoredLog,
  formatPositionPolicySimpleAppliedLog,
  getRegimePositionPolicy,
} from './regimePositionPolicy.js';

describe('regimePositionPolicy — Simplification Step 2', () => {
  it('R2_BULL ignores Kelly and sizes at 10%', () => {
    const policy = getRegimePositionPolicy('R2_BULL');
    expect(policy.maxPositions).toBe(6);
    expect(policy.maxGrossExposurePct).toBe(60);
    expect(policy.perPositionPct).toBe(10);
  });

  it('low Kelly cannot block a valid buy decision sizing path', () => {
    const sizing = calculateRegimePositionSizing({
      regime: 'R2_BULL',
      totalEquity: 10_000_000,
      currentPositions: 5,
    });
    expect(sizing.remainingSlots).toBe(1);
    expect(sizing.positionSizePct).toBe(10);
    expect(sizing.positionAmount).toBe(1_000_000);
    expect(sizing.kellyDisabled).toBe(true);
  });

  it('R5/R6 use 20% gross exposure across 3 positions', () => {
    expect(getRegimePositionPolicy('R5_STABILIZING').perPositionPct).toBe(6.67);
    expect(getRegimePositionPolicy('R5_CAUTION').perPositionPct).toBe(6.67);
    expect(getRegimePositionPolicy('R6_DEFENSE').perPositionPct).toBe(6.67);
    expect(getRegimePositionPolicy('R6_DEFENSE').maxPositions).toBe(3);
  });

  it('slot full is represented by remainingSlots=0 while preserving counterfactual eligibility', () => {
    const sizing = calculateRegimePositionSizing({
      regime: 'R3_EARLY',
      totalEquity: 5_000_000,
      currentPositions: 5,
    });
    expect(sizing.policy.maxPositions).toBe(5);
    expect(sizing.remainingSlots).toBe(0);
    expect(sizing.positionSizePct).toBe(10);
  });

  it('shadow position amount uses the same regime policy', () => {
    const sizing = calculateRegimePositionSizing({
      regime: 'R5_STABILIZING',
      totalEquity: 5_000_000,
      currentPositions: 1,
    });
    expect(Math.round(sizing.positionAmount)).toBe(333_500);
  });

  it('emits required forensic logs without making Kelly actionable', () => {
    const sizing = calculateRegimePositionSizing({
      regime: 'R5_STABILIZING',
      totalEquity: 5_000_000,
      currentPositions: 1,
    });
    expect(formatPositionPolicySimpleAppliedLog({ snapshotId: 'scan_1', symbol: '005930', sizing }))
      .toContain('[POSITION_POLICY_SIMPLE_APPLIED]');
    expect(formatKellyRemovedIgnoredLog({ snapshotId: 'scan_1', symbol: '005930', previousKellyValue: 0.01 }))
      .toContain('[KELLY_REMOVED_IGNORED]');
  });
});
