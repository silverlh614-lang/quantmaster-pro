import { describe, expect, it } from 'vitest';
import {
  approveGovernanceItem,
  createStrategyVersionDraft,
  runGovernanceSimulation,
} from './promotionGovernance.js';
import { repeatSamples } from './dynamicWeightFeedbackFixtures.js';
import { sampleGovernanceItem } from './promotionGovernanceFixtures.js';
import { DEFAULT_FACTOR_REGISTRY } from './dynamicWeightFeedback.js';

describe('ADR-0525 strategy version draft', () => {
  it('creates a draft from approved items and leaves runtime registry unchanged', () => {
    const simulated = {
      ...sampleGovernanceItem({ status: 'SIMULATION_PASSED', proposedWeight: 15 }),
      simulationResult: runGovernanceSimulation(sampleGovernanceItem({ status: 'SIMULATION_REQUIRED' }), repeatSamples('WIN', 60)),
    };
    const approved = approveGovernanceItem(simulated, 'approved after simulation');
    const before = DEFAULT_FACTOR_REGISTRY.find(def => def.factorName === approved.factorName)?.currentWeight;

    const { draft, rollbackPlan } = createStrategyVersionDraft({
      approvedItems: [approved],
      baseVersion: 'strategy-v1',
      proposedVersion: 'strategy-v2',
      createdAt: '2026-06-01T00:00:00.000Z',
    });

    expect(draft.status).toBe('READY_TO_APPLY');
    expect(draft.weightChanges[0]).toMatchObject({ factorName: approved.factorName, oldWeight: 10, newWeight: 15 });
    expect(rollbackPlan.previousWeights[approved.factorName]).toBe(10);
    expect(DEFAULT_FACTOR_REGISTRY.find(def => def.factorName === approved.factorName)?.currentWeight).toBe(before);
  });
});
