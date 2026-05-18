// @responsibility LIVE buy approval policy.

import { emitOperationalWarn } from '../../trading/buy/operationalWarn.js';
import { normalizeApprovalDecision } from './approvalDecisionNormalizer.js';
import type {
  ApprovalAction,
  ApprovalDeliveryResult,
  NormalizedApprovalDecision,
} from './approvalTypes.js';

export interface LiveApprovalPolicyInput {
  action: ApprovalAction;
  delivery: ApprovalDeliveryResult;
  reason?: string;
}

export function resolveLiveApprovalPolicy(input: LiveApprovalPolicyInput): NormalizedApprovalDecision {
  if (input.delivery.kind === 'DELIVERY_FAILED') {
    emitOperationalWarn({
      code: 'P0_LIVE_APPROVAL_DELIVERY_FAILED',
      message: 'LIVE approval delivery failed; live order must not continue',
      context: {
        reason: input.delivery.reason,
        retryable: input.delivery.retryable,
      },
    });

    const normalized = normalizeApprovalDecision({
      mode: 'LIVE',
      action: input.action,
      delivery: input.delivery,
      deliveryFailureDecision: {
        kind: 'BLOCKED_FOR_APPROVAL_DELIVERY_FAILURE',
        reason: input.reason ?? `LIVE_APPROVAL_DELIVERY_FAILED: ${input.delivery.reason}`,
      },
    });

    if (normalized.executionAllowed) {
      emitOperationalWarn({
        code: 'P0_LIVE_AUTO_APPROVAL_BLOCKED',
        message: 'LIVE auto approval was blocked after Telegram delivery failure',
        context: {
          decision: normalized.decision.kind,
          reason: normalized.decision.reason,
        },
      });
      return {
        ...normalized,
        action: 'SKIP',
        executionAllowed: false,
        decision: {
          kind: 'BLOCKED_FOR_APPROVAL_DELIVERY_FAILURE',
          reason: normalized.decision.reason,
        },
      };
    }

    return normalized;
  }

  return normalizeApprovalDecision({
    mode: 'LIVE',
    action: input.action,
    delivery: input.delivery,
    reason: input.reason,
  });
}
