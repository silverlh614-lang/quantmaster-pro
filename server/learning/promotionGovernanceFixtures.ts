// @responsibility Test fixtures for ADR-0525 promotion governance.

import type { FactorDefinition } from './dynamicWeightFeedback.js';
import { buildWeightFeedbackReport, DEFAULT_FACTOR_REGISTRY } from './dynamicWeightFeedback.js';
import { repeatSamples } from './dynamicWeightFeedbackFixtures.js';
import type { GovernanceReviewItem } from './promotionGovernance.js';

export const observeRegistry: FactorDefinition[] = [
  ...DEFAULT_FACTOR_REGISTRY.filter(def => def.factorName !== 'SUPPLY_CONFLUENCE'),
  {
    factorName: 'SUPPLY_CONFLUENCE',
    factorGroup: 'GATE2',
    currentWeight: 10,
    minWeight: 0,
    maxWeight: 25,
    promotionStage: 'OBSERVE',
    dataSource: 'KIS',
    isCoreProtected: false,
    canAutoSuggest: true,
  },
];

export function highConfidenceFeedbackReport(registry: readonly FactorDefinition[] = observeRegistry) {
  return buildWeightFeedbackReport({
    registry,
    createdAt: '2026-06-01T00:00:00.000Z',
    seeds: [
      ...repeatSamples('WIN', 110, {
        gate2AxisScores: { SUPPLY_CONFLUENCE: 95 },
        gate3ComponentScores: { priceConfirmation: 90 },
      }),
      ...repeatSamples('LOSS', 5, {
        gate2AxisScores: { SUPPLY_CONFLUENCE: 82 },
      }),
    ],
  });
}

export function sampleGovernanceItem(overrides: Partial<GovernanceReviewItem> = {}): GovernanceReviewItem {
  return {
    itemId: 'gov-SUPPLY_CONFLUENCE-PROMOTE_STAGE-2026-06-01',
    createdAt: '2026-06-01T00:00:00.000Z',
    createdBy: 'WEIGHT_FEEDBACK_ENGINE',
    factorName: 'SUPPLY_CONFLUENCE',
    factorGroup: 'GATE2',
    currentWeight: 10,
    proposedWeight: 10,
    currentStage: 'OBSERVE',
    proposedStage: 'SHADOW_SCORE',
    suggestedAction: 'PROMOTE_STAGE',
    evidence: {
      sampleCount: 120,
      contributionScore: 86,
      winRate: 0.9,
      falsePositiveRate: 0.02,
      missedWinRate: 0,
      avoidedLossRate: 0,
      avgReturn10D: 7,
      avgMFE10D: 9,
      avgMAE10D: -2,
      dataConfidence: 'HIGH',
      providerIssueSampleCount: 0,
      dataInsufficientExcludedCount: 0,
    },
    riskLevel: 'LOW',
    approvalRequired: true,
    autoApplyAllowed: false,
    status: 'PENDING_REVIEW',
    executionImpact: 'NONE',
    guardrailReasons: [],
    rollbackMetadataRequired: false,
    ...overrides,
  };
}
