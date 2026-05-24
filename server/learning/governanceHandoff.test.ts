import { describe, expect, it } from 'vitest';
import {
  buildGovernanceReviewItems,
  buildSuggestedWeightActions,
  type FactorContributionScore,
  type FactorPerformanceStats,
} from './dynamicWeightFeedback.js';

function stat(factorName: string, overrides: Partial<FactorPerformanceStats> = {}): FactorPerformanceStats {
  return {
    factorName,
    factorGroup: 'GATE2',
    sampleCount: 120,
    liveSampleCount: 0,
    shadowSampleCount: 120,
    counterfactualSampleCount: 0,
    winCount: 110,
    lossCount: 10,
    missedWinCount: 0,
    avoidedLossCount: 0,
    falsePositiveCount: 0,
    trueNegativeCount: 0,
    winRate: 0.92,
    lossRate: 0.08,
    missedWinRate: 0,
    avoidedLossRate: 0,
    falsePositiveRate: 0,
    avgReturn5D: 4,
    avgReturn10D: 7,
    avgMFE10D: 8,
    avgMAE10D: -2,
    profitFactorProxy: 4,
    expectancyR: 1.2,
    providerIssueSampleCount: 0,
    dataInsufficientExcludedCount: 0,
    ...overrides,
  };
}

function score(factorName: string, overrides: Partial<FactorContributionScore> = {}): FactorContributionScore {
  return {
    factorName,
    factorGroup: 'GATE2',
    contributionScore: 82,
    confidence: 'HIGH',
    direction: 'POSITIVE',
    reason: ['fixture'],
    ...overrides,
  };
}

describe('ADR-0524 governance handoff', () => {
  it('creates approval-required review items and never allows auto-apply', () => {
    const actions = buildSuggestedWeightActions({
      stats: [stat('SUPPLY_CONFLUENCE'), stat('TECHNICAL_TREND', { falsePositiveRate: 0.6, falsePositiveCount: 70, winCount: 10, lossCount: 50 })],
      scores: [
        score('SUPPLY_CONFLUENCE'),
        score('TECHNICAL_TREND', { contributionScore: 32, direction: 'NEGATIVE' }),
      ],
    });

    const items = buildGovernanceReviewItems(actions);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every(item => item.approvalRequired)).toBe(true);
    expect(items.every(item => item.autoApplyAllowed === false)).toBe(true);
    expect(items.find(item => item.factorName === 'SUPPLY_CONFLUENCE')?.risk).toBe('LOW');
    expect(items.find(item => item.factorName === 'TECHNICAL_TREND')?.suggestedAction).toBe('QUARANTINE');
  });

  it('keeps insufficient and keep actions out of governance review', () => {
    const actions = buildSuggestedWeightActions({
      stats: [stat('SUPPLY_CONFLUENCE', { sampleCount: 20 })],
      scores: [score('SUPPLY_CONFLUENCE', {
        contributionScore: null,
        confidence: 'INSUFFICIENT_SAMPLE',
        direction: 'INSUFFICIENT',
      })],
    });

    expect(buildGovernanceReviewItems(actions)).toHaveLength(0);
  });
});
