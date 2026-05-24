import { describe, expect, it } from 'vitest';
import {
  attachForwardReturn,
  buildForwardReturnSnapshot,
  closeOutcomeLabel,
} from './outcomeClosure.js';
import { seed, runtimeInput } from './outcomeSeedCreation.test.js';
import { resolveFinalExecutionDecision } from '../trading/gates/finalDecisionResolver.js';

function with10d(base = seed(), closePrice = 11_600, highPrice = 11_800, lowPrice = 9_800) {
  return attachForwardReturn(base, buildForwardReturnSnapshot({
    seed: base,
    horizon: '10D',
    asOf: '2026-06-03',
    closePrice,
    highPrice,
    lowPrice,
    targetHitAt: highPrice >= 11_500 ? '2026-05-28' : undefined,
    stopHitAt: lowPrice <= 9_300 ? '2026-05-29' : undefined,
  }));
}

describe('ADR-0522 outcome label closure', () => {
  it('labels SHADOW/LIVE executed target before stop as WIN', () => {
    const labeled = closeOutcomeLabel(with10d());

    expect(labeled.outcomeStatus).toBe('LABELED');
    expect(labeled.finalLearningLabel).toBe('WIN');
  });

  it('labels stop before target as LOSS', () => {
    const s = seed();
    const updated = attachForwardReturn(s, buildForwardReturnSnapshot({
      seed: s,
      horizon: '10D',
      asOf: '2026-06-03',
      closePrice: 9_000,
      highPrice: 10_500,
      lowPrice: 9_200,
      stopHitAt: '2026-05-27',
    }));

    expect(closeOutcomeLabel(updated).finalLearningLabel).toBe('LOSS');
  });

  it('does not classify TP1_THEN_BREAKEVEN lifecycle as LOSS', () => {
    const s = with10d({ ...seed(), tradeLifecycleOutcome: 'TP1_THEN_BREAKEVEN' }, 9_900, 10_700, 9_200);

    expect(closeOutcomeLabel(s).finalLearningLabel).toBe('PARTIAL_WIN');
  });

  it('labels OBSERVE_ONLY entry-ready rally as MISSED_WIN', () => {
    const input = runtimeInput({ engineMode: 'OBSERVE_ONLY', shadowMode: 'OBSERVE_ONLY' });
    const decision = resolveFinalExecutionDecision(input);
    const s = seed({ decision, runtimeInput: input });

    expect(closeOutcomeLabel(with10d(s, 10_800, 11_800, 9_900)).finalLearningLabel).toBe('MISSED_WIN');
  });
});
