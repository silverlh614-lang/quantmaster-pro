import { describe, expect, it } from 'vitest';
import { buildFactorPerformanceStats } from './dynamicWeightFeedback.js';
import { repeatSamples, sampleSeed } from './dynamicWeightFeedbackFixtures.js';

describe('ADR-0524 factor performance stats', () => {
  it('excludes pending, data-insufficient, quarantined, and stale samples from predictive stats', () => {
    const seeds = [
      ...repeatSamples('WIN', 3, { gate2AxisScores: { SUPPLY_CONFLUENCE: 90 } }),
      sampleSeed('WIN', { pending: true, gate2AxisScores: { SUPPLY_CONFLUENCE: 90 } }),
      sampleSeed('WIN', { priceDataHealth: 'STALE', gate2AxisScores: { SUPPLY_CONFLUENCE: 90 } }),
    ];

    const stats = buildFactorPerformanceStats({ seeds });
    const supply = stats.find(stat => stat.factorName === 'SUPPLY_CONFLUENCE');

    expect(supply?.sampleCount).toBe(3);
    expect(supply?.winCount).toBe(3);
    expect(supply?.dataInsufficientExcludedCount).toBe(2);
  });

  it('separates live, shadow, counterfactual, provider issue, and return metrics', () => {
    const seeds = [
      sampleSeed('WIN', { symbol: 'LIVE1', gate2AxisScores: { SUPPLY_CONFLUENCE: 90 } }),
      sampleSeed('WIN', { symbol: 'SHADOW1', engineMode: 'SHADOW_ONLY', gate2AxisScores: { SUPPLY_CONFLUENCE: 90 } }),
      sampleSeed('MISSED_WIN', { symbol: 'BLOCK1', gate2AxisScores: { SUPPLY_CONFLUENCE: 90 }, providerIssue: true }),
    ];

    const supply = buildFactorPerformanceStats({ seeds }).find(stat => stat.factorName === 'SUPPLY_CONFLUENCE');

    expect(supply?.liveSampleCount).toBe(1);
    expect(supply?.shadowSampleCount).toBe(1);
    expect(supply?.counterfactualSampleCount).toBe(1);
    expect(supply?.providerIssueSampleCount).toBe(1);
    expect(supply?.avgReturn10D).not.toBeNull();
    expect(supply?.profitFactorProxy).not.toBeNull();
  });
});
