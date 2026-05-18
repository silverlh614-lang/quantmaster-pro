import { describe, expect, it, vi } from 'vitest';

import { deliverApprovalRequest } from './approvalDeliveryService.js';

describe('approvalDeliveryService', () => {
  it('returns DELIVERED with a normalized string messageId', async () => {
    await expect(deliverApprovalRequest(
      { message: 'approval' },
      { sendTelegramAlert: vi.fn(async () => 123) },
    )).resolves.toEqual({
      kind: 'DELIVERED',
      messageId: '123',
    });
  });

  it('returns retryable DELIVERY_FAILED when Telegram returns no message id', async () => {
    await expect(deliverApprovalRequest(
      { message: 'approval' },
      { sendTelegramAlert: vi.fn(async () => undefined) },
    )).resolves.toEqual({
      kind: 'DELIVERY_FAILED',
      reason: 'TELEGRAM_DELIVERY_RETURNED_EMPTY_MESSAGE_ID',
      retryable: true,
    });
  });

  it('returns retryable DELIVERY_FAILED when Telegram throws', async () => {
    await expect(deliverApprovalRequest(
      { message: 'approval' },
      { sendTelegramAlert: vi.fn(async () => { throw new Error('telegram down'); }) },
    )).resolves.toEqual({
      kind: 'DELIVERY_FAILED',
      reason: 'telegram down',
      retryable: true,
    });
  });
});
