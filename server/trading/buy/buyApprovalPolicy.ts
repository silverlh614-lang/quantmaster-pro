import type { ApprovalAction } from '../../telegram/buyApproval.js';

export type BuyApprovalMode = 'LIVE' | 'SHADOW';

export type BuyApprovalPolicyDecision =
  | 'APPROVED'
  | 'REJECTED'
  | 'SKIPPED'
  | 'BLOCKED_FOR_APPROVAL_DELIVERY_FAILURE'
  | 'APPROVE_WITH_TELEGRAM_DELIVERY_FAILED';

export type BuyApprovalFailureKind =
  | 'NONE'
  | 'USER_REJECTED'
  | 'USER_SKIPPED'
  | 'TELEGRAM_DELIVERY_FAILED';

export interface BuyApprovalPolicyInput {
  mode: BuyApprovalMode;
  action: ApprovalAction;
  telegramDelivered: boolean;
  deliveryFailureReason?: string;
}

export interface BuyApprovalPolicyResult {
  decision: BuyApprovalPolicyDecision;
  normalizedAction: ApprovalAction;
  executionAllowed: boolean;
  approvalFailure: BuyApprovalFailureKind;
  executionFailure: 'NONE';
  reason: string;
}

export function resolveBuyApprovalPolicy(
  input: BuyApprovalPolicyInput,
): BuyApprovalPolicyResult {
  if (input.action === 'REJECT') {
    return {
      decision: 'REJECTED',
      normalizedAction: 'REJECT',
      executionAllowed: false,
      approvalFailure: 'USER_REJECTED',
      executionFailure: 'NONE',
      reason: 'USER_REJECTED_BUY_APPROVAL',
    };
  }

  if (input.action === 'SKIP') {
    return {
      decision: 'SKIPPED',
      normalizedAction: 'SKIP',
      executionAllowed: false,
      approvalFailure: 'USER_SKIPPED',
      executionFailure: 'NONE',
      reason: 'USER_SKIPPED_BUY_APPROVAL',
    };
  }

  if (!input.telegramDelivered) {
    if (input.mode === 'LIVE') {
      return {
        decision: 'BLOCKED_FOR_APPROVAL_DELIVERY_FAILURE',
        normalizedAction: 'SKIP',
        executionAllowed: false,
        approvalFailure: 'TELEGRAM_DELIVERY_FAILED',
        executionFailure: 'NONE',
        reason: input.deliveryFailureReason ?? 'LIVE_APPROVAL_DELIVERY_FAILED',
      };
    }

    return {
      decision: 'APPROVE_WITH_TELEGRAM_DELIVERY_FAILED',
      normalizedAction: 'APPROVE',
      executionAllowed: true,
      approvalFailure: 'TELEGRAM_DELIVERY_FAILED',
      executionFailure: 'NONE',
      reason: input.deliveryFailureReason ?? 'SHADOW_APPROVAL_DELIVERY_FAILED_PAPER_FILL_ALLOWED',
    };
  }

  return {
    decision: 'APPROVED',
    normalizedAction: 'APPROVE',
    executionAllowed: true,
    approvalFailure: 'NONE',
    executionFailure: 'NONE',
    reason: 'BUY_APPROVAL_GRANTED',
  };
}

export function isTelegramDeliveryFailureAllowedForExecution(
  mode: BuyApprovalMode,
): boolean {
  return mode === 'SHADOW';
}
