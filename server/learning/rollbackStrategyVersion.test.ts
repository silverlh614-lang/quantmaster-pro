import { describe, expect, it } from 'vitest';
import { StrategyVersionMemoryRepo } from './strategyVersioning.js';
import { strategyVersionFixture } from './strategyVersioningFixtures.js';

describe('ADR-0526 rollback strategy version', () => {
  it('restores previous live version and marks current version rolled back', () => {
    const repo = new StrategyVersionMemoryRepo();
    const version = repo.createVersion(strategyVersionFixture());
    repo.markReady(version.versionId, 'READY_FOR_LIVE');
    repo.applyStrategyVersion(version.versionId, 'LIVE', 'admin');

    const registry = repo.rollbackStrategyVersion('LIVE', 'manual rollback', 'admin');

    expect(registry.liveVersionId).toBe('strategy-base-live');
    expect(repo.getVersion(version.versionId)?.status).toBe('ROLLED_BACK');
    expect(repo.listAuditLogs().at(-1)?.action).toBe('ROLLBACK');
  });
});
