import { describe, expect, it } from 'vitest';
import {
  approveGovernanceItem,
  rejectGovernanceItem,
  transitionGovernanceStatus,
} from './promotionGovernance.js';
import { sampleGovernanceItem } from './promotionGovernanceFixtures.js';

describe('ADR-0525 governance review state machine', () => {
  it('forbids invalid direct transitions to APPLIED', () => {
    expect(() => transitionGovernanceStatus(sampleGovernanceItem({ status: 'DRAFT' }), 'APPLIED')).toThrow('INVALID_GOVERNANCE_TRANSITION');
  });

  it('requires simulation-passed or pending-review state for approval', () => {
    expect(() => approveGovernanceItem(sampleGovernanceItem({ status: 'SIMULATION_FAILED' }), 'approve')).toThrow('APPROVAL_REQUIRES');
    expect(approveGovernanceItem(sampleGovernanceItem({ status: 'PENDING_REVIEW' }), 'operator approved').status).toBe('APPROVED');
  });

  it('rejects items with explicit audit reason', () => {
    const rejected = rejectGovernanceItem(sampleGovernanceItem({ status: 'SIMULATION_FAILED' }), 'false positives increased');
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionReason).toBe('false positives increased');
  });
});
