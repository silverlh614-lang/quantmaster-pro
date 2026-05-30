// @responsibility Regression tests that manual Telegram diagnostic commands bypass push suppression.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendTelegramAlert: vi.fn(async () => 101),
  answerCallbackQuery: vi.fn(async () => undefined),
  dispatchTelegramCommand: vi.fn(async (ctx: { reply: (message: string) => Promise<void> }) => {
    await ctx.reply('🔬 [scan_blockers full mode]\ndiagnosticOnly=true executionImpact=NONE');
  }),
  dispatchTelegramCallback: vi.fn(async () => false),
}));

vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: mocks.sendTelegramAlert,
  answerCallbackQuery: mocks.answerCallbackQuery,
}));
vi.mock('./commandRouter.js', () => ({
  dispatchTelegramCommand: mocks.dispatchTelegramCommand,
}));
vi.mock('./callbackRouter.js', () => ({
  dispatchTelegramCallback: mocks.dispatchTelegramCallback,
}));
vi.mock('./buyApproval.js', () => ({ handleBuyApprovalCallback: vi.fn(async () => false) }));
vi.mock('./operatorOverride.js', () => ({ handleOperatorOverrideCallback: vi.fn(async () => false) }));
vi.mock('../alerts/ackTracker.js', () => ({ handleT1AckCallback: vi.fn(async () => false) }));
vi.mock('./commands/system/index.js', () => ({}));
vi.mock('./commands/watchlist/index.js', () => ({}));
vi.mock('./commands/positions/index.js', () => ({}));
vi.mock('./commands/alert/index.js', () => ({}));
vi.mock('./commands/learning/index.js', () => ({}));
vi.mock('./commands/control/index.js', () => ({}));
vi.mock('./commands/trade/index.js', () => ({}));
vi.mock('./commands/infra/index.js', () => ({}));
vi.mock('./commands/shadow/index.js', () => ({}));

import {
  buildBotQueryResponseOptions,
  handleTelegramWebhook,
} from './webhookHandler.js';

describe('webhookHandler manual diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TELEGRAM_CHAT_ID = '1';
  });

  it('marks command replies as BOT_QUERY_RESPONSE so diagnosticOnly output is still delivered', async () => {
    const req = {
      body: {
        message: {
          text: '/scan_blockers full',
          chat: { id: '1' },
          from: { id: '2' },
        },
      },
    };
    const res = { sendStatus: vi.fn() };

    await handleTelegramWebhook(req as any, res as any);

    expect(res.sendStatus).toHaveBeenCalledWith(200);
    expect(mocks.dispatchTelegramCommand).toHaveBeenCalledWith(expect.objectContaining({
      rawText: '/scan_blockers full',
      chatId: '1',
      userId: '2',
    }));
    expect(mocks.sendTelegramAlert).toHaveBeenCalledWith(
      expect.stringContaining('[scan_blockers full mode]'),
      expect.objectContaining({
        notificationTarget: 'BOT_QUERY_RESPONSE',
        notificationEventType: 'BOT_QUERY_RESPONSE',
        notificationOnly: true,
      }),
    );
  });

  it('preserves inline keyboards while marking bot query responses', () => {
    const replyMarkup = { inline_keyboard: [[{ text: 'pos', callback_data: 'BTN_POSITION' }]] };
    expect(buildBotQueryResponseOptions(replyMarkup)).toMatchObject({
      replyMarkup,
      notificationTarget: 'BOT_QUERY_RESPONSE',
      notificationEventType: 'BOT_QUERY_RESPONSE',
      notificationOnly: true,
    });
  });
});
