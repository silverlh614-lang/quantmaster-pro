import { describe, expect, it } from 'vitest';
import { PromotionGovernanceMemoryRepo } from './promotionGovernance.js';
import { sampleGovernanceItem } from './promotionGovernanceFixtures.js';

describe('ADR-0525 governance audit log', () => {
  it('writes audit log entries for every governance action', () => {
    const repo = new PromotionGovernanceMemoryRepo();
    repo.upsertReviewItem(sampleGovernanceItem(), 'system');
    repo.reject(sampleGovernanceItem().itemId, 'sample not ready', 'operator');

    const logs = repo.listAuditLogs();
    expect(logs.map(log => log.action)).toEqual(['CREATE_REVIEW_ITEM', 'REJECT']);
    expect(logs.every(log => log.executionImpact === 'NONE')).toBe(true);
  });
});
