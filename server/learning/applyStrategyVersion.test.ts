import { describe, expect, it } from 'vitest';
import { StrategyVersionMemoryRepo } from './strategyVersioning.js';
import { strategyVersionFixture } from './strategyVersioningFixtures.js';

describe('ADR-0526 apply strategy version', () => {
  it('allows valid versions to apply to shadow first', () => {
    const repo = new StrategyVersionMemoryRepo();
    const version = repo.createVersion(strategyVersionFixture());

    const applied = repo.applyStrategyVersion(version.versionId, 'SHADOW');

    expect(applied.status).toBe('SHADOW_ACTIVE');
    expect(repo.getRegistry().shadowVersionId).toBe(version.versionId);
    expect(repo.listAuditLogs().at(-1)?.action).toBe('APPLY_SHADOW');
  });

  it('forbids direct live apply before live readiness', () => {
    const repo = new StrategyVersionMemoryRepo();
    const version = repo.createVersion(strategyVersionFixture());

    expect(() => repo.applyStrategyVersion(version.versionId, 'LIVE')).toThrow('LIVE_APPLY_REQUIRES_READY_FOR_LIVE');
  });

  it('safe-degrades apply failures without stopping learning', () => {
    const repo = new StrategyVersionMemoryRepo();
    const result = repo.safeApplyStrategyVersion('missing-version', 'LIVE');

    expect(result.ok).toBe(false);
    expect(result.safeMode).toBe('SHADOW_ONLY');
    expect(result.executionImpact).toBe('NONE');
    expect(result.shadowLearning).toBe(true);
  });
});
