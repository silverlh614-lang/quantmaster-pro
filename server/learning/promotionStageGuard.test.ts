import { describe, expect, it } from 'vitest';
import {
  buildGovernanceReviewItemsFromFeedback,
  validateGovernanceItem,
} from './promotionGovernance.js';
import { highConfidenceFeedbackReport, observeRegistry, sampleGovernanceItem } from './promotionGovernanceFixtures.js';

describe('ADR-0525 promotion stage guard', () => {
  it('converts ADR-0524 suggested actions into governance items without auto-apply', () => {
    const items = buildGovernanceReviewItemsFromFeedback(highConfidenceFeedbackReport(), observeRegistry, '2026-06-01T00:00:00.000Z');
    const supply = items.find(item => item.factorName === 'SUPPLY_CONFLUENCE');

    expect(supply).toBeDefined();
    expect(supply?.approvalRequired).toBe(true);
    expect(supply?.autoApplyAllowed).toBe(false);
    expect(supply?.executionImpact).toBe('NONE');
    expect(supply?.currentStage).toBe('OBSERVE');
    expect(supply?.proposedStage).toBe('SHADOW_SCORE');
  });

  it('rejects direct stage jumps', () => {
    const reasons = validateGovernanceItem(sampleGovernanceItem({
      currentStage: 'OBSERVE',
      proposedStage: 'WEIGHTED',
    }));

    expect(reasons).toContain('PROMOTION_STAGE_SKIP_FORBIDDEN');
  });

  it('blocks AI estimated factors beyond advisory', () => {
    const reasons = validateGovernanceItem(sampleGovernanceItem({
      factorName: 'AI_ESTIMATED_FUNDAMENTAL',
      proposedStage: 'WEIGHTED',
    }), {
      factorName: 'AI_ESTIMATED_FUNDAMENTAL',
      factorGroup: 'GATE2',
      currentWeight: 0,
      minWeight: 0,
      maxWeight: 10,
      promotionStage: 'ADVISORY',
      dataSource: 'AI_ESTIMATED',
      isCoreProtected: false,
      canAutoSuggest: false,
    });

    expect(reasons).toContain('AI_ESTIMATED_MAX_STAGE_ADVISORY');
  });
});
