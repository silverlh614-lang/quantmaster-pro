import { describe, expect, it } from 'vitest';
import { buildStrategyConfigSnapshot, StrategyVersionMemoryRepo } from './strategyVersioning.js';
import { strategyVersionFixture } from './strategyVersioningFixtures.js';

describe('ADR-0526 config hash drift', () => {
  it('detects active config hash drift', () => {
    const repo = new StrategyVersionMemoryRepo();
    const version = repo.createVersion(strategyVersionFixture());
    const actual = buildStrategyConfigSnapshot();
    actual.gate2Weights.SUPPLY_CONFLUENCE = 999;

    const drift = repo.detectConfigDrift(version.versionId, actual);

    expect(drift.configDriftDetected).toBe(true);
    expect(drift.expectedConfigHash).toBe(version.configHash);
    expect(drift.activeConfigHash).not.toBe(version.configHash);
  });
});
