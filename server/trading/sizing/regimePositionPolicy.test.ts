import { describe, expect, it } from 'vitest';

import {
  calculateRegimePositionSizing,
  formatKellyRemovedIgnoredLog,
  formatPositionPolicySimpleAppliedLog,
  formatRegimeAdjustmentAppliedLog,
  formatRegimeExecutionAuthorityRemovedLog,
  formatRegimePositionPolicyAppliedLog,
  getRegimeAdjustment,
  getRegimePositionPolicy,
  toPositionPolicyDecision,
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
    expect(getRegimePositionPolicy('R6_DEFENSE').maxGrossExposurePct).toBe(20);
    expect(getRegimePositionPolicy('UNKNOWN').maxPositions).toBe(3);
    expect(getRegimePositionPolicy('UNKNOWN').maxGrossExposurePct).toBe(20);
  });

  it('applies regime as score adjustment only', () => {
    const r6 = getRegimeAdjustment('R6_DEFENSE');
    expect(r6).toMatchObject({
      regime: 'R6_DEFENSE',
      scoreAdjustment: -5,
      confidenceAdjustment: -0.10,
      riskTag: 'REGIME_R6_CONTEXT',
      learningLabel: 'REGIME_R6_OBSERVED',
      executionImpact: 'NONE',
    });
    expect(getRegimeAdjustment('R1_TURBO').scoreAdjustment).toBe(3);
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
    expect(formatRegimePositionPolicyAppliedLog({ snapshotId: 'scan_1', symbol: '005930', sizing }))
      .toContain('[REGIME_POSITION_POLICY_APPLIED]');
    expect(formatRegimeAdjustmentAppliedLog({
      snapshotId: 'scan_1',
      symbol: '005930',
      adjustment: getRegimeAdjustment('R6_DEFENSE'),
    })).toContain('[REGIME_ADJUSTMENT_APPLIED]');
    expect(formatRegimeExecutionAuthorityRemovedLog({
      snapshotId: 'scan_1',
      rawRegime: 'R6_DEFENSE',
      detectedRegime: 'R6_DEFENSE',
      effectiveRegime: 'R6_DEFENSE',
      riskOverride: 'R6_DEFENSE',
    })).toContain('[REGIME_EXECUTION_AUTHORITY_REMOVED]');
    expect(formatKellyRemovedIgnoredLog({ snapshotId: 'scan_1', symbol: '005930', previousKellyValue: 0.01 }))
      .toContain('[KELLY_REMOVED_IGNORED]');
  });
});

describe('ADR-0527 toPositionPolicyDecision — canonical mapping (calculation unchanged)', () => {
  it('maps sizing result to PositionPolicyDecision shape without altering computed values', () => {
    const sizing = calculateRegimePositionSizing({
      regime: 'R2_BULL',
      totalEquity: 10_000_000,
      currentPositions: 2,
    });
    const decision = toPositionPolicyDecision({
      sourceSnapshotId: 'scan-eval:pp',
      symbol: '005930',
      sizing,
    });
    expect(decision.tier).toBe('R2_BULL');
    expect(decision.posPct).toBe(sizing.positionSizePct);
    expect(decision.maxPositions).toBe(sizing.policy.maxPositions);
    expect(decision.maxGrossExposurePct).toBe(sizing.policy.maxGrossExposurePct);
    // 현 정책상 Kelly 비활성 → finalKelly null 고정.
    expect(decision.finalKelly).toBeNull();
    // 호출 맥락 기본 DIAGNOSTIC, executionImpact NONE.
    expect(decision.diagnosticVsLive).toBe('DIAGNOSTIC');
    expect(decision.executionImpact).toBe('NONE');
  });

  it('diagnosticVsLive discriminator is settable by call context', () => {
    const sizing = calculateRegimePositionSizing({ regime: 'R6_DEFENSE', totalEquity: 5_000_000 });
    const live = toPositionPolicyDecision({ sourceSnapshotId: 's', sizing, diagnosticVsLive: 'LIVE' });
    expect(live.diagnosticVsLive).toBe('LIVE');
    expect(live.tier).toBe('R6_DEFENSE');
  });
});
