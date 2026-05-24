import { describe, expect, it } from 'vitest';
import { buildMissedWinFactors } from './dynamicWeightFeedback.js';
import { repeatSamples } from './dynamicWeightFeedbackFixtures.js';

describe('ADR-0524 missed-win analysis', () => {
  it('surfaces over-block and setup factors associated with missed winners', () => {
    const factors = buildMissedWinFactors([
      ...repeatSamples('MISSED_WIN', 30, {
        engineMode: 'SELL_ONLY',
        gate2AxisScores: { SUPPLY_CONFLUENCE: 92 },
        gate3ComponentScores: { lastTrigger: 45, volumeConfirmation: 50 },
      }),
      ...repeatSamples('AVOIDED_LOSS', 10, {
        engineMode: 'SELL_ONLY',
        gate2AxisScores: { TECHNICAL_TREND: 30 },
      }),
    ]);

    expect(factors).toContain('SELL_ONLY_BLOCK');
    expect(factors).toContain('SUPPLY_CONFLUENCE');
    expect(factors).toContain('LAST_TRIGGER');
  });

  it('ignores pending samples because they are not feedback-ready', () => {
    const factors = buildMissedWinFactors([
      ...repeatSamples('MISSED_WIN', 5, { pending: true }),
      ...repeatSamples('WIN', 5),
    ]);

    expect(factors).not.toContain('SELL_ONLY_BLOCK');
  });
});
