// @responsibility Telegram approval message delivery adapter.

import { sendTelegramAlert, type TelegramAlertOptions } from '../../alerts/telegramClient.js';
import type { ApprovalDeliveryResult } from './approvalTypes.js';

export interface ApprovalDeliveryRequest {
  message: string;
  options?: TelegramAlertOptions;
}

export interface ApprovalDeliveryServiceDeps {
  sendTelegramAlert?: typeof sendTelegramAlert;
}

export async function deliverApprovalRequest(
  request: ApprovalDeliveryRequest,
  deps: ApprovalDeliveryServiceDeps = {},
): Promise<ApprovalDeliveryResult> {
  const send = deps.sendTelegramAlert ?? sendTelegramAlert;

  try {
    const messageId = await send(request.message, request.options);
    if (messageId === undefined || messageId === null) {
      return {
        kind: 'DELIVERY_FAILED',
        reason: 'TELEGRAM_DELIVERY_RETURNED_EMPTY_MESSAGE_ID',
        retryable: true,
      };
    }

    return {
      kind: 'DELIVERED',
      messageId: String(messageId),
    };
  } catch (error) {
    return {
      kind: 'DELIVERY_FAILED',
      reason: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
  }
}
