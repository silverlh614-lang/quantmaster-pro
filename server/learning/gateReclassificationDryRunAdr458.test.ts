import { describe, expect, it } from 'vitest';
import { isGateReclassificationDryRunRecord } from './gateReclassificationDryRun.js';

describe('ADR-458 Gate Reclassification Dry-Run evidence compatibility', () => {
  it('ADR-459 rollout이 소비할 dry-run evidence record를 검증한다', () => {
    expect(isGateReclassificationDryRunRecord({
      id: 'dry-run-1',
      approvalItemId: 'approval-1',
      condition: 'supply_confluence',
      source: 'unavailableConditions',
      proposedClass: 'SOFT_PENALTY',
      samples: 20,
      avgReturnPct: 3.2,
      winRate: 0.61,
      lossRate: 0.39,
      rescuedCount: 6,
      horizonDays: 5,
      recordedAt: '2026-05-08T00:00:00.000Z',
      executionImpact: 'NONE',
    })).toBe(true);
  });

  it('executionImpact NONE이 아닌 dry-run evidence는 거부한다', () => {
    expect(isGateReclassificationDryRunRecord({
      id: 'dry-run-1',
      approvalItemId: 'approval-1',
      condition: 'supply_confluence',
      source: 'unavailableConditions',
      proposedClass: 'SOFT_PENALTY',
      samples: 20,
      avgReturnPct: 3.2,
      winRate: 0.61,
      lossRate: 0.39,
      rescuedCount: 6,
      horizonDays: 5,
      recordedAt: '2026-05-08T00:00:00.000Z',
      executionImpact: 'LIVE',
    })).toBe(false);
  });
});
