// @responsibility Normalize approval actions and delivery outcomes into a common decision.

import { emitOperationalWarn } from '../../trading/buy/operationalWarn.js';
import type {
  ApprovalAction,
  ApprovalDecision,
  ApprovalDeliveryResult,
  ApprovalFailureKind,
  ApprovalMode,
  ExecutionFailureKind,
  NormalizedApprovalDecision,
} from './approvalTypes.js';

export interface ApprovalDecisionNormalizerInput {
  mode: ApprovalMode;
  action?: ApprovalAction;
  delivery: ApprovalDeliveryResult;
  deliveryFailureDecision?: Extract<ApprovalDecision, {
    kind: 'APPROVE_WITH_TELEGRAM_DELIVERY_FAILED' | 'BLOCKED_FOR_APPROVAL_DELIVERY_FAILURE' | 'MANUAL_REVIEW_REQUIRED';
  }>;
  expired?: boolean;
  reason?: string;
}

export function normalizeApprovalDecision(
  input: ApprovalDecisionNormalizerInput,
): NormalizedApprovalDecision {
  const action = input.action ?? 'SKIP';

  if (input.expired) {
    return buildNormalized({
      decision: { kind: 'EXPIRED', reason: input.reason ?? 'APPROVAL_EXPIRED' },
      action: 'SKIP',
      executionAllowed: false,
      approvalFailure: 'approvalExpired',
    });
  }

  if (action === 'REJECT') {
    return buildNormalized({
      decision: { kind: 'REJECTED', reason: input.reason ?? 'USER_REJECTED_BUY_APPROVAL' },
      action,
      executionAllowed: false,
      approvalFailure: 'approvalRejected',
    });
  }

  if (action === 'SKIP') {
    return buildNormalized({
      decision: { kind: 'EXPIRED', reason: input.reason ?? 'USER_SKIPPED_BUY_APPROVAL' },
      action,
      executionAllowed: false,
      approvalFailure: 'approvalExpired',
    });
  }

  if (input.delivery.kind === 'DELIVERY_FAILED') {
    const decision = input.deliveryFailureDecision ?? defaultDeliveryFailureDecision(input.mode, input.delivery.reason);
    return buildNormalized({
      decision,
      action: decision.kind === 'APPROVE_WITH_TELEGRAM_DELIVERY_FAILED' ? 'APPROVE' : 'SKIP',
      executionAllowed: decision.kind === 'APPROVE_WITH_TELEGRAM_DELIVERY_FAILED',
      approvalFailure: 'approvalDeliveryFailed',
    });
  }

  if (action === 'APPROVE') {
    return buildNormalized({
      decision: { kind: 'APPROVED', reason: input.reason ?? 'BUY_APPROVAL_GRANTED' },
      action,
      executionAllowed: true,
      approvalFailure: 'NONE',
    });
  }

  emitOperationalWarn({
    code: 'P0_APPROVAL_DECISION_UNMAPPED',
    message: 'Approval decision normalizer received an unmapped state',
    context: {
      mode: input.mode,
      action,
      deliveryKind: input.delivery.kind,
    },
  });

  return buildNormalized({
    decision: { kind: 'MANUAL_REVIEW_REQUIRED', reason: 'APPROVAL_DECISION_UNMAPPED' },
    action: 'SKIP',
    executionAllowed: false,
    approvalFailure: 'approvalExpired',
  });
}

function defaultDeliveryFailureDecision(
  mode: ApprovalMode,
  reason: string,
): ApprovalDecision {
  if (mode === 'SHADOW') {
    return {
      kind: 'APPROVE_WITH_TELEGRAM_DELIVERY_FAILED',
      reason: `SHADOW_APPROVAL_DELIVERY_FAILED_PAPER_FILL_ALLOWED: ${reason}`,
    };
  }

  return {
    kind: 'BLOCKED_FOR_APPROVAL_DELIVERY_FAILURE',
    reason: `LIVE_APPROVAL_DELIVERY_FAILED: ${reason}`,
  };
}

function buildNormalized(input: {
  decision: ApprovalDecision;
  action: ApprovalAction;
  executionAllowed: boolean;
  approvalFailure: ApprovalFailureKind;
  executionFailure?: ExecutionFailureKind;
}): NormalizedApprovalDecision {
  const executionFailure = input.executionFailure ?? 'NONE';
  return {
    decision: input.decision,
    action: input.action,
    executionAllowed: input.executionAllowed,
    approvalDeliveryFailed: input.approvalFailure === 'approvalDeliveryFailed',
    approvalRejected: input.approvalFailure === 'approvalRejected',
    approvalExpired: input.approvalFailure === 'approvalExpired',
    executionFailed: executionFailure === 'executionFailed',
    statusWriteFailed: executionFailure === 'statusWriteFailed',
    approvalFailure: input.approvalFailure,
    executionFailure,
  };
}
