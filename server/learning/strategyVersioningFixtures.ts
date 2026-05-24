// @responsibility Test fixtures for ADR-0526 strategy versioning.

import { createRollbackPlan, type GovernanceReviewItem, type StrategyVersionDraft } from './promotionGovernance.js';
import { observeRegistry, sampleGovernanceItem } from './promotionGovernanceFixtures.js';
import {
  buildStrategyConfigSnapshot,
  createStrategyVersionFromGovernanceDraft,
  type StrategyConfigSnapshot,
  type StrategyVersion,
} from './strategyVersioning.js';

export function approvedGovernanceItem(overrides: Partial<GovernanceReviewItem> = {}): GovernanceReviewItem {
  return sampleGovernanceItem({
    status: 'APPROVED',
    approvalReason: 'approved for strategy version fixture',
    reviewerNote: 'approved for strategy version fixture',
    ...overrides,
  });
}

export function governanceDraftFixture(items: GovernanceReviewItem[] = [approvedGovernanceItem()]): {
  draft: StrategyVersionDraft;
  rollbackPlan: ReturnType<typeof createRollbackPlan>;
} {
  const proposedVersion = 'strategy-v2026-06-01-001';
  const rollbackPlan = createRollbackPlan({ approvedItems: items, strategyVersion: proposedVersion });
  const draft: StrategyVersionDraft = {
    draftId: `draft-${proposedVersion}`,
    baseVersion: 'strategy-base-live',
    proposedVersion,
    createdAt: '2026-06-01T00:00:00.000Z',
    approvedItems: items,
    weightChanges: items
      .filter(item => item.currentWeight !== item.proposedWeight)
      .map(item => ({ factorName: item.factorName, oldWeight: item.currentWeight, newWeight: item.proposedWeight })),
    stageChanges: items
      .filter(item => item.currentStage !== item.proposedStage)
      .map(item => ({ factorName: item.factorName, oldStage: item.currentStage, newStage: item.proposedStage })),
    simulationSummary: items.map(item => item.simulationResult).filter((result): result is NonNullable<GovernanceReviewItem['simulationResult']> => !!result),
    rollbackPlanId: rollbackPlan.rollbackPlanId,
    status: 'READY_TO_APPLY',
  };
  return { draft, rollbackPlan };
}

export function baseStrategyConfig(): StrategyConfigSnapshot {
  return buildStrategyConfigSnapshot({ registry: observeRegistry });
}

export function strategyVersionFixture(items?: GovernanceReviewItem[]): StrategyVersion {
  const { draft, rollbackPlan } = governanceDraftFixture(items);
  return createStrategyVersionFromGovernanceDraft({
    draft,
    rollbackPlan,
    baseConfig: baseStrategyConfig(),
    createdAt: '2026-06-01T00:00:00.000Z',
  });
}
