// @responsibility Approval fallback decisions for timeout, delivery failure, no response, duplicates.

import { emitOperationalWarn } from '../../trading/buy/operationalWarn.js';
import type { ApprovalDecision, ApprovalMode } from './approvalTypes.js';

export type ApprovalFallbackEvent =
  | 'DELIVERY_FAILURE'
  | 'TIMEOUT'
  | 'USER_NO_RESPONSE'
  | 'DUPLICATE_REQUEST';

export interface ApprovalFallbackPolicyInput {
  mode: ApprovalMode;
  event: ApprovalFallbackEvent;
  reason?: string;
  duplicateApproved?: boolean;
}

export function resolveApprovalFallbackPolicy(input: ApprovalFallbackPolicyInput): ApprovalDecision {
  if (input.event === 'DUPLICATE_REQUEST') {
    return input.duplicateApproved
      ? { kind: 'APPROVED', reason: input.reason ?? 'DUPLICATE_REQUEST_ALREADY_APPROVED' }
      : { kind: 'MANUAL_REVIEW_REQUIRED', reason: input.reason ?? 'DUPLICATE_APPROVAL_REQUEST_BLOCKED' };
  }

  if (input.event === 'TIMEOUT' || input.event === 'USER_NO_RESPONSE') {
    return { kind: 'EXPIRED', reason: input.reason ?? input.event };
  }

  if (input.event === 'DELIVERY_FAILURE') {
    if (input.mode === 'SHADOW') {
      return {
        kind: 'APPROVE_WITH_TELEGRAM_DELIVERY_FAILED',
        reason: input.reason ?? 'SHADOW_APPROVAL_DELIVERY_FAILED_PAPER_FILL_ALLOWED',
      };
    }

    const decision: ApprovalDecision = {
      kind: 'BLOCKED_FOR_APPROVAL_DELIVERY_FAILURE',
      reason: input.reason ?? 'LIVE_APPROVAL_DELIVERY_FAILED',
    };
    emitOperationalWarn({
      code: 'P0_LIVE_AUTO_APPROVAL_BLOCKED',
      message: 'LIVE fallback policy blocked auto approval after delivery failure',
      context: {
        event: input.event,
        reason: decision.reason,
      },
    });
    return decision;
  }

  emitOperationalWarn({
    code: 'P0_APPROVAL_POLICY_VIOLATION',
    message: 'Approval fallback policy received an unmapped fallback event',
    context: { event: input.event, mode: input.mode },
  });
  return { kind: 'MANUAL_REVIEW_REQUIRED', reason: 'APPROVAL_FALLBACK_POLICY_UNMAPPED' };
}
