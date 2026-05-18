import { afterEach, describe, expect, it, vi } from 'vitest';

import { normalizeApprovalDecision } from './approvalDecisionNormalizer.js';

describe('approvalDecisionNormalizer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes a delivered approval into APPROVED', () => {
    expect(normalizeApprovalDecision({
      mode: 'LIVE',
      action: 'APPROVE',
      delivery: { kind: 'DELIVERED', messageId: '1' },
    })).toMatchObject({
      decision: { kind: 'APPROVED' },
      action: 'APPROVE',
      executionAllowed: true,
      approvalFailure: 'NONE',
      executionFailure: 'NONE',
    });
  });

  it('blocks LIVE execution when delivery failed', () => {
    expect(normalizeApprovalDecision({
      mode: 'LIVE',
      action: 'APPROVE',
      delivery: { kind: 'DELIVERY_FAILED', reason: 'telegram down', retryable: true },
    })).toMatchObject({
      decision: { kind: 'BLOCKED_FOR_APPROVAL_DELIVERY_FAILURE' },
      action: 'SKIP',
      executionAllowed: false,
      approvalDeliveryFailed: true,
      approvalFailure: 'approvalDeliveryFailed',
    });
  });

  it('allows SHADOW execution with explicit delivery-failure decision', () => {
    expect(normalizeApprovalDecision({
      mode: 'SHADOW',
      action: 'APPROVE',
      delivery: { kind: 'DELIVERY_FAILED', reason: 'telegram down', retryable: true },
    })).toMatchObject({
      decision: { kind: 'APPROVE_WITH_TELEGRAM_DELIVERY_FAILED' },
      action: 'APPROVE',
      executionAllowed: true,
      approvalDeliveryFailed: true,
      approvalFailure: 'approvalDeliveryFailed',
    });
  });

  it('keeps user rejection separate from execution failure', () => {
    expect(normalizeApprovalDecision({
      mode: 'LIVE',
      action: 'REJECT',
      delivery: { kind: 'DELIVERED', messageId: '1' },
    })).toMatchObject({
      decision: { kind: 'REJECTED' },
      action: 'REJECT',
      executionAllowed: false,
      approvalRejected: true,
      executionFailed: false,
      statusWriteFailed: false,
    });
  });
});
