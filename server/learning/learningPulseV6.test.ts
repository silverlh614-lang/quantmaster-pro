import { describe, expect, it } from 'vitest';
import {
  attachForwardReturn,
  buildForwardReturnSnapshot,
  buildGateAttribution,
  closeOutcomeLabel,
  formatLearningOutcomesSummary,
  summarizeLearningOutcomes,
  type GateAttribution,
} from './outcomeClosure.js';
import { seed } from './outcomeSeedCreation.test.js';

describe('ADR-0522 Learning Pulse v6 outcome closure summary', () => {
  it('summarizes labeled, blocked, return, and attribution counters without execution impact', () => {
    const rawWinSeed = seed();
    const winSeed = closeOutcomeLabel(attachForwardReturn(rawWinSeed, buildForwardReturnSnapshot({
      seed: rawWinSeed,
      horizon: '10D',
      asOf: '2026-06-03',
      closePrice: 10_800,
      highPrice: 11_600,
      lowPrice: 9_900,
      targetHitAt: '2026-05-27T06:00:00.000Z',
    })));
    const rawBlockedSeed = seed({
      runtimeInput: { engineMode: 'SELL_ONLY' },
    });
    const blockedSeed = closeOutcomeLabel(attachForwardReturn(rawBlockedSeed, buildForwardReturnSnapshot({
      seed: rawBlockedSeed,
      horizon: '10D',
      asOf: '2026-06-03',
      closePrice: 9_200,
      highPrice: 10_100,
      lowPrice: 9_100,
      stopHitAt: '2026-05-28T06:00:00.000Z',
    })));
    const pendingSeed = seed({ runtimeInput: { symbol: '011210' } });
    const attributions = [winSeed, blockedSeed]
      .map(buildGateAttribution)
      .filter((value): value is GateAttribution => value !== null);

    const summary = summarizeLearningOutcomes([winSeed, blockedSeed, pendingSeed], attributions, 2);
    const text = formatLearningOutcomesSummary(summary);

    expect(summary.outcomeSeedsCreated).toBe(3);
    expect(summary.pendingOutcomeCount).toBe(1);
    expect(summary.labeledOutcomeCount).toBe(2);
    expect(summary.avoidedLossCount).toBe(1);
    expect(summary.avgReturn10D).not.toBeNull();
    expect(summary.topAvoidedLossReason).toBe('SELL_ONLY_LIVE_BUY_BLOCKED');
    expect(summary.executionImpact).toBe('NONE');
    expect(summary.shadowLearning).toBe(true);
    expect(text).toContain('[Learning Outcomes]');
    expect(text).toContain('ExecutionImpact: NONE for learning');
    expect(text).toContain('ShadowLearning: true');
  });
});
