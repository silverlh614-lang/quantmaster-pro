import { describe, expect, it } from 'vitest';
import { splitProviderIssueFromMarketSignal } from './dartProviderSignalSplit.js';

describe('splitProviderIssueFromMarketSignal', () => {
  it('parser failure가 marketSignal로 오염되지 않는다', () => {
    const result = splitProviderIssueFromMarketSignal({
      category: 'UNKNOWN',
      reasons: ['PROVIDER_DART_PARSER_FAILED'],
      risks: [],
    });
    expect(result.providerIssue).toBe(true);
    expect(result.marketSignal).toBe(false);
  });

  it('providerIssue와 marketSignal이 동시에 가능하면 mixed로 표현한다', () => {
    const result = splitProviderIssueFromMarketSignal({
      category: 'STRUCTURAL_POSITIVE',
      reasons: ['PROVIDER_DART_BODY_FETCH_FAILED'],
      risks: [],
    });
    expect(result.providerIssue).toBe(true);
    expect(result.marketSignal).toBe(true);
    expect(result.mixed).toBe(true);
  });
});
