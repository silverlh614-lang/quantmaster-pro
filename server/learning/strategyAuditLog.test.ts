import { describe, expect, it } from 'vitest';
import { StrategyVersionMemoryRepo } from './strategyVersioning.js';
import { strategyVersionFixture } from './strategyVersioningFixtures.js';

describe('ADR-0526 strategy audit log', () => {
  it('records create, apply, and rollback audit events with executionImpact NONE', () => {
    const repo = new StrategyVersionMemoryRepo();
    const version = repo.createVersion(strategyVersionFixture(), 'governance');
    repo.applyStrategyVersion(version.versionId, 'SHADOW', 'operator');
    repo.rollbackStrategyVersion('SHADOW', 'operator rollback', 'operator');

    expect(repo.listAuditLogs().map(log => log.action)).toEqual(['CREATE_VERSION', 'APPLY_SHADOW', 'ROLLBACK']);
    expect(repo.listAuditLogs().every(log => log.executionImpact === 'NONE')).toBe(true);
  });
});
