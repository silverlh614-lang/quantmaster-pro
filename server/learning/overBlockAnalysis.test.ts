import { describe, expect, it } from 'vitest';
import { buildOverBlockStats } from './dynamicWeightFeedback.js';
import { repeatSamples } from './dynamicWeightFeedbackFixtures.js';

describe('ADR-0524 over-block analysis', () => {
  it('keeps a block when avoided loss evidence dominates', () => {
    const stats = buildOverBlockStats([
      ...repeatSamples('AVOIDED_LOSS', 36, { engineMode: 'SELL_ONLY' }),
      ...repeatSamples('MISSED_WIN', 4, { engineMode: 'SELL_ONLY' }),
    ]);

    const sellOnly = stats.find(stat => stat.blockReason === 'SELL_ONLY_BLOCK');
    expect(sellOnly).toMatchObject({
      blockedCount: 40,
      avoidedLossCount: 36,
      missedWinCount: 4,
      suggestedPolicyAction: 'KEEP_BLOCK',
    });
    expect(sellOnly?.avoidedLossRate).toBeGreaterThanOrEqual(0.8);
  });

  it('suggests contextual review for R6 missed winners instead of live relaxation', () => {
    const stats = buildOverBlockStats([
      ...repeatSamples('MISSED_WIN', 35, { engineMode: 'SELL_ONLY' }),
      ...repeatSamples('AVOIDED_LOSS', 5, { engineMode: 'SELL_ONLY' }),
    ]);

    const sellOnly = stats.find(stat => stat.blockReason === 'SELL_ONLY_BLOCK');
    expect(sellOnly?.suggestedPolicyAction).toBe('RELAX_BLOCK');

    const r6 = buildOverBlockStats([
      ...repeatSamples('MISSED_WIN', 35, { engineMode: 'SELL_ONLY' }).map(seed => ({
        ...seed,
        blockReasons: ['R6_DEFENSE_LIVE_BUY_BLOCKED'],
      })),
      ...repeatSamples('AVOIDED_LOSS', 5, { engineMode: 'SELL_ONLY' }).map(seed => ({
        ...seed,
        blockReasons: ['R6_DEFENSE_LIVE_BUY_BLOCKED'],
      })),
    ]).find(stat => stat.blockReason === 'R6_DEFENSE_BLOCK');

    expect(r6?.suggestedPolicyAction).toBe('SPLIT_BY_CONTEXT');
    expect(r6?.missedWinRate).toBeGreaterThanOrEqual(0.8);
  });

  it('marks small policy samples as insufficient', () => {
    const stats = buildOverBlockStats(repeatSamples('MISSED_WIN', 12, { engineMode: 'SELL_ONLY' }));
    expect(stats[0]?.suggestedPolicyAction).toBe('INSUFFICIENT_SAMPLE');
  });
});
