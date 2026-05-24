import { describe, expect, it } from 'vitest';
import {
  buildSuggestedWeightActions,
  DEFAULT_FACTOR_REGISTRY,
  type FactorContributionScore,
  type FactorPerformanceStats,
} from './dynamicWeightFeedback.js';

function stat(factorName: string, sampleCount: number, overrides: Partial<FactorPerformanceStats> = {}): FactorPerformanceStats {
  return {
    factorName,
    factorGroup: 'GATE2',
    sampleCount,
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

function score(factorName: string, contributionScore: number | null, confidence: FactorContributionScore['confidence'] = 'HIGH'): FactorContributionScore {
  return {
    factorName,
    factorGroup: 'GATE2',
    contributionScore,
    confidence,
    direction: contributionScore == null ? 'INSUFFICIENT' : contributionScore >= 75 ? 'POSITIVE' : contributionScore < 40 ? 'NEGATIVE' : 'NEUTRAL',
    reason: ['test'],
  };
}

describe('ADR-0524 suggested weight action', () => {
  it('uses NEEDS_REVIEW when contribution is high but sampleCount is below 100', () => {
    const [action] = buildSuggestedWeightActions({
      stats: [stat('SUPPLY_CONFLUENCE', 80)],
      scores: [score('SUPPLY_CONFLUENCE', 82, 'MEDIUM')],
    }).filter(item => item.factorName === 'SUPPLY_CONFLUENCE');

    expect(action.suggestedAction).toBe('NEEDS_REVIEW');
    expect(action.proposedWeight).toBe(action.currentWeight);
    expect(action.approvalRequired).toBe(true);
  });

  it('suggests increase without mutating current weight when sample evidence is strong', () => {
    const before = DEFAULT_FACTOR_REGISTRY.find(def => def.factorName === 'SUPPLY_CONFLUENCE')!.currentWeight;
    const [action] = buildSuggestedWeightActions({
      stats: [stat('SUPPLY_CONFLUENCE', 120)],
      scores: [score('SUPPLY_CONFLUENCE', 78)],
    }).filter(item => item.factorName === 'SUPPLY_CONFLUENCE');

    expect(action.suggestedAction).toBe('INCREASE');
    expect(action.proposedWeight).toBeGreaterThan(action.currentWeight);
    expect(DEFAULT_FACTOR_REGISTRY.find(def => def.factorName === 'SUPPLY_CONFLUENCE')!.currentWeight).toBe(before);
  });

  it('quarantines high false-positive or provider contaminated factors', () => {
    const [action] = buildSuggestedWeightActions({
      stats: [stat('TECHNICAL_TREND', 120, { falsePositiveRate: 0.5, falsePositiveCount: 60 })],
      scores: [score('TECHNICAL_TREND', 32)],
    }).filter(item => item.factorName === 'TECHNICAL_TREND');

    expect(action.suggestedAction).toBe('QUARANTINE');
  });

  it('does not promote AI_ESTIMATED factors even with strong score', () => {
    const [action] = buildSuggestedWeightActions({
      stats: [stat('AI_ESTIMATED_FUNDAMENTAL', 130)],
      scores: [score('AI_ESTIMATED_FUNDAMENTAL', 88)],
    }).filter(item => item.factorName === 'AI_ESTIMATED_FUNDAMENTAL');

    expect(action.suggestedAction).toBe('NEEDS_REVIEW');
    expect(action.reason).toContain('AI_ESTIMATED_FACTOR_CANNOT_PROMOTE_STAGE');
  });
});
