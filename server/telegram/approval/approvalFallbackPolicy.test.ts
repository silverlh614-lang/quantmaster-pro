import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveApprovalFallbackPolicy } from './approvalFallbackPolicy.js';

describe('approvalFallbackPolicy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks LIVE delivery failure fallback and emits auto-approval blocked P0', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(resolveApprovalFallbackPolicy({
      mode: 'LIVE',
      event: 'DELIVERY_FAILURE',
      reason: 'telegram down',
    })).toEqual({
      kind: 'BLOCKED_FOR_APPROVAL_DELIVERY_FAILURE',
      reason: 'telegram down',
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[P0][P0_LIVE_AUTO_APPROVAL_BLOCKED]'),
      expect.objectContaining({ code: 'P0_LIVE_AUTO_APPROVAL_BLOCKED' }),
    );
  });

  it('allows SHADOW delivery failure fallback for paper fill', () => {
    expect(resolveApprovalFallbackPolicy({
      mode: 'SHADOW',
      event: 'DELIVERY_FAILURE',
      reason: 'telegram down',
    })).toEqual({
      kind: 'APPROVE_WITH_TELEGRAM_DELIVERY_FAILED',
      reason: 'telegram down',
    });
  });

  it('separates timeout and duplicate request outcomes', () => {
    expect(resolveApprovalFallbackPolicy({
      mode: 'LIVE',
      event: 'TIMEOUT',
    })).toEqual({
      kind: 'EXPIRED',
      reason: 'TIMEOUT',
    });
    expect(resolveApprovalFallbackPolicy({
      mode: 'SHADOW',
      event: 'DUPLICATE_REQUEST',
      duplicateApproved: false,
    })).toEqual({
      kind: 'MANUAL_REVIEW_REQUIRED',
      reason: 'DUPLICATE_APPROVAL_REQUEST_BLOCKED',
    });
  });
});
