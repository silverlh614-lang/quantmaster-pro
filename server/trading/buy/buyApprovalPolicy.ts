import type {
  ApprovalAction,
  ApprovalDecision,
  NormalizedApprovalDecision,
} from '../../telegram/approval/approvalTypes.js';

export type BuyApprovalMode = 'LIVE' | 'SHADOW';

export type BuyApprovalPolicyDecision =
  | 'APPROVED'
  | 'REJECTED'
  | 'SKIPPED'
  | 'BLOCKED_FOR_APPROVAL_DELIVERY_FAILURE'
  | 'APPROVE_WITH_TELEGRAM_DELIVERY_FAILED'
  | 'MANUAL_REVIEW_REQUIRED'
  | 'EXPIRED';

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
  approvalDecision?: ApprovalDecision;
  normalizedApproval?: NormalizedApprovalDecision;
}

export interface BuyApprovalPolicyResult {
  decision: BuyApprovalPolicyDecision;
  normalizedAction: ApprovalAction;
  executionAllowed: boolean;
  approvalFailure: BuyApprovalFailureKind;
  executionFailure: 'NONE';
  approvalDeliveryFailed: boolean;
  approvalRejected: boolean;
  approvalExpired: boolean;
  executionFailed: boolean;
  statusWriteFailed: boolean;
  reason: string;
}

export function resolveBuyApprovalPolicy(
  input: BuyApprovalPolicyInput,
): BuyApprovalPolicyResult {
  if (input.normalizedApproval) {
    return resolveNormalizedApprovalPolicy(input.normalizedApproval);
  }

  if (input.approvalDecision) {
    return resolveApprovalDecisionPolicy(input.approvalDecision);
  }

  if (input.action === 'REJECT') {
    return {
      decision: 'REJECTED',
      normalizedAction: 'REJECT',
      executionAllowed: false,
      approvalFailure: 'USER_REJECTED',
      executionFailure: 'NONE',
      approvalDeliveryFailed: false,
      approvalRejected: true,
      approvalExpired: false,
      executionFailed: false,
      statusWriteFailed: false,
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
      approvalDeliveryFailed: false,
      approvalRejected: false,
      approvalExpired: true,
      executionFailed: false,
      statusWriteFailed: false,
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
        approvalDeliveryFailed: true,
        approvalRejected: false,
        approvalExpired: false,
        executionFailed: false,
        statusWriteFailed: false,
        reason: input.deliveryFailureReason ?? 'LIVE_APPROVAL_DELIVERY_FAILED',
      };
    }

    return {
      decision: 'APPROVE_WITH_TELEGRAM_DELIVERY_FAILED',
      normalizedAction: 'APPROVE',
      executionAllowed: true,
      approvalFailure: 'TELEGRAM_DELIVERY_FAILED',
      executionFailure: 'NONE',
      approvalDeliveryFailed: true,
      approvalRejected: false,
      approvalExpired: false,
      executionFailed: false,
      statusWriteFailed: false,
      reason: input.deliveryFailureReason ?? 'SHADOW_APPROVAL_DELIVERY_FAILED_PAPER_FILL_ALLOWED',
    };
  }

  return {
    decision: 'APPROVED',
    normalizedAction: 'APPROVE',
    executionAllowed: true,
    approvalFailure: 'NONE',
    executionFailure: 'NONE',
    approvalDeliveryFailed: false,
    approvalRejected: false,
    approvalExpired: false,
    executionFailed: false,
    statusWriteFailed: false,
    reason: 'BUY_APPROVAL_GRANTED',
  };
}

function resolveNormalizedApprovalPolicy(input: NormalizedApprovalDecision): BuyApprovalPolicyResult {
  return {
    ...resolveApprovalDecisionPolicy(input.decision),
    normalizedAction: input.action,
    executionAllowed: input.executionAllowed,
    approvalDeliveryFailed: input.approvalDeliveryFailed,
    approvalRejected: input.approvalRejected,
    approvalExpired: input.approvalExpired,
    executionFailed: input.executionFailed,
    statusWriteFailed: input.statusWriteFailed,
  };
}

function resolveApprovalDecisionPolicy(decision: ApprovalDecision): BuyApprovalPolicyResult {
  switch (decision.kind) {
    case 'APPROVED':
      return buildDecisionResult(decision.kind, 'APPROVE', true, 'NONE', decision.reason, {
        approvalDeliveryFailed: false,
        approvalRejected: false,
        approvalExpired: false,
      });
    case 'APPROVE_WITH_TELEGRAM_DELIVERY_FAILED':
      return buildDecisionResult(decision.kind, 'APPROVE', true, 'TELEGRAM_DELIVERY_FAILED', decision.reason, {
        approvalDeliveryFailed: true,
        approvalRejected: false,
        approvalExpired: false,
      });
    case 'BLOCKED_FOR_APPROVAL_DELIVERY_FAILURE':
      return buildDecisionResult(decision.kind, 'SKIP', false, 'TELEGRAM_DELIVERY_FAILED', decision.reason, {
        approvalDeliveryFailed: true,
        approvalRejected: false,
        approvalExpired: false,
      });
    case 'MANUAL_REVIEW_REQUIRED':
      return buildDecisionResult(decision.kind, 'SKIP', false, 'USER_SKIPPED', decision.reason, {
        approvalDeliveryFailed: false,
        approvalRejected: false,
        approvalExpired: false,
      });
    case 'REJECTED':
      return buildDecisionResult(decision.kind, 'REJECT', false, 'USER_REJECTED', decision.reason, {
        approvalDeliveryFailed: false,
        approvalRejected: true,
        approvalExpired: false,
      });
    case 'EXPIRED':
      return buildDecisionResult(decision.kind, 'SKIP', false, 'USER_SKIPPED', decision.reason, {
        approvalDeliveryFailed: false,
        approvalRejected: false,
        approvalExpired: true,
      });
  }
}

function buildDecisionResult(
  decision: BuyApprovalPolicyDecision,
  normalizedAction: ApprovalAction,
  executionAllowed: boolean,
  approvalFailure: BuyApprovalFailureKind,
  reason: string,
  flags: {
    approvalDeliveryFailed: boolean;
    approvalRejected: boolean;
    approvalExpired: boolean;
  },
): BuyApprovalPolicyResult {
  return {
    decision,
    normalizedAction,
    executionAllowed,
    approvalFailure,
    executionFailure: 'NONE',
    approvalDeliveryFailed: flags.approvalDeliveryFailed,
    approvalRejected: flags.approvalRejected,
    approvalExpired: flags.approvalExpired,
    executionFailed: false,
    statusWriteFailed: false,
    reason,
  };
}

export function isTelegramDeliveryFailureAllowedForExecution(
  mode: BuyApprovalMode,
): boolean {
  return mode === 'SHADOW';
}
