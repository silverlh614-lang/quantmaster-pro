import { describe, it, expect } from 'vitest';
import { applyAttributionCalibrationGuardrail } from './attributionCalibrationGuardrail.js';

const base = {
  conditionKey: 'momentum', regime: 'R2_BULL', winRate: 20, sharpe: -0.5,
  dataConfidence: 'VERIFIED' as const, executionMode: 'NORMAL' as const, source: 'LIVE' as const,
  currentWeight: 1.0, proposedWeight: 0.1,
};

describe('attributionCalibrationGuardrail', () => {
  it('sampleSize 8 blocks core and keeps weight', () => {
    const r = applyAttributionCalibrationGuardrail({ ...base, sampleSize: 8, monthsUnderperforming: 1 });
    expect(r.coreWritable).toBe(false); expect(r.approvedWeight).toBe(1.0);
  });
  it('sampleSize 50 allows candidate only and clamps to 0.9', () => {
    const r = applyAttributionCalibrationGuardrail({ ...base, sampleSize: 50, monthsUnderperforming: 2 });
    expect(r.coreWritable).toBe(false); expect(r.candidateWritable).toBe(true); expect(r.approvedWeight).toBeGreaterThanOrEqual(0.9);
  });
  it('sampleSize 150 maxDelta 0.2', () => {
    const r = applyAttributionCalibrationGuardrail({ ...base, sampleSize: 150, monthsUnderperforming: 2 });
    expect(r.maxDeltaApplied).toBeLessThanOrEqual(0.2);
  });
  it('shadow never writes core', () => {
    expect(applyAttributionCalibrationGuardrail({ ...base, sampleSize: 300, monthsUnderperforming: 2, source: 'SHADOW' }).coreWritable).toBe(false);
  });
  it('sell_only never writes core', () => {
    expect(applyAttributionCalibrationGuardrail({ ...base, sampleSize: 300, monthsUnderperforming: 2, executionMode: 'SELL_ONLY' }).coreWritable).toBe(false);
  });
  it('degraded confidence never writes core', () => {
    expect(applyAttributionCalibrationGuardrail({ ...base, sampleSize: 300, monthsUnderperforming: 2, dataConfidence: 'DEGRADED' }).coreWritable).toBe(false);
  });
  it('1 month underperform does not suspend', () => {
    const r = applyAttributionCalibrationGuardrail({ ...base, sampleSize: 300, monthsUnderperforming: 1 });
    expect(r.decision.includes('SUSPEND')).toBe(false);
  });
  it('3 months poor allows suspend candidate only', () => {
    const r = applyAttributionCalibrationGuardrail({ ...base, sampleSize: 300, monthsUnderperforming: 3 });
    expect(r.decision).toBe('SUSPEND_CANDIDATE');
  });
  it('critical one-month no drop to 0.1', () => {
    const r = applyAttributionCalibrationGuardrail({ ...base, sampleSize: 300, monthsUnderperforming: 1 });
    expect(r.approvedWeight).toBeGreaterThan(0.1);
  });
});
