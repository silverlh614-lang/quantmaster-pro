import { describe, expect, it } from 'vitest';
import { buildStrategyVersionPerformance } from './strategyVersioning.js';
import { repeatSamples } from './dynamicWeightFeedbackFixtures.js';

describe('ADR-0526 strategy performance tracker', () => {
  it('tracks version-specific labeled outcomes', () => {
    const seeds = [
      ...repeatSamples('WIN', 8).map(seed => ({ ...seed, shadowStrategyVersionId: 'strategy-v1', configHash: 'hash-a' })),
      ...repeatSamples('LOSS', 2).map(seed => ({ ...seed, shadowStrategyVersionId: 'strategy-v1', configHash: 'hash-a' })),
      ...repeatSamples('WIN', 5).map(seed => ({ ...seed, shadowStrategyVersionId: 'strategy-other', configHash: 'hash-b' })),
    ];

    const perf = buildStrategyVersionPerformance({ versionId: 'strategy-v1', stage: 'SHADOW', seeds });

    expect(perf.seedCount).toBe(10);
    expect(perf.labeledCount).toBe(10);
    expect(perf.winRate).toBe(0.8);
    expect(perf.rollbackRisk).not.toBe('TRIGGERED');
  });
});
