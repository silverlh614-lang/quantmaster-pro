import { beforeEach, describe, expect, it, vi } from 'vitest';

const _sendTelegramAlert = vi.fn(async () => undefined);

vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: _sendTelegramAlert,
  answerCallbackQuery: vi.fn(async () => undefined),
  editMessageText: vi.fn(async () => undefined),
  escapeHtml: (value: string) => value,
}));

vi.mock('../clients/enemyCheckClient.js', () => ({
  buildPreMortem: ({ lines }: { lines: string[] }) => ({
    source: 'AI_GENERATED_HYPOTHESIS',
    confidence: 'LOW',
    lines,
  }),
  formatEnemyCheckSummary: () => '',
}));

beforeEach(() => {
  vi.resetModules();
  _sendTelegramAlert.mockReset();
  _sendTelegramAlert.mockResolvedValue(undefined);
});

function approvalParams(mode: 'LIVE' | 'SHADOW') {
  return {
    tradeId: `trade-${mode}`,
    stockCode: '005930',
    stockName: 'Samsung',
    currentPrice: 70000,
    quantity: 1,
    stopLoss: 65000,
    targetPrice: 80000,
    mode,
    gateScore: 7,
    regime: 'R6_DEFENSE',
  };
}

describe('buyApproval delivery policy wiring', () => {
  it('does not auto-approve LIVE when Telegram delivery fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { requestBuyApprovalWithDelivery } = await import('./buyApproval.js');

    const result = await requestBuyApprovalWithDelivery(approvalParams('LIVE'));

    expect(result).toMatchObject({
      action: 'SKIP',
      telegramDelivered: false,
      approvalDeliveryFailed: true,
      approvalDecision: {
        kind: 'BLOCKED_FOR_APPROVAL_DELIVERY_FAILURE',
      },
      normalizedApproval: {
        executionAllowed: false,
      },
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[P0][P0_LIVE_APPROVAL_DELIVERY_FAILED]'),
      expect.objectContaining({ code: 'P0_LIVE_APPROVAL_DELIVERY_FAILED' }),
    );
  });

  it('allows SHADOW paper-fill decision when Telegram delivery fails', async () => {
    const { requestBuyApprovalWithDelivery } = await import('./buyApproval.js');

    const result = await requestBuyApprovalWithDelivery(approvalParams('SHADOW'));

    expect(result).toMatchObject({
      action: 'APPROVE',
      telegramDelivered: false,
      approvalDeliveryFailed: true,
      approvalDecision: {
        kind: 'APPROVE_WITH_TELEGRAM_DELIVERY_FAILED',
        reason: expect.stringContaining('TELEGRAM_DELIVERY_RETURNED_EMPTY_MESSAGE_ID'),
      },
      normalizedApproval: {
        executionAllowed: true,
      },
    });
  });
});
