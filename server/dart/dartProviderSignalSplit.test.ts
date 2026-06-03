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

  it('불변식 #6: providerIssue=true 면 (원래 marketSignal=true 였을 입력이라도) marketSignal=false 로 격리한다', () => {
    // STRUCTURAL_POSITIVE 카테고리는 정상이면 marketSignal=true 였겠지만,
    // body fetch 실패(providerIssue)가 동반되면 provider 장애가 우선하여 marketSignal=false 로 격리.
    const result = splitProviderIssueFromMarketSignal({
      category: 'STRUCTURAL_POSITIVE',
      reasons: ['PROVIDER_DART_BODY_FETCH_FAILED'],
      risks: [],
    });
    expect(result.providerIssue).toBe(true);
    expect(result.marketSignal).toBe(false);
    // mixed 필드는 제거됨 — provider/marketSignal 혼합 상태는 더 이상 표현하지 않는다.
    expect((result as Record<string, unknown>).mixed).toBeUndefined();
  });

  it('fetchProviderIssue=true 면 카테고리가 신호여도 marketSignal=false 로 격리한다', () => {
    const result = splitProviderIssueFromMarketSignal({
      category: 'STRUCTURAL_POSITIVE',
      reasons: [],
      risks: [],
      fetchProviderIssue: true,
    });
    expect(result.providerIssue).toBe(true);
    expect(result.marketSignal).toBe(false);
  });

  it('providerIssue=false 정상 입력은 기존과 동일하게 카테고리 기반 marketSignal 을 낸다', () => {
    const positive = splitProviderIssueFromMarketSignal({
      category: 'STRUCTURAL_POSITIVE',
      reasons: [],
      risks: [],
    });
    expect(positive.providerIssue).toBe(false);
    expect(positive.marketSignal).toBe(true);

    const neutral = splitProviderIssueFromMarketSignal({
      category: 'NEUTRAL_INFO',
      reasons: [],
      risks: [],
    });
    expect(neutral.providerIssue).toBe(false);
    expect(neutral.marketSignal).toBe(false);
  });
});
