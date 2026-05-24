import { describe, expect, it } from 'vitest';
import { applyGovernanceDraftToConfig, buildStrategyVersionDiff } from './strategyVersioning.js';
import { baseStrategyConfig, governanceDraftFixture } from './strategyVersioningFixtures.js';
import { approvedGovernanceItem } from './strategyVersioningFixtures.js';

describe('ADR-0526 strategy version diff', () => {
  it('records weight and stage changes from a governance draft', () => {
    const base = baseStrategyConfig();
    const { draft } = governanceDraftFixture([
      approvedGovernanceItem({ proposedWeight: 15, proposedStage: 'SHADOW_SCORE' }),
    ]);
    const next = applyGovernanceDraftToConfig(base, draft);
    const diff = buildStrategyVersionDiff(base, next);

    expect(diff.weightChanges).toContainEqual({
      factorName: 'SUPPLY_CONFLUENCE',
      group: 'GATE2',
      oldWeight: 10,
      newWeight: 15,
      delta: 5,
    });
    expect(diff.stageChanges).toContainEqual({
      factorName: 'SUPPLY_CONFLUENCE',
      oldStage: 'OBSERVE',
      newStage: 'SHADOW_SCORE',
    });
    expect(diff.riskLevel).toBe('MEDIUM');
  });
});
