import { describe, expect, it } from 'vitest';
import { buildFactorContributionScores, type FactorPerformanceStats } from './dynamicWeightFeedback.js';

function stats(overrides: Partial<FactorPerformanceStats>): FactorPerformanceStats {
  return {
    factorName: 'SUPPLY_CONFLUENCE',
    factorGroup: 'GATE2',
    sampleCount: 0,
    liveSampleCount: 0,
    shadowSampleCount: 0,
    counterfactualSampleCount: 0,
    winCount: 0,
    lossCount: 0,
    missedWinCount: 0,
    avoidedLossCount: 0,
    falsePositiveCount: 0,
    trueNegativeCount: 0,
    winRate: null,
    lossRate: null,
    missedWinRate: null,
    avoidedLossRate: null,
    falsePositiveRate: null,
    avgReturn5D: null,
    avgReturn10D: null,
    avgMFE10D: null,
    avgMAE10D: null,
    profitFactorProxy: null,
    expectancyR: null,
    providerIssueSampleCount: 0,
    dataInsufficientExcludedCount: 0,
    ...overrides,
  };
}

describe('ADR-0524 factor contribution score', () => {
  it('marks sampleCount below 30 as INSUFFICIENT_SAMPLE', () => {
    const [score] = buildFactorContributionScores([stats({ sampleCount: 29, winCount: 20 })]);

    expect(score.confidence).toBe('INSUFFICIENT_SAMPLE');
    expect(score.contributionScore).toBeNull();
    expect(score.direction).toBe('INSUFFICIENT');
  });

  it('scores strong aligned factors and assigns confidence by sample size', () => {
    const [score] = buildFactorContributionScores([stats({
      sampleCount: 120,
      winCount: 90,
      lossCount: 5,
      falsePositiveCount: 2,
      trueNegativeCount: 10,
      expectancyR: 1.2,
      falsePositiveRate: 0.02,
      providerIssueSampleCount: 5,
    })]);

    expect(score.confidence).toBe('HIGH');
    expect(score.direction).toBe('POSITIVE');
    expect(score.contributionScore).toBeGreaterThanOrEqual(75);
  });

  it('marks conflicting missed-win and avoided-loss metrics as unstable', () => {
    const [score] = buildFactorContributionScores([stats({
      sampleCount: 80,
      missedWinCount: 30,
      avoidedLossCount: 30,
      missedWinRate: 0.38,
      avoidedLossRate: 0.38,
      expectancyR: 0.1,
      falsePositiveRate: 0,
    })]);

    expect(score.direction).toBe('UNSTABLE');
    expect(score.reason).toContain('CONFLICTING_MISSED_WIN_AND_AVOIDED_LOSS');
  });
});
