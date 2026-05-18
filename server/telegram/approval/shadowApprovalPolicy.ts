// @responsibility SHADOW buy approval policy.

import { normalizeApprovalDecision } from './approvalDecisionNormalizer.js';
import type {
  ApprovalAction,
  ApprovalDeliveryResult,
  NormalizedApprovalDecision,
} from './approvalTypes.js';

export interface ShadowApprovalPolicyInput {
  action: ApprovalAction;
  delivery: ApprovalDeliveryResult;
  reason?: string;
}

export function resolveShadowApprovalPolicy(input: ShadowApprovalPolicyInput): NormalizedApprovalDecision {
  if (input.delivery.kind === 'DELIVERY_FAILED') {
    return normalizeApprovalDecision({
      mode: 'SHADOW',
      action: input.action,
      delivery: input.delivery,
      deliveryFailureDecision: {
        kind: 'APPROVE_WITH_TELEGRAM_DELIVERY_FAILED',
        reason: input.reason ?? `SHADOW_APPROVAL_DELIVERY_FAILED_PAPER_FILL_ALLOWED: ${input.delivery.reason}`,
      },
    });
  }

  return normalizeApprovalDecision({
    mode: 'SHADOW',
    action: input.action,
    delivery: input.delivery,
    reason: input.reason,
  });
}
