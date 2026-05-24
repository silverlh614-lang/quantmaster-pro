import { describe, expect, it } from 'vitest';
import {
  buildGovernanceReviewItemsFromFeedback,
  requiresGovernanceSimulation,
  validateGovernanceItem,
} from './promotionGovernance.js';
import { highConfidenceFeedbackReport, sampleGovernanceItem } from './promotionGovernanceFixtures.js';

describe('ADR-0525 weight change guardrail', () => {
  it('caps low-risk weight changes to five points in governance review', () => {
    const items = buildGovernanceReviewItemsFromFeedback(highConfidenceFeedbackReport(undefined), undefined, '2026-06-01T00:00:00.000Z');
    const supply = items.find(item => item.factorName === 'SUPPLY_CONFLUENCE');

    expect(supply?.proposedWeight).toBeLessThanOrEqual((supply?.currentWeight ?? 0) + 5);
    expect(supply?.autoApplyAllowed).toBe(false);
  });

  it('blocks GATED promotion when sample count is below gated threshold', () => {
    const reasons = validateGovernanceItem(sampleGovernanceItem({
      currentStage: 'WEIGHTED',
      proposedStage: 'GATED',
      evidence: {
        ...sampleGovernanceItem().evidence,
        sampleCount: 120,
      },
    }));

    expect(reasons).toContain('GATED_REQUIRES_150_SAMPLES');
  });

  it('requires simulation for weighted/gated/core or large weight changes', () => {
    expect(requiresGovernanceSimulation(sampleGovernanceItem({
      currentStage: 'ADVISORY',
      proposedStage: 'WEIGHTED',
    }))).toBe(true);
    expect(requiresGovernanceSimulation(sampleGovernanceItem({
      currentWeight: 10,
      proposedWeight: 14,
    }))).toBe(true);
  });

  it('blocks CORE promotion without deep evidence and rollback metadata', () => {
    const reasons = validateGovernanceItem(sampleGovernanceItem({
      currentStage: 'GATED',
      proposedStage: 'CORE',
      rollbackMetadataRequired: false,
      evidence: {
        ...sampleGovernanceItem().evidence,
        sampleCount: 250,
        contributionScore: 84,
      },
    }));

    expect(reasons).toContain('CORE_REQUIRES_300_SAMPLES');
    expect(reasons).toContain('CORE_REQUIRES_SCORE_85');
    expect(reasons).toContain('CORE_REQUIRES_ROLLBACK_METADATA');
  });
});
