import { describe, expect, it } from 'vitest';
import { OutcomeClosureMemoryRepo } from './outcomeClosure.js';
import { seed } from './outcomeSeedCreation.test.js';

describe('ADR-0522 outcome dedup repository', () => {
  it('suppresses duplicate seeds by sourceSnapshotId/symbol/timing/finalAction/tradeDate', () => {
    const repo = new OutcomeClosureMemoryRepo();
    const first = repo.createSeedIfNotExists(seed());
    const second = repo.createSeedIfNotExists(seed());

    expect(first.created).toBe(true);
    expect(second.duplicateSuppressed).toBe(true);
    expect(repo.duplicateSeedSuppressedCount).toBe(1);
    expect(repo.duplicateSeedReasonDistribution.DEDUP_KEY_MATCH).toBe(1);
  });

  it('quarantines corrupted seeds without changing execution state', () => {
    const repo = new OutcomeClosureMemoryRepo();
    const created = repo.createSeedIfNotExists(seed()).seed;
    const quarantined = repo.quarantineSeed(created.seedId, 'SYMBOL_MAPPING_MISMATCH');

    expect(quarantined?.outcomeStatus).toBe('QUARANTINED');
    expect(quarantined?.finalLearningLabel).toBe('QUARANTINED');
    expect(repo.summarizeLearningOutcomes().quarantinedOutcomeCount).toBe(1);
  });
});
