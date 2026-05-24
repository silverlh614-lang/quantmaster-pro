import { describe, expect, it } from 'vitest';
import { StrategyVersionMemoryRepo } from './strategyVersioning.js';
import { strategyVersionFixture } from './strategyVersioningFixtures.js';

describe('ADR-0526 active strategy registry', () => {
  it('keeps live and shadow versions separate', () => {
    const repo = new StrategyVersionMemoryRepo();
    const version = repo.createVersion(strategyVersionFixture());

    repo.applyStrategyVersion(version.versionId, 'SHADOW');
    const registry = repo.getRegistry();

    expect(registry.shadowVersionId).toBe(version.versionId);
    expect(registry.liveVersionId).toBe('strategy-base-live');
    expect(registry.previousShadowVersionId).toBe('strategy-base-shadow');
  });
});
