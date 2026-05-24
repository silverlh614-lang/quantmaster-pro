import { describe, expect, it } from 'vitest';
import { resolveFinalExecutionDecision } from '../trading/gates/finalDecisionResolver.js';
import {
  attachForwardReturn,
  buildForwardReturnSnapshot,
  closeOutcomeLabel,
} from './outcomeClosure.js';
import { runtimeInput, seed } from './outcomeSeedCreation.test.js';

function closeBlocked(returnClose: number, low: number, high: number, engineMode: 'SELL_ONLY' | 'SHADOW_ONLY' = 'SELL_ONLY') {
  const input = runtimeInput({ engineMode, shadowMode: engineMode === 'SHADOW_ONLY' ? 'SHADOW_ONLY' : 'NORMAL' });
  const decision = resolveFinalExecutionDecision(input);
  const s = seed({ runtimeInput: input, decision });
  return closeOutcomeLabel(attachForwardReturn(s, buildForwardReturnSnapshot({
    seed: s,
    horizon: '10D',
    asOf: '2026-06-03',
    closePrice: returnClose,
    highPrice: high,
    lowPrice: low,
  })));
}

describe('ADR-0522 blocked decision outcomes', () => {
  it('labels blocked counterfactual rally as MISSED_WIN', () => {
    const labeled = closeBlocked(10_800, 9_800, 11_000);

    expect(labeled.finalLearningLabel).toBe('MISSED_WIN');
    expect(labeled.counterfactualOutcomeLabel).toBe('MISSED_WIN');
  });

  it('labels blocked counterfactual drawdown as AVOIDED_LOSS', () => {
    const labeled = closeBlocked(9_200, 9_100, 10_100);

    expect(labeled.finalLearningLabel).toBe('AVOIDED_LOSS');
  });

  it('keeps SHADOW_ONLY shadow execution separate from live blocked learning', () => {
    const labeled = closeBlocked(10_800, 9_800, 11_800, 'SHADOW_ONLY');

    expect(labeled.decisionType).toBe('SHADOW_EXECUTED');
    expect(labeled.finalLearningLabel).toBe('WIN');
  });
});
