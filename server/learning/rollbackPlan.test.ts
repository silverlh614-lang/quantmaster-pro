import { describe, expect, it } from 'vitest';
import { createRollbackPlan } from './promotionGovernance.js';
import { sampleGovernanceItem } from './promotionGovernanceFixtures.js';

describe('ADR-0525 rollback plan', () => {
  it('captures previous weights and stages with an operator rollback command', () => {
    const plan = createRollbackPlan({
      strategyVersion: 'strategy-v2',
      approvedItems: [sampleGovernanceItem({
        factorName: 'SUPPLY_CONFLUENCE',
        currentWeight: 10,
        currentStage: 'ADVISORY',
        proposedStage: 'WEIGHTED',
      })],
    });

    expect(plan.rollbackPlanId).toBe('rollback-strategy-v2');
    expect(plan.previousWeights.SUPPLY_CONFLUENCE).toBe(10);
    expect(plan.previousStages.SUPPLY_CONFLUENCE).toBe('ADVISORY');
    expect(plan.rollbackCommand).toBe('/strategy_rollback strategy-v2');
    expect(plan.rollbackTrigger.operatorManualRollback).toBe(true);
  });
});
