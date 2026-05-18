import { describe, expect, it } from 'vitest';

import { resolveShadowApprovalPolicy } from './shadowApprovalPolicy.js';

describe('shadowApprovalPolicy', () => {
  it('allows SHADOW paper-fill when delivery failed and records the reason', () => {
    expect(resolveShadowApprovalPolicy({
      action: 'APPROVE',
      delivery: { kind: 'DELIVERY_FAILED', reason: 'telegram down', retryable: true },
    })).toMatchObject({
      decision: {
        kind: 'APPROVE_WITH_TELEGRAM_DELIVERY_FAILED',
        reason: expect.stringContaining('telegram down'),
      },
      action: 'APPROVE',
      executionAllowed: true,
      approvalDeliveryFailed: true,
    });
  });

  it('does not turn user rejection into shadow execution', () => {
    expect(resolveShadowApprovalPolicy({
      action: 'REJECT',
      delivery: { kind: 'DELIVERED', messageId: '1' },
    })).toMatchObject({
      decision: { kind: 'REJECTED' },
      action: 'REJECT',
      executionAllowed: false,
      approvalRejected: true,
    });
  });
});
