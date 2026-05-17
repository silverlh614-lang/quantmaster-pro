import { describe, expect, it } from 'vitest';
import { aiEstimatedFact, originalFact, parsedFact, summarizeDataConfidence } from './dartDataConfidence.js';

describe('summarizeDataConfidence', () => {
  it('DART 원문 직접 필드만 VERIFIED로 집계하고 AI는 AI_ESTIMATED로 분리한다', () => {
    const summary = summarizeDataConfidence([
      originalFact('disclosureId', '접수번호', '202601010001'),
      parsedFact('amount', '금액', 1000, 'KRW'),
      aiEstimatedFact('meaning', '의미', 'positive'),
    ]);
    expect(summary.verified).toBe(2);
    expect(summary.aiEstimated).toBe(1);
  });
});
