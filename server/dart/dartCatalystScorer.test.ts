import { describe, expect, it } from 'vitest';
import { parsedFact } from './dartDataConfidence.js';
import { scoreDartCatalyst } from './dartCatalystScorer.js';

describe('scoreDartCatalyst', () => {
  it('매출대비 대규모 계약에 높은 advisory score를 준다', () => {
    const result = scoreDartCatalyst({
      category: 'STRUCTURAL_POSITIVE',
      facts: [parsedFact('salesRatio', '매출대비', 55, '%'), parsedFact('amount', '계약금액', 200_000_000_000, 'KRW')],
      reasons: ['PASS_DART_LARGE_CONTRACT'],
      risks: [],
      parserFailed: false,
    });
    expect(result.catalystScore).toBeGreaterThanOrEqual(80);
    expect(result.riskScore).toBe(0);
  });

  it('본문 파싱 실패 시 score를 과도하게 부여하지 않는다', () => {
    const result = scoreDartCatalyst({
      category: 'STRUCTURAL_POSITIVE',
      facts: [],
      reasons: ['PASS_DART_LARGE_CONTRACT'],
      risks: ['PROVIDER_DART_PARSER_FAILED'],
      parserFailed: true,
    });
    expect(result.catalystScore).toBeLessThanOrEqual(62);
  });
});
