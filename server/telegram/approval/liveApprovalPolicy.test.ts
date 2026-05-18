import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveLiveApprovalPolicy } from './liveApprovalPolicy.js';

describe('liveApprovalPolicy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks LIVE execution when delivery failed and emits P0', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = resolveLiveApprovalPolicy({
      action: 'APPROVE',
      delivery: { kind: 'DELIVERY_FAILED', reason: 'telegram down', retryable: true },
    });

    expect(result).toMatchObject({
      decision: { kind: 'BLOCKED_FOR_APPROVAL_DELIVERY_FAILURE' },
      action: 'SKIP',
      executionAllowed: false,
      approvalDeliveryFailed: true,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[P0][P0_LIVE_APPROVAL_DELIVERY_FAILED]'),
      expect.objectContaining({ code: 'P0_LIVE_APPROVAL_DELIVERY_FAILED' }),
    );
  });

  it('approves LIVE only after delivered approval', () => {
    expect(resolveLiveApprovalPolicy({
      action: 'APPROVE',
      delivery: { kind: 'DELIVERED', messageId: '1' },
    })).toMatchObject({
      decision: { kind: 'APPROVED' },
      action: 'APPROVE',
      executionAllowed: true,
    });
  });
});
