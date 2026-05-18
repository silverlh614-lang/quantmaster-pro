import { describe, expect, it } from 'vitest';
import { resolveBuyApprovalPolicy } from './buyApprovalPolicy.js';

describe('buyApprovalPolicy', () => {
  it('blocks LIVE execution when Telegram approval delivery failed', () => {
    expect(resolveBuyApprovalPolicy({
      mode: 'LIVE',
      action: 'APPROVE',
      telegramDelivered: false,
    })).toMatchObject({
      decision: 'BLOCKED_FOR_APPROVAL_DELIVERY_FAILURE',
      normalizedAction: 'SKIP',
      executionAllowed: false,
      approvalFailure: 'TELEGRAM_DELIVERY_FAILED',
      executionFailure: 'NONE',
    });
  });

  it('allows SHADOW paper-fill when Telegram delivery failed', () => {
    expect(resolveBuyApprovalPolicy({
      mode: 'SHADOW',
      action: 'APPROVE',
      telegramDelivered: false,
    })).toMatchObject({
      decision: 'APPROVE_WITH_TELEGRAM_DELIVERY_FAILED',
      normalizedAction: 'APPROVE',
      executionAllowed: true,
      approvalFailure: 'TELEGRAM_DELIVERY_FAILED',
    });
  });

  it('keeps approval failure separate from execution failure', () => {
    expect(resolveBuyApprovalPolicy({
      mode: 'LIVE',
      action: 'REJECT',
      telegramDelivered: true,
    })).toMatchObject({
      decision: 'REJECTED',
      executionAllowed: false,
      approvalFailure: 'USER_REJECTED',
      executionFailure: 'NONE',
    });
  });
});
