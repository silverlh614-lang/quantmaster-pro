import { describe, expect, it } from 'vitest';
import { addConfidence, emptyDataConfidenceSummary } from './screenerDataConfidence.js';

describe('screenerDataConfidence', () => {
  it('keeps AI estimated confidence separate from verified', () => {
    let summary = emptyDataConfidenceSummary();
    summary = addConfidence(summary, 'VERIFIED');
    summary = addConfidence(summary, 'AI_ESTIMATED');
    expect(summary.verified).toBe(1);
    expect(summary.aiEstimated).toBe(1);
  });
});
