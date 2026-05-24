import { describe, expect, it } from 'vitest';
import {
  buildGateAttribution,
  buildWeightFeedbackSamples,
} from './outcomeClosure.js';
import { seed } from './outcomeSeedCreation.test.js';

describe('ADR-0522 weight feedback dataset', () => {
  it('keeps low-sample feedback as insufficient sample', () => {
    const s = { ...seed(), outcomeStatus: 'LABELED' as const, outcomeLabel: 'WIN' as const, finalLearningLabel: 'WIN' as const };
    const attribution = buildGateAttribution(s)!;
    const samples = buildWeightFeedbackSamples(attribution, s, { sampleSize: 5 });

    expect(samples.length).toBeGreaterThan(0);
    expect(samples[0]?.suggestedWeightAction).toBe('INSUFFICIENT_SAMPLE');
  });

  it('suggests policy decrease for over-blocked missed win once sample is sufficient', () => {
    const s = {
      ...seed(),
      decisionType: 'LIVE_BLOCKED' as const,
      blockReasons: ['SELL_ONLY_LIVE_BUY_BLOCKED'],
      outcomeStatus: 'LABELED' as const,
      outcomeLabel: 'MISSED_WIN' as const,
      finalLearningLabel: 'MISSED_WIN' as const,
    };
    const attribution = buildGateAttribution(s)!;
    const policy = buildWeightFeedbackSamples(attribution, s, { sampleSize: 30 })
      .find(sample => sample.factorGroup === 'POLICY');

    expect(policy?.suggestedWeightAction).toBe('DECREASE');
    expect(policy?.reason).toBe('OVER_BLOCK_CANDIDATE');
  });
});
