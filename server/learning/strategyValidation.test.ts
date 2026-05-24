import { describe, expect, it } from 'vitest';
import { createRollbackPlan } from './promotionGovernance.js';
import { createStrategyVersionFromGovernanceDraft, validateStrategyVersion } from './strategyVersioning.js';
import { approvedGovernanceItem, baseStrategyConfig, governanceDraftFixture } from './strategyVersioningFixtures.js';

describe('ADR-0526 strategy validation', () => {
  it('fails invalid direct promotion stages', () => {
    const item = approvedGovernanceItem({ currentStage: 'OBSERVE', proposedStage: 'WEIGHTED' });
    const { draft, rollbackPlan } = governanceDraftFixture([item]);
    const version = createStrategyVersionFromGovernanceDraft({ draft, rollbackPlan, baseConfig: baseStrategyConfig() });

    expect(version.validation.passed).toBe(false);
    expect(version.validation.failedReasons).toContain('PROMOTION_STAGE_SKIP:SUPPLY_CONFLUENCE');
  });

  it('fails AI estimated CORE promotion and missing rollback plan', () => {
    const item = approvedGovernanceItem({
      factorName: 'AI_ESTIMATED_FUNDAMENTAL',
      currentStage: 'GATED',
      proposedStage: 'CORE',
      evidence: { ...approvedGovernanceItem().evidence, sampleCount: 320, contributionScore: 90 },
    });
    const { draft } = governanceDraftFixture([item]);
    const rollbackPlan = createRollbackPlan({ approvedItems: [item], strategyVersion: draft.proposedVersion });
    const version = createStrategyVersionFromGovernanceDraft({ draft, rollbackPlan, baseConfig: baseStrategyConfig() });
    const missingRollback = validateStrategyVersion({
      ...version,
      rollbackPlan: undefined as never,
      governanceItems: [item],
    });

    expect(version.validation.failedReasons).toContain('AI_ESTIMATED_CORE_FORBIDDEN:AI_ESTIMATED_FUNDAMENTAL');
    expect(missingRollback.failedReasons).toContain('ROLLBACK_PLAN_MISSING');
  });
});
