import { describe, expect, it } from 'vitest';
import {
  bucketAttributionEvidence,
  computeConditionPerformance,
  summarizeAttributionBuckets,
} from './attributionEvidenceAggregator.js';
import type { AttributionEvidenceRecord } from './attributionEvidenceTypes.js';

function evidence(overrides: Partial<AttributionEvidenceRecord>): AttributionEvidenceRecord {
  const now = '2026-05-03T15:00:00.000Z';
  return {
    evidenceId: overrides.evidenceId ?? `ev-${Math.random()}`,
    tradeDate: '2026-05-03',
    symbol: '005930',
    regime: 'R2_BULL',
    conditionKeys: ['momentum'],
    source: 'LIVE',
    eligibility: 'EXCLUDED',
    outcomeStatus: 'CONFIRMED',
    executionStatus: 'EXECUTED',
    engineMode: 'NORMAL',
    dataConfidence: 'VERIFIED',
    returnPct: 1,
    winLoss: 'WIN',
    executionImpact: 'NONE',
    createdAt: now,
    updatedAt: now,
    auditTags: [],
    ...overrides,
  };
}

describe('attribution evidence buckets', () => {
  it('separates buckets and excludes PENDING from performance math', () => {
    const buckets = bucketAttributionEvidence([
      evidence({ evidenceId: 'core-win', conditionKeys: ['coreOnly'], returnPct: 1.5, winLoss: 'WIN' }),
      evidence({
        evidenceId: 'shadow-loss',
        source: 'SHADOW',
        executionStatus: 'PAPER_FILLED',
        conditionKeys: ['shadowOnly'],
        returnPct: -3,
        winLoss: 'LOSS',
      }),
      evidence({
        evidenceId: 'cf-loss',
        source: 'COUNTERFACTUAL',
        executionStatus: 'NOT_EXECUTED',
        conditionKeys: ['counterfactualOnly'],
        returnPct: -4,
        winLoss: 'LOSS',
      }),
      evidence({
        evidenceId: 'pending-loss',
        outcomeStatus: 'PENDING',
        conditionKeys: ['coreOnly'],
        returnPct: -10,
        winLoss: 'PENDING',
      }),
    ]);

    expect(summarizeAttributionBuckets(buckets)).toMatchObject({
      total: 4,
      coreEligible: 1,
      shadowOnly: 1,
      counterfactualOnly: 1,
      pending: 1,
    });

    const performance = computeConditionPerformance(buckets.coreEligible);
    expect(performance).toEqual([
      expect.objectContaining({
        conditionKey: 'coreOnly',
        total: 1,
        wins: 1,
        winRate: 1,
        avgReturnPct: 1.5,
      }),
    ]);
    expect(performance.some((item) => item.conditionKey === 'shadowOnly')).toBe(false);
    expect(performance.some((item) => item.conditionKey === 'counterfactualOnly')).toBe(false);
  });
});
