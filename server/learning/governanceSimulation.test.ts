import { describe, expect, it } from 'vitest';
import {
  runGovernanceSimulation,
  validateGovernanceItem,
} from './promotionGovernance.js';
import { repeatSamples } from './dynamicWeightFeedbackFixtures.js';
import { sampleGovernanceItem } from './promotionGovernanceFixtures.js';

describe('ADR-0525 governance simulation', () => {
  it('passes a healthy review item with sufficient labeled evidence', () => {
    const item = sampleGovernanceItem({ status: 'SIMULATION_REQUIRED' });
    const result = runGovernanceSimulation(item, repeatSamples('WIN', 60));

    expect(result.verdict).toBe('PASS');
    expect(result.sampleCount).toBe(60);
    expect(result.delta.expectedReturnDelta).not.toBeNull();
  });

  it('fails simulation when guardrails are already violated', () => {
    const broken = sampleGovernanceItem({
      status: 'SIMULATION_REQUIRED',
      currentStage: 'OBSERVE',
      proposedStage: 'WEIGHTED',
    });
    const item = { ...broken, guardrailReasons: validateGovernanceItem(broken), riskLevel: 'BLOCKED' as const };

    const result = runGovernanceSimulation(item, repeatSamples('WIN', 60));
    expect(result.verdict).toBe('FAIL');
    expect(result.reason).toContain('PROMOTION_STAGE_SKIP_FORBIDDEN');
  });
});
