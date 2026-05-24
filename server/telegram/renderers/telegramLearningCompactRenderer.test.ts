import { describe, expect, it } from 'vitest';
import { renderLearningCompact } from './learningCompactRenderer.js';
import { sampleBundle } from './telegramGateCompactRenderer.test.js';

describe('ADR-0523 Telegram learning compact renderer', () => {
  it('compresses outcome closure and attribution into operator summary lines', () => {
    const text = renderLearningCompact(sampleBundle());

    expect(text).toContain('[Learning]');
    expect(text).toContain('seeds: +24 / pending 88 / labeled 36');
    expect(text).toContain('labels: WIN 8 | LOSS 5 | MISSED 6 | AVOIDED 9 | DATA 8');
    expect(text).toContain('topPositive: SUPPLY_CONFLUENCE');
    expect(text).toContain('topOverBlock: R6_DEFENSE');
    expect(text).toContain('impact: NONE');
  });

  it('keeps the optional weight feedback line compact and operator-facing', () => {
    const text = renderLearningCompact(sampleBundle({
      learning: {
        ...sampleBundle().learning!,
        feedbackLine: '[Feedback] topUp Supply | topDown Volume | review 3 | impact NONE',
      },
    }));

    expect(text).toContain('[Feedback] topUp Supply | topDown Volume | review 3 | impact NONE');
    expect(text).toContain('impact: NONE');
  });
});
