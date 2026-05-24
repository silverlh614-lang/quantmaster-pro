import { describe, expect, it } from 'vitest';
import {
  buildFactorPerformanceStats,
  buildFalsePositiveFactors,
} from './dynamicWeightFeedback.js';
import { repeatSamples } from './dynamicWeightFeedbackFixtures.js';

describe('ADR-0524 false-positive analysis', () => {
  it('ranks factors that repeatedly appear in losses and false positives', () => {
    const stats = buildFactorPerformanceStats({
      seeds: [
        ...repeatSamples('LOSS', 25, {
          gate2AxisScores: { TECHNICAL_TREND: 90, SUPPLY_CONFLUENCE: 40 },
          gate3ComponentScores: { volumeConfirmation: 95, priceConfirmation: 80 },
        }),
        ...repeatSamples('FALSE_POSITIVE', 20, {
          gate2AxisScores: { TECHNICAL_TREND: 88 },
          gate3ComponentScores: { volumeConfirmation: 92 },
        }),
        ...repeatSamples('WIN', 10, {
          gate2AxisScores: { SUPPLY_CONFLUENCE: 90 },
          gate3ComponentScores: { priceConfirmation: 90 },
        }),
      ],
    });

    const factors = buildFalsePositiveFactors(stats);
    expect(factors[0]).toBe('TECHNICAL_TREND');
    expect(factors).toContain('VOLUME_CONFIRMATION');
  });

  it('does not rank factors with no negative labeled evidence', () => {
    const stats = buildFactorPerformanceStats({
      seeds: repeatSamples('WIN', 40, {
        gate2AxisScores: { SUPPLY_CONFLUENCE: 90 },
      }),
    });

    expect(buildFalsePositiveFactors(stats)).not.toContain('SUPPLY_CONFLUENCE');
  });
});
