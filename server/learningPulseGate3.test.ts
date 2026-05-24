import { describe, expect, it } from 'vitest';
import { formatGate3LearningFinalizationSection } from './quant/gate3CompletionScore.js';

describe('Gate3 Learning Finalization pulse section', () => {
  it('prints outcome, threshold evidence, and completion status for /learning_pulse', () => {
    const text = formatGate3LearningFinalizationSection({
      outcomeSeeds: 11,
      labeled: 4,
      pending: 7,
      dataInsufficient: 0,
      thresholdEvidenceSampleSize: 4,
      suggestions: 1,
      completionScore: 99,
      status: 'COMPLETE',
      marketSignal: false,
    });

    expect(text).toContain('Gate3 Learning Finalization');
    expect(text).toContain('outcomeSeeds: 11');
    expect(text).toContain('labeled: 4');
    expect(text).toContain('pending: 7');
    expect(text).toContain('thresholdEvidenceSampleSize: 4');
    expect(text).toContain('suggestions: 1');
    expect(text).toContain('completionScore: 99');
    expect(text).toContain('status: COMPLETE');
    expect(text).toContain('marketSignal=false');
  });
});
