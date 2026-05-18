// @responsibility Shared Telegram approval contracts.

export type ApprovalMode = 'LIVE' | 'SHADOW';

export type ApprovalAction = 'APPROVE' | 'REJECT' | 'SKIP';

export type ApprovalDeliveryResult =
  | { kind: 'DELIVERED'; messageId: string }
  | { kind: 'DELIVERY_FAILED'; reason: string; retryable: boolean };

export type ApprovalDecision =
  | { kind: 'APPROVED'; reason: string }
  | { kind: 'APPROVE_WITH_TELEGRAM_DELIVERY_FAILED'; reason: string }
  | { kind: 'BLOCKED_FOR_APPROVAL_DELIVERY_FAILURE'; reason: string }
  | { kind: 'MANUAL_REVIEW_REQUIRED'; reason: string }
  | { kind: 'REJECTED'; reason: string }
  | { kind: 'EXPIRED'; reason: string };

export type ApprovalFailureKind =
  | 'NONE'
  | 'approvalDeliveryFailed'
  | 'approvalRejected'
  | 'approvalExpired';

export type ExecutionFailureKind =
  | 'NONE'
  | 'executionFailed'
  | 'statusWriteFailed';

export interface NormalizedApprovalDecision {
  decision: ApprovalDecision;
  action: ApprovalAction;
  executionAllowed: boolean;
  approvalDeliveryFailed: boolean;
  approvalRejected: boolean;
  approvalExpired: boolean;
  executionFailed: boolean;
  statusWriteFailed: boolean;
  approvalFailure: ApprovalFailureKind;
  executionFailure: ExecutionFailureKind;
}
